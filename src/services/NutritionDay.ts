// ============================================================
// Eris — el día de comida de cada persona, en el servidor
//
// El día de comida termina cuando la persona se duerme, no a medianoche (ver MealSchedule.ts). El servidor lo calcula con
// lo que mandó el teléfono en el snapshot: el fin del sueño principal (`dayWakeTime`) y el despertar habitual
// (`schedule.usualWake`). Así la app y el servidor usan la misma clave de día para el registro de comidas y de agua.
// ============================================================

import { dayCtxFrom, nutritionDayKey, nutritionDayOf, isoDayKey, wakeHourFor, hourOf, fmtHour, slotAt, dayPhase, mealWindows, MEAL_NAME, MEAL_ORDER, type DayCtx } from "./MealSchedule.js";

type Mem = { get(k: string): Promise<any> };

/** Lo que se sabe del sueño de esta persona (del último snapshot del teléfono). */
export async function dayCtxOf(memory: Mem | null | undefined): Promise<DayCtx> {
  try { return memory ? dayCtxFrom(await memory.get("health_snapshot_latest")) : {}; } catch { return {}; }
}

/** La clave del día de comida de HOY ("Sat Oct 10 2026"): a las 2 AM sin haber dormido, sigue siendo el de ayer. */
export async function todayKeyOf(memory: Mem | null | undefined, now: Date = new Date()): Promise<string> {
  return nutritionDayKey(now, await dayCtxOf(memory));
}

/** El mismo día en el formato del historial diario ("2026-10-10"). */
export async function todayIsoOf(memory: Mem | null | undefined, now: Date = new Date()): Promise<string> {
  return isoDayKey(nutritionDayOf(now, await dayCtxOf(memory)));
}

/** La hora de despertar que arma el horario de hoy (la de hoy o la habitual). */
export async function wakeHourOf(memory: Mem | null | undefined, now: Date = new Date()): Promise<number | undefined> {
  return wakeHourFor(await dayCtxOf(memory), now);
}

/**
 * El reloj interno en una línea, para el contexto de Eris y Hestia (el mismo que ve la app en Inicio): cuándo despertó,
 * la hora de SU día, qué comida toca y cuándo duerme. Así hablan de "tu tarde" o "tu noche" y no de la hora del reloj.
 */
export function internalClockLine(snap: any, now: Date = new Date()): string | null {
  const ctx = dayCtxFrom(snap);
  const wake = wakeHourFor(ctx, now);
  if (wake == null) return null;
  const sh = snap?.schedule?.sleepHours;
  const awake = 24 - (typeof sh === "number" && sh >= 3 && sh <= 14 ? sh : 8);
  const rel = (((hourOf(now) - wake) % 24) + 24) % 24;
  const wa = ctx.wakeAt ? new Date(ctx.wakeAt) : null;
  const woke = !!wa && !Number.isNaN(wa.getTime()) && Math.abs(hourOf(wa) - wake) < 0.02;
  const hrs = (h: number) => { const m = Math.round(h * 60); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`; };
  const phase = dayPhase(now, wake, awake);
  const pct = Math.max(0, Math.min(100, Math.round((rel / awake) * 100)));
  // Las comidas principales que le quedan hoy (para que el modelo no concluya que "comió poco" con el día recién empezando)
  const win = mealWindows(wake);
  const relOf = (h: number) => (((h - wake) % 24) + 24) % 24;
  const left = MEAL_ORDER.filter((s) => s !== "colacion_am" && s !== "colacion_pm" && relOf(win[s][0]) > rel && relOf(win[s][0]) < awake).map((s) => MEAL_NAME[s]);
  return `- Su día: ${woke ? `despertó a las ${fmtHour(wake)} (hace ${hrs(rel)})` : `suele despertar a las ${fmtHour(wake)}`}, así que para su cuerpo es ${phase === "hora de dormir" ? "hora de dormir (ya pasó su hora habitual)" : `su ${phase}`}; va en el ${pct} % de su día despierto; comida que toca: ${MEAL_NAME[slotAt(now, { wakeHour: wake })]}${left.length ? `; le quedan: ${left.join(", ")}` : ""}; duerme cerca de las ${fmtHour(wake + awake)}. ` +
    `Lo que lleva comido y tomado es solo de este ${pct < 50 ? "comienzo de día" : "rato"}: NO digas que comió o tomó poco en el día ni lo trates como un problema; habla de su mañana, tarde o noche según esto, no según la hora del reloj.`;
}
