// Eris al timón · T0: el plan del día en 3 caminos (DayPlan) y el chat (DayPlanTool).
import { test, expect } from "bun:test";
process.env.TZ = "America/Santiago";
import { gatherDayPlanInput, buildDayPlan, parseNota, previewText, planText, swapMeal, type DayPlanInput, type DayPlan } from "C:/Proyectos/eris/src/services/DayPlan.ts";
import { pantryFrom } from "C:/Proyectos/eris/src/services/HomePantry.ts";
import { DayPlanTool, TIMON_ASK } from "C:/Proyectos/eris/src/tools/DayPlanTool.ts";

const NOW = new Date(2026, 9, 29, 11, 0);
const fakeMemory = (conditions: string[] = [], extra: Record<string, any> = {}) => {
  const m = new Map<string, any>(Object.entries(extra));
  return {
    m,
    get: async (k: string) => (m.has(k) ? m.get(k) : null),
    set: async (k: string, v: any) => { m.set(k, v); },
    getProfile: async () => ({ name: "Alex", medical: { conditions: conditions.map((id) => ({ id })) } }),
  };
};
const pantry = pantryFrom({ items: [
  { nombre: "Pechuga de pollo", area: "alimentos", cantidad: 2 }, { nombre: "Arroz", area: "despensa", cantidad: 1 },
  { nombre: "Huevos", area: "alimentos", cantidad: 12 }, { nombre: "Yogur natural", area: "alimentos", cantidad: 2, vence: "2026-10-30" },
  { nombre: "Lechuga", area: "alimentos", cantidad: 1 }, { nombre: "Plátano", area: "alimentos", cantidad: 4 }, { nombre: "Avena", area: "despensa", cantidad: 1 },
] }, "2026-10-29T09:00:00", NOW);
async function base(conditions: string[] = [], over: Partial<DayPlanInput> = {}): Promise<DayPlanInput> {
  const i = await gatherDayPlanInput(fakeMemory(conditions), NOW);
  return { ...i, pantry, ...over };
}
const sleep: any = { nights: 10, need: 7.5, debtH: 0, bedtime: { target: 24.25, from: 23.75, to: 24.75, wake: 7.75, napShiftMin: 0 }, caffeineUntil: 18.25 };
const training = { rest: false, name: "Día A: Empuje", items: [{ name: "Press de banca", text: "3×6–8 · 62,5 kg" }, { name: "Fondos", text: "3×8–10" }, { name: "Press militar", text: "3×8" }, { name: "Tríceps", text: "3×12" }], doneSets: 0 };
const step = (p: DayPlan, id: string) => p.pasos.find((s) => s.id === id);

test("el día por defecto: las comidas que quedan con lo que hay en casa, lo que vence primero, sueño y orden", async () => {
  const i = await base([], { sleep, training });
  // el desayuno todavía está a tiempo a las 11, pero desde ahora (no a su hora típica, que ya pasó)
  expect(i.slots.every((s) => s.hora >= 11)).toBe(true);
  const p = buildDayPlan(i, "optimo");
  const al = step(p, "comida-almuerzo")!;
  expect(al.accion.type).toBe("log_food");
  const ids = new Set(pantry!.frags.length ? (al.accion as any).opciones[0].map((f: any) => f.id) : []);
  expect(ids.size).toBeGreaterThan(0);
  expect(step(p, "casa")!.detalle).toMatch(/Yogur.*vence pronto/i);
  expect(step(p, "sueno")!.titulo).toBe("😴 A la cama entre las 23:45 y las 00:45");
  // lo de todo el día arriba, después por hora
  const horas = p.pasos.filter((s) => s.hora != null).map((s) => s.hora!);
  expect([...horas].sort((a, b) => a - b)).toEqual(horas);
  expect(planText(p)).toMatch(/^🧭 Tu día en modo \*\*Óptimo\*\*/);
});

test("los 3 caminos: estricto sin gusto ni colación, flexible con un gusto; las kcal dentro de lo seguro", async () => {
  const i = await base([], { sleep, training, targets: { kcal: 2400, proteinG: 140, proteinMax: 170, goal: "perder" } });
  const e = buildDayPlan(i, "estricto"), o = buildDayPlan(i, "optimo"), f = buildDayPlan(i, "flexible");
  expect(e.kcal).toBe(2280);           // −5 % (máx. 150) por bajar de peso
  expect(o.kcal).toBe(2400);
  expect(f.kcal).toBe(2600);           // + el gusto
  expect(step(f, "gusto")!.detalle).toMatch(/15 min de caminata/);
  expect(step(e, "gusto")).toBeUndefined();
  // con 7 h entre el almuerzo y la cena, la colación va también en Estricto; con 4 h y media, no
  expect(step(e, "comida-colacion_pm")).toBeDefined();
  const corto = { ...i, slots: [{ slot: "almuerzo", hora: 14 }, { slot: "colacion_pm", hora: 16.5 }, { slot: "once", hora: 18.5 }], allSlots: ["desayuno", "almuerzo", "colacion_pm", "once"] };
  expect(step(buildDayPlan(corto, "estricto"), "comida-colacion_pm")).toBeUndefined();
  expect(step(buildDayPlan(corto, "optimo"), "comida-colacion_pm")).toBeDefined();
  expect(step(o, "comida-colacion_pm")).toBeDefined();
  expect(e.proteinG).toBe(154);        // proteína arriba (×1,1, sin pasar el máximo)
  const t = previewText(i);
  expect(t).toMatch(/• \*\*Estricto\*\*: 2\.280 kcal · Día A: Empuje|• \*\*Estricto\*\*: 2\.280 kcal · Empuje/);
  expect(t).toMatch(/\[Opción: Otro\]$/);
});

