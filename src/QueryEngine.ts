// ============================================================
// Eris — QueryEngine
// Motor de consultas y loop agéntico con streaming
// ============================================================

import type {
  LLMProvider,
  LLMMessage,
  StreamCallback,
} from "./services/llm/LLMProvider.js";
import type { Message, ToolCall, ToolResult } from "./types/message.js";
import { ToolRegistry } from "./tools.js";
import { createMessage } from "./types/message.js";

const MAX_TOOL_ITERATIONS = 10;

export class QueryEngine {
  private provider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private systemPrompt: string;

  constructor(
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    systemPrompt: string
  ) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.systemPrompt = systemPrompt;
  }

  /**
   * Ejecuta una consulta con loop agéntico y streaming.
   */
  async query(
    userMessage: string,
    conversationHistory: Message[],
    callbacks?: {
      onThinking?: (text: string) => void;
      onToolCall?: (toolCall: ToolCall) => void;
      onToolResult?: (result: ToolResult) => void;
      onToken?: StreamCallback;
    },
    contextSummary?: string | null
  ): Promise<Message> {
    const llmMessages: LLMMessage[] = [
      { role: "system", content: this.systemPrompt },
    ];

    // Inyectar resumen de contexto previo si existe
    if (contextSummary) {
      llmMessages.push({
        role: "system",
        content: `[Contexto de conversación previa]\n${contextSummary}`,
      });
    }

    llmMessages.push(
      ...this.convertHistory(conversationHistory),
      { 
        role: "system", 
        content: `EJECUCIÓN AXS: 
1. Si el pedido implica conceptos técnicos o históricos, usa 'knowledge_search'.
2. Ejecuta herramientas para dar una solución definitiva (x500).
3. Sé extremadamente eficiente y concisa.` 
      },
      { role: "user", content: userMessage }
    );

    const toolDefinitions = this.toolRegistry.getDefinitions();
    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      // Solo streaming en la última iteración (sin tools pendientes)
      // En iteraciones intermedias (con tools), no hacemos streaming
      // porque necesitamos parsear tool calls completas
      const isFirstOrToolIteration = iterations > 1;

      const response = await this.provider.generate(
        llmMessages,
        toolDefinitions,
        {
          temperature: 0.7,
          maxTokens: 2048,
          onToken: isFirstOrToolIteration ? undefined : callbacks?.onToken,
          onThinking: isFirstOrToolIteration ? undefined : callbacks?.onThinking,
        }
      );

      // Si no hay tool calls, respuesta final
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return createMessage("assistant", response.content, {
          thinking: response.thinking,
        });
      }

      // Hay tool calls — ejecutarlas (sin streaming)
      // Si hubo streaming parcial, notificar que paramos para tools
      const toolCalls: ToolCall[] = response.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        input: tc.arguments,
      }));

      const toolResults: ToolResult[] = [];

      llmMessages.push({
        role: "assistant",
        content: response.content || "",
      });

      for (const tc of toolCalls) {
        callbacks?.onToolCall?.(tc);

        const tool = this.toolRegistry.get(tc.name);

        if (!tool) {
          const result: ToolResult = {
            toolCallId: tc.id,
            name: tc.name,
            output: "",
            error: `Herramienta "${tc.name}" no encontrada. Disponibles: ${this.toolRegistry.listNames().join(", ")}`,
          };
          toolResults.push(result);
          callbacks?.onToolResult?.(result);
          continue;
        }

        const startTime = Date.now();
        const execResult = await tool.run(tc.input);
        const duration = Date.now() - startTime;

        const result: ToolResult = {
          toolCallId: tc.id,
          name: tc.name,
          output: execResult.output,
          error: execResult.error,
          duration,
        };

        toolResults.push(result);
        callbacks?.onToolResult?.(result);
      }

      // Alimentar resultados al LLM
      for (const result of toolResults) {
        const content = result.error
          ? `Error: ${result.error}\nOutput: ${result.output}`
          : result.output;

        llmMessages.push({
          role: "tool",
          content: `[Resultado de ${result.name}]\n${content}`,
          toolCallId: result.toolCallId,
        });
      }

      // La siguiente iteración usará streaming para la respuesta final
    }

    return createMessage(
      "assistant",
      "He alcanzado el límite de iteraciones de herramientas."
    );
  }

  private convertHistory(messages: Message[]): LLMMessage[] {
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
  }
}
