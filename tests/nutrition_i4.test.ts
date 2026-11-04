// Nutrición fase I4 (2026-10-23): lo natural primero, tu versión de un alimento y el detalle de lo anotado.
import { test, expect, mock } from "bun:test";

// La app usa AsyncStorage y el WebSocket: en la prueba, un almacenamiento en memoria y un servidor que responde envasados
const store = new Map<string, string>();
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null, setItem: async (k: string, v: string) => { store.set(k, v); },
    multiGet: async (ks: string[]) => ks.map((k) => [k, store.get(k) ?? null]), removeItem: async (k: string) => { store.delete(k); },
  },
}));
const sent: any[] = [];
let erisHits: any[] = [];
const subs: Array<(d: any) => void> = [];
mock.module("C:/Proyectos/eris-mobile/src/services/WebSocketManager.ts", () => ({
  wsManager: {
    getStatus: () => "connected",
    subscribeMessage: (h: (d: any) => void) => { subs.push(h); return () => { const i = subs.indexOf(h); if (i >= 0) subs.splice(i, 1); }; },
    sendMessage: (m: any) => {
      sent.push(m);
      if (m.type === "food_search") setTimeout(() => [...subs].forEach((h) => h({ type: "food_search_result", requestId: m.requestId, hits: erisHits, corrected: null })), 1);
    },
  },
}));

const { naturalBoost, sameFood } = await import("C:/Proyectos/eris/src/services/FoodText.ts");
const { foodSearchService } = await import("C:/Proyectos/eris-mobile/src/services/FoodSearchService.ts");
const { detailOf, allergensOf, sourceOf } = await import("C:/Proyectos/eris-mobile/src/services/foodDetail.ts");
const { cleanMyFoods, myFoodFor } = await import("C:/Proyectos/eris/src/services/FoodResolve.ts");
const { UnifiedFoodService } = await import("C:/Proyectos/eris/src/services/gluco/UnifiedFoodService.ts");
const { searchPackagedHits } = await import("C:/Proyectos/eris/src/services/PackagedFoods.ts");

const pack = (q: string) => searchPackagedHits(q, 8, { prefix: true, partial: true }).map((h: any) => ({ product: h.item, score: h.score, exact: h.exact }));
const names = (xs: any[], n = 4) => xs.slice(0, n).map((f) => f.name + (f.brand ? ` [${f.brand}]` : ""));
// Sin Open Food Facts en la prueba: falla la red y queda lo local + Eris
(globalThis as any).fetch = async () => { throw new Error("sin red"); };

test("naturalBoost y sameFood: el derivado baja, el genérico sube; exacto = mismas palabras (con marca, si se nombró)", () => {
  expect(naturalBoost("manzana", "Jugo de manzana")).toBe(-1);
  expect(naturalBoost("jugo de manzana", "Jugo de manzana")).toBe(1);
  expect(naturalBoost("manzana", "Manzana", "Watts")).toBe(0);
  expect(naturalBoost("limon", "Sabor Limón", "Marco Polo")).toBe(-2);
  expect(naturalBoost("manzana", "Manzana")).toBe(1);
  expect(sameFood("palta", "Palta / Aguacate")).toBe(true);
  expect(sameFood("manzanas", "Manzana")).toBe(true);
  expect(sameFood("manzana", "Manzana", "Watts")).toBe(false);
  expect(sameFood("manzana watts", "Manzana", "Watts")).toBe(true);
  expect(sameFood("manzana", "Jugo de manzana")).toBe(false);
});

test("servidor: la fruta antes que el jugo, el kuchen y la manzana envasada; lo que se nombra, se respeta", async () => {
  const u: any = new UnifiedFoodService("");
  u.usda = { searchFoods: async () => ({ items: [], totalResults: 0 }) };
  u.off = { searchFoods: async () => [] };
  const first = async (q: string) => (await u.searchFoods(q, 0, 8)).items[0].name;
  expect(await first("manzana")).toBe("Manzana");
  expect(await first("pera")).toBe("Pera");
  expect(await first("limon")).toBe("Limón");
  expect(await first("jugo de manzana")).toBe("Jugo de manzana (sin azúcar)");
  expect(await first("leche condensada")).toBe("Leche condensada");
  expect(await first("arroz")).toBe("Arroz blanco cocido");
  expect(u.searchLocal("papa")[0].name).toBe("Papa cocida");
  // en «papa», las fritas (derivado) van después de lo cocido y el puré
  const papa = u.searchLocal("papa", 6).map((x: any) => x.name);
  expect(papa.indexOf("Papas fritas")).toBeGreaterThan(papa.indexOf("Puré de papas"));
});

test("app: «manzana» da la fruta aunque hayas anotado jugo de manzana y la Manzana Watts", async () => {
  const day = new Date().toDateString();
  store.set(`eris_nutrition_log_v1_${day}`, JSON.stringify([
    { food: { id: "cl:jugo", name: "Jugo de manzana", calories: 46, protein: 0, carbs: 11, fat: 0, fiber: 0, sugar: 10, sodium: 4, servingSize: 200, servings: [] }, grams: 200, mealType: "desayuno", loggedAt: new Date().toISOString() },
    { food: { id: "780", name: "Manzana", brand: "Watts", calories: 50, protein: 0, carbs: 12, fat: 0, fiber: 0, sugar: 11, sodium: 5, servingSize: 200, servings: [] }, grams: 200, mealType: "once", loggedAt: new Date().toISOString() },
  ]));
  erisHits = pack("manzana");
  const res = await foodSearchService.search("manzana");
  expect(res[0].name).toBe("Manzana");
  expect(res[0].brand).toBeUndefined();
  expect(res[0].source).toBe("base");
  // lo reciente que no es exacto no se cuela arriba
  const jugo = res.findIndex((f) => f.name === "Jugo de manzana");
  expect(jugo).toBeGreaterThan(0);
  // mientras se escribe tampoco
  const quick = await foodSearchService.searchQuick("manz");
  expect(quick[0].name).toBe("Manzana");
  expect(quick[0].brand).toBeUndefined();
  // si se nombra la marca, sí: lo ya anotado y exacto va primero
  erisHits = pack("manzana watts");
  const w = await foodSearchService.search("manzana watts");
  expect(names(w, 1)).toEqual(["Manzana [Watts]"]);
  expect(w[0].recent).toBe(true);
  // y si se busca el jugo, el jugo
  erisHits = pack("jugo de manzana");
  expect((await foodSearchService.search("jugo de manzana"))[0].name).toBe("Jugo de manzana");
  store.clear();
});

