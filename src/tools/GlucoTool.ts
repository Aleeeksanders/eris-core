// ============================================================
// Eris — GlucoTool
// Tool del agente para consultar glucosa y comidas
// Permite a Eris razonar sobre el estado metabólico del usuario
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { GlucoService } from "../services/gluco/GlucoService.js";
import { UnifiedFoodService } from "../services/gluco/UnifiedFoodService.js";
import { GlucoPredictorService } from "../services/gluco/GlucoPredictorService.js";

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

      // Preferir el servicio cacheado (ya autenticado y con datos recientes)
      // que el servidor mantiene activo via polling.
      let glucoService: GlucoService | null = context?.glucoService || null;
      const foodService: UnifiedFoodService | null = context?.foodService ?? null;

      if (!glucoService) {
        const profile = await memory.getProfile();

        if (profile?.integrations?.libreView?.email && profile?.integrations?.libreView?.password) {
          const { email, password, region } = profile.integrations.libreView;
          glucoService = new GlucoService({
            email,
            password,
            region: (region as any) || "us",
            lowThreshold: 70,
            highThreshold: 180,
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
          return this.handleCurrent(glucoService);
        case "history":
          return this.handleHistory(glucoService, input.hours ?? 24);
        case "stats":
          return this.handleStats(glucoService, input.hours ?? 24);
        case "search_food":
          return await this.handleSearchFood(foodService, input.query ?? "");
        case "estimate_food":
          return this.handleEstimateFood(input.query ?? "", input.grams ?? 100);
        case "estimate_meal":
          return this.handleEstimateMeal(input.mealJson ?? "[]");
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

  private handleCurrent(glucoService: GlucoService | null): ToolExecutionResult {
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
      output +=
        "\n⚠️ **Tu glucosa está baja.** Considera consumir algo con azúcar rápido " +
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

  private handleEstimateFood(foodName: string, grams: number): ToolExecutionResult {
    if (!foodName) return { output: "", error: "Especifica un alimento" };

    const estimate = this.predictor.quickEstimate(foodName, grams);
    const riskLabel: Record<string, string> = {
      low: "🟢 Bajo",
      medium: "🟡 Moderado",
      high: "🔴 Alto",
      very_high: "🔴🔴 Muy Alto",
    };

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
        `\n\n*Nota: Para mayor precisión, usa estimate_meal con los datos nutricionales completos de search_food.*`,
    };
  }

  private handleEstimateMeal(mealJson: string): ToolExecutionResult {
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

    // Construir FoodEntry simulados con estimación de macros por 100g
    const entries = mealItems.map(({ name, grams }) => {
      const { gi } = this.predictor["lookupGI"](name);

      // Macros estimados base por 100g (promedio genérico)
      const baseCarbs = 20;
      const baseFiber = 2;
      const baseProtein = 5;
      const baseFat = 3;
      const baseCalories = baseCarbs * 4 + baseProtein * 4 + baseFat * 9;

      const factor = grams / 100;

      return {
        food: {
          id: `manual_${name.replace(/\s/g, "_")}`,
          name,
          type: "Generic" as const,
          servings: [],
          defaultServing: {
            id: "manual",
            description: `${grams}g`,
            calories: Math.round(baseCalories * factor),
            carbs: Math.round(baseCarbs * factor),
            fiber: Math.round(baseFiber * factor),
            protein: Math.round(baseProtein * factor),
            fat: Math.round(baseFat * factor),
          },
        },
        serving: {
          id: "manual",
          description: `${grams}g`,
          calories: Math.round(baseCalories * factor),
          carbs: Math.round(baseCarbs * factor),
          fiber: Math.round(baseFiber * factor),
          protein: Math.round(baseProtein * factor),
          fat: Math.round(baseFat * factor),
        },
        portionMultiplier: 1,
      };
    });

    const estimation = this.predictor.estimateMeal(entries);

    const impactLines = estimation.impacts.map(
      (imp) =>
        `  • **${imp.foodName}** — GI: ${imp.gi} · GL: ${imp.gl} · Ajustado: ${imp.adjustedGL}`
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
        `Fibra: ${estimation.macros.fiber}g\n\n` +
        `*⚠️ Estimación basada en macros genéricos. Para mayor precisión, usa search_food primero.*`,
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
