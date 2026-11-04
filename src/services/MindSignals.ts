// ============================================================
// Eris — señales de mente (⚡ Modo Rendimiento · R2, 2026-10-29)
//
// Las primeras piezas del futuro módulo mental, sin el módulo:
//   - lo que contó en los check-ins del día exigente (estrés y foco del 1 al 5, qué pedía el día);
//   - su pulso en reposo contra SU promedio de 4 semanas: una señal de estrés, cansancio o algo que empieza, nunca un
//     diagnóstico (+5 lpm o más es «alto»: la referencia de los estudios de pulso en reposo y recuperación);
//   - lo que se repite después de sus días exigentes: cómo durmió esa noche y su ánimo al otro día (bloc de notas).
// Aritmética pura, sin el modelo: el modelo solo redacta con lo que sale de acá. Nada se muestra como puntaje de estrés
// (medir sin obsesión): en palabras, y los números del cuerpo solo como dato.
// ============================================================

import type { DailyRollupEntry } from "../memory.js";

/** Un check-in del día exigente, con lo del cuerpo de ese día (para el futuro módulo mental) */
export interface MindCheckin {
  at: string; day: string; estres?: number; foco?: number; tipo?: string;
  /** pulso en reposo de ese día y su promedio de 4 semanas (lpm) */
  restingHR?: number; rhrBase?: number;
  /** lo que durmió la noche anterior (h) */
  sleepH?: number;
}
export interface PulseSignal { hoy: number; base: number; delta: number; dias: number; alto: boolean }
export interface AfterPattern {
  /** días exigentes con dato de la noche siguiente */
  n: number;
  sueno: number | null; suenoBase: number | null;
  /** ánimo del día siguiente (1–5, del bloc de notas) */
  animo: number | null; animoBase: number | null; nAnimo: number;
}
export interface MindSignals {
  /** el check-in de hoy (el último) */
  hoy: MindCheckin | null;
  pulso: PulseSignal | null;
  /** días exigentes en los últimos 7 (con hoy) */
  exigentes7: number;
  /** check-ins de los últimos 7 días: cuántos, con estrés alto (≥ 4) y con foco bajo (≤ 2) */
  semana: { n: number; estresAlto: number; focoBajo: number };
  /** lo que pasa después de sus días exigentes (desde 3 con dato) */
  despues: AfterPattern | null;
  /** días exigentes en total (los últimos 60 del registro) */
  exigentesTotal: number;
}

export const PULSO_ALTO_LPM = 5;
const BASE_DAYS = 28, BASE_MIN = 7, PATTERN_MIN = 3;

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const okHR = (x: unknown): x is number => typeof x === "number" && x > 30 && x < 130;
const okNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** «2026-10-29» + n días */
export const addDaysIso = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

/** El pulso en reposo de hoy contra su mediana de las 4 semanas anteriores (sin 7 días con dato, no se sabe) */
export function pulseSignal(rollup: DailyRollupEntry[], todayKey: string, hoy?: number | null): PulseSignal | null {
  const desde = addDaysIso(todayKey, -BASE_DAYS);
  const prev = rollup.filter((r) => r.date < todayKey && r.date >= desde && okHR(r.restingHR)).map((r) => r.restingHR as number);
  const today = okHR(hoy) ? hoy : rollup.find((r) => r.date === todayKey)?.restingHR;
  if (prev.length < BASE_MIN || !okHR(today)) return null;
  const base = Math.round(median(prev));
  const delta = Math.round(today - base);
  return { hoy: Math.round(today), base, delta, dias: prev.length, alto: delta >= PULSO_ALTO_LPM };
}

/**
 * Después de cada día exigente: lo dormido esa noche (el registro del día siguiente) y el ánimo del día siguiente, contra lo
 * de siempre (la mediana de las 4 semanas sin esos días).
 */
export function afterPattern(log: Array<{ day: string; mode: string }>, rollup: DailyRollupEntry[], todayKey: string): AfterPattern | null {
  const by = new Map(rollup.map((r) => [r.date, r]));
  const dias = [...new Set(log.filter((x) => x?.mode === "rendimiento" && x.day < todayKey).map((x) => x.day))];
  const despues = new Set(dias.map((d) => addDaysIso(d, 1)).filter((d) => d <= todayKey));
  const sueno: number[] = [], animo: number[] = [];
  for (const d of despues) {
    const r = by.get(d);
    if (okNum(r?.sleepHours) && r!.sleepHours! > 1 && r!.sleepHours! < 16) sueno.push(r!.sleepHours!);
    if (okNum(r?.moodScore)) animo.push(r!.moodScore!);
  }
  if (sueno.length < PATTERN_MIN) return null;
  const desde = addDaysIso(todayKey, -BASE_DAYS);
  const resto = rollup.filter((r) => r.date >= desde && r.date <= todayKey && !despues.has(r.date));
  const sBase = resto.map((r) => r.sleepHours).filter((x): x is number => okNum(x) && x > 1 && x < 16);
  const aBase = resto.map((r) => r.moodScore).filter(okNum);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    n: sueno.length,
    sueno: r1(mean(sueno)), suenoBase: sBase.length >= BASE_MIN ? r1(median(sBase)) : null,
    animo: animo.length >= PATTERN_MIN ? r1(mean(animo)) : null, animoBase: animo.length >= PATTERN_MIN && aBase.length >= BASE_MIN ? r1(median(aBase)) : null, nAnimo: animo.length,
  };
}

