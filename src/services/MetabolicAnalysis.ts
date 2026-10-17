// ============================================================
// Eris — Análisis metabólico
//
// Junta lo que Eris sabe del usuario HOY (comida, agua, sueño, pasos, glucosa,
// entrenamiento, presupuesto) y lo convierte en hallazgos priorizados con una
// acción concreta cada uno. Todo es aritmética en TS con rangos conservadores y
// documentados: el LLM solo presenta el resultado, nunca calcula ni inventa.
//
// HONESTIDAD DE DATOS: cada fuente trae su antigüedad. Un snapshot de ayer no se
// usa para decir "hoy llevas 8.000 pasos"; se avisa que está desactualizado.
//
// Orientativo, no clínico: sin dosis de medicamentos ni diagnósticos.
// ============================================================

import { diagnoseBaseline, type BaselineDiagnosis } from "./BaselineEngine.js";
import { deriveRestrictions, medicationTypes, type Restrictions } from "./DietaryRestrictions.js";
import { getDismissals, getOverrides } from "../tools/InsightFeedbackTool.js";
import { localDateKey, type MedicalProfile, type UserProfile } from "../memory.js";
import { dayEntries } from "./NutritionLog.js";
import { computeTargets, activityLabel, type ActivityToday } from "./DailyTargets.js";
import { waterTotalToday } from "./WaterToday.js";
import { dayCtxFrom, normDayHour, isoDayKey, nutritionDayKey, nutritionDayOf, wakeHourFor } from "./MealSchedule.js";

// ─── Constantes (todas documentadas; ninguna es un valor clínico personalizado) ──────────

const WAKE_HOUR = 7;               // mismas horas que BaselineEngine para prorratear lo acumulativo
const SLEEP_HOUR = 23;
// Calorías, proteína y agua: ya no se calculan aquí sino en DailyTargets (la fuente única de metas)
const DEFAULT_STEPS = 8000;        // punto medio del rango 7.000–10.000 pasos/día que asocia la literatura con menor riesgo
const SLEEP_TARGET_H = 7;          // mínimo recomendado para adultos (7–9 h)
const SLEEP_SHORT_H = 6;
const SNAPSHOT_FRESH_MIN = 90;     // un snapshot de hoy más viejo que esto se avisa como "con retraso"
const GLUCOSE_STALE_MIN = 20;      // el sensor da lecturas cada ~5 min; más de 20 = probablemente desconectado

export type Area = "glucosa" | "agua" | "sueno" | "comida" | "movimiento" | "animo" | "datos";
export type Severity = 0 | 1 | 2 | 3; // 0 informativo · 1 atención · 2 importante · 3 urgente

export interface Finding {
  area: Area;
  severity: Severity;
  headline: string;
  detail: string;
  action?: string;
  /** "caution" = recordatorio fijo por su condición (no es un hallazgo de hoy). */
  tag?: "caution";
}

export interface Macros { kcal: number; protein: number; carbs: number; fat: number; fiber: number }

export interface FoodBudget {
  spent?: number;          // gastado en alimentación este mes
  budget?: number;         // presupuesto de alimentación (si el usuario lo definió)
  remaining?: number;      // budget - spent
  disponible?: number;     // disponible total del mes
  daysLeft: number;        // días que quedan del mes (incluye hoy)
  perDay?: number;         // lo que se puede gastar por día en comida
  perDayBasis: "presupuesto" | "disponible";
  tier: 1 | 2 | 3;         // nivel de precio máximo sugerido
  note?: string;
}

export interface MetabolicContext {
  now: Date;
  /** La hora de despertar que arma el horario de hoy (corre "lo esperable a esta hora" para quien trasnocha). */
  wakeHour?: number;
  profile: UserProfile | null;
  medical: MedicalProfile | null;
  restrictions: Restrictions;
  medTypes: Set<string>;
  weightKg?: number;

  // Salud de HOY (solo datos con fecha de hoy)
  sleepHours?: number;
  restingHR?: number;
  steps?: number;
  activeCalories?: number;
  trainedToday: boolean | null;   // null = no se sabe (nunca se asume "no entrenaste")
  /** minutos de ejercicio de hoy (sesiones de Health Connect y actividad detectada por el reloj) */
  exerciseMinutes?: number;
  /** kcal activas de la actividad detectada hoy, y su nombre («básquet 2 h») */
  activityKcal?: number;
  activityLabel?: string;
  snapshotAgeMin: number | null;  // null = no hay snapshot
  snapshotIsToday: boolean;

  // Comida y agua de hoy
  eaten: Macros;
  mealsToday: number;
  lastMealAt?: Date;
  hydrationEffectiveL: number;
  hydrationRawL: number;

  // Metas
  goals: { kcal: number; protein: number | null; carbs: number; fat: number; hydrationL: number | null; steps: number; sources: string[] };

