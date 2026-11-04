// ============================================================
// Eris — el entreno de hoy («¿entrenas hoy?», Forge 2.0 F3, 2026-10-17)
//
// El usuario: «calcular en base a la rutina del día las calorías fantasma o calorías que gastaría y en lo que afectaría a
// las métricas, porque si no está complicado saber si se pasa de las calorías». Decisiones: metas «según el día» solo si
// respondió; se pregunta a quien entrena; el fantasma entra en «te quedan X».
//
//   - Guardado por día (`training_intent`, los últimos 14 días): lo que respondió en la app, en un aviso o por chat.
//   - Por chat, por código (parseTrainingStatement): «hoy entreno pierna a las 7», «hoy descanso», «al final no entreno»,
//     «voy a jugar básquet 2 horas a las 8».
//   - Lo que va a gastar: la rutina (lo que calcula el teléfono con el plan del día y tus últimas cargas, que manda en
//     `forge_projection`) o una actividad con su MET (forgeTrain.activityProjection). La regla está en forge/forgeTrain.ts,
//     copia exacta de la app.
// ============================================================

import { ACTIVITY_TYPES, activityProjection, sanitizeIntent, type TrainingIntent } from "./forge/forgeTrain.js";
import { localDay } from "./DailyTargets.js";

export const INTENT_KEY = "training_intent";
export const PROJECTION_KEY = "forge_projection";
const KEEP = 14;

interface Mem { get(k: string): Promise<any>; set(k: string, v: any): Promise<void> }

/** Lo que el teléfono calcula con Forge: el plan de hoy y tu sesión típica (kcal netas y minutos). */
export interface ForgeProjection {
  day: string; plan?: { kcal: number; minutes: number; sets: number } | null; typical?: { kcal: number; minutes: number } | null; routineName?: string | null; at: string;
  /** para armar y ajustar la rutina por chat (forge/forgeRoutine.ts): «Mi gimnasio», tus máximos, experiencia y la rutina */
  gym?: any; e1rm?: Record<string, number>; experience?: "principiante" | "intermedio"; routine?: any;
  /** tu progreso (forge/forgeProgress.progressContext): score de fuerza, el mes, récords, «tú hace 3 meses» */
  progress?: any;
  /** lo que toca hoy (forge/forgeRoutine.routineToday): el día, cada ejercicio con su objetivo y el orden desde el que toca */
  today?: { day: string; rest: boolean; dayId: string | null; name: string | null; doneSets: number; items: Array<{ name: string; text: string }>; order: string[] } | null;
}

