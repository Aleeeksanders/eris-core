// Comida nombrada por adelantado y comidas de ayer/anteayer por chat (pedido del usuario, 2026-10-16). Memoria simulada.
import { test, expect, setSystemTime, afterAll } from "bun:test";
process.env.TZ = "America/Santiago"; // bun test corre en UTC: pasadas las 21:00 de Chile ya sería mañana
// A mediodía: de madrugada, sin haber dormido, «ayer» es otro día de comida y estas pruebas fallaban según la hora de correrlas
setSystemTime(new Date(2026, 10, 7, 12, 0));
afterAll(() => setSystemTime());
import { mealTimingOf, pastDayOf, pastMealTimingOf } from "C:/Proyectos/eris/src/services/FoodParse.ts";
import { NutritionTool } from "C:/Proyectos/eris/src/tools/NutritionTool.ts";
import { UnifiedFoodService } from "C:/Proyectos/eris/src/services/gluco/UnifiedFoodService.ts";

const at = (h: number, m = 0) => new Date(2026, 9, 16, h, m);

test("una comida que aún no llega se respeta", () => {
  const r = mealTimingOf("Anótame 3 empanadas de queso para la cena", { now: at(11) });
  expect(r.mealType).toBe("cena");
  expect(r.at.getHours()).toBe(21);
  expect(r.at.getDate()).toBe(16);
  expect(r.note).toContain("cena de hoy");
  // «recién / estoy» sigue siendo AHORA: la de esta hora (regla del 10-10)
  expect(mealTimingOf("recién almorcé 2 empanadas", { now: at(10) }).mealType).toBe("desayuno");
  // una que ya pasó sigue a su hora, ≤ ahora
  const d = mealTimingOf("desayuné 2 huevos", { now: at(12) });
  expect(d.mealType).toBe("desayuno");
  expect(d.at.getTime()).toBeLessThanOrEqual(at(12).getTime());
});

test("ayer / anoche / anteayer", () => {
  expect(pastDayOf("ayer cené 2 empanadas")).toEqual({ offset: 1, word: "ayer" });
  expect(pastDayOf("anoche me comí una pizza")?.impliedMeal).toBe("cena");
  expect(pastDayOf("antes de ayer almorcé cazuela")?.offset).toBe(2);
  expect(pastDayOf("el lunes pasado cené")).toBeNull();
  expect(pastDayOf("lo mismo que ayer")).toBeNull();
  const c = pastMealTimingOf("ayer cené 2 empanadas", { offset: 1 }, { now: at(11) })!;
  expect(c.mealType).toBe("cena");
  expect(c.at.getDate()).toBe(15);
  expect(c.at.getHours()).toBe(21);
  expect(pastMealTimingOf("anoche me comí una pizza", { offset: 1, impliedMeal: "cena" }, { now: at(11) })?.mealType).toBe("cena");
  expect(pastMealTimingOf("ayer me comí 2 empanadas", { offset: 1 }, { now: at(11) })).toBeNull();
  const k = pastMealTimingOf("ayer a las 13 me comí 2 empanadas", { offset: 1 }, { now: at(11) })!;
  expect(k.mealType).toBe("almuerzo");
  expect(k.at.getDate()).toBe(15);
  expect(k.at.getHours()).toBe(13);
});

function mk() {
  const store: Record<string, any> = {};
  const rollup: any[] = [{ date: "2026-10-15", calories: 1500, proteinG: 80 }];
  const memory = {
    get: async (k: string) => store[k] ?? null, set: async (k: string, v: any) => { store[k] = v; },
    getProfile: async () => ({ medical: {} }),
    getDailyRollupLog: async () => rollup,
    upsertDailyRollup: async (p: any, date?: string) => { const i = rollup.findIndex((e) => e.date === date); if (i >= 0) rollup[i] = { ...rollup[i], ...p }; else rollup.push({ date, ...p }); },
  };
  const sent: any[] = [];
  return { store, rollup, memory, sent, ws: { send: (s: string) => sent.push(JSON.parse(s)) } };
}
const tool = new NutritionTool();
const fs = new UnifiedFoodService();

test("chat: «ayer cené…» queda en la cena de ayer, en su día", async () => {
  const { store, rollup, memory, sent, ws } = mk();
  const msg = "Ayer cené 2 empanadas de pino";
  const ctx = { memory, userMessage: msg, foodService: fs, wsClient: ws } as any;
  const input = await tool.preroute(msg, ctx);
  expect(input).not.toBeNull();
  const r = await tool.run(input, ctx);
  console.log(r.metadata?.quickReply ?? r.output);
  const y = new Date(); y.setDate(y.getDate() - 1);
  const key = Object.keys(store).find((k) => k.startsWith("nutrition_log_"))!;
  expect(key).toBe(`nutrition_log_${y.toDateString()}`);
  expect(store[key][0].mealType).toBe("cena");
  expect(store[key][0].pastDay).toBe(true);
  expect(String(r.metadata?.quickReply)).toContain("Cena de ayer");
  expect(String(r.metadata?.quickReply)).not.toContain("llevas");
  expect(sent.find((s) => s.type === "nutrition_logged")?.day).toBe(y.toDateString());
  // el historial de ese día se suma (no se pisa)
  const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  const row = rollup.find((e) => e.date === yIso);
  console.log("historial de ayer:", row);
  expect(row.calories).toBeGreaterThan(yIso === "2026-10-15" ? 1500 : 0);
});

