// ============================================================
// Eris — LiveContext
// Construye los bloques de contexto real del usuario (salud,
// médico, personal, financiero) — antes se forzaban en CADA
// mensaje del chat (causaba que Eris comentara tu glucosa aunque
// solo dijeras "hola"). Ahora viven acá y se exponen vía
// LiveContextTool, para que el LLM los pida SOLO cuando la
// conversación realmente lo amerita — como cualquier asistente
// normal, pero con acceso total cuando decide usarlo.
// ============================================================

import type { MemoryAdapter } from "../memory.js";
import { formatGuidanceForLLM, getGuidance } from "./MedicalKnowledgeBase.js";
import { getFeatures } from "./Features.js";
import { getUserNotes, formatNotesForLLM } from "../tools/UserContextTool.js";
import { loadTargets, localDay, GOALS, activityLabel } from "./DailyTargets.js";
import { rollupFieldsOf } from "./NutritionLog.js";
import { waterTotalToday } from "./WaterToday.js";
import { todayKeyOf, internalClockLine } from "./NutritionDay.js";
import { dayCtxFrom, nutritionDayKey, isoDayKey } from "./MealSchedule.js";
import { financeFactLines } from "./ReplyGuards.js";
import { labsSummary } from "../tools/LabResultsTool.js";

/** "Mañana" en el horario de un remedio es la jornada, no el día siguiente (Eris lo leyó como "a tomar mañana a las 7"). */
export function humanSchedule(s: unknown): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return /^(mañana|manana|tarde|noche)$/i.test(t) ? `por la ${t.toLowerCase().replace("manana", "mañana")}` : t;
}

const fmtN = (n: number) => Math.round(n).toLocaleString("es-CL");
const fmtL = (n: number) => `${(Math.round(n * 10) / 10).toString().replace(".", ",")} L`;

/**
 * Los números reales de HOY en un bloque corto: metas (DailyTargets), lo que lleva, el sueño y las cifras de Finanzas que
 * de verdad existen. Va en los turnos que tocan salud o plata (ver QueryEngine). Antes el modelo, sin esto, inventaba:
 * "meta de agua 2-3 L" (la real era otra, por un medicamento) o "saldo 12.650" (no existía) — 2026-10-07.
 */
