// ============================================================
// Eris — GlucoPredictorService
// Motor de estimación de impacto glucémico por comida
// Basado en Carga Glucémica (GL) + factores de macronutrientes
// ============================================================

import giDatabase from "../../data/gi_database.json";
import type { FoodItem, FoodServing } from "./FoodService.js";

// ─── Tipos ────────────────────────────────────────────────────────

export type GlucoseRiskLevel = "low" | "medium" | "high" | "very_high";

export interface FoodEntry {
  food: FoodItem;
  serving: FoodServing;
  /** Multiplicador de porción. 1.0 = una porción estándar */
  portionMultiplier: number;
}

export interface FoodGlucoseImpact {
  foodId: string;
  foodName: string;
  gi: number;               // Glycemic Index
  gl: number;               // Glycemic Load (por la porción)
  adjustedGL: number;       // GL ajustado con factores de macro
  riskLevel: GlucoseRiskLevel;
  /** Fuente del GI: "database", "category_average", "estimated" */
  giSource: "database" | "category_average" | "estimated";
}

export interface MealGlucoseEstimation {
  entries: FoodEntry[];
  impacts: FoodGlucoseImpact[];
  /** Carga glucémica total de la comida */
  totalGL: number;
  /** GL ajustado considerando toda la mezcla de la comida */
  totalAdjustedGL: number;
  /** Nivel de riesgo general de la comida */
  mealRiskLevel: GlucoseRiskLevel;
  /** Estimación de pico de glucosa en mg/dL sobre la línea base */
  estimatedGlucosePeak: number;
  /** Minutos aproximados hasta el pico */
  estimatedTimeToPeakMin: number;
  /** Resumen en texto */
  summary: string;
  /** Macros totales de la comida */
  macros: {
    calories: number;
    carbs: number;
    fiber: number;
    protein: number;
    fat: number;
  };
}

// ─── Base de datos de GI (tipado) ─────────────────────────────────

interface GIDatabase {
  categories: Record<string, { default_gi: number; label: string }>;
  foods: Record<string, { gi: number; category: string }>;
}

const DB = giDatabase as GIDatabase;

// ─── Servicio ─────────────────────────────────────────────────────

export class GlucoPredictorService {

  /**
   * Busca el Índice Glucémico de un alimento por nombre.
   * 1. Busca match exacto en la base de datos local.
   * 2. Busca match parcial.
   * 3. Usa el promedio de categoría de FatSecret.
   * 4. Retorna estimación general.
   */
  private lookupGI(foodName: string, fatSecretCategory?: string): {
    gi: number;
    source: "database" | "category_average" | "estimated";
  } {
    const normalized = foodName.toLowerCase().trim();

    // 1. Match exacto
    if (DB.foods[normalized]) {
      return { gi: DB.foods[normalized].gi, source: "database" };
    }

    // 2. Match parcial (el nombre de la DB está contenido en el alimento buscado o viceversa)
    for (const [key, val] of Object.entries(DB.foods)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return { gi: val.gi, source: "database" };
      }
    }

    // 3. Intentar mapear la categoría de FatSecret a una categoría de GI
    if (fatSecretCategory) {
      const catMapped = this.mapFatSecretCategory(fatSecretCategory);
      if (catMapped && DB.categories[catMapped]) {
        return { gi: DB.categories[catMapped].default_gi, source: "category_average" };
      }
    }