  glucose: { value: number; arrow: string; trend: string; isLow: boolean; isHigh: boolean; ageMin: number; low: number; high: number } | null;
  diag: BaselineDiagnosis | null;
  routine: { name: string; md: string } | null;
  budget: FoodBudget | null;
  /** Avisos de calidad de datos que hay que decirle al usuario. */
  dataNotes: string[];
}

export interface Analysis {
  findings: Finding[];             // ya ordenados por prioridad
  needs: { proteinG: number; kcal: number; carbsG: number; fatG: number; waterL: number };
  hour: number;
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

const round1 = (n: number) => Math.round(n * 10) / 10;
const round0 = (n: number) => Math.round(n);
/** Cifras a la chilena para lo que lee la persona: 5.412 · 6,2 */
const cl0 = (n: number) => Math.round(n).toLocaleString("es-CL");
const cl1 = (n: number) => String(round1(n)).replace(".", ",");
const hourOf = (d: Date) => d.getHours() + d.getMinutes() / 60;
/**
 * Fracción del día "útil" transcurrida (7:00–23:00 con el horario de siempre; corrida si la persona despierta más tarde o
 * más temprano: services/MealSchedule.ts).
 */
export function dayFraction(now: Date, wakeHour?: number): number {
  const h = normDayHour(now, wakeHour); // desde que despertó (no el reloj corrido): ver MealSchedule.normDayHour
  return Math.min(1, Math.max(0, (h - WAKE_HOUR) / (SLEEP_HOUR - WAKE_HOUR)));
}

const hasCondition = (m: MedicalProfile | null, ...ids: string[]) => !!m?.conditions?.some((c) => ids.includes(c.id));

// ─── Presupuesto (parseo determinista del texto que manda Finanzas) ──────────

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const clpToNumber = (s: string) => Number(s.replace(/[^\d]/g, ""));

/**
 * Heurística de niveles (aproximada, en CLP por día de comida): <4.000 → solo lo más económico;
 * <9.000 → económico y medio; desde ahí, cualquiera. No son precios exactos del supermercado.
 */
export function tierForPerDay(perDay: number): 1 | 2 | 3 {
  return perDay < 4000 ? 1 : perDay < 9000 ? 2 : 3;
}

/**
 * Finanzas 2.0: el presupuesto de comida como DATO (el resumen que manda el núcleo de la app: presupuestoAlDia), así el
 * asesor dice la misma cifra por día que la pantalla de Presupuesto. Solo si es de este mes y trae la categoría con tope;
 * si no, se lee el texto como antes (parseFoodBudget).
 */
export function foodBudgetFromSummary(summary: any, now: Date): FoodBudget | null {
  if (!summary || typeof summary !== "object" || typeof summary.at !== "string") return null;
  const at = new Date(summary.at);
  if (Number.isNaN(at.getTime()) || at.getFullYear() !== now.getFullYear() || at.getMonth() !== now.getMonth()) return null;
  const l = Array.isArray(summary.presupuesto) ? summary.presupuesto.find((x: any) => x?.cat === "alimentacion" && Number(x.presup) > 0) : null;
  if (!l) return null;
  const daysLeft = Math.max(1, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1);
  const budget = Number(l.presup), spent = Number(l.gastado) || 0, remaining = Number.isFinite(Number(l.queda)) ? Number(l.queda) : budget - spent;
  // porDia del núcleo es del momento en que se mandó; si fue otro día, se recalcula con los días de hoy
  const sameDay = at.toDateString() === now.toDateString();
  const perDay = sameDay && Number.isFinite(Number(l.porDia)) ? Number(l.porDia) : Math.max(0, remaining) / daysLeft;
  const disponible = Number.isFinite(Number(summary.disponible)) ? Number(summary.disponible) : undefined;
  return { spent, budget, remaining, ...(disponible !== undefined ? { disponible } : {}), daysLeft, perDay: round0(perDay), perDayBasis: "presupuesto", tier: tierForPerDay(perDay) };
}

export function parseFoodBudget(text: string | null | undefined, now: Date): { budget: FoodBudget | null; note?: string } {
  if (!text || typeof text !== "string") return { budget: null, note: "Finanzas todavía no me ha mandado datos (ábrela una vez para que los vea)." };

  const gastosLine = text.match(/Gastos\s+([a-záéíóú]+)\s+(\d{4})/i);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);

  if (gastosLine) {
    const mes = MESES.indexOf(gastosLine[1].toLowerCase());
    const ano = Number(gastosLine[2]);
    if (mes !== now.getMonth() || ano !== now.getFullYear()) {
      return { budget: null, note: `Los datos de Finanzas son de ${gastosLine[1]} ${gastosLine[2]}: están desactualizados, ábrela para refrescarlos.` };
    }
  }

  const disp = text.match(/Disponible:\s*\$([\d.,]+)/i);
  const disponible = disp ? clpToNumber(disp[1]) : undefined;

