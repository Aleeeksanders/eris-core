// ============================================================
// Eris — «¿Qué recomienda Eris?» en el chat (Eris al timón, T0 · 2026-10-29; T1: el teléfono se entera y «comí lo del plan»)
//
// «¿Qué me recomiendas hoy?», «decide tú», «toma el control» → los 3 caminos de hoy con su resumen y los botones
// (Estricto · Óptimo · Flexible · Otro). Al elegir, Eris arma el día por código (services/DayPlan.ts) y lo guarda: la
// persona solo lo sigue. «Otro» pide una nota («almuerzo afuera», «sin plata hasta el viernes»…). Con un plan de hoy:
// «otra opción para el almuerzo», «comí lo del plan», «¿cuál es mi plan?», «borra el plan». Todo por código, sin pasar
// por el modelo. Cada cambio le llega al teléfono (`day_plan`), igual que lo hecho en la tarjeta «Plan de Eris».
// ⚡ R0 (2026-10-29): «necesito rendir hoy», «día exigente», «modo rendimiento» → el día exigente (solo con el modo
// habilitado: Ikaros o el interruptor del panel). «Estoy estresado y tengo que concentrarme» o «estrés 4, foco 2, ideas»
// → el check-in de mente, que ordena los bloques del día.
// ⚡ R2: «¿cómo vengo de estrés?», «¿cómo me han ido los días exigentes?» → las señales de mente (services/MindSignals.ts):
// los check-ins de la semana, el pulso en reposo contra su promedio y lo que se repite después de sus días exigentes.
// En palabras, sin puntajes.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { previewText, planText, parseMente, parseNota, MODE_NAME, type DayPlan, type PlanMode } from "../services/DayPlan.js";
import { gatherDayPlanInput } from "../services/DayPlan.js";
import { loadPlan, buildPlan, swapPlan, undoPlan, doneStep, pushPlan, rendimientoOk, mindSignalsFor } from "../services/DayPlanService.js";
import { mindText } from "../services/MindSignals.js";
import { leerAutoPrefs, administraTexto } from "../services/AutoPrefs.js";
import { MEAL_NAME, slotAt, wakeHourFrom } from "../services/MealSchedule.js";

const Schema = z.object({
  action: z.enum(["preview", "build", "otro", "swap", "done", "show", "undo", "senales", "administra"]).describe(
    "preview = «¿qué me recomiendas hoy?» / «decide tú» (los 3 caminos); build = arma el día con un camino; otro = pide su caso; " +
    "swap = otra opción para una comida del plan; done = «comí lo del plan»; show = su plan de hoy; undo = borra el plan de hoy; " +
    "senales = «¿cómo vengo de estrés?» (check-ins, pulso en reposo y días exigentes); " +
    "administra = «¿qué haces sola?», «¿cómo manejas mi plata?» (lo que Eris hace sola en cada módulo)"),
  mode: z.enum(["estricto", "optimo", "flexible", "rendimiento"]).optional().describe("build: el camino elegido (rendimiento = «necesito rendir hoy», día exigente)"),
  nota: z.string().max(240).optional().describe("build: lo que contó en «Otro» («hoy almuerzo afuera», «estoy sin plata»)"),
  mente: z.object({ estres: z.number().int().min(1).max(5).optional(), foco: z.number().int().min(1).max(5).optional(), tipo: z.enum(["detalle", "ideas", "todo"]).optional() })
    .optional().describe("build en rendimiento: cómo está (estrés y foco del 1 al 5) y qué pide su día"),
  slot: z.string().optional().describe("swap / done: la comida (desayuno, almuerzo, once, cena, colacion_pm…)"),
});
type Input = z.infer<typeof Schema>;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
const PENDING_KEY = "day_plan_pending";
/** «¿Qué haces sola?», «¿cómo manejas mi plata?», «¿qué decides tú por mí?» */
export const ADMIN_ASK = /\b(que (?:cosas )?(?:haces|decides|manejas|administras|anotas|arreglas) (?:tu )?sola|que (?:haces|decides) (?:tu )?por mi|como (?:manejas|administras) (?:mi|mis|tu|la|el|lo)|asi manejas|que manejas tu|que puedes hacer sola|que haces en automatico)\b/;
const PENDING_MIN = 30;