test("entreno según cómo durmió: «liviano» manda sobre Estricto; Flexible camina", async () => {
  const ready: any = { level: "liviano", why: "Dormiste 4 h 36.", tip: "Hoy conviene algo suave…" };
  const i = await base([], { training, ready });
  const e = step(buildDayPlan(i, "estricto"), "entreno")!;
  expect(e.accion).toEqual({ type: "load_routine", deload: true, shorter: false });
  expect(e.detalle).toMatch(/Dormiste 4 h 36/);
  expect(step(buildDayPlan(i, "flexible"), "entreno")!.accion).toEqual({ type: "walk", minutes: 30 });
  // bien dormido: estricto completa; flexible versión corta
  const j = await base([], { training, ready: { level: "normal", why: "", tip: "" } as any });
  expect(step(buildDayPlan(j, "estricto"), "entreno")!.detalle).toMatch(/Completa, como dice tu rutina/);
  expect(step(buildDayPlan(j, "flexible"), "entreno")!.accion).toEqual({ type: "load_routine", deload: false, shorter: true });
  // dijo que descansa: se respeta en todos los caminos
  expect(step(buildDayPlan({ ...j, intent: { answer: "no" } }, "estricto"), "entreno")!.accion.type).toBe("rest");
  // día de descanso de la rutina: estricto camina, óptimo descansa
  const r = { ...j, training: { ...training, rest: true, items: [] } };
  expect(step(buildDayPlan(r, "estricto"), "entreno")!.accion).toEqual({ type: "walk", minutes: 30 });
  expect(step(buildDayPlan(r, "optimo"), "entreno")!.accion.type).toBe("rest");
});

test("plata: un tope por camino (nunca mueve plata); sin cuentas, sin tope", async () => {
  const i = await base([], { finance: { porDia: 10000, libre: 200000 } });
  expect(step(buildDayPlan(i, "estricto"), "plata")!.titulo).toBe("💸 Hoy, hasta $7.000");
  expect(step(buildDayPlan(i, "optimo"), "plata")!.titulo).toBe("💸 Hoy, hasta $10.000");
  expect(step(buildDayPlan(i, "flexible"), "plata")!.titulo).toBe("💸 Hoy, hasta $15.000");
  expect(step(buildDayPlan({ ...i, finance: null }, "optimo"), "plata")).toBeUndefined();
  expect(step(buildDayPlan({ ...i, finance: { porDia: null, libre: -5000 } }, "optimo"), "plata")!.titulo).toBe("💸 Hoy, solo lo esencial");
  // a un día del sueldo «por día» es toda la plata libre: sin tope absurdo
  const pronto = step(buildDayPlan({ ...i, finance: { porDia: 408000, libre: 408000 } }, "estricto"), "plata")!;
  expect(pronto.titulo).toBe("💸 Hoy, solo lo necesario");
  expect(pronto.detalle).toMatch(/Te pagan pronto/);
});

test("con diabetes no se salta ninguna comida (colaciones incluidas aun en Estricto); renal sin meta de proteína", async () => {
  const d = await base(["diabetes_t2"], { training });
  expect(d.diabetic).toBe(true);
  const e = buildDayPlan(d, "estricto");
  expect(step(e, "comida-colacion_pm")).toBeDefined();
  expect(e.kcal).toBe(d.targets.kcal);  // sin recorte: no cambiar lo que su tratamiento espera
  const r = await base(["ckd"]);
  expect(r.renal).toBe(true);
  expect(buildDayPlan(r, "estricto").proteinG).toBeNull();
});

test("«Otro»: la nota por código", () => {
  expect(parseNota("hoy almuerzo afuera con la pega").ajustes.afuera).toEqual(["almuerzo"]);
  expect(parseNota("ceno con mi familia afuera").ajustes.afuera).toEqual(["cena"]);
  expect(parseNota("estoy sin plata hasta el viernes").ajustes.sinPlata).toBe(true);
  expect(parseNota("ando pato").ajustes.sinPlata).toBe(true);
  expect(parseNota("estoy resfriado").ajustes.enfermo).toBe(true);
  expect(parseNota("me duele la rodilla").ajustes.dolor).toBe("rodilla");
  expect(parseNota("no tengo tiempo, día full pega").ajustes.sinTiempo).toBe(true);
  expect(parseNota("tengo un cumpleaños en la noche").ajustes.evento).toEqual({ que: "cumpleaños", hora: 21 });
  expect(parseNota("asado a las 8").ajustes.evento).toEqual({ que: "asado", hora: 20 });
  expect(parseNota("quiero algo distinto").leida).toBe(false);
});

