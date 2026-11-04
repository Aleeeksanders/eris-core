// ⚡ Modo Rendimiento · R1 (app): los avisos del día exigente (reminderRules) con un plan REAL del servidor, y lo que la app
// le pide al servidor (v: 2 → el plan llega como Rendimiento; sin v, como Óptimo).
import { test, expect } from "bun:test";
process.env.TZ = "America/Santiago";
import { gatherDayPlanInput, buildDayPlan } from "C:/Proyectos/eris/src/services/DayPlan.ts";
import { planForClient, previewPlans } from "C:/Proyectos/eris/src/services/DayPlanService.ts";
import { planReminders, DEFAULT_REMINDER_SETTINGS, type PlanInput } from "C:/Proyectos/eris-mobile/src/services/reminderRules.ts";

const NOW = new Date(2026, 9, 29, 7, 30);
const ins: any = { nights: 10, need: 7.5, debtH: 4, usualWakeH: 7, msf: null, bedtime: { target: 23.5, from: 23, to: 24, wake: 7, napShiftMin: 0 }, caffeineUntil: 17.5, last3AvgH: 5.5 };
const training = { rest: false, name: "Día A: Empuje", items: [{ name: "Press de banca", text: "3×6–8" }], doneSets: 0 };
const mem = { get: async () => null, set: async () => {}, getProfile: async () => ({ medical: { conditions: [{ id: "diabetes_t2" }] } }) };

async function rendPlan(nota?: string) {
  const i = { ...(await gatherDayPlanInput(mem, NOW)), sleep: ins, sleepAny: ins, lastSleep: { totalH: 4.5 }, wakeH: 7, training, ready: { level: "liviano", why: "Dormiste 4 h 30.", tip: "" } as any };
  return buildDayPlan(i, "rendimiento", nota);
}
/** Lo mismo que hace ReminderPlanner con el plan guardado */
const cuesOf = (p: any) => p.mode === "rendimiento" ? p.pasos.filter((s: any) => s.accion.type === "cue" && !s.hecho && s.hora != null)
  .map((s: any) => ({ pasoId: s.id, cue: s.accion.cue, hora: s.hora, titulo: s.titulo, detalle: s.detalle })) : null;
const mealsOf = (p: any) => p.pasos.filter((s: any) => s.accion.type === "log_food" && !s.hecho && s.hora != null)
  .map((s: any) => ({ pasoId: s.id, slot: s.accion.slot, hora: s.hora, titulo: s.titulo, detalle: s.detalle }));

const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  now: NOW, tone: "directo", name: "Alex", settings: { ...DEFAULT_REMINDER_SETTINGS },
  modules: { nutri: true, forge: true, finanzas: false },
  mealHistory: [], todayMeals: [], kcalToday: 0, proteinToday: 0, kcalGoal: 2400, proteinGoal: 130, proteinIsCap: false,
  waterToday: 0, waterGoal: 2.5, trainingDays: {}, ...o,
} as PlanInput);
const fmt = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

test("los pasos del día exigente avisan a su hora: lo que cae junto va en un solo aviso, con «Hecho ✓» y a Inicio", async () => {
  const p = await rendPlan("estrés 4, foco 2, ideas");
  const out = planReminders(base({ planCues: cuesOf(p), planMeals: mealsOf(p) }));
  const focus = out.filter((r) => r.kind === "focus");
  // café 8:30 (+ respirar 8:45 + bloque 9:00) · siesta-café 14:00 (+ ideas 14:30) · último café 17:30 (+ respirar, bloque)
  expect(focus.length).toBe(3);
  expect(focus.every((r) => r.category === "plan_cue" && r.pasoId)).toBe(true);
  const [a, b, c] = focus;
  expect(a.title).toMatch(/^☕ Café/);
  expect(a.body).toMatch(/Después: 8:45 suspiro cíclico, 5 min · 9:00 tu mejor rato/);
  expect(a.pasoId).toBe("mente-cafe1");
  expect(b.title).toMatch(/Siesta-café/);
  expect(fmt(b.at)).toBe("14:00");
  expect(b.body).toMatch(/Después: 14:30 ideas caminando/);
  expect(c.title).toMatch(/Último café \(hasta las 17:30\)/);
  // el café llega a su hora (±10 min) aunque haya un aviso de comida cerca: con el día exigente basta separarlos 20 min, no 45
  const desayuno = out.find((r) => r.id.endsWith("-plan-desayuno"))!;
  expect(desayuno).toBeTruthy();
  expect(Math.abs(a.at.getTime() - desayuno.at.getTime())).toBeGreaterThanOrEqual(20 * 60000);
  expect(Math.abs(a.at.getTime() - new Date(2026, 9, 29, 8, 30).getTime())).toBeLessThanOrEqual(10 * 60000);
  // ids con el prefijo de los avisos del día (se reemplazan al recalcular)
  expect(focus.every((r) => r.id.startsWith("eris-plan-2026-10-29-focus-"))).toBe(true);
});

