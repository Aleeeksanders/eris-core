// ============================================================
// Eris — GlucoTool
// Tool del agente para consultar glucosa y comidas
// Permite a Eris razonar sobre el estado metabólico del usuario
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { GlucoService } from "../services/gluco/GlucoService.js";
import { UnifiedFoodService } from "../services/gluco/UnifiedFoodService.js";
import { GlucoPredictorService, type FoodEntry } from "../services/gluco/GlucoPredictorService.js";
import { resolveFood, scaleServing } from "../services/FoodResolve.js";
import { getFeatures } from "../services/Features.js";
import { loadAffinity, suggestCarbOptions, formatCarbOptions, blockedFavorites } from "../services/CarbOptions.js";
import { deriveRestrictions } from "../services/DietaryRestrictions.js";

// ─── Schema de entrada ────────────────────────────────────────────

const GlucoInputSchema = z.object({
  action: z
    .enum([
      "current",       // glucosa actual
      "history",       // historial últimas N horas
      "stats",         // estadísticas (TIR, media, min/max)
      "search_food",   // buscar alimento (USDA + DB local + Open Food Facts)
      "estimate_food", // estimación glucémica rápida por nombre
      "estimate_meal", // estimación de una comida completa (JSON)
    ])
    .describe(
      "Acción a ejecutar. Opciones: current | history | stats | search_food | estimate_food | estimate_meal"
    ),
  query: z
    .string()
    .optional()
    .describe("Texto de búsqueda (para search_food) o nombre del alimento (para estimate_food)"),
  hours: z
    .number()
    .optional()
    .describe("Horas de historial a consultar. Default: 24"),
  grams: z
    .number()
    .optional()
    .describe("Gramos del alimento para estimate_food. Default: 100"),
  mealJson: z
    .string()
    .optional()
    .describe(
      'JSON con la comida para estimate_meal. Formato: [{"name":"arroz blanco","grams":150},{"name":"pollo","grams":120}]'
    ),
});

type GlucoInput = z.infer<typeof GlucoInputSchema>;

// ─── Tool ─────────────────────────────────────────────────────────

export class GlucoTool extends Tool<GlucoInput> {
  readonly name = "gluco_tracker";
  readonly description =
    "Herramienta de salud metabólica. Permite consultar los niveles de glucosa en sangre " +
    "desde el sensor FreeStyle Libre (vía LibreLinkUp), buscar alimentos en la base de datos " +
    "unificada (local Chile/LATAM + USDA + Open Food Facts), y estimar el impacto glucémico " +
    "de comidas usando el modelo de Carga Glucémica (GL). " +
    "Úsala cuando el usuario pregunte sobre su glucosa, azúcar en sangre, qué puede comer, " +
    "o quiera registrar una comida. Ejemplos de uso: 'Cómo está mi azúcar', " +
    "'¿Cuánto me va a subir el arroz?', 'Busca información nutricional del pan integral'.";

  readonly inputSchema = GlucoInputSchema;

  private predictor: GlucoPredictorService;

  constructor() {
    super();
    this.predictor = new GlucoPredictorService();
  }

  async execute(input: GlucoInput, context?: any): Promise<ToolExecutionResult> {
    try {
      const memory = context?.memory;
      if (!memory) {
        return { output: "", error: "Contexto de perfil no disponible para inicializar servicios de salud." };
      }

      // Lecturas del sensor solo con el módulo de glucosa aprobado por el administrador. Las estimaciones de una
      // comida (estimate_food/meal, search_food) no tocan el sensor y siguen disponibles.
      const readsSensor = ["current", "history", "stats"].includes(input.action);
      if (readsSensor && !(await getFeatures()).glucose) {
        return { output: "El módulo de glucosa está desactivado por ahora: no leo el sensor ni tengo tus lecturas. Cuando se active, te avisaré tus niveles y tendencias." };
      }

      // Preferir el servicio cacheado (ya autenticado y con datos recientes)
      // que el servidor mantiene activo via polling.
      let glucoService: GlucoService | null = context?.glucoService || null;
      const foodService: UnifiedFoodService | null = context?.foodService ?? null;

      // Solo se conecta a LibreLinkUp cuando se pide una lectura: antes estimar una comida también iniciaba sesión en el sensor
      if (!glucoService && readsSensor) {
        const profile = await memory.getProfile();

        if (profile?.integrations?.libreView?.email && profile?.integrations?.libreView?.password) {
          const { email, password, region } = profile.integrations.libreView;
          glucoService = new GlucoService({
            email,
            password,
            region: (region as any) || "us",
            lowThreshold: profile?.medical?.thresholds?.glucoseLow ?? 70,
            highThreshold: profile?.medical?.thresholds?.glucoseHigh ?? 180,
          });
          try {
            await glucoService.fetchLatest();
          } catch (e: any) {
            console.error("[GlucoTool] Error al obtener datos del sensor:", e.message);
          }
        }
      }

      switch (input.action) {
        case "current":
          return this.handleCurrent(glucoService, await this.lowGlucoseSuggestions(glucoService, memory));
        case "history":
          return this.handleHistory(glucoService, input.hours ?? 24);
        case "stats":
          return this.handleStats(glucoService, input.hours ?? 24);
        case "search_food":
          return await this.handleSearchFood(foodService, input.query ?? "");
        case "estimate_food":
          return this.handleEstimateFood(foodService, input.query ?? "", input.grams ?? 100);
        case "estimate_meal":
          return this.handleEstimateMeal(foodService, input.mealJson ?? "[]");
        default:
          return { output: "", error: "Acción no reconocida" };
      }
    } catch (err: any) {
      return {
        output: "",
        error: `GlucoTool error: ${err.message}`,
      };
    }
  }

