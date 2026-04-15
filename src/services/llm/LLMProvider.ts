// ============================================================
// Eris — LLM Provider Interface
// Abstracción del modelo de lenguaje
// ============================================================

import type { ToolDefinition } from "../types/message.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
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
      onToken?: StreamCallback;
      onThinking?: StreamCallback;
    }
  ): Promise<LLMResponse>;

  /** Verifica si el proveedor está disponible */
  isAvailable(): Promise<boolean>;
}
