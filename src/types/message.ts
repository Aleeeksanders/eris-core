// ============================================================
// Eris — Tipos de Mensajes
// ============================================================

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  output: string;
  error?: string;
  duration?: number;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  thinking?: string;
  isStreaming?: boolean;
  /**
   * Rastro de la respuesta, para revisar después qué hizo Eris (2026-10-16): qué herramientas llamó, cuáles fallaron, si
   * salió al instante y cuánto tardó. Solo nombres y errores, nunca lo que devolvieron (eso tiene datos de la persona).
   * Antes no quedaba nada y no se podía distinguir un «✅ anotado» real de uno inventado.
   */
  trace?: { tools: string[]; errors?: string[]; quick?: boolean; ms?: number; /** K1: citó contenido de otros (mensajes, web): en el historial va marcado como dato */ externo?: boolean };
}

export interface ConversationContext {
  messages: Message[];
  systemPrompt: string;
  tools: ToolDefinition[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function createMessage(
  role: MessageRole,
  content: string,
  extras?: Partial<Message>
): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: new Date(),
    ...extras,
  };
}