test("la nota cambia el día: afuera, evento, enfermo, dolor, sin plata", async () => {
  const i = await base([], { training, ready: { level: "normal", why: "", tip: "" } as any, finance: { porDia: 10000, libre: 100000 } });
  const af = buildDayPlan(i, "optimo", "hoy almuerzo afuera");
  expect(step(af, "comida-almuerzo")!.titulo).toBe("☀️ Almuerzo afuera");
  expect(step(af, "comida-almuerzo")!.accion.type).toBe("info");
  const ev = buildDayPlan(i, "optimo", "cumpleaños en la noche");
  expect(step(ev, "comida-cena")!.titulo).toBe("🎉 Cumpleaños");
  expect(step(buildDayPlan(i, "estricto", "estoy con fiebre"), "entreno")!.accion.type).toBe("rest");
  expect(step(buildDayPlan(i, "optimo", "me duele la rodilla"), "entreno")!.detalle).toMatch(/Nada que cargue la rodilla/);
  expect(step(buildDayPlan(i, "optimo", "sin plata"), "plata")!.titulo).toBe("💸 Hoy, hasta $5.000");
  const raro = buildDayPlan(i, "optimo", "quiero algo distinto");
  expect(planText(raro)).toMatch(/todavía no sé ajustar el plan a eso/);
});

test("ya comió todo: lo dice; la nota sobre una comida ya anotada se aclara", async () => {
  const i = await base();
  const lleno = { ...i, slots: [], ctx: { ...i.ctx, eaten: { ...i.ctx.eaten, kcal: i.targets.kcal } } };
  const p = buildDayPlan(lleno, "optimo", "hoy almuerzo afuera");
  expect(step(p, "comida-dia")!.detalle).toMatch(/^Ya llegaste a tu meta de hoy/);
  expect(planText(p)).toMatch(/\(Almuerzo: el de hoy ya está anotado, así que no lo cambié\.\)/);
  const medio = { ...i, slots: [], ctx: { ...i.ctx, eaten: { ...i.ctx.eaten, kcal: 900 } } };
  expect(step(buildDayPlan(medio, "optimo"), "comida-dia")!.detalle).toMatch(/^Tus comidas de hoy ya están anotadas; te quedan ~/);
});

test("otra opción para una comida", async () => {
  const p = buildDayPlan(await base(), "optimo");
  const al = step(p, "comida-almuerzo")!;
  if ((al.accion as any).opciones.length < 2) return; // con la despensa de prueba puede haber una sola
  const r = swapMeal(p, "almuerzo")!;
  expect((r.paso.accion as any).alt).toBe(1);
  expect(r.paso.detalle).not.toBe(al.detalle);
});

test("chat: qué frases arman el día y cuáles no", async () => {
  for (const q of ["que me recomiendas hoy", "decide tu", "toma el control", "que recomienda eris", "armame mi dia", "lo que tu quieras"]) expect(TIMON_ASK.test(q)).toBe(true);
  const tool = new DayPlanTool();
  const mem = fakeMemory();
  expect(await tool.preroute("¿Qué me recomiendas hoy?", { memory: mem })).toEqual({ action: "preview" });
  expect(await tool.preroute("¿Qué me recomiendas comer?", { memory: mem })).toBeNull();
  expect(await tool.preroute("Estricto", { memory: mem })).toBeNull();          // sin haber preguntado
  expect(await tool.preroute("modo flexible", { memory: mem })).toEqual({ action: "build", mode: "flexible" });
  await mem.set("day_plan_pending", { awaiting: "modo", at: new Date().toISOString() });
  expect(await tool.preroute("Óptimo", { memory: mem })).toEqual({ action: "build", mode: "optimo" });
  expect(await tool.preroute("el permisivo", { memory: mem })).toEqual({ action: "build", mode: "flexible" });
  expect(await tool.preroute("Otro", { memory: mem })).toEqual({ action: "otro" });
  await mem.set("day_plan_pending", { awaiting: "nota", at: new Date().toISOString() });
  // revisión V1 (C2): solo si lo último que dijo Eris fue «Cuéntame tu caso»
  expect(await tool.preroute("Hoy almuerzo afuera", { memory: mem, lastAssistantMessage: "Cuéntame tu caso en una frase y armo el día con eso." })).toEqual({ action: "build", mode: "optimo", nota: "Hoy almuerzo afuera" });
  expect(await tool.preroute("Hoy almuerzo afuera", { memory: mem, lastAssistantMessage: "Listo, anoté tu almuerzo." })).toBeNull();
  expect(await tool.preroute("¿Qué tengo para hoy?", { memory: fakeMemory() })).toBeNull(); // eso es la agenda
});
