import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import {
  gatherMetabolicContext, analyze, formatAnalysis, tierForPerDay,
  type Area, type MetabolicContext, type Analysis,
  panoramaRapido,
} from "../services/MetabolicAnalysis.js";
import {
  recommendMeals, formatRecommendation, formatRecommendationChat, splitPantry, loadFoodAffinity, type Moment,
} from "../services/MealRecommender.js";
import { loadAffinity, suggestCarbOptions, formatCarbOptions, blockedFavorites, norm } from "../services/CarbOptions.js";
import { matchFoods } from "../services/MealRecommender.js";
import { searchPackaged } from "../services/PackagedFoods.js";
import { asksToLog } from "../services/FoodParse.js";

/** Cuánto vale una respuesta a "¿qué tienes a mano?" antes de que deje de ser la continuación de esa pregunta. */
const PENDING_MINUTES = 20;

// ─── Pedidos de "qué como" reconocidos por código ─────────────────────────────
// 2026-10-12: «Voy a entrenar en una hora, dame ideas para comer antes» no pasó por el flujo de comida: el modelo de 4B dio un
// panorama general y escribió «te faltan 1.220 g de proteína»; «Proponme opciones para comer ahora» preguntó «¿qué tienes a
// mano?» sin los botones. Cuando el pedido es claro, la herramienta se llama acá con el foco correcto.
const FOOD_ADVICE = /\b(que (?:como|comer|ceno|almuerzo|desayuno|me como|puedo comer|deberia comer|me conviene comer)|ideas? (?:para|de) (?:comer|comida|cena|almuerzo|desayuno|once|colacion)|algo (?:para|de|que) comer|tengo hambre|me muero de hambre|ando con hambre|(?:pre|post) ?entreno|propon\w* (?:opciones|algo|que comer|comida)|opciones (?:para|de) comer|recomienda\w* (?:algo )?(?:de |para )?comer)\b/;
const PRE_WORKOUT = /\b(voy a entrenar|vamos a entrenar|entreno en|entrenar en|antes de entrenar|pre ?entreno|tengo entrenamiento|voy al gimnasio|voy al gym)\b/;
const POST_WORKOUT = /\b(ya entrene|acabo de entrenar|despues de entrenar|post ?entreno|termine de entrenar|vengo de entrenar|sali de entrenar)\b/;

function minutesUntil(n: string): number | undefined {
  if (/\ben (?:una|1) hora\b/.test(n)) return 60;
  if (/\ben (?:media|1\/2) hora\b/.test(n)) return 30;
  if (/\ben (?:una|1) hora y media\b/.test(n)) return 90;
  const m = n.match(/\ben (\d{1,3}) ?(?:min|minutos)\b/);
  if (m) return Number(m[1]);
  const h = n.match(/\ben (\d) horas?\b/);
  if (h) return Number(h[1]) * 60;
  return undefined;
}

const MetabolicAdvisorInputSchema = z.object({
  focus: z
    .enum(["general", "comida", "pre_entreno", "post_entreno", "descanso", "hidratacion"])
    .optional()
    .describe(
      "general = '¿cómo voy hoy?' (todo el panorama); comida = 'qué como'; pre_entreno = va a entrenar; post_entreno = ya entrenó; " +
      "descanso = sueño/cansancio; hidratacion = agua. Default general.",
    ),
  pantry: z
    .string()
    .optional()
    .describe("Lo que el usuario dijo que tiene a mano para comer, TAL CUAL lo dijo (ej. 'arroz, pollo, 2 huevos y tomates'). Solo pásalo cuando el usuario ya te lo contó."),
  no_pantry: z
    .boolean()
    .optional()
    .describe("true si el usuario dijo que NO tiene nada a mano / que hay que comprar. Activa la ruta de presupuesto."),
  rapido: z
    .boolean()
    .optional()
    .describe("Interno: «¿cómo voy hoy?» respondido por código (no lo pases tú)."),
  ideas: z
    .boolean()
    .optional()
    .describe("true si PIDIÓ opciones o ideas directamente («proponme», «dame ideas», «qué como», «qué me conviene comer»): se dan opciones al tiro, sin preguntar antes qué tiene a mano."),
  minutes_to_workout: z
    .number()
    .optional()
    .describe("Minutos que faltan para entrenar (pre_entreno). Cambia qué conviene comer: con <30 min, algo ligero."),
  budget_clp: z
    .number()
    .optional()
    .describe("Monto en pesos que el usuario dice que puede gastar hoy en comida, si lo dijo (sirve cuando Finanzas no tiene datos)."),
});

