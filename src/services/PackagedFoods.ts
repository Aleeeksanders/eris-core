// ============================================================
// Eris — Base local de productos envasados (Chile)
//
// Productos de Open Food Facts (ODbL, © contribuidores de OFF) con sus alérgenos ya interpretados:
//   - se buscan por nombre/marca SIN red (la búsqueda de texto de OFF es poco fiable y con límites)
//   - se consultan por código de barras antes de salir a internet
//   - cada producto que el usuario escanea o registra se APRENDE (se guarda aquí con sus alérgenos)
//
// SEGURIDAD (mismo criterio fail-closed que DietaryRestrictions): un producto solo cuenta como
// "verificado" para un alérgeno si OFF marca su lista de ingredientes como completa Y el texto no
// menciona ese alérgeno. Sin lista de ingredientes → verifiedFor vacío → nunca se recomienda a
// alguien con restricciones, y al registrarlo se avisa "no pude verificar".
// ============================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { FoodSafety } from "./DietaryRestrictions.js";
import type { FoodItem, FoodServing } from "./gluco/USDAFoodService.js";
import { FoodIndex, nameKeys, type FoodHit, type SearchOpts } from "./FoodText.js";
import { sanitizePer100 } from "./NutrientSanity.js";

export const ALL_TAGS = [
  "gluten", "lactosa", "huevo", "soya", "frutos_secos", "mani", "pescado", "mariscos",
  "sesamo", "mostaza", "apio", "sulfitos", "lupino",
  // "etiquetas de dieta": mismo trato fail-closed que un alérgeno
  "cerdo", "alcohol", "gelatina", "alto_mercurio", "higado", "crudo_ahumado",
] as const;

