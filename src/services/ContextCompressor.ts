// ============================================================
// Eris — Context Compressor
// Comprime conversaciones largas en resúmenes usando el LLM
// ============================================================

import type { LLMProvider, LLMMessage } from "./llm/LLMProvider.js";
import type { Message } from "../types/message.js";

const COMPRESSION_PROMPT = `Eres un asistente de compresión de contexto. Tu trabajo es resumir una conversación entre Alex y su IA Eris, preservando los puntos clave.

REGLAS:
- Resume en máximo 3-4 oraciones
- Preserva: nombres mencionados, decisiones tomadas, datos técnicos, preferencias del usuario
- Usa formato: "Alex preguntó/pidió X. Eris respondió/hizo Y."
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
    existingSummary?: string | null
  ): Promise<string> {
    if (this.isCompressing) return existingSummary || "";
    this.isCompressing = true;

    try {
      // Construir la conversación a resumir
      const conversationText = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => {
          const name = m.role === "user" ? "Alex" : "Eris";
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
        { role: "system", content: COMPRESSION_PROMPT },
        { role: "user", content: prompt },
      ];

      const response = await this.provider.generate(llmMessages, undefined, {
        temperature: 0.3,
        maxTokens: 256,
      });

      return response.content.trim();
    } catch (err) {
      console.error("Error comprimiendo contexto:", err);
      return existingSummary || "";
    } finally {
      this.isCompressing = false;
    }
  }
}
