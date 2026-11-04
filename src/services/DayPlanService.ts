// ============================================================
// Eris — el plan del día guardado y sus acciones (Eris al timón · T1, 2026-10-29)
//
// Lo comparten el chat (DayPlanTool) y la app (WS `day_plan_request` → `day_plan`): los 3 caminos de hoy, armar y guardar
// el plan, otra opción para una comida, borrarlo y marcar un paso como hecho. «Lo comí» anota la comida del plan tal cual
// (saveNutritionEntry, el mismo camino que el chat: el teléfono la agrega a Nutrición y el Inventario la descuenta).
// ============================================================

import { gatherDayPlanInput, buildDayPlan, swapMeal, MODES, MODE_NAME, parseMente, rendimientoDestacado, resumenesDe, type DayPlan, type PlanMode, type PlanStep, type PhoneAte, type Mente } from "./DayPlan.js";
import { getFeatures } from "./Features.js";
import { MEAL_NAME, isoDayKey } from "./MealSchedule.js";
import { parseNota, type Ajustes } from "./DayPlan.js";
import { readNotaLLM, type NotaLLM } from "./DayPlanNota.js";
import { todayIsoOf } from "./NutritionDay.js";
import { nutritionDayKey, dayCtxFrom } from "./MealSchedule.js";
import { saveNutritionEntry, type NutritionEntry } from "../tools/NutritionTool.js";
import { gatherMindSignals, type MindCheckin, type PulseSignal } from "./MindSignals.js";
export type { MindCheckin };

export const planKey = (day: string) => `day_plan_${day}`;

export async function loadPlan(memory: any, now: Date = new Date()): Promise<DayPlan | null> {
  const day = await todayIsoOf(memory, now).catch(() => null);
  if (!day) return null;
  const p = await memory.get(planKey(day)).catch(() => null);
  return p && Array.isArray(p.pasos) ? p : null;
}
export async function savePlan(memory: any, plan: DayPlan): Promise<void> {
  await memory.set(planKey(plan.day), plan).catch(() => {});
}

/**
 * ⚡ Modo Rendimiento: empuja contra el cansancio, así que primero solo Ikaros; el público, cuando se encienda en el panel
 * de administración (features.json), después de la prueba con gente.
 */
export async function rendimientoOk(role?: string | null): Promise<boolean> {
  return role === "ikaros" || (await getFeatures().catch(() => null))?.rendimiento === true;
}

/** Los 3 caminos de hoy (y el día exigente, si lo tiene), con su resumen (la hoja de la app y el chat) */
export async function previewPlans(memory: any, now: Date = new Date(), o: { rendimiento?: boolean } = {}): Promise<Array<{ mode: PlanMode; nombre: string; resumen: string; destacar?: boolean; pista?: string }>> {
  const i = await gatherDayPlanInput(memory, now);
  const planes = MODES.map((m) => buildDayPlan(i, m)), res = resumenesDe(i, planes);
  const out: Array<{ mode: PlanMode; nombre: string; resumen: string; destacar?: boolean; pista?: string }> = planes.map((p, k) => ({ mode: p.mode, nombre: MODE_NAME[p.mode], resumen: res[k] }));
  if (o.rendimiento) {
    const r = buildDayPlan(i, "rendimiento");
    const pista = rendimientoPista(i.pulso ?? null, i.usesRendimiento7d ?? 0);
    out.push({ mode: "rendimiento", nombre: MODE_NAME.rendimiento, resumen: r.resumen, destacar: rendimientoDestacado(i, r), ...(pista ? { pista } : {}) });
  }
  return out;
}

/** R2: lo que conviene saber antes de elegir el día exigente (el pulso alto, los días exigentes de la semana) */
export function rendimientoPista(pulso: PulseSignal | null, usos7: number): string | null {
  const bits: string[] = [];
  if (pulso?.alto) bits.push(`Tu pulso en reposo viene más alto que tu promedio (${pulso.hoy} vs ${pulso.base}): si igual tienes que rendir, lo armo con un café menos.`);
  if (usos7 >= 2) bits.push(`Esta semana ya llevas ${usos7} días exigentes.`);
  return bits.length ? bits.join(" ") : null;
}

