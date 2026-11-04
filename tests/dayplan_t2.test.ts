// Eris al timón · T2: comió otra cosa → se rearma el resto del día; lo que falta va a la lista; los avisos siguen el plan.
import { test, expect } from "bun:test";
process.env.TZ = "America/Santiago";
import { buildPlan, loadPlan, doneStep, replan, replanAfterMeal } from "C:/Proyectos/eris/src/services/DayPlanService.ts";
import { gatherDayPlanInput, buildDayPlan } from "C:/Proyectos/eris/src/services/DayPlan.ts";
import { planReminders, DEFAULT_REMINDER_SETTINGS, type PlanInput } from "C:/Proyectos/eris-mobile/src/services/reminderRules.ts";

const fakeMemory = () => {
  const m = new Map<string, any>();
  return { m, get: async (k: string) => (m.has(k) ? m.get(k) : null), set: async (k: string, v: any) => { m.set(k, v); }, getProfile: async () => ({ medical: { conditions: [] } }) };
};
const fakeWs = () => { const sent: any[] = []; return { sent, send: (s: string) => sent.push(JSON.parse(s)) }; };

test("comió otra cosa en una comida del plan: se rearma el resto con lo que ya comió y se dice", async () => {
  const mem = fakeMemory(), ws = fakeWs();
  const p0 = await buildPlan(mem, "optimo");
  const pend = p0.pasos.filter((p) => p.accion.type === "log_food").map((p) => (p.accion as any).slot as string);
  expect(pend.length).toBeGreaterThan(1);
  const slot = pend[0];
  // el teléfono dice que en esa comida comió otra cosa, 900 kcal
  const p1 = (await replan(mem, ws, { slots: [slot], kcal: 900, protein: 30 }))!;
  expect(p1.pasos.some((p) => p.accion.type === "log_food" && (p.accion as any).slot === slot)).toBe(false);
  expect(p1.notas!.join(" ")).toMatch(/^Comiste otra cosa en (el|la) .+: rearmé lo que queda del día\.$/);
  const k0 = p0.pasos.filter((p) => p.accion.type === "log_food" && (p.accion as any).slot !== slot).reduce((a, p) => a + (p.accion as any).opciones[0].reduce((x: number, f: any) => x + f.kcal, 0), 0);
  const k1 = p1.pasos.filter((p) => p.accion.type === "log_food").reduce((a, p) => a + (p.accion as any).opciones[0].reduce((x: number, f: any) => x + f.kcal, 0), 0);
  // lo que queda se arma con lo que falta del día (la contrapartida va sola): no más que la meta menos lo comido (+ la colación de relleno)
  expect(k1).toBeLessThanOrEqual(p1.kcal - 900 + 150);
  void k0;
  expect(ws.sent.some((x) => x.type === "day_plan" && x.plan)).toBe(true);
  // sin plan no hace nada; si la comida ya estaba hecha, tampoco
  expect(await replanAfterMeal(fakeMemory(), null, "almuerzo")).toBeNull();
});

test("lo hecho se conserva al rearmar (con su ✓) y «Lo comí» no se repite", async () => {
  const mem = fakeMemory(), ws = fakeWs();
  const p0 = await buildPlan(mem, "estricto");
  const comida = p0.pasos.find((p) => p.accion.type === "log_food")!;
  await doneStep(mem, ws, comida.id);
  const p1 = await buildPlan(mem, "estricto");
  const kept = p1.pasos.find((p) => p.id === comida.id)!;
  expect(kept.hecho).toBe(true);
  expect(p1.pasos.filter((p) => p.id === comida.id).length).toBe(1);
  expect((await loadPlan(mem))!.pasos.find((p) => p.id === comida.id)!.hecho).toBe(true);
});

test("sin despensa pero con Inventario: lo que falta para el menú, a la lista de compras", async () => {
  const i = await gatherDayPlanInput(fakeMemory());
  const conInv = buildDayPlan({ ...i, hasInventory: true, pantry: null }, "optimo");
  const lista = conInv.pasos.find((p) => p.id === "casa-compras");
  expect(lista).toBeDefined();
  expect(lista!.accion.type).toBe("add_list");
  expect((lista!.accion as any).items.length).toBeGreaterThan(0);
  expect(buildDayPlan({ ...i, hasInventory: false, pantry: null }, "optimo").pasos.some((p) => p.id === "casa-compras")).toBe(false);
});

// ─── Avisos ───────────────────────────────────────────────────────────────────
const NOW = new Date(2026, 9, 29, 9, 0);
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  now: NOW, name: "Alex", settings: { ...DEFAULT_REMINDER_SETTINGS }, modules: { nutri: true, forge: true, finanzas: true },
  mealHistory: [], todayMeals: [], kcalToday: 0, proteinToday: 0, kcalGoal: 2000, proteinGoal: 100, proteinIsCap: false,
  waterToday: 0, waterGoal: 3, trainingDays: {}, forgeStreak: null, finance: null, ...over,
});
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const planMeals = [
  { pasoId: "comida-almuerzo", slot: "almuerzo", hora: 13.5, titulo: "☀️ Almuerzo", detalle: "Pechuga (150 g) + Arroz (1 taza) · ~560 kcal" },
  { pasoId: "comida-cena", slot: "cena", hora: 21, titulo: "🌙 Cena", detalle: "Lentejas (2 tazas) · ~430 kcal" },
];

test("con plan: la comida del plan avisa a su hora con lo que toca y «Lo comí ✓»; sin el aviso de siempre de esa comida", () => {
  const today = planReminders(base({ planMeals })).filter((r) => r.at.getDate() === 29 && r.kind === "meal");
  const al = today.find((r) => r.id.endsWith("plan-almuerzo"))!;
  expect(hm(al.at)).toBe("13:30");
  expect(al.title).toBe("☀️ Almuerzo: lo del plan");
  expect(al.body).toMatch(/^Pechuga/);
  expect(al.category).toBe("plan_meal");
  expect(al.pasoId).toBe("comida-almuerzo");
  expect(today.some((r) => r.id.endsWith("meal-almuerzo"))).toBe(false);
  // la cena del plan también; el aviso genérico de cena/once no
  expect(today.some((r) => r.id.endsWith("plan-cena"))).toBe(true);
  expect(today.some((r) => /meal-(cena|once)$/.test(r.id))).toBe(false);
  // si ya la comió, nada
  expect(planReminders(base({ planMeals, todayMeals: [{ slot: "almuerzo", minutes: 13 * 60 + 40 }] })).some((r) => r.id.endsWith("plan-almuerzo"))).toBe(false);
  // mañana no hay plan: los avisos de siempre
  expect(planReminders(base({ planMeals })).some((r) => r.at.getDate() === 30 && /-plan-(almuerzo|cena)$/.test(r.id))).toBe(false);
});
