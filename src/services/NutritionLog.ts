// ============================================================
// Eris — NutritionLog
//
// Lógica pura del registro de comidas del día (nutrition_log_<día>) y de su vista para el móvil.
// Vive aparte del servidor para poder probarla sin WebSocket ni disco.
// ============================================================

import { waterTotalToday } from "./WaterToday.js";
import { dayCtxFrom, nutritionDayKey, nutritionDayOf, isoDayKey } from "./MealSchedule.js";

export interface LogItem { name: string; grams: number; calories: number; protein: number; carbs: number; fat: number; fiber: number }
export interface LogEntry {
  timestamp: string;
  mealType?: string;
  items: LogItem[];
  totals: { calories: number; protein: number; carbs: number; fat: number; fiber?: number };
  /** Anotado a mano en el teléfono (no por chat): Eris lo ve, pero vive en la app. */
  fromPhone?: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Formato de `Date.toDateString()` ("Mon Sep 21 2026"): es la clave del día en memoria; se valida antes de usarla como parte de una clave. */
export const DAY_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2} \d{4}$/;
export function isValidDay(s: unknown): s is string {
  if (typeof s !== "string" || !DAY_RE.test(s)) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t) && t <= Date.now() + 86_400_000; // no días futuros
}

export function totalsOf(items: LogItem[]): LogEntry["totals"] {
  return items.reduce(
    (a, i) => ({
      calories: a.calories + (i.calories || 0),
      protein: r1(a.protein + (i.protein || 0)),
      carbs: r1(a.carbs + (i.carbs || 0)),
      fat: r1(a.fat + (i.fat || 0)),
      fiber: r1((a.fiber ?? 0) + (i.fiber || 0)),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
  );
}

/**
 * Quita UN ítem (por instante de la comida + nombre + gramos) del registro. Si la comida se queda sin ítems, se elimina
 * completa; si le quedan, se recalculan sus totales. Devuelve el mismo arreglo si no encontró nada.
 */
export function removeItem(
  log: unknown,
  target: { timestamp: string; name: string; grams: number },
): { log: LogEntry[]; removed: LogItem | null } {
  const entries: LogEntry[] = Array.isArray(log) ? (log as LogEntry[]) : [];
  const ei = entries.findIndex((e) => e?.timestamp === target.timestamp && Array.isArray(e.items) &&
    e.items.some((i) => norm(i.name) === norm(target.name) && Math.abs((i.grams ?? 0) - target.grams) < 0.05));
  if (ei < 0) return { log: entries, removed: null };

  const entry = entries[ei];
  const ii = entry.items.findIndex((i) => norm(i.name) === norm(target.name) && Math.abs((i.grams ?? 0) - target.grams) < 0.05);
  const removed = entry.items[ii];
  const items = entry.items.filter((_, k) => k !== ii);
  const next = entries.slice();
  if (items.length === 0) next.splice(ei, 1);
  else next[ei] = { ...entry, items, totals: totalsOf(items) };
  return { log: next, removed };
}

// ─── Lo registrado en el teléfono ─────────────────────────────────
// El servidor solo guardaba lo anotado por CHAT; lo que el usuario anotaba a mano en Nutrición (búsqueda, código de
// barras) le llegaba a Eris como un total suelto, sin alimentos. "¿Qué he comido hoy?" respondía "nada" aunque hubiera
// tres comidas en la app. Ahora el teléfono manda su lista del día (`foodLog` en el snapshot) y acá se junta con lo del chat.

/**
 * Los valores por 100 g con que el teléfono calcula la calidad (nutritionQualityCore), desde la app 1.42.0. Con ellos el chat
 * («¿y si me como…?», WhatIfFood) parte del mismo día que la tarjeta de la app y da la misma nota.
 */
export interface PhoneFoodQ {
  kcal: number; protein: number; carbs: number; fat: number; fiber: number;
  sugar?: number; sodium?: number; satFat?: number; nova?: number; nutriscore?: string; group?: string;
  /** vitaminas y minerales por 100 g (app 1.60, fase I6): los que trae el envase (Open Food Facts) */
  micros?: Record<string, number>;
}
/** Un alimento del registro del teléfono. */
export interface PhoneFoodItem { t: string; meal?: string; name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number; fiber?: number; q?: PhoneFoodQ }
export interface PhoneFoodLog { date: string; items: PhoneFoodItem[] }

/** Identidad de un alimento registrado: instante de la comida + nombre + gramos (la misma que usa el teléfono). */
export const itemKey = (timestamp: string, name: string, grams: number) => `${timestamp}_${norm(name)}_${Math.round((grams || 0) * 10) / 10}`;

const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : null);

/** `q` validado: por 100 g nada puede pasar de lo físicamente posible (900 kcal, 100 g); si falta lo básico, no sirve. */
function sanitizeQ(raw: unknown): PhoneFoodQ | undefined {
  const q = raw as any;
  if (!q || typeof q !== "object") return undefined;
  const kcal = num(q.kcal, 900), protein = num(q.protein, 100), carbs = num(q.carbs, 100), fat = num(q.fat, 100), fiber = num(q.fiber, 100);
  if (kcal === null || protein === null || carbs === null || fat === null) return undefined;
  const out: PhoneFoodQ = { kcal, protein, carbs, fat, fiber: fiber ?? 0 };
  const sugar = num(q.sugar, 100), sodium = num(q.sodium, 40000), satFat = num(q.satFat, 100), nova = num(q.nova, 4);
  if (sugar !== null) out.sugar = sugar;
  if (sodium !== null) out.sodium = sodium;
  if (satFat !== null) out.satFat = satFat;
  if (nova !== null && Number.isInteger(nova) && nova >= 1) out.nova = nova;
  if (typeof q.nutriscore === "string" && /^[a-e]$/i.test(q.nutriscore)) out.nutriscore = q.nutriscore.toLowerCase();
  if (typeof q.group === "string" && /^[a-z_]{2,30}$/.test(q.group)) out.group = q.group;
  if (q.micros && typeof q.micros === "object") {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(q.micros).slice(0, 20)) { const n = num(v, 50000); if (/^[a-z0-9]{1,4}$/i.test(k) && n !== null) m[k] = n; }
    if (Object.keys(m).length) out.micros = m;
  }
  return out;
}