    // 4. Estimación genérica
    return { gi: 55, source: "estimated" };
  }

  private mapFatSecretCategory(fatSecretCat: string): string | null {
    const cat = fatSecretCat.toLowerCase();
    if (cat.includes("bread") || cat.includes("bakery")) return "bread";
    if (cat.includes("pasta") || cat.includes("noodle")) return "pasta";
    if (cat.includes("rice") || cat.includes("grain")) return "rice";
    if (cat.includes("vegetable")) return "vegetables";
    if (cat.includes("legume") || cat.includes("bean") || cat.includes("lentil")) return "legumes";
    if (cat.includes("fruit")) return "fruits";
    if (cat.includes("dairy") || cat.includes("milk") || cat.includes("cheese")) return "dairy";
    if (cat.includes("meat") || cat.includes("poultry") || cat.includes("seafood") || cat.includes("fish")) return "meat_fish";
    if (cat.includes("nut") || cat.includes("seed")) return "nuts_seeds";
    if (cat.includes("sweet") || cat.includes("dessert") || cat.includes("candy")) return "sweets";
    if (cat.includes("beverage") || cat.includes("drink") || cat.includes("juice")) return "beverages";
    if (cat.includes("cereal") || cat.includes("breakfast")) return "cereals_grains";
    if (cat.includes("oil") || cat.includes("fat") || cat.includes("butter")) return "oils_fats";
    return null;
  }

  /**
   * Calcula el impacto glucémico de un ítem del log de comida.
   */
  private calculateFoodImpact(entry: FoodEntry): FoodGlucoseImpact {
    const { food, serving, portionMultiplier } = entry;

    // Macros escalados por porción
    const carbs = serving.carbs * portionMultiplier;
    const fiber = serving.fiber * portionMultiplier;
    const protein = serving.protein * portionMultiplier;
    const fat = serving.fat * portionMultiplier;

    // Carbohidratos disponibles (netos)
    const availableCarbs = Math.max(0, carbs - fiber);

    // GI lookup
    const { gi, source } = this.lookupGI(food.name);

    // Glycemic Load
    const gl = parseFloat(((gi * availableCarbs) / 100).toFixed(2));

    // Factores de atenuación por macros (basados en evidencia científica)
    // Proteína: atenúa absorción de glucosa
    const proteinFactor = Math.max(0.5, 1 - protein * 0.007);
    // Grasa: ralentiza vaciado gástrico
    const fatFactor = Math.max(0.6, 1 - fat * 0.004);
    // Fibra soluble adicional: reduce pico
    const fiberFactor = Math.max(0.7, 1 - fiber * 0.01);

    const adjustedGL = parseFloat((gl * proteinFactor * fatFactor * fiberFactor).toFixed(2));

    return {
      foodId: food.id,
      foodName: food.name,
      gi,
      gl,
      adjustedGL,
      riskLevel: this.glToRisk(adjustedGL),
      giSource: source,
    };
  }

  private glToRisk(gl: number): GlucoseRiskLevel {
    if (gl <= 10) return "low";
    if (gl <= 19) return "medium";
    if (gl <= 30) return "high";
    return "very_high";
  }

  private riskToEmoji(risk: GlucoseRiskLevel): string {
    const map: Record<GlucoseRiskLevel, string> = {
      low: "🟢",
      medium: "🟡",
      high: "🔴",
      very_high: "🔴🔴",
    };
    return map[risk];
  }

  /**
   * Estima el pico de glucosa en mg/dL sobre la línea base actual.
   * Fórmula empírica basada en GL total: aprox 1–1.5 mg/dL por unidad GL.
   */
  private estimatePeak(totalAdjustedGL: number): number {
    // Personas sin diabetes: aprox 1.2 mg/dL de aumento por unidad de GL
    // Para valores altos, la curva se aplana un poco
    if (totalAdjustedGL <= 10) return Math.round(totalAdjustedGL * 1.2);
    if (totalAdjustedGL <= 20) return Math.round(10 * 1.2 + (totalAdjustedGL - 10) * 1.5);
    return Math.round(10 * 1.2 + 10 * 1.5 + (totalAdjustedGL - 20) * 1.8);
  }

  private estimateTimeToPeak(totalAdjustedGL: number, totalFat: number): number {
    // Base: 45 min para comida estándar
    // Más grasa → absorción más lenta → más tiempo al pico
    const base = 45;
    const fatDelay = Math.min(30, totalFat * 0.5);
    // Más GL → pico más intenso pero no necesariamente más tardío
    return Math.round(base + fatDelay);
  }

  // ─── API pública ──────────────────────────────────────────────────

  /**
   * Calcula la estimación glucémica completa de una comida (lista de alimentos + porciones).
   */
  estimateMeal(entries: FoodEntry[]): MealGlucoseEstimation {
    const impacts = entries.map((e) => this.calculateFoodImpact(e));

    // Totales de macros de la comida
    const macros = entries.reduce(
      (acc, { serving, portionMultiplier }) => ({
        calories: acc.calories + serving.calories * portionMultiplier,
        carbs: acc.carbs + serving.carbs * portionMultiplier,
        fiber: acc.fiber + serving.fiber * portionMultiplier,
        protein: acc.protein + serving.protein * portionMultiplier,
        fat: acc.fat + serving.fat * portionMultiplier,
      }),
      { calories: 0, carbs: 0, fiber: 0, protein: 0, fat: 0 }
    );

    // Sumar GL individual de cada ítem
    const totalGL = parseFloat(impacts.reduce((s, i) => s + i.gl, 0).toFixed(1));

    // GL ajustado con interacción de macros a nivel comida completa
    const mealProteinFactor = Math.max(0.5, 1 - macros.protein * 0.005);
    const mealFatFactor = Math.max(0.6, 1 - macros.fat * 0.003);
    const totalAdjustedGL = parseFloat(
      (totalGL * mealProteinFactor * mealFatFactor).toFixed(1)
    );

    const mealRiskLevel = this.glToRisk(totalAdjustedGL);
    const estimatedGlucosePeak = this.estimatePeak(totalAdjustedGL);
    const estimatedTimeToPeakMin = this.estimateTimeToPeak(totalAdjustedGL, macros.fat);

    // Resumen legible
    const riskEmoji = this.riskToEmoji(mealRiskLevel);
    const riskLabel: Record<GlucoseRiskLevel, string> = {
      low: "bajo",
      medium: "moderado",
      high: "alto",
      very_high: "muy alto",
    };

    const summary =
      `${riskEmoji} Impacto glucémico ${riskLabel[mealRiskLevel]} — ` +
      `Carga Glucémica total: ${totalAdjustedGL} GL · ` +
      `Pico estimado: +${estimatedGlucosePeak} mg/dL en ~${estimatedTimeToPeakMin}min · ` +
      `${Math.round(macros.calories)} kcal | ` +
      `Carbs ${Math.round(macros.carbs)}g · Prot ${Math.round(macros.protein)}g · ` +
      `Grasa ${Math.round(macros.fat)}g · Fibra ${Math.round(macros.fiber)}g`;

    return {
      entries,
      impacts,
      totalGL,
      totalAdjustedGL,
      mealRiskLevel,
      estimatedGlucosePeak,
      estimatedTimeToPeakMin,
      summary,
      macros: {
        calories: Math.round(macros.calories),
        carbs: Math.round(macros.carbs),
        fiber: Math.round(macros.fiber),
        protein: Math.round(macros.protein),
        fat: Math.round(macros.fat),
      },
    };
  }

  /**
   * Estimación rápida por nombre de alimento y gramos (sin FatSecret)
   */
  quickEstimate(foodName: string, grams: number): {
    gi: number;
    gl: number;
    risk: GlucoseRiskLevel;
    source: string;
  } {
    const { gi, source } = this.lookupGI(foodName);
    // Asumimos ~50% de los gramos son carbohidratos (estimación conservadora)
    // Para alimentos específicos la precisión es mucho mayor con FatSecret
    const estimatedCarbs = grams * 0.5;
    const gl = parseFloat(((gi * estimatedCarbs) / 100).toFixed(1));
    return { gi, gl, risk: this.glToRisk(gl), source };
  }
}