  const cat = text.match(/Alimentaci[oó]n:\s*\$([\d.,]+)(?:\s*\/\s*\$([\d.,]+)\s*presup)?/i);
  const spent = cat ? clpToNumber(cat[1]) : undefined;
  const budgetAmt = cat && cat[2] ? clpToNumber(cat[2]) : undefined;

  if (disponible === undefined && spent === undefined) return { budget: null, note: "No pude leer cifras de presupuesto en el texto de Finanzas." };

  const tierFor = tierForPerDay;

  if (budgetAmt !== undefined) {
    const remaining = budgetAmt - (spent ?? 0);
    const perDay = Math.max(0, remaining) / daysLeft;
    return {
      budget: { spent, budget: budgetAmt, remaining, disponible, daysLeft, perDay: round0(perDay), perDayBasis: "presupuesto", tier: tierFor(perDay) },
    };
  }
  if (disponible !== undefined) {
    // Sin presupuesto de alimentación: se reparte el disponible total entre los días que quedan y se reserva
    // solo un tercio para comida (el resto son otros gastos). Se avisa que es una estimación.
    const perDay = (disponible / daysLeft) / 3;
    return {
      budget: {
        spent, disponible, daysLeft, perDay: round0(perDay), perDayBasis: "disponible", tier: tierFor(perDay),
        note: "No tienes presupuesto de alimentación definido en Finanzas: estimé ~1/3 de tu disponible diario para comida.",
      },
    };
  }
  return { budget: null };
}

// ─── Reunir datos ────────────────────────────────────────────────────────────

export interface GatherOptions {
  glucoService?: any;
  now?: Date;
}

