// «Eris como Jarvis» (2026-10-23): lo que se arregló con el banco de 28 preguntas del día a día, por código.
import { test, expect } from "bun:test";
process.env.TZ = "America/Santiago";
import { parseSupplementMessage } from "C:/Proyectos/eris/src/services/SupplementParse.ts";
import * as SUP from "C:/Proyectos/eris/src/services/SupplementCore.ts";
import { mentionedMeals, pastDayOf, pastMealTimingOf, clockTimeOf } from "C:/Proyectos/eris/src/services/FoodParse.ts";
import { parseWeightGoal, planWeightGoal, weightGoalText } from "C:/Proyectos/eris/src/services/WeightGoal.ts";
import { MetabolicAdvisorTool } from "C:/Proyectos/eris/src/tools/MetabolicAdvisorTool.ts";
import { DayAgendaTool } from "C:/Proyectos/eris/src/tools/DayAgendaTool.ts";
import { TODAY_ASK, NEXT_ASK, PROGRESS_ASK, dayFromQuery, progressReply } from "C:/Proyectos/eris/src/tools/TrainingPlanTool.ts";
import { parseFinanceMessage } from "C:/Proyectos/eris/src/services/FinanceParse.ts";
import { parseInventoryMessage } from "C:/Proyectos/eris/src/services/InventoryParse.ts";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

test("suplementos: varios a la vez; «¿cuánta proteína me falta?» no es la ficha", () => {
  const S = SUP.emptySupState(); let i = 1;
  SUP.agregarSup(S, { nombre: "Creatina monohidratada", cantidad: 5 }, { now: new Date(), newId: () => `s${i++}` });
  SUP.agregarSup(S, { nombre: "Omega 3", cantidad: 1, unidad: "cápsula", tomasDia: 2 }, { now: new Date(), newId: () => `s${i++}` });
  expect(parseSupplementMessage("Me tomé la creatina y una de omega", S)).toMatchObject({ action: "tomar", sups: ["creatina", "omega"] });
  expect(parseSupplementMessage("Me tomé la creatina", S)).toEqual({ action: "tomar", sup: "creatina" });
  expect(parseSupplementMessage("Me tomé la creatina y un café", S)).toBeNull();
  expect(parseSupplementMessage("¿Cuánta proteína me falta hoy y qué tengo en la casa para completarla?", S)).toBeNull();
  expect(parseSupplementMessage("¿Sirve la proteína en polvo?", S)).toMatchObject({ action: "ficha" });
});

test("«a la once» es la comida, «a la una» es la hora", () => {
  const now = new Date(2026, 9, 23, 15);
  expect(mentionedMeals("Ayer a la once me comí 2 empanadas de pino", now)).toEqual(["once"]);
  expect(pastMealTimingOf("Ayer a la once me comí 2 empanadas de pino", pastDayOf("Ayer a la once me comí 2 empanadas de pino")!, { now })?.mealType).toBe("once");
  expect(clockTimeOf("a la una comí arroz", now)?.getHours()).toBe(13);
  expect(clockTimeOf("a las once comí pan", now)?.getHours()).toBe(11);
});

test("meta de peso: ritmo seguro, déficit con su mantención y la fecha realista si es muy rápido", () => {
  const now = new Date(2026, 9, 23, 12);
  const g = parseWeightGoal("Quiero bajar 3 kilos para diciembre, ¿qué hago?", now)!;
  expect(g).toMatchObject({ dir: "bajar", kg: 3, byText: "al 1 de diciembre" });
  const p = planWeightGoal(g, { weightKg: 85, sex: "h", bmr: 1890, maintenance: 2930 }, now);
  expect(p.tooFast).toBe(false);
  expect(p.kcalTarget).toBe(2350);
  const txt = weightGoalText(g, p, { weightKg: 85, goal: "recomp", forgeKcal: 2680, diabetes: true });
  expect(txt).toContain("déficit de ~580 kcal");
  expect(txt).toContain("Forge › Personaje › Cuerpo y metas");
  expect(txt).not.toMatch(/ayuno|1\.000 kcal/);
  const rapido = planWeightGoal(parseWeightGoal("quiero perder 8 kilos en un mes", now)!, { weightKg: 85, sex: "h", bmr: 1890, maintenance: 2930 }, now);
  expect(rapido.tooFast).toBe(true);
  expect(rapido.realisticDate!.getTime()).toBeGreaterThan(new Date(2027, 0, 1).getTime());
  // piso: nunca bajo el 75 % de la mantención ni bajo el basal
  const piso = planWeightGoal(parseWeightGoal("quiero bajar 4 kilos en 3 semanas", now)!, { weightKg: 60, sex: "m", bmr: 1350, maintenance: 1800 }, now);
  expect(piso.kcalTarget!).toBeGreaterThanOrEqual(1350);
  expect(parseWeightGoal("bajé 3 kilos este mes", now)).toBeNull();
});

