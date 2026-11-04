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
import { waterTotalToday, waterPace, paceText } from "./WaterToday.js";
import { todayKeyOf, todayIsoOf, internalClockLine } from "./NutritionDay.js";
import { gatherMindSignals, mindLine } from "./MindSignals.js";
import { dayCtxFrom, nutritionDayKey, isoDayKey, wakeHourFrom } from "./MealSchedule.js";
import { sleepSummaryText, sleepReading, insightsText, bedtimeText, sleepReadiness, lastSleepFrom } from "./SleepCore.js";
import { financeFactLines } from "./ReplyGuards.js";
import { labsSummary } from "../tools/LabResultsTool.js";
import { moduloOn } from "./AutoPrefs.js";

/** "Mañana" en el horario de un remedio es la jornada, no el día siguiente (Eris lo leyó como "a tomar mañana a las 7"). */
export function humanSchedule(s: unknown): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return /^(mañana|manana|tarde|noche)$/i.test(t) ? `por la ${t.toLowerCase().replace("manana", "mañana")}` : t;
}

/** El mensaje habla de exámenes o de algo que se lee con ellos (glucosa, colesterol, riñón, carbohidratos). */
export const LABS_TOPIC = /\b(examen\w*|laboratorio|resultados?|hba1c|a1c|hemoglobina|glicosilada|glucosilada|glicada|glucos\w*|glicemia|glucemia|azucar|diabet\w*|prediabet\w*|colesterol|ldl|hdl|triglicerido\w*|creatinina|presion|salud|control(es)?|medic\w*|doctor\w*|rinon|rinones|renal|higado|tiroides|tsh|insulina|resistencia|carbohidrat\w*|carbos?|indice glicemico|hipo\w*|hiper\w*|vitamina d|ferritina|hierro|anemia)\b/;