/** «¿Qué me recomiendas hoy?», «decide tú», «toma el control», «arma mi día», «lo que Eris quiera» */
export const TIMON_ASK = /\b(que (me )?recomiendas?( (para )?hoy| tu)?|que (me )?recomienda eris|recomiendame (algo )?(para )?hoy|decide (tu|por mi)|tu decides|decidelo tu|toma (tu )?el (control|timon)|agarra el timon|toma las riendas|arma(me)? (mi|el) dia|lo que (tu|eris) (quiera|quieras|digas))\b/;
const NO_TIMON = /\b(comer|almorzar|cenar|desayunar|once|colacion|snack|picar|entrenar|comprar|gastar|ver|leer|serie|pelicula|libro|cancion|musica|suplemento\w*)\b/;
const MODE_RX = /^(?:(?:el|la|modo|camino|plan|ruta|vamos con|dale con|quiero|prefiero)\s+)*(estricto|optimo|flexible|permisivo|rendimiento)(?:\s+(?:porfa\w*|por favor|nomas|no mas|po))?$/;
const MODE_ANY = /\b(?:modo|camino|plan|ruta)\s+(estricto|optimo|flexible|permisivo|rendimiento)\b/;
/**
 * El día exigente: «necesito rendir hoy», «día exigente», «modo rendimiento», «¿cómo sobrevivo a este día?». «Necesito rendir»
 * solo si es HOY (o termina ahí, o viene con el cansancio): «quiero rendir más en el gimnasio este mes» no es un día exigente.
 */
export const RENDIR_ASK = /\b((necesito|tengo que|debo|quiero) (rendir|dar el ancho|estar al (100|cien)|funcionar al (100|cien)|estar a full|estar enfocad\w*)(?=( al maximo)?( hoy| todo el dia| ahora| aunque| a pesar| pese| y (no )?(dormi|tengo sueno|estoy cansad)|$))|dia (exigente|sacrificado|clave|decisivo|pesado y (dormi|tengo)\w*)|modo rendimiento|(maximo|max) rendimiento|rendimiento maximo|como (sobrevivo|aguanto|paso) (a )?(este|el) dia|rendir (hoy )?(aunque|a pesar de|pese a) (haber )?dormi\w*)\b/;
/** El check-in por chat: «estoy estresado y tengo que concentrarme», «no me puedo concentrar y tengo que estudiar» */
const MIND_ASK = /\b(estresad\w*|ansios\w*|colapsad\w*|agobiad\w*|dispers[oa]|no me puedo concentrar|no logro concentrarme|me cuesta concentrarme)\b.{0,50}\b(tengo que|necesito|debo)\s+(concentrarme|enfocarme|rendir|estudiar|trabajar|terminar|entregar|pensar)\b/;
/** R2: «¿cómo vengo de estrés?», «¿cómo me han ido los días exigentes?», «mis check-ins» */
export const SENALES_ASK = /\b(como (vengo|ando|voy|estoy|he estado|he andado) de (estres|foco|cabeza|mente)|como (me )?(han ido|fueron|van|me fue con|me va con) (los |mis )?dias exigentes|(mis|los) check[ -]?ins?\b|historial de (estres|mente|check[ -]?ins?|dias exigentes)|que (ves|notas|sabes) de mi (estres|mente|cabeza|foco)|senales de (estres|mente)|(ando|vengo|he estado|estoy) (muy )?estresad\w* (ultimamente|esta semana|estos dias))/;
/** Respuesta al «¿cómo estás?» del modo: «estrés 4, foco 2, detalle» */
const MIND_REPLY = /\b(estres\w*|foco|concentracion|detalle|ideas|de todo)\b/;
const MEAL_W = "(desayuno|almuerzo|once|cena|colacion)";
const SWAP_RX = new RegExp(`\\b(otra opcion|otra cosa|cambia(me)?|otro plato|no me gusta)\\b.*\\b${MEAL_W}\\b|\\b${MEAL_W}\\b.*\\b(otra opcion|otra cosa|cambialo|cambiala)\\b`);
/** «comí lo del plan», «listo el almuerzo del plan», «me comí lo que dijiste» */
const DONE_RX = /\b(comi|almorce|cene|desayune|tome once|me comi|me tome|listo|hecho)\b.{0,30}\b(lo del plan|del plan|lo que (dijiste|me dijiste|propusiste|recomendaste|me recomendaste))\b/;
const SHOW_RX = /\b(cual (es|era) (mi|el) plan|(mi|el) plan (de hoy|de eris|del dia)|que (me toca|sigue) (del|en el|segun el) plan|muestra(me)? (mi|el) plan|ver (mi|el) plan)\b/;
const UNDO_RX = /\b(borra|deshaz|cancela|quita|elimina)\w* (el|mi) plan\b/;
const toMode = (w: string): PlanMode => (w === "permisivo" ? "flexible" : (w as PlanMode));
const art = (slot: string) => (slot === "almuerzo" || slot === "desayuno" ? "el" : "la");

