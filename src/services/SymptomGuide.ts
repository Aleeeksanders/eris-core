// ============================================================
// Eris — SymptomGuide
//
// Orientación de salud para síntomas y molestias comunes, calculada en código a partir de data/symptom_guide.json y del
// perfil médico del usuario. El modelo NO decide qué es seguro decir: la guía (autocuidado, señales de alarma, cuándo
// consultar) y las cautelas según sus condiciones y medicamentos salen de acá; el modelo solo la acompaña con una frase.
//
//   · Señales de alarma (dolor de pecho, falta de aire, señales de derrame, sangrado importante, pensamientos de hacerse
//     daño…) se detectan por código en el mensaje del usuario y van SIEMPRE primero, con el 131 (SAMU) / *4141.
//   · Nunca da diagnósticos ni dosis de medicamentos, ni indica suspender un tratamiento.
// ============================================================

import type { MedicalProfile } from "../memory.js";
import data from "../data/symptom_guide.json";
import kb from "../data/medical_knowledge_base.json";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Symptom {
  id: string; label: string; quick?: string; patterns: string[];
  now: string[]; prevent?: string[]; consult: string[]; urgent: string[];
  profile?: { conditions?: Record<string, string>; medications?: Record<string, string>; diet?: Record<string, string> };
}
interface RedFlag { id: string; label: string; kind?: string; patterns: string[] }

const SYMPTOMS = data.symptoms as unknown as Symptom[];
const RED_FLAGS = data.redFlags as unknown as RedFlag[];

// Grupos: una cautela escrita para "diabetes" o "insulin" aplica a varios ids del perfil
const COND_GROUPS: Record<string, string[]> = { diabetes: ["diabetes_t1", "diabetes_t2", "prediabetes"] };
const MED_GROUPS: Record<string, string[]> = { insulin: ["insulin_rapid", "insulin_long", "insulin_mixed"] };

const rx = (patterns: string[]) => patterns.map((p) => { try { return new RegExp(p); } catch { return null; } }).filter(Boolean) as RegExp[];
const SYMPTOM_RX = SYMPTOMS.map((s) => ({ s, rx: rx(s.patterns) }));
const FLAG_RX = RED_FLAGS.map((f) => ({ f, rx: rx(f.patterns) }));

// Preguntas sobre un medicamento concreto o su dosis: el modelo NO debe improvisar (dosis, duración, contraindicaciones)
const MED_QUESTION = /\b(dosis|cada cuantas horas|cuantas? (pastillas?|tabletas?|comprimidos?|gotas)|ibuprofeno|paracetamol|aspirina|naproxeno|diclofenaco|ketorolaco|tramadol|amoxicilina|antibiotic\w*|omeprazol|loratadina|clonazepam|alprazolam|melatonina|antiinflamatori\w*|analgesic\w*)\b/;
export function asksAboutMedication(message: string): boolean { return MED_QUESTION.test(fold(message)); }

export function detectRedFlags(message: string): RedFlag[] {
  const t = fold(message);
  return FLAG_RX.filter(({ rx }) => rx.some((r) => r.test(t))).map(({ f }) => f);
}