/** El camino de todos los días (el del piloto automático): después de un día exigente, nunca Estricto (toca recuperar) */
export async function dailyMode(memory: any, now: Date = new Date()): Promise<PlanMode> {
  const m: PlanMode = (await memory.get("day_plan_mode").catch(() => null)) ?? "optimo";
  const mode: PlanMode = MODES.includes(m) ? m : "optimo";
  if (mode !== "estricto") return mode;
  const ayer = new Date(now); ayer.setDate(ayer.getDate() - 1);
  const log: Array<{ day: string; mode: string }> = (await memory.get("day_plan_log").catch(() => null)) || [];
  return log.some((x) => x?.day === isoDayKey(ayer) && x.mode === "rendimiento") ? "optimo" : mode;
}

/**
 * Arma el plan con un camino (y su nota) y lo guarda. Lo ya hecho hoy se conserva (y se ve con su ✓): las comidas anotadas
 * con «Lo comí» ya no se vuelven a armar, porque el día nuevo parte de lo que ya comió.
 */
export async function buildPlan(memory: any, mode: PlanMode, nota?: string | null, now: Date = new Date(), phone?: PhoneAte | null, llm?: NotaLLM | null, mente?: Mente | null): Promise<DayPlan> {
  const i = await gatherDayPlanInput(memory, now, phone);
  const prev: DayPlan | null = await memory.get(planKey(i.day)).catch(() => null);
  // Rendimiento: el check-in nuevo, o el que ya dio hoy (al rearmar el día no se pierde)
  const m = mode === "rendimiento" ? (mente ?? parseMente(nota) ?? (prev?.mode === "rendimiento" ? prev.mente ?? null : null)) : null;
  // «Otro» que el código no entiende: el modelo solo llena el esquema de ajustes; el plan lo arma el código igual
  let forced: Ajustes | null = null;
  if (nota && llm && !parseNota(nota).leida && !(mode === "rendimiento" && parseMente(nota))) forced = await readNotaLLM(llm, nota).catch(() => null);
  const built = buildDayPlan(i, mode, nota, forced, m);
  // El borrador de anoche (piloto automático): sus comidas quedan (los avisos ya las anunciaron); lo demás se arma con lo de hoy
  const plan = prev?.borrador ? keepDraftMeals(built, prev) : built;
  const hechos = (prev?.pasos ?? []).filter((p) => p.hecho);
  const ids = new Set(hechos.map((p) => p.id));
  const pasos = [...plan.pasos.filter((p) => !(ids.has(p.id) && p.modulo === "comida")).map((p) => (ids.has(p.id) ? { ...p, hecho: true } : p)),
    ...hechos.filter((h) => h.modulo === "comida" || !plan.pasos.some((p) => p.id === h.id))]
    .sort((a, b) => (a.hora == null ? -1 : a.hora) - (b.hora == null ? -1 : b.hora));
  const next: DayPlan = { ...plan, pasos };
  delete next.borrador;
  await savePlan(memory, next);
  // El día exigente no es «el camino de siempre»: el piloto automático sigue con el de todos los días
  if (mode !== "rendimiento") await memory.set("day_plan_mode", mode).catch(() => {});
  await logDay(memory, next.day, mode);
  if (m && JSON.stringify(m) !== JSON.stringify(prev?.mente ?? null)) await saveCheckin(memory, next.day, m, now, i.pulso ?? null, i.lastSleep?.totalH ?? null);
  return next;
}

/** La historia de caminos (uno por día, el último que eligió): para el tope de frecuencia del día exigente */
async function logDay(memory: any, day: string, mode: PlanMode): Promise<void> {
  const log: Array<{ day: string; mode: string }> = (await memory.get("day_plan_log").catch(() => null)) || [];
  const next = [...log.filter((x) => x?.day !== day), { day, mode }].sort((a, b) => a.day.localeCompare(b.day)).slice(-60);
  await memory.set("day_plan_log", next).catch(() => {});
}

/**
 * El check-in de mente (estrés, foco, qué pide el día) como historia para el futuro módulo mental, con lo del cuerpo de ese
 * día: el pulso en reposo y su promedio de 4 semanas (R2: services/MindSignals.ts) y lo que durmió. No se muestra como
 * puntaje ni se juzga.
 */