const OFF_TAG_TO_OURS: Record<string, string> = {
  "en:milk": "lactosa", "en:gluten": "gluten", "en:soybeans": "soya", "en:nuts": "frutos_secos", "en:peanuts": "mani",
  "en:eggs": "huevo", "en:fish": "pescado", "en:crustaceans": "mariscos", "en:molluscs": "mariscos",
  "en:sesame-seeds": "sesamo", "en:mustard": "mostaza", "en:celery": "apio",
  "en:sulphur-dioxide-and-sulphites": "sulfitos", "en:lupin": "lupino",
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Palabras del texto de ingredientes (español, sin tildes). Red de seguridad: se une con lo que dice OFF.
// Preferimos falsos positivos (avisar de más) a falsos negativos.
const TEXT_RULES: Array<{ tag: string; re: RegExp }> = [
  { tag: "gluten", re: /\b(trigo|cebada|centeno|avena|malta|semola|gluten|espelta|kamut|triticale|cerveza|pan rallado|harina(?! de (maiz|arroz|garbanzo|quinoa|papa|mandioca|tapioca|almendra|coco)))/ },
  { tag: "lactosa", re: /\b(leche|lactosa|suero|caseina|caseinato|crema|mantequilla|queso|yogur|yogurt|manjar|lactoglobulina|lactalbumina|nata)\b/ },
  { tag: "huevo", re: /\b(huevo|huevos|albumina|ovoalbumina|lisozima|yema|clara)\b/ },
  { tag: "soya", re: /\b(soya|soja|lecitina)\b/ },
  { tag: "frutos_secos", re: /\b(nuez|nueces|almendra|almendras|avellana|avellanas|pistacho|castana|castanas|maranon|pecana|macadamia)\b/ },
  { tag: "mani", re: /\b(mani|cacahuate|cacahuete|cacahuates)\b/ },
  { tag: "pescado", re: /\b(pescado|atun|salmon|merluza|anchoa|anchoas|jurel|sardina|sardinas|caballa)\b/ },
  { tag: "mariscos", re: /\b(marisco|mariscos|camaron|camarones|langostino|crustaceo|crustaceos|molusco|moluscos|calamar|choro|almeja|ostra|pulpo)\b/ },
  { tag: "sesamo", re: /\b(sesamo|ajonjoli)\b/ },
  { tag: "mostaza", re: /\bmostaza\b/ },
  { tag: "apio", re: /\bapio\b/ },
  { tag: "sulfitos", re: /(sulfito|anhidrido sulfuroso|dioxido de azufre|metabisulfito|\b(e|ins)[ -]?22[0-8]\b)/ },
  { tag: "lupino", re: /\b(lupino|altramuz)\b/ },
  { tag: "cerdo", re: /\b(cerdo|jamon|tocino|panceta|chorizo|longaniza|mortadela|salame|salami|pate|manteca|lardo|bacon|prosciutto|pancetta)\b/ },
  { tag: "alcohol", re: /\b(alcohol|etanol|vino|cerveza|pisco|ron|licor|whisky|vodka|brandy|ginebra|aguardiente)\b/ },
  { tag: "gelatina", re: /\b(gelatina|grenetina)\b/ },
  { tag: "higado", re: /\b(higado|pate)\b/ },
  { tag: "crudo_ahumado", re: /\b(ahumado|ahumada|carpaccio|sushi|crudo|cruda)\b/ },
  { tag: "alto_mercurio", re: /\b(pez espada|atun|tiburon|marlin|emperador)\b/ },
];

const MEAT_RE = /\b(carne|pollo|pavo|vacuno|cerdo|jamon|tocino|pescado|atun|salmon|merluza|marisco|camaron|longaniza|salchicha|vienesa|chorizo|gelatina|cordero|res)\b/;
// Solo animales terrestres (pescetarianos comen pescado y mariscos)
const LAND_MEAT_RE = /\b(carne|pollo|pavo|vacuno|cerdo|jamon|tocino|panceta|longaniza|salchicha|vienesa|chorizo|gelatina|grenetina|cordero|res|mortadela|salame|salami|pate|caldo de (pollo|carne|vacuno)|extracto de carne)\b/;
// Nombres de producto en español/inglés/francés/portugués (OFF mezcla idiomas): solo sirven para DESMENTIR "vegano/vegetariano".
const LAND_MEAT_WORDS_ANY_LANG = /(^|[^a-z])(carne|pollo|pavo|vacuno|cerdo|jamon|tocino|panceta|longaniza|salchicha|vienesa|chorizo|cordero|mortadela|salame|salami|pate|poulet|dinde|boeuf|porc|jambon|saucisse|agneau|viande|chicken|turkey|beef|pork|ham|sausage|lamb|meat|frango|carne|presunto|linguica)([^a-z]|$)/;
const MEAT_WORDS_ANY_LANG = /(^|[^a-z])(carne|pollo|pavo|vacuno|cerdo|jamon|tocino|panceta|longaniza|salchicha|vienesa|chorizo|cordero|mortadela|salame|salami|pate|poulet|dinde|boeuf|porc|jambon|saucisse|agneau|viande|chicken|turkey|beef|pork|ham|sausage|lamb|meat|frango|presunto|linguica|pescado|atun|salmon|merluza|camaron|marisco|poisson|thon|saumon|crevette|fish|tuna|shrimp)([^a-z]|$)/;
const ANIMAL_WORDS_ANY_LANG = /(^|[^a-z])(leche|queso|yogur|yogurt|huevo|huevos|mantequilla|crema|manjar|miel|gelatina|lait|fromage|oeuf|beurre|creme|milk|cheese|egg|eggs|butter|cream|honey|leite|queijo|ovo|manteiga|pescado|atun|salmon|merluza|camaron|marisco|poisson|thon|saumon|crevette|fish|tuna|shrimp)([^a-z]|$)/;
const ANIMAL_RE = /\b(leche|huevo|miel|gelatina|suero|caseina|crema|mantequilla|queso|yogur|manjar|albumina|grenetina)\b/;

/** Alérgenos que un texto de ingredientes/nombre sugiere (para productos sin datos de OFF y para nombres libres). */
export function scanText(text: string): string[] {
  const n = norm(text || "");
  return TEXT_RULES.filter((r) => r.re.test(n)).map((r) => r.tag);
}

export interface OffProduct {
  code?: string;
  product_name?: string; product_name_es?: string; brands?: string;
  serving_quantity?: number | string; serving_size?: string; quantity?: string;
  allergens_tags?: string[]; traces_tags?: string[];
  ingredients_text?: string; ingredients_text_es?: string;
  states_tags?: string[]; labels_tags?: string[];
  nutriments?: Record<string, any>;
  nova_group?: number; nutrition_grades?: string;
  /** Análisis de OFF sobre los ingredientes: en:vegan / en:non-vegan / en:maybe-vegan / en:vegetarian / en:non-vegetarian… */
  ingredients_analysis_tags?: string[];
}

export interface PackagedProduct extends FoodSafety {
  code: string;
  name: string;
  brand?: string;
  servingG?: number;
  servingText?: string;
  per100: { kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar?: number; sodiumMg?: number; satFat?: number };
  ingredients?: string;
  /** true si la lista de ingredientes está completa en OFF (base de la verificación). */
  ingredientsComplete: boolean;
  nova?: number;
  /** Nutri-Score de OFF (a = mejor … e = peor), si lo tiene */
  nutriscore?: string;
  /** "off" = Open Food Facts; "usuario" = cargado a mano desde la app (etiqueta del envase) */
  source: "off" | "usuario";
}

const num = (v: any): number | undefined => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

/** OFF → registro propio con alérgenos interpretados. Devuelve null si no hay nombre o macros mínimos. */
export function fromOff(p: OffProduct): PackagedProduct | null {
  const code = String(p.code || "").trim();
  const name = (p.product_name_es || p.product_name || "").trim();
  const n = p.nutriments || {};
  const protein = num(n["proteins_100g"]), carbs = num(n["carbohydrates_100g"]), fat = num(n["fat_100g"]);
  // Muchos productos de OFF traen la energía solo en kJ, o ni eso: se calcula (kJ/4,184, o 4·P + 4·C + 9·G)
  const kj = num(n["energy-kj_100g"]) ?? num(n["energy_100g"]);
  const kcal = num(n["energy-kcal_100g"])
    ?? (kj !== undefined ? kj / 4.184 : undefined)
    ?? (protein !== undefined && carbs !== undefined && fat !== undefined ? 4 * protein + 4 * carbs + 9 * fat : undefined);
  if (!code || !name || kcal === undefined || protein === undefined || carbs === undefined || fat === undefined) return null;

  const ingredients = (p.ingredients_text_es || p.ingredients_text || "").trim();
  const hasIngredients = ingredients.length >= 10;
  const states = p.states_tags || [];
  // "Completa" según OFF, o al menos con texto y sin la marca de "por completar".
  const complete = hasIngredients && (states.includes("en:ingredients-completed") || !states.includes("en:ingredients-to-be-completed"));

  const present = new Set<string>();
  for (const t of p.allergens_tags || []) { const m = OFF_TAG_TO_OURS[t]; if (m) present.add(m); }
  const traces = new Set<string>();
  for (const t of p.traces_tags || []) { const m = OFF_TAG_TO_OURS[t]; if (m && !present.has(m)) traces.add(m); }
  if (hasIngredients) for (const t of scanText(ingredients)) present.add(t);
  // El nombre también cuenta ("Galletas de avena"): protege cuando faltan ingredientes.
  for (const t of scanText(name)) present.add(t);

  const ingNorm = norm(ingredients);
  // Sodio en g/100 g; si solo viene la sal, sodio = sal / 2,5
  const sodium = num(n["sodium_100g"]) ?? (num(n["salt_100g"]) !== undefined ? num(n["salt_100g"])! / 2.5 : undefined);

  // Vegetariano / vegano. Solo se declara "sin carne"/"sin derivados animales" con una AFIRMACIÓN de OFF
  // (en:vegetarian / en:vegan, calculada sobre su taxonomía de ingredientes). "maybe" / "status-unknown" / sin
  // análisis → queda sin confirmar y un vegetariano/vegano no lo verá. Nuestro texto (ingredientes Y nombre,
  // en varios idiomas) solo puede DESMENTIR: en OFF hay datos cruzados (un "Poulet cuit fumé" con la lista de ingredientes de una sopa).
  const aTags = p.ingredients_analysis_tags || [];
  const hasAnalysis = aTags.some((t) => t.includes("vegan") || t.includes("vegetarian"));
  let meat: boolean | undefined, animal: boolean | undefined;
  if (hasAnalysis) {
    meat = aTags.includes("en:non-vegetarian") ? true : (aTags.includes("en:vegetarian") || aTags.includes("en:vegan")) ? false : undefined;
    animal = aTags.includes("en:non-vegan") ? true : aTags.includes("en:vegan") ? false : undefined;
  } else {
    meat = complete ? MEAT_RE.test(ingNorm) : undefined;
    animal = complete ? (MEAT_RE.test(ingNorm) || ANIMAL_RE.test(ingNorm) || present.has("lactosa") || present.has("huevo")) : undefined;
  }
  const nameNorm = norm(name);
  const meatSeen = (complete && MEAT_RE.test(ingNorm)) || MEAT_WORDS_ANY_LANG.test(nameNorm);
  const animalSeen = meatSeen || (complete && (ANIMAL_RE.test(ingNorm) || present.has("lactosa") || present.has("huevo"))) || ANIMAL_WORDS_ANY_LANG.test(nameNorm);
  if (meatSeen) meat = true;
  if (animalSeen) animal = true;
  // Carne de animales terrestres (pescetarianos): un producto vegetariano no la lleva; con carne, depende de si es pescado/marisco
  const landSeen = (complete && LAND_MEAT_RE.test(ingNorm)) || LAND_MEAT_WORDS_ANY_LANG.test(nameNorm);
  const landMeat: boolean | undefined = meat === false ? false : landSeen ? true : complete ? false : undefined;

  const fiber = num(n["fiber_100g"]) ?? 0;
  const netCarbs100 = Math.max(0, carbs - fiber);
  const sG = num(p.serving_quantity);
  const netCarbsPortion = sG && sG > 0 ? (netCarbs100 * sG) / 100 : undefined;
  return {
    code, name, brand: p.brands?.split(",")[0]?.trim() || undefined,
    servingG: num(p.serving_quantity) && num(p.serving_quantity)! > 0 ? num(p.serving_quantity) : undefined,
    servingText: p.serving_size || undefined,
    // Solo valores posibles: OFF trae sodio en la unidad equivocada y otros errores (ver NutrientSanity.ts)
    per100: sanitizePer100({
      kcal: Math.round(kcal), protein: Math.round(protein * 10) / 10, carbs: Math.round(carbs * 10) / 10, fat: Math.round(fat * 10) / 10,
      fiber: Math.round((num(n["fiber_100g"]) ?? 0) * 10) / 10,
      sugar: num(n["sugars_100g"]) !== undefined ? Math.round(num(n["sugars_100g"])! * 10) / 10 : undefined,
      sodiumMg: sodium !== undefined ? Math.round(sodium * 1000) : undefined,
      satFat: num(n["saturated-fat_100g"]) !== undefined ? Math.round(num(n["saturated-fat_100g"])! * 10) / 10 : undefined,
    }, name),
    ingredients: hasIngredients ? ingredients.slice(0, 600) : undefined,
    ingredientsComplete: complete,
    nova: num(p.nova_group),
    nutriscore: /^[a-e]$/.test(String(p.nutrition_grades || "")) ? String(p.nutrition_grades) : undefined,
    allergens: [...present].sort(),
    traces: [...traces].sort(),
    // Sin ingredientes completos NO se verifica nada (fail-closed).
    verifiedFor: complete ? [...ALL_TAGS] : [],
    meat, animal, landMeat,
    netCarbs100: netCarbs100 !== undefined ? Math.round(netCarbs100 * 10) / 10 : undefined,
    netCarbsPortion: netCarbsPortion !== undefined ? Math.round(netCarbsPortion * 10) / 10 : undefined,
    source: "off",
  };
}

// ─── Almacén en disco ────────────────────────────────────────────────────────

const DATA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/packaged_cl.json");

let cache: Map<string, PackagedProduct> | null = null;
let searchIndex: FoodIndex<PackagedProduct> | null = null;

function load(): Map<string, PackagedProduct> {
  if (cache) return cache;
  cache = new Map();
  try {
    if (existsSync(DATA_PATH)) {
      const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
      // Lo ya guardado también pasa por el filtro: la base trae sodios imposibles (974.000 mg por 100 g)
      for (const p of raw.items as PackagedProduct[]) cache.set(p.code, p.per100 ? { ...p, per100: sanitizePer100(p.per100, p.name || "") } : p);
    }
  } catch (e) {
    console.warn("[PackagedFoods] No se pudo cargar packaged_cl.json:", e);
  }
  return cache;
}

function save(): void {
  try {
    const items = [...load().values()];
    writeFileSync(DATA_PATH, JSON.stringify({
      version: 1,
      attribution: "Datos de Open Food Facts (openfoodfacts.org), licencia ODbL. Alérgenos interpretados por Eris (ver PackagedFoods.ts).",
      items,
    }), "utf-8");
  } catch (e) {
    console.warn("[PackagedFoods] No se pudo guardar packaged_cl.json:", e);
  }
}

export function getByCode(code: string): PackagedProduct | undefined {
  return load().get(code);
}

export function packagedCount(): number { return load().size; }

/** Guarda/actualiza un producto (lo usan el build inicial y el "aprendizaje" al escanear). */
export function upsert(p: PackagedProduct, persist = true): void {
  load().set(p.code, p);
  searchIndex = null;
  if (persist) save();
}

/** Aprende un producto directo del JSON de OFF. Devuelve el registro (o null si le faltan datos mínimos). */
export function learnFromOff(p: OffProduct, persist = true): PackagedProduct | null {
  const rec = fromOff(p);
  if (rec) upsert(rec, persist);
  return rec;
}

export function bulkUpsert(list: PackagedProduct[]): void {
  for (const p of list) load().set(p.code, p);
  searchIndex = null;
  save();
}

/** El índice de búsqueda de los envasados (nombre + marca), armado una vez y rehecho al aprender un producto. */
export function packagedIndex(): FoodIndex<PackagedProduct> {
  if (!searchIndex) searchIndex = new FoodIndex([...load().values()], (p) => nameKeys(p.name).map((k) => ({ ...k, extra: p.brand })));
  return searchIndex;
}

/**
 * Búsqueda local por nombre y marca con la normalización estándar de FoodText: sin importar tildes, mayúsculas, símbolos,
 * espacios ("cocacola"), el orden ni un error de tipeo. La voz transcribe "Zucaritas" como "sucaritas" y "Kellogg's" como
 * "kelogs": también calzan (por sonido).
 */
export function searchPackagedHits(query: string, limit = 8, opts: SearchOpts = {}): FoodHit<PackagedProduct>[] {
  return packagedIndex()
    .search(query, { ...opts, limit: limit * 3 })
    // Con ingredientes completos se pueden revisar alérgenos: a igual calce, primero esos
    .map((h) => ({ ...h, score: h.score + (h.item.ingredientsComplete ? 0.3 : 0) }))
    .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length)
    .slice(0, limit);
}

