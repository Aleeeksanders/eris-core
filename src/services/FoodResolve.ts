// ============================================================
// Eris — FoodResolve
//
// Un nombre ("2 empanadas de queso", "pechuga a la plancha") → el alimento de la base (local Chile → USDA → OFF) y sus
// macros para una cantidad. Lo usan el registro de comidas (NutritionTool) y la estimación de glucosa (GlucoTool).
// ============================================================

import { foodTokens, wordMatch, SOUND, FoodIndex, nameKeys, correctText, editDistance, sameFood, normText } from "./FoodText.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UnifiedFoodService } from "./gluco/UnifiedFoodService.js";
import type { FoodItem, FoodServing } from "./gluco/FoodService.js";

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
  // La palabra principal sola vale con nombres cortos («yogurt griego» → Yogurt natural). 2026-10-21: «Keto chicken melt
  // Starbucks» terminó como «Chicken, canned, meat only» de USDA por compartir solo «chicken» (1 de 4 palabras).
  if (matched * 2 > base.length || (base.length <= 2 && !!head && base.some((k) => wordMatch(k, head) >= SOUND))) return "weak";
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

// ─── Tu versión de un alimento (app 1.58, 2026-10-23) ─────────────────────────
// En la app, «Editar información nutricional» de algo anotado guarda TU versión (la hallulla de tu panadería) y la usa desde
// ahí. El teléfono manda la lista (`my_foods_sync`) y el chat la usa antes que la base, solo si es exactamente ese alimento.

export interface MyFood {
  name: string; brand?: string;
  calories: number; protein: number; carbs: number; fat: number; fiber?: number; sugar?: number; sodium?: number; satFat?: number;
  servingSize?: number; servings?: Array<{ description: string; grams: number }>; liquid?: boolean;
}

const fin = (v: unknown, max: number): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined);

/** Lo que manda la app, saneado: valores posibles por 100 g y hasta 300 alimentos. */
export function cleanMyFoods(raw: unknown): MyFood[] {
  if (!Array.isArray(raw)) return [];
  const out: MyFood[] = [];
  for (const x of raw.slice(0, 300) as any[]) {
    const name = typeof x?.name === "string" ? x.name.trim().slice(0, 120) : "";
    const kcal = fin(x?.calories, 900), protein = fin(x?.protein, 100), carbs = fin(x?.carbs, 100), fat = fin(x?.fat, 100);
    if (!name || kcal === undefined || protein === undefined || carbs === undefined || fat === undefined || protein + carbs + fat > 105) continue;
    const servings = (Array.isArray(x.servings) ? x.servings : [])
      .filter((s: any) => typeof s?.description === "string" && fin(s?.grams, 5000))
      .slice(0, 6).map((s: any) => ({ description: String(s.description).slice(0, 60), grams: s.grams }));
    out.push({
      name, brand: typeof x.brand === "string" && x.brand.trim() ? x.brand.trim().slice(0, 60) : undefined,
      calories: kcal, protein, carbs, fat, fiber: fin(x.fiber, 100), sugar: fin(x.sugar, 100), sodium: fin(x.sodium, 40000), satFat: fin(x.satFat, 100),
      servingSize: fin(x.servingSize, 5000), servings, liquid: x.liquid === true || undefined,
    });
  }
  return out;
}

/**
 * Tu versión de lo dicho, como alimento de la base (con su porción habitual), o null. Solo si es EXACTAMENTE ese alimento
 * (mismas palabras; uno con marca, solo si se nombró la marca): «hallulla» usa tu hallulla, «hallulla integral» no.
 */
export function myFoodFor(list: MyFood[], name: string): FoodItem | null {
  const f = list.find((x) => sameFood(name, x.name, x.brand));
  if (!f) return null;
  const g = f.servings?.[0]?.grams || f.servingSize || 100;
  const k = g / 100;
  const serving: FoodServing = {
    id: `mia_${g}g`, description: f.servings?.[0]?.description ?? `${g} ${f.liquid ? "ml" : "g"}`, metricServingAmount: g,
    calories: Math.round(f.calories * k), protein: r1(f.protein * k), carbs: r1(f.carbs * k), fat: r1(f.fat * k),
    fiber: r1((f.fiber ?? 0) * k), ...(f.sugar !== undefined ? { sugar: r1(f.sugar * k) } : {}), ...(f.sodium !== undefined ? { sodium: Math.round(f.sodium * k) } : {}),
  };
  return { id: `mia:${normText(`${f.name} ${f.brand ?? ""}`)}`, name: f.name, brandName: f.brand, type: "Generic", servings: [serving], defaultServing: serving };
}
