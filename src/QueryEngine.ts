// ============================================================
// Eris — QueryEngine
// Motor de consultas y loop agéntico con streaming
// Soporta modos de pensamiento (Flash / Deep / Auto)
// ============================================================

import type {
  LLMProvider,
  LLMMessage,
  StreamCallback,
} from "./services/llm/LLMProvider.js";
import type { Message, ToolCall, ToolResult } from "./types/message.js";
import type { ThinkingMode, ThinkingModeConfig } from "./types/config.js";
import { ToolRegistry } from "./tools.js";
import { createMessage } from "./types/message.js";
import { resolveMode } from "./types/config.js";

const MAX_TOOL_ITERATIONS = 10;

export interface QueryResult {
  message: Message;
  modeUsed: "flash" | "deep";
  modelUsed: string;
}

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
   * Ejecuta una consulta con loop agéntico, streaming y modo de pensamiento.
   */
  async query(
    userMessage: string,
    conversationHistory: Message[],
    callbacks?: {
      onThinking?: (text: string) => void;
      onToolCall?: (toolCall: ToolCall) => void;
      onToolResult?: (result: ToolResult) => void;
      onToken?: StreamCallback;
      onModeResolved?: (mode: "flash" | "deep", model: string) => void;
    },
    contextSummary?: string | null,
    mode: ThinkingMode = "auto",
    toolContext?: any
  ): Promise<QueryResult> {
    // ─── Resolver modo ──────────────────────────────────────
    const { resolved: modeConfig, actualMode } = resolveMode(mode, userMessage);
    callbacks?.onModeResolved?.(actualMode, modeConfig.model);

    // ─── Construir mensajes ─────────────────────────────────
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

    // Instrucciones según modo
    const modeInstruction = actualMode === "flash"
      ? `MODO FLASH ACTIVO.
Reglas absolutas:
- Responde en 1-3 oraciones máximas salvo que la pregunta requiera más.
- Primera oración = la respuesta. Sin preámbulos.
- Sin listas, sin headers, sin estructura. Solo texto directo.
- Sin razonamiento visible. No pienses en voz alta.
- Si no tienes datos suficientes, pide solo lo que necesitas en una sola pregunta.`
      : `MODO DEEP ACTIVO.
Reglas:
- Analiza el problema desde primeros principios antes de responder.
- Usa tus herramientas disponibles para obtener contexto real antes de asumir.
- Sé exhaustivo pero no verboso — cada oración debe aportar información nueva.
- Estructura la respuesta con headers si tiene más de 3 secciones distintas.
- Señala explícitamente incertidumbres y riesgos cuando los hay.
- Concluye siempre con una recomendación accionable concreta.`;

    llmMessages.push(
      ...this.convertHistory(conversationHistory),
      { role: "system", content: modeInstruction },
      { role: "user", content: userMessage }
    );

    // ─── Definir herramientas según modo ────────────────────
    // Flash: sin herramientas para máxima velocidad (a menos que el query lo requiera)
    const toolDefinitions = actualMode === "flash"
      ? [] 
      : this.toolRegistry.getDefinitions();

    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      const isFirstOrToolIteration = iterations > 1;

      const response = await this.provider.generate(
        llmMessages,
        toolDefinitions.length > 0 ? toolDefinitions : undefined,
        {
          temperature: modeConfig.temperature,
          maxTokens: modeConfig.maxTokens,
          contextLength: modeConfig.contextLength,
          modelOverride: modeConfig.model,
          enableThinking: modeConfig.enableThinking,
          onToken: isFirstOrToolIteration ? undefined : callbacks?.onToken,
          onThinking: isFirstOrToolIteration ? undefined : callbacks?.onThinking,
        }
      );

      // Si no hay tool calls, respuesta final
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return {
          message: createMessage("assistant", response.content, {
            thinking: response.thinking,
          }),
          modeUsed: actualMode,
          modelUsed: modeConfig.model,
        };
      }

      // Hay tool calls — ejecutarlas (sin streaming)
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
            error: `Herramienta "${tc.name}" no encontrada.`,
          };
          toolResults.push(result);
          callbacks?.onToolResult?.(result);
          continue;
        }

        const startTime = Date.now();
        const execResult = await tool.run(tc.input, toolContext);
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
    }

    return {
      message: createMessage(
        "assistant",
        "He alcanzado el límite de iteraciones de herramientas."
      ),
      modeUsed: actualMode,
      modelUsed: modeConfig.model,
    };
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