  // ─── Handlers ─────────────────────────────────────────────────────

  /** Si el sensor marca bajo, arma opciones CONCRETAS (con lo que el usuario ya come) en vez de un consejo genérico. */
  private async lowGlucoseSuggestions(glucoService: GlucoService | null, memory: any): Promise<string> {
    const reading = glucoService?.getCurrent();
    if (!reading?.isLow) return "";
    try {
      const affinity = await loadAffinity(memory);
      const profile = await memory?.getProfile?.();
      const restrictions = deriveRestrictions(profile?.medical);
      return formatCarbOptions(15, "hipoglucemia",
        suggestCarbOptions({ grams: 15, purpose: "hipoglucemia", affinity, restrictions }),
        { restrictions, blocked: blockedFavorites(affinity, restrictions) });
    } catch {
      return "";
    }
  }

  private handleCurrent(glucoService: GlucoService | null, lowSuggestions = ""): ToolExecutionResult {
    if (!glucoService) {
      return {
        output:
          "⚠️ El sensor FreeStyle Libre no está configurado. " +
          "Configura tus credenciales de LibreLinkUp en la sección de Integraciones de tu Perfil.",
      };
    }

    const reading = glucoService.getCurrent();
    if (!reading) {
      return {
        output:
          "No hay datos de glucosa disponibles aún. " +
          "El sensor está sincronizando. Intenta nuevamente en 1-2 minutos.",
      };
    }

    const snapshot = glucoService.getSnapshot();
    const status = reading.isLow
      ? "⚠️ HIPOGLUCEMIA"
      : reading.isHigh
      ? "⚠️ HIPERGLUCEMIA"
      : "✅ En rango normal";

    const lastUpdated = snapshot.lastFetched.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });

    let output = `## 🩸 Glucosa Actual\n\n`;
    output += `**${reading.value} mg/dL** (${reading.valueInMmol} mmol/L) ${reading.trendArrow}\n`;
    output += `**Estado:** ${status}\n`;
    output += `**Tendencia:** ${this.trendLabel(reading.trend)}\n`;
    output += `**Actualizado:** ${lastUpdated}\n`;

    if (snapshot.sensorInfo) {
      const daysWorn = Math.floor(snapshot.sensorInfo.minutesWorn / 1440);
      output += `**Sensor:** ${snapshot.sensorInfo.serialNumber} · ${daysWorn} días activo\n`;
    }

    if (reading.isLow) {
      output += lowSuggestions
        ? `\n⚠️ **Tu glucosa está baja.**\n\n${lowSuggestions}\n\nPresenta estas opciones tal cual (alimentos y gramos reales), sin reducirlas a "azúcar rápida".`
        : "\n⚠️ **Tu glucosa está baja.** Considera consumir algo con azúcar rápido " +
          "(jugo, glucosa en tabletas). Consulta a tu médico si persiste.";
    } else if (reading.isHigh) {
      output +=
        "\n⚠️ **Tu glucosa está elevada.** Evita alimentos con alto índice glucémico. " +
        "Mantente activo y bien hidratado.";
    }

    return { output };
  }

  private handleHistory(glucoService: GlucoService | null, hours: number): ToolExecutionResult {
    if (!glucoService) {
      return { output: "⚠️ Sensor FreeStyle Libre no configurado." };
    }

    const readings = glucoService.getHistory(hours);
    if (readings.length === 0) {
      return { output: `No hay datos de glucosa de las últimas ${hours} horas.` };
    }

    const lines = readings.slice(-20).map((r) => {
      const time = r.timestamp.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const flag = r.isLow ? " ⬇️LOW" : r.isHigh ? " ⬆️HIGH" : "";
      return `  ${time} · ${r.value} mg/dL ${r.trendArrow}${flag}`;
    });

    return {
      output:
        `## 📊 Historial de Glucosa (últimas ${hours}h)\n\n` +
        `Mostrando las últimas ${lines.length} lecturas:\n` +
        lines.join("\n"),
    };
  }

  private handleStats(glucoService: GlucoService | null, hours: number): ToolExecutionResult {
    if (!glucoService) {
      return { output: "⚠️ Sensor FreeStyle Libre no configurado." };
    }

    const stats = glucoService.getStats(hours);
    if (!stats) {
      return { output: `No hay suficientes datos para las últimas ${hours}h.` };
    }

    const tirColor = stats.timeInRange >= 70 ? "✅" : stats.timeInRange >= 50 ? "🟡" : "🔴";

    return {
      output:
        `## 📈 Estadísticas de Glucosa (${hours}h)\n\n` +
        `**Promedio:** ${stats.avg} mg/dL\n` +
        `**Mínimo:** ${stats.min} mg/dL\n` +
        `**Máximo:** ${stats.max} mg/dL\n\n` +
        `**Tiempo en rango (70–180):** ${tirColor} ${stats.timeInRange}%\n` +
        `**Tiempo por encima (>180):** 🔴 ${stats.timeAbove}%\n` +
        `**Tiempo por debajo (<70):** 🔵 ${stats.timeBelow}%\n\n` +
        `*Meta recomendada: >70% en rango.*`,
    };
  }

  private async handleSearchFood(foodService: UnifiedFoodService | null, query: string): Promise<ToolExecutionResult> {
    if (!query) return { output: "", error: "Especifica un alimento a buscar" };

    if (!foodService) {
      return {
        output: "⚠️ Servicio de alimentos no disponible temporalmente.",
      };
    }

    const results = await foodService.searchFoods(query, 0, 8);

    if (results.items.length === 0) {
      return { output: `No se encontraron alimentos para "${query}".` };
    }

    const lines = results.items.map((item, i) => {
      const brand = item.brandName ? ` (${item.brandName})` : "";
      return `${i + 1}. **${item.name}**${brand} — ID: ${item.id}\n   ${item.description}`;
    });

    return {
      output:
        `## 🍽️ Resultados de búsqueda: "${query}"\n\n` +
        `Se encontraron ${results.totalResults} alimentos. Primeros ${results.items.length}:\n\n` +
        lines.join("\n\n"),
    };
  }

  /**
   * Un alimento con sus macros REALES (base local Chile → USDA → OFF) para esos gramos. Antes la estimación asumía que
   * CUALQUIER alimento tenía 50 g (un alimento) o 20 g (en una comida) de carbohidratos por cada 100 g: 200 g de pollo
   * salían con 40-100 g de carbohidratos y riesgo "alto". Si no está en la base, se usa ese valor genérico y se avisa.
   */
  private async entryFor(foodService: UnifiedFoodService | null, name: string, grams: number): Promise<{ entry: FoodEntry; generic: boolean }> {
    const food = foodService ? await resolveFood(foodService, name).catch(() => null) : null;
    if (food) {
      const serving = scaleServing(food.defaultServing, grams);
      return { entry: { food: { ...food, defaultServing: serving } as any, serving, portionMultiplier: 1 }, generic: false };
    }
    const f = grams / 100;
    const serving = {
      id: "manual", description: `${grams}g`, metricServingAmount: grams,
      calories: Math.round((20 * 4 + 5 * 4 + 3 * 9) * f), carbs: Math.round(20 * f), fiber: Math.round(2 * f),
      protein: Math.round(5 * f), fat: Math.round(3 * f),
    };
    return {
      entry: { food: { id: `manual_${name.replace(/\s/g, "_")}`, name, type: "Generic" as const, servings: [], defaultServing: serving } as any, serving, portionMultiplier: 1 },
      generic: true,
    };
  }

  private async handleEstimateFood(foodService: UnifiedFoodService | null, foodName: string, grams: number): Promise<ToolExecutionResult> {
    if (!foodName) return { output: "", error: "Especifica un alimento" };
    const riskLabel: Record<string, string> = {
      low: "🟢 Bajo",
      medium: "🟡 Moderado",
      high: "🔴 Alto",
      very_high: "🔴🔴 Muy Alto",
    };

    const { entry, generic } = await this.entryFor(foodService, foodName, grams);
    if (!generic) {
      const est = this.predictor.estimateMeal([entry]);
      const imp = est.impacts[0];
      const giNote = imp.giSource === "estimated" ? "\n*⚠️ Índice glucémico estimado (este alimento no está en la tabla de IG).*"
        : imp.giSource === "category_average" ? "\n*ℹ️ Índice glucémico promedio de su categoría.*" : "";
      return {
        output:
          `## 🩺 Estimación Glucémica: ${entry.food.name} (${grams}g)\n\n` +
          `**Carbohidratos:** ${entry.serving.carbs} g (fibra ${entry.serving.fiber} g)\n` +
          `**Índice Glucémico (GI):** ${imp.gi}\n` +
          `**Carga Glucémica (GL):** ${imp.gl} (ajustada por proteína y grasa: ${imp.adjustedGL})\n` +
          `**Impacto esperado:** ${riskLabel[est.mealRiskLevel]} · pico estimado +${est.estimatedGlucosePeak} mg/dL en ~${est.estimatedTimeToPeakMin} min` +
          giNote,
      };
    }

    const estimate = this.predictor.quickEstimate(foodName, grams);
    const sourceNote =
      estimate.source === "estimated"
        ? "\n*⚠️ GI estimado (alimento no encontrado en base de datos local).*"
        : estimate.source === "category_average"
        ? "\n*ℹ️ GI promedio por categoría de alimento.*"
        : "";

    return {
      output:
        `## 🩺 Estimación Glucémica: ${foodName} (${grams}g)\n\n` +
        `**Índice Glucémico (GI):** ${estimate.gi}\n` +
        `**Carga Glucémica (GL):** ${estimate.gl}\n` +
        `**Impacto esperado:** ${riskLabel[estimate.risk]}\n` +
        sourceNote +
        `\n\n*⚠️ No encontré "${foodName}" en la base de alimentos: asumí la mitad del peso en carbohidratos. Puede estar muy lejos; dime qué es exactamente o búscalo con search_food.*`,
    };
  }

  private async handleEstimateMeal(foodService: UnifiedFoodService | null, mealJson: string): Promise<ToolExecutionResult> {
    let mealItems: Array<{ name: string; grams: number }>;

    try {
      mealItems = JSON.parse(mealJson);
      if (!Array.isArray(mealItems)) throw new Error("Se esperaba un array");
    } catch {
      return {
        output: "",
        error: `JSON de comida inválido. Formato esperado: [{"name":"arroz blanco","grams":150},...]`,
      };
    }

    if (mealItems.length === 0) {
      return { output: "No se especificaron alimentos para la comida." };
    }

    const resolved = await Promise.all(mealItems.slice(0, 12).map(({ name, grams }) => this.entryFor(foodService, String(name), Number(grams) || 100)));
    const estimation = this.predictor.estimateMeal(resolved.map((r) => r.entry));
    const genericNames = new Set(resolved.filter((r) => r.generic).map((r) => r.entry.food.name));

    const impactLines = estimation.impacts.map(
      (imp) =>
        `  • **${imp.foodName}** — GI: ${imp.gi} · GL: ${imp.gl} · Ajustado: ${imp.adjustedGL}${genericNames.has(imp.foodName) ? " ≈ genérico (no está en la base)" : ""}`
    );

    return {
      output:
        `## 🍽️ Estimación Glucémica de la Comida\n\n` +
        `${estimation.summary}\n\n` +
        `### Desglose por alimento:\n${impactLines.join("\n")}\n\n` +
        `### Macros totales:\n` +
        `Calorías: ${estimation.macros.calories} kcal | ` +
        `Carbs: ${estimation.macros.carbs}g | ` +
        `Proteína: ${estimation.macros.protein}g | ` +
        `Grasa: ${estimation.macros.fat}g | ` +
        `Fibra: ${estimation.macros.fiber}g` +
        (genericNames.size ? `\n\n*⚠️ ${[...genericNames].join(", ")}: no lo encontré en la base, usé valores genéricos (pueden estar lejos).*` : ""),
    };
  }

  // ─── Helper ───────────────────────────────────────────────────────

  private trendLabel(trend: string): string {
    const labels: Record<string, string> = {
      rapidly_rising: "Subiendo rápido ↑↑",
      rising: "Subiendo ↑",
      slowly_rising: "Subiendo lentamente ↗",
      stable: "Estable →",
      slowly_falling: "Bajando lentamente ↘",
      falling: "Bajando ↓",
      rapidly_falling: "Bajando rápido ↓↓",
      unknown: "Desconocido",
    };
    return labels[trend] || trend;
  }
}
