// ============================================================
// Eris — metas del día (fuente única)
//
// Antes cada parte calculaba sus metas por su cuenta y para la misma persona se contradecían: Forge decía 2.850 kcal y
// 3,2 L; Nutrición e Inicio, 2.000 kcal y 2,5 L fijos; el asesor, 33 ml/kg; la proteína salía 1,2, 1,6 o 1,8 g/kg según
// quién preguntara; y con enfermedad renal el asesor no fijaba agua mientras Forge y la app mostraban 3,2 y 2,5 L.
// Ahora hay UN cálculo, con los datos de Forge (peso, altura, edad, sexo, actividad, entreno de hoy) y ajustado por
// las condiciones y medicamentos del perfil. Lo que el usuario fijó a mano siempre manda.
//
// Eris cuida, no trata: las condiciones solo moderan metas de bienestar (agua, proteína, sodio, azúcar) con criterios
// conservadores y documentados; nunca dosis ni indicaciones clínicas.
// ============================================================

import type { MedicalProfile } from "../memory.js";
import { byDaySpend, ghostKcal, intentPhrase, minutesToWorkout, type TrainingIntent } from "./forge/forgeTrain.js";
import { dailyLimits, medicationTypes } from "./DietaryRestrictions.js";
import { getNumericAdjustment } from "./MedicalKnowledgeBase.js";
import { dayCtxFrom, nutritionDayOf, isoDayKey } from "./MealSchedule.js";

/** Lo que el usuario cargó en Forge (CUERPO) + su entreno de hoy. Lo manda el teléfono (sync_body_profile). */
export interface BodyProfile {
  weightKg?: number;
  heightCm?: number;
  age?: number;
  sex?: "h" | "m";
  /** factor de actividad de Forge: 1,2 · 1,375 · 1,55 · 1,725 · 1,9, o el automático (continuo) */
  activity?: number;
  /** el nivel es el AUTOMÁTICO (según 4 semanas reales): manda el más fresco que traiga el teléfono (snapshot.activityLevel) */
  activityAuto?: boolean;
  /** día (YYYY-MM-DD local) al que corresponden trainingKcal / trainingSets */
  date?: string;
  trainingKcal?: number;
  trainingSets?: number;
  /** objetivo elegido en Forge (CUERPO → Tu objetivo) */
  goal?: BodyGoal;
  updatedAt?: string;
}

/**
 * Objetivos de Forge. Proteína por kilo con respaldo:
 * - Morton y cols., 2018 (metaanálisis, BJSM): con entrenamiento de fuerza, sobre ~1,6 g/kg ya casi no se gana más músculo
 *   (el intervalo llega a 2,2 g/kg, el margen para quien responde distinto);
 * - Posición de la ISSN, 2017: 1,4–2,0 g/kg para quien se ejercita, más alto en déficit para no perder músculo;
 * - Helms y cols., 2014: en déficit la proteína alta protege la masa magra.
 * Calorías: déficit o superávit MODERADOS (con tope en kcal), nunca bajo el basal.
 * Forge (toji.html, GOALS) muestra la misma tabla: si cambia acá, cambia allá.
 */
export type BodyGoal = "perder" | "recomp" | "mantener" | "ganar";
/**
 * Actividad de hoy que el teléfono detectó con el reloj, sin «modo entrenamiento» (eris-mobile/src/services/activityDetect.ts):
 * pulso + pasos + calorías activas. Pedido del usuario (2026-10-16): 2 horas de básquet no subían su meta del día.
 */
