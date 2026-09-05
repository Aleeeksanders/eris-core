// ============================================================
// Eris — NutritionTool
// Registro conversacional de nutrición e hidratación.
// Eris pregunta, el usuario describe, Eris busca y registra.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { UnifiedFoodService } from "../services/gluco/UnifiedFoodService.js";

// ─── Tipos ────────────────────────────────────────────────────────

export interface NutritionEntry {
  timestamp: string;
  mealType: string;
  items: Array<{
    name: string;
    grams: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  }>;
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
}

export interface HydrationEntry {
  timestamp: string;
  beverageType: string;
  liters: number;
  effectiveLiters: number;
}

// ─── Schema ───────────────────────────────────────────────────────

const NutritionInputSchema = z.object({
  action: z.enum([
    "log_meal",        // Registrar una comida (flujo principal)
    "log_water",       // Registrar agua o líquidos
    "get_daily_log",   // Consultar log del día
    "search_food",     // Buscar alimento
    "need_photo",      // Indicar que necesita foto para estimar
    "save_food",       // Guardar alimento en DB local y frecuentes sin registrar comida
  ]).describe("Acción a ejecutar"),

  mealType: z.enum([
    "desayuno",
    "colacion_am",
    "almuerzo",
    "once",
    "cena",
    "colacion_pm",
  ]).optional().describe("Tipo de comida"),

  items: z.array(z.object({
    name: z.string().describe("Nombre del alimento"),
    grams: z.number().describe("Gramos de la porción"),
  })).optional().describe("Lista de alimentos con sus porciones en gramos"),

  waterLiters: z.number().optional().describe("Litros de bebida a registrar"),
  beverageType: z.enum([
    "agua", "te_cafe", "jugo_natural", "jugo_artificial", "bebida_fantasia", "bebida_isotonica", "alcohol"
  ]).optional().describe("Tipo de bebida ingerida para calcular hidratación real"),
  searchQuery: z.string().optional().describe("Texto a buscar"),
});

type NutritionInput = z.infer<typeof NutritionInputSchema>;

// ─── Macros de referencia (por 100g) para alimentos comunes ──────
// Se usa cuando FatSecret no está configurado o para respuesta rápida

const COMMON_FOODS: Record<string, { cal: number; prot: number; carbs: number; fat: number; fiber: number }> = {
  // Carnes
  "pollo asado":     { cal: 165, prot: 31,  carbs: 0,   fat: 3.6, fiber: 0 },
  "pollo frito":     { cal: 260, prot: 26,  carbs: 9,   fat: 14,  fiber: 0 },
  "pechuga pollo":   { cal: 120, prot: 23,  carbs: 0,   fat: 2.6, fiber: 0 },
  "carne molida":    { cal: 250, prot: 26,  carbs: 0,   fat: 15,  fiber: 0 },
  "atun":            { cal: 132, prot: 29,  carbs: 0,   fat: 1,   fiber: 0 },
  "salmon":          { cal: 208, prot: 20,  carbs: 0,   fat: 13,  fiber: 0 },
  "huevo":           { cal: 155, prot: 13,  carbs: 1.1, fat: 11,  fiber: 0 },
  // Carbohidratos
  "arroz blanco":    { cal: 130, prot: 2.7, carbs: 28,  fat: 0.3, fiber: 0.4 },
  "arroz integral":  { cal: 112, prot: 2.6, carbs: 23,  fat: 0.9, fiber: 1.8 },
  "papa":            { cal: 77,  prot: 2,   carbs: 17,  fat: 0.1, fiber: 2.2 },
  "papas fritas":    { cal: 312, prot: 3.4, carbs: 41,  fat: 15,  fiber: 3.8 },
  "pasta":           { cal: 131, prot: 5,   carbs: 25,  fat: 1.1, fiber: 1.8 },
  "pan":             { cal: 265, prot: 9,   carbs: 49,  fat: 3.2, fiber: 2.7 },
  "arepa":           { cal: 218, prot: 4.5, carbs: 45,  fat: 2,   fiber: 1.5 },
  "tortilla maiz":   { cal: 218, prot: 5.7, carbs: 44,  fat: 2.5, fiber: 6 },
  // Verduras
  "ensalada":        { cal: 15,  prot: 1,   carbs: 2.5, fat: 0.2, fiber: 1.5 },
  "brocoli":         { cal: 34,  prot: 2.8, carbs: 7,   fat: 0.4, fiber: 2.6 },
  "zanahoria":       { cal: 41,  prot: 0.9, carbs: 10,  fat: 0.2, fiber: 2.8 },
  "tomate":          { cal: 18,  prot: 0.9, carbs: 3.9, fat: 0.2, fiber: 1.2 },
  // Frutas
  "manzana":         { cal: 52,  prot: 0.3, carbs: 14,  fat: 0.2, fiber: 2.4 },
  "banano":          { cal: 89,  prot: 1.1, carbs: 23,  fat: 0.3, fiber: 2.6 },
  "platano":         { cal: 89,  prot: 1.1, carbs: 23,  fat: 0.3, fiber: 2.6 },
  // Lácteos
  "leche":           { cal: 61,  prot: 3.2, carbs: 4.8, fat: 3.3, fiber: 0 },
  "yogur natural":   { cal: 59,  prot: 3.5, carbs: 4.7, fat: 3.3, fiber: 0 },
  "queso":           { cal: 402, prot: 25,  carbs: 1.3, fat: 33,  fiber: 0 },
  // Snacks/extras
  "aceite oliva":    { cal: 884, prot: 0,   carbs: 0,   fat: 100, fiber: 0 },
  "mantequilla":     { cal: 717, prot: 0.9, carbs: 0.1, fat: 81,  fiber: 0 },
  "avena":           { cal: 389, prot: 17,  carbs: 66,  fat: 7,   fiber: 10 },
};

