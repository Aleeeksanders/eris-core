// 2026-11-15, almuerzo real: «Comí tallarines con salsa y carne molida para el almuerzo, tenía pimentón, anotalo porfis»
// quedó como 100 g de carne molida (250 kcal, 0 g de carbohidratos). La lista de respaldo calzaba con cualquier nombre que
// CONTUVIERA «carne molida», el plato no tenía ese nombre en la base, el modelo puso 100 g sin que la persona dijera cuánto
// y el pimentón no se anotó (el almuerzo quedó «sin verduras»).
import { test, expect } from "bun:test";
import { NutritionTool, lookupMacros, sinCantidad } from "C:/Proyectos/eris/src/tools/NutritionTool.ts";
import { UnifiedFoodService } from "C:/Proyectos/eris/src/services/gluco/UnifiedFoodService.ts";
import { resolveFood } from "C:/Proyectos/eris/src/services/FoodResolve.ts";
const fs = new UnifiedFoodService("");
const mem = () => {
  const m = new Map<string, any>();
  return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { m.set(k, v); }, getProfile: async () => ({}) };
};
const anotar = async (userMessage: string, items: any[]) => {
  const memory = mem();
  const r: any = await new NutritionTool().execute({ action: "log_meal", items, mealType: "almuerzo" } as any, { memory, wsClient: { send() {} }, foodService: fs, userMessage } as any);
  const day = [...memory.m.keys()].find((k) => k.startsWith("nutrition_log_"));
  return { out: String(r.metadata?.quickReply ?? r.output), items: day ? memory.m.get(day).flatMap((e: any) => e.items) : [] };
};
const MSG = "Comí tallarines con salsa y carne molida para el almuerzo, tenía pimentón, anotalo porfis";

test("el almuerzo real: un plato de tallarines con salsa bolognesa y el pimentón que llevaba", async () => {
  for (const items of [[{ name: "tallarines con salsa y carne molida" }], [{ name: "tallarines con salsa y carne molida", grams: 100 }]]) {
    const r = await anotar(MSG, items);
    expect(r.items.map((i: any) => `${i.name}=${i.grams}`)).toEqual(["Tallarines con salsa bolognesa=380", "Pimentón=30"]);
    const carbs = r.items.reduce((a: number, i: any) => a + i.carbs, 0);
    expect(carbs).toBeGreaterThan(60); // eran 0 g
    expect(r.out).toContain("No dijiste cuánto: anoté 1 plato de Tallarines con salsa bolognesa (380 g)");
    expect(r.out).toMatch(/Sumé (pimentón que dijiste que llevaba|lo que dijiste que llevaba: pimentón) \(~30 g/);
  }
});

test("los nombres del plato que usa la gente llegan al plato (no a la carne molida sola)", async () => {
  for (const n of ["tallarines con salsa y carne molida", "tallarines con carne molida", "fideos con salsa y carne", "spaghetti bolognesa", "espagueti boloñesa"]) {
    const h: any = await resolveFood(fs, n);
    expect(`${n} → ${h?.name}`).toBe(`${n} → Tallarines con salsa bolognesa`);
  }
});

test("la lista de respaldo: solo el mismo alimento, nunca uno que esté dentro del nombre", () => {
  expect(lookupMacros("tallarines con salsa y carne molida")).toBeNull();
  expect(lookupMacros("té")).toBeNull(); // calzaba con «tomate»
  expect(lookupMacros("panqueques")).toBeNull(); // calzaba con «pan»
  expect(lookupMacros("Carne molida")?.cal).toBe(250);
  expect(lookupMacros("pechuga de pollo")?.prot).toBe(23);
  expect(lookupMacros("arroz blanco cocido")?.carbs).toBe(28);
});

test("¿dijo cuánto? Solo entonces valen los gramos que ponga el modelo", async () => {
  expect(sinCantidad(MSG)).toBe(true);
  for (const m of ["almorcé 300 g de tallarines", "comí un plato de tallarines", "comí harto arroz", "media marraqueta"]) expect(sinCantidad(m)).toBe(false);
  const r = await anotar("almorcé 300 g de tallarines con salsa y carne molida", [{ name: "tallarines con salsa y carne molida", grams: 300 }]);
  expect(r.items.map((i: any) => `${i.name}=${i.grams}`)).toEqual(["Tallarines con salsa bolognesa=300"]);
  expect(r.out).not.toContain("No dijiste cuánto");
});

test("la verdura que llevaba: no si dijo «sin», ni si ya está anotada; la salsa de una pasta es la de tomates", async () => {
  const sin = await anotar("comí arroz con pollo sin cebolla", [{ name: "arroz con pollo" }]);
  expect(sin.items.some((i: any) => /cebolla/i.test(i.name))).toBe(false);
  const ya = await anotar("comí ensalada de lechuga con tomate, tenía tomate", [{ name: "lechuga", grams: 80 }, { name: "tomate", grams: 100 }]);
  expect(ya.items.filter((i: any) => /tomate/i.test(i.name)).length).toBe(1);
  const pasta = await anotar("comí fideos con salsa y pollo", [{ name: "fideos con salsa y pollo" }]);
  // el plato de fideos con salsa de la base y el pollo encima (antes «salsa» sola era kétchup)
  expect(pasta.items.map((i: any) => i.name)).toEqual(["Fideos con salsa de tomate", "Pechuga de pollo a la plancha"]);
  expect(pasta.items.some((i: any) => /k[ée]tchup/i.test(i.name))).toBe(false);
});
