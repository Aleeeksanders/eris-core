// ============================================================
// Eris — UnifiedFoodService
// Orquesta tres fuentes:
//   1. DB Local Chile/LATAM  (platos típicos, prioridad alta)
//   2. USDA FoodData Central (genéricos, 1M+ alimentos)
//   3. Open Food Facts        (barcodes de productos envasados)
// ============================================================

import { USDAFoodService, type FoodItem, type FoodServing, type FoodSearchResult } from "./USDAFoodService.js";
import { OpenFoodFactsService } from "./OpenFoodFactsService.js";
import { createRequire } from "node:module";
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

  return {
    id: lf.id,
    name: lf.name,
    type: "Generic",
    servings,
    defaultServing: servings[0],
  };
}

// ─── Servicio unificado ───────────────────────────────────────

export class UnifiedFoodService {
  private usda: USDAFoodService;
  private off:  OpenFoodFactsService;
  private localDB: LocalFood[];

  constructor(usdaApiKey: string) {
    this.usda    = new USDAFoodService(usdaApiKey);
    this.off     = new OpenFoodFactsService();
    this.localDB = loadLocalDB();
  }

  // ─── Búsqueda: Local + USDA, fusionados ──────────────────────

  async searchFoods(query: string, page = 0, maxResults = 20): Promise<FoodSearchResult> {
    const q = query.toLowerCase().trim();

    // 1. Resultados locales (prioridad — sin latencia)
    const localMatches = this.localDB.filter(food => {
      const inName    = food.name.toLowerCase().includes(q);
      const inAliases = food.aliases?.some(a => a.toLowerCase().includes(q));
      const inCat     = food.category.toLowerCase().includes(q);
      return inName || inAliases || inCat;
    });

    const localItems = localMatches.slice(0, 8).map(f => ({
      id:          f.id,
      name:        f.name,
      brandName:   undefined as undefined,
      description: `${f.serving.description} — ${f.serving.calories} kcal | Prot: ${f.serving.protein}g | Grasa: ${f.serving.fat}g | Carbs: ${f.serving.carbs}g`,
    }));

    // 2. Resultados USDA y OFF en paralelo
    const externalNeeded = Math.max(0, maxResults - localItems.length);
    let externalItems: FoodSearchResult["items"] = [];
    let total = localItems.length;

    if (externalNeeded > 0) {
      try {
        const [usdaRes, offRes] = await Promise.all([
          this.usda.searchFoods(query, page, externalNeeded),
          this.off.searchFoods(query, "cl", externalNeeded)
        ]);
        
        const combined = [...offRes, ...usdaRes.items];
        
        // Deduplicar contra locales por nombre similar
        externalItems = combined.filter(u =>
          !localItems.some(l => this.similar(l.name, u.name))
        ).slice(0, externalNeeded);
        
        total += usdaRes.totalResults + offRes.length;
      } catch (e) {
        console.warn("[UnifiedFoodService] External search error:", e);
      }
    }

    return {
      items: [...localItems, ...externalItems],
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

    if (id.startsWith("usda:")) {
      const fdcId = id.replace("usda:", "");
      return this.usda.getFoodById(fdcId);
    }

    if (id.startsWith("off:")) {
      const barcode = id.replace("off:", "");
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
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const na = norm(a), nb = norm(b);
    if (na === nb) return true;
    // Si uno contiene al otro y son cortos → misma cosa
    if (na.length < 20 && nb.length < 20) return na.includes(nb) || nb.includes(na);
    return false;
  }
}
