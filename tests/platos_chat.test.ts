// Banco de platos dichos en el chat (2026-11-15, PlatoChat). El usuario: «ocurrirá mucho, si es que no va a ser el problema
// más común de nutrición… Eris debe ser capaz de resolver esto sí o sí». Cada mensaje pasa por lo mismo que en el servidor:
// la lectura por código (preroute) y la herramienta; si el código no lo toma, como lo pasaría el modelo (el plato entero, con
// 100 g inventados). Se revisa que se anote, que sea razonable para un plato y lo propio de cada uno.
import { test, expect } from "bun:test";
import { NutritionTool } from "C:/Proyectos/eris/src/tools/NutritionTool.ts";
import { UnifiedFoodService } from "C:/Proyectos/eris/src/services/gluco/UnifiedFoodService.ts";
import { partirPlato, rolDe } from "C:/Proyectos/eris/src/services/PlatoChat.ts";
const fs = new UnifiedFoodService("");
const mem = () => {
  const m = new Map<string, any>();
  return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { m.set(k, v); }, getProfile: async () => ({}) };
};
const t = new NutritionTool();
async function anotar(msg: string) {
  const memory = mem();
  const ctx: any = { memory, wsClient: { send() {} }, foodService: fs, userMessage: msg };
  const pre: any = await t.preroute(msg, ctx).catch(() => null);
  const porCodigo = !!pre && pre.action === "log_meal";
  const input = porCodigo ? pre : {
    action: "log_meal", mealType: "almuerzo",
    items: [{ name: msg.replace(/^(?:me\s+)?(?:comí|almorcé|cené)\s+/i, "").replace(/,?\s*(anotalo|porfis|para el almuerzo)\b.*$/i, "").trim(), grams: 100 }],
  };
  const r: any = await t.execute(input, ctx);
  const day = [...memory.m.keys()].find((k) => k.startsWith("nutrition_log_"));
  const items: any[] = day ? memory.m.get(day).flatMap((e: any) => e.items) : [];
  const tot = items.reduce((a, i) => ({ kcal: a.kcal + i.calories, c: a.c + i.carbs, p: a.p + i.protein, g: a.g + i.grams }), { kcal: 0, c: 0, p: 0, g: 0 });
  return { porCodigo, items, tot, out: String(r.metadata?.quickReply ?? r.output), nombres: items.map((i) => i.name).join(" + ") };
}