export class DayPlanTool extends Tool<Input> {
  readonly name = "day_plan";
  readonly description =
    "«¿Qué recomienda Eris?»: Eris decide y arma el día completo (comida con lo que hay en casa, entreno según cómo durmió, tope de " +
    "gasto, lo que vence y la hora de dormir) en 3 caminos: estricto, óptimo o flexible, o con su caso («otro»). USAR con " +
    "'¿qué me recomiendas hoy?', 'decide tú', 'toma el control', 'modo estricto'. Presenta lo que devuelve tal cual.";
  readonly inputSchema = Schema;

  async preroute(message: string, context?: any): Promise<Record<string, unknown> | null> {
    const t = fold(message || "");
    if (!t || t.length > 240) return null;
    const memory = context?.memory;
    const pending: any = memory ? await memory.get(PENDING_KEY).catch(() => null) : null;
    const live = pending && Date.now() - Date.parse(pending.at) < PENDING_MIN * 60_000;
    // A3: «¿qué haces sola?» (lo que Eris administra en cada módulo, con sus interruptores)
    if (ADMIN_ASK.test(t)) return { action: "administra" };
    // R2: las señales de mente (una pregunta, no un check-in)
    if (SENALES_ASK.test(t)) return (await rendimientoOk(context?.role)) ? { action: "senales" } : null;
    // Respondió a «cuéntame tu caso» (Otro): la nota arma el día en Óptimo
    // Solo si es la respuesta a esa pregunta (lo último que dijo Eris): antes, durante 30 min CUALQUIER mensaje armaba el día
    // con él como nota (revisión 2026-11-04, C2)
    if (live && pending.awaiting === "nota" && !MODE_RX.test(t) && /Cuéntame tu caso/.test(String(context?.lastAssistantMessage ?? ""))) return { action: "build", mode: "optimo", nota: message.trim().slice(0, 240) };
    // Respondió al check-in del día exigente («estrés 4, foco 2, ideas»)
    if (live && pending.awaiting === "mente" && MIND_REPLY.test(t) && t.length < 60) { const mente = parseMente(t); if (mente) return { action: "build", mode: "rendimiento", mente }; }
    // El día exigente (o el check-in que lo pide): con lo que contó en la misma frase
    if (RENDIR_ASK.test(t) || MIND_ASK.test(t)) {
      if (!(await rendimientoOk(context?.role))) return null;
      const mente = parseMente(t);
      return { action: "build", mode: "rendimiento", ...(mente ? { mente } : {}), ...(parseNota(message).leida ? { nota: message.trim().slice(0, 240) } : {}) };
    }
    // Eligió un camino (botón o «modo estricto»)
    const m = MODE_RX.exec(t) ?? MODE_ANY.exec(t);
    if (m && (live || MODE_ANY.test(t))) return { action: "build", mode: toMode(m[1]) };
    if (live && /^otr[oa]( cosa| caso)?$/.test(t)) return { action: "otro" };
    if (TIMON_ASK.test(t) && !NO_TIMON.test(t)) return { action: "preview" };
    if (UNDO_RX.test(t)) return { action: "undo" };
    // Lo que sigue necesita un plan de hoy
    if (!memory || !(SWAP_RX.test(t) || SHOW_RX.test(t) || DONE_RX.test(t))) return null;
    const plan = await loadPlan(memory);
    if (!plan) return null;
    const meal = new RegExp(`\\b${MEAL_W}\\b`).exec(t)?.[1];
    const slotOf = (w?: string) => (!w ? undefined : w === "colacion"
      ? ((plan.pasos.find((p) => p.accion.type === "log_food" && p.accion.slot.startsWith("colacion"))?.accion as any)?.slot ?? "colacion_pm") : w);
    if (DONE_RX.test(t)) return { action: "done", ...(meal ? { slot: slotOf(meal) } : {}) };
    if (SWAP_RX.test(t)) return { action: "swap", slot: slotOf(meal) };
    return { action: "show" };
  }

