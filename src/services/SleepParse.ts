// ============================================================
// Eris — reconocer "dormí 7 horas" por código
//
// El sueño solo llegaba del reloj. El 2026-10-07 el reloj no lo midió (estaba cargando), el usuario lo contó por chat y
// el modelo lo guardó como nota PERMANENTE del perfil; al pedirle "solo para hoy" dijo que lo había cambiado sin hacer
// nada. Las frases claras se reconocen acá y se anotan para ese día con sleep_log, sin depender del modelo.
// ============================================================

import { resolveSaidTimes, type SaidTime } from "./SleepCore.js";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const WORD_NUM: Record<string, number> = {
  una: 1, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};
const NUM = `(\\d{1,2}(?:[.,]\\d{1,2})?|${Object.keys(WORD_NUM).join("|")})`;
const EXTRA = `(?:\\s*y\\s*(media|medio|\\d{1,2}\\s*(?:min|minutos)))?`;
// "7 horas", "7h", "6 horas y media", "siete horas y 30 minutos" · "6 y media"
const WITH_UNIT = new RegExp(`\\b${NUM}\\s*(?:h|hr|hrs|horas?)\\b${EXTRA}`);
const AND_HALF = new RegExp(`\\b${NUM}\\s*y\\s*(media|medio)\\b`);

export interface SleepStatement {
  hours: number; day: "hoy" | "ayer";
  /** «3 horas MÁS», «aparte», «una siesta»: se suman a lo que ya había esa noche */
  extra?: boolean;
  /** «anoche dormí 4 horas y después 3 más»: la primera cifra (la base) */
  base?: number;
  /** «de 8:15 a 11:15»: el tramo, para decirlo y para preguntar si es aparte */
  rango?: string;
}

// ─── Tramos: «desde las ocho y cuarto hasta las once y cuarto», «de 23:30 a 7», «entre las 11 y las 6 y media» ───
const HORA = `(\\d{1,2}(?::\\d{2})?|${Object.keys(WORD_NUM).join("|")})(?:\\s*y\\s*(cuarto|media|\\d{1,2})|\\s*menos\\s*(cuarto|\\d{1,2}))?(?:\\s*(am|pm|de la manana|de la noche|de la tarde|de la madrugada))?`;
const TRAMO = new RegExp(`\\b(?:desde|de|entre)\\s+(?:las?\\s+)?${HORA}\\s+(?:hasta|a|y)\\s+(?:las?\\s+)?${HORA}\\b`);

