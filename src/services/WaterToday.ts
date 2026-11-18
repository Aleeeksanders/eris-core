// ============================================================
// Eris — el agua de HOY, una sola cuenta
//
// 2026-10-09, en 20 minutos: "0,5 L" (el análisis), "2,55 L de tu meta de 4 L" (¿cuánta agua llevo?) y "llevas 1 L"
// (el botón 💧 500 ml del chat). Cada camino sumaba distinto: solo lo anotado por chat, el mayor entre chat y teléfono,
// o lo que mandó la última pantalla. Y la meta salía de dos lados (4 L y 4,3 L).
//
// La cuenta: el total del teléfono (Health Connect: lo anotado a mano, lo de otras apps y lo del chat ya copiado, más lo
// del chat que el teléfono sumó aunque aún no lo copia) + lo anotado por chat que el teléfono todavía NO contó. El teléfono
// manda qué tomas del chat ya contó (`chatWaterCounted`); una app sin ese dato: las anotadas después de su lectura.
// La meta: siempre la de DailyTargets (la misma de Forge, Nutrición, Inicio y el chat).
//
// 2026-10-10: también el agua que trae la comida (una jalea es ~85 % agua; ver FoodWater.ts). La meta es de agua total.
// El historial diario (rollup) guarda solo lo BEBIDO (`drinksL`): los días anteriores no tienen el agua de la comida y la
// comparación con tu patrón tiene que ser pareja.
// ============================================================

//
// 2026-10-18, el usuario: «no mide en lo que llevamos del día, sino en base a la meta». A las 10:54 Eris le dijo «tu
// prioridad es reponer esos 3,5 litros que te faltan» (0,5 de 4 L): a esa hora lo esperable era ~1 L, o sea 2 vasos atrás.
// Ahora cada frase del agua dice primero cómo vas A ESTA HORA (trackGoal, la misma cuenta de los cuadros de Métricas) y la
// meta del día queda como referencia, repartida hasta la noche.

import { loadTargets } from "./DailyTargets.js";
import { foodWaterToday } from "./FoodWater.js";
import { dayCtxFrom, nutritionDayKey, wakeHourFrom } from "./MealSchedule.js";
import { trackGoal, type GoalTrack } from "./NutritionQualityCore.js";