test("lo hecho no avisa; lo que ya pasó tampoco; mañana nunca; y el «último café» genérico sobra", async () => {
  const p = await rendPlan();
  p.pasos = p.pasos.map((s: any) => (s.id === "mente-bajon" ? { ...s, hecho: true } : s));
  const sleep = { bedFrom: 23, bedTo: 24, caffeineUntil: 17.5, drifting: false, debtH: 4, plan: null, coffeeAfternoon: true, lateCaffeineToday: false };
  const at15 = new Date(2026, 9, 29, 15, 0);
  const out = planReminders(base({ now: at15, planCues: cuesOf(p), sleep }));
  const focus = out.filter((r) => r.kind === "focus");
  expect(focus.length).toBe(1); // solo lo de las 17:30 (el café de la mañana ya pasó; la siesta-café está hecha)
  expect(focus[0].title).toMatch(/Último café/);
  expect(out.some((r) => r.id === "eris-plan-2026-10-29-sleep-coffee")).toBe(false);
  expect(out.some((r) => r.kind === "focus" && r.at.getDate() !== 29)).toBe(false);
  // sin plan exigente, el «último café» de siempre sigue
  expect(planReminders(base({ now: at15, sleep })).some((r) => r.id === "eris-plan-2026-10-29-sleep-coffee")).toBe(true);
});

test("sin día exigente no hay avisos de foco (y los de siempre no cambian)", async () => {
  const i = { ...(await gatherDayPlanInput(mem, NOW)), sleep: ins, sleepAny: ins, lastSleep: { totalH: 7.5 }, wakeH: 7 };
  const op = buildDayPlan(i, "optimo");
  expect(cuesOf(op)).toBeNull();
  const before = planReminders(base({ planMeals: mealsOf(op) }));
  expect(before.some((r) => r.kind === "focus")).toBe(false);
});

test("la app nueva (v: 2) recibe el plan como Rendimiento; la 1.71 lo sigue viendo como Óptimo", async () => {
  const p = await rendPlan();
  expect(planForClient({ data: { planV: 2 } }, p as any)!.mode).toBe("rendimiento");
  const old = planForClient({ data: {} }, p as any)!;
  expect(old.mode).toBe("optimo");
  expect(old.pasos.length).toBe(p.pasos.length);
  // la hoja: el 4.º camino solo si se ofrece, con «destacar» cuando durmió poco
  const m = new Map<string, any>();
  const memP = { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { m.set(k, v); }, getProfile: async () => ({ medical: { conditions: [] } }) };
  expect((await previewPlans(memP, NOW)).map((x) => x.mode)).toEqual(["estricto", "optimo", "flexible"]);
  const con = await previewPlans(memP, NOW, { rendimiento: true });
  expect(con.map((x) => x.mode)).toEqual(["estricto", "optimo", "flexible", "rendimiento"]);
  expect(typeof con[3].destacar).toBe("boolean");
});

test("de usted, sin emoji en lo que agrega la app; y la curva viaja en el plan", async () => {
  const p = await rendPlan();
  expect(p.curva?.estimado).toBe(true);
  expect(p.curva!.puntos.length).toBeGreaterThan(20);
  expect(p.tazas).toEqual({ max: 4, llevas: 0 });
  const out = planReminders(base({ tone: "usted", planCues: cuesOf(p) }));
  for (const r of out.filter((x) => x.kind === "focus")) expect(r.body).not.toMatch(/undefined|NaN/);
});

test("si entrena en el segundo aire, el bloque no choca con el entreno", async () => {
  const sl: any = { nights: 10, need: 7.5, debtH: 2, usualWakeH: 7.75, msf: null, bedtime: { target: 24.25, from: 23.75, to: 24.75, wake: 7.75, napShiftMin: 0 }, caffeineUntil: 18.25 };
  const base0 = { ...(await gatherDayPlanInput(mem, new Date(2026, 9, 29, 8, 0))), sleep: sl, sleepAny: sl, lastSleep: { totalH: 5.5 }, wakeH: 7.75,
    training: { rest: false, name: "Día A: Empuje", items: [{ name: "Press de banca", text: "3×6–8" }], doneSets: 0 }, ready: { level: "suave", why: "", tip: "" } as any };
  for (const time of ["19:00", "19:30", "20:00", "18:30"]) {
    const p = buildDayPlan({ ...base0, intent: { answer: "si", time } } as any, "rendimiento");
    const t = Number(time.slice(0, 2)) + Number(time.slice(3)) / 60;
    const b2 = p.pasos.find((s: any) => s.id === "mente-bloque2");
    const ent = p.pasos.find((s: any) => s.modulo === "entreno");
    expect(ent?.hora).toBe(t);
    if (b2) expect(b2.hora! + 1 <= t || b2.hora! >= t + 1).toBe(true);
  }
  // sin entreno, el bloque va al inicio del segundo aire
  const sin = buildDayPlan({ ...base0, intent: { answer: "no" } } as any, "rendimiento");
  expect(sin.pasos.find((s: any) => s.id === "mente-bloque2")!.hora).toBe(sin.curva!.segundoAire![0]);
});