/** De qué habla el mensaje, para sumar al contexto solo las aclaraciones que vienen al caso (agua, proteína, la meta). */
export function topicsOf(message?: string): { water: boolean; protein: boolean; goal: boolean; overview: boolean } {
  const t = String(message ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return {
    water: /\b(agua|hidrat\w*|litros?|vasos?|beb\w*|sed)\b/.test(t),
    protein: /\b(proteina\w*|prote|me pase|exceso)\b/.test(t),
    goal: /\b(meta|metas|calorias|kcal|subio|bajo|cambio|por que|porque)\b/.test(t),
    overview: /\b(como voy|como estoy|como va|analiza\w*|panorama|resumen|metricas|evalua\w*|que hago|que me recomiendas|recomienda\w*|desayun\w*|almuerz\w*|cena|once|snack|comer)\b/.test(t),
  };
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
      safe(`hydration_log_${today}`), moduloOn(memory, "finanzas").then((on) => (on ? safe("financial_context_latest") : null)), safe("sleep_log"),
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
      // Solo cuando el mensaje toca el tema: cada línea suma al prompt y un registro de comida sin intención clara ya llega al
      // borde de 8192 tokens (2026-10-21: «Te faltó la carne molida» se cortó y respondió «no recibiste ningún mensaje»)
      const about = topicsOf(userMessage);
      // 2026-10-16: «la proteína está superando tu meta… puede estar afectando tu control metabólico» (184 g, 2,2 g/kg, sin
      // enfermedad renal). La meta de proteína es un mínimo a alcanzar; solo con enfermedad renal es un tope.
      if (!targets.proteinIsCap && (about.protein || about.overview)) lines.push("- La proteína es un MÍNIMO a alcanzar, no un tope: pasarse de la meta no es un problema ni afecta la glucosa; no lo presentes como exceso ni como riesgo.");
      // 2026-10-19: «¿por qué subió de 2.100 a 3.300?» y el modelo culpó a un medicamento y dijo «estar más preparado». El porqué real:
      if (about.goal || about.overview) lines.push(`- Cómo sale la meta de calorías de hoy: ${targets.sources.kcal}. Si pregunta por qué cambió su meta, explícalo SOLO con esto (no inventes otras razones: medicamentos, glucosa, «prepararse»).`);
    }
    // El entreno de hoy («¿entrenas hoy?», Forge 2.0): la meta ya es según el día
    if (targets?.byDay === "descanso") lines.push("- Hoy dijo que DESCANSA: la meta es de día de descanso. No le pidas entrenar ni moverse más.");
    else if (targets?.byDay === "entreno" && targets.intentPhrase) {
      const mt = targets.minutesToWorkout;
      lines.push(`- Hoy dijo que ENTRENA: ${targets.intentPhrase}${targets.kcalPlanned ? ` (~${fmtN(targets.kcalPlanned)} kcal planificadas)` : ""}${targets.kcalGhost ? `; faltan ~${fmtN(targets.kcalGhost)} y la meta ya las incluye (puede comer para entrenar)` : ""}${mt != null ? (mt > 0 ? `; faltan ${mt >= 60 ? `${Math.floor(mt / 60)} h ${mt % 60} min` : `${mt} min`}` : "; ya era la hora") : ""}.`);
    }
    lines.push(`- Lleva hoy: ${fmtN(kcal)} kcal · ${fmtN(protein)} g de proteína · ${water > 0 ? fmtL(water) : "0 L"} de agua${water > 0 ? waterFood : " (no ha anotado agua hoy)"}`);
    // El agua A ESTA HORA (2026-10-18: «reponer 3,5 L» a las 10:54, cuando iba 2 vasos atrás): lo que falta del día no es deuda
    if (targets?.waterL && (topicsOf(userMessage).water || topicsOf(userMessage).overview)) {
      const p = waterPace(water, targets.waterL, new Date(), wakeHourFrom(snap));
      lines.push(`- Agua A ESTA HORA: ${paceText(p, targets.waterL, water)}. Habla del agua así (cómo va para la hora); lo que falta para la meta del día NO es una deuda ni algo que «reponer»: no lo presentes como urgencia.`);
    }
    // Actividad del reloj (detectada sin «modo entrenamiento»): ya suma a la meta de kcal y agua (DailyTargets)
    const act = snapToday && snap?.activity?.day === isoDayKey(new Date()) && snap.activity.minutes >= 10 ? snap.activity : null;
    if (act) lines.push(`- Actividad de hoy (reloj): ${activityLabel(act)}, ~${fmtN(act.kcal)} kcal${act.vigorousMin ? ` (${fmtN(act.vigorousMin)} min intensa)` : ""}. La meta de hoy ya suma ese gasto; no le pidas moverse más.`);
    const clock = internalClockLine(snap);
    if (clock) lines.push(clock);
    const device = snapToday && typeof snap?.sleep?.durationHours === "number" && !snap.sleep.manual ? snap.sleep.durationHours : null;
    const manual = typeof sleepLog?.[localDay()]?.hours === "number" ? sleepLog[localDay()].hours : null;
    // Lo que contó el usuario manda (el reloj se equivoca si quedó cargando o no detectó una parte: 2026-10-12)
    const relojAntes = typeof snap?.sleep?.reloj === "number" ? snap.sleep.reloj : null;
    // Por partes, como el reloj (Sueño 2.0 · S0): la noche, un segundo sueño, siestas, en la misma frase que la app
    const eps = snapToday && manual === null && Array.isArray(snap?.sleep?.episodes) && snap.sleep.episodes.length ? snap.sleep.episodes : null;
    const porPartes = eps && device !== null ? (() => {
      const d = { episodes: eps, totalH: device, nightH: snap.sleep.nightHours ?? null, split: !!snap.sleep.split, night: eps.find((e: any) => e.kind === "noche") ?? null };
      const r = sleepReading(d, snap?.schedule?.sleepHours);
      return `${sleepSummaryText(d)}${r ? ` ${r}` : ""} (reloj; para la recuperación cuenta el total, para la calidad la noche)`;
    })() : null;
    lines.push(`- Sueño de anoche: ${manual !== null ? `${manual} h (lo anotó el usuario${device !== null && Math.abs(device - manual) > 0.25 ? `; el reloj marcaba ${device} h` : relojAntes !== null && Math.abs(relojAntes - manual) > 0.25 ? `; el reloj marcaba ${relojAntes} h` : ""})` : porPartes ?? (device !== null ? `${device} h (reloj)` : "sin dato (el reloj no lo midió y no lo ha contado)")}`);
    // Las 2 semanas (Sueño 2.0 · S1, sleepCore en el teléfono): deuda, regularidad, cronotipo y la hora para acostarse hoy
    const ins = snapToday && snap?.sleepInsights && typeof snap.sleepInsights.need === "number" ? snap.sleepInsights : null;
    if (ins && ins.nights >= 4) lines.push(`- Sueño de 2 semanas: ${insightsText(ins)} ${bedtimeText(ins)} (cifras del reloj; úsalas tal cual)`);
    // Sueño 2.0 · S3: cómo llega a entrenar hoy (lo mismo que muestra Forge) y su plan de sueño en curso
    const rd = snapToday ? sleepReadiness(ins, lastSleepFrom(snap?.sleep)) : null;
    if (rd && rd.level !== "normal") lines.push(`- Para entrenar hoy: ${rd.level} — ${rd.why} ${rd.tip}`);
    if (snapToday && snap?.sleepPlan?.title && !snap.sleepPlan.done) lines.push(`- Su plan de sueño: «${snap.sleepPlan.title}» (${snap.sleepPlan.text})`);
    // ⚡ R2: señales de mente, solo si usa el día exigente (check-in de hoy, la semana, el pulso contra su promedio, lo que se repite)
    try {
      const mind = mindLine(await gatherMindSignals(memory, await todayIsoOf(memory as any), snapToday && Number(snap?.heartRate?.resting) > 0 ? Number(snap.heartRate.resting) : null));
      if (mind) lines.push(mind);
    } catch {}
    // Salud de base, en una línea: condiciones, remedios con su horario y exámenes (para cruzar bien sin pedir herramientas)
    try {
      const med = (await memory.getProfile())?.medical;
      const bits: string[] = [];
      if (med?.conditions?.length) bits.push(med.conditions.map((c) => c.id.replace(/_/g, " ")).join(", "));
      const meds = (med?.medications ?? []).filter((m) => m.active !== false).map((m) => `${m.name}${m.schedule ? ` (${humanSchedule(m.schedule)})` : ""}`);
      if (meds.length) bits.push(`toma ${meds.join(", ")}`);
      // Los exámenes, solo si el mensaje habla de eso (salud, glucosa, exámenes, carbohidratos): antes iban en cada turno y
      // Eris nombraba su HbA1c en casi todas las respuestas, también ante «¿qué ceno?» o la plata (revisión 2026-11-04, R3)
      const labs = labsSummary(med?.labs);
      const tLabs = String(userMessage ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      if (labs && LABS_TOPIC.test(tLabs)) bits.push(`exámenes: ${labs}`);
      if (bits.length) lines.push(`- Salud de base: ${bits.join(" · ")}`);
      // ¿Pregunta por sus remedios? Va la ficha de la base médica: el 2026-10-07, sin ella, Eris dijo que un remedio de la diabetes
      // "mejora la sensibilidad a la insulina" (no es así: eso es la metformina)
      const t = String(userMessage ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const active = (med?.medications ?? []).filter((m) => m.active !== false);
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
    if (med.medications?.filter(m => m.active !== false).length) {
      const meds = med.medications.filter(m => m.active !== false).map(m => `${m.name} ${m.dose || ''}`.trim() + (m.schedule ? ` (${humanSchedule(m.schedule)})` : ''));
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
    if (snap.sleep)     parts.push(`- Sueño: ${snap.sleep.durationHours}h${snap.sleep.split && typeof snap.sleep.nightHours === "number" ? ` en partes (noche ${snap.sleep.nightHours}h)` : ""}`);
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
    if (!(await moduloOn(memory, 'finanzas'))) return ''; // Finanzas apagado en Perfil (A2)
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