export interface WaterToday {
  /** litros de hoy, todo junto: lo bebido + el agua de la comida */
  totalL: number;
  /** lo bebido (teléfono + chat) */
  drinksL: number;
  /** el agua que trae la comida anotada hoy */
  foodL: number;
  /** lo anotado por chat (botones 💧, "tomé 500 ml", el +250 ml de la notificación) */
  chatL: number;
  /** el total que mandó el teléfono, si es de hoy */
  phoneL: number | null;
  /** meta de hoy; null = sin meta (la define su médico) */
  goalL: number | null;
  /** "ya incluye el +30 % por tu medicamento", o vacío */
  goalNote: string;
  /** por qué no hay meta, si no la hay */
  offReason?: string;
  /** cómo va A ESTA HORA (lo esperable según las horas que lleva despierta), si hay meta */
  pace?: GoalTrack;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const eff = (e: any) => (typeof e?.effectiveLiters === "number" ? e.effectiveLiters : typeof e?.liters === "number" ? e.liters : 0);

/** Solo la suma (sin la meta): para el rollup y quien ya tenga las metas. `log`: el registro de agua de hoy si ya se tiene. */
export async function waterTotalToday(memory: { get(k: string): Promise<any> }, hydrationLog?: unknown): Promise<Omit<WaterToday, "goalL" | "goalNote">> {
  const snap = await memory.get("health_snapshot_latest").catch(() => null);
  // El día de COMIDA (termina al dormir, no a medianoche: services/MealSchedule.ts)
  const ctx = dayCtxFrom(snap);
  const day = nutritionDayKey(new Date(), ctx);
  const log = hydrationLog !== undefined ? hydrationLog : await memory.get(`hydration_log_${day}`).catch(() => []);
  const entries: any[] = Array.isArray(log) ? log : [];
  const chatL = round2(entries.reduce((a, e) => a + eff(e), 0));
  const foodL = await foodWaterToday(memory, snap).catch(() => 0);
  const at = snap?.lastUpdated ? new Date(snap.lastUpdated) : null;
  const phoneToday = !!at && !Number.isNaN(at.getTime()) && nutritionDayKey(at, ctx) === day && typeof snap?.hydration === "number" && Number.isFinite(snap.hydration);
  if (!phoneToday) return { totalL: round2(chatL + foodL), drinksL: chatL, foodL, chatL, phoneL: null };
  const counted = Array.isArray(snap.chatWaterCounted) ? new Set<string>(snap.chatWaterCounted.map(String)) : null;
  const pending = entries.filter((e) => (counted ? !counted.has(String(e?.timestamp)) : Date.parse(e?.timestamp) > at!.getTime()));
  // Nunca menos que lo anotado por chat: si el teléfono dice menos, todavía no se entera de todo (app sin la lista)
  const drinksL = round2(Math.max(chatL, snap.hydration + pending.reduce((a, e) => a + eff(e), 0)));
  return { totalL: round2(drinksL + foodL), drinksL, foodL, chatL, phoneL: snap.hydration };
}

export async function waterToday(memory: { get(k: string): Promise<any>; getProfile?(): Promise<any> }, now: Date = new Date()): Promise<WaterToday> {
  const sum = await waterTotalToday(memory);
  try {
    const t = await loadTargets(memory);
    if (t.waterL === null) return { ...sum, goalL: null, goalNote: "", offReason: t.sources.water.replace(/^sin meta: /, "") };
    const snap = await memory.get("health_snapshot_latest").catch(() => null);
    return {
      ...sum, goalL: t.waterL, goalNote: /SGLT2|medicamento/i.test(t.sources.water) ? "ya incluye el +30 % por tu medicamento" : "",
      pace: waterPace(sum.totalL, t.waterL, now, wakeHourFrom(snap, now)),
    };
  } catch {
    return { ...sum, goalL: null, goalNote: "" };
  }
}

/** Cómo va el agua A ESTA HORA: la misma cuenta que los cuadros de Métricas en la app (trackGoal). */
export function waterPace(totalL: number, goalL: number, now: Date, wakeHour?: number): GoalTrack {
  return trackGoal(totalL, goalL, { now, wakeHour, kind: "agua", unit: "L" });
}

/** Lo que falta para ir al día, en vasos de 250 ml (los mismos de trackGoal y los cuadros de Métricas): «2 vasos (~0,5 L)». */
export function catchUpText(p: GoalTrack): string {
  const n = p.vasos ?? Math.max(1, Math.ceil(p.toCatchUp / 0.25 - 1e-9));
  return `${n} vaso${n > 1 ? "s" : ""} (~${fmtLiters(n * 0.25)})`;
}

/**
 * Cómo va A ESTA HORA, en una frase (sin la cifra de lo que lleva): «a esta hora lo esperable es ~1,1 L, así que para ir
 * al día te faltan 2 vasos (~0,5 L); para la meta de 4 L quedan 3,5 L, repartidos hasta la noche».
 */
export function paceText(p: GoalTrack, goalL: number, totalL: number): string {
  const left = round2(goalL - totalL);
  const rest = left > 0 ? `para la meta de ${fmtLiters(goalL)} quedan ${fmtLiters(left)}, repartidos hasta la noche` : "";
  switch (p.state) {
    case "cumplida": return `meta del día (${fmtLiters(goalL)}) cumplida`;
    case "temprano": return `recién empieza tu día: la meta de ${fmtLiters(goalL)} se reparte hasta la noche`;
    case "adelantado": return `vas adelantado (a esta hora lo esperable es ~${fmtLiters(round1(p.expectedNow))}); ${rest}`;
    case "al_dia": return `vas al día (a esta hora lo esperable es ~${fmtLiters(round1(p.expectedNow))}); ${rest}`;
    default:
      return `a esta hora lo esperable es ~${fmtLiters(round1(p.expectedNow))}, así que para ir al día te faltan ${catchUpText(p)}; ${rest}`;
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** ", contando 0,3 L que trae la comida" (si es algo que valga mencionar) */
const foodPart = (w: { foodL?: number }) => ((w.foodL ?? 0) >= 0.05 ? `, contando ${fmtLiters(w.foodL!)} que trae la comida` : "");

/** "2,55 L" */
export const fmtLiters = (n: number) => `${round2(n).toLocaleString("es-CL")} L`;

/**
 * «Hoy llevas 0,5 L: a esta hora lo esperable es ~1,1 L, así que para ir al día te faltan 2 vasos (~0,5 L); para la meta
 * de 4 L quedan 3,5 L, repartidos hasta la noche.» — la misma frase en todos lados. Primero cómo va A ESTA HORA.
 */
export function waterLine(w: WaterToday): string {
  // Sin meta (enfermedad renal): se informa lo tomado, sin empujar a tomar más
  if (w.goalL === null) return `Hoy llevas ${fmtLiters(w.totalL)}${foodPart(w)}.${w.offReason ? ` No te fijo meta de agua: ${w.offReason}.` : ""}`;
  if (w.pace) {
    const txt = paceText(w.pace, w.goalL, w.totalL);
    // («de agua»: en la llamada, después de cambiar de tema, «Hoy llevas 0,25 L» solo no decía de qué; banco «voz-cambia-tema»)
    return `Hoy llevas ${fmtLiters(w.totalL)} de agua${foodPart(w)}: ${txt}.${w.pace.state === "cumplida" ? " ¡Bien!" : ""}`;
  }
  const left = round2(w.goalL - w.totalL);
  return `Hoy llevas ${fmtLiters(w.totalL)} de tu meta de ${fmtLiters(w.goalL)}${foodPart(w)}` +
    (left > 0 ? ` (te faltan ${fmtLiters(left)}).` : ". ¡Meta cumplida!");
}