export async function gatherMetabolicContext(memory: any, opts: GatherOptions = {}): Promise<MetabolicContext> {
  const now = opts.now ?? new Date();
  // El día de COMIDA (termina al dormir, no a medianoche: services/MealSchedule.ts)
  const dayCtx = dayCtxFrom(await memory.get("health_snapshot_latest").catch(() => null));
  const today = nutritionDayKey(now, dayCtx);
  const todayKey = isoDayKey(nutritionDayOf(now, dayCtx));
  const wakeHour = wakeHourFor(dayCtx, now);
  const dataNotes: string[] = [];

  const safeGet = async (k: string): Promise<any> => { try { return await memory.get(k); } catch { return null; } };

  let profile: UserProfile | null = null;
  try { profile = (await memory.getProfile?.()) ?? null; } catch {}
  const medical = profile?.medical ?? null;
  const restrictions = deriveRestrictions(medical);
  const medTypes = medicationTypes(medical);

  // ── Snapshot de salud + rollup de hoy ──
  const snap: any = await safeGet("health_snapshot_latest");
  let snapshotAgeMin: number | null = null;
  let snapshotIsToday = false;
  if (snap?.lastUpdated) {
    const t = new Date(snap.lastUpdated);
    if (!Number.isNaN(t.getTime())) {
      snapshotAgeMin = Math.max(0, Math.round((now.getTime() - t.getTime()) / 60000));
      snapshotIsToday = nutritionDayKey(t, dayCtx) === today;
    }
  }
  const rollup: any[] = (await safeGet("daily_rollup_log")) || [];
  const rollupToday = Array.isArray(rollup) ? rollup.find((e) => e.date === todayKey) : undefined;

  if (snap && !snapshotIsToday) {
    dataNotes.push(
      snapshotAgeMin === null
        ? "El snapshot de salud no trae fecha: no lo uso para hoy."
        : `Los datos de salud del teléfono son de hace ${snapshotAgeMin >= 1440 ? Math.round(snapshotAgeMin / 1440) + " día(s)" : Math.round(snapshotAgeMin / 60) + " h"}: no los uso para pasos, sueño ni comida de hoy (abre Eris en el teléfono para actualizarlos).`,
      );
  } else if (snapshotAgeMin !== null && snapshotAgeMin > SNAPSHOT_FRESH_MIN) {
    dataNotes.push(`Los datos de salud del teléfono tienen ${Math.round(snapshotAgeMin / 60 * 10) / 10} h de retraso: pasos y calorías pueden estar más altos ahora.`);
  } else if (!snap && !rollupToday) {
    dataNotes.push("Todavía no tengo datos de salud del teléfono (sueño, pasos).");
  }

  const fromSnap = <T,>(v: T | undefined): T | undefined => (snapshotIsToday ? v : undefined);
  const sleepHours = fromSnap<number>(snap?.sleep?.durationHours) ?? rollupToday?.sleepHours;
  const restingHR = fromSnap<number>(snap?.heartRate?.resting) ?? rollupToday?.restingHR;
  const steps = Math.max(fromSnap<number>(typeof snap?.steps === "number" ? snap.steps : undefined) ?? 0, rollupToday?.steps ?? 0) || undefined;
  const activeCalories = fromSnap<number>(typeof snap?.calories === "object" ? snap.calories?.active : snap?.calories);
  const weightKg: number | undefined = typeof snap?.weight === "number" && snap.weight > 20 && snap.weight < 300 ? snap.weight : undefined;

  // Entrenó hoy: Forge (`trainedDay` de hoy, o series de hoy en el perfil del cuerpo) o 20 min o más de ejercicio en Health
  // Connect. Antes se buscaba `snap.workouts`, que la app nunca manda: para Eris nadie entrenaba nunca, y «hoy me hice
  // cagar» terminaba en «muévete» (2026-10-16). `trained` a secas es pegajoso (no se apaga nunca): no se usa.
  const calToday = isoDayKey(now);
  const body = await safeGet("body_profile");
  // + la actividad que el teléfono detectó con el reloj sin «modo entrenamiento» (pulso + pasos + kcal; incluye las sesiones)
  const activity: ActivityToday | null = snapshotIsToday && snap?.activity?.day === calToday && snap.activity.minutes > 0 ? snap.activity : null;
  const sessionMin = fromSnap<number>(typeof snap?.activeMinutes === "number" && snap.activeMinutes > 0 ? snap.activeMinutes : undefined);
  const exerciseMinutes = Math.max(sessionMin ?? 0, activity?.minutes ?? 0) || undefined;
  const forgeToday = snap?.trainedDay === calToday || (body?.date === calToday && ((body?.trainingSets ?? 0) > 0 || (body?.trainingKcal ?? 0) > 0));
  const trainedToday: boolean | null = forgeToday || (exerciseMinutes ?? 0) >= 20 ? true : null;

  // ── Comida y agua de hoy ──
  // Lo del chat + lo anotado a mano en la app (si el teléfono mandó su lista): así también se sabe a qué hora comió
  const nutLog: any[] = dayEntries((await safeGet(`nutrition_log_${today}`)) || [], snap?.foodLog, today, await safeGet(`nutrition_deleted_${today}`)).entries;
  const eaten: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  let lastMealAt: Date | undefined;
  if (Array.isArray(nutLog)) {
    for (const e of nutLog) {
      eaten.kcal += e?.totals?.calories || 0;
      eaten.protein += e?.totals?.protein || 0;
      eaten.carbs += e?.totals?.carbs || 0;
      eaten.fat += e?.totals?.fat || 0;
      eaten.fiber += e?.totals?.fiber || 0;
      const t = e?.timestamp ? new Date(e.timestamp) : undefined;
      if (t && !Number.isNaN(t.getTime()) && (!lastMealAt || t > lastMealAt)) lastMealAt = t;
    }
  }
  // El snapshot puede traer nutrición de otras apps (Health Connect): se toma el MAYOR por macro para no contar doble.
  if (snapshotIsToday && snap?.nutrition) {
    eaten.kcal = Math.max(eaten.kcal, snap.nutrition.calories || 0);
    eaten.protein = Math.max(eaten.protein, snap.nutrition.protein || 0);
    eaten.carbs = Math.max(eaten.carbs, snap.nutrition.carbs || 0);
    eaten.fat = Math.max(eaten.fat, snap.nutrition.fat || 0);
  }
  (Object.keys(eaten) as Array<keyof Macros>).forEach((k) => (eaten[k] = round1(eaten[k])));

  const waterLog: any[] = (await safeGet(`hydration_log_${today}`)) || [];
  let hydrationEffectiveL = 0, hydrationRawL = 0;
  if (Array.isArray(waterLog)) {
    for (const e of waterLog) {
      hydrationRawL += e?.liters || 0;
      hydrationEffectiveL += e?.effectiveLiters ?? e?.liters ?? 0;
    }
  }
  // Hoy: la cuenta única del agua (services/WaterToday.ts), la misma del chat, Inicio y "¿cuánta agua llevo?"
  const w = today === nutritionDayKey(new Date(), dayCtx) ? await waterTotalToday(memory).catch(() => null) : null;
  if (w) {
    hydrationEffectiveL = w.totalL;
    hydrationRawL = Math.max(hydrationRawL, w.totalL);
  } else if (snapshotIsToday && typeof snap?.hydration === "number" && snap.hydration > hydrationEffectiveL) {
    // Otro día (pruebas con `now`): el agua del snapshot del teléfono si es MAYOR que el log
    hydrationEffectiveL = snap.hydration;
    hydrationRawL = Math.max(hydrationRawL, snap.hydration);
  }
  hydrationEffectiveL = Math.round(hydrationEffectiveL * 100) / 100;
  hydrationRawL = Math.round(hydrationRawL * 100) / 100;

  // ── Metas ── (fuente única: DailyTargets — las mismas que ven Forge, Nutrición, Inicio y el chat)
  const routine = ((await safeGet("toji_routine_md")) as any) || null;
  const targets = computeTargets({
    stored: await safeGet("nutrition_goals"), body: await safeGet("body_profile"), medical,
    snapWeightKg: weightKg, today: todayKey, trainsRegularly: !!routine?.md || trainedToday === true,
    activity: activity ? { ...activity, day: todayKey } : null,
    autoLevel: snap?.activityLevel ?? null,
  });
  const kcal = targets.kcal;
  const protein: number | null = targets.proteinIsCap ? null : targets.proteinG; // con enfermedad renal es un tope, no una meta a perseguir
  const hydrationL = targets.waterL;
  const sources: string[] = [`calorías: ${targets.sources.kcal}`, `proteína: ${targets.sources.protein}`, `agua: ${targets.sources.water}`];

  // ── Glucosa ──
  let glucose: MetabolicContext["glucose"] = null;
  try {
    const r = opts.glucoService?.getCurrent?.();
    if (r) {
      const ageMin = Math.max(0, Math.round((now.getTime() - new Date(r.timestamp).getTime()) / 60000));
      glucose = {
        value: r.value, arrow: r.trendArrow || "", trend: r.trend || "unknown", isLow: !!r.isLow, isHigh: !!r.isHigh, ageMin,
        low: medical?.thresholds?.glucoseLow ?? 70, high: medical?.thresholds?.glucoseHigh ?? 180,
      };
    }
  } catch {}

  // ── Patrón personal ──
  let diag: BaselineDiagnosis | null = null;
  try {
    const log = Array.isArray(rollup) ? rollup : [];
    const dismissals = await getDismissals(memory);
    const overrides = await getOverrides(memory);
    if (log.length) diag = diagnoseBaseline(log, now, { medical, dismissals, overrides, day: dayCtx });
  } catch {}

  // ── Presupuesto ──
  const structured = foodBudgetFromSummary(await safeGet("financial_summary_latest"), now);
  const fin = structured ? { budget: structured } as { budget: FoodBudget | null; note?: string } : parseFoodBudget(await safeGet("financial_context_latest"), now);
  if (fin.note && !fin.budget) dataNotes.push(fin.note);

  return {
    now, wakeHour, profile, medical, restrictions, medTypes, weightKg,
    sleepHours, restingHR, steps, activeCalories, trainedToday, exerciseMinutes, activityKcal: activity?.kcal, activityLabel: activity ? activityLabel(activity) : undefined, snapshotAgeMin, snapshotIsToday,
    eaten, mealsToday: Array.isArray(nutLog) ? nutLog.length : 0, lastMealAt,
    hydrationEffectiveL, hydrationRawL,
    goals: {
      kcal,
      protein,
      carbs: round0((kcal * 0.45) / 4),  // reparto estándar 45/30/25
      fat: round0((kcal * 0.30) / 9),
      hydrationL,
      steps: DEFAULT_STEPS,
      sources,
    },
    glucose, diag, routine: routine?.md ? { name: routine.name || "rutina.md", md: routine.md } : null,
    budget: fin.budget, dataNotes,
  };
}