type MetabolicAdvisorInput = z.infer<typeof MetabolicAdvisorInputSchema>;

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");

/**
 * Qué toca comer ahora. Si lleva horas sin comer o le falta mucho para su meta, es una comida de verdad
 * aunque la hora "sugiera" colación.
 */
function autoMoment(ctx: MetabolicContext, a: Analysis): Moment {
  const hour = a.hour;
  if (hour >= 20) return "cena_liviana";
  const hoursSinceMeal = ctx.lastMealAt ? (ctx.now.getTime() - ctx.lastMealAt.getTime()) / 3600000 : Infinity;
  if (hoursSinceMeal >= 4 || a.needs.kcal > 900 || hour < 10) return hour >= 19 ? "cena_liviana" : "comida";
  if (hour >= 10 && hour < 12) return "colacion";
  if (hour >= 16 && hour < 19) return "colacion";
  return "comida";
}

export class MetabolicAdvisorTool extends Tool<MetabolicAdvisorInput> {
  readonly name = "metabolic_advisor";
  readonly description =
    "Asesor metabólico del usuario: cruza su perfil médico y restricciones (celiaquía, alergias, diabetes…), lo que ya comió y bebió hoy, " +
    "sueño, pasos, glucosa, entrenamiento y presupuesto, y devuelve QUÉ HACER AHORA con alimentos y cantidades concretas. " +
    "USAR SIEMPRE cuando el usuario pregunte: 'qué como', 'qué ceno', 'tengo hambre', 'voy a entrenar / ya entrené, qué como', 'pre entreno', " +
    "'cómo voy hoy', 'estoy cansado', 'cómo estoy de agua', 'qué compro', 'qué me falta'. " +
    "FLUJO: para comida, la primera vez NO pases 'pantry': la herramienta te devolverá el análisis y la pregunta '¿qué tienes a mano?' — " +
    "hazle esa pregunta al usuario con las opciones. Cuando responda, vuelve a llamarla con pantry (lo que dijo) o con no_pantry=true si no tiene nada. " +
    "Si PIDE opciones o ideas ('proponme', 'dame ideas', 'qué como'), no preguntes qué tiene: llámala con no_pantry=true y entrégale las opciones. " +
    "NUNCA inventes alimentos, cantidades ni cifras: presenta lo que devuelve.";

  readonly inputSchema = MetabolicAdvisorInputSchema;

  /**
   * Continuación automática: si Eris acaba de preguntar "¿qué tienes a mano?" (o cuánto puede gastar) y el usuario
   * responde con ingredientes, "no tengo nada" o un monto, el QueryEngine llama a la herramienta por nosotros.
   */
  async preroute(userMessage: string, context?: any): Promise<Record<string, unknown> | null> {
    const memory = context?.memory;
    if (!memory) return null;
    // «¿Cómo voy hoy?» (también el «¿Cómo voy hoy y qué hago ahora? Revisa mi comida, agua…» de Inicio): panorama por código
    {
      const n0 = norm(userMessage || "");
      if (n0.length <= 160 && /^[¿¡\s]*(eris,?\s*)?(como voy|como estoy|como va mi dia|como vamos|como ando)( hoy)?\b/.test(n0) && !asksToLog(userMessage)
        && !/\b(plata|dinero|finanzas|gast\w*|presupuesto|sueldo|cuenta|entren\w*)\b/.test(n0)) return { focus: "general", rapido: true };
    }
    const pending: any = await memory.get("advisor_pending").catch(() => null);
    const fresh = pending && Date.now() - new Date(pending.at).getTime() <= PENDING_MINUTES * 60000;
    // Solo es la respuesta si lo ÚLTIMO que dijo Eris fue esa pregunta. Antes, en un chat nuevo, «diferencia entre imán de
    // neodimio y ferrita» se tomó como lo que tenía a mano y Eris contestó «no tengo datos nutricionales sobre imanes» (2026-10-16).
    const asked = /a mano|en casa|qu[eé] tienes|gastar|menos de \$|presupuesto/i.test(String(context?.lastAssistantMessage ?? ""));
    if (!fresh || !asked) return this.adviceIntent(userMessage, memory);
    const text = (userMessage || "").trim();
    if (!text || text.length > 300) return null;
    // Una pregunta nueva ("¿y qué ceno?") no es la respuesta a "¿qué tienes a mano?": puede ser otro pedido de comida
    if (text.includes("?")) return this.adviceIntent(userMessage, memory);

    const base: Record<string, unknown> = { focus: pending.focus };
    if (pending.minutes !== undefined) base.minutes_to_workout = pending.minutes;
    const n = norm(text);

    if (pending.awaiting === "amount") {
      const m = text.replace(/\./g, "").match(/(\d{3,6})/);
      return m ? { ...base, no_pantry: true, budget_clp: Number(m[1]) } : null;
    }
    if (/\b(no tengo nada|nada en casa|no hay nada|revisa mi presupuesto|hay que comprar|tengo que comprar)\b/.test(n)) return { ...base, no_pantry: true };
    if (n.includes("tengo lo mismo")) {
      const saved: any = await memory.get("pantry_latest").catch(() => null);
      return saved?.items?.length ? { ...base, pantry: saved.items.join(", ") } : null;
    }
    if (n.includes("tengo cosas en casa") || n.includes("tengo otras cosas")) return null; // que el modelo pregunte cuáles
    // ¿Parece una lista de ingredientes que conocemos?
    const frags = splitPantry(text);
    if (frags.some((f) => matchFoods(f).length > 0 || searchPackaged(f, 1).length > 0)) return { ...base, pantry: text };
    return this.adviceIntent(userMessage, memory);
  }

