// 2026-10-21, revisión de los chats reales: corregir la cantidad, la ayuda del buscador, el registro por comida y los platos nuevos.
import { test, expect } from "bun:test";
import { parseAmountFix } from "C:/Proyectos/eris/src/services/FoodParse.ts";
import { NutritionTool } from "C:/Proyectos/eris/src/tools/NutritionTool.ts";
import { UnifiedFoodService } from "C:/Proyectos/eris/src/services/gluco/UnifiedFoodService.ts";
import { resolveFood } from "C:/Proyectos/eris/src/services/FoodResolve.ts";
const fs = new UnifiedFoodService("");
const CONF = "✅ **🌙 Cena registrada**\n\n• **Carne Mongoliana** (150 g) — 174 kcal\n\n**Total:** 174 kcal | Prot: 12,6 g";
const mem = () => {
  const m = new Map<string, any>();
  return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { m.set(k, v); }, getProfile: async () => ({}) };
};

test("«Son 250g, no 150g» después de anotar un alimento: ese alimento, esa comida, la cantidad nueva", () => {
  expect(parseAmountFix("Son 250g, no 150g", CONF)).toEqual({ name: "Carne Mongoliana", grams: 250, from: 150, unit: "g", mealType: "cena" });
  for (const m of ["eran 250 gramos", "fueron 250g", "250g no 150g", "no 150 sino 250 g", "En realidad son 250 g"]) expect(parseAmountFix(m, CONF)?.grams).toBe(250);
  // no es una corrección
  for (const m of ["son las 8", "¿son 250 g?", "son 150 g", "registra 250 g de arroz"]) expect(parseAmountFix(m, CONF)).toBeNull();
  // con varios alimentos en la confirmación no se sabe cuál: lo decide el modelo
  expect(parseAmountFix("son 250 g", CONF + "\n• **Arroz blanco cocido** (150 g) — 194 kcal")).toBeNull();
  expect(parseAmountFix("son 250 g", "Hola, ¿cómo estás?")).toBeNull();
});

test("la corrección borra lo último y anota el mismo alimento con la cantidad nueva", async () => {
  const memory = mem(); const sent: any[] = [];
  const ws = { send: (x: string) => sent.push(JSON.parse(x)) };
  const t = new NutritionTool();
  const ctx = { memory, wsClient: ws, foodService: fs };
  const first: any = await t.execute({ action: "log_meal", items: [{ name: "carne mongoliana", grams: 150 }], mealType: "cena", fixedMeal: true } as any, { ...ctx, userMessage: "anota 150 g de carne mongoliana para la cena" });
  const conf = String(first.metadata?.quickReply ?? first.output);
  console.log(conf.split("\n").slice(0, 4).join(" | "));
  const input = await t.preroute("Son 250g, no 150g", { ...ctx, lastAssistantMessage: conf });
  expect(input).toMatchObject({ action: "log_meal", mealType: "cena", replaceLast: { grams: 250, from: 150 } });
  const r: any = await t.execute(input as any, { ...ctx, userMessage: "Son 250g, no 150g" });
  console.log(String(r.metadata?.quickReply ?? r.output).split("\n").slice(0, 6).join(" | "));
  expect(String(r.output)).toContain("✏️ Corregí Carne mongoliana: 150 g → 250 g");
  expect(String(r.output)).toMatch(/Carne mongoliana\*\* \(250 g\)/);
  expect(String(r.output)).not.toMatch(/pollo/i);
  const day = [...memory.m.keys()].find((k) => k.startsWith("nutrition_log_"))!;
  const log = memory.m.get(day);
  expect(log.flatMap((e: any) => e.items.map((i: any) => `${i.name}=${i.grams}`))).toEqual(["Carne mongoliana=250"]);
  expect(sent.some((x) => x.type === "nutrition_entry_deleted")).toBe(true);
});

test("platos nuevos: carne mongoliana de verdad (no el envasado) y arrollado primavera", async () => {
  const c: any = await resolveFood(fs as any, "carne mongoliana");
  expect(c.name).toBe("Carne mongoliana");
  const a: any = await resolveFood(fs as any, "arrollados primavera");
  expect(a?.name).toBe("Arrollado primavera");
});

test("ayuda del buscador: se intenta anotar por código; si no está, respuesta honesta al tiro", async () => {
  const t = new NutritionTool();
  const memory = mem();
  const input = await t.preroute("Quiero anotar «Keto chicken melt Starbucks» y no lo encontré en el buscador. ¿Me ayudas?", { memory, foodService: fs });
  expect(input).toMatchObject({ action: "log_meal", items: [{ name: "Keto chicken melt Starbucks" }], quickNotFound: true });
  const r: any = await t.execute(input as any, { memory, foodService: fs, userMessage: "Quiero anotar «Keto chicken melt Starbucks» y no lo encontré en el buscador. ¿Me ayudas?" });
  expect(r.metadata.quickReply).toContain("dime sus calorías y proteínas por porción");
  // si está en la base, se anota
  const ok: any = await t.execute((await t.preroute("Quiero anotar «arrollado primavera» y no lo encontré en el buscador. ¿Me ayudas?", { memory, foodService: fs })) as any, { memory, foodService: fs, userMessage: "x" });
  expect(String(ok.output)).toContain("Arrollado primavera");
});

test("registro de hoy: una sección por comida aunque la app mande alimento por alimento", async () => {
  const memory = mem();
  const t = new NutritionTool();
  const ctx = { memory, foodService: fs };
  for (const name of ["huevo duro", "queso mantecoso", "marraqueta"]) await t.execute({ action: "log_meal", items: [{ name }], mealType: "desayuno", fixedMeal: true } as any, { ...ctx, userMessage: `anota ${name} para el desayuno` });
  const r: any = await t.execute({ action: "get_daily_log" } as any, { ...ctx, userMessage: "¿qué he comido hoy?" });
  const txt = String(r.metadata?.quickReply ?? r.output);
  console.log(txt.split("\n").slice(0, 8).join(" | "));
  expect((txt.match(/🌅 Desayuno/g) || []).length).toBe(1);
  expect((txt.match(/^  • /gm) || []).length).toBe(3);
});

test("«Te faltó la carne molida, unos 150 g» después de anotar el almuerzo: a esa comida, por código", async () => {
  const { addToLastMeal } = await import("C:/Proyectos/eris/src/services/FoodParse.ts");
  const CONF2 = "✅ **☀️ Almuerzo registrado**\n\n• **Fideos con salsa de tomate** (300 g) — 360 kcal";
  expect(addToLastMeal("Te faltó la carne molida, unos 150 g", CONF2)).toEqual({ text: "anota 150 g de carne molida para el almuerzo", mealType: "almuerzo" });
  expect(addToLastMeal("también un vaso de jugo", CONF2)?.mealType).toBe("almuerzo");
  expect(addToLastMeal("¿te faltó algo?", CONF2)).toBeNull();
  expect(addToLastMeal("Te faltó la carne molida", "Hola")).toBeNull();
  const t = new NutritionTool();
  const input: any = await t.preroute("Te faltó la carne molida, unos 150 g", { foodService: fs, lastAssistantMessage: CONF2 });
  expect(input).toMatchObject({ action: "log_meal", mealType: "almuerzo" });
  expect(input.items[0].grams).toBe(150);
  expect(String(input.items[0].name).toLowerCase()).toContain("carne molida");
});