/** Entradas de la guía que coinciden con lo que dice el usuario, de la más a la menos específica (más patrones que coinciden). */
export function matchSymptoms(message: string, limit = 2): Symptom[] {
  const t = fold(message);
  return SYMPTOM_RX
    .map(({ s, rx }) => ({ s, score: rx.filter((r) => r.test(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

/** Qué del perfil del usuario es relevante para las cautelas (ids de condiciones, medicamentos activos, embarazo…). */
export function profileFacts(medical?: MedicalProfile | null) {
  const conditions = new Set((medical?.conditions ?? []).map((c) => c.id as string));
  const meds = new Set((medical?.medications ?? []).filter((m) => m.active).map((m) => m.type as string));
  const diet = new Set(((medical as any)?.dietaryRestrictions ?? []) as string[]);
  return { conditions, meds, diet };
}

const has = (set: Set<string>, key: string, groups: Record<string, string[]>) => set.has(key) || (groups[key]?.some((g) => set.has(g)) ?? false);

/** Cautelas propias de este usuario para un síntoma (según sus condiciones, medicamentos y si está embarazada). */
export function cautionsFor(s: Symptom, medical?: MedicalProfile | null): string[] {
  const { conditions, meds, diet } = profileFacts(medical);
  const out: string[] = [];
  for (const [k, v] of Object.entries(s.profile?.conditions ?? {})) if (has(conditions, k, COND_GROUPS)) out.push(v);
  for (const [k, v] of Object.entries(s.profile?.medications ?? {})) if (has(meds, k, MED_GROUPS)) out.push(v);
  for (const [k, v] of Object.entries(s.profile?.diet ?? {})) if (diet.has(k)) out.push(v);
  return out;
}

export interface GuideResult {
  /** Hechos cortos y sin texto libre del usuario: lo que lee el modelo. */
  facts: string[];
  /** Guía completa en markdown: se muestra al usuario tal cual. */
  block: string;
  emergency: boolean;
  matched: string[];
  /** Respuesta corta y ya redactada (cálida, con el primer paso concreto): sirve para responder sin pasar por el modelo. */
  quick: string;
}

const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

/** Nombres legibles de las condiciones del perfil (de la base médica), para decirle al farmacéutico. */
function conditionLabels(medical?: MedicalProfile | null): string[] {
  return (medical?.conditions ?? []).map((c) => (kb.conditions as Record<string, any>)[c.id]?.label as string | undefined).filter((x): x is string => !!x && x !== "Otra");
}

export function buildGuide(message: string, medical?: MedicalProfile | null): GuideResult {
  const flags = detectRedFlags(message);
  const symptoms = matchSymptoms(message);
  const selfHarm = flags.some((f) => f.kind === "selfHarm");
  const parts: string[] = [];
  const medQ = asksAboutMedication(message);

  if (flags.length) {
    parts.push(
      `## 🚨 ${selfHarm ? "Tu bienestar es lo primero" : "Posible emergencia"}\n` +
      `${selfHarm ? data.emergency.selfHarm : data.emergency.generic}\n` +
      (selfHarm ? "" : `\n_Lo que mencionaste: ${flags.map((f) => f.label).join(", ")}._`),
    );
  }

  const cautionLines: string[] = [];
  for (const s of symptoms) {
    const cautions = cautionsFor(s, medical);
    cautionLines.push(...cautions);
    parts.push(
      `# 🩺 Guía para: ${s.label}\n` +
      `**Qué hacer ahora**\n${s.now.map((n, i) => `${i + 1}. ${n}`).join("\n")}` +
      (cautions.length ? `\n\n**Ojo con tu perfil**\n${list(cautions)}` : "") +
      (s.consult.length ? `\n\n**Consulta pronto si**\n${list(s.consult)}` : "") +
      (s.urgent.length ? `\n\n**Ve a urgencias o llama al 131 si**\n${list(s.urgent)}` : "") +
      (s.prevent?.length ? `\n\n**Para que no vuelva**\n${list(s.prevent)}` : ""),
    );
  }

  if (medQ) {
    const labels = conditionLabels(medical);
    parts.push(
      `**Sobre el medicamento que mencionas**
` +
      `- No puedo indicarte dosis, frecuencia ni cuánto tiempo usarlo: depende de tu peso, tus condiciones y tus otros medicamentos.
` +
      `- Confírmalo con tu médico o con el farmacéutico: en la farmacia te lo pueden orientar al momento.
` +
      (labels.length ? `- Cuéntale tus condiciones (${labels.join(", ")}) y los medicamentos que tomas: algunos analgésicos y antiinflamatorios no son adecuados según eso.
` : "") +
      `- Sigue siempre las indicaciones de tu receta o del envase.`,
    );
  }

  // Sin una guía específica (y sin emergencia ni pregunta de medicamento): orientación general prudente, nunca un rechazo
  if (!symptoms.length && !flags.length && !medQ) {
    parts.push(
      `# 🩺 Orientación general\n**Qué hacer ahora**\n${data.generic.now.map((n, i) => `${i + 1}. ${n}`).join("\n")}` +
      `\n\n**Consulta pronto si**\n${list(data.generic.consult)}\n\n**Ve a urgencias o llama al 131 si**\n${list(data.generic.urgent)}`,
    );
  }

  parts.push("_Orientación general de autocuidado; no reemplaza la evaluación de tu médico._");

  const { conditions, meds } = profileFacts(medical);
  const relevant = [...conditions, ...meds].filter((x) => x !== "other");
  const facts = [
    flags.length ? `SEÑAL DE ALARMA DETECTADA: ${flags.map((f) => f.label).join(", ")}. Empieza tu mensaje diciendo, con calma y claridad, que ${selfHarm ? "llame ahora al *4141 o al 131" : "llame ahora al 131 (SAMU) o vaya a urgencias"}.` : "Señales de alarma en el mensaje: ninguna.",
    symptoms.length ? `Síntoma reconocido: ${symptoms.map((s) => s.label).join("; ")}.` : "No hay una guía específica para lo que describe: se muestra orientación general.",
    // El primer paso concreto (texto fijo de la base, no del usuario): la frase del modelo se ancla en algo verdadero y útil
    ...(symptoms.length && !flags.length ? [`Lo PRIMERO que puede hacer ahora (dilo tal cual, en una frase): ${symptoms[0].now[0].split(/(?<=\.)\s/)[0]}`] : []),
    ...(medQ ? ["PREGUNTA POR UN MEDICAMENTO: NO indiques dosis, frecuencia ni duración de uso, ni inventes contraindicaciones o datos de su perfil que no estén aquí. Dile que lo confirme con su médico o farmacéutico; el detalle está en la guía."] : []),
    cautionLines.length ? `Hay ${cautionLines.length} cautela(s) según su perfil (condiciones/medicamentos), incluidas en la guía.` : (relevant.length ? "Su perfil no agrega cautelas específicas para este síntoma." : "No hay perfil médico cargado."),
  ];

  // Respuesta rápida: emergencias y riesgo de suicidio primero y sin adornos; si no, empatía breve + el PRIMER paso de la base
  let quick: string;
  if (flags.length) {
    quick = selfHarm
      ? "Gracias por decírmelo: no estás solo/a. Llama ahora al *4141 (gratis, todo el día) o al 131 si estás en peligro inmediato."
      : "🚨 Esto puede ser una emergencia: llama ahora al 131 (SAMU) o ve a urgencias. No esperes a ver si pasa.";
  } else if (symptoms.length) {
    const first = symptoms[0].now[0].split(/(?<=\.)\s/)[0];
    quick = `${symptoms[0].quick ?? "Entiendo."} ${first}` +
      (symptoms.length > 1 ? ` También te dejo la guía de ${symptoms[1].label.toLowerCase()}.` : "") +
      (medQ ? " Sobre el medicamento, confírmalo con tu médico o farmacéutico." : "") +
      " Abajo tienes la guía completa, con lo que conviene vigilar.";
  } else if (medQ) {
    quick = "Sobre ese medicamento no puedo indicarte dosis: confírmalo con tu médico o farmacéutico. Abajo te dejo lo que sí te puedo orientar.";
  } else {
    quick = "Te dejo abajo una orientación general; si empeora o te preocupa, consulta.";
  }

  return { facts, block: parts.join("\n\n"), emergency: flags.length > 0, matched: symptoms.map((s) => s.id), quick };
}

/** ¿Este mensaje describe un síntoma o una señal de alarma (para llamar a la guía sin depender del modelo)? */
export function looksLikeSymptom(message: string): boolean {
  return detectRedFlags(message).length > 0 || matchSymptoms(message, 1).length > 0 || asksAboutMedication(message);
}