// ─── Análisis ────────────────────────────────────────────────────────────────

const AREA_ORDER: Area[] = ["glucosa", "agua", "sueno", "comida", "movimiento", "animo", "datos"];

export function analyze(ctx: MetabolicContext): Analysis {
  const f: Finding[] = [];
  const hour = hourOf(ctx.now);
  const frac = dayFraction(ctx.now, ctx.wakeHour);
  const g = ctx.glucose;
  const diabetic = hasCondition(ctx.medical, "diabetes_t1", "diabetes_t2", "prediabetes");

  // 1) GLUCOSA ─────────────────────────────────────────────
  if (g) {
    if (g.ageMin > GLUCOSE_STALE_MIN) {
      f.push({ area: "glucosa", severity: 0, headline: `Última glucosa: ${g.value} mg/dL hace ${g.ageMin} min`, detail: "El sensor no ha reportado hace un rato; no la uso para decidir ahora.", action: "Revisa que el sensor esté conectado." });
    } else if (g.value < g.low) {
      f.push({
        area: "glucosa", severity: 3,
        headline: `Glucosa baja: ${g.value} mg/dL ${g.arrow}`.trim(),
        detail: `Estás bajo tu umbral (${g.low}).`,
        action: "Primero sube la glucosa con carbohidratos rápidos (herramienta carb_options), espera 15 min y vuelve a medir. La comida y el entrenamiento van después.",
      });
    } else if (g.trend === "falling" || g.trend === "rapidly_falling") {
      const near = g.value < g.low + 30;
      f.push({
        area: "glucosa", severity: near ? 2 : 1,
        headline: `Glucosa ${g.value} mg/dL y bajando ${g.arrow}`.trim(),
        detail: near ? "Está cerca de tu límite inferior y con tendencia a bajar." : "Baja, aunque todavía está en rango.",
        action: near ? "No entrenes en ayunas ni sin carbohidratos: come algo con carbohidratos antes de moverte." : "Vigílala; si vas a entrenar, ten carbohidratos a mano.",
      });
    } else if (g.value > g.high) {
      f.push({
        area: "glucosa", severity: 1,
        headline: `Glucosa alta: ${g.value} mg/dL ${g.arrow}`.trim(),
        detail: `Sobre tu umbral (${g.high}).`,
        action: "Evita azúcares y harinas rápidas por ahora; agua y una caminata suave de 10–15 min suelen ayudar. Si tienes síntomas o sigue alta, consulta con tu médico.",
      });
    } else {
      f.push({ area: "glucosa", severity: 0, headline: `Glucosa en rango: ${g.value} mg/dL ${g.arrow}`.trim(), detail: "Sin acciones necesarias por glucosa." });
    }
  }

  // 2) AGUA ────────────────────────────────────────────────
  const waterGoal = ctx.goals.hydrationL;
  let waterNeed = 0;
  if (waterGoal) {
    waterNeed = Math.max(0, round1(waterGoal - ctx.hydrationEffectiveL));
    const expectedNow = waterGoal * frac;
    const ratio = expectedNow > 0.2 ? ctx.hydrationEffectiveL / expectedNow : 1;
    if (hour >= 10 && ratio < 0.5) {
      f.push({ area: "agua", severity: hour >= 14 ? 2 : 1, headline: `Agua: ${cl1(ctx.hydrationEffectiveL)} L de ${cl1(waterGoal)} L`, detail: `A esta hora deberías ir por ~${round1(expectedNow)} L; vas en menos de la mitad.`, action: `Toma 500 ml ahora y reparte ~${Math.max(0.5, round1(waterNeed))} L hasta la noche.` });
    } else if (hour >= 10 && ratio < 0.75) {
      f.push({ area: "agua", severity: 1, headline: `Agua: ${cl1(ctx.hydrationEffectiveL)} L de ${cl1(waterGoal)} L`, detail: "Vas algo por debajo del ritmo del día.", action: "Toma un vaso grande (~350 ml) ahora." });
    } else {
      f.push({ area: "agua", severity: 0, headline: `Agua: ${cl1(ctx.hydrationEffectiveL)} L de ${cl1(waterGoal)} L`, detail: "Vas bien de ritmo." });
    }
    if (ctx.hydrationRawL - ctx.hydrationEffectiveL > 0.3) {
      f.push({ area: "datos", severity: 0, headline: "Parte de lo que bebiste cuenta menos", detail: `Registraste ${ctx.hydrationRawL} L pero solo ${ctx.hydrationEffectiveL} L hidratan de verdad (café, bebidas con azúcar y alcohol hidratan menos que el agua).` });
    }
  }

  // 3) SUEÑO ───────────────────────────────────────────────
  const baseSleep = ctx.diag?.all.find((m) => m.key === "sleepHours");
  if (ctx.sleepHours !== undefined) {
    const h = ctx.sleepHours;
    if (h < SLEEP_SHORT_H) {
      f.push({ area: "sueno", severity: h < 5 ? 2 : 1, headline: `Dormiste ${cl1(h)} h`, detail: `Menos de ${SLEEP_SHORT_H} h. Con poco sueño aumentan el hambre de azúcar y el cansancio, y baja el rendimiento.`, action: h < 5 ? "Hoy entrena suave o descansa, y acuéstate temprano." : "Baja un poco la intensidad si entrenas y evita cafeína pasadas las 15:00." });
    } else if (h < SLEEP_TARGET_H) {
      f.push({ area: "sueno", severity: 1, headline: `Dormiste ${cl1(h)} h`, detail: `Un poco bajo el mínimo recomendado (${SLEEP_TARGET_H}–9 h).`, action: "Intenta acostarte 30–45 min antes hoy." });
    } else {
      f.push({ area: "sueno", severity: 0, headline: `Dormiste ${cl1(h)} h`, detail: "Descanso suficiente." });
    }
    if (baseSleep?.flagged && baseSleep.expected && baseSleep.confidence !== "generic") {
      f.push({ area: "sueno", severity: 1, headline: "Dormiste menos de lo que sueles", detail: `Tu patrón es ~${round1(baseSleep.expected)} h.` });
    }
  }

  // 4) COMIDA ──────────────────────────────────────────────
  const G = ctx.goals;
  const needs = {
    kcal: Math.max(0, round0(G.kcal - ctx.eaten.kcal)),
    proteinG: G.protein ? Math.max(0, round0(G.protein - ctx.eaten.protein)) : 0,
    carbsG: Math.max(0, round0(G.carbs - ctx.eaten.carbs)),
    fatG: Math.max(0, round0(G.fat - ctx.eaten.fat)),
    waterL: waterNeed,
  };
  const hoursSinceMeal = ctx.lastMealAt ? (ctx.now.getTime() - ctx.lastMealAt.getTime()) / 3600000 : null;

  if (ctx.mealsToday === 0 && hour >= 11) {
    f.push({ area: "comida", severity: hour >= 14 ? 2 : 1, headline: "No hay comidas registradas hoy", detail: "O no has comido, o no lo has anotado; sin eso no puedo saber qué te falta.", action: "Cuéntame qué comiste o te propongo qué comer ahora." });
  } else {
    if (hoursSinceMeal !== null && hoursSinceMeal >= 5 && hour >= 9 && hour <= 22) {
      f.push({ area: "comida", severity: diabetic ? 2 : 1, headline: `Llevas ${round0(hoursSinceMeal)} h desde tu última comida registrada`, detail: diabetic ? "Con tu condición conviene no dejar tanto intervalo, sobre todo si vas a moverte." : "Puede que estés con poca energía.", action: "Haz una comida o colación con carbohidratos y proteína." });
    }
    const kcalRatio = G.kcal * frac > 0 ? ctx.eaten.kcal / (G.kcal * Math.max(frac, 0.15)) : 1;
    const detailParts = [`${cl0(ctx.eaten.kcal)} de ${cl0(G.kcal)} kcal`];
    if (G.protein) detailParts.push(`${cl0(ctx.eaten.protein)} de ${cl0(G.protein)} g de proteína`);
    const behind = hour >= 13 && kcalRatio < 0.6;
    // Ya pasó la meta: decirlo con calma (antes decía «te faltan ~0 kcal» y lo marcaba como «al día»: banco de pruebas 2026-10-16)
    const over = G.kcal > 0 ? ctx.eaten.kcal - G.kcal : 0;
    const detail = over > 0
      ? `Ya pasaste tu meta de hoy por ~${cl0(over)} kcal.${needs.proteinG > 0 ? ` De proteína te faltan ~${needs.proteinG} g.` : ""}`
      : needs.proteinG > 0 ? `Te faltan ~${needs.proteinG} g de proteína y ~${cl0(needs.kcal)} kcal para tu meta.` : `Te faltan ~${cl0(needs.kcal)} kcal para tu meta.`;
    f.push({
      area: "comida", severity: behind || over > G.kcal * 0.25 ? 1 : 0,
      headline: `Comida de hoy: ${detailParts.join(" · ")}`,
      detail,
      action: behind ? "Vas atrasado con la comida; haz la próxima con proteína y carbohidratos."
        : over > G.kcal * 0.25 ? "Lo que queda del día, liviano: verduras, proteína magra y agua. Sin culpa: mañana se parte de nuevo." : undefined,
    });
  }
  if (ctx.restrictions.cautions.length) {
    // Lo marcado IMPORTANTE (p. ej. keto + insulina) va primero y nunca se recorta
    const ordered = [...ctx.restrictions.cautions].sort((a, b) => Number(b.text.startsWith("IMPORTANTE")) - Number(a.text.startsWith("IMPORTANTE")));
    for (const c of ordered.slice(0, 5)) f.push({ area: "comida", severity: c.text.startsWith("IMPORTANTE") ? 2 : 0, headline: "Cuidado por tu condición", detail: c.text, tag: "caution" });
  }

  // 5) MOVIMIENTO ──────────────────────────────────────────
  if (ctx.steps !== undefined) {
    const expected = ctx.goals.steps * frac;
    const ratio = expected > 500 ? ctx.steps / expected : 1;
    if (ctx.trainedToday === true) {
      // Entrenó: los pasos no cuentan las pesas, el básquet ni la bici. No se le pide caminar.
      f.push({ area: "movimiento", severity: 0, headline: `${ctx.steps.toLocaleString("es-CL")} pasos de ${ctx.goals.steps.toLocaleString("es-CL")}`, detail: "Ya entrenaste hoy: los pasos no cuentan todo lo que te moviste." });
    } else if (hour >= 15 && ratio < 0.5) {
      f.push({ area: "movimiento", severity: 1, headline: `${ctx.steps.toLocaleString("es-CL")} pasos de ${ctx.goals.steps.toLocaleString("es-CL")}`, detail: "Vas por debajo de la mitad del ritmo del día.", action: `Una caminata de 20–30 min suma ~2.500–3.500 pasos${g && g.value > g.high ? " y además ayuda con la glucosa alta" : ""}.` });
    } else {
      f.push({ area: "movimiento", severity: 0, headline: `${ctx.steps.toLocaleString("es-CL")} pasos de ${ctx.goals.steps.toLocaleString("es-CL")}`, detail: ratio >= 1 ? "Vas al día o mejor." : "Ritmo aceptable." });
    }
  }
  if (ctx.trainedToday === true) f.push({
    area: "movimiento", severity: 0,
    headline: ctx.activityLabel && ctx.activityKcal ? `Ya entrenaste hoy: ${ctx.activityLabel}, ~${ctx.activityKcal.toLocaleString("es-CL")} kcal` : ctx.exerciseMinutes && ctx.exerciseMinutes >= 20 ? `Ya entrenaste hoy (${ctx.exerciseMinutes} min)` : "Ya entrenaste hoy",
    detail: `Prioriza proteína y reponer líquidos y carbohidratos${ctx.activityKcal ? "; tu meta de hoy ya suma ese gasto" : ""}.`,
  });

  // 6) ÁNIMO ───────────────────────────────────────────────
  const mood = ctx.diag?.all.find((m) => m.key === "moodScore");
  if (mood?.flagged && mood.confidence !== "generic") {
    f.push({ area: "animo", severity: 1, headline: "Tu ánimo está bajo tu patrón", detail: "No es un diagnóstico, es una señal: sueño, comida y movimiento suelen moverlo.", action: "Prioriza dormir bien, una comida completa y salir a caminar." });
  }

  // 7) DATOS (calidad) ─────────────────────────────────────
  for (const n of ctx.dataNotes) f.push({ area: "datos", severity: 0, headline: "Aviso sobre los datos", detail: n });

  f.sort((a, b) => b.severity - a.severity || AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area));
  return { findings: f, needs, hour };
}