function lookupMacros(name: string): typeof COMMON_FOODS[string] | null {
  const lower = name.toLowerCase();
  // Búsqueda exacta
  if (COMMON_FOODS[lower]) return COMMON_FOODS[lower];
  // Búsqueda parcial
  const key = Object.keys(COMMON_FOODS).find(k => lower.includes(k) || k.includes(lower.split(" ")[0]));
  return key ? COMMON_FOODS[key] : null;
}

// ─── Tool ─────────────────────────────────────────────────────────

export class NutritionTool extends Tool<NutritionInput> {
  readonly name = "nutrition_tracker";
  readonly description =
    "Herramienta de registro nutricional. " +
    "ACTIVAR SOLO cuando el usuario pida EXPLÍCITAMENTE registrar/anotar/guardar comida o agua: " +
    "verbos como 'registra', 'anota', 'guarda', 'agrega al log', 'log'. " +
    "Si el usuario MENCIONA comida o agua SIN pedir registro (ej: 'comí arroz', 'tomé agua', " +
    "'¿qué tiene de calorías X?'), NO usar esta herramienta — responder conversacionalmente " +
    "y preguntar si desea registrarlo. " +
    "También activar para consultar el log: 'qué he comido hoy', 'muéstrame mi log'. " +
    "Ejemplos correctos: 'registra mi almuerzo', 'anota 500ml de agua', 'guarda que comí pollo'. " +
    "Ejemplos donde NO usar: 'comí pollo hoy', 'tomé agua', '¿debo comer más proteína?'.";

  readonly inputSchema = NutritionInputSchema;

  async execute(input: NutritionInput, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    const wsClient = context?.wsClient;

    // Usar el UnifiedFoodService inyectado por el servidor (USDA + local Chile + OFF)
    const foodService: UnifiedFoodService | null = context?.foodService ?? null;

    switch (input.action) {
      case "search_food":
        return this.handleSearch(foodService, input.searchQuery || "");
      case "save_food":
        return this.handleSaveFood(input, memory, foodService);
      case "log_meal":
        return this.handleLogMeal(input, memory, wsClient, foodService);
      case "log_water":
        return this.handleLogWater(input.waterLiters || 0.25, input.beverageType || "agua", memory, wsClient);
      case "get_daily_log":
        return this.handleGetLog(memory);
      case "need_photo":
        return {
          output:
            "\ud83d\udcf8 No pude estimar bien las cantidades de lo que describes. " +
            "\u00bfTienes una foto del plato? Puedes enviarla aqu\u00ed y la analizar\u00e9 para calcular los macros. " +
            "\n\n*Si no tienes foto, dime las cantidades aproximadas en gramos " +
            "(ej: '200g de arroz, 150g de pollo') y lo registro.*",
        };
      default:
        return { output: "", error: "Acción no reconocida" };
    }
  }