export interface ActivityToday {
  day: string;
  minutes: number;
  vigorousMin?: number;
  /** kcal activas (sobre el reposo) */
  kcal: number;
  bouts?: Array<{ start: string; end: string; minutes: number; intensity: string; kcal: number; guess?: string; label?: string; fromSession?: boolean }>;
}
const ACTIVITY_NAMES: Record<string, string> = {
  basquet: "básquet", futbol: "fútbol", gimnasio: "gimnasio", caminata: "caminata", trote: "trote", bici: "bici", otro: "actividad",
  deporte: "deporte", sin_pasos: "actividad", actividad: "actividad",
};
/** «básquet 2 h», «caminata 40 min»: la actividad principal del día. */
export function activityLabel(a: ActivityToday): string {
  const main = [...(a.bouts ?? [])].sort((x, y) => y.kcal - x.kcal)[0];
  const name = main ? ACTIVITY_NAMES[main.label ?? main.guess ?? "actividad"] ?? "actividad" : "actividad";
  const m = a.minutes;
  return `${name} ${m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`}`;
}
export const GOALS: Record<BodyGoal, { label: string; kcalPct: number; kcalCap: number; prot: [number, number]; protTarget: number; why: string }> = {
  perder: { label: "perder grasa", kcalPct: -0.15, kcalCap: 500, prot: [1.8, 2.2], protTarget: 2.2, why: "en déficit, la proteína alta protege el músculo" },
  recomp: { label: "recomposición", kcalPct: -0.05, kcalCap: 250, prot: [1.8, 2.2], protTarget: 2.0, why: "bajar grasa y subir músculo a la vez pide proteína alta" },
  mantener: { label: "mantener", kcalPct: 0, kcalCap: 0, prot: [1.6, 2.0], protTarget: 1.6, why: "1,6 g/kg ya cubre lo que el músculo aprovecha" },
  ganar: { label: "ganar músculo", kcalPct: 0.1, kcalCap: 350, prot: [1.6, 2.2], protTarget: 1.8, why: "sobre 1,6 g/kg casi no se gana más músculo; 1,8 deja margen" },
};
const isGoal = (v: unknown): v is BodyGoal => typeof v === "string" && v in GOALS;

export interface DailyTargets {
  kcal: number;
  /** «¿entrenas hoy?» respondido: metas según el día (descanso o entreno) */
  byDay?: "descanso" | "entreno";
  /** lo planificado que todavía no hiciste (kcal): el tramo «fantasma» de «te quedan X» */
  kcalGhost?: number;
  /** lo que se planificó gastar hoy (kcal) */
  kcalPlanned?: number;
  /** la meta de calorías SIN el fantasma: «sin el entreno te pasarías por…» */
  kcalNoGhost?: number;
  /** «tu pierna de las 19:00» */
  intentPhrase?: string;
  /** minutos para el entreno (negativo = ya pasó la hora) */
  minutesToWorkout?: number | null;
  kcalMaintenance?: number;
  kcalTraining?: number;
  /** ejercicio de un día típico que ya trae el mantenimiento (basal × (nivel − 1,2)) */
  kcalTypicalExercise?: number;
  /** lo que hoy suma a la meta: el ejercicio del día menos el de un día típico */
  kcalExtraToday?: number;
  proteinG: number;
  /** rango con respaldo (g/día) del que sale la meta; no hay con enfermedad renal (ahí es un tope) */
  proteinRange?: [number, number];
  /** con enfermedad renal la proteína es un TOPE, no una meta a alcanzar */
  proteinIsCap: boolean;
  goal?: BodyGoal;
  /** null = no se fija meta de agua (la define su médico) */
  waterL: number | null;
  sodiumMgLimit: number;
  sugarGLimit: number;
  fiberGGoal: number;
  fatGLimit: number;
  weightKg?: number;
  /** de dónde sale cada número, en palabras (para el chat, el asesor y Perfil) */
  sources: { kcal: string; protein: string; water: string };
  /** qué fijó el usuario a mano (Perfil o chat): eso manda sobre lo calculado */
  set: { calories?: number; protein?: number; waterLiters?: number };
  notes: string[];
}

export const DEFAULT_KCAL = 2000;
export const DEFAULT_WATER_L = 2.5;
export const FALLBACK_PROTEIN_G = 60;
const ACTIVITY_DEFAULT = 1.375; // "Ligero", lo mismo que asume Forge si no se eligió
/** Agua extra del nivel: 120 ml por cada escalón de 0,175 sobre Sedentario (0, 120, 240…; continuo para el automático). Forge igual. */
const actBonusMl = (activity: number) => Math.round(Math.max(0, (activity - 1.2) / 0.175) * 120);
/** «Sedentario» de Forge: poco o nada de ejercicio. Lo que un nivel pasa de esto es ejercicio de una semana típica. */
export const SEDENTARY = 1.2;
/**
 * Regla (2026-10-16, «en Forge también aparece el tipo de actividad para el gasto basal: ¿no chocaría?»): los niveles de Forge
 * se eligen por días de ejercicio a la semana («Ligero 1-3 días/sem»), así que el mantenimiento (basal × nivel) YA trae el
 * ejercicio de un día típico: basal × (nivel − 1,2). Sumarle además el entreno del día lo contaba dos veces (pasaba desde
 * antes con lo anotado en Forge). Un día suma solo lo que su ejercicio PASA de ese promedio. Forge (toji.html) usa la misma
 * regla, así que muestra la misma cifra.
 */
export function extraExerciseKcal(bmr: number | null | undefined, activity: number, dayExerciseKcal: number): { typical: number; extra: number } {
  const typical = bmr ? Math.round(bmr * Math.max(0, activity - SEDENTARY)) : 0;
  return { typical, extra: Math.max(0, Math.round(dayExerciseKcal) - typical) };
}

const fmt = (n: number) => Math.round(n).toLocaleString("es-CL");
const hasCondition = (m: MedicalProfile | null | undefined, id: string) => !!m?.conditions?.some((c: any) => c?.id === id);

/** Insuficiencia cardíaca escrita a mano (como "Otra" o en las notas de una condición), y cualquier restricción de líquidos. */
const HEART_FAILURE_TEXT = /insuficiencia card[ií]aca|falla card[ií]aca|\bicc\b/i;
const FLUID_LIMIT_TEXT = /restricci[oó]n (de )?(l[ií]quidos|agua|h[ií]drica)|l[ií]mite de (l[ií]quidos|agua)/i;
const conditionText = (m: MedicalProfile | null | undefined, re: RegExp) => !!m?.conditions?.some((c: any) => re.test(String(c?.notes ?? "")));
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);

/** Valida lo que manda el teléfono (es entrada externa). */
export function sanitizeBody(raw: unknown): BodyProfile | null {
  const r = raw as any;
  if (!r || typeof r !== "object") return null;
  const b: BodyProfile = {
    weightKg: num(r.weightKg, 25, 300), heightCm: num(r.heightCm, 100, 250), age: num(r.age, 10, 110),
    sex: r.sex === "h" || r.sex === "m" ? r.sex : undefined, activity: num(r.activity, 1.1, 2.0), activityAuto: r.activityAuto === true || undefined,
    date: typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : undefined,
    trainingKcal: num(r.trainingKcal, 0, 5000), trainingSets: num(r.trainingSets, 0, 300),
    goal: isGoal(r.goal) ? r.goal : undefined,
    updatedAt: new Date().toISOString(),
  };
  return b.weightKg || b.heightCm || b.age || b.sex || b.activity ? b : null;
}

/** Metabolismo basal (Mifflin-St Jeor), la misma fórmula que usa Forge. */
export function bmrOf(b: BodyProfile | null | undefined): number | null {
  if (!b?.weightKg || !b.heightCm || !b.age || !b.sex) return null;
  return Math.round(10 * b.weightKg + 6.25 * b.heightCm - 5 * b.age + (b.sex === "h" ? 5 : -161));
}

/**
 * Cómo moderan el agua las condiciones y medicamentos (la app y Forge aplican la misma regla, ver waterRule en
 * eris-mobile/src/config/targetRules.ts): enfermedad renal → no se fija meta (el límite lo pone su nefrólogo);
 * SGLT2 → +30 % (la base médica, por la pérdida de líquido en la orina).
 */
export function waterRule(medical: MedicalProfile | null | undefined): { off: boolean; multiplier: number; note?: string } {
  if (hasCondition(medical, "ckd")) return { off: true, multiplier: 1, note: "con enfermedad renal tu límite de líquidos lo define tu nefrólogo" };
  // Insuficiencia cardíaca (2026-10-10): se restringen los líquidos (también la jalea, las sopas, el helado y el hielo), así
  // que una meta de 35 ml/kg empujaría justo al revés. Va ANTES del SGLT2, que en insuficiencia cardíaca es tratamiento común.
  if (hasCondition(medical, "heart_failure") || conditionText(medical, HEART_FAILURE_TEXT)) {
    return { off: true, multiplier: 1, note: "con insuficiencia cardíaca tu límite de líquidos lo define tu cardiólogo" };
  }
  if (conditionText(medical, FLUID_LIMIT_TEXT)) return { off: true, multiplier: 1, note: "tu límite de líquidos lo define tu médico" };
  const meds = medicationTypes(medical);
  const m = meds.has("sglt2") ? 1.3 : getNumericAdjustment(medical, "hydrationL")?.multiplier ?? 1;
  return m !== 1 ? { off: false, multiplier: m, note: `+${Math.round((m - 1) * 100)} % por tu medicamento (SGLT2)` } : { off: false, multiplier: 1 };
}

/**
 * Proteína por kilo: según el objetivo de Forge (ver GOALS); sin objetivo, 1,6 si entrena (rango 1,6–2,2) y 1,2 si no; con
 * enfermedad renal 0,8 como TOPE (manda sobre cualquier objetivo).
 */
export function proteinRule(medical: MedicalProfile | null | undefined, trains: boolean, goal?: BodyGoal): { perKg: number; cap: boolean; range?: [number, number] } {
  if (hasCondition(medical, "ckd")) return { perKg: 0.8, cap: true };
  if (goal) return { perKg: GOALS[goal].protTarget, cap: false, range: GOALS[goal].prot };
  return trains ? { perKg: 1.6, cap: false, range: [1.6, 2.2] } : { perKg: 1.2, cap: false, range: [1.0, 1.2] };
}

export function computeTargets(input: {
  stored?: Record<string, any> | null;
  body?: BodyProfile | null;
  medical?: MedicalProfile | null;
  /** peso de Health Connect (balanza), si Forge no tiene uno */
  snapWeightKg?: number;
  /** YYYY-MM-DD local de hoy */
  today: string;
  /** tiene rutina en Forge o entrenó hoy */
  trainsRegularly?: boolean;
  /** actividad de hoy detectada por el reloj (solo cuenta si es de `today`) */
  activity?: ActivityToday | null;
  /** nivel de actividad automático que calculó el teléfono con las últimas 4 semanas (eris-mobile/src/services/activityLevel.ts) */
  autoLevel?: { factor: number; label?: string; perWeek?: number; days?: number; neatKcal?: number; exKcal?: number } | null;
  /** el entreno de hoy que respondió («¿entrenas hoy?», services/TrainingIntent.ts): metas según el día */
  intent?: TrainingIntent | null;
  /** la hora (para el fantasma: se apaga si pasó la hora y no entrenó) */
  now?: Date;
  /** el día de COMIDA de ahora (YYYY-MM-DD): la actividad del teléfono puede venir con ese día (1.84+) */
  foodDay?: string;
}): DailyTargets {
  const stored = input.stored || {};
  const body = input.body || null;
  const medical = input.medical || null;
  const set: DailyTargets["set"] = {};
  if (stored.calories > 0) set.calories = stored.calories;
  if (stored.protein > 0) set.protein = stored.protein;
  if (stored.waterLiters > 0) set.waterLiters = stored.waterLiters;

  const weightKg = body?.weightKg ?? num(input.snapWeightKg, 25, 300);
  const today = body?.date === input.today;
  const forgeKcal = today ? Math.round(body?.trainingKcal ?? 0) : 0;
  const trainingSets = today ? body?.trainingSets ?? 0 : 0;
  // Lo que gastó hoy según el reloj (básquet sin modo entrenamiento, una caminata larga…). Se toma el MAYOR entre esto y el
  // entreno de Forge, no la suma: una sesión de gimnasio anotada en Forge también la ve el reloj y se contaría dos veces.
  const act = input.activity && (input.activity.day === input.today || (input.foodDay && input.activity.day === input.foodDay)) && input.activity.minutes > 0 ? input.activity : null;
  const actKcal = act ? Math.min(2500, Math.max(0, Math.round(act.kcal))) : 0;
  const trainingKcal = Math.max(forgeKcal, actKcal);
  const fromWatch = actKcal > forgeKcal;
  // Nivel automático (según tu actividad real, 2026-10-16): el del teléfono, más fresco que el último que mandó Forge
  const auto = body?.activityAuto && input.autoLevel && input.autoLevel.factor >= 1.1 && input.autoLevel.factor <= 2 ? input.autoLevel : null;
  const activity = auto ? auto.factor : body?.activity ?? ACTIVITY_DEFAULT;
  const goal = body?.goal;
  const trains = !!input.trainsRegularly || trainingSets > 0 || activity >= 1.55 || goal === "ganar" || goal === "recomp";
  const notes: string[] = [];

  // ── Calorías: lo fijado > lo de Forge (basal × actividad + entreno de hoy) > referencia general
  const bmr = bmrOf(body);
  const maintenance = bmr ? Math.round(bmr * activity) : undefined;
  // El mantenimiento ya trae el ejercicio de un día típico: hoy suma solo lo que lo pase (extraExerciseKcal)
  const ex = extraExerciseKcal(bmr, activity, trainingKcal);
  // «¿Entrenas hoy?» respondido (Forge 2.0): metas SEGÚN EL DÍA — lo de todos los días (basal × 1,2 + lo que te mueves fuera
  // del ejercicio) + el ejercicio de HOY (lo hecho, o lo planificado si es más). Sin respuesta, la meta de siempre.
  const intent = input.intent && input.intent.day === input.today ? input.intent : null;
  const now = input.now ?? new Date();
  const gh = ghostKcal(intent, trainingKcal, now, input.today);
  const planned = intent?.answer === "si" && !gh.expired ? intent.kcal ?? 0 : 0;
  const neat = auto && typeof auto.neatKcal === "number" ? Math.max(0, auto.neatKcal) : 0;
  const byDay = intent && bmr && !set.calories ? byDaySpend(bmr, neat, trainingKcal, planned) : null;
  let kcal: number, kcalSrc: string;
  let kcalNoGhost: number | undefined;
  if (set.calories) { kcal = set.calories; kcalSrc = "meta que fijaste"; }
  else if (maintenance) {
    const spend = byDay ? byDay.spend : maintenance + ex.extra;
    kcal = spend;
    const what = fromWatch && act ? `${activityLabel(act)} (según tu reloj)` : "entreno de Forge";
    if (byDay && intent) {
      const daily = Math.round(bmr! * 1.2 + neat);
      kcalSrc = intent.answer === "no"
        ? `día de descanso: ~${fmt(daily)} (basal × 1,2${neat ? ` + ~${fmt(neat)} de tu movimiento del día a día` : ""})${trainingKcal ? ` + ~${fmt(trainingKcal)} de lo que igual te moviste (${what})` : ", sin ejercicio"}`
        : `según el día: ~${fmt(daily)} de todos los días (basal × 1,2${neat ? ` + ~${fmt(neat)} de tu movimiento` : ""}) + ~${fmt(byDay.exercise)} del entreno`
          + (gh.ghost ? ` (planificado: ${intentPhrase(intent)}; faltan ~${fmt(gh.ghost)})` : trainingKcal ? ` (hecho: ${what})` : "");
    } else {
      kcalSrc = `tu gasto según Forge: ${fmt(maintenance)} de mantenimiento${auto ? ` (nivel automático ${String(auto.factor).replace(".", ",")}, según tus últimas 4 semanas reales; ` : " ("}ya incluye ~${fmt(ex.typical)} de ejercicio de un día típico)`
        + (trainingKcal ? (ex.extra ? ` + ${fmt(ex.extra)} extra: hoy ${what} ~${fmt(trainingKcal)}, sobre tu día típico` : `; hoy ${what} ~${fmt(trainingKcal)}, dentro de tu día típico`) : "");
      if (gh.expired) kcalSrc += "; el entreno que planificaste ya no cuenta (no se registró)";
    }
    // Objetivo de Forge: déficit o superávit moderado (con tope), nunca bajo el basal ni bajo 1.500 / 1.200 kcal
    if (goal && GOALS[goal].kcalPct) {
      const g = GOALS[goal];
      const delta = Math.round(Math.max(-g.kcalCap, Math.min(g.kcalCap, spend * g.kcalPct)));
      const floor = Math.max(bmr ?? 0, body?.sex === "m" ? 1200 : 1500);
      kcal = Math.max(floor, spend + delta);
      kcalSrc += `; objetivo ${g.label}: ${kcal - spend >= 0 ? "+" : "−"}${fmt(Math.abs(kcal - spend))} kcal`;
      if (gh.ghost) { const s0 = spend - gh.ghost; kcalNoGhost = Math.max(floor, s0 + Math.round(Math.max(-g.kcalCap, Math.min(g.kcalCap, s0 * g.kcalPct)))); }
      if (goal === "perder" && hasCondition(medical, "diabetes_t2") || goal === "perder" && hasCondition(medical, "diabetes_t1")) {
        notes.push("Con diabetes, coordina el déficit con tu médico: comer menos puede cambiar lo que necesitas de tu tratamiento.");
      }
    }
    if (gh.ghost && kcalNoGhost == null) kcalNoGhost = kcal - gh.ghost;
  } else { kcal = DEFAULT_KCAL; kcalSrc = `referencia general (${fmt(DEFAULT_KCAL)}); completa tu peso, altura, edad y sexo en Forge para calcular la tuya`; }

  // ── Proteína
  const pr = proteinRule(medical, trains, goal);
  // Con obesidad (IMC ≥ 30) los gramos por kilo se calculan con un peso de referencia (IMC 25): con el peso total la meta
  // sale inflada, porque la grasa no necesita proteína
  const heightM = body?.heightCm ? body.heightCm / 100 : undefined;
  const bmi = weightKg && heightM ? weightKg / (heightM * heightM) : undefined;
  const refKg = bmi && heightM && bmi >= 30 ? Math.round(25 * heightM * heightM) : weightKg;
  let proteinG: number, proteinSrc: string;
  let proteinRange: [number, number] | undefined;
  const g1 = (n: number) => n.toString().replace(".", ",");
  if (set.protein) { proteinG = set.protein; proteinSrc = "meta que fijaste"; }
  else if (refKg) {
    proteinG = Math.round(refKg * pr.perKg);
    proteinRange = pr.range ? [Math.round(refKg * pr.range[0]), Math.round(refKg * pr.range[1])] : undefined;
    const kgTxt = refKg !== weightKg ? `${refKg} kg de peso de referencia (con IMC sobre 30 se usa el de IMC 25)` : `tu peso (${weightKg} kg)`;
    proteinSrc = pr.cap ? `tope de ${pr.perKg} g/kg por enfermedad renal (${weightKg} kg); lo afina tu nefrólogo`
      : goal ? `${g1(pr.perKg)} g/kg con ${kgTxt} — rango ${g1(pr.range![0])}–${g1(pr.range![1])} g/kg porque tu objetivo es ${GOALS[goal].label} (${GOALS[goal].why})`
      : `${g1(pr.perKg)} g/kg con ${kgTxt}${trains ? " porque entrenas (rango con respaldo 1,6–2,2 g/kg; elige tu objetivo en Forge para afinarlo)" : ""}`;
  } else { proteinG = FALLBACK_PROTEIN_G; proteinSrc = `referencia general (${FALLBACK_PROTEIN_G} g); con tu peso la afino`; }
  if (pr.cap && !set.protein) notes.push("Proteína: es un tope, no una meta a alcanzar (enfermedad renal).");

  // ── Agua: lo fijado > lo de Forge (35 ml/kg + actividad + entreno) ajustado por condiciones/medicamentos
  const wr = waterRule(medical);
  let waterL: number | null, waterSrc: string;
  if (set.waterLiters) { waterL = set.waterLiters; waterSrc = "meta que fijaste"; }
  else if (wr.off) { waterL = null; waterSrc = `sin meta: ${wr.note}`; notes.push(`Agua: ${wr.note}.`); }
  else {
    // Según el día: sin el bono del nivel (el entreno de hoy, hecho o planificado, se suma aparte)
    const baseMl = weightKg ? weightKg * 35 + (byDay ? 0 : actBonusMl(activity)) : DEFAULT_WATER_L * 1000;
    // Extra por entreno: las series de Forge, o la actividad del reloj (~0,5 L por hora moderada y ~0,8 L por hora intensa,
    // dentro de lo que se suda en ejercicio según el ACSM: 0,5–2 L/h). Se toma el mayor, igual que las calorías.
    const setsMl = Math.round((trainingSets * 2.5) / 60 * 600);
    const vig = act ? Math.min(act.vigorousMin ?? 0, act.minutes) : 0;
    const actMl = act ? Math.min(2500, Math.round(vig * 13 + (act.minutes - vig) * 8)) : 0;
    // Igual que las calorías: el nivel ya trae el agua de un día típico (bonus por nivel); suma solo lo que la pase
    const plannedMl = intent?.answer === "si" && !gh.expired ? intent.waterMl ?? 0 : 0;
    const trainMl = byDay ? Math.max(setsMl, actMl, plannedMl) : Math.max(0, Math.max(setsMl, actMl) - actBonusMl(activity));
    // Mismo redondeo que muestra Forge ((ml/1000).toFixed(1)): con r1, 4.850 ml salía 4,9 L acá y 4,8 L en Forge
    const totalMl = Math.round(((baseMl + trainMl) * wr.multiplier) / 50) * 50;
    waterL = Math.min(6, Number((totalMl / 1000).toFixed(1)));
    waterSrc = `${weightKg ? "35 ml/kg con tu peso y actividad" : "referencia general"}${trainMl ? (actMl > setsMl && act ? ` + ${fmt(trainMl)} ml extra por ${activityLabel(act)}` : ` + ${fmt(trainMl)} ml extra por entreno`) : ""}${wr.note ? `, ${wr.note}` : ""}`;
  }

  const lim = dailyLimits(medical, weightKg);
  return {
    kcal, kcalMaintenance: maintenance,
    ...(byDay && intent ? { byDay: intent.answer === "no" ? "descanso" as const : "entreno" as const } : {}),
    ...(gh.ghost ? { kcalGhost: gh.ghost, kcalNoGhost } : {}), ...(planned ? { kcalPlanned: planned } : {}),
    ...(intent?.answer === "si" ? { intentPhrase: intentPhrase(intent), minutesToWorkout: minutesToWorkout(intent, now, input.today) } : {}), kcalTraining: trainingKcal || undefined, kcalTypicalExercise: ex.typical || undefined, kcalExtraToday: ex.extra || undefined,
    proteinG, proteinRange: set.protein ? undefined : proteinRange, proteinIsCap: pr.cap && !set.protein, goal, waterL,
    sodiumMgLimit: lim.sodiumMg, sugarGLimit: lim.sugarG, fiberGGoal: lim.fiberG, fatGLimit: lim.fatG,
    weightKg, sources: { kcal: kcalSrc, protein: proteinSrc, water: waterSrc }, set, notes,
  };
}

/** Día local YYYY-MM-DD (el mismo formato que usa Forge). */
/**
 * ¿La actividad que mandó el teléfono es de hoy? Desde la 1.84 el teléfono la cuenta en el día de COMIDA (termina al
 * dormir; pedido del usuario, 2026-11-05): a la 1:30 sin haber dormido sigue siendo la de ayer y va con lo comido ayer.
 * Vale el día del calendario (apps anteriores) o el día de comida de ahora.
 */
export function actividadDeHoy<T extends { day?: string; minutes?: number }>(activity: T | null | undefined, snap: any, now: Date = new Date()): T | null {
  if (!activity || typeof activity.day !== "string") return null;
  const deComida = isoDayKey(nutritionDayOf(now, dayCtxFrom(snap)));
  return activity.day === localDay(now) || activity.day === deComida ? activity : null;
}

export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Las metas de hoy de un perfil, con todo lo que guarda el servidor. */
export async function loadTargets(memory: { get(k: string): Promise<any>; getProfile?(): Promise<any> }): Promise<DailyTargets> {
  const safe = async (k: string) => { try { return await memory.get(k); } catch { return null; } };
  const [stored, body, snap, routine, profile, intents] = await Promise.all([
    safe("nutrition_goals"), safe("body_profile"), safe("health_snapshot_latest"), safe("toji_routine_md"),
    memory.getProfile ? memory.getProfile().catch(() => null) : Promise.resolve(null),
    safe("training_intent"),
  ]);
  return computeTargets({
    stored, body, medical: profile?.medical ?? null, snapWeightKg: typeof snap?.weight === "number" ? snap.weight : undefined,
    today: localDay(), foodDay: isoDayKey(nutritionDayOf(new Date(), dayCtxFrom(snap))), trainsRegularly: !!routine?.md, activity: snap?.activity ?? null, autoLevel: snap?.activityLevel ?? null,
    intent: intents && typeof intents === "object" ? intents[localDay()] ?? null : null,
  });
}