test("app: tu versión reemplaza al original al buscar y se manda al servidor; «dejar de usar» vuelve a la base", async () => {
  erisHits = [];
  const [hallulla] = await foodSearchService.searchQuick("hallulla");
  expect(hallulla.name).toBe("Hallulla");
  const mine = await foodSearchService.saveMyVersion(hallulla, { calories: 290, protein: 8, carbs: 55, fat: 4, fiber: 2, sugar: 1, sodium: 500, satFat: 1 });
  expect(mine).toMatchObject({ name: "Hallulla", calories: 290, mine: true, source: "mia" });
  const sync = sent.filter((m) => m.type === "my_foods_sync").pop();
  expect(sync.foods[0]).toMatchObject({ name: "Hallulla", calories: 290 });
  const res = await foodSearchService.search("hallulla");
  expect(res[0]).toMatchObject({ name: "Hallulla", calories: 290, mine: true });
  expect(res.filter((f) => f.name === "Hallulla").length).toBe(1); // la de la base no sale repetida
  // una segunda versión reemplaza a la primera (una por alimento)
  await foodSearchService.saveMyVersion(res[0], { calories: 300, protein: 8, carbs: 57, fat: 4, fiber: 2, sugar: 1, sodium: 500, satFat: 1 });
  expect((await foodSearchService.myFoods()).length).toBe(1);
  expect((await foodSearchService.search("hallulla"))[0].calories).toBe(300);
  // anotada con tu versión: al dejar de usarla, lo ya anotado no la trae de vuelta al buscador
  store.set(`eris_nutrition_log_v1_${new Date().toDateString()}`, JSON.stringify([{ food: res[0], grams: 90, mealType: "desayuno", loggedAt: new Date().toISOString() }]));
  await foodSearchService.removeMyVersion(res[0]);
  const back = await foodSearchService.search("hallulla");
  expect(back.some((f) => f.mine)).toBe(false);
  expect(back[0].mine).toBeUndefined();
  expect(back[0].calories).not.toBe(300);
});

test("servidor: el chat usa tu versión solo si es exactamente ese alimento", () => {
  const list = cleanMyFoods([
    { name: "Hallulla", calories: 290, protein: 8, carbs: 55, fat: 4, fiber: 2, servingSize: 90, servings: [{ description: "1 unidad (90 g)", grams: 90 }] },
    { name: "Manzana", brand: "Watts", calories: 50, protein: 0, carbs: 12, fat: 0, servingSize: 200, liquid: true },
    { name: "Imposible", calories: 2000, protein: 0, carbs: 0, fat: 0 },
    { name: "", calories: 10, protein: 1, carbs: 1, fat: 0 },
  ]);
  expect(list.map((x) => x.name)).toEqual(["Hallulla", "Manzana"]);
  const h = myFoodFor(list, "hallullas")!;
  expect(h.defaultServing).toMatchObject({ metricServingAmount: 90, calories: 261, description: "1 unidad (90 g)" });
  expect(myFoodFor(list, "hallulla integral")).toBeNull();
  expect(myFoodFor(list, "manzana")).toBeNull();
  expect(myFoodFor(list, "manzana watts")!.name).toBe("Manzana");
});

test("detalle: porción, lo que no se sabe (chat), lo estimado, agua, calidad, alérgenos y fuente", () => {
  const at = "2026-10-23T16:00:00.000Z";
  const chat = detailOf({ food: { id: "eris_1", name: "Empanada de pino", calories: 270, protein: 10, carbs: 28, fat: 13, fiber: 1.5, sugar: 0, sodium: 0, servingSize: 200, servings: [], source: "chat" }, grams: 200, mealType: "almuerzo", loggedAt: at } as any);
  expect(chat).toMatchObject({ kcal: 540, protein: 20, sugar: null, source: "chat" });
  expect(chat.estimated).toContain("sodio");
  expect(chat.allergens.byName).toEqual(["gluten", "huevo"]);
  const fruta = detailOf({ food: { id: "cl:manzana", name: "Manzana", calories: 52, protein: 0.3, carbs: 14, fat: 0.2, fiber: 2.4, sugar: 10, sodium: 1, nova: 1, group: "fruta", servingSize: 150, servings: [] }, grams: 150, mealType: "once", loggedAt: at } as any);
  expect(fruta).toMatchObject({ letter: "A", nova: 1, group: "fruta", sellos: [], source: "base", unit: "g" });
  expect(fruta.waterL).toBeGreaterThan(0.1);
  const galleta = allergensOf({ id: "1", name: "Galleta Tritón", allergens: ["gluten", "lactosa"], traces: ["mani", "gluten"] } as any);
  expect(galleta).toEqual({ declared: ["gluten", "lactosa"], traces: ["mani"], byName: [] });
  expect(sourceOf({ id: "7802800000000", name: "x" } as any)).toBe("off");
  expect(sourceOf({ id: "mia_1", name: "x" } as any)).toBe("mia");
});
