// ============================================================
// Eris — Context Compressor
// Comprime conversaciones largas en resúmenes usando el LLM
// ============================================================

import type { LLMProvider, LLMMessage } from "./llm/LLMProvider.js";
import type { Message } from "../types/message.js";

// El nombre de la persona va en cada resumen: antes decía «Alex» en TODAS las cuentas (revisión 2026-11-04, P3)
const compressionPrompt = (nombre: string) => `Eres un asistente de compresión de contexto. Tu trabajo es resumir una conversación entre ${nombre} y su IA Eris, preservando los puntos clave.

REGLAS:
- Resume en máximo 3-4 oraciones
- Preserva: nombres mencionados, decisiones tomadas, datos técnicos, preferencias del usuario
- Usa formato: "${nombre} preguntó/pidió X. Eris respondió/hizo Y."
- NO inventes información que no esté en la conversación
- Si hay un resumen previo, intégralo con el nuevo

Responde SOLO con el resumen, nada más.`;

export class ContextCompressor {
  private provider: LLMProvider;
  private isCompressing = false;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  /**
   * Comprime mensajes en un resumen conciso.
   * Se ejecuta en background, no bloquea la respuesta al usuario.
   */
  async compress(
    messages: Message[],
    existingSummary?: string | null,
    nombre?: string | null
  ): Promise<string> {
    // Ocupado con otra: nada (vacío = no se toca el resumen ni se dan por resumidos esos mensajes)
    if (this.isCompressing) return "";
    const quien = String(nombre ?? "").trim().slice(0, 40) || "la persona";
    this.isCompressing = true;

    try {
      // Construir la conversación a resumir
      const conversationText = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => {
          const name = m.role === "user" ? quien : "Eris";
          const clean = m.content
            .replace(/<think>[\s\S]*?<\/think>/g, "")
            .trim();
          return `${name}: ${clean}`;
        })
        .join("\n");

      let prompt = `Resume esta conversación:\n\n${conversationText}`;
      if (existingSummary) {
        prompt = `Resumen previo de la conversación:\n"${existingSummary}"\n\nNuevos mensajes a integrar:\n\n${conversationText}`;
      }

      const llmMessages: LLMMessage[] = [
        { role: "system", content: compressionPrompt(quien) },
        { role: "user", content: prompt },
      ];

      // Sin razonamiento: con él, los 256 tokens se iban en "pensar" y el resumen volvía VACÍO (medido: 21,5 s y "") —
      // y ese vacío reemplazaba al resumen anterior. Sin él: ~7 s y un resumen real.
      const response = await this.provider.generate(llmMessages, undefined, {
        temperature: 0.3,
        maxTokens: 256,
        enableThinking: false,
      });

      return response.content.trim() || existingSummary || "";
    } catch (err) {
      console.error("Error comprimiendo contexto:", err);
      return existingSummary || "";
    } finally {
      this.isCompressing = false;
    }
  }
}
