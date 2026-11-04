// Revisión V2b — E1: la meta de agua de Forge (app) = la de Inicio (servidor, DailyTargets) en los mismos casos
process.env.TZ = "America/Santiago";
import { test, expect } from "bun:test";
import { aguaForge } from "C:/Proyectos/eris-mobile/src/services/forge/forgeWater.ts";
import * as L from "C:/Proyectos/eris-mobile/src/services/forge/forgeLegacy.ts";
import { computeTargets } from "C:/Proyectos/eris/src/services/DailyTargets.ts";

const now = new Date(2026, 10, 4, 12, 0);
const today = "2026-11-04";
const cuerpo = (kg: number, activity = 1.55) => ({ bodyKg: kg, heightCm: 175, age: 35, sex: "h", activity, training: {}, today: {} });
const intent = (waterMl: number) => ({ day: today, answer: "si" as const, kind: "rutina" as const, time: "19:00", minutes: 60, kcal: 400, waterMl, source: "app" as const, at: now.toISOString() });

function ambos(o: { kg: number; activity?: number; sets?: number; intent?: any; fijada?: number }) {
  const S = cuerpo(o.kg, o.activity);
  const sets = o.sets ?? 0;
  const app = aguaForge(S, sets, null, { intent: o.intent ?? null, ghostExpired: false, bmr: L.bmrOf(S), fijadas: o.fijada ? { waterLiters: o.fijada } : {} })!;
  const srv = computeTargets({
    stored: o.fijada ? { waterLiters: o.fijada } : {},
    body: { weightKg: o.kg, heightCm: 175, age: 35, sex: "h", activity: o.activity ?? 1.55, date: today, trainingSets: sets, trainingKcal: sets * 8 },
    today, intent: o.intent ?? null, now,
  });
  return { app: Number((app.total / 1000).toFixed(1)), srv: srv.waterL, total: app.total };
}

test("E1: sin «¿Entrenas hoy?», Forge e Inicio dicen lo mismo", () => {
  const r = ambos({ kg: 72 });
  expect(r.app).toBe(r.srv);
});

test("E1: con el día respondido, sin el bono del nivel y con el agua del entreno planificado (antes Forge no lo sumaba)", () => {
  const r = ambos({ kg: 72, intent: intent(600) });
  expect(r.srv).toBe(Number(((72 * 35 + 600) / 1000).toFixed(1)));
  expect(r.app).toBe(r.srv);
  // lo que hacía antes Forge (hydrationOf): el bono del nivel y sin lo planificado
  const viejo = L.hydrationOf(cuerpo(72), 0, null)!;
  expect(viejo.total).not.toBe(r.total);
});

test("E1: entreno hecho (series) y planificado: manda el mayor, igual que el servidor", () => {
  const r = ambos({ kg: 72, sets: 30, intent: intent(400) });
  expect(r.app).toBe(r.srv);
});

test("E1: la meta fijada en Perfil y el tope de 6 L", () => {
  const f = ambos({ kg: 72, fijada: 2.2 });
  expect(f.app).toBe(2.2);
  expect(f.srv).toBe(2.2);
  const t = ambos({ kg: 170, intent: intent(1000) });
  expect(t.total).toBe(6000);
  expect(t.srv).toBe(6);
  const sinDia = aguaForge(cuerpo(200, 1.9), 0, null, { intent: null, ghostExpired: false, bmr: 2000 })!;
  expect(sinDia.total).toBeLessThanOrEqual(6000);
});
