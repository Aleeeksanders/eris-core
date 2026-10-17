// ============================================================
// Eris — SymptomGuideTool
//
// Ante un síntoma, molestia o duda de salud ("me va a dar un calambre", "me duele la cabeza", "tengo fiebre") entrega una
// guía CONCRETA: qué hacer ahora, cautelas según el perfil médico del usuario, cuándo consultar y cuándo ir a urgencias.
// La guía y las señales de alarma salen de código (services/SymptomGuide.ts + data/symptom_guide.json); el modelo solo la
// acompaña con una frase cálida. Así Eris ayuda de verdad aunque el modelo sea chico, y nunca responde con un rechazo.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { buildGuide, looksLikeSymptom } from "../services/SymptomGuide.js";
import { isPure } from "../services/Intent.js";
import type { MedicalProfile } from "../memory.js";

const Schema = z.object({
  symptom: z.string().describe("Lo que el usuario cuenta, con SUS palabras: el síntoma, dónde, desde cuándo y qué más siente"),
});
type Input = z.infer<typeof Schema>;

export class SymptomGuideTool extends Tool<Input> {
  readonly name = "symptom_guide";
  readonly description =
    "Orientación de salud para síntomas, molestias y lesiones leves (calambre, dolor de cabeza, mareo, fiebre, náuseas, dolor de espalda, esguince, resfrío, ansiedad, insomnio…): " +
    "qué hacer ahora, cautelas según el perfil médico del usuario, cuándo consultar y señales de alarma. Detecta emergencias. " +
    "Úsala SIEMPRE ante cualquier síntoma o duda de salud; NUNCA respondas con un rechazo ni con «como IA no puedo».";
  readonly inputSchema = Schema;

  /** Si el mensaje describe un síntoma o una señal de alarma, la guía se entrega por código, sin depender de que el modelo la pida. */
  async preroute(message: string): Promise<Record<string, unknown> | null> {
    if (!message || message.length > 600) return null;
    return looksLikeSymptom(message) ? { symptom: message } : null;
  }

  async execute(input: Input, context?: any): Promise<ToolExecutionResult> {
    try {
      const memory = context?.memory;
      const medical: MedicalProfile | undefined = memory ? (await memory.getProfile?.().catch(() => null))?.medical : undefined;
      const g = buildGuide(input.symptom, medical);

      return {
        output:
          `HECHOS CALCULADOS (no inventes nada fuera de esto):\n${g.facts.map((f) => `- ${f}`).join("\n")}\n\n` +
          `[Cómo presentarlo: la guía completa se mostrará AUTOMÁTICAMENTE debajo de tu mensaje: NO la repitas ni la resumas en listas. ` +
          `Escribe 1-2 frases cálidas y directas: empatía y lo PRIMERO que puede hacer ahora mismo. ` +
          `NUNCA digas «como IA no puedo», «alerta de seguridad» ni te niegues a ayudar; no des diagnósticos ni dosis de medicamentos.]`,
        metadata: {
          emergency: g.emergency, matched: g.matched,
          appendToReply: { text: g.block, marker: "# 🩺 (Guía|Orientación)|## 🚨|\\*\\*Sobre el medicamento" },
          // Una emergencia no espera al modelo. Lo demás responde al instante solo si el mensaje pide ESTO y nada más
          // (si mezcla, p. ej., un síntoma y una comida, sigue el camino de siempre para no saltarse la otra parte).
          quickReply: g.emergency || isPure(context?.userMessage, ["symptom"]) ? g.quick : undefined,
        },
      };
    } catch (err) {
      return { output: "", error: `Error en symptom_guide: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