// [mensaje, lo que tiene que estar (regex sobre los nombres anotados), kcal mín, kcal máx, ¿con carbohidratos (≥ 25 g)?]
const BANCO: Array<[string, RegExp, number, number, boolean]> = [
  ["Comí tallarines con salsa y carne molida para el almuerzo, tenía pimentón, anotalo porfis", /Tallarines con salsa bolognesa \+ Pimentón/, 450, 900, true],
  ["almorcé arroz con pollo y ensalada", /Pollo con arroz \+ Ensalada/, 400, 800, true],
  ["cené cazuela de vacuno", /Cazuela de vacuno/, 250, 600, true],
  ["comí lentejas con arroz y longaniza", /Guiso de lentejas \+ Arroz.*\+ Longaniza/, 500, 1000, true],
  ["almorcé puré con carne mechada", /Puré de papas \+ Carne mechada/, 300, 700, true],
  ["comí porotos con riendas", /Porotos con riendas/, 250, 600, true],
  ["almorcé pollo asado con papas fritas y ensalada chilena", /Pollo.*papas.*Ensalada chilena/i, 450, 1000, true],
  ["cené fideos con salsa y queso", /Fideos con salsa de tomate \+ Queso/, 300, 700, true],
  ["me comí una hamburguesa con papas fritas", /Hamburguesa.*\+ Papas fritas/, 700, 1300, true],
  ["comí arroz con huevo frito", /Arroz blanco cocido \+ Huevo frito/, 220, 500, true],
  ["almorcé charquicán", /Charquicán/, 250, 600, true],
  ["comí ensalada de lechuga, tomate y palta", /Ensalada de lechuga \+ Tomate \+ Palta/, 80, 300, false],
  ["almorcé un plato de tallarines con carne molida", /Tallarines con salsa bolognesa/, 450, 800, true],
  ["cené 2 platos de cazuela", /Cazuela de vacuno/, 500, 1100, true],
  ["almorcé 400 g de arroz con pollo", /Pollo con arroz/, 450, 750, true],
  ["comí garbanzos con arroz", /Garbanzos cocidos \+ Arroz/, 350, 700, true],
  ["cené tortilla de verduras con arroz", /Tortilla de verduras \+ Arroz/, 350, 700, true],
  ["comí salmón con arroz y ensalada", /Salmón \+ Arroz.*\+ Ensalada/, 450, 800, true],
  ["almorcé reineta con papas cocidas", /Reineta.*\+ Papa cocida/, 200, 500, true],
  ["cené pollo con arroz, tenía zanahoria y arvejas", /Pollo con arroz \+ Zanahoria \+ Arvejas/, 400, 700, true],
  ["comí empanadas de pino", /Empanada de horno/, 350, 700, true],
  ["comí sopaipillas con pebre", /Sopaipilla \+ Pebre/, 100, 400, false],
  ["almorcé arroz con carne y ensalada de tomate", /Arroz.*\+ .*\+ Ensalada chilena/, 300, 650, true],
  ["comí papas con mayo y vienesas", /Papas mayo \+ Vienesa/, 300, 700, true],
  ["cené quesadillas de pollo", /Quesadilla \+ Pollo/, 350, 800, true],
  ["almorcé crema de zapallo y pollo a la plancha", /Crema de zapallo.*\+ .*pollo/i, 250, 600, false],
  ["almorcé pollo al curry con arroz", /Pollo al curry \+ Arroz/, 400, 800, true],
  // platos que faltaban en la base (agregados el 2026-11-15)
  ["almorcé ñoquis con salsa bolognesa", /Ñoquis con salsa de tomate \+ Carne molida/, 450, 800, true],
  ["almorcé un poke de salmón", /Poke bowl de salmón/, 400, 650, true],
  ["cené guiso de porotos verdes", /Guiso de porotos verdes/, 200, 450, true],
  ["anota mi almuerzo: pollo al jugo con puré", /Pollo al jugo \+ Puré/, 450, 750, true],
  ["almorcé milanesa con puré", /Milanesa de vacuno \+ Puré/, 550, 900, true],
  ["cené pasta carbonara", /Pasta a la carbonara/, 450, 750, true],
  ["almorcé fideos con atún", /Fideos.*\+ Atún en agua/, 220, 600, true],
  ["almorcé arroz, pollo y ensalada", /Pollo con arroz \+ Ensalada/, 400, 800, true],
  ["comí medio plato de lentejas", /Guiso de lentejas/, 100, 250, false],
  ["almorcé espaguetis a la bolognesa", /Tallarines con salsa bolognesa/, 450, 800, true],
  ["almorcé lomo a lo pobre", /Lomo a lo pobre/, 900, 1800, true],
];

test("el banco de platos: todos se anotan, razonables para un plato y con lo propio de cada uno", async () => {
  const malos: string[] = [];
  let porCodigo = 0;
  for (const [msg, re, min, max, carbos] of BANCO) {
    const r = await anotar(msg);
    if (r.porCodigo) porCodigo++;
    const ok = r.items.length > 0 && re.test(r.nombres) && r.tot.kcal >= min && r.tot.kcal <= max && (!carbos || r.tot.c >= 25);
    if (!ok) malos.push(`${msg} → ${r.nombres || r.out.split("\n")[0]} (${r.tot.kcal} kcal, C ${Math.round(r.tot.c)} g)`);
  }
  expect(malos).toEqual([]);
  // casi todo sin pasar por el modelo (más rápido y sin gramos inventados)
  expect(porCodigo).toBeGreaterThanOrEqual(BANCO.length - 2);
}, 120_000);