export async function buildTodayBrief(memory: MemoryAdapter, userMessage?: string): Promise<string> {
  try {
    // El día de COMIDA (termina al dormir): a las 2 AM sin haber dormido, lo de hoy sigue siendo lo de ayer
    const today = await todayKeyOf(memory as any);
    const safe = async (k: string) => { try { return await memory.get(k); } catch { return null; } };
    const [targets, snap, nut, hyd, fin, sleepLog] = await Promise.all([
      loadTargets(memory as any).catch(() => null), safe("health_snapshot_latest"), safe(`nutrition_log_${today}`),
      safe(`hydration_log_${today}`), safe("financial_context_latest"), safe("sleep_log"),
    ]);
    const chat = rollupFieldsOf(nut, hyd);
    const snapToday = !!snap?.lastUpdated && nutritionDayKey(new Date(snap.lastUpdated), dayCtxFrom(snap)) === today;
    const pick = (a: number, b: unknown) => (typeof b === "number" && Number.isFinite(b) && b > a ? b : a);
    const kcal = pick(chat.calories, snapToday ? snap?.nutrition?.calories : undefined);
    const protein = pick(chat.proteinG, snapToday ? snap?.nutrition?.protein : undefined);
    // El agua con la cuenta única (teléfono + lo del chat que el teléfono aún no contó): antes el mayor de los dos
    const wt = await waterTotalToday(memory as any).catch(() => null);
    const water = wt?.totalL ?? pick(chat.hydrationL, snapToday ? snap?.hydration : undefined);
    const waterFood = wt && wt.foodL >= 0.05 ? ` (${fmtL(wt.foodL)} de eso viene de la comida)` : "";

    const lines: string[] = [`[Datos reales de HOY (${new Date().toLocaleDateString("es-CL")}). Son los ÚNICOS números de hoy que tienes: úsalos solo si la conversación toca estos temas; si falta un dato, dilo. NUNCA inventes cifras.]`];
    if (targets) {
      const waterGoal = targets.waterL === null ? "sin meta de agua (la define su médico)" : `agua ${fmtL(targets.waterL)}${/SGLT2|medicamento/i.test(targets.sources.water) ? " (YA incluye el +30 % por su medicamento: no le sumes nada)" : ""}`;
      const protRange = targets.proteinRange ? ` (rango ${fmtN(targets.proteinRange[0])}–${fmtN(targets.proteinRange[1])} g)` : "";
      const goalTxt = targets.goal ? ` · objetivo en Forge: ${GOALS[targets.goal].label}` : "";
      lines.push(`- Metas de hoy: ${fmtN(targets.kcal)} kcal · proteína ${fmtN(targets.proteinG)} g${protRange}${targets.proteinIsCap ? " (TOPE, no meta)" : ""} · ${waterGoal}${goalTxt}`);
    }
    lines.push(`- Lleva hoy: ${fmtN(kcal)} kcal · ${fmtN(protein)} g de proteína · ${water > 0 ? fmtL(water) : "0 L"} de agua${water > 0 ? waterFood : " (no ha anotado agua hoy)"}`);
    // Actividad del reloj (detectada sin «modo entrenamiento»): ya suma a la meta de kcal y agua (DailyTargets)
    const act = snapToday && snap?.activity?.day === isoDayKey(new Date()) && snap.activity.minutes >= 10 ? snap.activity : null;
    if (act) lines.push(`- Actividad de hoy (reloj): ${activityLabel(act)}, ~${fmtN(act.kcal)} kcal${act.vigorousMin ? ` (${fmtN(act.vigorousMin)} min intensa)` : ""}. La meta de hoy ya suma ese gasto; no le pidas moverse más.`);
    const clock = internalClockLine(snap);
    if (clock) lines.push(clock);
    const device = snapToday && typeof snap?.sleep?.durationHours === "number" && !snap.sleep.manual ? snap.sleep.durationHours : null;
    const manual = typeof sleepLog?.[localDay()]?.hours === "number" ? sleepLog[localDay()].hours : null;
    // Lo que contó el usuario manda (el reloj se equivoca si quedó cargando o no detectó una parte: 2026-10-12)
    const relojAntes = typeof snap?.sleep?.reloj === "number" ? snap.sleep.reloj : null;
    lines.push(`- Sueño de anoche: ${manual !== null ? `${manual} h (lo anotó el usuario${device !== null && Math.abs(device - manual) > 0.25 ? `; el reloj marcaba ${device} h` : relojAntes !== null && Math.abs(relojAntes - manual) > 0.25 ? `; el reloj marcaba ${relojAntes} h` : ""})` : device !== null ? `${device} h (reloj)` : "sin dato (el reloj no lo midió y no lo ha contado)"}`);
    // Salud de base, en una línea: condiciones, remedios con su horario y exámenes (para cruzar bien sin pedir herramientas)
    try {
      const med = (await memory.getProfile())?.medical;
      const bits: string[] = [];
      if (med?.conditions?.length) bits.push(med.conditions.map((c) => c.id.replace(/_/g, " ")).join(", "));
      const meds = (med?.medications ?? []).filter((m) => m.active).map((m) => `${m.name}${m.schedule ? ` (${humanSchedule(m.schedule)})` : ""}`);
      if (meds.length) bits.push(`toma ${meds.join(", ")}`);
      const labs = labsSummary(med?.labs);
      if (labs) bits.push(`exámenes: ${labs}`);
      if (bits.length) lines.push(`- Salud de base: ${bits.join(" · ")}`);
      // ¿Pregunta por sus remedios? Va la ficha de la base médica: el 2026-10-07, sin ella, Eris dijo que un remedio de la diabetes
      // "mejora la sensibilidad a la insulina" (no es así: eso es la metformina)
      const t = String(userMessage ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const active = (med?.medications ?? []).filter((m) => m.active);
      const asksMeds = /\b(remedio|remedios|medicamento|medicamentos|pastilla|pastillas|farmaco|tratamiento)\b/.test(t)
        || active.some((m) => { const n = String(m.name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\s+/)[0]; return n.length >= 5 && t.includes(n.slice(0, 6)); });
      if (asksMeds) {
        const guides = getGuidance(med).filter((g) => g.kind === "medication").map((g) => g.guidance);
        if (guides.length) lines.push(`- Cómo actúan sus remedios (base médica de Eris; usa ESTO, no lo que recuerdes): ${guides.join(" | ")}`);
      }
    } catch {}
    const facts = typeof fin === "string" ? financeFactLines([fin]) : [];
    if (facts.length) {
      const noSpend = facts.some((l) => /^[-·•]\s*Gastos [^:]+:\s*\$0\b/.test(l));
      lines.push(`- Finanzas (de la app): ${facts.map((l) => l.replace(/^[-·•]\s*/, "")).join(" · ")}${noSpend ? " — no hay gastos anotados este mes: NO lo presentes como ahorro" : ""}`);
    } else {
      lines.push("- Finanzas: sin datos de la app. No des cifras de dinero.");
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

export type LiveContextScope = "health" | "medical" | "financial" | "personal" | "all";

// Contexto médico: condiciones, medicamentos activos, umbrales, última insulina —
// compartido por el chat (bajo demanda, vía tool) y el diagnóstico de baselines
// (tip proactivo / card de Pulso, que sigue usándolo directamente en cada
// generación porque ahí SÍ es su propósito explícito, no una charla casual).
export async function buildMedicalContext(memory: MemoryAdapter): Promise<string> {
  try {
    const userProf = await memory.getProfile();
    const med = userProf?.medical;
    if (!med) return '';

    const mParts: string[] = ['\n\n## 🏥 Historial Médico del Usuario:'];
    if (med.conditions?.length) {
      mParts.push('Condiciones: ' + med.conditions.map(c => c.id.replace(/_/g, ' ')).join(', '));
    }
    if (med.medications?.filter(m => m.active).length) {
      const meds = med.medications.filter(m => m.active).map(m => `${m.name} ${m.dose || ''}`.trim() + (m.schedule ? ` (${humanSchedule(m.schedule)})` : ''));
      mParts.push('Medicamentos activos: ' + meds.join(', '));
    }
    if (med.thresholds) {
      const t = med.thresholds;
      mParts.push(`Umbrales glucosa: bajo <${t.glucoseLow} · alto >${t.glucoseHigh} · urgente bajo <${t.glucoseUrgentLow} · urgente alto >${t.glucoseUrgentHigh} mg/dL`);
    }
    if (med.bloodType) mParts.push(`Grupo sanguíneo: ${med.bloodType}`);
    const labs = labsSummary(med.labs);
    if (labs) mParts.push(`Exámenes que contó: ${labs} (la HbA1c es el promedio de ~3 meses, no la glucosa del momento)`);
    if (med.allergies) mParts.push(`Alergias: ${med.allergies}`);
    const isDiabetic = med.conditions?.some(c => c.id.startsWith('diabetes'));
    // Dosis de insulina: solo con el módulo de glucosa aprobado (registrar dosis es tratar, no cuidar)
    if (isDiabetic && (await getFeatures()).glucose) {
      const recentInsulin = await memory.getInsulinLog(1);
      if (recentInsulin.length > 0) {
        const last = recentInsulin[0];
        const ago = Math.round((Date.now() - new Date(last.timestamp).getTime()) / 60000);
        mParts.push(`Última insulina: ${last.units}UI ${last.type === 'rapid' ? 'rápida' : last.type === 'long' ? 'lenta' : 'mixta'} hace ${ago} min${last.glucoseAtTime ? ` (glucosa ${last.glucoseAtTime} mg/dL entonces)` : ''}`);
      }
    }
    const kbGuidance = formatGuidanceForLLM(med);
    if (kbGuidance) {
      mParts.push('Notas clínicas relevantes (orientativas, no reemplazan al médico):\n' + kbGuidance);
    }
    return mParts.join('\n');
  } catch {
    return '';
  }
}

export async function buildHealthContext(memory: MemoryAdapter): Promise<string> {
  try {
    const snap: any = await memory.get('health_snapshot_latest');
    if (!snap) return '';
    const parts: string[] = ['\n\n## 📊 Métricas de Salud Actuales (del dispositivo del usuario):'];
    if (snap.sleep)     parts.push(`- Sueño: ${snap.sleep.durationHours}h`);
    if (snap.heartRate) parts.push(`- FC: ${snap.heartRate.average} bpm (reposo: ${snap.heartRate.resting} bpm)`);
    if (snap.hrv)       parts.push(`- HRV: ${snap.hrv}ms`);
    if (snap.steps)     parts.push(`- Pasos hoy: ${snap.steps.toLocaleString()}`);
    // Lo que los pasos no cuentan (pesas, básquet, bici): antes Eris solo veía pasos y pedía caminar a quien ya entrenó
    if (snap.activity?.minutes > 0 && snap.activity.day === isoDayKey(new Date())) parts.push(`- Actividad de hoy (reloj, sin modo entrenamiento): ${activityLabel(snap.activity)}, ~${snap.activity.kcal} kcal: ya suma a su meta de calorías y agua`);
    else if (snap.activeMinutes > 0) parts.push(`- Ejercicio hoy (sesiones del reloj): ${snap.activeMinutes} min`);
    if (snap.trainedDay === isoDayKey(new Date())) parts.push(`- Entrenó hoy (Forge): no le pidas caminar ni moverse más`);
    if (snap.distance)  parts.push(`- Distancia: ${snap.distance} km`);
    if (snap.calories)  parts.push(`- Calorías activas: ${snap.calories.active ?? snap.calories} kcal`);
    if (snap.spo2)      parts.push(`- SpO2: ${snap.spo2}%`);
    if (snap.weight)    parts.push(`- Peso: ${snap.weight} kg`);
    if (snap.nutrition) parts.push(`- Nutrición: ${snap.nutrition.calories} kcal | Prot: ${snap.nutrition.protein}g | Carbos: ${snap.nutrition.carbs}g | Grasas: ${snap.nutrition.fat}g`);
    if (snap.hydration) parts.push(`- Agua bebida según Health Connect: ${snap.hydration}L (el total del día, con la comida y el chat, es el de "Lleva hoy")`);
    // Calidad de lo comido HOY según la hora de cada comida (la calcula el teléfono, NutritionQuality); solo si es de hoy
    const fq = snap.foodQuality;
    if (fq && typeof fq.at === 'string' && new Date(fq.at).toDateString() === new Date().toDateString()) {
      if (fq.score != null) parts.push(`- Calidad de la alimentación hasta ahora: ${fq.letter} (${fq.score}/100) — ${fq.headline}`);
      for (const m of Array.isArray(fq.meals) ? fq.meals.slice(0, 6) : []) {
        parts.push(`  · ${m.label}: ${m.letter}, ${m.kcal} kcal${m.notes?.length ? ` (${m.notes.join(', ')})` : ''}`);
      }
      if (fq.hydrationScore != null) parts.push(`- Hidratación vs lo esperable a esta hora: ${fq.hydrationScore}/100`);
      for (const t of Array.isArray(fq.tips) ? fq.tips.slice(0, 3) : []) parts.push(`  → ${t}`);
    }
    if (snap.workouts?.length) parts.push(`- Entrenamientos: ${snap.workouts.length} sesion(es)`);
    if (snap.lastUpdated) parts.push(`- Actualizado: ${new Date(snap.lastUpdated).toLocaleTimeString('es-ES')}`);
    return parts.join('\n');
  } catch {
    return '';
  }
}

export async function buildFinancialContext(memory: MemoryAdapter): Promise<string> {
  try {
    const ctx = await memory.get('financial_context_latest');
    return typeof ctx === 'string' && ctx ? ctx : '';
  } catch {
    return '';
  }
}

/** Combina los bloques según scope — usado por LiveContextTool (bajo demanda del LLM en chat normal). */
export async function buildLiveContextText(memory: MemoryAdapter, scope: LiveContextScope = "all"): Promise<string> {
  const parts: string[] = [];

  // Primero lo de hoy con sus metas: sin esto el modelo veía "Hidratación: 1,3 L" sin saber contra qué meta
  if (scope === "all" || scope === "health" || scope === "financial") {
    const brief = await buildTodayBrief(memory);
    if (brief) parts.push(brief);
  }

  if (scope === "all" || scope === "health") {
    const h = await buildHealthContext(memory);
    if (h) parts.push(h);
  }
  if (scope === "all" || scope === "medical") {
    const m = await buildMedicalContext(memory);
    if (m) parts.push(m);
  }
  if (scope === "all" || scope === "personal") {
    const notesText = formatNotesForLLM(await getUserNotes(memory));
    if (notesText) parts.push('\n\n## 📝 Contexto personal que el usuario ha compartido:\n' + notesText);
  }
  if (scope === "all" || scope === "financial") {
    const f = await buildFinancialContext(memory);
    if (f) parts.push('\n\n## 💰 Contexto financiero:\n' + f);
  }

  return parts.join('').trim() || 'No hay datos guardados todavía en esta categoría.';
}