async function saveCheckin(memory: any, day: string, m: Mente, now: Date, pulso: PulseSignal | null, sleepH: number | null): Promise<void> {
  const snap = await memory.get("health_snapshot_latest").catch(() => null);
  const hr = pulso?.hoy ?? Number(snap?.heartRate?.resting);
  const row: MindCheckin = { at: now.toISOString(), day, ...m, ...(hr > 25 && hr < 150 ? { restingHR: Math.round(hr) } : {}),
    ...(pulso ? { rhrBase: pulso.base } : {}), ...(typeof sleepH === "number" && sleepH > 0 ? { sleepH: Math.round(sleepH * 10) / 10 } : {}) };
  const list: MindCheckin[] = (await memory.get("mind_checkins").catch(() => null)) || [];
  await memory.set("mind_checkins", [...list, row].slice(-200)).catch(() => {});
}

/** Las comidas del borrador de anoche que siguen pendientes reemplazan a las recién armadas (mismo id = misma comida) */
function keepDraftMeals(plan: DayPlan, draft: DayPlan): DayPlan {
  const del = new Map(draft.pasos.filter((p) => p.accion.type === "log_food").map((p) => [p.id, p]));
  return { ...plan, pasos: plan.pasos.map((p) => (p.accion.type === "log_food" && del.has(p.id) ? { ...del.get(p.id)!, hora: p.hora ?? del.get(p.id)!.hora } : p)) };
}

// ─── Piloto automático («que Eris arme mi día cada mañana», T3) ───────────────

export interface AutoPilot { on: boolean; at?: string }
export async function getAuto(memory: any): Promise<AutoPilot> {
  const a = await memory.get("day_plan_auto").catch(() => null);
  return { on: !!a?.on, ...(a?.at ? { at: a.at } : {}) };
}
export async function setAuto(memory: any, on: boolean): Promise<AutoPilot> {
  const a = { on, at: new Date().toISOString() };
  await memory.set("day_plan_auto", a).catch(() => {});
  return a;
}

/**
 * El plan de MAÑANA, armado en la noche: las comidas del día completo (para que los avisos de la mañana ya traigan el menú,
 * con «Lo comí ✓»), el tope y el sueño. El entreno se confirma en la mañana con cómo durmió y su rutina de ese día.
 */
export async function buildDraftTomorrow(memory: any, now: Date = new Date()): Promise<DayPlan | null> {
  const manana0 = new Date(now); manana0.setDate(manana0.getDate() + 1);
  const mode = await dailyMode(memory, manana0);
  const snap = await memory.get("health_snapshot_latest").catch(() => null);
  const wake = typeof snap?.schedule?.usualWake === "number" ? snap.schedule.usualWake : 7.5;
  const manana = new Date(now); manana.setDate(manana.getDate() + 1); manana.setHours(Math.floor(wake), Math.round((wake % 1) * 60), 0, 0);
  const key = planKey(isoDayKey(manana));
  if (await memory.get(key).catch(() => null)) return null;
  const i = await gatherDayPlanInput(memory, manana);
  const draft = buildDayPlan({ ...i, training: null, intent: null, ready: null, ctx: { ...i.ctx, eaten: { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 } } }, mode);
  const pasos = draft.pasos.map((p) => (p.modulo === "entreno"
    ? { ...p, hora: null, titulo: "🏋️ El entreno de mañana", detalle: "Lo confirmo en la mañana, según cómo duermas y lo que toque en tu rutina.", accion: { type: "info" as const } }
    : p));
  const out: DayPlan = { ...draft, day: isoDayKey(manana), pasos, borrador: true };
  await memory.set(key, out).catch(() => {});
  return out;
}

/**
 * Con el piloto automático: al despertar (o desde las 9) arma el día de hoy con el último camino (y lo aplica en el teléfono);
 * desde las 19 deja listo el borrador de mañana. Se llama cada vez que el teléfono manda sus datos; hace algo una vez.
 */