/** "ocho" + "y cuarto" → minutos desde las 0 (en 12 h si no dice am/pm ni pasa de 12). */
function minutos(h: string, y?: string, menos?: string, sufijo?: string): number | null {
  let hh: number, mm = 0;
  if (/^\d/.test(h)) { const [a, b] = h.split(":"); hh = Number(a); mm = b ? Number(b) : 0; } else hh = WORD_NUM[h] ?? NaN;
  if (!Number.isFinite(hh) || hh > 24 || mm > 59) return null;
  if (y) mm += y === "cuarto" ? 15 : y === "media" ? 30 : Number(y);
  if (menos) { mm -= menos === "cuarto" ? 15 : Number(menos); }
  if (sufijo && /pm|noche|tarde/.test(sufijo) && hh < 12) hh += 12;
  if (sufijo && /am|manana|madrugada/.test(sufijo) && hh === 12) hh = 0;
  return hh * 60 + mm;
}
const hhmm = (m: number) => `${Math.floor(((m % 1440) + 1440) % 1440 / 60)}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;

/** Duración de un tramo «de X a Y» (cruza la medianoche si hace falta). */
export function tramoEn(t: string): { hours: number; rango: string } | null {
  const m = t.match(TRAMO);
  if (!m) return null;
  const a = minutos(m[1], m[2], m[3], m[4]), b = minutos(m[5], m[6], m[7], m[8]);
  if (a == null || b == null) return null;
  let d = b - a;
  // sin am/pm: «de 11 a 7» son 8 h (cruza al otro lado del reloj de 12 h); con 24 h, cruza la medianoche
  if (d <= 0) d += a < 13 * 60 && b < 13 * 60 && !m[4] && !m[8] ? 12 * 60 : 24 * 60;
  const hours = Math.round((d / 60) * 100) / 100;
  return hours >= 0.25 && hours <= 16 ? { hours, rango: `${hhmm(a)} a ${hhmm(b)}` } : null;
}

// ─── Las horas dichas, para deducir el tramo (2026-11-07) ─────────────────────────────────────────────────────────────
// «me dormí a las 5:30pm y desperté a las 23:50» no se reconocía, y «me dormí a las 5 y media» se anotaba como 5,5 horas de sueño.
const ALA = `(?:a\\s+las?|a\\s+eso\\s+de\\s+las?|tipo|como\\s+a\\s+las?|como\\s+las?|cerca\\s+de\\s+las?)\\s+`;
const HORA_DICHA = new RegExp(`${ALA}${HORA}`, "g");
const DORMIRSE = new RegExp(`\\b(?:me\\s+(?:habia\\s+)?dormi(?:do)?|me\\s+quede\\s+dormid[oa]|me\\s+acoste|me\\s+fui\\s+a\\s+(?:dormir|acostar)|dormi)\\s+(?:recien\\s+)?${ALA}${HORA}`);
const DESPERTAR = new RegExp(`\\b(?:desperte|me\\s+desperte|me\\s+levante|abri\\s+los\\s+ojos)\\s+${ALA}${HORA}`);
const RECIEN = /\b(?:recien\s+(?:desperte|me\s+desperte|me\s+levante)|(?:desperte|me\s+desperte|me\s+levante)\s+(?:recien|ahora|hace\s+poco)|acabo\s+de\s+(?:despertar|levantarme))\b/;
// (2026-11-17: «volví a dormir de 6:30 a 7:30» no se entendía)
const TRAMO_DICHO = /\b(dormi|he dormido|dormimos|alcance a dormir|pude dormir|me dormi|me quede dormid[oa]|siesta|(me )?volvi a (dormir|quedar(me)? dormid[oa]|acostar(me)?)|segui durmiendo)\b/;
const SOLO_HORA = new RegExp(`^(?:${ALA})?${HORA}$`);

/** "ocho" + "y cuarto" + ... → la hora dicha; `amb` si no dijo am ni pm y puede ser de día o de noche. */
function dicha(h: string, y?: string, menos?: string, sufijo?: string): SaidTime | null {
  const min = minutos(h, y, menos, sufijo);
  if (min == null) return null;
  const hh = /^\d/.test(h) ? Number(h.split(":")[0]) : WORD_NUM[h];
  return { min: ((min % 1440) + 1440) % 1440, amb: !sufijo && hh >= 1 && hh <= 12 };
}

export interface SaidSleep { a: SaidTime; b: SaidTime | "ahora"; atras: boolean }

/** «me dormí a las X y desperté a las Y», «de X a Y», «desperté recién, me dormí a las X». null si no trae las dos. */
export function parseSleepTimes(message: unknown): SaidSleep | null {
  if (typeof message !== "string" || message.length > 400 || /[¿?]/.test(message)) return null;
  const t = fold(message);
  if (/\bno (dormi|he dormido|pude dormir)\b/.test(t)) return null;
  // «anteanoche», o «ayer» cuando el tramo sería de hoy: se resuelve en resolveSleepSaid
  const atras = /\b(anteanoche|antenoche|ante anoche|ayer)\b/.test(t);
  const on = t.match(DORMIRSE);
  if (on) {
    const a = dicha(on[1], on[2], on[3], on[4]);
    const wk = t.match(DESPERTAR);
    if (a && wk) { const b = dicha(wk[1], wk[2], wk[3], wk[4]); if (b) return { a, b, atras }; }
    if (a && RECIEN.test(t)) return { a, b: "ahora", atras: false };
  }
  const pide = /\b(anot\w*|ingres\w*|registr\w*|guard\w*)\b/.test(t) && /\bsueno\b/.test(t);
  if (TRAMO_DICHO.test(t) || pide) {
    const m = t.match(TRAMO);
    if (m) { const a = dicha(m[1], m[2], m[3], m[4]), b = dicha(m[5], m[6], m[7], m[8]); if (a && b) return { a, b, atras }; }
  }
  return null;
}

/** El tramo de lo dicho, a esta hora. «ayer» solo corre el día si si no el tramo caería hoy; «anteanoche», siempre. */
export function resolveSleepSaid(d: SaidSleep, now: number, message = ""): { start: number; end: number } | null {
  const r = resolveSaidTimes(d.a, d.b, now);
  if (!r || !d.atras) return r;
  const t = fold(message);
  const dia = (ms: number) => new Date(ms).toDateString();
  const anteanoche = /\b(anteanoche|antenoche|ante anoche)\b/.test(t);
  if (!anteanoche && dia(r.end) !== dia(now)) return r;
  const menos = (ms: number) => { const x = new Date(ms); x.setDate(x.getDate() - 1); return x.getTime(); };
  return { start: menos(r.start), end: menos(r.end) };
}

/** «me dormí a las 5 y media» sin decir cuándo despertó: se le pregunta. Solo un mensaje corto que dice eso. */
export function parseSleepOnset(message: unknown): SaidTime | null {
  if (typeof message !== "string" || message.length > 60 || /[¿?]/.test(message)) return null;
  const on = fold(message).match(DORMIRSE);
  return on ? dicha(on[1], on[2], on[3], on[4]) : null;
}

/** La respuesta a «¿A qué hora despertaste?»: «a las 11:50», «recién», «ahora». */
export function parseWakeAnswer(message: unknown): SaidTime | "ahora" | null {
  if (typeof message !== "string" || message.length > 40) return null;
  const t = fold(message).replace(/[.,!¡¿?]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(recien|ahora|recien nomas|ahora recien|hace poco|recien desperte)$/.test(t)) return "ahora";
  const m = t.replace(/^(?:desperte|me desperte|me levante)\s+/, "").match(SOLO_HORA);
  return m ? dicha(m[1], m[2], m[3], m[4]) : null;
}

/** Horas dentro de un texto ya normalizado. */
export function hoursIn(t: string): number | null {
  const m = t.match(WITH_UNIT) ?? t.match(AND_HALF);
  if (!m) return null;
  const base = WORD_NUM[m[1]] ?? parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(base)) return null;
  const extra = !m[2] ? 0 : /^medi[ao]$/.test(m[2]) ? 0.5 : Math.min(59, parseInt(m[2], 10)) / 60;
  const h = Math.round((base + extra) * 100) / 100;
  return h >= 1 && h <= 16 ? h : null;
}

/**
 * "dormí aprox 7 horas", "anoche dormí 6 y media", "hoy dormí 5h", "ingresa esas 7 horas de sueño", "déjalo para hoy: 7 horas
 * de sueño". No: preguntas sobre cuánto dormir, hábitos ("duermo 7 horas"), planes ("voy a dormir 8 horas"), "no dormí".
 */
export function parseSleepStatement(message: unknown): SleepStatement | null {
  if (typeof message !== "string" || message.length > 400) return null;
  // «a las 5 y media» es una hora del reloj, no 5,5 horas dormidas
  const t = fold(message).replace(HORA_DICHA, " ");
  const slept = /\b(dormi|he dormido|habre dormido|dormimos|alcance a dormir|pude dormir)\b/.test(t);
  const request = /\b(anot\w*|ingres\w*|registr\w*|guard\w*|pon\w*|deja\w*|cuenta\w*|toma\w*)\b/.test(t) && /\bsueno\b/.test(t);
  if (!slept && !request) return null;
  if (/\bno (dormi|he dormido|pude dormir)\b/.test(t) && !/\bno (dormi|he dormido|pude dormir) (mas|ni) /.test(t)) return null;
  const day = /\b(anteanoche|antenoche|ante anoche)\b/.test(t) ? "ayer" : "hoy";
  // «3 horas más», «otras 2 horas», «una siesta», «aparte» (no «más o menos 7 horas» ni «más de 7 horas»)
  const extra = /\b(horas?|h|hrs)\s+mas\b(?!\s+o\s+menos)|\b(adicional\w*|extra|aparte|siesta|ademas)\b|\botras?\s+(\d|una|dos|tres|cuatro|cinco|seis)|\b(\d{1,2}|una|dos|tres|cuatro|cinco|seis)\s+mas\b(?!\s+(o\s+menos|de)\b)/.test(t) || undefined;
  // «de 8:15 a 11:15»: la duración sale del tramo (antes la sacaba el modelo y se equivocaba: 4,25 h por 3 h)
  const tr = tramoEn(t);
  if (tr) return { hours: tr.hours, day, rango: tr.rango, ...(extra ? { extra } : {}) };
  // «anoche dormí 4 horas y después dormí 3 horas más»: base + lo de más
  const todas = [...t.matchAll(new RegExp(WITH_UNIT.source, "g"))].map((m) => hoursIn(m[0])).filter((h): h is number => h != null);
  if (todas.length >= 2 && extra) return { hours: todas[todas.length - 1], base: todas[0], day, extra: true };
  // Sueño 2.0 · S4: «dormí 4 horas y en la tarde una siesta de 2» / «… y después 3 más»: la segunda cifra sin «horas»
  if (todas.length === 1 && extra) {
    const first = t.match(WITH_UNIT)!;
    const rest = t.slice((first.index ?? 0) + first[0].length);
    // «una siesta de 20 minutos»
    const mMin = rest.match(new RegExp(`\\bsiesta\\s+(?:de\\s+)?(?:como\\s+|unos\\s+)?${NUM}\\s*(?:min|minutos)\\b`));
    const nMin = mMin ? WORD_NUM[mMin[1]] ?? parseFloat(mMin[1].replace(",", ".")) : NaN;
    if (nMin >= 5 && nMin <= 180) return { hours: Math.round((nMin / 60) * 100) / 100, base: todas[0], day, extra: true };
    const m2 = rest.match(new RegExp(`\\bsiesta\\s+(?:de\\s+)?(?:como\\s+|unas?\\s+)?${NUM}\\b(?!\\s*(?::|am\\b|pm\\b|de la))`))
      ?? rest.match(new RegExp(`\\b${NUM}\\s*(?:horas?\\s*)?mas\\b`));
    const second = m2 ? hoursIn(`${m2[1]} horas${/y medi[ao]/.test(m2[0]) ? " y media" : ""}`) ?? (WORD_NUM[m2[1]] === 1 || m2[1] === "1" ? 1 : null) : null;
    if (second != null) return { hours: second, base: todas[0], day, extra: true };
  }
  const hours = hoursIn(t);
  if (hours === null) return null;
  return { hours, day, ...(extra ? { extra } : {}) };
}
