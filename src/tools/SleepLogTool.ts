// ============================================================
// Eris — SleepLogTool (sleep_log)
//
// El sueño solo llegaba del reloj (Health Connect). Si no lo midió (se quedó cargando), no había dónde anotarlo: el
// 2026-10-07 Eris lo guardó como nota PERMANENTE del perfil ("Sueño: 7 horas") y después dijo "lo dejé solo para hoy"
// sin hacer nada. Esto lo anota para la noche que corresponde: entra al resumen del día (patrones, análisis, puntaje) y
// al teléfono (Métricas, Inicio).
// 2026-10-16 (conversaciones reales): «dormí de 8:15 a 11:15» se anotó como 4,25 h (lo calculaba el modelo) y «dormí 3
// horas más» quedaba «como referencia» porque el reloj mandaba. Ahora: los tramos se calculan por código, «más/aparte/
// siesta» se SUMA a lo que había, y lo que dice la persona manda sobre el reloj (el reloj se equivoca si quedó cargando).
// Si da un tramo y esa noche ya tiene otra cifra, se pregunta si es aparte o si la reemplaza.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { localDay } from "../services/DailyTargets.js";
import { parseSleepStatement } from "../services/SleepParse.js";
import { asksToLog } from "../services/FoodParse.js";

export const SLEEP_LOG_KEY = "sleep_log";
const PENDING_KEY = "sleep_pending";
const PENDING_MIN = 10;
export interface SleepEntry { hours: number; source: "manual"; at: string }

const Schema = z.object({
  action: z.enum(["log", "get", "delete"]).default("log").describe("log = anotar; get = ver lo anotado; delete = borrar lo anotado de esa noche"),
  hours: z.number().optional().describe("Horas dormidas (7, 6.5). Requerido para log."),
  day: z.enum(["hoy", "ayer"]).optional().describe("'hoy' = la noche de la que despertó hoy (anoche), por defecto; 'ayer' = la anterior"),
  extra: z.boolean().optional().describe("true si son horas ADICIONALES a lo que ya durmió esa noche («3 horas más», una siesta): se suman"),
  base: z.number().optional().describe("Interno: la primera cifra cuando dice «dormí 4 y después 3 más»"),
  rango: z.string().optional().describe("Interno: el tramo «8:15 a 11:15»"),
  modo: z.enum(["sumar", "reemplazar"]).optional().describe("Interno: respuesta a «¿es aparte o reemplaza?»"),
});
type Input = z.infer<typeof Schema>;

const dayKeyFor = (day: "hoy" | "ayer" | undefined) => {
  const d = new Date();
  if (day === "ayer") d.setDate(d.getDate() - 1);
  return localDay(d);
};
const fmtH = (h: number) => {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
};
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export async function getSleepLog(memory: any): Promise<Record<string, SleepEntry>> {
  const v = await memory?.get?.(SLEEP_LOG_KEY).catch?.(() => null);
  return v && typeof v === "object" ? v : {};
}

/** Lo anotado a mano para la noche de la que se despertó ese día (YYYY-MM-DD), o null. */
export async function manualSleepFor(memory: any, day = localDay()): Promise<number | null> {
  const e = (await getSleepLog(memory))[day];
  return e && typeof e.hours === "number" ? e.hours : null;
}

/** Lo que midió el reloj para la noche de hoy (si el resumen de salud es de hoy y no es algo anotado a mano). */
async function delReloj(memory: any, day: string): Promise<number | null> {
  if (day !== localDay()) return null;
  try {
    const snap = await memory.get("health_snapshot_latest");
    const fresh = snap?.lastUpdated && new Date(snap.lastUpdated).toDateString() === new Date().toDateString();
    return fresh && typeof snap?.sleep?.durationHours === "number" && !snap.sleep.manual ? snap.sleep.durationHours : null;
  } catch { return null; }
}

export class SleepLogTool extends Tool<Input> {
  readonly name = "sleep_log";
  readonly description =
    "Anota cuántas horas durmió el usuario: 'dormí 7 horas', 'anoche dormí 6 y media', 'dormí de 23:30 a 7', 'dormí 2 horas más' " +
    "(extra=true: se suman). Queda SOLO para esa noche y alimenta Métricas, el puntaje y el análisis del día. Lo que dice la persona " +
    "manda sobre el reloj. NUNCA guardes el sueño (ni nada del día) en el perfil con manage_user_profile. " +
    "'get' muestra lo anotado los últimos días; 'delete' borra lo anotado de una noche.";
  readonly inputSchema = Schema;

  /** "dormí 7 horas", "de 8:15 a 11:15", "3 horas más" se anotan por código, sin depender de que el modelo calcule. */
  async preroute(message: string, context?: any): Promise<Record<string, unknown> | null> {
    const memory = context?.memory;
    // Respuesta a «¿es aparte o reemplaza?»
    if (memory) {
      const p: any = await memory.get(PENDING_KEY).catch(() => null);
      if (p && Date.now() - new Date(p.at).getTime() < PENDING_MIN * 60_000) {
        const t = fold(message);
        if (t.length <= 50) {
          if (/\b(aparte|suma\w*|agrega\w*|adicional\w*|si\b|sí\b)/.test(t)) { await memory.set(PENDING_KEY, null).catch(() => {}); return { action: "log", hours: p.hours, day: p.day, rango: p.rango, modo: "sumar" }; }
          if (/\b(reemplaza\w*|cambia\w*|esas? (son|fueron)|solo esas?|no\b)/.test(t)) { await memory.set(PENDING_KEY, null).catch(() => {}); return { action: "log", hours: p.hours, day: p.day, rango: p.rango, modo: "reemplazar" }; }
        }
      }
    }
    const s = parseSleepStatement(message);
    if (!s) return null;
    if (asksToLog(message)) return null; // también trae comida o agua: que lo resuelva el modelo con ambas herramientas
    return { action: "log", hours: s.hours, day: s.day, ...(s.extra ? { extra: true } : {}), ...(s.base ? { base: s.base } : {}), ...(s.rango ? { rango: s.rango } : {}) };
  }