export function mindSignals(i: {
  checkins: MindCheckin[]; log: Array<{ day: string; mode: string }>; rollup: DailyRollupEntry[]; todayKey: string; restingToday?: number | null;
}): MindSignals {
  const desde7 = addDaysIso(i.todayKey, -6);
  const sem = i.checkins.filter((c) => c?.day >= desde7 && c.day <= i.todayKey);
  // un check-in por día (el último): cambiar de opinión no cuenta dos veces
  const porDia = new Map<string, MindCheckin>();
  for (const c of sem) porDia.set(c.day, c);
  const ultimos = [...porDia.values()];
  const hoy = porDia.get(i.todayKey) ?? null;
  const exig = new Set(i.log.filter((x) => x?.mode === "rendimiento").map((x) => x.day));
  return {
    hoy,
    pulso: pulseSignal(i.rollup, i.todayKey, i.restingToday),
    exigentes7: [...exig].filter((d) => d >= desde7 && d <= i.todayKey).length,
    semana: { n: ultimos.length, estresAlto: ultimos.filter((c) => (c.estres ?? 0) >= 4).length, focoBajo: ultimos.filter((c) => c.foco != null && c.foco <= 2).length },
    despues: afterPattern(i.log, i.rollup, i.todayKey),
    exigentesTotal: exig.size,
  };
}

// ─── En palabras ──────────────────────────────────────────────────────────────
export const horasTxt = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
const estresTxt = (n?: number) => (n == null ? "" : n >= 4 ? "estrés alto" : n <= 2 ? "tranquilo" : "algo de estrés");
const focoTxt = (n?: number) => (n == null ? "" : n <= 2 ? "foco bajo" : n >= 4 ? "buen foco" : "foco a medias");
const TIPO_TXT: Record<string, string> = { detalle: "día de detalle", ideas: "día de ideas", todo: "de todo" };
export const checkinTxt = (c: MindCheckin | null | undefined) => (!c ? "" : [estresTxt(c.estres), focoTxt(c.foco), c.tipo ? TIPO_TXT[c.tipo] ?? "" : ""].filter(Boolean).join(" · "));

/** Lo que se repite después de los días exigentes, en una frase (null si no hay nada que decir) */
export function despuesTxt(p: AfterPattern | null): string | null {
  if (!p || p.sueno == null || p.suenoBase == null) return null;
  const dif = p.sueno - p.suenoBase;
  const sueno = dif >= 0.33 ? `dormiste más: ~${horasTxt(p.sueno)} (lo de siempre: ${horasTxt(p.suenoBase)})`
    : dif <= -0.33 ? `dormiste menos: ~${horasTxt(p.sueno)} (lo de siempre: ${horasTxt(p.suenoBase)})`
    : `dormiste lo de siempre (~${horasTxt(p.sueno)})`;
  const animo = p.animo != null && p.animoBase != null
    ? (p.animo <= p.animoBase - 0.5 ? " y al otro día tu ánimo bajó un poco" : p.animo >= p.animoBase + 0.5 ? " y al otro día tu ánimo subió" : " y tu ánimo al otro día fue el de siempre")
    : "";
  return `Después de tus días exigentes ${sueno}${animo}.`;
}

/** El pulso en una frase para la persona */
export function pulsoTxt(p: PulseSignal | null): string | null {
  if (!p) return null;
  if (p.alto) return `Tu pulso en reposo hoy viene más alto que tu promedio (${p.hoy} vs ${p.base}): puede ser estrés, cansancio o algo que empieza. No es un diagnóstico; si además te sientes decaído o con fiebre, toca descansar.`;
  if (p.delta <= -PULSO_ALTO_LPM) return `Tu pulso en reposo hoy está más bajo que tu promedio (${p.hoy} vs ${p.base}): el cuerpo viene descansado.`;
  return `Tu pulso en reposo está en tu promedio (${p.hoy} vs ${p.base}): el cuerpo no se ve acelerado.`;
}