test("el asesor toma la meta de peso, la proteína que falta, «sin ganas de cocinar» y «qué me conviene cenar»", async () => {
  const store: Record<string, any> = {};
  const memory = { get: async (k: string) => store[k] ?? null, set: async (k: string, v: any) => { store[k] = v; } };
  const A = new MetabolicAdvisorTool();
  expect(await A.preroute("Quiero bajar 3 kilos para diciembre, ¿qué hago?", { memory })).toEqual({ focus: "meta_peso" });
  expect(await A.preroute("¿Cuánta proteína me falta hoy y qué tengo en la casa para completarla?", { memory })).toMatchObject({ focus: "comida", ideas: true, proteina: true });
  expect(await A.preroute("Estoy cansado y no tengo ganas de cocinar, ¿qué como?", { memory })).toMatchObject({ no_cook: true, en_casa: true, ideas: true });
  expect(await A.preroute("Estoy en la pega y no puedo cocinar, ¿qué como?", { memory })).toMatchObject({ no_cook: true });
  expect((await A.preroute("Estoy en la pega y no puedo cocinar, ¿qué como?", { memory }) as any).en_casa).toBeUndefined();
  expect(await A.preroute("Con mi diabetes, ¿qué me conviene cenar hoy?", { memory })).toMatchObject({ ideas: true });
  expect(await A.preroute("¿Qué cocino con eso?", { memory })).toMatchObject({ ideas: true });
  expect(await A.preroute("¿Qué cocino con eso?", { memory, lastAssistantMessage: "⏳ **Por vencer:**\n· Pechuga de pollo: vence mañana" })).toMatchObject({ usar_pronto: true });
  // «voy al gym en 20 min» y luego «¿qué me conviene cenar?»: la cena no hereda el pre-entreno
  await A.preroute("Voy al gym en 20 minutos, ¿qué como?", { memory });
  expect(await A.preroute("proponme opciones", { memory })).toMatchObject({ focus: "pre_entreno" }); // lo genérico sí hereda
  await A.preroute("Voy al gym en 20 minutos, ¿qué como?", { memory });
  expect(await A.preroute("Con mi diabetes, ¿qué me conviene cenar hoy?", { memory })).toMatchObject({ focus: "comida" });
});

test("entreno: qué toca hoy, cuándo toca un día y qué tan fuerte estoy", () => {
  for (const m of ["¿Qué me toca hoy en el gym?", "que entreno hoy", "mi rutina de hoy"]) expect([m, TODAY_ASK.test(fold(m))]).toEqual([m, true]);
  expect(TODAY_ASK.test(fold("Dormí mal, ¿igual entreno hoy?"))).toBe(false);
  expect(NEXT_ASK.test(fold("¿Qué día es mi próximo entrenamiento de tirón?"))).toBe(true);
  for (const m of ["¿Qué tan fuerte estoy en press de banca?", "¿cómo voy en el gym?", "mis récords"]) expect([m, PROGRESS_ASK.test(fold(m).replace(/[¿?]/g, ""))]).toEqual([m, true]);
  const r = { days: [{ id: "A", name: "Día 1 — Empuje" }, { id: "B", name: "Día 2 — Tirón" }, { id: "C", name: "Día 3 — Pierna y combate" }] };
  expect(dayFromQuery(r, fold("¿cuándo me toca tirón?"))?.id).toBe("B");
  expect(dayFromQuery(r, fold("¿cuándo me toca pierna?"))?.id).toBe("C");
  expect(dayFromQuery(r, fold("¿cuándo es el día 1?"))?.id).toBe("A");
  const p = { score: 45, lifts: [{ name: "Press de banca", e1rm: 93.3, level: "Novato", pct: 37 }, { name: "Dominadas", e1rm: 133.3, level: "Intermedio", pct: 60 }],
    records: [{ name: "Press de banca (barra)", text: "70 kg × 8", day: "2026-10-21" }], month: { sessions: 13, prev: 2, streak: 0 } };
  expect(progressReply(p, fold("¿qué tan fuerte estoy en press de banca?"))).toMatch(/Press de banca.*~93,3 kg.*Novato/);
  expect(progressReply(p, fold("¿cómo voy en el gym?"))).toMatch(/Dominadas: ~133,3 kg de máximo estimado contando tu peso/);
});

test("agenda del día: «¿qué tengo para hoy?» y «planifícame el resto del día»", async () => {
  const D = new DayAgendaTool();
  expect(await D.preroute("Buenos días Eris, ¿qué tengo para hoy?")).toEqual({ resto: false });
  expect(await D.preroute("Planifícame el resto del día")).toEqual({ resto: true });
  expect(await D.preroute("¿Qué me toca hoy en el gym?")).toBeNull();
  expect(await D.preroute("¿Qué me toca hoy?")).toBeNull(); // es de Forge
  expect(TODAY_ASK.test(fold("¿Qué me toca hoy?"))).toBe(true);
  expect(await D.preroute("hoy comí 2 huevos")).toBeNull();
});

test("Finanzas e Inventario del día a día", () => {
  expect(parseFinanceMessage("¿En qué gasté más este mes?")).toMatchObject({ action: "resumen", foco: "categorias" });
  expect(parseFinanceMessage("¿Cuándo me pagan?")).toMatchObject({ action: "resumen", foco: "ingreso" });
  expect(parseInventoryMessage("¿Se me vence algo? ¿Qué hago con eso?")).toMatchObject({ action: "por_vencer" });
  expect(parseInventoryMessage("Hazme la lista del súper")).toMatchObject({ action: "lista" });
});