  async execute(input: Input, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    if (!memory) return { output: "", error: "Sin acceso al perfil." };
    const ws = context?.wsClient;
    const done = (t: string) => ({ output: t, metadata: { quickReply: t } });
    const sinPlan = "Hoy todavía no tienes un plan de Eris. Pregúntame «¿qué me recomiendas hoy?» y lo armo.";
    const now = new Date();
    switch (input.action) {
      case "administra": return done(administraTexto(await leerAutoPrefs(memory)));
      case "preview": {
        const i = await gatherDayPlanInput(memory, now);
        await memory.set(PENDING_KEY, { awaiting: "modo", at: now.toISOString() }).catch(() => {});
        return done(previewText(i, { rendimiento: await rendimientoOk(context?.role) }));
      }
      case "otro": {
        await memory.set(PENDING_KEY, { awaiting: "nota", at: now.toISOString() }).catch(() => {});
        return done("Cuéntame tu caso en una frase y armo el día con eso. Por ejemplo: «hoy almuerzo afuera», «estoy sin plata hasta el viernes», «me duele la rodilla», «tengo un cumpleaños en la noche» o «no tengo tiempo».");
      }
      case "build": {
        const rend = input.mode === "rendimiento";
        if (rend && !(await rendimientoOk(context?.role))) return done("El modo Rendimiento todavía está en prueba. Por ahora tienes Estricto, Óptimo y Flexible: pregúntame «¿qué me recomiendas hoy?».");
        const plan = await buildPlan(memory, input.mode ?? "optimo", input.nota, now, null, context?.llm ?? null, rend ? input.mente ?? null : null);
        // Sin el check-in, queda esperando «estrés 4, foco 2, ideas» un rato (afina el día sin repetir la pregunta)
        await memory.set(PENDING_KEY, rend && !plan.mente ? { awaiting: "mente", at: now.toISOString() } : null).catch(() => {});
        pushPlan(ws, plan, { aplicar: true });
        return done(planText(plan));
      }
      case "swap": {
        const r = await swapPlan(memory, input.slot ?? "almuerzo");
        if (!r) return done((await loadPlan(memory)) ? `No tengo otra opción para ${art(input.slot ?? "")} ${MEAL_NAME[input.slot ?? ""] ?? "esa comida"} en tu plan de hoy.` : sinPlan);
        pushPlan(ws, r.plan);
        const sl = (r.paso.accion as any).slot as string;
        return done(`Listo, cambié ${art(sl)} ${MEAL_NAME[sl] ?? "comida"}: ${r.paso.detalle}.`);
      }
      case "done": {
        const plan = await loadPlan(memory);
        if (!plan) return done(sinPlan);
        // La comida que dijo, o la que toca ahora (la primera pendiente que ya empezó, si no la siguiente)
        const snap = await memory.get("health_snapshot_latest").catch(() => null);
        const ahora = slotAt(now, { wakeHour: wakeHourFrom(snap, now) });
        const pend = plan.pasos.filter((p) => p.accion.type === "log_food" && !p.hecho);
        const paso = (input.slot ? pend.find((p) => (p.accion as any).slot === input.slot) : null)
          ?? pend.find((p) => (p.accion as any).slot === ahora) ?? pend[0];
        if (!paso) return done("Ya anoté todas las comidas de tu plan de hoy. 🙌");
        const r = await doneStep(memory, ws, paso.id, now);
        if (!r) return done(sinPlan);
        pushPlan(ws, r.plan);
        const sl = (paso.accion as any).slot as string;
        return done(`✅ Anoté ${art(sl)} ${MEAL_NAME[sl] ?? "comida"} del plan tal cual: ${paso.detalle}.`);
      }
      case "show": {
        const plan = await loadPlan(memory);
        return done(plan ? planText(plan) : sinPlan);
      }
      case "senales": {
        if (!(await rendimientoOk(context?.role))) return done("Eso viene con el modo Rendimiento, que todavía está en prueba.");
        return done(mindText(await mindSignalsFor(memory, now)));
      }
      case "undo": {
        const plan = await undoPlan(memory);
        if (!plan) return done("No hay un plan de Eris para hoy.");
        pushPlan(ws, null);
        return done(`Listo, borré tu plan ${MODE_NAME[plan.mode]} de hoy. Cuando quieras, te armo otro.`);
      }
    }
  }
}

export type { DayPlan };
