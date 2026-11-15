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
// 2026-11-07: con las dos horas se guarda el tramo, igual que en la pantalla de Sueño, y el día lo deduce Eris. Ya no se pregunta «¿es
// aparte o reemplaza?»: nadie sabía responder, y con el tramo se sabe solo. Tras un sueño largo a hora rara: «¿Cómo sigues?».
// ============================================================

import { veredictoSueno } from "../services/Brigida.js";
import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { localDay } from "../services/DailyTargets.js";
import { parseSleepStatement, parseSleepTimes, parseSleepOnset, parseWakeAnswer, resolveSleepSaid } from "../services/SleepParse.js";
import { asksToLog } from "../services/FoodParse.js";
import { sleepSummaryText, sleepReading, insightsText, bedtimeText, fmtSleep, hhmmOf, patternsText, sleepKey, wakeIsOdd, sleepRangeText, wakeQuestionText, clock, WAKE_WAIT_H, type SleepInsights, type SaidTime } from "../services/SleepCore.js";

export const SLEEP_LOG_KEY = "sleep_log";
const PENDING_KEY = "sleep_pending";
const PENDING_MIN = 10;
export interface SleepEntry { hours: number; source: "manual"; at: string; /** Sueño 2.0 · S0: las partes que contó («4 y en la tarde 4 más»): la primera es la noche */ parts?: number[]; /** los tramos dichos con sus horas [inicio, fin] (ms) */ tramos?: Array<[number, number]> }

const Schema = z.object({
  action: z.enum(["log", "get", "delete", "report", "bedtime", "why", "ask_wake", "seguir"]).default("log").describe("log = anotar; get = ver lo anotado; delete = borrar lo anotado de esa noche; " +
    "report = «¿cómo dormí?» / «¿cómo vengo con el sueño?» (con sus datos); bedtime = «¿a qué hora me acuesto?» / hasta qué hora tomar café; " +
    "why = «¿por qué duermo mal?» (lo que se repite en sus noches de 30 días)"),
  semana: z.boolean().optional().describe("report: true si pregunta por su sueño de las últimas semanas, no solo por anoche"),
  hours: z.number().optional().describe("Horas dormidas (7, 6.5). Requerido para log."),
  // Tolerante: el modelo a veces escribe «anoche», «today» o una fecha (2026-10-23, chat_eval «recién desperté»: la validación
  // fallaba y Eris terminaba diciendo «si no hay herramientas…»). Lo que no es «ayer/anteanoche» es la noche de hoy.
  day: z.preprocess((v) => (v == null || v === "" ? undefined : /^(ayer|anteanoche|yesterday|la anterior)$/i.test(String(v).trim()) ? "ayer" : "hoy"),
    z.enum(["hoy", "ayer"]).optional()).describe("'hoy' = la noche de la que despertó hoy (anoche), por defecto; 'ayer' = la anterior"),
  extra: z.boolean().optional().describe("true si son horas ADICIONALES a lo que ya durmió esa noche («3 horas más», una siesta): se suman"),
  base: z.number().optional().describe("Interno: la primera cifra cuando dice «dormí 4 y después 3 más»"),
  rango: z.string().optional().describe("Interno: el tramo «8:15 a 11:15»"),
  desde: z.number().optional().describe("Interno: inicio del tramo (ms)"),
  hasta: z.number().optional().describe("Interno: fin del tramo (ms)"),
  onsetMin: z.number().optional().describe("Interno: la hora en que se durmió, cuando no dijo a qué hora despertó"),
  onsetAmb: z.boolean().optional().describe("Interno"),
  fin: z.string().optional().describe("Interno: el fin del sueño por el que se preguntó «¿Cómo sigues?»"),
  choice: z.enum(["dormir", "partir"]).optional().describe("Interno: la respuesta a «¿Cómo sigues?»"),
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

/** Lo anotado a mano para la noche de la que se despertó ese día (YYYY-MM-DD), o null. Un tramo con horas no: el teléfono ya lo tiene. */
export async function manualSleepFor(memory: any, day = localDay()): Promise<number | null> {
  const e = (await getSleepLog(memory))[day];
  return e && typeof e.hours === "number" && !e.tramos?.length ? e.hours : null;
}

/** Los tramos juntos, sin contar dos veces lo que se pisa */
function unirTramos(xs: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a, b] of [...xs].sort((p, q) => p[0] - q[0])) {
    const u = out[out.length - 1];
    if (u && a <= u[1]) u[1] = Math.max(u[1], b); else out.push([a, b]);
  }
  return out;
}
const horasDe = (x: [number, number]) => (x[1] - x[0]) / 3_600_000;