export async function autoTick(memory: any, wsClient: any, now: Date = new Date()): Promise<"hoy" | "manana" | null> {
  const auto = await getAuto(memory);
  if (!auto.on) return null;
  const mode = await dailyMode(memory, now);
  const h = now.getHours() + now.getMinutes() / 60;
  const snap = await memory.get("health_snapshot_latest").catch(() => null);
  const woke = snap?.dayWakeTime && new Date(snap.dayWakeTime).toDateString() === now.toDateString() && Date.parse(snap.dayWakeTime) <= now.getTime();
  const hoy = await loadPlan(memory, now);
  if ((!hoy || hoy.borrador) && (woke || h >= 9) && h < 22) {
    const plan = { ...(await buildPlan(memory, mode, null, now)), auto: true };
    await savePlan(memory, plan);
    pushPlan(wsClient, plan, { aplicar: true });
    return "hoy";
  }
  if (h >= 19) {
    const draft = await buildDraftTomorrow(memory, now);
    if (draft) { try { wsClient?.send(JSON.stringify({ type: "day_plan_manana", plan: draft })); } catch {} return "manana"; }
  }
  return null;
}

/**
 * Comió otra cosa en una comida del plan (por chat o anotado en la app): se rearma lo que queda del día con lo que ya comió,
 * en el mismo camino. Lo que sobró de esa comida se compensa solo en las que quedan (la contrapartida).
 */
export async function replan(memory: any, wsClient: any, phone?: PhoneAte | null, now: Date = new Date()): Promise<DayPlan | null> {
  const plan = await loadPlan(memory, now);
  if (!plan) return null;
  const otras = plan.pasos.filter((p) => p.accion.type === "log_food" && !p.hecho && (phone?.slots ?? []).includes(p.accion.slot)).map((p) => (p.accion as any).slot as string);
  const next = await buildPlan(memory, plan.mode, plan.nota, now, phone);
  if (otras.length) {
    const txt = `Comiste otra cosa en ${otras.map((s) => `${s === "almuerzo" || s === "desayuno" ? "el" : "la"} ${MEAL_NAME[s] ?? s}`).join(" y ")}: rearmé lo que queda del día.`;
    next.notas = [...(next.notas ?? []).filter((n) => !/^Comiste otra cosa/.test(n)), txt];
    await savePlan(memory, next);
  }
  pushPlan(wsClient, next);
  return next;
}

/** Desde el chat: anotó una comida que el plan tenía pendiente → se rearma el resto (si no venía del plan) */
export async function replanAfterMeal(memory: any, wsClient: any, slot: string, now: Date = new Date()): Promise<DayPlan | null> {
  const plan = await loadPlan(memory, now).catch(() => null);
  if (!plan || !plan.pasos.some((p) => p.accion.type === "log_food" && !p.hecho && p.accion.slot === slot)) return null;
  return replan(memory, wsClient, { slots: [slot] }, now);
}

/**
 * Comió algo que el plan no tenía (una cena cuando el plan terminaba en la once, una colación extra) y todavía quedan
 * comidas del plan: lo que queda se rearma con lo que ya comió, que si no se pasaría del día (banco de chat 2026-11-04,
 * «t-otra-cosa»: un completo de 546 kcal en la cena y la once del plan seguía igual).
 */
export async function replanExtraMeal(memory: any, wsClient: any, slot: string, now: Date = new Date()): Promise<DayPlan | null> {
  const plan = await loadPlan(memory, now).catch(() => null);
  if (!plan || plan.pasos.some((p) => p.accion.type === "log_food" && p.accion.slot === slot)) return null;
  if (!plan.pasos.some((p) => p.accion.type === "log_food" && !p.hecho)) return null; // ya no queda nada que ajustar
  const next = await buildPlan(memory, plan.mode, plan.nota, now, null);
  const txt = `Comiste algo fuera del plan (${MEAL_NAME[slot] ?? slot}): rearmé lo que queda del día.`;
  next.notas = [...(next.notas ?? []).filter((n) => !/^Comiste algo fuera del plan/.test(n)), txt];
  await savePlan(memory, next);
  pushPlan(wsClient, next);
  return next;
}