  // ─── Buscar alimento ──────────────────────────────────────────────
  private async handleSearch(foodService: UnifiedFoodService | null, query: string): Promise<ToolExecutionResult> {
    if (!query) return { output: "Especifica qué alimento buscar." };

    // UnifiedFoodService: Local Chile → USDA → OFF
    if (foodService) {
      try {
        const results = await foodService.searchFoods(query, 0, 5);
        if (results.items.length > 0) {
          const lines = await Promise.all(
            results.items.slice(0, 4).map(async (item) => {
              // Items locales (cl:) → traer macros exactos
              if (item.id.startsWith("cl:")) {
                try {
                  const full = await foodService.getFoodById(item.id);
                  const s = full.defaultServing;
                  return `• **${full.name}** — ${s.description}: ${s.calories} kcal | Prot: ${s.protein}g | Carbs: ${s.carbs}g | Grasa: ${s.fat}g`;
                } catch { /* continúa con descripción */ }
              }
              return `• **${item.name}** — ${item.description}`;
            })
          );
          return { output: `## Resultados para "${query}":\n${lines.join("\n")}` };
        }
      } catch {}
    }

    // Fallback: COMMON_FOODS hardcodeado
    const local = lookupMacros(query);
    if (local) {
      return {
        output:
          `📊 **${query}** (por 100g):\n` +
          `- Calorías: ${local.cal} kcal\n` +
          `- Proteína: ${local.prot}g\n` +
          `- Carbohidratos: ${local.carbs}g\n` +
          `- Grasas: ${local.fat}g\n` +
          `- Fibra: ${local.fiber}g`,
      };
    }

    return {
      output:
        `No encontré datos exactos para "${query}". ` +
        `Dime la porción aproximada y usaré valores de referencia para estimarlo.`,
    };
  }

  // ─── Guardar alimento (sin registrar comida) ────────────────────
  private async handleSaveFood(input: NutritionInput, memory: any, foodService: UnifiedFoodService | null): Promise<ToolExecutionResult> {
    if (!foodService) return { output: "No hay base de datos conectada." };
    if (!input.items || input.items.length === 0) return { output: "Especifica qué alimento guardar." };
    
    let saved = 0;
    for (const item of input.items) {
      try {
        const res = await foodService.searchFoods(item.name, 0, 1);
        if (res.items.length > 0) {
          const fullFood = await foodService.getFoodById(res.items[0].id);
          if (fullFood.id.startsWith("usda:") || fullFood.id.startsWith("off:")) {
            await foodService.saveToLocalDB(fullFood, [item.name]);
          }
          if (memory) {
            await this.addToFrequentFoods(memory, fullFood.name, fullFood.id);
          }
          saved++;
        }
      } catch (e) {
        console.warn("[NutritionTool] Error en save_food para", item.name, e);
      }
    }
    return { output: `Guardé ${saved} alimento(s) en la base de datos local y alimentos frecuentes.` };
  }

