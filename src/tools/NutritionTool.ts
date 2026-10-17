// ============================================================
// Eris — NutritionTool
// Registro conversacional de nutrición e hidratación.
// Eris pregunta, el usuario describe, Eris busca y registra.
// ============================================================

import { assessFood, formatRisks, type ItemRisk } from "../services/FoodSafetyCheck.js";
import { deriveRestrictions } from "../services/DietaryRestrictions.js";
import { resolveFood, correctFoodName, foodFit } from "../services/FoodResolve.js";
import { waterToday, waterLine, fmtLiters } from "../services/WaterToday.js";
import { beverageTypeOf, amountText } from "../services/Beverage.js";
import { itemWaterL } from "../services/FoodWater.js";
import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { UnifiedFoodService } from "../services/gluco/UnifiedFoodService.js";
import { formatGuidanceForLLM } from "../services/MedicalKnowledgeBase.js";
import type { MedicalProfile } from "../memory.js";
import { parseWaterMessage } from "../services/WaterParse.js";
import { dayCtxFrom, nutritionDayKey } from "../services/MealSchedule.js";
import { todayKeyOf } from "../services/NutritionDay.js";
import { parseFoodMessage, parseMultiMealMessage, parseDeleteMessage, parseWhatIfMessage, mealTimingOf, pastDayOf, pastMealTimingOf, mentionedMeals, type MealType, saidGramsFor, asksToLog, unmentionedItems, otherDayOf, foodNameMatches, dayQueryOf, LAST_ENTRY } from "../services/FoodParse.js";
import { buildWhatIf, formatWhatIf, type WhatIfFood } from "../services/WhatIfFood.js";
import { isPure } from "../services/Intent.js";
import { loadTargets } from "../services/DailyTargets.js";
import { applyGoalUpdate, upsertChatRollup, addToPastRollup, dayEntries, dayTotals, itemKey, removeItem, type LogEntry } from "../services/NutritionLog.js";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");

// ─── Tipos ────────────────────────────────────────────────────────

export interface NutritionEntry {
  timestamp: string;
  mealType: string;
  /** Cuándo se anotó (timestamp es cuándo se comió). */
  loggedAt?: string;
  /** La hora de la comida es la típica (se anotó después sin decir la hora). */
  approxTime?: boolean;
  /** Anotada por chat para un día anterior («ayer cené…»): el teléfono la trae aparte (sync_nutrition_days). */
  pastDay?: boolean;
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
    "set_nutritional_goals", // Fijar metas ideales para el usuario
    "delete_entry",    // Borrar una comida ya registrada hoy (por nombre, vía searchQuery)
    "simulate",        // «¿Y si me como X?»: cómo cambiaría su día, SIN anotarlo (services/WhatIfFood.ts)
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
    // Opcional (2026-10-16): el modelo a veces no ponía gramos, la validación fallaba y terminaba buscando en internet (59 s).
    // Sin gramos, la herramienta usa lo que dijo la persona («3 empanadas») o una porción normal de la base.
    grams: z.number().optional().describe("Gramos de la porción. Si el usuario no dijo cantidad, OMÍTELO: uso una porción normal."),
    macros_override: z.object({
      calories: z.number(),
      protein: z.number(),
      carbs: z.number(),
      fat: z.number(),
    }).optional().describe("Solo si log_meal ya te dijo que no encontró el alimento: sus macros por CADA 100 g, buscadas con web_search.")
  })).optional().describe("Lista de alimentos con sus porciones en gramos"),

  goals: z.object({
    calories: z.number().optional(),
    protein: z.number().optional(),
    carbs: z.number().optional(),
    fat: z.number().optional(),
    waterLiters: z.number().optional(),
  }).optional().describe("Metas nutricionales ideales configuradas cuando la acción es set_nutritional_goals"),

  waterLiters: z.number().optional().describe("Litros de bebida a registrar"),
  beverageType: z.enum([
    "agua", "te_cafe", "jugo_natural", "jugo_artificial", "bebida_fantasia", "bebida_isotonica", "alcohol"
  ]).optional().describe("Tipo de bebida ingerida para calcular hidratación real"),
  assumed: z.string().optional(), // interno: aviso de tamaño asumido (lo pone el reconocimiento por código; no es un parámetro para el modelo)
  otherDay: z.string().optional(), // interno: "ayer", "anoche"… (lo pone el reconocimiento por código): no se registra
  corrected: z.array(z.string()).optional(), // interno: nombres tomados con un error de tipeo (lo pone el reconocimiento por código)
  said: z.string().max(200).optional(), // interno: cómo nombró lo que piensa comer («un completo»), para simulate (lo pone el reconocimiento por código)
  focus: z.enum(["water"]).optional(), // interno: get_daily_log solo del agua ("¿cuánta agua llevo?")
  // interno: varias comidas en un mensaje («3 empanadas para la cena y una para la once»), cada una con su frase (FoodParse.parseMultiMealMessage)
  multi: z.array(z.object({
    mealType: z.enum(["desayuno", "colacion_am", "almuerzo", "once", "cena", "colacion_pm"]),
    items: z.array(z.object({ name: z.string(), grams: z.number() })),
    said: z.string().max(300),
    corrected: z.array(z.string()).optional(),
  })).optional(),
  noProgress: z.boolean().optional(), // interno: sin la línea «llevas X de Y» (en varias comidas va solo en la última)
  // interno: la respuesta a «¿en qué comida de ayer fue?» (la comida elegida manda y se usa el mensaje original)
  fixedMeal: z.boolean().optional(),
  origMessage: z.string().max(400).optional(),
  searchQuery: z.string().optional().describe("Texto a buscar (search_food) o nombre del alimento a borrar del log de hoy (delete_entry) — coincide por substring, sin distinguir mayúsculas."),
});

type NutritionInput = z.infer<typeof NutritionInputSchema>;

export { beverageTypeOf };

/**
 * Aviso del azúcar de una bebida (la hidratación cuenta igual que el agua; el azúcar es lo que hay que mirar). Zero, light o sin
 * azúcar: nada que avisar. Gramos aproximados por 100 ml: gaseosa 10,6 · jugo natural 9 · néctar o jugo envasado 11.
 */
