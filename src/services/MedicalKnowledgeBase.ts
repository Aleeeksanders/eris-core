// ============================================================
// Eris — MedicalKnowledgeBase
// Base de conocimiento médico transversal: una entrada por
// ConditionId y por MedicationType (src/memory.ts), consultable
// por cualquier módulo (BaselineEngine, NutritionTool,
// TrainingPlanTool, el contexto de chat) contra el perfil real
// del usuario. Ajustes NUMÉRICOS solo para casos de bajo riesgo y
// bien establecidos (ver medical_knowledge_base.json); todo lo
// demás es guidance cualitativa para que el LLM la redacte —
// nunca una cifra clínica calculada aquí.
// ============================================================

import type { MedicalProfile } from "../memory.js";
import kb from "../data/medical_knowledge_base.json";
import { medicationTypes } from "./DietaryRestrictions.js";

export type KbScope = 'hydration' | 'nutrition' | 'training' | 'sleep' | 'glucose' | 'general';

export interface NumericAdjustment {
  metric: string; // coincide con MetricKey de BaselineEngine (ej. 'hydrationL')
  multiplier: number;
  reason: string;
}

export interface MedicalGuidanceEntry {
  id: string; // el ConditionId o MedicationType
  kind: 'condition' | 'medication';
  label: string;
  scopes: KbScope[];
  guidance: string;
  numericAdjustment?: NumericAdjustment;
}

/** Todas las entradas de la KB relevantes al perfil del usuario (condiciones + medicamentos activos), opcionalmente filtradas por scope (siempre incluye 'general'). */
export function getGuidance(medical: MedicalProfile | null | undefined, scope?: KbScope): MedicalGuidanceEntry[] {
  if (!medical) return [];
  const entries: MedicalGuidanceEntry[] = [];

  for (const c of medical.conditions ?? []) {
    const raw = (kb.conditions as Record<string, any>)[c.id];
    if (raw) entries.push({ id: c.id, kind: 'condition', ...raw });
  }
  // El tipo también se infiere del nombre: la app no puede guardar `type`, y sin esto la Empagliflozina y la Vildagliptina
  // del usuario no recibían su guía (Eris improvisaba cómo actuaban; 2026-10-07)
  for (const t of medicationTypes(medical)) {
    const raw = (kb.medications as Record<string, any>)[t];
    if (raw) entries.push({ id: t, kind: 'medication', ...raw });
  }

  return scope ? entries.filter(e => e.scopes.includes(scope) || e.scopes.includes('general')) : entries;
}

/** Ajuste numérico (si existe) para una métrica dada, entre todas las entradas relevantes al perfil del usuario. Usado por BaselineEngine para las referencias genéricas. */
export function getNumericAdjustment(medical: MedicalProfile | null | undefined, metric: string): NumericAdjustment | undefined {
  return getGuidance(medical)
    .map(e => e.numericAdjustment)
    .find((a): a is NumericAdjustment => a?.metric === metric);
}

/** Bloque de texto compacto con las guías cualitativas relevantes, listo para inyectar en un prompt de LLM. */
export function formatGuidanceForLLM(medical: MedicalProfile | null | undefined, scope?: KbScope): string {
  const entries = getGuidance(medical, scope);
  return entries.length ? entries.map(e => `- ${e.guidance}`).join('\n') : '';
}
