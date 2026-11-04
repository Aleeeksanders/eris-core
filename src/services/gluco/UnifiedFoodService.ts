// ============================================================
// Eris — UnifiedFoodService
// Orquesta tres fuentes:
//   1. DB Local Chile/LATAM  (platos típicos, prioridad alta)
//   2. USDA FoodData Central (genéricos, 1M+ alimentos)
//   3. Open Food Facts        (barcodes de productos envasados)
// ============================================================

import { USDAFoodService, type FoodItem, type FoodServing, type FoodSearchResult } from "./USDAFoodService.js";
import { OpenFoodFactsService } from "./OpenFoodFactsService.js";
import { searchPackagedHits, packagedIndex, getByCode, packagedToFoodItem, packagedSafety } from "../PackagedFoods.js";
import { FoodIndex, nameKeys, normText, correctText, naturalBoost, type FoodKey, type SearchOpts } from "../FoodText.js";
import type { FoodSafety } from "../DietaryRestrictions.js";
import catalogData from "../../data/food_catalog.json";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ─── Tipos del DB local ───────────────────────────────────────

interface LocalFood {
  id: string;
  name: string;
  aliases?: string[];
  category: string;
  serving: LocalServing;
  alt?: LocalServing[];
}

interface LocalServing {
  description: string;
  grams: number;
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  sugar?: number;
}

// ─── Carga del DB local ───────────────────────────────────────

function loadLocalDB(): LocalFood[] {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname  = path.dirname(__filename);
    const dbPath = path.resolve(__dirname, "../../data/chilean-foods.json");
    return JSON.parse(readFileSync(dbPath, "utf-8")) as LocalFood[];
  } catch {
    console.warn("[UnifiedFoodService] No se pudo cargar chilean-foods.json");
    return [];
  }
}

/**
 * Por qué textos se busca cada alimento: nombre (cada sinónimo de "Palta / Aguacate" por separado), alias y, con poco
 * peso, la categoría. El orden lo da FoodText: nombre o alias idéntico > todas las palabras > con errores de tipeo.
 * Antes ganaba el primero del archivo ("galletas" caía en "Galletas de agua" en vez de las galletas dulces).
 */
const localKeys = (f: { name: string; aliases?: string[]; category?: string }): FoodKey[] => [
  ...nameKeys(f.name),
  // «Palta / Aguacate»: cada lado es un nombre, pero también el nombre completo. Sin esto, buscar el alimento por su propio
  // nombre (lo que hace el chat después de reconocerlo) no lo encontraba y «anota 1 plátano», «200 g de fideos» o «hallulla
  // con palta» quedaban sin anotar: «no está en mis bases» (revisión 2026-11-04; 38 alimentos distintos entre la base y el catálogo)
  ...(f.name.includes("/") ? [{ text: f.name.replace(/\s*\/\s*/g, " ") }] : []),
  ...(f.aliases ?? []).map((a) => ({ text: a })),
  ...(f.category ? [{ text: f.category, weight: 0.4 }] : []),
];

// ─── Catálogo de Eris (alimentos con alérgenos verificados y nutrientes por porción) ─────

interface CatalogEntry extends FoodSafety {
  id: string; name: string; aliases: string[]; role: string;
  portion: string; grams: number; kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number;
  sodiumMg?: number;
}
const CATALOG = (catalogData as { items: CatalogEntry[] }).items;
const CATALOG_BY_ID = new Map(CATALOG.map((c) => [c.id, c]));
const CATALOG_INDEX = new FoodIndex(CATALOG, (c) => localKeys({ name: c.name, aliases: c.aliases }));

const catalogSafety = (c: CatalogEntry): FoodSafety => ({
  allergens: c.allergens, traces: c.traces, verifiedFor: c.verifiedFor, meat: c.meat, animal: c.animal, lactoseG: c.lactoseG,
  landMeat: c.landMeat, netCarbs100: c.netCarbs100, netCarbsPortion: c.netCarbsPortion,
});