export async function getIntents(memory: Mem): Promise<Record<string, TrainingIntent>> {
  const v = await memory.get(INTENT_KEY).catch(() => null);
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
export async function intentFor(memory: Mem, day = localDay()): Promise<TrainingIntent | null> {
  return (await getIntents(memory))[day] ?? null;
}

/** Guarda (o borra con null) lo de un día. */
export async function saveIntent(memory: Mem, day: string, intent: TrainingIntent | null): Promise<void> {
  const all = await getIntents(memory);
  if (intent) all[day] = intent; else delete all[day];
  const keep = Object.keys(all).sort().slice(-KEEP);
  await memory.set(INTENT_KEY, Object.fromEntries(keep.map((k) => [k, all[k]])));
}

export async function getProjection(memory: Mem): Promise<ForgeProjection | null> {
  const p = await memory.get(PROJECTION_KEY).catch(() => null);
  return p && typeof p === "object" ? (p as ForgeProjection) : null;
}

export function sanitizeProjection(raw: unknown): ForgeProjection | null {
  const r = raw as any;
  if (!r || typeof r !== "object") return null;
  const n = (v: unknown, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= hi ? Math.round(v) : 0);
  const block = (b: any, withSets: boolean) => (b && typeof b === "object" ? { kcal: n(b.kcal, 3000), minutes: n(b.minutes, 600), ...(withSets ? { sets: n(b.sets, 200) } : {}) } : null);
  return {
    day: typeof r.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? r.day : localDay(),
    plan: block(r.plan, true) as any, typical: block(r.typical, false) as any,
    routineName: typeof r.routineName === "string" ? r.routineName.slice(0, 60) : null, at: new Date().toISOString(),
    ...(r.gym && typeof r.gym === "object" && JSON.stringify(r.gym).length < 8000 ? { gym: r.gym } : {}),
    ...(r.e1rm && typeof r.e1rm === "object" ? { e1rm: Object.fromEntries(Object.entries(r.e1rm).filter(([k, v]) => /^[\w-]{1,40}$/.test(k) && typeof v === "number" && v > 0 && v < 1000).slice(0, 200)) as Record<string, number> } : {}),
    ...(r.experience === "intermedio" || r.experience === "principiante" ? { experience: r.experience } : {}),
    ...(r.routine && typeof r.routine === "object" && JSON.stringify(r.routine).length < 30000 ? { routine: r.routine } : {}),
    ...(r.progress && typeof r.progress === "object" && JSON.stringify(r.progress).length < 12000 ? { progress: r.progress } : {}),
    ...(r.today && typeof r.today === "object" && typeof r.today.day === "string" && JSON.stringify(r.today).length < 6000 ? { today: r.today } : {}),
  };
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface TrainingStatement { answer: "si" | "no"; kind?: "rutina" | "otra"; label?: string; activity?: string; minutes?: number; time?: string; cancel?: boolean }

const REST = /\b(hoy (no )?(descanso|descansare|toca descanso|es dia de descanso)|descanso hoy|hoy no (entreno|voy a entrenar|entrenare|voy al (gym|gimnasio)|hago ejercicio)|al final no (entreno|entrene|fui|voy|alcance|alcanzo)|no (alcanzo|alcance) a entrenar|me salto el (gym|gimnasio|entreno)|hoy me lo salto)\b/;
const TRAIN = /\b(hoy (entreno|entrenare|voy a entrenar|voy al (gym|gimnasio)|toca|hago|juego|salgo a)|voy al (gym|gimnasio)|voy a (entrenar|ir al (gym|gimnasio)|jugar|correr|trotar|nadar|pedalear|hacer)|entreno (hoy|a las|en la|en el)|toca (pierna|pecho|espalda|brazos?|hombros?|empuje|tiron|torso|full|cuerpo|dia [a-f]))\b/;
/** Verbos que ya son entrenar («hoy entreno», «voy al gym», «voy a correr»); «voy a hacer…» o «hoy toca…» necesitan el qué */
const TRAIN_SOLO = /\b(hoy (entreno|entrenare|voy a entrenar|voy al (gym|gimnasio))|voy al (gym|gimnasio)|voy a (entrenar|ir al (gym|gimnasio)|correr|trotar|nadar|pedalear)|entreno (hoy|a las|en la|en el))\b/;
const EXERCISE_WORD = /\b(gym|gimnasio|pesas|rutina|forge|ejercicio|deporte|cardio|entreno|entrenamiento|calistenia|funcional|movilidad|elongacion|estiramiento|abdominales|sentadillas|flexiones|dominadas|piernas?)\b/;
// Solo frases que SOLO dicen si entrena: una pregunta o un pedido más («dame ideas para comer antes») va al modelo
const QUESTION = /^[¿\s]*(que|cual|cuando|como|deberia|me conviene|puedo|es bueno)\b|[?¿]|\b(dame|ideas?|recomiend\w*|sugier\w*|que (como|puedo|me)|ayuda\w*|como (hago|preparo)|cuant\w+|arma\w*|crea\w*|plan)\b/;
const LABELS: Array<[RegExp, string]> = [
  [/\bpierna(s)?\b|tren inferior|\bgluteos?\b/, "Pierna"], [/\bpecho\b/, "Pecho"], [/\bespalda\b/, "Espalda"], [/\bbrazos?\b/, "Brazos"],
  [/\bhombros?\b/, "Hombros"], [/\bempuje\b|\bpush\b/, "Empuje"], [/\btiron\b|\bpull\b/, "Tirón"], [/\btorso\b|tren superior/, "Torso"],
  [/full ?body|cuerpo completo/, "Cuerpo completo"], [/\bcore\b|\babdomen\b|\babs\b/, "Core"],
];

function timeIn(t: string, now: Date): string | undefined {
  const m = t.match(/\ba las (\d{1,2})(?:(?::|\.|\s?y\s?)(\d{2}|media|cuarto))?\s*(am|pm|hrs?|de la (manana|tarde|noche))?/);
  if (!m) {
    if (/\ben la manana\b/.test(t)) return "08:00";
    if (/\b(en la tarde|despues del trabajo|despues de la pega)\b/.test(t)) return "18:30";
    if (/\ben la noche\b/.test(t)) return "20:00";
    return undefined;
  }
  let h = Number(m[1]);
  const min = m[2] === "media" ? 30 : m[2] === "cuarto" ? 15 : m[2] ? Number(m[2]) : 0;
  const tag = m[3] || "";
  if (h > 23 || min > 59) return undefined;
  if (h <= 12) {
    if (/pm|tarde|noche/.test(tag) && h < 12) h += 12;
    else if (!/am|manana/.test(tag) && h < 12 && (h <= 6 || now.getHours() >= h)) h += 12; // «a las 7» a media tarde = 19:00
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function minutesIn(t: string): number | undefined {
  const hm = t.match(/\b(\d+(?:[.,]\d+)?|una|un|dos|tres)\s*(horas?|hrs?)\b(?:\s*y\s*(media|cuarto|\d+\s*min\w*))?/);
  const words: Record<string, number> = { una: 1, un: 1, dos: 2, tres: 3 };
  if (hm) {
    const h = words[hm[1]] ?? Number(hm[1].replace(",", "."));
    const extra = hm[3] === "media" ? 30 : hm[3] === "cuarto" ? 15 : hm[3] ? parseInt(hm[3], 10) : 0;
    return Math.round(h * 60 + extra);
  }
  if (/\b(hora y media)\b/.test(t)) return 90;
  const mm = t.match(/\b(\d{2,3})\s*min\w*\b/);
  return mm ? Number(mm[1]) : undefined;
}

/** «hoy entreno pierna a las 7», «hoy descanso», «al final no entreno», «voy a jugar básquet 2 horas». null si no es eso. */
export function parseTrainingStatement(message: string, now = new Date()): TrainingStatement | null {
  const t = fold(String(message || "")).replace(/\s+/g, " ").trim();
  if (!t || t.length > 160) return null;
  if (REST.test(t)) return { answer: "no", cancel: /\bal final\b|no (alcanzo|alcance)|me salto|me lo salto/.test(t) };
  if (!TRAIN.test(t) || QUESTION.test(t)) return null;
  const act = ACTIVITY_TYPES.find((a) => a.words.some((w) => new RegExp(`\\b${w}\\b`).test(t)));
  // «Voy a hacer la cena», «hoy toca lavar ropa», «voy a jugar play» (revisión 2026-11-04, C2): el verbo suelto no es entrenar.
  // Con «hacer», «jugar», «toca», «hago» o «salgo a», tiene que decir QUÉ (un deporte, un grupo muscular, el gym o la rutina)
  if (!TRAIN_SOLO.test(t) && !act && !LABELS.some(([re]) => re.test(t)) && !/\bdia [a-f]\b/.test(t) && !EXERCISE_WORD.test(t)) return null;
  const time = timeIn(t, now);
  const minutes = minutesIn(t);
  if (act && !/\b(gym|gimnasio|pesas|rutina|forge)\b/.test(t)) return { answer: "si", kind: "otra", activity: act.id, label: act.name, ...(minutes ? { minutes } : {}), ...(time ? { time } : {}) };
  const dia = t.match(/\bdia ([a-f])\b/);
  const label = dia ? `Día ${dia[1].toUpperCase()}` : LABELS.find(([re]) => re.test(t))?.[1];
  return { answer: "si", kind: "rutina", ...(label ? { label } : {}), ...(minutes ? { minutes } : {}), ...(time ? { time } : {}) };
}

/** Arma lo que se guarda: con lo que va a gastar según la rutina del teléfono o la actividad. */
export function buildIntent(st: TrainingStatement, proj: ForgeProjection | null, weightKg: number | null | undefined, today: string, source: TrainingIntent["source"]): TrainingIntent {
  const base: any = { day: today, answer: st.answer, source, at: new Date().toISOString() };
  if (st.answer === "no") return sanitizeIntent(base, today)!;
  if (st.kind === "otra" && st.activity) {
    const minutes = st.minutes ?? 60;
    const p = activityProjection(st.activity, minutes, weightKg);
    return sanitizeIntent({ ...base, kind: "otra", activity: st.activity, label: st.label, minutes, time: st.time, kcal: p.kcal, waterMl: p.waterMl }, today)!;
  }
  // La rutina: el plan de hoy (si está cargado y es de hoy) o tu sesión típica; sin nada, una sesión moderada de 45 min
  const plan = proj?.plan && proj.day === today && proj.plan.sets > 0 ? proj.plan : null;
  const est = plan ?? proj?.typical ?? { kcal: Math.round(4 * 0.0175 * (weightKg || 70) * 45), minutes: 45 };
  const minutes = st.minutes ?? est.minutes;
  const kcal = st.minutes && est.minutes ? Math.round((est.kcal * st.minutes) / Math.max(1, est.minutes)) : est.kcal;
  return sanitizeIntent({ ...base, kind: "rutina", label: st.label, minutes, time: st.time, kcal, waterMl: Math.round(minutes * 10) }, today)!;
}