  // ─── Registrar comida ─────────────────────────────────────────────
  private async handleLogMeal(
    input: NutritionInput,
    memory: any,
    wsClient: any,
    foodService: UnifiedFoodService | null
  ): Promise<ToolExecutionResult> {
    if (!input.items || input.items.length === 0) {
      return {
        output: "Necesito saber qué comiste. Descríbeme los alimentos y las cantidades en gramos.",
      };
    }
    if (!input.mealType) {
      return {
        output: "¿Qué tipo de comida fue? (desayuno / colación AM / almuerzo / once / cena / colación PM)",
      };
    }

    const MEAL_LABELS: Record<string, string> = {
      desayuno: "🌅 Desayuno",
      colacion_am: "🍎 Colación AM",
      almuerzo: "☀️ Almuerzo",
      once: "☕ Once",
      cena: "🌙 Cena",
      colacion_pm: "🍪 Colación PM",
    };

    // Calcular macros de cada ítem
    const resolvedItems: NutritionEntry["items"] = [];

    for (const item of input.items) {
      const factor = item.grams / 100;
      let resolved = false;

      // 1. UnifiedFoodService: Local Chile DB → USDA → OFF (prioridad máxima)
      if (foodService) {
        try {
          const res = await foodService.searchFoods(item.name, 0, 1);
          if (res.items.length > 0) {
            const fullFood = await foodService.getFoodById(res.items[0].id);
            const serving = fullFood.defaultServing;
            const servingGrams = serving.metricServingAmount || 100;
            const normFactor = item.grams / servingGrams;
            resolvedItems.push({
              name: fullFood.name,
              grams: item.grams,
              calories: Math.round(serving.calories * normFactor),
              protein:  Math.round(serving.protein  * normFactor * 10) / 10,
              carbs:    Math.round(serving.carbs    * normFactor * 10) / 10,
              fat:      Math.round(serving.fat      * normFactor * 10) / 10,
              fiber:    Math.round((serving.fiber || 0) * normFactor * 10) / 10,
            });
            resolved = true;

            // Si vino de USDA u OFF, guardarlo en la base local para no repetir búsqueda a API
            if (fullFood.id.startsWith("usda:") || fullFood.id.startsWith("off:")) {
              await foodService.saveToLocalDB(fullFood, [item.name]).catch(() => {});
            }
            
            if (memory) {
              await this.addToFrequentFoods(memory, fullFood.name, fullFood.id);
            }
          }
        } catch (e) {
          console.warn("[NutritionTool] foodService error para", item.name, e);
        }
      }

      // 2. Fallback: COMMON_FOODS hardcodeado
      if (!resolved) {
        const macros = lookupMacros(item.name);
        if (macros) {
          resolvedItems.push({
            name: item.name,
            grams: item.grams,
            calories: Math.round(macros.cal   * factor),
            protein:  Math.round(macros.prot  * factor * 10) / 10,
            carbs:    Math.round(macros.carbs * factor * 10) / 10,
            fat:      Math.round(macros.fat   * factor * 10) / 10,
            fiber:    Math.round(macros.fiber * factor * 10) / 10,
          });
        } else {
          resolvedItems.push(this.genericItem(item));
        }
      }
    }

    // Calcular totales
    const totals = resolvedItems.reduce(
      (acc, i) => ({
        calories: acc.calories + i.calories,
        protein:  Math.round((acc.protein  + i.protein)  * 10) / 10,
        carbs:    Math.round((acc.carbs    + i.carbs)    * 10) / 10,
        fat:      Math.round((acc.fat      + i.fat)      * 10) / 10,
        fiber:    Math.round((acc.fiber    + i.fiber)    * 10) / 10,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    );

    const entry: NutritionEntry = {
      timestamp: new Date().toISOString(),
      mealType: input.mealType,
      items: resolvedItems,
      totals,
    };

    // Guardar en memoria del perfil
    if (memory) {
      try {
        const today = new Date().toDateString();
        const key = `nutrition_log_${today}`;
        const existing = await memory.get(key).catch(() => []);
        const log = Array.isArray(existing) ? existing : [];
        await memory.set(key, [...log, entry]);
      } catch (e) {
        console.warn("[NutritionTool] Error guardando en memoria:", e);
      }
    }

    // Push al móvil vía WebSocket para que NutritionScreen se actualice
    if (wsClient) {
      try {
        wsClient.send(JSON.stringify({
          type: "nutrition_logged",
          entry,
        }));
      } catch {}
    }

    // Construir respuesta
    const itemLines = resolvedItems.map(
      (i) => `• **${i.name}** (${i.grams}g) — ${i.calories} kcal`
    );

    const hasEstimated = resolvedItems.some(
      (i) => !lookupMacros(i.name)
    );

    let output =
      `✅ **${MEAL_LABELS[input.mealType]} registrado**\n\n` +
      itemLines.join("\n") +
      `\n\n**Total:** ${totals.calories} kcal | ` +
      `Prot: ${totals.protein}g | Carbos: ${totals.carbs}g | Grasas: ${totals.fat}g`;

    if (hasEstimated) {
      output += "\n\n*⚠️ Algunos valores son estimaciones. Si quieres mayor precisión, dime si tienes foto del plato.*";
    }

    return { output };
  }

  // ─── Registrar hidratación ───────────────────────────────────────────────
  private async handleLogWater(liters: number, beverageType: string, memory: any, wsClient: any): Promise<ToolExecutionResult> {
    const coefficients: Record<string, number> = {
      "agua": 1.0,
      "te_cafe": 0.8,
      "bebida_isotonica": 0.9,
      "jugo_natural": 0.8,
      "jugo_artificial": 0.6,
      "bebida_fantasia": 0.6,
      "alcohol": -0.5
    };
    
    const coef = coefficients[beverageType] ?? 1.0;
    const effectiveLiters = Math.round(liters * coef * 100) / 100;

    const entry: HydrationEntry = {
      timestamp: new Date().toISOString(),
      beverageType,
      liters,
      effectiveLiters
    };

    if (memory) {
      try {
        const today = new Date().toDateString();
        const key = `hydration_log_${today}`;
        const existing = await memory.get(key).catch(() => []);
        const log = Array.isArray(existing) ? existing : [];
        await memory.set(key, [...log, entry]);
      } catch {}
    }

    if (wsClient) {
      try {
        wsClient.send(JSON.stringify({ type: "hydration_logged", entry }));
      } catch {}
    }

    const ml = Math.round(liters * 1000);
    const effMl = Math.round(effectiveLiters * 1000);
    const typeLabel = beverageType.replace("_", " ");
    
    let msg = `💧 Registrado: ${ml < 1000 ? `${ml}ml` : `${liters}L`} de ${typeLabel}. `;
    if (coef !== 1.0) {
      msg += `(Hidratación efectiva: ${effMl < 1000 ? `${effMl}ml` : `${effectiveLiters}L`})`;
    } else {
      msg += `¡Buen hábito, sigue así!`;
    }

    return { output: msg };
  }

  // ─── Log del día ──────────────────────────────────────────────────
  private async handleGetLog(memory: any): Promise<ToolExecutionResult> {
    if (!memory) return { output: "No hay log disponible." };

    try {
      const today = new Date().toDateString();
      const log: NutritionEntry[] = await memory.get(`nutrition_log_${today}`).catch(() => []);
      const waterLog: HydrationEntry[] = await memory.get(`hydration_log_${today}`).catch(() => []);

      if (!Array.isArray(log) || log.length === 0) {
        return { output: "No has registrado ninguna comida hoy todavía." };
      }

      const grandTotal = log.reduce(
        (acc, entry) => ({
          calories: acc.calories + entry.totals.calories,
          protein:  Math.round((acc.protein  + entry.totals.protein)  * 10) / 10,
          carbs:    Math.round((acc.carbs    + entry.totals.carbs)    * 10) / 10,
          fat:      Math.round((acc.fat      + entry.totals.fat)      * 10) / 10,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      );

      const totalWater = Array.isArray(waterLog)
        ? Math.round(waterLog.reduce((s, e) => s + (e.effectiveLiters ?? e.liters), 0) * 100) / 100
        : 0;
      
      const totalLitersRaw = Array.isArray(waterLog)
        ? Math.round(waterLog.reduce((s, e) => s + e.liters, 0) * 100) / 100
        : 0;

      const MEAL_LABELS: Record<string, string> = {
        desayuno: "🌅", colacion_am: "🍎", almuerzo: "☀️",
        once: "☕", cena: "🌙", colacion_pm: "🍪",
      };

      const mealLines = log.map((entry) => {
        const icon = MEAL_LABELS[entry.mealType] || "🍽️";
        const label = entry.mealType.replace("_", " ");
        const items = entry.items.map((i) => `  • ${i.name} (${i.grams}g) — ${i.calories} kcal`).join("\n");
        return `**${icon} ${label}** — ${entry.totals.calories} kcal\n${items}`;
      });

      return {
        output:
          `## 📋 Registro de hoy\n\n` +
          mealLines.join("\n\n") +
          `\n\n---\n**Total del día:** ${grandTotal.calories} kcal | ` +
          `Prot: ${grandTotal.protein}g | Carbos: ${grandTotal.carbs}g | Grasas: ${grandTotal.fat}g\n` +
          (totalWater > 0 ? `💧 **Hidratación Efectiva:** ${totalWater}L (Ingesta total: ${totalLitersRaw}L)` : "💧 No has registrado líquidos hoy."),
      };
    } catch {
      return { output: "No pude acceder al log de hoy." };
    }
  }

  // ─── Ítem genérico cuando no hay datos ───────────────────────────
  private genericItem(item: { name: string; grams: number }): NutritionEntry["items"][0] {
    const factor = item.grams / 100;
    return {
      name: item.name,
      grams: item.grams,
      calories: Math.round(150 * factor),  // promedio genérico
      protein:  Math.round(8   * factor * 10) / 10,
      carbs:    Math.round(20  * factor * 10) / 10,
      fat:      Math.round(5   * factor * 10) / 10,
      fiber:    Math.round(2   * factor * 10) / 10,
    };
  }

  // ─── Añadir a Frecuentes ──────────────────────────────────────────
  private async addToFrequentFoods(memory: any, name: string, id: string): Promise<void> {
    try {
      const key = "frequent_foods";
      const existing = await memory.get(key).catch(() => ({}));
      const freqs = typeof existing === "object" ? existing : {};
      
      const entryName = name.toLowerCase();
      if (!freqs[entryName]) {
        freqs[entryName] = { count: 0, id };
      }
      
      freqs[entryName].count += 1;
      freqs[entryName].lastSeen = new Date().toISOString();
      
      await memory.set(key, freqs);
    } catch (e) {
      console.warn("[NutritionTool] Error guardando frecuentes", e);
    }
  }
}