function catalogToFoodItem(c: CatalogEntry): FoodItem {
  const per = (id: string, description: string, grams: number): FoodServing => {
    const f = grams / c.grams;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return {
      id, description, metricServingAmount: grams,
      calories: Math.round(c.kcal * f), protein: r1(c.protein * f), carbs: r1(c.carbs * f), fat: r1(c.fat * f),
      fiber: r1(c.fiber * f), sugar: r1(c.sugar * f), sodium: c.sodiumMg !== undefined ? Math.round(c.sodiumMg * f) : undefined,
    };
  };
  const servings = [per(`cat_${c.id}_portion`, c.portion, c.grams)];
  if (c.grams !== 100) servings.push(per(`cat_${c.id}_100g`, "100g", 100));
  return { id: `cat:${c.id}`, name: c.name, type: "Generic", servings, defaultServing: servings[0], safety: catalogSafety(c) };
}

// ─── Conversión local → FoodItem ─────────────────────────────

function localToFoodItem(lf: LocalFood): FoodItem {
  const toServing = (s: LocalServing): FoodServing => ({
    id: `${lf.id}_${s.grams}g`,
    description: s.description,
    calories: s.calories,
    carbs:    s.carbs,
    fiber:    s.fiber,
    protein:  s.protein,
    fat:      s.fat,
    sugar:    s.sugar,
    metricServingAmount: s.grams,
  });

  const servings = [toServing(lf.serving), ...(lf.alt ?? []).map(toServing)];

  // Los platos/alimentos chilenos comparten id con el catálogo (sin el prefijo cl:) → heredan sus alérgenos verificados
  const cat = CATALOG_BY_ID.get(lf.id.replace(/^cl:/, ""));

  return {
    id: lf.id,
    name: lf.name,
    type: "Generic",
    servings,
    defaultServing: servings[0],
    safety: cat ? catalogSafety(cat) : undefined,
  };
}

// ─── Servicio unificado ───────────────────────────────────────

export class UnifiedFoodService {
  private usda: USDAFoodService;
  private off:  OpenFoodFactsService;
  private localDB: LocalFood[];
  private localIx: FoodIndex<LocalFood> | null = null;

  constructor(usdaApiKey: string) {
    this.usda    = new USDAFoodService(usdaApiKey);
    this.off     = new OpenFoodFactsService();
    this.localDB = loadLocalDB();
  }

  /** Índice de la base chilena (se rehace si se le agrega un alimento). */
  private localIndex(): FoodIndex<LocalFood> {
    if (!this.localIx) this.localIx = new FoodIndex(this.localDB, localKeys);
    return this.localIx;
  }

  /**
   * El nombre con sus palabras mal escritas corregidas contra TODAS las bases locales (chilena, catálogo, envasados):
   * "chocapig" → "chocapic", "empanda de pino" → "empanada de pino". null si no había nada que corregir o si la
   * corrección no es única (dos palabras igual de cerca: no se adivina).
   */
  /** Base chilena y catálogo (sin los 4.500 envasados: tanta marca suelta haría "corregir" palabras comunes). */
  vocabularyIndexes(): Array<FoodIndex<unknown>> {
    return [this.localIndex(), CATALOG_INDEX] as Array<FoodIndex<unknown>>;
  }

  correctQuery(query: string): string | null {
    return correctText(query, [this.localIndex(), CATALOG_INDEX, packagedIndex()] as Array<FoodIndex<unknown>>);
  }

  /**
   * Solo la base local (chilena + catálogo), sin internet, con la porción de cada alimento. La usa el reconocimiento
   * por código de "registra 2 marraquetas" (services/FoodParse.ts), que corre antes del modelo en cada mensaje con un
   * verbo de registro: no puede esperar a USDA ni a Open Food Facts.
   */
  searchLocal(query: string, max = 12): Array<{ name: string; aliases?: string[]; servingDescription: string; servingGrams: number }> {
    if (!normText(query)) return [];
    // Sin la categoría: "registra 2 panes" tiene que ser un pan, no cualquier cosa de la categoría "Panes"
    const opts: SearchOpts = { limit: max };
    const hits = [
      ...this.localIndex().search(query, opts).filter((h) => !this.onlyCategory(h.item, query))
        .map((h) => ({ score: h.score, src: 0, name: h.item.name, aliases: h.item.aliases, servingDescription: h.item.serving.description, servingGrams: h.item.serving.grams })),
      ...CATALOG_INDEX.search(query, opts)
        .map((h) => ({ score: h.score, src: 1, name: h.item.name, aliases: h.item.aliases, servingDescription: h.item.portion, servingGrams: h.item.grams })),
    ].map((h) => ({ ...h, score: h.score + naturalBoost(query, h.name) }))
      .sort((a, b) => b.score - a.score || a.src - b.src);
    const seen = new Set<string>();
    const out: Array<{ name: string; aliases?: string[]; servingDescription: string; servingGrams: number }> = [];
    for (const { score: _s, src: _o, ...h } of hits) {
      const k = normText(h.name);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(h);
    }
    return out.slice(0, max);
  }

