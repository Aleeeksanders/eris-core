// Metas del día con la actividad del reloj y el nivel de Forge sin contar dos veces (DailyTargets), 2026-10-16.
import { test, expect } from "bun:test";
import { computeTargets, activityLabel, extraExerciseKcal } from "C:/Proyectos/eris/src/services/DailyTargets.ts";

const body = { weightKg: 85, heightCm: 179, age: 27, sex: "h" as const, activity: 1.375, date: "2026-10-16", trainingKcal: 0, trainingSets: 0 };
const basket = { day: "2026-10-16", minutes: 120, vigorousMin: 120, kcal: 1200, bouts: [{ start: "x", end: "y", minutes: 120, intensity: "vigorosa", kcal: 1200, guess: "deporte", label: "basquet" }] };
const T = (over: any = {}) => computeTargets({ body, today: "2026-10-16", ...over });
const BMR = 10 * 85 + 6.25 * 179 - 5 * 27 + 5; // 1.839 (Mifflin)

test("el nivel de Forge ya trae el ejercicio típico: solo suma lo que lo pasa", () => {
  const { typical, extra } = extraExerciseKcal(BMR, 1.375, 1200);
  expect(typical).toBe(Math.round(BMR * 0.175)); // ~322 kcal de un día típico «Ligero»
  expect(extra).toBe(1200 - typical);
  expect(extraExerciseKcal(BMR, 1.2, 1200).extra).toBe(1200); // «Sedentario»: todo el ejercicio es extra
  expect(extraExerciseKcal(BMR, 1.725, 500).extra).toBe(0); // «Activo»: 500 kcal es un día normal
});

test("2 h de básquet con nivel Ligero: +878 kcal y agua extra, explicado", () => {
  const base = T(), t = T({ activity: basket });
  console.log(base.kcal, "→", t.kcal, "|", base.waterL, "→", t.waterL, "\n", t.sources.kcal, "\n", t.sources.water);
  expect(t.kcal - base.kcal).toBe(1200 - Math.round(BMR * 0.175));
  expect(t.kcalExtraToday).toBe(1200 - Math.round(BMR * 0.175));
  expect(t.waterL! - base.waterL!).toBeGreaterThan(1.2);
  expect(t.sources.kcal).toContain("ya incluye");
  expect(t.sources.kcal).toContain("básquet 2 h");
});

test("un entreno corto de Forge ya no se suma entero (antes se contaba dos veces)", () => {
  const forge = T({ body: { ...body, trainingKcal: 250, trainingSets: 12 } });
  expect(forge.kcal).toBe(T().kcal); // 250 kcal < ~322 de un día típico Ligero
  expect(forge.sources.kcal).toContain("dentro de tu día típico");
});

test("Forge y reloj no se suman: gana el mayor, menos el día típico", () => {
  const both = T({ body: { ...body, trainingKcal: 400, trainingSets: 15 }, activity: basket });
  expect(both.kcal - T().kcal).toBe(1200 - Math.round(BMR * 0.175));
});

test("actividad de otro día no cuenta; nombres", () => {
  expect(T({ activity: { ...basket, day: "2026-10-15" } }).kcal).toBe(T().kcal);
  expect(activityLabel(basket)).toBe("básquet 2 h");
});

test("nivel automático: si Forge lo tiene activo, manda el del teléfono (4 semanas reales)", () => {
  const auto = { factor: 1.48, label: "Moderado", perWeek: 2, days: 28 };
  const t = computeTargets({ body: { ...body, activityAuto: true }, today: "2026-10-16", autoLevel: auto });
  console.log(t.kcal, t.waterL, "|", t.sources.kcal);
  expect(t.kcalMaintenance).toBe(Math.round(Math.round(BMR) * 1.48));
  expect(t.sources.kcal).toContain("automático 1,48");
  // manual: se ignora el automático
  expect(computeTargets({ body, today: "2026-10-16", autoLevel: auto }).kcalMaintenance).toBe(Math.round(Math.round(BMR) * 1.375));
  // con el automático, el día típico también sale de él: 2 h de básquet suman lo que pasa de BMR × 0,28
  const conBasquet = computeTargets({ body: { ...body, activityAuto: true }, today: "2026-10-16", autoLevel: auto, activity: basket });
  expect(conBasquet.kcal - t.kcal).toBe(1200 - Math.round(Math.round(BMR) * 0.28));
});