  /**
   * "Voy a entrenar en una hora, ¿qué como?", "tengo hambre", "proponme opciones para comer": la primera llamada, con el
   * foco y los minutos que dice el mensaje. Un pedido genérico ("proponme opciones") hereda el foco del pedido anterior
   * si fue hace poco (dijo antes que iba a entrenar). Si además dice lo que tiene ("tengo yogur y avena"), va como despensa.
   */
  private async adviceIntent(userMessage: string, memory: any): Promise<Record<string, unknown> | null> {
    const text = (userMessage || "").trim();
    if (!text || text.length > 220) return null;
    const n = norm(text);
    if (!FOOD_ADVICE.test(n) && !(PRE_WORKOUT.test(n) && /\b(comer|como|comida|ideas?|algo)\b/.test(n))) return null;
    // "comí algo antes de entrenar" cuenta lo que comió: eso es un registro, no un pedido de ideas
    if (asksToLog(text)) return null;
    let focus: "comida" | "pre_entreno" | "post_entreno" = POST_WORKOUT.test(n) ? "post_entreno" : PRE_WORKOUT.test(n) ? "pre_entreno" : "comida";
    let minutes = focus === "pre_entreno" ? minutesUntil(n) : undefined;
    if (focus === "comida") {
      const last: any = await memory.get("advisor_intent").catch(() => null);
      if (last && last.focus !== "comida" && Date.now() - new Date(last.at).getTime() <= PENDING_MINUTES * 60000) {
        focus = last.focus;
        minutes = last.minutes;
      }
    }
    try { await memory.set("advisor_intent", { focus, minutes, at: new Date().toISOString() }); } catch {}
    const input: Record<string, unknown> = { focus };
    if (minutes !== undefined) input.minutes_to_workout = minutes;
    // Pidió opciones o ideas: se le dan al tiro (2026-10-12: «proponme opciones para comer ahora» → «¿qué tienes a mano?»)
    if (/\b(propon\w*|ideas?|opciones|sugier\w*|sugerencias?|recomienda\w*|que (como|ceno|almuerzo|desayuno|puedo comer|me conviene|como antes|como despues)|dame algo)\b/.test(n)) input.ideas = true;
    // Ya dijo lo que tiene en el mismo mensaje
    // (el ÚLTIMO "tengo": "tengo hambre, ¿qué como? tengo yogur y avena")
    const at = n.lastIndexOf("tengo ");
    const rest = at >= 0 ? n.slice(at + 6).trim() : "";
    if (rest.length >= 3 && splitPantry(rest).some((f) => matchFoods(f).length > 0)) input.pantry = rest;
    return input;
  }