  /** ¿Este alimento calzó SOLO por su categoría (no por su nombre ni alias)? */
  private onlyCategory(f: LocalFood, query: string): boolean {
    return !new FoodIndex([f], (x) => localKeys({ name: x.name, aliases: x.aliases })).search(query, { limit: 1 }).length;
  }

  // ─── Búsqueda: Local + USDA, fusionados ──────────────────────

  async searchFoods(query: string, page = 0, maxResults = 20): Promise<FoodSearchResult> {
    // 1. Bases locales (sin latencia), todas con la misma normalización (FoodText): tildes, mayúsculas, símbolos,
    //    espacios, orden de las palabras, cómo suena ("sucaritas" ~ "zucaritas") y errores de tipeo ("chocapig").
    //    Se mezclan por qué tan bien calzan; a igual calce, primero la base chilena, después el catálogo y los envasados.
    // exact: calzaron todas las palabras sin errores de tipeo (ver FoodText)
    type Ranked = { score: number; src: number; exact: boolean; item: FoodSearchResult["items"][number] };
    const ranked: Ranked[] = [];

    const localHits = this.localIndex().search(query, { limit: 8 });
    for (const { item: f, score, exact } of localHits) {
      const cat = CATALOG_BY_ID.get(f.id.replace(/^cl:/, ""));
      ranked.push({ score, src: 0, exact, item: {
        id:          f.id,
        name:        f.name,
        brandName:   undefined as undefined,
        description: `${f.serving.description} — ${f.serving.calories} kcal | Prot: ${f.serving.protein}g | Grasa: ${f.serving.fat}g | Carbs: ${f.serving.carbs}g`,
        safety:      cat ? catalogSafety(cat) : undefined,
      } });
    }

    // 1b. Catálogo de Eris (alimentos que no están en la DB chilena: pescados, mariscos, legumbres, frutas, etc.)
    const localIds = new Set(localHits.map(h => h.item.id.replace(/^cl:/, "")));
    for (const { item: c, score, exact } of CATALOG_INDEX.search(query, { limit: 6 })) {
      if (localIds.has(c.id)) continue;
      ranked.push({ score, src: 1, exact, item: {
        id: `cat:${c.id}`, name: c.name, brandName: undefined as undefined,
        description: `${c.portion} — ${c.kcal} kcal | Prot: ${c.protein}g | Grasa: ${c.fat}g | Carbs: ${c.carbs}g`,
        safety: catalogSafety(c),
      } });
    }

    // 1c. Productos envasados chilenos (base local con alérgenos; no depende de la búsqueda de texto de OFF)
    for (const { item: p, score, exact } of searchPackagedHits(query, 6)) {
      ranked.push({ score, src: 2, exact, item: {
        id: `off:${p.code}`, name: p.name, brandName: p.brand,
        description: `Por 100g — ${p.per100.kcal} kcal | Prot: ${p.per100.protein}g | Grasa: ${p.per100.fat}g | Carbs: ${p.per100.carbs}g`,
        safety: packagedSafety(p),
      } });
    }
    // Lo que calza entero va primero y, entre eso, la base chilena y el catálogo antes que los envasados: "arroz" es el
    // arroz cocido de la base (porción de plato), no el paquete de arroz CRUDO de OFF que se llama "arroz" a secas
    // (2026-10-10: 230 g de arroz quedaban en 777 kcal en vez de ~300). Un envasado gana si se nombra su marca o si lo
    // de la base solo calza con errores de tipeo. Entre la base chilena y el catálogo manda el calce, con lo natural primero
    // (2026-10-23): «pera» es la fruta del catálogo, no el «Jugo de pera» de la base aunque la base vaya antes.
    const nat = (r: Ranked) => r.score + naturalBoost(query, r.item.name, r.item.brandName);
    const knownLocal: FoodSearchResult["items"] = ranked
      .sort((a, b) => Number(b.exact) - Number(a.exact) || Number(a.src === 2) - Number(b.src === 2) || nat(b) - nat(a) || a.src - b.src)
      .map((r) => r.item);

    // 2. Resultados USDA y OFF en paralelo
    const externalNeeded = Math.max(0, maxResults - knownLocal.length);
    let externalItems: FoodSearchResult["items"] = [];
    let total = knownLocal.length;

    if (externalNeeded > 0) {
      try {
        // A las APIs va el texto estándar, con las palabras mal escritas ya corregidas contra las bases locales
        const apiQuery = this.correctQuery(query) ?? normText(query);
        const [usdaRes, offRes] = await Promise.all([
          this.usda.searchFoods(apiQuery, page, externalNeeded),
          this.off.searchFoods(apiQuery, "cl", externalNeeded)
        ]);
        
        const combined = [...offRes, ...usdaRes.items];
        
        // Deduplicar contra locales por nombre similar
        externalItems = combined.filter(u =>
          !knownLocal.some(l => l.id === u.id || this.similar(l.name, u.name))
        ).slice(0, externalNeeded);
        
        total += usdaRes.totalResults + offRes.length;
      } catch (e) {
        console.warn("[UnifiedFoodService] External search error:", e);
      }
    }

    return {
      items: [...knownLocal, ...externalItems],
      totalResults: total,
      page,
    };
  }