// ─── Texto para el LLM ───────────────────────────────────────────────────────

const SEV_LABEL: Record<Severity, string> = { 0: "ok", 1: "atención", 2: "importante", 3: "URGENTE" };

export function formatAnalysis(ctx: MetabolicContext, a: Analysis, opts: { onlyAreas?: Area[]; maxOk?: number } = {}): string {
  const time = ctx.now.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  const lines: string[] = [`ANÁLISIS DE HOY (${time})`];
  const shown = a.findings.filter((x) => !opts.onlyAreas || opts.onlyAreas.includes(x.area) || x.severity >= 2);
  const attention = shown.filter((x) => x.severity > 0 && x.area !== "datos");
  const cautions = shown.filter((x) => x.tag === "caution" && x.severity === 0);
  const ok = shown.filter((x) => x.severity === 0 && x.area !== "datos" && x.tag !== "caution");
  const notes = shown.filter((x) => x.area === "datos");

  if (attention.length) {
    lines.push("", "Prioridades (de más a menos importante):");
    attention.forEach((x, i) => lines.push(`${i + 1}. [${SEV_LABEL[x.severity]}] ${x.headline} — ${x.detail}${x.action ? ` → ${x.action}` : ""}`));
  } else {
    lines.push("", "No hay nada urgente ahora.");
  }
  if (ok.length) {
    lines.push("", "Al día:");
    ok.slice(0, opts.maxOk ?? 6).forEach((x) => lines.push(`- ${x.headline}. ${x.detail}`));
  }
  if (cautions.length) {
    lines.push("", "Ten en cuenta por tu perfil médico:");
    cautions.forEach((x) => lines.push(`- ${x.detail}`));
  }
  if (notes.length) {
    lines.push("", "Calidad de los datos:");
    notes.forEach((x) => lines.push(`- ${x.detail}`));
  }
  return lines.join("\n");
}