  async execute(input: MetabolicAdvisorInput, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    if (!memory) return { output: "", error: "Sin acceso al perfil para analizar." };

    const focus = input.focus ?? "general";
    const ctx = await gatherMetabolicContext(memory, { glucoService: context?.glucoService });
    const analysis = analyze(ctx);

    // Emergencia: glucosa baja manda sobre todo lo demás (comida y entrenamiento esperan).
    const urgent = analysis.findings.find((f) => f.area === "glucosa" && f.severity === 3);
    if (urgent && (focus === "comida" || focus === "pre_entreno" || focus === "post_entreno" || focus === "general")) {
      return { output: await this.hypoBlock(ctx, analysis, memory) };
    }

    switch (focus) {
      case "descanso":
        return { output: this.present(ctx, analysis, ["sueno", "animo", "movimiento"], "Sueño y descanso") };
      case "hidratacion":
        return { output: this.present(ctx, analysis, ["agua", "glucosa"], "Hidratación") };
      case "general": {
        // «¿Cómo voy hoy?» en limpio: respuesta por código, al instante (panoramaRapido)
        if (input.rapido) { const t = panoramaRapido(ctx, analysis); return { output: t, metadata: { quickReply: t } }; }
        return { output: this.present(ctx, analysis, undefined, "Panorama de hoy") + this.offerFood(ctx) };
      }
      default:
        return await this.foodFlow(input, focus, ctx, analysis, memory);
    }
  }

  // ─── Bloques ───────────────────────────────────────────────────────────────

  private present(ctx: MetabolicContext, a: Analysis, only: Area[] | undefined, title: string): string {
    return (
      `${title}\n\n${formatAnalysis(ctx, a, { onlyAreas: only })}\n\n` +
      "[Cómo presentarlo: empieza por lo MÁS importante (la primera prioridad) y da UNA acción concreta; " +
      "luego menciona en una línea lo que va bien. Usa las cifras tal cual. Si hay 'Calidad de los datos', dilo con naturalidad. " +
      "No des dosis de medicamentos ni diagnósticos.]"
    );
  }

  private offerFood(ctx: MetabolicContext): string {
    return (
      "\n\n[Si al usuario le sirve, ofrécele proponerle qué comer ahora (llamando de nuevo con focus='comida'). " +
      `Opciones: [Opción: Sí, ¿qué como ahora?] [Opción: Voy a entrenar]${ctx.trainedToday ? "" : ""}]`
    );
  }

  private async hypoBlock(ctx: MetabolicContext, a: Analysis, memory: any): Promise<string> {
    const affinity = await loadAffinity(memory);
    const carbs = formatCarbOptions(15, "hipoglucemia",
      suggestCarbOptions({ grams: 15, purpose: "hipoglucemia", affinity, restrictions: ctx.restrictions }),
      { restrictions: ctx.restrictions, blocked: blockedFavorites(affinity, ctx.restrictions) });
    return (
      `⚠ PRIMERO LA GLUCOSA\n\n${formatAnalysis(ctx, a, { onlyAreas: ["glucosa"] })}\n\n${carbs}\n\n` +
      "[Cómo presentarlo: lo único urgente es subir la glucosa. Da SOLO las opciones de carbohidratos de arriba y la regla (una opción, esperar 15 min, medir de nuevo). " +
      "No hables de comida completa ni de entrenar hasta que la glucosa se recupere; ofrécelo después.]"
    );
  }