/** Valida lo que manda el teléfono (es entrada externa): tipos, rangos y tamaño. Null si no sirve. */
export function sanitizePhoneFoodLog(raw: unknown): PhoneFoodLog | null {
  const r = raw as any;
  if (!r || typeof r !== "object" || !isValidDay(r.date) || !Array.isArray(r.items)) return null;
  const items: PhoneFoodItem[] = [];
  for (const i of r.items.slice(0, 200)) {
    if (!i || typeof i !== "object" || typeof i.name !== "string" || !i.name.trim() || typeof i.t !== "string" || Number.isNaN(Date.parse(i.t))) continue;
    const grams = num(i.grams, 5000), kcal = num(i.kcal, 10000);
    if (grams === null || kcal === null) continue;
    const q = sanitizeQ(i.q);
    items.push({
      t: i.t.slice(0, 40), meal: typeof i.meal === "string" ? i.meal.slice(0, 40) : undefined, name: i.name.trim().slice(0, 120),
      grams, kcal: Math.round(kcal), protein: r1(num(i.protein, 1000) ?? 0), carbs: r1(num(i.carbs, 2000) ?? 0),
      fat: r1(num(i.fat, 1000) ?? 0), fiber: r1(num(i.fiber, 500) ?? 0), ...(q ? { q } : {}),
    });
  }
  return { date: r.date, items };
}

/**
 * El día completo: lo anotado por chat + lo que SOLO está en el teléfono. Lo que el teléfono copió del chat tiene la misma
 * identidad (no se cuenta dos veces) y lo borrado hoy por chat no revive aunque la lista del teléfono sea anterior al borrado.
 */