  // ─── Detalle por ID (ruteado por prefijo) ─────────────────────

  async getFoodById(id: string): Promise<FoodItem> {
    if (id.startsWith("cl:")) {
      const local = this.localDB.find(f => f.id === id);
      if (!local) throw new Error(`Alimento local no encontrado: ${id}`);
      return localToFoodItem(local);
    }

    if (id.startsWith("cat:")) {
      const c = CATALOG_BY_ID.get(id.slice(4));
      if (!c) throw new Error(`Alimento del catálogo no encontrado: ${id}`);
      return catalogToFoodItem(c);
    }

    if (id.startsWith("usda:")) {
      const fdcId = id.replace("usda:", "");
      return this.usda.getFoodById(fdcId);
    }

    if (id.startsWith("off:")) {
      const barcode = id.replace("off:", "");
      const known = getByCode(barcode);
      if (known) return packagedToFoodItem(known);
      const item = await this.off.findByBarcode(barcode);
      if (!item) throw new Error(`Producto OFF no encontrado: ${barcode}`);
      return item;
    }

    // Fallback: intentar USDA directo
    return this.usda.getFoodById(id);
  }

  // ─── Búsqueda por barcode: OFF primero, luego USDA ───────────

  async findByBarcode(barcode: string): Promise<FoodItem | null> {
    // Open Food Facts primero — mejor para productos chilenos envasados
    const offResult = await this.off.findByBarcode(barcode);
    if (offResult) return offResult;

    // Fallback a USDA branded
    return this.usda.findByBarcode(barcode);
  }

  // ─── Guardar en LocalDB ───────────────────────────────────────

  async saveToLocalDB(food: FoodItem, aliases?: string[]): Promise<void> {
    const s = food.defaultServing;
    if (!s) return;
    
    // Solo guardar si no existe por nombre para evitar duplicados
    const exists = this.localDB.some(l => this.similar(l.name, food.name));
    if (exists) return;

    const newLocal: LocalFood = {
      id: `cl:ext_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: food.name,
      aliases: aliases,
      category: "Importado",
      serving: {
        description: s.description || `${s.metricServingAmount}g`,
        grams: s.metricServingAmount || 100,
        calories: s.calories,
        carbs: s.carbs,
        protein: s.protein,
        fat: s.fat,
        fiber: s.fiber || 0,
        sugar: s.sugar
      }
    };

    this.localDB.push(newLocal);
    this.localIx = null;
    
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname  = path.dirname(__filename);
      const dbPath = path.resolve(__dirname, "../../data/chilean-foods.json");
      writeFileSync(dbPath, JSON.stringify(this.localDB, null, 2), "utf-8");
      console.log(`[UnifiedFoodService] Alimento guardado en DB local: ${newLocal.name}`);
    } catch (e) {
      console.error("[UnifiedFoodService] Error guardando local DB", e);
    }
  }

  // ─── Utilidad: similitud de nombre simple ─────────────────────

  private similar(a: string, b: string): boolean {
    const na = normText(a), nb = normText(b);
    if (na === nb) return true;
    // Si uno contiene al otro y son cortos → misma cosa
    if (na.length < 20 && nb.length < 20) return na.includes(nb) || nb.includes(na);
    return false;
  }
}
