// ============================================================
// Eris — FoodResolve
//
// Un nombre ("2 empanadas de queso", "pechuga a la plancha") → el alimento de la base (local Chile → USDA → OFF) y sus
// macros para una cantidad. Lo usan el registro de comidas (NutritionTool) y la estimación de glucosa (GlucoTool).
// ============================================================

import { foodTokens, wordMatch, SOUND, FoodIndex, nameKeys, correctText, editDistance } from "./FoodText.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UnifiedFoodService } from "./gluco/UnifiedFoodService.js";
import type { FoodServing } from "./gluco/FoodService.js";

const GENERIC = new Set(["sin", "premium", "natural", "casero", "casera", "light", "tradicional", "grande", "chico", "mediano", "extra",
  "clasico", "clasica", "fresco", "fresca", "cocido", "cocida", "frito", "frita", "asado", "asada"].flatMap((w) => foodTokens(w)));
/** Palabras estándar (FoodText) y cada par junto: "coca cola" también es "cocacola". */
const withPairs = (toks: string[]) => [...toks, ...toks.slice(0, -1).map((t, i) => t + toks[i + 1])];

/**
 * ¿Un resultado de la base corresponde a lo que se dijo? "strong": están todas las palabras reales del nombre; "weak": más
 * de la mitad, o la palabra principal del resultado (la primera) es una de ellas ("yogurt griego" → Yogurt natural);
 * null: no. Misma normalización que el buscador (tildes, mayúsculas, símbolos, plural, cómo suena). Acá NO valen los
 * errores de tipeo: eso lo decide correctFoodName, que además se lo dice al usuario ("Entendí «chocapig» como Chocapic").
 * - "mortadela premium" terminaba como un sándwich de Burger King por compartir "premium" (los calificativos no cuentan).
 * - 2026-10-11: "carne roja" terminaba como "Chili con carne with beans, canned entree" (USDA) por compartir "carne":
 *   bastaba UNA palabra. Ahora "carne" sola de dos palabras no alcanza, y "chili" no es "carne".
 */
export function foodFit(name: string, r: { name: string; brandName?: string }): "strong" | "weak" | null {
  const base = foodTokens(name).filter((w) => w.length > 2 && !GENERIC.has(w));
  if (!base.length) return "weak"; // nombre solo con calificativos: no hay nada que contrastar
  const have = withPairs(foodTokens(`${r.name} ${r.brandName ?? ""}`));
  const hit = (k: string) => have.some((h) => wordMatch(k, h) >= SOUND);
  // "coca cola" = "cocacola": cada palabra vale si calza sola o junto a la vecina
  const matched = base.filter((k, i) => hit(k) || (i < base.length - 1 && hit(k + base[i + 1])) || (i > 0 && hit(base[i - 1] + k))).length;
  if (matched === base.length) return "strong";
  const head = foodTokens(r.name)[0];
  if (matched * 2 > base.length || (!!head && base.some((k) => wordMatch(k, head) >= SOUND))) return "weak";
  return null;
}

/** El alimento de la base que corresponde a un nombre, o null (ver foodFit). */
export async function resolveFood(foodService: UnifiedFoodService, name: string) {
  // Los alimentos de la base chilena también calzan por sus alias ("Coca-Cola Zero" es un alias de "Bebida light / zero")
  const aliasesOf = new Map(foodService.searchLocal(name, 20).map((h) => [h.name, h.aliases ?? []] as const));
  const plausible = (r: { name: string; brandName?: string }) =>
    foodFit(name, r) !== null || (aliasesOf.get(r.name) ?? []).some((a) => foodFit(name, { name: a }) !== null);
  for (const max of [1, 6]) {
    const res = await foodService.searchFoods(name, 0, max);
    const found = res.items.find(plausible);
    if (found) return foodService.getFoodById(found.id);
  }
  return null;
}

// ─── Nombres mal escritos ─────────────────────────────────────────────────────
// "Registra 150 gramos de chocapig" (2026-10-09): Chocapic está en la base como alias, pero "chocapig" no calzaba y se
// anotó con un valor genérico (225 kcal en vez de ~570). Cada palabra que no exista en las bases se compara con su
// vocabulario (nombres y alias) y se corrige si hay UNA palabra a 1 letra de distancia (2 si es larga).

type Named = { name?: string; aliases?: string[]; brand?: string };
let VOCAB: FoodIndex<Named> | null = null;
/** Todas las palabras de las bases (nombres, alias, marcas) en un índice FoodText, solo para corregir nombres. */
function vocab(): FoodIndex<Named> {
  if (VOCAB) return VOCAB;
  const all: Named[] = [];
  try {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
    const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf-8"));
    all.push(...read("chilean-foods.json"), ...(read("food_catalog.json").items ?? []), ...(read("packaged_cl.json").items ?? []));
  } catch { /* sin bases: sin corrección */ }
  VOCAB = new FoodIndex(all, (f) => [...nameKeys(f.name ?? ""), ...(f.aliases ?? []).map((a) => ({ text: a })), ...(f.brand ? [{ text: f.brand }] : [])]);
  return VOCAB;
}

export { editDistance };

/**
 * El nombre con sus palabras desconocidas corregidas contra las bases ("chocapig" → "chocapic", "empanda de pino" →
 * "empanada de pino"), o null si no cambió nada. Compara por cómo suena y solo corrige si hay UNA palabra más cercana.
 */
export function correctFoodName(name: string): string | null {
  const v = vocab();
  return v.size ? correctText(name, [v as FoodIndex<unknown>]) : null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** La porción de la base llevada a `grams` gramos. */
export function scaleServing(s: FoodServing, grams: number): FoodServing {
  const f = grams / (s.metricServingAmount || 100);
  return {
    ...s, id: `${s.id}_${grams}g`, description: `${grams}g`, metricServingAmount: grams,
    calories: Math.round(s.calories * f), carbs: r1(s.carbs * f), fiber: r1((s.fiber || 0) * f),
    protein: r1(s.protein * f), fat: r1(s.fat * f),
  };
}
