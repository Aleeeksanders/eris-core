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