export function searchPackaged(query: string, limit = 8, opts: SearchOpts = {}): PackagedProduct[] {
  return searchPackagedHits(query, limit, opts).map((h) => h.item);
}

// ─── Conversión al formato que usa el resto de la app ────────────────────────

/** Producto envasado → FoodItem (con `safety` para que el registro de comidas pueda avisar por alérgenos). */
export function packagedToFoodItem(p: PackagedProduct): FoodItem {
  const per = p.per100;
  const scale = (id: string, description: string, grams: number): FoodServing => {
    const f = grams / 100;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return {
      id, description, metricServingAmount: grams,
      calories: Math.round(per.kcal * f), protein: r1(per.protein * f), carbs: r1(per.carbs * f), fat: r1(per.fat * f),
      fiber: r1(per.fiber * f), sugar: per.sugar !== undefined ? r1(per.sugar * f) : undefined,
      sodium: per.sodiumMg !== undefined ? Math.round(per.sodiumMg * f) : undefined,
    };
  };
  const servings: FoodServing[] = [];
  if (p.servingG) servings.push(scale("off_serving", p.servingText || `${p.servingG}g`, p.servingG));
  servings.push(scale("off_100g", "100g", 100));
  return {
    id: `off:${p.code}`, name: p.name, brandName: p.brand, type: "Brand",
    servings, defaultServing: servings[0],
    safety: packagedSafety(p),
    ingredients: p.ingredients,
  };
}

/** Los datos de seguridad de un producto envasado (alérgenos, dieta, carbohidratos netos). */
export function packagedSafety(p: PackagedProduct): FoodSafety {
  return {
    allergens: p.allergens, traces: p.traces, verifiedFor: p.verifiedFor, meat: p.meat, animal: p.animal,
    landMeat: p.landMeat, netCarbs100: p.netCarbs100, netCarbsPortion: p.netCarbsPortion,
    name: p.name, ingredients: p.ingredients, // para lo que se nota en qué es el producto (alcohol)
  };
}