export function dayEntries(chatLog: unknown, phone: unknown, day: string, deleted?: unknown): { entries: LogEntry[]; phoneOnly: number } {
  const gone = new Set(Array.isArray(deleted) ? deleted.map(String) : []);
  const chat: LogEntry[] = (Array.isArray(chatLog) ? (chatLog as LogEntry[]) : []).filter((e) => e && Array.isArray(e.items));
  const p = phone as PhoneFoodLog | null | undefined;
  if (!p || p.date !== day || !Array.isArray(p.items)) return { entries: chat, phoneOnly: 0 };
  const have = new Set<string>();
  for (const e of chat) for (const i of e.items) have.add(itemKey(e.timestamp, i.name, i.grams));
  const extra = new Map<string, LogEntry>();
  let phoneOnly = 0;
  for (const i of p.items) {
    const k = itemKey(i.t, i.name, i.grams);
    if (have.has(k) || gone.has(k)) continue;
    have.add(k);
    phoneOnly++;
    const g = `${i.t}_${i.meal ?? ""}`;
    const e = extra.get(g) ?? { timestamp: i.t, mealType: i.meal, items: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 } };
    e.items.push({ name: i.name, grams: i.grams, calories: i.kcal, protein: i.protein, carbs: i.carbs, fat: i.fat, fiber: i.fiber ?? 0 });
    extra.set(g, e);
  }
  const merged = [...chat, ...[...extra.values()].map((e) => ({ ...e, totals: totalsOf(e.items), fromPhone: true }))];
  merged.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return { entries: merged, phoneOnly };
}

/** Totales de un conjunto de comidas. */
export function dayTotals(entries: LogEntry[]): Required<LogEntry["totals"]> {
  return totalsOf(entries.flatMap((e) => e.items ?? [])) as Required<LogEntry["totals"]>;
}

// ─── Metas nutricionales ──────────────────────────────────────────
// Rangos amplios pero acotados: una meta absurda (error de tipeo, del modelo, o de la app) no debe guiar
// recomendaciones. Compartido entre el chat (NutritionTool.set_nutritional_goals) y la app (server.ts,
// set_nutrition_goals por WS) para que ambos caminos validen exactamente igual.
export const GOAL_RANGES: Record<string, [number, number, string]> = {
  calories: [800, 6000, "kcal"], protein: [20, 400, "g de proteína"], carbs: [20, 800, "g de carbohidratos"],
  fat: [10, 300, "g de grasa"], waterLiters: [0.5, 6, "L de agua"],
};

/** Valida y combina metas nuevas con las actuales. No persiste nada: quien llama decide si guardar `next`. */
export function applyGoalUpdate(
  current: Record<string, number>,
  goals: Record<string, unknown>,
): { next: Record<string, number>; saved: string[]; rejected: string[] } {
  const next: Record<string, number> = { ...current };
  const rejected: string[] = [];
  const saved: string[] = [];
  for (const [k, v] of Object.entries(goals)) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const [lo, hi, label] = GOAL_RANGES[k] ?? [0, Infinity, k];
    if (!(v >= lo && v <= hi)) { rejected.push(`${v} ${label} (fuera de un rango razonable ${lo}–${hi})`); continue; }
    next[k] = v; saved.push(`${v} ${label}`);
  }
  return { next, saved, rejected };
}

export interface WaterEntry { timestamp: string; liters?: number; effectiveLiters?: number }

/** Lo que el móvil necesita del día: comidas, total de agua efectiva y cada toma de agua (para no sumarlas dos veces). */
export function todayPayload(nutritionLog: unknown, hydrationLog: unknown) {
  const hyd: WaterEntry[] = Array.isArray(hydrationLog) ? (hydrationLog as WaterEntry[]) : [];
  const eff = (e: WaterEntry) => e.effectiveLiters ?? e.liters ?? 0;
  return {
    entries: Array.isArray(nutritionLog) ? (nutritionLog as LogEntry[]) : [],
    waterLiters: Math.round(hyd.reduce((s, e) => s + eff(e), 0) * 100) / 100,
    waterEntries: hyd.map((e) => ({ timestamp: e.timestamp, liters: eff(e) })),
  };
}

/**
 * Lo que `memory.upsertDailyRollup()` necesita para que el motor de baselines (BaselineEngine, tarjeta "Análisis
 * del Día") vea lo registrado HOY — antes esto solo pasaba si la app mandaba `update_health_snapshot` (Nutrición
 * abierta); lo registrado por chat quedaba fuera del rollup y el día parecía vacío aunque hubiera datos reales.
 */
