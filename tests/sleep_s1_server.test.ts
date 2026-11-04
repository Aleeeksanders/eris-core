// Sueño 2.0 · S1 en el servidor: «¿cómo dormí?», «¿cómo vengo con el sueño?» y «¿a qué hora me acuesto?» por código.
import { test, expect } from "bun:test";
process.env.TZ = "America/Santiago";
import { sleepDay, sleepInsights } from "C:/Proyectos/eris/src/services/SleepCore.ts";
import { SleepLogTool } from "C:/Proyectos/eris/src/tools/SleepLogTool.ts";

// La semana del usuario, terminando hoy (las horas relativas a hoy para que el snapshot sea «de hoy»)
const base = new Date(); base.setHours(0, 0, 0, 0);
const at = (dd: number, h: number, m = 0) => base.getTime() + dd * 86400_000 + (h * 60 + m) * 60_000;
const ses = [
  ...Array.from({ length: 7 }, (_, i) => ({ start: at(-14 + i, 23, 30), end: at(-13 + i, 7, 0) })),
  { start: at(-7, 22, 30), end: at(-6, 5, 30) }, { start: at(-5, 1, 0), end: at(-5, 7, 30) }, { start: at(-5, 23, 30), end: at(-4, 6, 30) },
  { start: at(-3, 0, 30), end: at(-3, 7, 30) }, { start: at(-2, 2, 0), end: at(-2, 8, 0) }, { start: at(-1, 2, 0), end: at(-1, 7, 48) },
  { start: at(0, 2, 33), end: at(0, 3, 18) }, { start: at(0, 4, 20), end: at(0, 9, 5) }, { start: at(0, 13, 51), end: at(0, 17, 54) },
];
const now = Math.max(Date.now(), at(0, 18, 30));
const opts = { usualWake: 7.75, usualSleepH: 7.25 };
const d = sleepDay(ses.filter((s) => s.end > now - 36 * 3600_000), opts)!;
const ins = sleepInsights(ses, { ...opts, now });
const memWith = () => {
  const store: Record<string, any> = { health_snapshot_latest: { lastUpdated: new Date().toISOString(), schedule: { usualWake: 7.75, sleepHours: 7.25 },
    sleep: { durationHours: d.totalH, nightHours: d.nightH, split: d.split, episodes: d.episodes, during: { hr: 74, spo2: 97, spo2Min: 93, resp: 14.5 } }, sleepInsights: ins } };
  return { get: async (k: string) => store[k] ?? null, set: async (k: string, v: any) => { store[k] = v; }, upsertDailyRollup: async () => {}, store };
};
const T = new SleepLogTool();
const ask = async (m: string) => {
  const mem = memWith();
  const inp = await T.preroute(m, { memory: mem });
  return { inp, r: inp ? await T.execute(inp as any, { memory: mem, userMessage: m }) : null };
};

test("«¿Cómo dormí anoche?»: por partes, el puntaje de la noche, lo de durante y las 2 semanas", async () => {
  const { inp, r } = await ask("¿Cómo dormí anoche?");
  expect(inp).toEqual({ action: "report" });
  const t = String(r!.metadata?.quickReply);
  if (process.env.PRINT) console.log(["", t, "", String((await ask("¿A qué hora me acuesto?")).r!.metadata?.quickReply), "", String((await ask("¿Cómo vengo con el sueño?")).r!.metadata?.quickReply)].join("\n"));
  expect(t).toContain("la noche, de 02:33 a 09:05");
  expect(t).toMatch(/Tu noche: \*\*Partida\*\* \(\d+\/100\)/);
  expect(t).toContain("pulso 74 lpm, oxígeno 97 % (mín. 93 %)");
  expect(t).toContain("más tarde cada día");
  expect(t).toContain("acuéstate cuando te dé sueño, desde las");
  expect(t).toContain("levántate a la misma hora estos días y busca luz de mañana");
  expect(t).not.toMatch(/deberías|mal dormido|culpa/i);
});

test("«¿A qué hora me acuesto?» y «¿hasta qué hora puedo tomar café?»", async () => {
  for (const m of ["¿A qué hora me acuesto hoy?", "¿Hasta qué hora puedo tomar café?"]) {
    const { inp, r } = await ask(m);
    expect(inp).toEqual({ action: "bedtime" });
    expect(String(r!.metadata?.quickReply)).toMatch(/(acuéstate entre las \d\d:\d\d y las \d\d:\d\d; cafeína|desde las \d\d:\d\d.*Cafeína), hasta las \d\d:\d\d/);
  }
  // Durmió 4 h en la tarde: no forzar la hora
  expect(String((await ask("¿A qué hora me acuesto?")).r!.metadata?.quickReply)).toContain("acuéstate cuando te dé sueño, desde las");
});

test("«¿Cómo vengo con el sueño?»: las 2 semanas", async () => {
  const { inp, r } = await ask("¿Cómo vengo con el sueño?");
  expect(inp).toEqual({ action: "report", semana: true });
  expect(String(r!.metadata?.quickReply)).toContain("En 2 semanas promedias");
});

test("lo que no es pregunta de sueño no se toca", async () => {
  expect((await ask("Dormí 7 horas")).inp).toMatchObject({ action: "log", hours: 7 });
  expect((await ask("Dormí mal, ¿igual entreno hoy?")).inp?.action).not.toBe("report");
});