  private async foodFlow(input: MetabolicAdvisorInput, focus: "comida" | "pre_entreno" | "post_entreno", ctx: MetabolicContext, a: Analysis, memory: any): Promise<ToolExecutionResult> {
    const moment: Moment = focus === "pre_entreno" ? "pre_entreno" : focus === "post_entreno" ? "post_entreno" : autoMoment(ctx, a);
    const relevant: Area[] = ["glucosa", "comida", "agua", "sueno"];
    const summary = formatAnalysis(ctx, a, { onlyAreas: relevant, maxOk: 3 });
    // Cuando ya hay que dar opciones, el análisis completo distrae al modelo: basta la prioridad principal.
    const brief = this.brief(a, ctx);

    const saved: any = await memory.get("pantry_latest").catch(() => null);
    const savedToday = saved && saved.date === ctx.now.toDateString() && Array.isArray(saved.items) && saved.items.length ? saved : null;

    const affinity = await loadFoodAffinity(memory);

    // A) El usuario ya dijo qué tiene
    if (input.pantry && input.pantry.trim()) {
      try { await memory.set("advisor_pending", null); } catch {}
      const frags = splitPantry(input.pantry);
      try { await memory.set("pantry_latest", { items: frags, date: ctx.now.toDateString(), savedAt: ctx.now.toISOString() }); } catch {}
      const rec = recommendMeals({ ctx, analysis: a, moment, minutesToWorkout: input.minutes_to_workout, pantry: frags, affinity });
      return this.withOptions(`${brief}\n\n${formatRecommendation(rec, ctx)}\n\n${this.howToPresent(true)}`, rec);
    }

    // B) No tiene nada → ruta de presupuesto
    if (input.no_pantry) {
      try { await memory.set("advisor_pending", null); } catch {}
      const b = ctx.budget;
      let tier: 1 | 2 | 3 = 1;
      let budgetLine: string;
      let askAmount = false;
      if (input.budget_clp && input.budget_clp > 0) {
        tier = tierForPerDay(input.budget_clp);
        budgetLine = `Con los ${clp(input.budget_clp)} que dices poder gastar hoy en comida.`;
      } else if (b) {
        tier = b.tier;
        budgetLine = b.perDayBasis === "presupuesto"
          ? `Tu presupuesto de alimentación: te quedan ${clp(b.remaining ?? 0)} para ${b.daysLeft} días (~${clp(b.perDay ?? 0)} por día).`
          : `No tienes presupuesto de alimentación definido: con tu disponible (${clp(b.disponible ?? 0)}) y ${b.daysLeft} días por delante, estimo ~${clp(b.perDay ?? 0)} por día para comida.`;
      } else {
        askAmount = true;
        budgetLine = "No tengo datos de tu presupuesto (Finanzas sin datos de este mes), así que te propongo lo más económico.";
      }
      const rec = recommendMeals({ ctx, analysis: a, moment, minutesToWorkout: input.minutes_to_workout, tierCap: tier, affinity });
      if (askAmount) {
        try { await memory.set("advisor_pending", { focus, minutes: input.minutes_to_workout, awaiting: "amount", at: ctx.now.toISOString() }); } catch {}
      }
      const ask = askAmount
        ? "\n\n[Al final pregunta cuánto puede gastar aproximadamente hoy en comida, para afinar: [Opción: Menos de $3.000] [Opción: Unos $5.000] [Opción: Más de $8.000]]"
        : "";
      return this.withOptions(`${brief}\n\n${budgetLine}\n\n${formatRecommendation(rec, ctx)}\n\n${this.howToPresent(false)}${ask}`, rec, budgetLine);
    }

    // C) Pidió opciones o ideas: se dan al tiro (con lo de su presupuesto si lo hay) y se ofrece ajustarlas a lo que tenga
    if (input.ideas) {
      try { await memory.set("advisor_pending", { focus, minutes: input.minutes_to_workout, awaiting: "pantry", at: ctx.now.toISOString() }); } catch {}
      const rec = recommendMeals({ ctx, analysis: a, moment, minutesToWorkout: input.minutes_to_workout, tierCap: ctx.budget?.tier ?? 2, affinity });
      return this.withOptions(`${brief}

${formatRecommendation(rec, ctx)}

${this.howToPresent(false)}
` +
        "[Al final, en una frase corta, ofrécele ajustarlas a lo que tenga en casa (que te cuente qué tiene).]", rec);
    }

    // D) Todavía no sabemos qué tiene: primero preguntar (y recordar que esperamos la respuesta)
    try { await memory.set("advisor_pending", { focus, minutes: input.minutes_to_workout, awaiting: "pantry", at: ctx.now.toISOString() }); } catch {}
    const need = a.needs;
    const needText = focus === "pre_entreno"
      ? `Para entrenar ${input.minutes_to_workout !== undefined ? `en ~${input.minutes_to_workout} min` : "pronto"} lo que más importa es el carbohidrato de combustible.`
      : focus === "post_entreno"
        ? "Después de entrenar conviene proteína y carbohidrato para recuperar."
        : need.proteinG > 0 ? `Te faltan ~${need.proteinG} g de proteína y ~${need.kcal} kcal para tu meta de hoy.` : `Te faltan ~${need.kcal} kcal para tu meta de hoy.`;

    const remembered = savedToday
      ? `\nHoy me dijiste que tenías: ${savedToday.items.join(", ")}. Puedes confirmar que sigue igual llamando de nuevo con ese pantry.`
      : "";
    const restr = ctx.restrictions.labels.length ? `\nTengo en cuenta tus restricciones: ${ctx.restrictions.labels.join(", ")}.` : "";
    const chips = savedToday
      ? "[Opción: Sí, tengo lo mismo]\n[Opción: Tengo otras cosas]\n[Opción: No tengo nada, revisa mi presupuesto]"
      : "[Opción: Tengo cosas en casa]\n[Opción: No tengo nada, revisa mi presupuesto]";

    return {
      output: (
        `${summary}\n\nQué necesitas: ${needText}${restr}${remembered}\n\n` +
        "TODAVÍA NO RECOMIENDES COMIDA. Primero pregúntale: «¿Qué tienes a mano para comer?» (que te cuente los ingredientes que tiene en casa). " +
        "Los botones de respuesta se agregan solos debajo de tu mensaje: no los escribas.\n\n" +
        "[Cómo presentarlo: 1) una frase con lo más importante del análisis (lo de mayor prioridad), 2) lo que necesita (arriba), con las cifras TAL CUAL, 3) la pregunta de qué tiene a mano. " +
        "Cuando responda con ingredientes, llama de nuevo a metabolic_advisor con pantry = sus palabras; si dice que no tiene nada, con no_pantry = true.]"
      ),
      // Los botones los pone el código: el modelo a veces no los copiaba y la persona tenía que escribir (2026-10-12)
      metadata: { appendToReply: { text: chips, marker: "\\[Opci[oó]n:" } },
    };
  }