export function rollupFieldsOf(nutritionLog: unknown, hydrationLog: unknown): {
  hydrationL: number; proteinG: number; carbsG: number; fatG: number; calories: number;
} {
  const { entries, waterLiters } = todayPayload(nutritionLog, hydrationLog);
  const t = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + (e.totals?.calories || 0),
      protein: acc.protein + (e.totals?.protein || 0),
      carbs: acc.carbs + (e.totals?.carbs || 0),
      fat: acc.fat + (e.totals?.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  return { hydrationL: waterLiters, proteinG: r1(t.protein), carbsG: r1(t.carbs), fatG: r1(t.fat), calories: Math.round(t.calories) };
}

/**
 * El resumen del día (rollup, lo que lee "Análisis del Día") tiene dos fuentes: el teléfono, que manda el total completo
 * (Health Connect + lo del chat), y los registros del chat, que solo conocen lo anotado conversando. Antes ganaba la
 * última en escribir: después de un registro por chat, el análisis veía solo lo del chat y creía que habías comido menos.
 * Ahora lo del chat se combina con el último total del teléfono de HOY (el mayor por campo). Un borrado baja el total
 * cuando el teléfono manda el suyo, que se guarda tal cual.
 */
export async function upsertChatRollup(
  memory: { get(key: string): Promise<any>; upsertDailyRollup(partial: Record<string, unknown>, date?: string): Promise<void> },
  nutritionLog: unknown,
  hydrationLog: unknown,
): Promise<void> {
  const chat = rollupFieldsOf(nutritionLog, hydrationLog);
  let phone: Partial<Record<keyof typeof chat, unknown>> = {};
  let ctx = {};
  try {
    const snap = await memory.get("health_snapshot_latest");
    ctx = dayCtxFrom(snap);
    const at = snap?.lastUpdated ? new Date(snap.lastUpdated) : null;
    // El total del teléfono sirve si es de este mismo día de comida
    if (at && !Number.isNaN(at.getTime()) && nutritionDayKey(at, ctx) === nutritionDayKey(new Date(), ctx)) {
      phone = { hydrationL: snap.hydration, proteinG: snap.nutrition?.protein, carbsG: snap.nutrition?.carbs, fatG: snap.nutrition?.fat, calories: snap.nutrition?.calories };
    }
  } catch {}
  const pick = (a: number, b: unknown) => (typeof b === "number" && Number.isFinite(b) && b > a ? b : a);
  // El agua con la cuenta única (services/WaterToday.ts); sin ella, el mayor de los dos como antes
  const water = await waterTotalToday(memory, hydrationLog).catch(() => null);
  await memory.upsertDailyRollup({
    hydrationL: water ? water.drinksL : pick(chat.hydrationL, phone.hydrationL),
    proteinG: pick(chat.proteinG, phone.proteinG),
    carbsG: pick(chat.carbsG, phone.carbsG),
    fatG: pick(chat.fatG, phone.fatG),
    calories: pick(chat.calories, phone.calories),
  }, isoDayKey(nutritionDayOf(new Date(), ctx)));
}

/**
 * Lo anotado por chat para un día anterior («ayer cené…»): se SUMA a lo que ese día ya tenía el historial (el total del
 * teléfono de ese día no incluía esta comida). Sin día en el historial, queda solo esto.
 */
export async function addToPastRollup(
  memory: { getDailyRollupLog?(limitDays?: number): Promise<Array<Record<string, any>>>; upsertDailyRollup(partial: Record<string, unknown>, date?: string): Promise<void> },
  day: Date,
  totals: { calories: number; protein: number; carbs: number; fat: number },
): Promise<void> {
  const date = isoDayKey(day);
  const prev = (await memory.getDailyRollupLog?.(30).catch(() => []))?.find((e) => e.date === date) ?? {};
  const add = (k: string, v: number, dec = 1) => {
    const base = typeof prev[k] === "number" && Number.isFinite(prev[k]) ? prev[k] : 0;
    return Math.round((base + v) * 10 ** dec) / 10 ** dec;
  };
  await memory.upsertDailyRollup({
    calories: add("calories", totals.calories, 0),
    proteinG: add("proteinG", totals.protein),
    carbsG: add("carbsG", totals.carbs),
    fatG: add("fatG", totals.fat),
  }, date);
}
