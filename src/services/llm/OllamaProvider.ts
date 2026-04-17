// ============================================================
// Eris — Ollama Local Provider
// Conexión al LLM temporal via Ollama con streaming
// ============================================================

import type {
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMToolCall,
  StreamCallback,
} from "./LLMProvider.js";
import type { ToolDefinition } from "../../types/message.js";

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = "http://localhost:11434", model = "qwen2.5:3b") {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      onToken?: StreamCallback;
      onThinking?: StreamCallback;
    }
  ): Promise<LLMResponse> {
    const processedMessages = this.injectToolInstructions(messages, tools);
    const isStreaming = !!options?.onToken;

    const body = {
      model: this.model,
      messages: processedMessages.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: m.content,
      })),
      stream: isStreaming,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 2048,
        num_ctx: 4096, // Optimizado para RTX 3050 y prompt extenso
      },
    };

    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Ollama HTTP ${res.status}: ${errorText}`);
      }

      if (isStreaming) {
        return await this.handleStream(res, options!.onToken!, options?.onThinking);
      } else {
        return await this.handleNonStream(res);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error("Timeout: el modelo tardó demasiado (>2min)");
      }
      throw new Error(
        `Error con Ollama: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Maneja respuesta con streaming — parsea <think> tags internamente.
   * Enfoque simple: acumula todo el contenido y en cada token recalcula
   * qué es thinking y qué es respuesta, emitiendo solo lo nuevo.
   */
  private async handleStream(
    res: Response,
    onToken: StreamCallback,
    onThinking?: StreamCallback
  ): Promise<LLMResponse> {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No se pudo obtener el stream");

    const decoder = new TextDecoder();
    let fullContent = "";
    let promptTokens = 0;
    let completionTokens = 0;

    // Tracking de lo que ya se emitió
    let lastThinkEmitted = 0;
    let lastResponseEmitted = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);

          if (data.message?.content) {
            fullContent += data.message.content;

            // Extraer thinking y respuesta del contenido acumulado
            const thinkMatch = fullContent.match(/<think>([\s\S]*?)(<\/think>|$)/);

            if (thinkMatch) {
              const thinkText = thinkMatch[1];
              const thinkClosed = thinkMatch[2] === "</think>";

              // Emitir thinking nuevo — pero retener posible </think> parcial
              if (onThinking && !thinkClosed) {
                // Retener chars que podrían ser inicio de </think>
                const safeThink = this.getSafeThinkToEmit(thinkText);
                if (safeThink.length > lastThinkEmitted) {
                  const newThink = safeThink.slice(lastThinkEmitted);
                  onThinking(newThink);
                  lastThinkEmitted = safeThink.length;
                }
              } else if (onThinking && thinkClosed && thinkText.length > lastThinkEmitted) {
                // Think cerrado — emitir lo que falta sin retener
                const newThink = thinkText.slice(lastThinkEmitted);
                onThinking(newThink);
                lastThinkEmitted = thinkText.length;
              }

              // Si el think cerró, emitir respuesta
              if (thinkClosed) {
                const thinkEnd = fullContent.indexOf("</think>") + "</think>".length;
                const responseText = fullContent.slice(thinkEnd);
                if (responseText.length > lastResponseEmitted) {
                  const newResponse = responseText.slice(lastResponseEmitted);
                  onToken(newResponse);
                  lastResponseEmitted = responseText.length;
                }
              }
            } else {
              // No hay think — todo es respuesta directa
              if (fullContent.length > lastResponseEmitted) {
                // Pero no emitir si podría ser inicio de <think>
                const safe = this.getSafeToEmit(fullContent, lastResponseEmitted);
                if (safe.length > 0) {
                  onToken(safe);
                  lastResponseEmitted += safe.length;
                }
              }
            }
          }

          if (data.done) {
            promptTokens = data.prompt_eval_count || 0;
            completionTokens = data.eval_count || 0;
          }
        } catch {
          // Ignorar líneas no-JSON
        }
      }
    }

    // Contenido final limpio
    const cleanContent = fullContent
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim();

    const toolCalls = this.parseToolCalls(cleanContent);
    const finalContent =
      toolCalls.length > 0
        ? this.removeToolCallsFromContent(cleanContent)
        : cleanContent;

    return {
      content: finalContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: fullContent.match(/<think>([\s\S]*?)<\/think>/)?.[1]?.trim(),
      tokensUsed: {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens,
      },
    };
  }

  /**
   * Determina cuánto del contenido es seguro emitir sin riesgo de cortar un <think> parcial.
   */
  private getSafeToEmit(fullContent: string, fromIdx: number): string {
    const remaining = fullContent.slice(fromIdx);
    const partial = "<think>";
    // Chequear si el final podría ser inicio de <think>
    for (let i = 1; i < partial.length; i++) {
      if (remaining.endsWith(partial.slice(0, i))) {
        return remaining.slice(0, -i);
      }
    }
    return remaining;
  }

  /**
   * Determina cuánto del thinking es seguro emitir sin riesgo de cortar </think> parcial.
   */
  private getSafeThinkToEmit(thinkText: string): string {
    const closeTag = "</think>";
    for (let i = 1; i < closeTag.length; i++) {
      if (thinkText.endsWith(closeTag.slice(0, i))) {
        return thinkText.slice(0, -i);
      }
    }
    return thinkText;
  }

  /**
   * Maneja respuesta sin streaming (todo de una).
   */
  private async handleNonStream(res: Response): Promise<LLMResponse> {
    const data = (await res.json()) as any;
    const content = data.message?.content || "";

    const toolCalls = this.parseToolCalls(content);
    const cleanContent =
      toolCalls.length > 0
        ? this.removeToolCallsFromContent(content)
        : content;

    return {
      content: cleanContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      tokensUsed: {
        prompt: data.prompt_eval_count || 0,
        completion: data.eval_count || 0,
        total:
          (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    };
  }

  /**
   * Inyecta instrucciones de tool calling en el system prompt.
   */
  private injectToolInstructions(
    messages: LLMMessage[],
    tools?: ToolDefinition[]
  ): LLMMessage[] {
    if (!tools || tools.length === 0) return messages;

    const toolDescriptions = tools
      .map((t) => {
        const params = t.inputSchema as any;
        const props = params?.properties || {};
        const paramList = Object.entries(props)
          .map(
            ([key, val]: [string, any]) =>
              `    - "${key}": ${val?.description || val?.type || "string"}`
          )
          .join("\n");
        return `- **${t.name}**: ${t.description}\n  Parámetros:\n${paramList}`;
      })
      .join("\n\n");

    const toolInstructions = `

## Herramientas disponibles
Para usar una herramienta, escribe un bloque JSON así:

\`\`\`tool
{"name": "nombre_herramienta", "arguments": {"param1": "valor1"}}
\`\`\`

HERRAMIENTAS:
${toolDescriptions}

REGLAS DE USO:
1. SIEMPRE usa un bloque \`\`\`tool ... \`\`\` cuando necesites ejecutar una herramienta
2. Puedes escribir texto antes o después del bloque tool
3. Usa UNA herramienta por bloque
4. Los argumentos deben ser JSON válido
5. Si necesitas información del sistema, USA las herramientas, no inventes datos`;

    const result = [...messages];
    if (result.length > 0 && result[0].role === "system") {
      result[0] = {
        ...result[0],
        content: result[0].content + toolInstructions,
      };
    }

    return result;
  }

  /**
   * Parsea tool calls del contenido del mensaje.
   */
  private parseToolCalls(content: string): LLMToolCall[] {
    const toolCalls: LLMToolCall[] = [];
    let match;

    // Patrón 1: ```tool { ... } ```
    const toolBlockRegex = /```tool\s*\n?([\s\S]*?)```/gi;
    while ((match = toolBlockRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed.name) {
          toolCalls.push({
            id: `call_${Date.now()}_${toolCalls.length}`,
            name: parsed.name,
            arguments:
              parsed.arguments || parsed.params || parsed.input || {},
          });
        }
      } catch {}
    }

    // Patrón 2: ```json con tool call ```
    if (toolCalls.length === 0) {
      const jsonBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/gi;
      while ((match = jsonBlockRegex.exec(content)) !== null) {
        try {
          const parsed = JSON.parse(match[1].trim());
          if (
            parsed.name &&
            (parsed.arguments || parsed.params || parsed.input)
          ) {
            toolCalls.push({
              id: `call_${Date.now()}_${toolCalls.length}`,
              name: parsed.name,
              arguments:
                parsed.arguments || parsed.params || parsed.input || {},
            });
          }
        } catch {}
      }
    }

    // Patrón 3: JSON suelto
    if (toolCalls.length === 0) {
      const jsonRegex =
        /\{[^{}]*"name"\s*:\s*"(\w+)"[^{}]*"arguments"\s*:\s*(\{[^{}]*\})[^{}]*\}/gi;
      while ((match = jsonRegex.exec(content)) !== null) {
        try {
          const parsed = JSON.parse(match[0]);
          if (parsed.name) {
            toolCalls.push({
              id: `call_${Date.now()}_${toolCalls.length}`,
              name: parsed.name,
              arguments: parsed.arguments || {},
            });
          }
        } catch {}
      }
    }

    return toolCalls;
  }

  /**
   * Remueve bloques de tool call del contenido.
   */
  private removeToolCallsFromContent(content: string): string {
    return content
      .replace(/```tool\s*\n?[\s\S]*?```/gi, "")
      .replace(
        /```(?:json)?\s*\n?\s*\{[\s\S]*?"name"[\s\S]*?\}[\s\S]*?```/gi,
        ""
      )
      .replace(
        /\{[^{}]*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\}/g,
        ""
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}