  async execute(input: Input, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    if (!memory) return { output: "", error: "No hay memoria activa en este contexto." };
    const day = dayKeyFor(input.day);
    const log = await getSleepLog(memory);

    if (input.action === "get") {
      const days = Object.keys(log).sort().reverse().slice(0, 7);
      return { output: days.length ? days.map((d) => `- ${d}: ${fmtH(log[d].hours)} (anotado)`).join("\n") : "No hay sueño anotado a mano." };
    }

    if (input.action === "delete") {
      if (!log[day]) return { output: `No había sueño anotado para la noche del ${day}.` };
      delete log[day];
      await memory.set(SLEEP_LOG_KEY, log);
      try { context?.wsClient?.send?.(JSON.stringify({ type: "sleep_logged", day, hours: null })); } catch {}
      return { output: `Listo, borré el sueño anotado de esa noche.`, metadata: { quickReply: "Listo, borré el sueño que había anotado de esa noche." } };
    }

    const hours = Number(input.hours);
    if (!Number.isFinite(hours) || hours < 0.25 || hours > 16) {
      return { output: "", error: "Faltan las horas dormidas (entre 1 y 16). Pregúntale al usuario cuántas horas durmió." };
    }
    const reloj = await delReloj(memory, day);
    const manual = typeof log[day]?.hours === "number" ? log[day].hours : null;
    const antes = manual ?? reloj; // lo que ya había esa noche (lo anotado manda sobre el reloj)
    const tramo = input.rango ? ` (de ${input.rango})` : "";

    // Un tramo cuando esa noche ya tiene otra cifra: ¿es aparte o la reemplaza? (no se adivina)
    if (input.rango && !input.extra && !input.modo && antes != null && Math.abs(antes - hours) > 0.25) {
      await memory.set(PENDING_KEY, { hours, day, rango: input.rango, at: new Date().toISOString() }).catch(() => {});
      const de = manual != null ? "anotado" : "en tu reloj";
      const q = `Esa noche ya tenías ${fmtH(antes)} ${de}. ¿Estas ${fmtH(hours)}${tramo} son aparte (las sumo: ${fmtH(antes + hours)}) o reemplazan lo que había?\n[Opción: Son aparte, súmalas] [Opción: Reemplaza]`;
      return { output: q, metadata: { quickReply: q } };
    }

    const sumar = !!input.base || input.extra || input.modo === "sumar";
    const total = Math.round((input.base ? input.base + hours : sumar && antes != null ? antes + hours : hours) * 100) / 100;
    if (total > 20) return { output: "", error: "Eso suma más de 20 horas: pregúntale al usuario cuánto durmió en total." };

    log[day] = { hours: total, source: "manual", at: new Date().toISOString() };
    for (const k of Object.keys(log).sort().slice(0, Math.max(0, Object.keys(log).length - 60))) delete log[k];
    await memory.set(SLEEP_LOG_KEY, log);
    // Lo anotado manda: el resumen de salud de hoy y el del día usan esta cifra
    if (day === localDay()) {
      try {
        const snap = await memory.get("health_snapshot_latest");
        if (snap) await memory.set("health_snapshot_latest", { ...snap, sleep: { ...(snap.sleep ?? {}), durationHours: total, manual: true, ...(reloj != null ? { reloj } : {}) } });
      } catch {}
    }
    await memory.upsertDailyRollup({ sleepHours: total }, day).catch(() => {});
    try { context?.wsClient?.send?.(JSON.stringify({ type: "sleep_logged", day, hours: total })); } catch {}

    const when = day === localDay() ? "de anoche" : "de anteanoche";
    let reply: string;
    if (input.base) reply = `😴 Anoté ${fmtH(total)} de sueño ${when}: ${fmtH(input.base)} + ${fmtH(hours)} más.`;
    else if (sumar && antes != null) reply = `😴 Sumé ${fmtH(hours)}${tramo}: quedan ${fmtH(total)} de sueño ${when} (${fmtH(antes)} ${manual != null ? "que ya estaban anotadas" : "de tu reloj"} + ${fmtH(hours)}).`;
    else if (reloj != null && Math.abs(reloj - total) > 0.25) reply = `😴 Anoté ${fmtH(total)} de sueño ${when}${tramo}; tu reloj marcaba ${fmtH(reloj)}, uso lo que me dices.`;
    else reply = `😴 Anoté ${fmtH(total)} de sueño ${when}${tramo}. Lo uso en tu análisis, en Métricas y en tu puntaje.`;
    return { output: reply, metadata: { quickReply: reply } };
  }
}
