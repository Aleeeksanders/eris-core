// El relleno desde Health Connect (fillDailyRollupGaps) repara un sueño imposible: el 1-11 quedó con 17,68 h en el registro
// (la noche de ayer + lo de hoy, ver sleepDay) y el relleno nunca lo corregía porque «lo que ya está no se toca».
// En memoria: este archivo no toca ningún perfil en disco.
import { test, expect } from "bun:test";
process.env.TZ = "America/Santiago";
import { FileSystemAdapter, type DailyRollupEntry } from "C:/Proyectos/eris/src/memory.ts";

class EnMemoria extends FileSystemAdapter {
  datos = new Map<string, any>();
  override async get(k: string) { return this.datos.get(k) ?? null; }
  override async set(k: string, v: any) { this.datos.set(k, JSON.parse(JSON.stringify(v))); }
}
const conRegistro = (filas: Array<Partial<DailyRollupEntry> & { date: string }>) => {
  const m = new EnMemoria("prueba-relleno");
  m.datos.set("daily_rollup_log", filas.map((f) => ({ updatedAt: "2026-11-01T18:39:20.662Z", ...f })));
  return m;
};
const fila = (m: EnMemoria, date: string) => (m.datos.get("daily_rollup_log") as any[]).find((e) => e.date === date);

test("un sueño imposible se reemplaza por lo de Health Connect; lo demás de ese día queda", async () => {
  const m = conRegistro([{ date: "2026-11-01", sleepHours: 17.68, sleepNightHours: 7.17, steps: 4000, calories: 2100 }]);
  expect(await m.fillDailyRollupGaps([{ date: "2026-11-01", sleepHours: 10.5, sleepNightHours: 10.5, steps: 9999 }])).toBe(1);
  expect(fila(m, "2026-11-01")).toMatchObject({ sleepHours: 10.5, sleepNightHours: 10.5, steps: 4000, calories: 2100 });
});

test("si Health Connect no trae sueño ese día, el dato imposible igual se va (sin dato, no 17 h) y no se repite", async () => {
  const m = conRegistro([{ date: "2026-11-01", sleepHours: 17.68, sleepNightHours: 7.17, steps: 4000 }]);
  expect(await m.fillDailyRollupGaps([{ date: "2026-11-01", steps: 4000 }])).toBe(1);
  const f = fila(m, "2026-11-01");
  expect(f.sleepHours).toBeUndefined();
  expect(f.sleepNightHours).toBeUndefined();
  expect(f.steps).toBe(4000);
  expect(await m.fillDailyRollupGaps([{ date: "2026-11-01", steps: 4000 }])).toBe(0);
});

test("un sueño largo pero creíble no se toca, aunque Health Connect diga otra cosa", async () => {
  const m = conRegistro([{ date: "2026-10-06", sleepHours: 11.1, sleepNightHours: 11 }]);
  expect(await m.fillDailyRollupGaps([{ date: "2026-10-06", sleepHours: 7, sleepNightHours: 7 }])).toBe(0);
  expect(fila(m, "2026-10-06")).toMatchObject({ sleepHours: 11.1, sleepNightHours: 11 });
});

test("lo que falta se sigue rellenando como siempre", async () => {
  const m = conRegistro([{ date: "2026-10-20", steps: 100 }]);
  expect(await m.fillDailyRollupGaps([{ date: "2026-10-20", sleepHours: 7.8, sleepNightHours: 7.7, steps: 500 }, { date: "2026-10-21", sleepHours: 7.5 }])).toBe(2);
  expect(fila(m, "2026-10-20")).toMatchObject({ sleepHours: 7.8, sleepNightHours: 7.7, steps: 100 });
  expect(fila(m, "2026-10-21")).toMatchObject({ sleepHours: 7.5 });
});
