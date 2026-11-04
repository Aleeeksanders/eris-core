// Sueño 2.0 · S0: el servidor con el sueño por partes (el snapshot que mandará el teléfono 1.65) y lo anotado por chat.
import { test, expect } from "bun:test";
process.env.TZ = "America/Santiago";
import { sleepDay } from "C:/Proyectos/eris/src/services/SleepCore.ts";
import { gatherMetabolicContext, analyze } from "C:/Proyectos/eris/src/services/MetabolicAnalysis.ts";
import { SleepLogTool } from "C:/Proyectos/eris/src/tools/SleepLogTool.ts";

const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();
const seq = (start: number, parts: Array<[number, number]>) => {
  const out: Array<{ start: number; end: number; stage: number }> = [];
  let t = start;
  for (const [stage, min] of parts) { out.push({ start: t, end: t + min * 60_000, stage }); t += min * 60_000; }
  return out;
};
const dia = sleepDay([
  { start: at(24, 2, 33), end: at(24, 3, 18) },
  { start: at(24, 4, 20), end: at(24, 9, 5), stages: seq(at(24, 4, 20), [[4, 60], [5, 50], [4, 50], [1, 1], [6, 15], [5, 35], [4, 58], [6, 16]]) },
  { start: at(24, 13, 51), end: at(24, 17, 54), stages: seq(at(24, 13, 51), [[4, 40], [5, 45], [6, 20], [4, 44], [1, 1], [5, 32], [6, 21], [4, 40]]) },
], { usualWake: 7.75, usualSleepH: 7.25 })!;

const memWith = (snap: any) => {
  const store: Record<string, any> = { health_snapshot_latest: snap };
  return { get: async (k: string) => store[k] ?? null, set: async (k: string, v: any) => { store[k] = v; }, getProfile: async () => ({}),
    upsertDailyRollup: async () => {}, store };
};
const snapPartido = () => ({
  lastUpdated: new Date().toISOString(),
  sleep: { durationHours: dia.totalH, nightHours: dia.nightH, split: true, episodes: dia.episodes, startTime: dia.night!.start, endTime: dia.night!.end },
  schedule: { usualWake: 7.75, sleepHours: 7.25 },
});

test("el análisis ya no dice «8,8 h, descanso suficiente»: lo cuenta en partes", async () => {
  const ctx = await gatherMetabolicContext(memWith(snapPartido()) as any);
  const f = analyze(ctx).findings.find((x: any) => x.area === "sueno")!;
  expect(f.headline).toBe("Dormiste 9 h 31 en partes");
  expect(f.detail).toContain("la noche, de 02:33 a 09:05 (5 h 29, con 1 h 03 despierto en medio)");
  expect(f.detail).toContain("un segundo sueño en la tarde, de 13:51 a 17:54 (4 h 02)");
  expect(f.detail).toContain("En horas recuperaste, pero la noche fue partida y empezó tarde");
  expect(f.severity).toBe(1);
  expect(f.action).toContain("20 min o menos antes de las 15:00");
  expect(f.detail).not.toContain("Descanso suficiente");
});

test("anotado por chat en partes: «dormí 4 y en la tarde 4 más»", async () => {
  const mem = memWith({ lastUpdated: new Date().toISOString(), sleep: { durationHours: 8.8, episodes: dia.episodes, split: true, nightHours: 5.48 } });
  const T = new SleepLogTool();
  const r = await T.execute({ action: "log", hours: 4, base: 4 } as any, { memory: mem });
  expect(r.metadata?.quickReply).toContain("4 h + 4 h");
  const log = mem.store["sleep_log"];
  expect(Object.values(log)[0]).toMatchObject({ hours: 8, parts: [4, 4] });
  expect(mem.store.health_snapshot_latest.sleep).toMatchObject({ durationHours: 8, manual: true, nightHours: 4, split: true });
  expect(mem.store.health_snapshot_latest.sleep.episodes).toBeUndefined();   // ya no se mezcla con los tramos del reloj
  const f = analyze(await gatherMetabolicContext(mem as any)).findings.find((x: any) => x.area === "sueno")!;
  expect(f.headline).toBe("Dormiste 8 h en partes");
  expect(f.detail).toContain("4 h de noche y 4 h aparte (lo anotaste tú)");
});

test("una noche normal sigue igual", async () => {
  const normal = sleepDay([{ start: at(24, 0, 5), end: at(24, 7, 40) }], { usualWake: 7.75 })!;
  const ctx = await gatherMetabolicContext(memWith({ lastUpdated: new Date().toISOString(), sleep: { durationHours: 7.6, nightHours: normal.nightH, split: false, episodes: normal.episodes } }) as any);
  const f = analyze(ctx).findings.find((x: any) => x.area === "sueno")!;
  expect(f.headline).toBe("Dormiste 7,6 h");
  expect(f.detail).toBe("Descanso suficiente.");
});
