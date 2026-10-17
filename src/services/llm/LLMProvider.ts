// ============================================================
// Eris — LLM Provider Interface
// Abstracción del modelo de lenguaje
// ============================================================

import type { ToolDefinition } from "../../types/message.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  /** Solo en turnos "assistant" que llamaron una tool — necesario para que
   * Ollama pueda re-renderizar correctamente el historial multi-turno la
   * próxima vez que arme el prompt (ver OllamaProvider.ts). Sin esto, el
   * turno queda representado solo por su texto y Ollama pierde el vínculo
   * entre la tool call y su resultado en turnos futuros. */
  toolCalls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  thinking?: string;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
  /** true si la generación fue cancelada a mitad de camino (ver AbortSignal en options) */
  stopped?: boolean;
}

/**
 * Callback para streaming de tokens.
 */
export type StreamCallback = (token: string) => void;

/**
 * Interfaz abstracta para proveedores de LLM.
 * Permite intercambiar entre Ollama (temporal) y el modelo Eris propio (futuro).
 */
export interface LLMProvider {
  /** Nombre del proveedor */
  readonly name: string;

  generate(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      contextLength?: number;
      modelOverride?: string;
      enableThinking?: boolean;
      onToken?: StreamCallback;
      onThinking?: StreamCallback;
      signal?: AbortSignal;
    }
  ): Promise<LLMResponse>;

  /** Verifica si el proveedor está disponible */
  isAvailable(): Promise<boolean>;
}