test("chat: «ayer me comí…» sin comida → pregunta, y «Cena» lo anota", async () => {
  const { store, memory, ws } = mk();
  const msg = "ayer me comí 2 marraquetas";
  const ctx = { memory, userMessage: msg, foodService: fs, wsClient: ws } as any;
  const input = await tool.preroute(msg, ctx);
  const r = await tool.run(input, ctx);
  const ask = String(r.metadata?.quickReply ?? r.output);
  console.log(ask);
  expect(ask).toContain("¿En qué comida de ayer fue?");
  expect(Object.keys(store).some((k) => k.startsWith("nutrition_log_"))).toBe(false);
  // responde con el botón
  const ctx2 = { memory, userMessage: "Cena", foodService: fs, wsClient: ws, lastAssistantMessage: ask } as any;
  const input2 = await tool.preroute("Cena", ctx2);
  expect((input2 as any)?.fixedMeal).toBe(true);
  const r2 = await tool.run(input2, ctx2);
  console.log(r2.metadata?.quickReply ?? r2.output);
  const key = Object.keys(store).find((k) => k.startsWith("nutrition_log_"))!;
  const y = new Date(); y.setDate(y.getDate() - 1);
  expect(key).toBe(`nutrition_log_${y.toDateString()}`);
  expect(store[key][0].mealType).toBe("cena");
  expect(store[key][0].items[0].grams).toBe(170);
  // un «Cena» suelto otro día no anota nada
  const ctx3 = { memory, userMessage: "Cena", foodService: fs, wsClient: ws, lastAssistantMessage: "Hola" } as any;
  expect(await tool.preroute("Cena", ctx3)).toBeNull();
});

test("chat: «para la cena» por adelantado queda en la cena de hoy", async () => {
  const { store, memory, ws } = mk();
  const now = new Date();
  // solo tiene sentido si la cena todavía no llega (antes de las 19:45)
  if (now.getHours() >= 19 || now.getHours() < 6) { console.log("(hora fuera de rango, se salta)"); return; }
  const msg = "Anótame 2 empanadas de pino para la cena";
  const ctx = { memory, userMessage: msg, foodService: fs, wsClient: ws } as any;
  const r = await tool.run(await tool.preroute(msg, ctx), ctx);
  console.log(r.metadata?.quickReply ?? r.output);
  const key = Object.keys(store).find((k) => k.startsWith("nutrition_log_"))!;
  expect(key).toBe(`nutrition_log_${now.toDateString()}`);
  expect(store[key][0].mealType).toBe("cena");
  expect(new Date(store[key][0].timestamp).getHours()).toBe(21);
});
test("ayer con hora ambigua", () => {
  const n = at(11);
  expect(pastMealTimingOf("ayer a las 8 cené 2 empanadas", { offset: 1 }, { now: n })?.at.getHours()).toBe(20);
  expect(pastMealTimingOf("ayer a las 8 desayuné 2 huevos", { offset: 1 }, { now: n })?.at.getHours()).toBe(8);
  expect(pastMealTimingOf("ayer a las 8 me comí 2 huevos", { offset: 1 }, { now: n })).toBeNull();
  expect(pastMealTimingOf("ayer a las 8 me comí 2 huevos", { offset: 1 }, { now: n, fixedMeal: "cena" })?.at.getHours()).toBe(20);
});
test("chat: «ayer en el almuerzo… y en la cena…» van a ayer", async () => {
  const { store, memory, ws } = mk();
  const msg = "anota que ayer en el almuerzo 2 marraquetas y en la cena un plato de cazuela de pollo";
  const ctx = { memory, userMessage: msg, foodService: fs, wsClient: ws } as any;
  const input: any = await tool.preroute(msg, ctx);
  expect(input?.multi?.length).toBe(2);
  const r = await tool.run(input, ctx);
  console.log(r.metadata?.quickReply ?? r.output);
  const y = new Date(); y.setDate(y.getDate() - 1);
  const log = store[`nutrition_log_${y.toDateString()}`];
  expect(log?.map((e: any) => e.mealType)).toEqual(["almuerzo", "cena"]);
  expect(Object.keys(store).filter((k) => k.startsWith("nutrition_log_")).length).toBe(1);
});
