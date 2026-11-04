// Revisión V2b: N1 limpieza de códigos de barras igual que el servidor · N3 copias y formato · E1 agua de Forge = servidor
process.env.TZ = "America/Santiago";
import { test, expect, mock } from "bun:test";
import { readFileSync } from "fs";

(globalThis as any).__DEV__ = false;
const store: Record<string, string> = {};
mock.module("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: async (k: string) => store[k] ?? null, setItem: async (k: string, v: string) => { store[k] = v; }, removeItem: async (k: string) => { delete store[k]; },
  multiGet: async (ks: string[]) => ks.map((k) => [k, store[k] ?? null]), getAllKeys: async () => Object.keys(store), multiRemove: async () => {}, multiSet: async () => {},
} }));
mock.module("react-native", () => ({ Platform: { OS: "android" }, DeviceEventEmitter: { emit: () => {}, addListener: () => ({ remove() {} }) }, AppState: { addEventListener: () => ({ remove() {} }) } }));
mock.module("C:/Proyectos/eris-mobile/src/services/WebSocketManager.ts", () => ({ wsManager: { getStatus: () => "disconnected", sendMessage: () => {}, subscribeMessage: () => () => {} } }));

const san = await import("C:/Proyectos/eris-mobile/src/services/nutrientSanity.ts");
const srv = await import("C:/Proyectos/eris/src/services/NutrientSanity.ts");
const { foodSearchService } = await import("C:/Proyectos/eris-mobile/src/services/FoodSearchService.ts");
const { coma } = await import("C:/Proyectos/eris-mobile/src/services/fmtNum.ts");

test("N1: el producto de Open Food Facts se limpia igual que en el servidor", async () => {
  const product = { code: "7801234567890", product_name: "Galleta rara", brands: "Marca", nutriments: {
    "energy-kcal_100g": 1950, proteins_100g: 250, carbohydrates_100g: 60, fat_100g: 20, sugars_100g: 75, "saturated-fat_100g": 30, fiber_100g: 3, sodium_100g: 9,
  } };
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ status: 1, product }) })) as any;
  const r = await foodSearchService.lookupBarcode("7801234567890");
  globalThis.fetch = orig;
  const f = r.food!;
  expect(f).toBeTruthy();
  // lo mismo que dice el servidor con los mismos números
  const s = srv.sanitizePer100({ kcal: 1950, protein: 250, carbs: 60, fat: 20, fiber: 3, sugar: 75, satFat: 30, sodiumMg: 9000 }, "Galleta rara");
  expect(f.calories).toBe(Math.round(s.kcal));
  expect(f.protein).toBe(0); // 250 g por 100 g es imposible
  expect(s.protein).toBe(0);
  expect(f.sugar).toBe(60); // el azúcar no pasa de los carbohidratos
  expect(f.satFat).toBe(20); // la saturada no pasa de la grasa
  expect(f.sodium).toBe(0); // 9.000 mg en una galleta: imposible, se descarta
  expect(f.calories).toBeLessThanOrEqual(900);
});

test("N1/N3: las copias del servidor son exactas (nutrientSanity, foodText, mealSchedule)", () => {
  for (const [a, b] of [["nutrientSanity", "NutrientSanity"], ["foodText", "FoodText"], ["mealSchedule", "MealSchedule"]]) {
    expect(readFileSync(`C:/Proyectos/eris/src/services/${b}.ts`, "utf-8")).toBe(readFileSync(`C:/Proyectos/eris-mobile/src/services/${a}.ts`, "utf-8"));
  }
  expect(san.maxSodiumMg("sal de mar")).toBe(40000);
});

test("N3: el agua se escribe con coma", () => {
  expect(coma(2.45, 2)).toBe("2,45");
  expect(coma(2.8)).toBe("2,8");
  expect(coma(3)).toBe("3");
  expect(coma(0.25, 2)).toBe("0,25");
});

test("N3: el chat nombra las colaciones como Nutrición", () => {
  const nt = readFileSync("C:/Proyectos/eris/src/tools/NutritionTool.ts", "utf-8");
  expect(nt).not.toMatch(/"🍎 Colación AM"|"🍪 Colación PM"/);
  const slots = readFileSync("C:/Proyectos/eris-mobile/src/services/mealSlots.ts", "utf-8");
  expect(slots).toContain("name: 'Colación mañana'");
  expect(nt).toContain('colacion_am: "🍎 Colación mañana"');
});
