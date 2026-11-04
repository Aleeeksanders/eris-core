import { test, expect } from "bun:test";
import { parseMultiMealMessage, parseFoodMessage } from "C:/Proyectos/eris/src/services/FoodParse.ts";
import { UnifiedFoodService } from "C:/Proyectos/eris/src/services/gluco/UnifiedFoodService.ts";
const fs = new UnifiedFoodService("");
const lookup = async (q: string) => fs.searchLocal(q);
const at = (h: number) => new Date(2026, 9, 16, h, 0);
const M = (msg: string, h = 21) => parseMultiMealMessage(msg, lookup, at(h));
const show = (r: any) => r?.multi.map((m: any) => `${m.mealType}: ${m.items.map((i: any) => `${i.name}=${i.grams}`).join(" | ")}`).join(" // ");

test("el caso del banco de pruebas: cantidad sola hereda el alimento", async () => {
  const r = await M("Anótame 3 empanadas de queso para la cena y una para la once");
  console.log(show(r), r?.multi.map((m) => m.said));
  expect(r?.multi.map((m) => m.mealType)).toEqual(["cena", "once"]);
  expect(r!.multi[0].items[0].grams).toBe(r!.multi[1].items[0].grams * 3);
  expect(r!.multi[1].said).toContain("para la once");
});
test("comida antes de los alimentos", async () => {
  const r = await M("registra en el desayuno 2 huevos duros y en el almuerzo un plato de cazuela de pollo");
  console.log(show(r));
  expect(show(r)).toBe("desayuno: Huevo duro=100 // almuerzo: Cazuela de pollo=450");
});
test("con verbos de comida", async () => {
  const r = await M("anota que desayuné 2 marraquetas y almorcé un plato de cazuela de pollo");
  console.log(show(r));
  expect(r?.multi.map((m) => m.mealType)).toEqual(["desayuno", "almuerzo"]);
});
test("ante la duda, null", async () => {
  for (const m of [
    "registra 2 marraquetas para el almuerzo",                         // una sola comida: parseFoodMessage
    "anota 2 marraquetas sin mantequilla para el desayuno y una para la once", // «sin»
    "¿qué como en la once y en la cena?",                              // pregunta
    "el lunes pasado comí 2 marraquetas en el almuerzo y una en la once", // más atrás que anteayer: en la app
    "anota harto pan para el desayuno y una para la once",            // cantidad vaga
    "anota 2 zucaritas para el desayuno y una manzana para la once",  // un tramo que no se entiende
  ]) {
    const r = await M(m);
    if (r) console.log("NO DEBERÍA:", m, show(r));
    expect(r).toBeNull();
  }
});
test("una sola comida sigue igual", async () => {
  const r = await parseFoodMessage("registra 2 marraquetas para el almuerzo", lookup, at(13));
  expect(r?.mealType).toBe("almuerzo");
});
