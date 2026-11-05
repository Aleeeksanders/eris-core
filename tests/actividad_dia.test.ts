// Servidor: la actividad del teléfono que viene con el día de COMIDA (1.84+: hasta que te duermes) sigue sumando a las metas
process.env.TZ = "America/Santiago";
import { test, expect } from "bun:test";
import { actividadDeHoy, computeTargets } from "C:/Proyectos/eris/src/services/DailyTargets.ts";

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const act = (day: string) => ({ day, minutes: 60, vigorousMin: 20, kcal: 450, label: "básquet" });

test("a la 1:30 sin dormir, la actividad de «ayer» (el día de comida) es de hoy; la de anteayer no", () => {
  const snap = { dayWakeTime: at(4, 9).toISOString(), schedule: { usualWake: 9 } };
  const now = at(5, 1, 30);
  expect(actividadDeHoy(act("2026-11-04"), snap, now)).toBeTruthy(); // día de comida
  expect(actividadDeHoy(act("2026-11-05"), snap, now)).toBeTruthy(); // calendario (apps anteriores)
  expect(actividadDeHoy(act("2026-11-03"), snap, now)).toBeNull();
  expect(actividadDeHoy(null, snap, now)).toBeNull();
});

test("las metas suman la actividad del día de comida (antes, a medianoche se caía)", () => {
  const body = { weightKg: 80, heightCm: 178, age: 30, sex: "h" as const, activity: 1.375 };
  const base = { body, today: "2026-11-05", now: at(5, 1, 30) };
  const sin = computeTargets({ ...base, activity: null });
  const conComida = computeTargets({ ...base, activity: act("2026-11-04") as any, foodDay: "2026-11-04" });
  const sinFoodDay = computeTargets({ ...base, activity: act("2026-11-04") as any });
  expect(conComida.kcal).toBeGreaterThan(sin.kcal);
  expect(sinFoodDay.kcal).toBe(sin.kcal); // sin el día de comida, como antes (no la reconoce)
  expect(conComida.waterL ?? 0).toBeGreaterThan(sin.waterL ?? 0);
});