/**
 * La línea para Eris en el contexto de hoy. Solo si usa el día exigente (check-ins o días exigentes recientes): el pulso
 * solo, sin eso, ya lo cubre la tarjeta del día (BaselineEngine).
 */
export function mindLine(s: MindSignals): string | null {
  if (!s.hoy && !s.semana.n && !s.exigentes7 && !s.despues) return null;
  const bits: string[] = [];
  if (s.hoy && checkinTxt(s.hoy)) bits.push(`hoy contó: ${checkinTxt(s.hoy)}`);
  if (s.semana.n >= 2) bits.push(`check-ins de 7 días: ${s.semana.n}${s.semana.estresAlto ? ` (estrés alto en ${s.semana.estresAlto})` : ""}`);
  if (s.exigentes7) bits.push(`días exigentes esta semana: ${s.exigentes7}`);
  if (s.pulso) bits.push(`pulso en reposo hoy ${s.pulso.hoy} lpm (su promedio de 4 semanas: ${s.pulso.base}; ${s.pulso.delta >= 0 ? "+" : ""}${s.pulso.delta})${s.pulso.alto ? ": señal de estrés, cansancio o algo que empieza" : ""}`);
  const d = despuesTxt(s.despues);
  if (d) bits.push(d.replace(/^Después de tus/, "después de sus").replace(/dormiste/, "durmió").replace(/tu ánimo/, "su ánimo").replace(/\.$/, ""));
  if (!bits.length) return null;
  return `- Mente (check-ins del día exigente y señales del cuerpo; NO es diagnóstico ni puntaje: no le pongas nota a su estrés ni lo alarmes): ${bits.join(" · ")}.`;
}

/** «¿Cómo vengo de estrés?»: lo que hay, en palabras, sin puntajes */
export function mindText(s: MindSignals): string {
  const out: string[] = [];
  if (!s.semana.n && !s.exigentesTotal) {
    out.push("Todavía no tengo check-ins tuyos. Cuando armes un día exigente (⚡ Rendimiento) y me cuentes tu estrés y tu foco, empiezo a ver cómo vienes.");
  } else {
    const head = [`🧠 Esta semana: ${s.exigentes7 === 1 ? "1 día exigente" : `${s.exigentes7} días exigentes`}`];
    if (s.semana.n) head.push(`${s.semana.n} check-in${s.semana.n === 1 ? "" : "s"}`);
    out.push(`${head.join(" y ")}.`);
    if (s.hoy && checkinTxt(s.hoy)) out.push(`Hoy me contaste: ${checkinTxt(s.hoy)}.`);
    if (s.semana.n >= 2) {
      const e = s.semana.estresAlto, f = s.semana.focoBajo;
      out.push(e ? `Viniste con estrés alto ${e === 1 ? "1 de esos días" : `${e} de esos ${s.semana.n} días`}${f ? ` y con el foco bajo ${f === 1 ? "1" : f}` : ""}.` : f ? `El estrés, en general tranquilo; el foco anduvo bajo ${f === 1 ? "1 día" : `${f} días`}.` : "En general viniste tranquilo y con foco.");
    }
    if (s.exigentes7 >= 3) out.push("Son varios días exigentes seguidos: el cuerpo pasa la cuenta. Mañana, Óptimo.");
  }
  const p = pulsoTxt(s.pulso);
  if (p) out.push(p);
  const d = despuesTxt(s.despues);
  if (d) out.push(d);
  else if (s.exigentesTotal > 0 && s.exigentesTotal < PATTERN_MIN) out.push(`Para ver qué se repite después de tus días exigentes necesito al menos ${PATTERN_MIN}; llevas ${s.exigentesTotal}.`);
  out.push("No es un puntaje ni un diagnóstico: son señales para cuidarte.");
  return out.join("\n");
}

/** Lo mismo, leyendo la memoria (check-ins, días exigentes, registro diario y el pulso de hoy del reloj) */
export async function gatherMindSignals(memory: any, todayKey: string, restingToday?: number | null): Promise<MindSignals> {
  const safe = async (k: string) => { try { return await memory.get(k); } catch { return null; } };
  const rollup: DailyRollupEntry[] = typeof memory?.getDailyRollupLog === "function"
    ? await memory.getDailyRollupLog(60).catch(() => []) : ((await safe("daily_rollup_log")) || []);
  return mindSignals({
    checkins: (await safe("mind_checkins")) || [], log: (await safe("day_plan_log")) || [], rollup: Array.isArray(rollup) ? rollup : [],
    todayKey, restingToday,
  });
}