/** Lo que midió el reloj para la noche de hoy (si el resumen de salud es de hoy y no es algo anotado a mano). */
async function delReloj(memory: any, day: string): Promise<number | null> {
  if (day !== localDay()) return null;
  try {
    const snap = await memory.get("health_snapshot_latest");
    const fresh = snap?.lastUpdated && new Date(snap.lastUpdated).toDateString() === new Date().toDateString();
    return fresh && typeof snap?.sleep?.durationHours === "number" && !snap.sleep.manual ? snap.sleep.durationHours : null;
  } catch { return null; }
}

/** «Borra el sueño que anoté», «elimina lo que dormí de anoche» */
const DELETE_ASK = /\b(borra\w*|elimina\w*|quita\w*|deshaz|deshace\w*|anula\w*)\b[^.?!]{0,40}\b(sueno|dormi|horas de sueno)\b/;
/** «¿Cómo dormí?», «¿dormí bien?», «¿cuánto dormí anoche?» */
const REPORT_ASK = /\b(como dormi|como he dormido|que tal dormi|dormi bien|cuanto dormi|como (fue|estuvo) (mi|el) sueno|mi sueno de anoche|como me fue (con el sueno|durmiendo))\b/;
/** «¿Cómo vengo con el sueño?», «mi deuda de sueño», «¿duermo bien?» */
const WEEK_SLEEP_ASK = /\b(como (vengo|voy|ando|estoy) (con el|de|del) sueno|deuda de sueno|como duermo|duermo (bien|poco|mal)|mi sueno (de|esta|en) (la )?(semana|ultimas)|regularidad (del|de mi) sueno|mi cronotipo)\b/;
/** «¿A qué hora me acuesto?», «¿hasta qué hora puedo tomar café?» */
const WHY_ASK = /\b(por que (duermo|dormi|he dormido|estoy durmiendo|me despierto|despierto|me cuesta (dormir|dormirme)|no (puedo dormir|duermo|me puedo dormir|descanso))|que me (quita|afecta|esta quitando|arruina) el sueno|duermo (mal|pesimo|fatal|como el (pico|forro))|no (puedo dormir|duermo bien|descanso bien) (ultimamente|estos dias|hace (dias|semanas))|me cuesta (dormir|dormirme|quedarme dormido)|me despierto (mucho|muchas veces|en la noche)|que hace que duerma mal|que (puedo|debo) (cambiar|hacer) para dormir mejor|como (puedo )?dormir mejor)\b/;
const BED_ASK = /\b(a que hora (me )?(acuesto|duermo|deberia (acostarme|dormir)|me deberia acostar|me tengo que acostar|tengo que dormir)|hora (de|para) (acostarme|dormir)|hasta que hora (puedo tomar|tomo|me tomo) (cafe|cafeina|un cafe))\b/;