  /** El bloque de opciones lo anexa el QueryEngine tal cual (el modelo no lo reescribe); ver ToolExecutionResult.metadata. */
  private withOptions(output: string, rec: Parameters<typeof formatRecommendationChat>[0], preface?: string): ToolExecutionResult {
    const text = formatRecommendationChat(rec);
    return {
      output,
      metadata: text ? { appendToReply: { text: (preface ? `${preface}\n\n` : "") + text, marker: "Opci[oó]n 1" } } : undefined,
    };
  }

  /** Las 2 prioridades principales en una línea cada una (sin el detalle completo). */
  private brief(a: Analysis, ctx: MetabolicContext): string {
    const top = a.findings.filter((f) => f.severity > 0 && f.area !== "datos" && f.tag !== "caution").slice(0, 2);
    let out = top.length
      ? "Lo más importante de hoy: " + top.map((f) => `${f.headline}${f.action ? ` (${f.action})` : ""}`).join(" | ")
      : "Estado de hoy: sin urgencias.";
    // Avisos de su dieta/condición (keto + insulina, B12 en veganos, embarazo…): siempre acompañan a la recomendación
    const diet = ctx.restrictions.cautions.filter((c) => c.kind === "diet").sort((x, y) => Number(y.text.startsWith("IMPORTANTE")) - Number(x.text.startsWith("IMPORTANTE"))).slice(0, 3);
    if (diet.length) out += "\nTen en cuenta por tu dieta: " + diet.map((c) => c.text).join(" · ");
    return out;
  }

  private howToPresent(fromPantry: boolean): string {
    return (
      "[Cómo presentarlo: las opciones con sus cifras exactas se mostrarán AUTOMÁTICAMENTE debajo de tu mensaje: NO las escribas, no las resumas ni des rangos de cifras. " +
      "Tu mensaje es breve (2-3 frases): la mejor es SIEMPRE la Opción 1 (ya viene ordenada): dila y explica por qué en una frase, " +
      "y si hay 'Ojo:' o 'Lo que dejé fuera' menciónalo sin dramatizar (ej. «el pan lo dejé fuera porque tiene gluten»). " +
      "NO menciones glucosa, medicamentos, condiciones ni restricciones que no aparezcan arriba (las únicas restricciones son las de «Adaptado a tus restricciones»). " +
      "No preguntes '¿te lo registro?': aún no comió nada. " +
      (fromPantry
        ? "Usa SOLO lo que el usuario dijo que tiene; no añadas ingredientes ni recetas. "
        : "Son cosas para comprar; menciona el presupuesto que aparece arriba. ") +
      "Cierra con UNA sola recomendación extra si el análisis tiene una prioridad (agua, sueño…), en una frase.]"
    );
  }
}
