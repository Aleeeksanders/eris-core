// Eris al timón · T3: «Otro» leído por el modelo (con respaldo del código), el piloto automático y los avisos del borrador.
import { test, expect } from "bun:test";
process.env.TZ = "America/Santiago";
import { readNotaLLM, conRespaldo } from "C:/Proyectos/eris/src/services/DayPlanNota.ts";
import { buildPlan, loadPlan, autoTick, setAuto, getAuto, planKey } from "C:/Proyectos/eris/src/services/DayPlanService.ts";
import { gatherDayPlanInput, buildDayPlan } from "C:/Proyectos/eris/src/services/DayPlan.ts";
import { planReminders, DEFAULT_REMINDER_SETTINGS, type PlanInput } from "C:/Proyectos/eris-mobile/src/services/reminderRules.ts";

const fakeMemory = () => {
  const m = new Map<string, any>();
  return { m, get: async (k: string) => (m.has(k) ? m.get(k) : null), set: async (k: string, v: any) => { m.set(k, v); }, getProfile: async () => ({ medical: { conditions: [] } }) };
};
const fakeLLM = (json: string) => ({ provider: { generate: async () => ({ content: json }) } });
const fakeWs = () => { const sent: any[] = []; return { sent, send: (s: string) => sent.push(JSON.parse(s)) }; };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("el modelo propone, el código decide: solo lo que la nota respalda", () => {
  // a «ando con resaca» el 4B le agregaba «afuera» y «sin plata»
  expect(conRespaldo({ afuera: ["desayuno"], sinPlata: true, enfermo: true, sinTiempo: true, sinEntreno: true }, "ando con resaca, no me pidas mucho"))
    .toEqual({ enfermo: true, sinEntreno: true });
  expect(conRespaldo({ sinTiempo: true, sinEntreno: true }, "mañana tengo examen, hoy no voy al gym")).toEqual({ sinTiempo: true, sinEntreno: true });
  expect(conRespaldo({ sinEntreno: true, kcalExtra: 300 }, "hoy quiero comer un poco más, mañana es la carrera")).toEqual({ kcalExtra: 300 });
  expect(conRespaldo({ evento: { que: "almuerzo", hora: 14 } }, "hoy viene mi suegra a almorzar a las 2")).toEqual({ evento: { que: "almuerzo", hora: 14 } });
});

test("readNotaLLM: JSON del modelo validado y con respaldo; basura o sin JSON = nada", async () => {
  expect(await readNotaLLM(fakeLLM('{"enfermo": true, "sinPlata": true}'), "ando con resaca")).toEqual({ enfermo: true });
  expect(await readNotaLLM(fakeLLM('Claro: {"sinTiempo": true}'), "tengo una reunión larga")).toEqual({ sinTiempo: true });
  expect(await readNotaLLM(fakeLLM('{"kcalExtra": 9000}'), "voy a comer más")).toBeNull(); // fuera de rango: zod lo rechaza
  expect(await readNotaLLM(fakeLLM("no sé"), "quiero algo distinto")).toBeNull();
  expect(await readNotaLLM(fakeLLM("{}"), "quiero algo distinto")).toBeNull();
});

test("la nota leída por el modelo cambia el plan; un evento al mediodía va en el almuerzo", async () => {
  const mem = fakeMemory();
  const p = await buildPlan(mem, "optimo", "ando con resaca", new Date(), null, fakeLLM('{"enfermo": true}') as any);
  expect(p.notaSinLeer).toBeUndefined();
  expect(p.pasos.find((s) => s.id === "entreno")!.titulo).toBe("🛌 Hoy descanso");
  const i = await gatherDayPlanInput(fakeMemory(), new Date(new Date().setHours(10, 0, 0, 0)));
  const ev = buildDayPlan(i, "optimo", null, { evento: { que: "almuerzo con visita", hora: 14 } });
  expect(ev.pasos.find((s) => s.id === "comida-almuerzo")!.titulo).toBe("🎉 Almuerzo con visita");
  const sin = buildDayPlan(i, "estricto", null, { sinEntreno: true });
  expect(sin.pasos.find((s) => s.id === "entreno")!.titulo).toBe("🛌 Hoy sin entreno");
  const mas = buildDayPlan(i, "optimo", null, { kcalExtra: 300 });
  expect(mas.kcal).toBe(buildDayPlan(i, "optimo").kcal + 300);
  expect(buildDayPlan(i, "estricto", null, { kcalExtra: -2000 }).kcal).toBeGreaterThanOrEqual(Math.round(i.targets.kcal * 0.9));
});

