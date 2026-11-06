// ============================================================
// Eris — TrainingTodayTool (training_today), Forge 2.0 F3 (2026-10-17)
//
// «Hoy entreno pierna a las 7», «hoy descanso», «al final no entreno», «voy a jugar básquet 2 horas»: se anota POR CÓDIGO
// (preroute) el entreno de hoy y las metas pasan a ser «según el día» (DailyTargets): un día de descanso baja la meta de
// calorías y uno de entreno la sube con lo que vas a gastar (el «fantasma» hasta que entrenes). Responde con las cifras
// reales al tiro, sin pasar por el modelo.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { loadTargets, localDay } from "../services/DailyTargets.js";
import { buildIntent, getProjection, intentFor, parseTrainingStatement, saveIntent } from "../services/TrainingIntent.js";
import { intentPhrase } from "../services/forge/forgeTrain.js";

const Schema = z.object({
  action: z.enum(["set", "get", "clear"]).default("set").describe("set = anotar si entrena hoy o descansa; get = ver lo anotado; clear = borrarlo"),
  message: z.string().optional().describe("Lo que dijo el usuario («hoy entreno pierna a las 7», «hoy descanso»)"),
});
type Input = z.infer<typeof Schema>;

const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");

export class TrainingTodayTool extends Tool<Input> {
  readonly name = "training_today";
  readonly description =
    "Anota si el usuario entrena HOY o descansa: 'hoy entreno pierna a las 7', 'hoy descanso', 'al final no entreno', " +
    "'voy a jugar básquet 2 horas a las 8'. Con eso sus metas de hoy (calorías y agua) quedan según el día: el descanso baja, " +
    "el entreno sube. 'get' muestra lo anotado; 'clear' lo borra. No es para armar rutinas (eso es training_plan).";
  readonly inputSchema = Schema;

  /** Las frases claras se anotan por código, sin depender del modelo. */
  async preroute(message: string): Promise<Record<string, unknown> | null> {
    return parseTrainingStatement(message) ? { action: "set", message } : null;
  }

  async execute(input: Input, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    if (!memory) return { output: "", error: "No hay memoria activa en este contexto." };
    const today = localDay();
    if (input.action === "get") {
      const it = await intentFor(memory, today);
      return { output: !it ? "Hoy todavía no dice si entrena." : it.answer === "no" ? "Hoy: día de descanso." : `Hoy entrena: ${intentPhrase(it)}${it.kcal ? ` (~${fmt(it.kcal)} kcal planificadas)` : ""}.` };
    }
    if (input.action === "clear") {
      await saveIntent(memory, today, null);
      context?.wsClient?.send?.(JSON.stringify({ type: "training_intent", day: today, intent: null }));
      return { output: "Borré lo de hoy: tus metas vuelven a las de siempre." };
    }
    const st = parseTrainingStatement(input.message ?? "");
    if (!st) return { output: "", error: "No entendí si entrena hoy o descansa. Pregúntale: «¿Entrenas hoy? ¿A qué hora y qué toca?»" };
    const [proj, body] = await Promise.all([getProjection(memory), memory.get("body_profile").catch(() => null)]);
    const intent = buildIntent(st, proj, body?.weightKg, today, "chat");
    await saveIntent(memory, today, intent);
    context?.wsClient?.send?.(JSON.stringify({ type: "training_intent", day: today, intent }));
    const t = await loadTargets(memory).catch(() => null);
    let reply: string;
    if (intent.answer === "no") {
      reply = st.cancel
        ? `Sin drama: lo saco de tus metas. Hoy te quedas con ${t ? `${fmt(t.kcal)} kcal` : "la meta de un día sin entreno"}.`
        : `Anotado: hoy descansas.${t ? ` Tu meta de hoy queda en ${fmt(t.kcal)} kcal (día de descanso)${t.waterL ? ` y ${String(t.waterL).replace(".", ",")} L de agua` : ""}.` : ""}`;
    } else {
      const dur = intent.minutes ? (intent.minutes >= 60 ? `${Math.floor(intent.minutes / 60)} h${intent.minutes % 60 ? ` ${intent.minutes % 60} min` : ""}` : `${intent.minutes} min`) : "";
      const what = intent.kind === "otra" ? `hoy toca ${intent.label ?? "tu actividad"}${dur ? ` (${dur})` : ""}` : `hoy entrenas${intent.label ? ` ${intent.label.toLowerCase()}` : ""}`;
      reply = `Listo: ${what}${intent.time ? ` a las ${intent.time}` : ""}${intent.kcal ? `, ~${fmt(intent.kcal)} kcal` : ""}.`
        + (t ? ` Tu meta de hoy queda en ${fmt(t.kcal)} kcal${t.kcalGhost ? `: incluye ~${fmt(t.kcalGhost)} del entreno, así que puedes comer para entrenar` : ""}.` : "")
        + " Si al final no entrenas, dime «al final no entreno».";
    }
    // Tono «brígida» (services/Brigida.ts): una línea de veredicto
    const veredicto = intent?.answer === "no" ? "Descanso anotado. Mañana se vuelve." : intent ? "Anotado. Ahora a cumplir." : undefined;
    return { output: reply, metadata: { quickReply: reply, ...(veredicto ? { veredicto } : {}) } };
  }
}