export async function swapPlan(memory: any, slot: string): Promise<{ plan: DayPlan; paso: PlanStep } | null> {
  const plan = await loadPlan(memory);
  if (!plan) return null;
  const r = swapMeal(plan, slot);
  if (!r) return null;
  await savePlan(memory, r.plan);
  return r;
}

export async function undoPlan(memory: any): Promise<DayPlan | null> {
  const plan = await loadPlan(memory);
  if (plan) await memory.set(planKey(plan.day), null).catch(() => {});
  return plan;
}

/** La comida de un paso del plan como entrada del registro (lo que se anota con «Lo comí») */
export function entryFromStep(paso: PlanStep, at: Date): NutritionEntry | null {
  if (paso.accion.type !== "log_food") return null;
  const foods = paso.accion.opciones[paso.accion.alt] ?? paso.accion.opciones[0];
  if (!foods?.length) return null;
  const items = foods.map((f) => ({ name: f.name, grams: f.grams, calories: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, fiber: f.fiber ?? 0 }));
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const totals = items.reduce((a, x) => ({ calories: a.calories + x.calories, protein: r1(a.protein + x.protein), carbs: r1(a.carbs + x.carbs), fat: r1(a.fat + x.fat), fiber: r1(a.fiber + x.fiber) }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  return { timestamp: at.toISOString(), loggedAt: new Date().toISOString(), mealType: paso.accion.slot, items, totals };
}

/**
 * Un paso hecho. Si es una comida, se anota tal cual («Lo comí»); una sola vez por paso (tocarlo dos veces no la duplica).
 * Devuelve el plan al día y la entrada anotada (si hubo).
 */
export async function doneStep(memory: any, wsClient: any, pasoId: string, now: Date = new Date()): Promise<{ plan: DayPlan; paso: PlanStep; logged: NutritionEntry | null } | null> {
  const plan = await loadPlan(memory, now);
  const paso = plan?.pasos.find((p) => p.id === pasoId);
  if (!plan || !paso) return null;
  if (paso.hecho) return { plan, paso, logged: null };
  let logged: NutritionEntry | null = null;
  const entry = entryFromStep(paso, now);
  if (entry) {
    const snap = await memory.get("health_snapshot_latest").catch(() => null);
    await saveNutritionEntry(memory, wsClient, entry, nutritionDayKey(now, dayCtxFrom(snap)));
    logged = entry;
  }
  const next: DayPlan = { ...plan, pasos: plan.pasos.map((p) => (p.id === pasoId ? { ...p, hecho: true } : p)) };
  await savePlan(memory, next);
  return { plan: next, paso: { ...paso, hecho: true }, logged };
}

/**
 * El plan como lo entiende ese teléfono: la app hasta la 1.71 no conoce el modo Rendimiento (su tarjeta se caería al buscar el
 * nombre del modo), así que le llega como Óptimo con sus pasos; la que lo conoce lo avisa con `v: 2` en `day_plan_request`.
 */
/** «¿Cómo vengo de estrés?» y la línea para Eris: las señales de mente de hoy (MindSignals) */
export async function mindSignalsFor(memory: any, now: Date = new Date()) {
  const day = (await todayIsoOf(memory, now).catch(() => null)) ?? isoDayKey(now);
  const snap: any = await memory.get("health_snapshot_latest").catch(() => null);
  const snapDay = snap?.lastUpdated ? (await todayIsoOf(memory, new Date(snap.lastUpdated)).catch(() => null)) : null;
  return gatherMindSignals(memory, day, snapDay === day ? Number(snap?.heartRate?.resting) || null : null);
}

export function planForClient(wsClient: any, plan: DayPlan | null): DayPlan | null {
  return plan && plan.mode === "rendimiento" && !(wsClient?.data?.planV >= 2) ? { ...plan, mode: "optimo" } : plan;
}

/** Para el teléfono: cada cambio del plan (también los hechos por chat) le llega al tiro */
export function pushPlan(wsClient: any, plan: DayPlan | null, extra: Record<string, unknown> = {}): void {
  try { wsClient?.send(JSON.stringify({ type: "day_plan", plan: planForClient(wsClient, plan), ...extra })); } catch {}
}