export function sugarNote(beverageType: string, ml: number, userMessage?: string): string {
  const t = String(userMessage ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(zero|light|diet|sin azucar|cero azucar|0 azucar)\b/.test(t)) return beverageType === "bebida_fantasia" ? "Las bebidas zero hidratan igual que el agua." : "";
  const per100: Record<string, number> = { bebida_fantasia: 10.6, jugo_natural: 9, jugo_artificial: 11 };
  const g = per100[beverageType];
  if (!g || ml < 100) return "";
  const sugar = Math.round((g * ml) / 100);
  return `Hidrata igual que el agua, pero trae ~${sugar} g de azúcar (~${Math.round(sugar * 4)} kcal). Si quieres, también lo anoto como comida.`;
}

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
    "Herramienta de registro nutricional (comida y agua). " +
    "Úsala cuando el usuario pida registrar/anotar/ingresar comida o agua, y TAMBIÉN cuando cuente lo que ya comió " +
    "('comí 2 empanadas', 'almorcé cazuela', 'tomé once con hallulla'): contarlo es pedir que se anote. " +
    "NO la uses para preguntas ('¿cuántas calorías tiene X?', '¿debo comer más proteína?') ni para planes ('voy a comer…'). " +
    "Si no dice cuánto ('comí harto pan'), pregúntale la cantidad antes de registrar. " +
    "Registra lo de hoy, ayer o anteayer ('ayer cené…', 'anoche me comí…'): llámala igual, la herramienta lo deja en ese día " +
    "(y pregunta en qué comida fue si no lo dijo). Lo más antiguo se agrega en Nutrición de la app. " +
    "Consultar el día: get_daily_log ('qué he comido hoy', 'cuánto llevo'). " +
    "Llama log_meal PRIMERO con el nombre tal cual lo dijo («completo italiano sin mayo»): las bases traen platos chilenos, de " +
    "restaurante y marcas. Usa web_search SOLO si log_meal te responde que no lo encontró, y vuelve a llamarla con macros_override (por 100 g). " +
    "Si pide calcular o fijar un IDEAL o META nutricional, usa set_nutritional_goals. " +
    "Agua (log_water): SOLO bebidas, cada una con su tipo (una gaseosa, normal o zero, es bebida_fantasia, no agua). Los alimentos " +
    "(yogur, fruta, sopa, jalea) se anotan como comida con log_meal: el agua que traen se suma sola según su composición, NO llames log_water por ellos. " +
    "Para BORRAR/QUITAR/CORREGIR algo registrado hoy ('borra la coca-cola', 'saca las sopaipillas'), usa delete_entry con searchQuery = el alimento; " +
    "para 'borra lo último', searchQuery = 'último'. Borra solo ese alimento, no la comida completa. " +
    "Si pregunta qué pasaría si come algo ('¿y si me como un completo?', '¿puedo comerme 2 empanadas?', '¿me conviene…?'), " +
    "usa simulate con items: calcula cómo cambia la calidad de su día y qué le convendría más, SIN anotar nada.";

  readonly inputSchema = NutritionInputSchema;

  /**
   * Se registra por código, sin el modelo, cuando no hay ambigüedad: «tomé 500 ml de agua» (services/WaterParse.ts) y
   * «registra 1 ½ hallulla con 4 huevos revueltos para el desayuno» (services/FoodParse.ts). Lo demás sigue igual.
   */
  async preroute(message: string, context?: any): Promise<Record<string, unknown> | null> {
    const w = parseWaterMessage(message);
    if (w) return { ...w };
    const foodService: UnifiedFoodService | null = context?.foodService ?? null;
    if (!foodService) return null;
    // Respuesta a «¿En qué comida de ayer fue?» (botones Desayuno · Almuerzo · Once · Cena): se anota lo que pidió antes
    if (context?.memory && /en qu[eé] comida de (ayer|anteayer)/i.test(String(context?.lastAssistantMessage ?? ""))) {
      const pend: any = await context.memory.get("food_pending_day").catch(() => null);
      const meal = mentionedMeals(message)[0];
      if (pend?.items?.length && meal && Date.now() - new Date(pend.at).getTime() <= 10 * 60_000) {
        await context.memory.set("food_pending_day", { at: 0 }).catch(() => {});
        return { action: "log_meal", items: pend.items, mealType: meal, otherDay: pend.word, fixedMeal: true, origMessage: pend.message, ...(pend.corrected?.length ? { corrected: pend.corrected } : {}) };
      }
    }
    const lookup = async (q: string) => foodService.searchLocal(q);
    // "¿y si me como un completo?": se simula, no se anota (services/WhatIfFood.ts)
    const wi = await parseWhatIfMessage(message, lookup);
    if (wi) return { ...wi };
    // «3 empanadas para la cena y una para la once»: antes iba al modelo y tardaba hasta 98 s (banco de pruebas 2026-10-16)
    const mm = await parseMultiMealMessage(message, lookup);
    if (mm) return { ...mm };
    const f = await parseFoodMessage(message, lookup);
    if (f) return { ...f };
    // "borra la empanada", "me equivoqué, borra lo último" (esto último solo si lo anterior de Eris fue anotar comida)
    const d = await parseDeleteMessage(message, lookup, context?.lastAssistantMessage);
    if (d) return { ...d };
    // "¿qué he comido hoy?", "¿cuánta agua llevo?": respuesta al instante, sin el modelo
    const q = dayQueryOf(message);
    return q ? { action: "get_daily_log", ...(q === "water" ? { focus: "water" } : {}) } : null;
  }

  async execute(input: NutritionInput, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    const wsClient = context?.wsClient;

    // Usar el UnifiedFoodService inyectado por el servidor (USDA + local Chile + OFF)
    const foodService: UnifiedFoodService | null = context?.foodService ?? null;
    const medical: MedicalProfile | undefined = memory
      ? (await memory.getProfile?.().catch(() => null))?.medical
      : undefined;

    switch (input.action) {
      case "search_food": {
        // Nombres de productos de Open Food Facts los escribe cualquiera: se tratan como contenido no confiable
        const r = await this.handleSearch(foodService, input.searchQuery || "", medical);
        return { ...r, metadata: { ...(r.metadata ?? {}), untrusted: true } };
      }
      case "save_food":
        return this.handleSaveFood(input, memory, foodService);
      case "log_meal": {
        if (!input.multi?.length) return this.handleLogMeal(input, memory, wsClient, foodService, medical, input.origMessage ?? context?.userMessage);
        // Una comida tras otra, cada una con su propia frase (cantidades y hora de ese tramo); «llevas X de Y» solo al final.
        // «ayer en el almuerzo X y en la cena Y»: el día vale para todas.
        const day = otherDayOf(context?.userMessage);
        const parts: ToolExecutionResult[] = [];
        for (const [i, m] of input.multi.entries()) {
          parts.push(await this.handleLogMeal(
            { action: "log_meal", mealType: m.mealType, items: m.items, ...(m.corrected ? { corrected: m.corrected } : {}), ...(day ? { otherDay: day } : {}), noProgress: i < input.multi.length - 1 },
            memory, wsClient, foodService, medical, m.said));
        }
        const quick = isPure(context?.userMessage, ["food"]) && parts.every((p) => typeof p.metadata?.quickReply === "string");
        return {
          output: parts.map((p) => p.output || p.error || "").filter(Boolean).join("\n\n"),
          ...(parts.some((p) => p.error) ? { error: parts.map((p) => p.error).filter(Boolean).join(" ") } : {}),
          metadata: quick ? { quickReply: parts.map((p) => p.metadata!.quickReply).join("\n\n") } : undefined,
        };
      }
      case "log_water":
        return this.handleLogWater(input.waterLiters || 0.25, input.beverageType || "agua", memory, wsClient, context?.userMessage, (input as any).assumed);
      case "get_daily_log":
        return input.focus === "water" ? this.handleWaterToday(memory, context?.userMessage) : this.handleGetLog(memory, medical, context?.userMessage);
      case "delete_entry":
        return this.handleDeleteEntry(input.searchQuery || "", memory, wsClient, foodService, medical, context?.userMessage);
      case "set_nutritional_goals":
        return this.handleSetGoals(input.goals, memory, medical, wsClient);
      case "simulate":
        return this.handleSimulate(input, memory, foodService, medical, context?.userMessage);
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

  // ─── «¿Y si me como…?» ────────────────────────────────────────────
  // El mismo cálculo de la tarjeta de calidad de la app, con y sin lo que piensa comer (services/WhatIfFood.ts). No se
  // anota nada y no se inventa: si un alimento no está en las bases, queda fuera de la cuenta y se dice.
  private async handleSimulate(input: NutritionInput, memory: any, foodService: UnifiedFoodService | null, medical?: MedicalProfile, userMessage?: string): Promise<ToolExecutionResult> {
    const quick = (msg: string) => ({ output: msg, metadata: { notLogged: true, ...(isPure(userMessage, ["food"]) ? { quickReply: msg } : {}) } });
    if (!input.items?.length) return quick("¿Qué piensas comer? Dime el alimento y cuánto («un completo», «200 g de arroz con pollo») y te muestro cómo cambia tu día.");
    if (!memory) return { output: "", error: "Sin perfil no puedo simular el día." };
    const restrictions = deriveRestrictions(medical);
    const foods: WhatIfFood[] = [];
    const risks: ItemRisk[] = [];
    const missing: string[] = [];
    const notes: string[] = [];
    if ((input as any).assumed) notes.push(String((input as any).assumed));
    for (const c of Array.isArray((input as any).corrected) ? (input as any).corrected : []) notes.push(`Entendí ${c}.`);
    for (const item of input.items) {
      let hit = foodService ? await resolveFood(foodService, item.name).catch(() => null) : null;
      if (!hit && foodService) {
        const fixed = correctFoodName(item.name);
        hit = fixed ? await resolveFood(foodService, fixed).catch(() => null) : null;
        if (hit) notes.push(`Entendí «${item.name}» como ${hit.name}.`);
      }
      if (!hit) { missing.push(item.name); continue; }
      const s = hit.defaultServing;
      const k = 100 / (s.metricServingAmount || 100);
      foods.push({
        name: hit.name, grams: item.grams ?? (s.metricServingAmount || 100),
        per100: { kcal: s.calories * k, protein: s.protein * k, carbs: s.carbs * k, fat: s.fat * k, fiber: (s.fiber || 0) * k,
          ...(s.sugar != null ? { sugar: s.sugar * k } : {}), ...((s as any).sodium != null ? { sodium: (s as any).sodium * k } : {}) },
      });
      const risk = assessFood(hit.name, hit.safety, restrictions);
      if (risk) risks.push(risk);
    }
    if (!foods.length) {
      return quick(`No encontré ${missing.map((m) => `«${m}»`).join(" ni ")} en mis bases, así que no puedo simularlo sin inventar sus calorías. ` +
        "Dime la marca o el nombre como sale en el envase.");
    }
    const r = await buildWhatIf(memory, foods, { meal: input.mealType ?? null });
    const text = formatWhatIf(r, {
      said: typeof (input as any).said === "string" && !missing.length ? (input as any).said : undefined,
      risks, restrictionLabels: restrictions.labels, missing, notes,
    });
    return { output: `${text}\n[Cómo presentarlo: muestra este bloque tal cual, sin cambiar ninguna cifra ni letra.]`, metadata: { notLogged: true, ...(isPure(userMessage, ["food"]) ? { quickReply: text } : {}) } };
  }

  // ─── Metas nutricionales ──────────────────────────────────────────
  // Se guardan en `nutrition_goals` y las lee el asesor metabólico (MetabolicAnalysis) para saber
  // cuánto le falta al usuario. Rangos amplios pero acotados: una meta absurda (por un error de
  // tipeo o del modelo) no debe guiar recomendaciones.
  private async handleSetGoals(goals: NutritionInput["goals"], memory: any, medical?: MedicalProfile, wsClient?: any): Promise<ToolExecutionResult> {
    if (!memory) return { output: "", error: "No hay acceso al perfil para guardar metas." };
    if (!goals || Object.values(goals).every((v) => v === undefined)) {
      return { output: "", error: "Indica al menos una meta (calorías, proteína, carbohidratos, grasa o agua)." };
    }
    const current = (await memory.get("nutrition_goals").catch(() => null)) || {};
    const { next, saved, rejected } = applyGoalUpdate(current, goals);
    // Push en tiempo real: antes el móvil solo se enteraba de una meta nueva si reabría la pantalla
    // (dependía de que llegara sync_nutrition_today), así que el resumen del día quedaba desactualizado.
    if (saved.length) { await memory.set("nutrition_goals", next); try { wsClient?.send(JSON.stringify({ type: "nutrition_goals_updated", goals: next })); } catch {} }

    const ckd = medical?.conditions?.some((c) => c.id === "ckd");
    let out = saved.length ? `✅ Metas guardadas: ${saved.join(", ")}.` : "No guardé ninguna meta.";
    if (rejected.length) out += ` No guardé: ${rejected.join("; ")}.`;
    if (ckd) out += " Con enfermedad renal, confirma proteína y líquidos con tu nefrólogo: son orientativos.";
    else out += " Son orientativas; ajústalas con tu médico o nutricionista si tienes una condición.";
    return { output: out };
  }

  // ─── Buscar alimento ──────────────────────────────────────────────
  private async handleSearch(foodService: UnifiedFoodService | null, query: string, medical?: MedicalProfile): Promise<ToolExecutionResult> {
    if (!query) return { output: "Especifica qué alimento buscar." };

    // UnifiedFoodService: Local Chile → USDA → OFF
    if (foodService) {
      try {
        const results = await foodService.searchFoods(query, 0, 5);
        const restrictions = deriveRestrictions(medical);
        // Marca cada resultado según el perfil: "⚠ contiene gluten" o "⚠ no puedo confirmar…"
        const flag = (name: string, safety: any) => {
          const risk = assessFood(name, safety, restrictions);
          return risk ? ` ⚠ ${risk.level === "blocked" ? "" : "(sin confirmar) "}${risk.reason}` : "";
        };
        if (results.items.length > 0) {
          const lines = await Promise.all(
            results.items.slice(0, 4).map(async (item) => {
              // Items locales (cl:) → traer macros exactos
              if (item.id.startsWith("cl:")) {
                try {
                  const full = await foodService.getFoodById(item.id);
                  const s = full.defaultServing;
                  return `• **${full.name}** — ${s.description}: ${s.calories} kcal | Prot: ${s.protein}g | Carbs: ${s.carbs}g | Grasa: ${s.fat}g${flag(full.name, full.safety)}`;
                } catch { /* continúa con descripción */ }
              }
              return `• **${item.name}**${item.brandName ? ` (${item.brandName})` : ""} — ${item.description}${flag(item.name, item.safety)}`;
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
          if (fullFood.id.startsWith("usda:")) {
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
    foodService: UnifiedFoodService | null,
    medical?: MedicalProfile,
    userMessage?: string,
  ): Promise<ToolExecutionResult> {
    // "ayer comí 2 empanadas": antes se guardaba con fecha de HOY e inflaba el día. Por chat solo se registra hoy (el
    // teléfono sincroniza solo el día actual); se dice dónde agregarlo. `notLogged` evita que cuente como registro hecho.
    const otherDay = (input as any).otherDay || otherDayOf(userMessage);
    // «ayer», «anoche», «anteayer» sí se anotan en ese día (pedido del usuario, 2026-10-16). Lo más antiguo, en la app.
    const past = otherDay ? pastDayOf(otherDay) : null;
    if (otherDay && !past) {
      const what = input.items?.length ? input.items.map((i) => i.name.split(" / ")[0].toLowerCase()).join(", ") : "esa comida";
      const msg = `No lo anoté: por chat registro lo de hoy, ayer y anteayer, y esto fue ${otherDay}. Para agregar ${what} a ese día, abre Nutrición, retrocede con ◀ hasta ese día y búscalo ahí.`;
      return { output: msg, metadata: { notLogged: true, ...(isPure(userMessage, ["food"]) ? { quickReply: msg } : {}) } };
    }
    if (!input.items || input.items.length === 0) {
      return {
        output: "Necesito saber qué comiste. Descríbeme los alimentos y las cantidades en gramos.",
      };
    }
    // Antes, si el modelo no mandaba el tipo de comida, no se guardaba nada y se preguntaba "¿Qué tipo de comida fue?":
    // para el usuario era "le pedí registrar y no registró". Se deduce del mensaje ("para el almuerzo") o de la hora.
    // La hora de la COMIDA manda, no la de anotarla (services/MealSchedule.ts): "desayuné…" a las 12 queda a la hora del
    // desayuno; "a las 12 me comí…" es colación de media mañana. La hora de despertar corre la ventana del desayuno.
    const snapForWake = memory ? await memory.get("health_snapshot_latest").catch(() => null) : null;
    const dayCtx = dayCtxFrom(snapForWake);
    let timing: { mealType: MealType; at: Date; approx: boolean; note?: string };
    let pastDay: Date | null = null;
    if (past) {
      // Un día anterior: la comida que nombró (o «anoche» = cena, o la de la hora que dijo), a su hora típica ese día. El
      // modelo NO decide la comida (adivinaba): si no se sabe cuál fue, se pregunta con botones.
      const pt = pastMealTimingOf(String(userMessage ?? ""), past, { dayCtx, fixedMeal: (input as any).fixedMeal ? (input.mealType as MealType) : undefined });
      if (!pt) {
        if (memory) {
          await memory.set("food_pending_day", {
            at: new Date().toISOString(), word: past.word, message: String(userMessage ?? "").slice(0, 400),
            items: input.items.map((i) => ({ name: i.name, ...(i.grams ? { grams: i.grams } : {}) })),
            ...(Array.isArray((input as any).corrected) ? { corrected: (input as any).corrected } : {}),
          }).catch(() => {});
        }
        const ask = `¿En qué comida de ${past.word === "anteayer" ? "anteayer" : "ayer"} fue?\n[Opción: Desayuno] [Opción: Almuerzo] [Opción: Once] [Opción: Cena]`;
        return { output: `${ask}\n[Para ti: no lo anotes todavía; espera a que elija la comida.]`, metadata: { notLogged: true, ...(isPure(userMessage, ["food"]) ? { quickReply: ask } : {}) } };
      }
      pastDay = pt.day;
      timing = { mealType: pt.mealType, at: pt.at, approx: true };
    } else {
      timing = mealTimingOf(typeof userMessage === "string" ? userMessage : "", { dayCtx, modelMeal: input.mealType });
    }
    const mealType = timing.mealType;

    // Solo lo que el usuario pidió: el modelo a veces arrastra alimentos de registros anteriores de la conversación.
    if (foodService && asksToLog(userMessage)) {
      const extra = await unmentionedItems(userMessage, input.items.map((i) => i.name), async (q) => foodService.searchLocal(q));
      if (extra.length) {
        return {
          output: "",
          error: `No registré nada: ${extra.join(", ")} no aparece en lo que pidió el usuario («${String(userMessage).slice(0, 160)}»). Vuelve a llamar a log_meal SOLO con los alimentos de ese mensaje (si no dio cantidades, usa una porción normal).`,
        };
      }
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
    // Alérgenos conocidos de cada ítem (catálogo / producto envasado) para avisar según el perfil
    const risks: ItemRisk[] = [];
    // Alimentos que no están en ninguna base (ni corrigiendo el nombre): NO se anotan. Antes se anotaban con un valor genérico
    // (150 kcal por 100 g): "150 g de chocapig" quedó en 225 kcal cuando Chocapic son ~570 (2026-10-09).
    const unresolvedNames: string[] = [];
    // Nombres corregidos contra las bases ("chocapig" → Chocapic), para decírselo al usuario
    const corrections: string[] = Array.isArray((input as any).corrected) ? [...(input as any).corrected] : [];
    // Mezclas repartidas en sus ingredientes ("choclo con lechuga y repollo")
    const splitNotes: string[] = [];
    const restrictions = deriveRestrictions(medical);

    // Gramos corregidos con lo que dijo la persona ("3 empanadas" = 3 × la unidad de la base), para decírselo
    const gramFixes: string[] = [];
    const pushFood = async (fullFood: any, item: { name: string; grams?: number }) => {
      const serving = fullFood.defaultServing;
      const servingGrams = serving.metricServingAmount || 100;
      const said = saidGramsFor(userMessage, {
        meal: mealType, names: [item.name, fullFood.name], servingDescription: String(serving.description ?? ""),
        servingGrams, onlyItem: input.items?.length === 1,
      });
      // Sin gramos (el modelo no los puso): lo dicho por la persona o una porción normal de la base
      let grams: number = item.grams && item.grams > 0 ? item.grams : (said ?? servingGrams);
      if (said && Math.abs(said - grams) > Math.max(10, said * 0.2)) {
        console.warn(`[NutritionTool] ${fullFood.name}: el modelo puso ${grams} g, lo dicho son ${said} g`);
        // "un pan con palta" = 1 porción de la base (145 g): se dice así, porque "Pan con palta 145 g" sonaba a que la persona
        // había dicho los gramos (2026-10-12)
        const units = said / servingGrams;
        const whole = Math.round(units);
        gramFixes.push(whole >= 1 && Math.abs(units - whole) < 0.05
          ? `${whole === 1 ? "1 porción" : `${whole} porciones`} de ${fullFood.name} = ${said} g`
          : `${fullFood.name} = ${said} g`);
        grams = said;
      }
      const normFactor = grams / servingGrams;
      resolvedItems.push({
        name: fullFood.name,
        grams,
        calories: Math.round(serving.calories * normFactor),
        protein:  Math.round(serving.protein  * normFactor * 10) / 10,
        carbs:    Math.round(serving.carbs    * normFactor * 10) / 10,
        fat:      Math.round(serving.fat      * normFactor * 10) / 10,
        fiber:    Math.round((serving.fiber || 0) * normFactor * 10) / 10,
      });
      { const risk = assessFood(fullFood.name, fullFood.safety, restrictions); if (risk) risks.push(risk); }
      // Si vino de USDA u OFF, guardarlo en la base local para no repetir búsqueda a API
      // Solo si calza con todas las palabras: "carne roja" quedó guardado como alias de un chili enlatado (2026-10-11)
      if (fullFood.id.startsWith("usda:") && foodFit(item.name, fullFood) === "strong") await foodService?.saveToLocalDB(fullFood, [item.name]).catch(() => {});
      if (memory) await this.addToFrequentFoods(memory, fullFood.name, fullFood.id);
    };

    for (const item of input.items) {
      const factor = (item.grams ?? 100) / 100;
      let resolved = false;

      // 1. UnifiedFoodService: Local Chile DB → USDA → OFF (prioridad máxima)
      if (foodService) {
        try {
          const hit = await resolveFood(foodService, item.name);
          if (hit) { await pushFood(hit, item); resolved = true; }
        } catch (e) {
          console.warn("[NutritionTool] foodService error para", item.name, e);
        }
      }

      // 1b. «completo italiano sin mayo»: la base no tiene cada plato «sin X». Se anota el plato y se le resta UNA porción de X
      //     (si X está en la base; tope: un cuarto del plato) y se dice. Antes no se encontraba y el modelo buscaba 6 veces en
      //     internet (58 s, banco de pruebas 2026-10-16). «Sin azúcar/gluten/lactosa…» es otro producto, no se resta nada.
      if (!resolved && foodService && (item as any).macros_override == null) {
        const m = item.name.match(/^(.+?)\s+sin\s+(.+)$/i);
        const variante = m && /\b(az[uú]car|gluten|lactosa|alcohol|sal|grasas?|cafe[ií]na|calor[ií]as|endulzante|edulcorante|piel|hueso|carozo|cuesco)\b/i.test(m[2]);
        const hit = m && !variante ? await resolveFood(foodService, m[1].trim()).catch(() => null) : null;
        if (m && hit) {
          await pushFood(hit, { ...item, name: m[1].trim() });
          resolved = true;
          const it = resolvedItems[resolvedItems.length - 1];
          const restados: string[] = [], sinRestar: string[] = [];
          for (const raw of m[2].split(/\s*(?:,|\by\b|\bni\b)\s*/i).map((s) => s.trim()).filter(Boolean)) {
            const ing: any = await resolveFood(foodService, raw.replace(/^(?:la|el|los|las)\s+/i, "")).catch(() => null);
            const sv = ing?.defaultServing;
            const f = sv?.calories > 0 && sv?.metricServingAmount > 0 ? Math.min(1, (it.calories * 0.25) / sv.calories) : 0;
            if (!f) { sinRestar.push(raw); continue; }
            it.grams = Math.max(1, Math.round(it.grams - sv.metricServingAmount * f));
            it.calories = Math.max(0, Math.round(it.calories - sv.calories * f));
            it.protein = Math.max(0, Math.round((it.protein - (sv.protein || 0) * f) * 10) / 10);
            it.carbs = Math.max(0, Math.round((it.carbs - (sv.carbs || 0) * f) * 10) / 10);
            it.fat = Math.max(0, Math.round((it.fat - (sv.fat || 0) * f) * 10) / 10);
            it.fiber = Math.max(0, Math.round(((it.fiber || 0) - (sv.fiber || 0) * f) * 10) / 10);
            restados.push(`${f < 1 ? "parte de una porción" : "una porción"} de ${String(ing.name).split(" / ")[0].toLowerCase()} (~${Math.round(sv.calories * f)} kcal)`);
          }
          if (restados.length) splitNotes.push(`Sin ${m[2]}: a ${hit.name} le resté ${restados.join(" y ")}.`);
          if (sinRestar.length) splitNotes.push(`No pude descontar ${sinRestar.join(" ni ")}: lo anoté como ${hit.name} normal.`);
        }
      }

      // 2. Fallback: COMMON_FOODS hardcodeado o override manual de la web
      if (!resolved) {
        const override = (item as any).macros_override;
        const macros = override ? { cal: override.calories, prot: override.protein, carbs: override.carbs, fat: override.fat, fiber: 0 } : lookupMacros(item.name);
        if (macros) {
          { const risk = assessFood(item.name, undefined, restrictions); if (risk) risks.push(risk); }
          resolvedItems.push({
            name: item.name,
            grams: item.grams ?? 100,
            calories: Math.round(macros.cal   * factor),
            protein:  Math.round(macros.prot  * factor * 10) / 10,
            carbs:    Math.round(macros.carbs * factor * 10) / 10,
            fat:      Math.round(macros.fat   * factor * 10) / 10,
            fiber:    Math.round(macros.fiber * factor * 10) / 10,
          });
          resolved = true;
        }
      }

      // 3. ¿Nombre mal escrito? Se corrige contra las bases y se busca otra vez
      if (!resolved && foodService) {
        const fixed = correctFoodName(item.name);
        const hit = fixed ? await resolveFood(foodService, fixed).catch(() => null) : null;
        if (hit) { await pushFood(hit, item); corrections.push(`«${item.name}» como ${hit.name}`); resolved = true; }
      }

      // 4. Una mezcla ("80 g de choclo con lechuga y repollo", 2026-10-09): si cada ingrediente está en las bases, se reparten
      //    los gramos en partes iguales y se dice. Antes no se anotaba nada y el modelo inventaba un "Error de búsqueda".
      if (!resolved && foodService) {
        const parts = item.name
          .replace(/^\s*(?:una?\s+)?(?:ensalada|mezcla|bowl|plato)\s+(?:de\s+)?/i, "")
          .split(/\s*(?:,|\bcon\b|\by\b|\be\b|\+)\s*/i)
          .map((p) => p.replace(/^(?:de|del|la|el|las|los)\s+/i, "").trim())
          .filter(Boolean);
        if (parts.length >= 2 && parts.length <= 5) {
          const hits = await Promise.all(parts.map(async (p) => (await resolveFood(foodService, p).catch(() => null)) ??
            (correctFoodName(p) ? await resolveFood(foodService, correctFoodName(p)!).catch(() => null) : null)));
          if (hits.every(Boolean)) {
            const each = item.grams ? Math.round((item.grams / parts.length) * 10) / 10 : 0; // 0 = cada uno con su porción normal
            for (const h of hits) await pushFood(h, { name: h!.name, grams: each });
            if (item.grams) splitNotes.push(`Repartí los ${Math.round(item.grams)} g de «${item.name}» en partes iguales: ${hits.map((h) => h!.name).join(", ")}.`);
            resolved = true;
          }
        }
      }

      if (!resolved) unresolvedNames.push(item.name);
    }

    // Nada se encontró: no se anota nada (inventar calorías es peor que preguntar)
    if (!resolvedItems.length) {
      const what = unresolvedNames.map((n) => `«${n}»`).join(" ni ");
      const msg = `No encontré ${what} en mis bases, así que no anoté nada: prefiero no inventar sus calorías. ` +
        "Dime la marca o el nombre como sale en el envase, o escanea el código de barras en Nutrición.";
      return {
        output: msg + "\n[Para ti: si es un producto o plato conocido, busca sus macros con web_search y vuelve a llamar log_meal con macros_override (por 100 g). No digas que lo anotaste.]",
        metadata: { notLogged: true, ...(isPure(userMessage, ["food"]) ? { quickReply: msg } : {}) },
      };
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
      timestamp: timing.at.toISOString(),
      // cuándo se anotó (para "borra lo último"); approxTime: la hora es la típica de esa comida, no la exacta
      loggedAt: new Date().toISOString(),
      ...(timing.approx ? { approxTime: true } : {}),
      ...(pastDay ? { pastDay: true } : {}),
      mealType,
      items: resolvedItems,
      totals,
    };
    // Clave del día de comida donde va (toDateString, como el resto de los registros)
    const dayKey = pastDay ? pastDay.toDateString() : nutritionDayKey(timing.at, dayCtx);

    // Guardar en memoria del perfil
    let savedLog: NutritionEntry[] | undefined;
    if (memory) {
      try {
        // El día de COMIDA de cuando se comió (termina al dormir: lo de las 2 AM sin haber dormido es de ayer)
        const key = `nutrition_log_${dayKey}`;
        const existing = await memory.get(key).catch(() => []);
        const log = Array.isArray(existing) ? existing : [];
        const nextLog = [...log, entry];
        await memory.set(key, nextLog);
        savedLog = nextLog;
        // Para que el motor de baselines ("Análisis del Día") vea esto HOY sin depender de que la app tenga
        // Nutrición abierta para reenviarlo — antes solo se enteraba si el móvil mandaba update_health_snapshot.
        // Un día anterior: se suma a lo que ese día ya tenía el historial.
        if (pastDay) await addToPastRollup(memory, pastDay, totals).catch(() => {});
        else {
          const hydrationLog = await memory.get(`hydration_log_${dayKey}`).catch(() => []);
          await upsertChatRollup(memory, nextLog, hydrationLog).catch(() => {});
        }
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
          // de qué día de comida es (un día anterior lo guarda el teléfono en ese día, no en hoy)
          day: dayKey,
        }));
      } catch {}
    }

    // Una bebida anotada junto con comida ("un yogur y dos coca zero") quedaba solo como comida (0 kcal) y no sumaba a la meta
    // de agua (2026-10-07). Sus calorías van en la comida y su volumen también al agua (1 g ≈ 1 ml).
    const drinkNotes: string[] = [];
    for (const it of resolvedItems) {
      const type = beverageTypeOf(it.name);
      // el agua de otro día no suma a la de hoy
      if (pastDay || !type || !(it.grams >= 50)) continue;
      await this.handleLogWater(Math.round(it.grams) / 1000, type, memory, wsClient, userMessage).catch(() => null);
      drinkNotes.push(`${(Math.round(it.grams / 10) / 100).toString().replace(".", ",")} L de ${it.name.split(" / ")[0]}`);
    }

    // Construir respuesta
    const itemLines = resolvedItems.map(
      (i) => `• **${i.name}** (${amountText(i.name, i.grams)}) — ${i.calories} kcal`
    );


    const dayWord = pastDay ? ` de ${past?.word === "anteayer" ? "anteayer" : "ayer"}` : "";
    let output =
      `✅ **${MEAL_LABELS[mealType] ?? "Comida"}${dayWord} ${/^(once|cena|colacion)/.test(mealType) ? "registrada" : "registrado"}**\n\n` +
      itemLines.join("\n") +
      `\n\n**Total:** ${totals.calories} kcal | ` +
      `Prot: ${totals.protein}g | Carbos: ${totals.carbs}g | Grasas: ${totals.fat}g`;

    // Cuánto lleva en el día (chat + lo anotado a mano en la app) contra su meta: antes había que preguntarlo aparte
    if (memory && savedLog && !input.noProgress && !pastDay) {
      const view = await this.todayView(memory, medical, savedLog).catch(() => null);
      if (view) output += `\n${this.progressLine(view)}`;
    }

    if (drinkNotes.length) output += `\n💧 También sumé ${drinkNotes.join(" y ")} a tu agua de hoy.`;
    // El agua que trae la comida (jalea, fruta, sopa…) también cuenta: se dice cuando es algo que valga mencionar
    const watery = resolvedItems.map((i) => ({ name: i.name.split(" / ")[0], l: itemWaterL(i) })).filter((w) => w.l > 0);
    const foodWaterL = watery.reduce((a, w) => a + w.l, 0);
    if (foodWaterL >= 0.1 && !pastDay) {
      const main = watery.sort((a, b) => b.l - a.l)[0];
      const ml = Math.round(foodWaterL * 100) * 10;
      output += `\n💧 ${watery.length === 1 ? `${main.name} trae` : "Esta comida trae"} ~${ml >= 1000 ? fmtLiters(ml / 1000) : `${ml} ml`} de agua: ya cuenta en tu agua de hoy.`;
    }
    if (corrections.length) output += `\n(Entendí ${corrections.join(" y ")}.)`;
    if (timing.note) output += `\n(${timing.note})`;
    if (gramFixes.length) output += `\n(Según lo que dijiste: ${gramFixes.join("; ")}.)`;
    if (splitNotes.length) output += `\n(${splitNotes.join(" ")})`;
    if (unresolvedNames.length) {
      output += `\n\n⚠️ No anoté ${unresolvedNames.map((n) => `«${n}»`).join(" ni ")}: no está en mis bases y no quiero inventar sus calorías. ` +
        "Dime la marca o escanea su código en Nutrición y lo agrego.";
    }
    // Porción asumida por el reconocimiento por código ("una hallulla con palta": la palta sin cantidad)
    const assumed = (input as any).assumed;
    if (typeof assumed === "string" && assumed) output += `\n\n${assumed}`;

    const riskNote = formatRisks(risks, restrictions);
    if (riskNote) output += `\n\n${riskNote}`;

    // Si el mensaje solo pedía este registro, la respuesta sale tal cual, sin otra pasada del modelo (5-10 s menos).
    const quickReply = isPure(userMessage, ["food"]) ? output : undefined;

    // La guía médica es para el MODELO (está escrita en tercera persona: "El usuario vive con diabetes…"). Antes iba dentro
    // de la respuesta rápida y el usuario la leía tal cual como "Nota:".
    const kbNote = formatGuidanceForLLM(medical, 'nutrition');
    if (kbNote) output += `\n\n[Guía médica para ti, no la copies textual: ${kbNote}]`;

    // Instrucción para el modelo (se quita sola si hay que mostrar el resultado tal cual): ya está guardado.
    output += "\n\n[Cómo presentarlo: la comida YA quedó guardada en el registro. Confírmalo en una frase con el total y NO preguntes si quieres registrarla o guardarla.]";

    return { output, metadata: quickReply ? { quickReply } : undefined };
  }

  // ─── Registrar hidratación ───────────────────────────────────────────────
  private async handleLogWater(liters: number, beverageType: string, memory: any, wsClient: any, userMessage?: string, assumed?: string): Promise<ToolExecutionResult> {
    // El agua de los alimentos (yogur, fruta, sopa, jalea) no va acá: se calcula de lo comido (services/FoodWater.ts).
    // Cuánto cuenta cada bebida para la meta de agua. Antes café/té 0,8, jugos 0,6-0,8 y bebidas 0,6: la misma Coca Zero
    // contó al 100 % una vez (anotada como "agua") y al 60 % otra (2026-10-07). Los estudios de índice de hidratación de
    // bebidas (Maughan y cols., 2016) muestran que café, té, jugos y bebidas, normales o zero, hidratan prácticamente
    // igual que el agua: lo que importa de una bebida con azúcar es el AZÚCAR (se avisa aparte), no que hidrate menos.
    // El alcohol no suma a la meta (los tragos fuertes deshidratan).
    const coefficients: Record<string, number> = {
      "agua": 1.0, "te_cafe": 1.0, "bebida_isotonica": 1.0, "jugo_natural": 1.0, "jugo_artificial": 1.0, "bebida_fantasia": 1.0, "alcohol": 0,
    };
    
    const coef = coefficients[beverageType] ?? 1.0;
    // Freno contra la doble anotación: el modelo suma la bebida de una comida (log_meal) y además llama log_water, o se toca
    // dos veces el "+250 ml" de la notificación. Si el MENSAJE es un pedido de agua claro (los botones 💧 del chat, "tomé
    // 500 ml"), cada uno es intencional: dos vasos seguidos son dos vasos (2026-10-10: el segundo 💧 500 ml se frenaba).
    const explicit = typeof userMessage === "string" && !!parseWaterMessage(userMessage);
    try {
      const prev = await memory?.get?.(`hydration_log_${await todayKeyOf(memory)}`).catch(() => []);
      const dup = !explicit && (Array.isArray(prev) ? prev : []).find((e: any) => e.beverageType === beverageType && Math.abs((e.liters ?? 0) - liters) < 0.01 && Date.now() - Date.parse(e.timestamp) < 120_000);
      if (dup) {
        const msg = `💧 Esos ${Math.round(liters * 1000)} ml ya los sumé hace un momento; no los cuento dos veces. ${waterLine(await waterToday(memory))}`;
        return { output: msg, metadata: { notLogged: true, quickReply: msg } };
      }
    } catch {}
    const effectiveLiters = Math.round(liters * coef * 100) / 100;

    const entry: HydrationEntry = {
      timestamp: new Date().toISOString(),
      beverageType,
      liters,
      effectiveLiters
    };

    let totalText = "";
    if (memory) {
      try {
        const today = await todayKeyOf(memory);
        const key = `hydration_log_${today}`;
        const existing = await memory.get(key).catch(() => []);
        const log = Array.isArray(existing) ? existing : [];
        const nextLog = [...log, entry];
        await memory.set(key, nextLog);
        // El total de HOY de verdad (teléfono + chat, services/WaterToday.ts) y la meta de DailyTargets. Antes sumaba solo lo
        // anotado por chat: con 2,55 L en el día, el botón 💧 500 ml respondía "Llevas 1 L" (2026-10-09).
        totalText = " " + waterLine(await waterToday(memory));
        // Igual que al registrar comida: que el motor de baselines vea esto hoy sin depender de la app.
        const nutritionLog = await memory.get(`nutrition_log_${today}`).catch(() => []);
        await upsertChatRollup(memory, nutritionLog, nextLog).catch(() => {});
      } catch {}
    }

    if (wsClient) {
      try {
        wsClient.send(JSON.stringify({ type: "hydration_logged", liters: effectiveLiters, entry }));
      } catch {}
    }

    const ml = Math.round(liters * 1000);
    const effMl = Math.round(effectiveLiters * 1000);
    const typeLabel = beverageType.replace("_", " ");
    
    void effMl;
    let msg = `💧 Registrado: ${ml < 1000 ? `${ml}ml` : `${liters}L`} de ${typeLabel}. `;
    if (coef === 0) {
      msg += "El alcohol no suma a tu meta de agua (los tragos fuertes deshidratan), así que no lo cuento ahí.";
    } else {
      const sugar = sugarNote(beverageType, ml, userMessage);
      msg += sugar || "¡Buen hábito, sigue así!";
    }

    // El total del día (antes había que pedirlo aparte) y una respuesta lista: registrar agua no necesita al modelo.
    const quickReply = isPure(userMessage, ["water"]) ? `${msg}${totalText}${assumed ? ` ${assumed}` : ""}` : undefined;
    return { output: msg + totalText + (assumed ? ` ${assumed}` : ""), metadata: quickReply ? { quickReply } : undefined };
  }

  // ─── El día completo y el avance ─────────────────────────────────
  /**
   * Lo comido HOY visto entero: lo anotado por chat + lo que el usuario anotó a mano en la app (el teléfono manda su lista
   * en el snapshot, `foodLog`), sin duplicar ni revivir lo borrado. Con las metas para mostrar el avance: calorías
   * configuradas (o 2000, lo mismo que muestra la app) y proteína configurada o la del perfil (igual que el resumen de la app).
   */
  private async todayView(memory: any, medical?: MedicalProfile, chatLog?: unknown) {
    const snap = await memory.get("health_snapshot_latest").catch(() => null);
    // El día de COMIDA (termina al dormir, no a medianoche)
    const dayCtx = dayCtxFrom(snap);
    const day = nutritionDayKey(new Date(), dayCtx);
    const log = chatLog ?? (await memory.get(`nutrition_log_${day}`).catch(() => []));
    const deleted = await memory.get(`nutrition_deleted_${day}`).catch(() => []);
    const { entries, phoneOnly } = dayEntries(log, snap?.foodLog, day, deleted);
    const totals = dayTotals(entries);
    // Metas de la fuente única (DailyTargets): las mismas que ven Forge, Nutrición e Inicio
    const t = await loadTargets(memory);
    const kcalGoal = t.kcal;
    const proteinGoal = t.proteinG;
    const proteinIsCap = t.proteinIsCap;
    // App sin la lista de alimentos (versión anterior): solo se conoce su total, que puede incluir cosas anotadas a mano
    let phoneExtraKcal = 0;
    const at = snap?.lastUpdated ? new Date(snap.lastUpdated) : null;
    if (!snap?.foodLog && at && nutritionDayKey(at, dayCtx) === day && typeof snap?.nutrition?.calories === "number") {
      phoneExtraKcal = Math.max(0, Math.round(snap.nutrition.calories - totals.calories));
    }
    return { day, entries: entries as LogEntry[], phoneOnly, totals, kcalGoal, proteinGoal, proteinIsCap, phoneExtraKcal };
  }

  private progressLine(v: { totals: { calories: number; protein: number }; kcalGoal: number; proteinGoal: number; proteinIsCap?: boolean }): string {
    const left = v.kcalGoal - v.totals.calories;
    const kcal = `${fmt(v.totals.calories)} de ${fmt(v.kcalGoal)} kcal` +
      (left > 0 ? ` (te quedan ${fmt(left)})` : left < 0 ? ` (${fmt(-left)} sobre tu meta)` : "");
    // Con enfermedad renal la proteína es un tope, no una meta: "12 g (tope 68 g)", no "12 de 68 g"
    const prot = v.proteinIsCap ? `${Math.round(v.totals.protein)} g (tope ${Math.round(v.proteinGoal)} g)` : `${Math.round(v.totals.protein)} de ${Math.round(v.proteinGoal)} g`;
    return `📊 Hoy llevas ${kcal} · proteína ${prot}.`;
  }

  // ─── Agua de hoy ──────────────────────────────────────────────────
  // La cuenta única (services/WaterToday.ts): teléfono + lo del chat que el teléfono aún no contó, con la meta de DailyTargets.
  private async handleWaterToday(memory: any, userMessage?: string): Promise<ToolExecutionResult> {
    if (!memory) return { output: "No hay registro disponible." };
    const w = await waterToday(memory);
    // Sin meta de agua (enfermedad renal): se informa lo tomado, sin empujar a tomar más
    const msg = w.goalL === null
      ? `💧 ${waterLine(w)}`
      : w.totalL <= 0
        ? `💧 Hoy todavía no registras agua. Tu meta es ${w.goalL.toLocaleString("es-CL")} L${w.goalNote ? ` (${w.goalNote})` : ""}.`
        : `💧 ${waterLine(w)}`;
    return { output: msg, metadata: isPure(userMessage, ["water"]) ? { quickReply: msg } : undefined };
  }

  // ─── Log del día ──────────────────────────────────────────────────
  // Antes solo mostraba lo anotado por chat: si el usuario había registrado todo a mano en la app, "¿qué he comido hoy?"
  // respondía "nada". Ahora junta ambos y agrega cuánto falta para la meta.
  private async handleGetLog(memory: any, medical?: MedicalProfile, userMessage?: string): Promise<ToolExecutionResult> {
    if (!memory) return { output: "No hay log disponible." };

    try {
      const view = await this.todayView(memory, medical);
      // El agua de HOY completa (teléfono + chat), no solo la anotada por chat: el análisis del 2026-10-09 dijo "0,5 L"
      // con 2,55 L en el día y la mandó a "rehidratación urgente"
      const water = await waterToday(memory);
      const waterTxt = `💧 ${waterLine(water)}${water.goalNote ? ` (la meta ${water.goalNote})` : ""}`;

      if (view.entries.length === 0) {
        const msg = (view.phoneExtraKcal > 0
          ? `En el chat no hay comidas anotadas hoy, pero en la app llevas ${fmt(view.phoneExtraKcal)} kcal (con esta versión de la app no veo el detalle de qué fue).`
          : "No has registrado ninguna comida hoy todavía.") + `\n${waterTxt}`;
        return { output: msg, metadata: isPure(userMessage, ["food", "water"]) ? { quickReply: msg } : undefined };
      }

      const MEAL_LABELS: Record<string, string> = {
        desayuno: "🌅 Desayuno", colacion_am: "🍎 Colación AM", almuerzo: "☀️ Almuerzo",
        once: "☕ Once", cena: "🌙 Cena", colacion_pm: "🍪 Colación PM", merienda: "🍪 Merienda",
      };
      const label = (m?: string) => MEAL_LABELS[m ?? ""] ?? (m ? `🍽️ ${m.replace(/_/g, " ")}` : "🍽️ Comida");

      const mealLines = view.entries.map((entry) => {
        const items = entry.items.map((i) => `  • ${i.name} (${amountText(i.name, i.grams)}) — ${Math.round(i.calories)} kcal`).join("\n");
        return `**${label(entry.mealType)}** — ${Math.round(entry.totals.calories)} kcal${entry.fromPhone ? " · anotado en la app" : ""}\n${items}`;
      });

      let output =
        `## 📋 Registro de hoy\n\n` +
        mealLines.join("\n\n") +
        `\n\n---\n**Total del día:** ${fmt(view.totals.calories)} kcal | ` +
        `Prot: ${view.totals.protein}g | Carbos: ${view.totals.carbs}g | Grasas: ${view.totals.fat}g\n` +
        this.progressLine(view) + "\n" + waterTxt;
      if (view.phoneExtraKcal > 0) output += `\n\n*En la app hay ${fmt(view.phoneExtraKcal)} kcal más anotadas a mano; con esta versión de la app no veo el detalle.*`;

      const quickReply = isPure(userMessage, ["food", "water"]) ? output : undefined;
      const kbNote = formatGuidanceForLLM(medical, 'nutrition');
      if (kbNote) output += `\n\n[Guía médica para ti, no la copies textual: ${kbNote}]`;

      return { output, metadata: quickReply ? { quickReply } : undefined };
    } catch {
      return { output: "No pude acceder al log de hoy." };
    }
  }

  // ─── Borrar alimento(s) del registro de hoy ───────────────────────
  // Antes borraba la COMIDA completa que tuviera ese alimento ("borra el queso" se llevaba también la hallulla) y solo
  // veía lo anotado por chat. Ahora borra solo los alimentos que calzan (por nombre, plural o alias de la base), también los
  // anotados a mano en la app (el teléfono los borra al recibir el aviso), y "último" deshace el último registro.
  private async handleDeleteEntry(
    searchQuery: string, memory: any, wsClient: any, foodService: UnifiedFoodService | null, medical?: MedicalProfile, userMessage?: string,
  ): Promise<ToolExecutionResult> {
    const q = searchQuery.trim();
    if (!q) return { output: "", error: "Especifica el nombre del alimento a borrar." };
    if (!memory) return { output: "No hay log disponible para borrar." };
    const quick = (msg: string, extra: Record<string, unknown> = {}) =>
      ({ output: msg, metadata: { ...extra, ...(isPure(userMessage, ["food"]) ? { quickReply: msg } : {}) } });

    try {
      const view = await this.todayView(memory, medical);
      const key = `nutrition_log_${view.day}`;
      const raw = await memory.get(key).catch(() => []);
      const chatLog: NutritionEntry[] = Array.isArray(raw) ? raw : [];
      if (view.entries.length === 0) return quick("No hay nada registrado hoy para borrar.");

      type Target = { timestamp: string; name: string; grams: number; calories: number; fromPhone: boolean };
      const targets: Target[] = [];
      const push = (e: LogEntry, i: LogEntry["items"][0]) =>
        targets.push({ timestamp: e.timestamp, name: i.name, grams: i.grams, calories: i.calories, fromPhone: !!e.fromPhone });

      if (q === LAST_ENTRY || /^(lo |el |la )?ultim[oa]( registro| comida)?$|^eso$/.test(fold(q))) {
        // Lo último anotado por chat (es lo que se acaba de registrar); si no hay, lo último del día
        // Por cuándo se ANOTÓ: lo anotado después ("desayuné…" a las 12) lleva la hora del desayuno y no sería "lo último"
        const byTime = (a: { timestamp: string; loggedAt?: string }, b: { timestamp: string; loggedAt?: string }) =>
          Date.parse(a.loggedAt ?? a.timestamp) - Date.parse(b.loggedAt ?? b.timestamp);
        const last = [...chatLog].sort(byTime).pop() ?? [...view.entries].sort(byTime).pop();
        if (last) for (const i of last.items) push(last as LogEntry, i);
      } else {
        let match = (n: string) => foodNameMatches(n, q);
        if (!view.entries.some((e) => e.items.some((i) => match(i.name))) && foodService) {
          // "sopapillas" → "Sopaipilla": el nombre con que quedó guardado, vía los alias de la base
          let hit: { name: string } | undefined;
          try { hit = foodService.searchLocal(q)[0]; } catch {}
          if (hit) match = (n: string) => fold(n) === fold(hit.name);
        }
        for (const e of view.entries) for (const i of e.items) if (match(i.name)) push(e, i);
      }
      if (!targets.length) return quick(`No encontré "${q}" en lo registrado hoy.`, { notLogged: true });

      // Lo del chat se saca del registro del servidor; lo de la app lo borra el teléfono al recibir el aviso
      let log: LogEntry[] = chatLog as LogEntry[];
      for (const t of targets.filter((x) => !x.fromPhone)) log = removeItem(log, t).log;
      await memory.set(key, log);
      const prevDeleted = await memory.get(`nutrition_deleted_${view.day}`).catch(() => []);
      await memory.set(`nutrition_deleted_${view.day}`,
        [...(Array.isArray(prevDeleted) ? prevDeleted : []), ...targets.map((t) => itemKey(t.timestamp, t.name, t.grams))].slice(-300));
      const hydrationLog = await memory.get(`hydration_log_${view.day}`).catch(() => []);
      await upsertChatRollup(memory, log, hydrationLog).catch(() => {});

      if (wsClient) {
        try {
          const left = new Set(log.map((e) => e.timestamp));
          wsClient.send(JSON.stringify({
            type: "nutrition_entry_deleted",
            // Comidas que quedaron vacías (lo que entiende la app anterior) y cada alimento borrado (la app nueva borra solo eso)
            timestamps: [...new Set(targets.filter((t) => !t.fromPhone && !left.has(t.timestamp)).map((t) => t.timestamp))],
            items: targets.map((t) => ({ timestamp: t.timestamp, name: t.name, grams: t.grams })),
          }));
        } catch {}
      }

      const after = await this.todayView(memory, medical, log).catch(() => null);
      const lines = targets.map((t) => `• ${t.name} (${amountText(t.name, t.grams)}, ${Math.round(t.calories)} kcal)${t.fromPhone ? " · anotado en la app" : ""}`);
      const msg = `🗑️ Borré de lo de hoy:\n${lines.join("\n")}` + (after ? `\n\n${this.progressLine(after)}` : "");
      return quick(msg, { deleted: targets.length });
    } catch {
      return { output: "", error: "No pude borrar la entrada." };
    }
  }


  // ─── Añadir a Frecuentes ──────────────────────────────────────────
  private async addToFrequentFoods(memory: any, name: string, id: string): Promise<void> {
    try {
      const key = "frequent_foods";
      const existing = await memory.get(key).catch(() => ({}));
      const freqs = existing && typeof existing === "object" ? existing : {};
      
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