test("sin cantidad se dice que se anotó un plato normal; con cantidad, no", async () => {
  const sin = await anotar("almorcé arroz con pollo y ensalada");
  expect(sin.out).toMatch(/No dijiste cuánto: anoté un plato normal \(~\d+ g en total\)/);
  const con = await anotar("almorcé 400 g de arroz con pollo");
  expect(con.out).not.toMatch(/No dijiste cuánto/);
  expect(con.tot.g).toBe(400);
  const plural = await anotar("comí empanadas de pino");
  expect(plural.out).toMatch(/No dijiste cuántas: anoté 1 \(Empanada de horno, 180 g\)\. Si fueron más, dime cuántas/);
});

test("lo que el plato ya trae no se suma dos veces; lo que no está en la base, se dice", async () => {
  const r = await anotar("almorcé tallarines con salsa y carne molida");
  expect(r.items.map((i) => i.name)).toEqual(["Tallarines con salsa bolognesa"]);
  const sp = await anotar("cené budín de zapallo italiano");
  expect(sp.out).toMatch(/No tengo «budin de zapallo italiano» en mi base: lo anoté como zapallo italiano/i);
});

test("leer la frase: cabeza, agregados y lo que «tenía»", () => {
  expect(partirPlato("tallarines con salsa y carne molida, tenia pimenton")).toMatchObject({ cabeza: "tallarines", agregados: ["salsa", "carne molida"], dentro: ["pimenton"] });
  expect(partirPlato("arroz, pollo y ensalada")).toMatchObject({ cabeza: "arroz", agregados: ["pollo", "ensalada"], dentro: [] });
  expect(partirPlato("pollo con arroz que llevaba zanahoria y arvejas")).toMatchObject({ cabeza: "pollo", agregados: ["arroz"], dentro: ["zanahoria", "arvejas"] });
  expect(rolDe("Arroz blanco cocido")).toBe("almidon");
  expect(rolDe("Tallarines con salsa bolognesa")).toBe("plato");
  expect(rolDe("Carne molida de vacuno (80% magra)")).toBe("proteina");
  expect(rolDe("Mayonesa")).toBe("grasa");
  expect(rolDe("Ensalada chilena")).toBe("verdura");
});

test("un plato traído de internet (macros por 100 g) sin cantidad: un plato normal (~300 g), no 100 g", async () => {
  const memory = mem();
  const ctx: any = { memory, wsClient: { send() {} }, foodService: fs, userMessage: "almorcé budín de choclo con queso de cabra" };
  const r: any = await t.execute({ action: "log_meal", mealType: "almuerzo", items: [{ name: "budín de choclo con queso de cabra", grams: 100, macros_override: { calories: 180, protein: 7, carbs: 20, fat: 8 } }] } as any, ctx);
  const day = [...memory.m.keys()].find((k) => k.startsWith("nutrition_log_"))!;
  const it = memory.m.get(day)[0].items[0];
  expect(it.grams).toBe(300);
  expect(it.calories).toBe(540);
  expect(String(r.metadata?.quickReply ?? r.output)).toMatch(/No dijiste cuánto: anoté un plato normal de budín de choclo con queso de cabra \(300 g\)/);
});

test("lo aprendido de USDA/OFF va a la carpeta de datos, nunca a la base del código", async () => {
  const os = await import("os");
  if (!/erishome/i.test(os.homedir())) return; // solo con el HOME aislado de «bun run pruebas»
  const { readFileSync, existsSync } = await import("fs");
  const { join } = await import("path");
  const base = "C:/Proyectos/eris/src/data/chilean-foods.json";
  const antes = readFileSync(base, "utf8");
  const svc = new UnifiedFoodService("");
  const s = { id: "x", description: "100g", metricServingAmount: 100, calories: 143, protein: 3, carbs: 11, fat: 9, fiber: 0, sugar: 2 };
  await svc.saveToLocalDB({ id: "usda:prueba", name: "Alimento de prueba aprendido", type: "Generic", servings: [s], defaultServing: s } as any, ["alimento de prueba"]);
  expect(readFileSync(base, "utf8")).toBe(antes);
  const p = join(os.homedir(), ".eris", "alimentos_aprendidos.json");
  expect(existsSync(p)).toBe(true);
  expect(JSON.parse(readFileSync(p, "utf8")).some((f: any) => f.name === "Alimento de prueba aprendido")).toBe(true);
});