test("piloto automático: apagado no hace nada; en la mañana arma el día; en la noche deja el borrador de mañana", async () => {
  const mem = fakeMemory(), ws = fakeWs();
  const manana10 = new Date(); manana10.setHours(10, 0, 0, 0);
  expect(await autoTick(mem, ws, manana10)).toBeNull();
  expect((await setAuto(mem, true)).on).toBe(true);
  expect((await getAuto(mem)).on).toBe(true);
  // a las 10, sin plan: lo arma (con el último camino) y le avisa al teléfono para aplicarlo
  await mem.set("day_plan_mode", "flexible");
  expect(await autoTick(mem, ws, manana10)).toBe("hoy");
  const hoy = (await loadPlan(mem, manana10))!;
  expect(hoy.mode).toBe("flexible");
  expect(hoy.auto).toBe(true);
  expect(ws.sent.find((x) => x.type === "day_plan")).toMatchObject({ aplicar: true });
  // de nuevo, nada (ya hay plan)
  const noche = new Date(); noche.setHours(20, 30, 0, 0);
  expect(await autoTick(mem, ws, noche)).toBe("manana");
  const d = new Date(noche); d.setDate(d.getDate() + 1);
  const draft = mem.m.get(planKey(iso(d)));
  expect(draft.borrador).toBe(true);
  expect(draft.pasos.find((s: any) => s.modulo === "entreno").titulo).toBe("🏋️ El entreno de mañana");
  expect(draft.pasos.filter((s: any) => s.accion.type === "log_food").length).toBeGreaterThan(1);
  expect(ws.sent.some((x) => x.type === "day_plan_manana" && x.plan.borrador)).toBe(true);
  expect(await autoTick(mem, ws, noche)).toBeNull(); // una vez
  // a la mañana siguiente: el día se arma conservando las comidas del borrador (los avisos ya las anunciaron)
  const sig = new Date(d); sig.setHours(9, 30, 0, 0);
  const comida0 = draft.pasos.find((s: any) => s.accion.type === "log_food");
  const real = await buildPlan(mem, "flexible", null, sig);
  expect(real.borrador).toBeUndefined();
  const misma = real.pasos.find((s) => s.id === comida0.id);
  if (misma) expect(misma.detalle).toBe(comida0.detalle);
});

// ─── Avisos del borrador ──────────────────────────────────────────────────────
const NOW = new Date(2026, 9, 29, 21, 0);
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  now: NOW, name: "Alex", settings: { ...DEFAULT_REMINDER_SETTINGS }, modules: { nutri: true, forge: true, finanzas: true },
  mealHistory: [], todayMeals: [], kcalToday: 0, proteinToday: 0, kcalGoal: 2000, proteinGoal: 100, proteinIsCap: false,
  waterToday: 0, waterGoal: 3, trainingDays: {}, forgeStreak: null, finance: null, ...over,
});
test("el borrador de mañana: sus comidas avisan mañana con «Lo comí ✓» y la mañana dice que el día ya está armado", () => {
  const planMealsTomorrow = [{ pasoId: "comida-desayuno", slot: "desayuno", hora: 8.25, titulo: "🌅 Desayuno", detalle: "Huevo (2) + Marraqueta (1) + Palta · ~520 kcal" }];
  const r = planReminders(base({ planMealsTomorrow }));
  const de = r.find((x) => x.id.endsWith("2026-10-30-plan-desayuno"))!;
  expect(de.category).toBe("plan_meal");
  expect(de.pasoId).toBe("comida-desayuno");
  expect(de.title).toBe("🌅 Desayuno: lo del plan");
  const morning = r.find((x) => x.id.endsWith("2026-10-30-morning"))!;
  expect(morning.body).toMatch(/Tu día ya lo armó Eris: desayuno a las 8:15\./);
  expect(r.some((x) => x.id.endsWith("2026-10-30-meal-desayuno"))).toBe(false);
});