/** Lo de las 2 semanas que manda el teléfono (sleepCore · S1), si se ve sano */
const insightsOf = (snap: any): SleepInsights | null => {
  const s = snap?.sleepInsights;
  return s && typeof s === "object" && typeof s.need === "number" && s.bedtime && typeof s.bedtime.target === "number" ? (s as SleepInsights) : null;
};

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
    // Respuesta a lo último que preguntó Eris: solo un mensaje corto, y solo si eso fue lo último que dijo
    if (memory) {
      const p: any = await memory.get(PENDING_KEY).catch(() => null);
      const antes = String(context?.lastAssistantMessage ?? "");
      if (p && Date.now() - new Date(p.at).getTime() < PENDING_MIN * 60_000) {
        const t = fold(message).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
        if (p.kind === "seguir" && /¿Cómo sigues\?/.test(antes) && t.length <= 40) {
          if (/\b(vuelvo a dormir|voy a dormir|me vuelvo a dormir|sigo durmiendo|dormir)\b/.test(t)) return { action: "seguir", fin: p.fin, choice: "dormir" };
          if (/\b(parto|partir|mi dia|sigo despierto|me quedo despierto|ya desperte)\b/.test(t)) return { action: "seguir", fin: p.fin, choice: "partir" };
        }
        if (p.kind === "despertar" && /a qué hora despertaste/i.test(antes)) {
          const b = parseWakeAnswer(message);
          const r = b ? resolveSleepSaid({ a: p.onset as SaidTime, b, atras: false }, Date.now()) : null;
          if (r) { await memory.set(PENDING_KEY, null).catch(() => {}); return { action: "log", desde: r.start, hasta: r.end }; }
        }
      }
    }
    // Preguntas (Sueño 2.0 · S1): por código, con sus datos (antes el modelo las contestaba, a veces con el total como «una noche»)
    const q = fold(message).replace(/[¿?¡!]/g, " ").replace(/\s+/g, " ").trim();
    if (q.length <= 120 && !asksToLog(message)) {
      // «Borra el sueño que anoté de anoche»: por código (el modelo contestaba «no había nada» sin borrar)
      // Sueño 2.0 · S4: «¿por qué duermo mal?» — lo que se repite en sus noches (asociación, no causa), por código. Antes que
      // el borrado: «¿qué me está QUITANDO el sueño?» no es «quita el sueño que anoté»
      if (WHY_ASK.test(q) && !/\b(entren\w*|gym|gimnasio)\b/.test(q)) return { action: "why" };
      if (DELETE_ASK.test(q) && !/\bque me (esta )?quit/.test(q)) return { action: "delete", day: /\banteanoche\b/.test(q) ? "ayer" : "hoy" };
      if (BED_ASK.test(q)) return { action: "bedtime" };
      if (WEEK_SLEEP_ASK.test(q)) return { action: "report", semana: true };
      if (REPORT_ASK.test(q) && !/\b(entren\w*|gym|gimnasio)\b/.test(q)) return { action: "report" };
    }
    // Con las dos horas: el tramo, igual que en la pantalla de Sueño
    const dicho = parseSleepTimes(message);
    if (dicho && !asksToLog(message)) {
      const r = resolveSleepSaid(dicho, Date.now(), message);
      if (r) return { action: "log", desde: r.start, hasta: r.end };
    }
    const onset = parseSleepOnset(message);
    if (onset && !asksToLog(message)) return { action: "ask_wake", onsetMin: onset.min, onsetAmb: onset.amb };
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

    if (input.action === "report" || input.action === "bedtime" || input.action === "why") return this.report(input, memory, log);

    if (input.action === "ask_wake") {
      await memory.set(PENDING_KEY, { kind: "despertar", onset: { min: input.onsetMin, amb: !!input.onsetAmb }, at: new Date().toISOString() }).catch(() => {});
      const q = "¿Y a qué hora despertaste?\n[Opción: Recién]";
      return { output: q, metadata: { quickReply: q } };
    }

    if (input.action === "seguir") {
      await memory.set(PENDING_KEY, null).catch(() => {});
      if (!input.fin || !input.choice) return { output: "", error: "Falta la respuesta." };
      try { context?.wsClient?.send?.(JSON.stringify({ type: "sleep_wake_decision", end: input.fin, choice: input.choice })); } catch {}
      const r = input.choice === "partir"
        ? `Listo: tu día parte a las ${clock(input.fin)}. Tus comidas, tu agua y tus avisos se cuentan desde ahí.`
        : "Listo: tu día sigue igual. Cuando vuelvas a despertar, me cuentas o lo anotas en Sueño.";
      return { output: r, metadata: { quickReply: r } };
    }

    if (input.action === "log" && typeof input.desde === "number" && typeof input.hasta === "number") return this.logTramo(input.desde, input.hasta, memory, log, context);

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

    const sumar = !!input.base || input.extra;
    const total = Math.round((input.base ? input.base + hours : sumar && antes != null ? antes + hours : hours) * 100) / 100;
    if (total > 20) return { output: "", error: "Eso suma más de 20 horas: pregúntale al usuario cuánto durmió en total." };

    // Las partes que contó (la primera es la noche): «dormí 4 y después 3 más», o lo que había + lo que suma
    const parts = input.base ? [input.base, hours] : sumar && antes != null ? [antes, hours] : undefined;
    log[day] = { hours: total, source: "manual", at: new Date().toISOString(), ...(parts ? { parts } : {}) };
    for (const k of Object.keys(log).sort().slice(0, Math.max(0, Object.keys(log).length - 60))) delete log[k];
    await memory.set(SLEEP_LOG_KEY, log);
    // Lo anotado manda: el resumen de salud de hoy y el del día usan esta cifra
    if (day === localDay()) {
      try {
        const snap = await memory.get("health_snapshot_latest");
        // Lo anotado reemplaza las partes del reloj (episodes): si no, el análisis mezclaría su total con los tramos del reloj
        if (snap) await memory.set("health_snapshot_latest", { ...snap, sleep: { ...(snap.sleep ?? {}), durationHours: total, manual: true, episodes: undefined,
          nightHours: parts ? parts[0] : total, split: !!parts && parts[1] >= 1.5, ...(reloj != null ? { reloj } : {}) } });
      } catch {}
    }
    await memory.upsertDailyRollup({ sleepHours: total, sleepNightHours: parts ? parts[0] : total }, day).catch(() => {});
    try { context?.wsClient?.send?.(JSON.stringify({ type: "sleep_logged", day, hours: total })); } catch {}

    const when = day === localDay() ? "de anoche" : "de anteanoche";
    let reply: string;
    if (input.base) reply = `😴 Anoté ${fmtH(total)} de sueño ${when}: ${fmtH(input.base)} + ${fmtH(hours)} más.`;
    else if (sumar && antes != null) reply = `😴 Sumé ${fmtH(hours)}${tramo}: quedan ${fmtH(total)} de sueño ${when} (${fmtH(antes)} ${manual != null ? "que ya estaban anotadas" : "de tu reloj"} + ${fmtH(hours)}).`;
    else if (reloj != null && Math.abs(reloj - total) > 0.25) reply = `😴 Anoté ${fmtH(total)} de sueño ${when}${tramo}; tu reloj marcaba ${fmtH(reloj)}, uso lo que me dices.`;
    else reply = `😴 Anoté ${fmtH(total)} de sueño ${when}${tramo}. Lo uso en tu análisis, en Métricas y en tu puntaje.`;
    const veredicto = veredictoSueno(total);
    return { output: reply, metadata: { quickReply: reply, ...(veredicto ? { veredicto } : {}) } };
  }

  /** «Dormí de 17:30 a 23:50»: el tramo al día que le toca, al teléfono (queda igual que anotarlo en Sueño) y, si fue a hora rara, la pregunta. */
  private async logTramo(desde: number, hasta: number, memory: any, log: Record<string, SleepEntry>, context?: any): Promise<ToolExecutionResult> {
    const min = (hasta - desde) / 60_000;
    if (!(min >= 15 && min <= 16 * 60)) return { output: "", error: "Ese tramo no calza: tiene que ser entre 15 min y 16 h." };
    const dia = sleepKey(hasta, min);
    const snap: any = await memory.get("health_snapshot_latest").catch(() => null);
    const tramos = unirTramos([...(log[dia]?.tramos ?? []), [desde, hasta]]);
    // Lo que ya está en el resumen de ese día (el reloj u otro tramo): se junta, no se pisa ni se cuenta dos veces
    const delResumen: Array<[number, number]> = snap?.sleep?.day === dia && Array.isArray(snap?.sleep?.episodes)
      ? snap.sleep.episodes.map((e: any) => [Date.parse(e.start), Date.parse(e.end)] as [number, number]).filter((x: [number, number]) => x[1] > x[0]) : [];
    const todo = unirTramos([...tramos, ...delResumen]);
    const total = Math.round(todo.reduce((a, x) => a + horasDe(x), 0) * 100) / 100;
    const noche = Math.round(Math.max(...todo.map(horasDe)) * 100) / 100;
    log[dia] = { hours: total, source: "manual", at: new Date().toISOString(), tramos };
    for (const k of Object.keys(log).sort().slice(0, Math.max(0, Object.keys(log).length - 60))) delete log[k];
    await memory.set(SLEEP_LOG_KEY, log);
    await memory.upsertDailyRollup({ sleepHours: total, sleepNightHours: noche }, dia).catch(() => {});
    try { context?.wsClient?.send?.(JSON.stringify({ type: "sleep_tramo", start: desde, end: hasta })); } catch {}
    const now = Date.now();
    const usual = { usualWake: typeof snap?.schedule?.usualWake === "number" ? snap.schedule.usualWake : null, usualSleepH: typeof snap?.schedule?.sleepHours === "number" ? snap.schedule.sleepHours : null };
    let reply = `😴 Anoté: ${sleepRangeText(desde, hasta, now)}.`;
    const raro = min >= 180 && wakeIsOdd(hasta, usual);
    if (raro && now - hasta < WAKE_WAIT_H * 3_600_000) {
      const fin = new Date(hasta).toISOString();
      await memory.set(PENDING_KEY, { kind: "seguir", fin, at: new Date().toISOString() }).catch(() => {});
      reply += `\n\n${wakeQuestionText(fin)}\n[Opción: Vuelvo a dormir] [Opción: Parto mi día ahora]`;
    }
    const veredicto = raro ? null : veredictoSueno(total);
    return { output: reply, metadata: { quickReply: reply, ...(veredicto ? { veredicto } : {}) } };
  }

  /**
   * «¿Cómo dormí?» / «¿Cómo vengo con el sueño?» / «¿A qué hora me acuesto?»: por código, con lo del reloj (las partes de la
   * noche y las 2 semanas que calcula el teléfono, sleepCore) o lo anotado. Sin datos, lo dice; no inventa.
   */
  private async report(input: Input, memory: any, log: Record<string, SleepEntry>): Promise<ToolExecutionResult> {
    let ver: string | undefined; // el veredicto de la noche (tono «brígida»: services/Brigida.ts)
    const done = (t: string) => ({ output: t, metadata: { quickReply: t, ...(ver ? { veredicto: ver } : {}) } });
    const snap: any = await memory.get("health_snapshot_latest").catch(() => null);
    const fresh = snap?.lastUpdated && Date.now() - Date.parse(snap.lastUpdated) < 20 * 3600_000;
    const ins = fresh ? insightsOf(snap) : null;
    if (input.action === "why") return done(patternsText(fresh ? snap?.sleepPatterns : null, ins));
    if (input.action === "bedtime") {
      if (ins) return done(`😴 ${bedtimeText(ins)}`);
      const wake = typeof snap?.schedule?.usualWake === "number" ? snap.schedule.usualWake : 7.5;
      return done(`😴 Para dormir 7 h 30 y levantarte a las ${hhmmOf(wake)}, acuéstate ~${hhmmOf(wake - 7.5 + 24)}; cafeína, hasta las ${hhmmOf(wake - 7.5 - 6 + 24)}. Con tu reloj conectado lo ajusto a tu necesidad y a tus siestas.`);
    }
    const out: string[] = [];
    const manual = log[localDay()];
    if (!input.semana) ver = veredictoSueno(manual?.hours ?? (fresh && typeof snap?.sleep?.durationHours === "number" ? snap.sleep.durationHours : null));
    if (!input.semana) {
      if (manual?.tramos?.length) {
        const de = manual.tramos.map(([a, b]) => `de ${clock(new Date(a).toISOString())} a ${clock(new Date(b).toISOString())}`).join(" y ");
        out.push(`Anotaste ${fmtSleep(manual.hours)}: ${de}.`);
      } else if (manual) {
        out.push(manual.parts && manual.parts.length > 1
          ? `Anotaste ${fmtSleep(manual.hours)} en partes: ${manual.parts.map((h, i) => `${fmtSleep(h)}${i === 0 ? " de noche" : " aparte"}`).join(" y ")}.`
          : `Anotaste ${fmtSleep(manual.hours)} de sueño anoche.`);
      } else if (fresh && Array.isArray(snap?.sleep?.episodes) && snap.sleep.episodes.length) {
        const d = { episodes: snap.sleep.episodes, totalH: snap.sleep.durationHours, nightH: snap.sleep.nightHours ?? null, split: !!snap.sleep.split,
          night: snap.sleep.episodes.find((e: any) => e.kind === "noche") ?? null };
        out.push(sleepSummaryText(d));
        const r = sleepReading(d, ins?.need ?? snap?.schedule?.sleepHours);
        if (r) out.push(r);
        if (ins?.score) out.push(`Tu noche: **${ins.score.word}** (${ins.score.total}/100).`);
        const dur = snap.sleep.during;
        if (dur && (dur.hr || dur.spo2)) out.push(`Durmiendo: ${[dur.hr ? `pulso ${dur.hr} lpm` : "", dur.spo2 ? `oxígeno ${dur.spo2} %${dur.spo2Min && dur.spo2Min < dur.spo2 - 1 ? ` (mín. ${dur.spo2Min} %)` : ""}` : "", dur.resp ? `${String(dur.resp).replace(".", ",")} respiraciones por minuto` : ""].filter(Boolean).join(", ")}.`);
      } else if (fresh && typeof snap?.sleep?.durationHours === "number") {
        out.push(`Dormiste ${fmtSleep(snap.sleep.durationHours)} según tu reloj.`);
      } else {
        return done("Todavía no me llega tu sueño de anoche: abre la app con el reloj sincronizado, o cuéntame cuánto dormiste («dormí 7 horas»).");
      }
    }
    if (ins && ins.nights >= 4) out.push(insightsText(ins));
    else if (input.semana) out.push("Para ver tus 2 semanas necesito al menos 4 noches medidas por el reloj.");
    if (ins) out.push(bedtimeText(ins));
    // Una sola cosa, sin culpa: su meta de sueño si tiene una en curso (pantalla de Sueño · S3); si no, lo que más ayuda
    const plan = fresh && snap?.sleepPlan?.title && !snap.sleepPlan.done ? snap.sleepPlan : null;
    if (plan) out.push(`Tu meta de estas 2 semanas: **${plan.title}** — ${plan.text}`);
    else if (ins && ins.trendMinPerDay != null && ins.trendMinPerDay >= 20) out.push("Lo que más te ayuda ahora: levántate a la misma hora estos días y busca luz de mañana temprano; eso trae de vuelta el horario más rápido que acostarse antes a la fuerza.");
    else if (ins && ins.debtH >= 3) out.push("Lo que más te ayuda ahora: suma 30–60 min por noche esta semana; dormir mucho un solo día no paga la deuda.");
    return done(out.join("\n"));
  }
}