/**
 * «¿Cómo voy hoy?» respondido POR CÓDIGO, al instante (2026-10-16). Con el modelo tardaba ~50 s (el prompt llenaba el contexto
 * y a veces había que repetir la pasada) y a veces se inventaba la glucosa. Lo más importante primero, con su acción; lo que va
 * bien en una línea. Mismo análisis que el asesor (analyze), solo que redactado acá.
 */
export function panoramaRapido(ctx: MetabolicContext, a: Analysis): string {
  const time = ctx.now.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  const att = a.findings.filter((x) => x.severity > 0 && x.area !== "datos");
  const ok = a.findings.filter((x) => x.severity === 0 && x.area !== "datos" && x.tag !== "caution");
  const notes = a.findings.filter((x) => x.area === "datos");
  const out: string[] = [`📊 Así vas hoy (${time})`];
  if (att.length) {
    const p = att[0];
    out.push("", `Lo más importante: ${p.headline}. ${p.detail}`);
    if (p.action) out.push(`👉 ${p.action}`);
    for (const x of att.slice(1, 3)) out.push(`• ${x.headline}: ${x.detail}${x.action ? ` ${x.action}` : ""}`);
  } else {
    out.push("", "✓ No hay nada urgente: vas bien.");
  }
  if (ok.length) out.push("", `✓ Al día: ${ok.slice(0, 4).map((x) => x.headline).join(" · ")}`);
  if (notes.length) out.push("", `ℹ️ ${notes[0].detail}`);
  out.push("", "[Opción: ¿Qué como ahora?] [Opción: Voy a entrenar]");
  return out.join("\n");
}
