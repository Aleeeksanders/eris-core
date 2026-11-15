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
import { plannerFor, parseKeepAlive } from "./ContextPlanner.js";
import { registrarLlamada } from "./ModelMeter.js";

/**
 * Cuánto tiempo Ollama mantiene el modelo cargado tras el último uso (ERIS_KEEP_ALIVE, por defecto 30m). Con 5m el modelo se
 * descargaba a los 5 minutos y el primer mensaje siguiente pagaba la recarga (~5 s + leer de nuevo el prompt, ~10-30 s en total).
 * Mantenerlo cargado ocupa ~3,5 GB de VRAM: si necesitas la GPU para otra cosa (juegos), usa ERIS_KEEP_ALIVE=5m.
 */
export const KEEP_ALIVE = process.env.ERIS_KEEP_ALIVE || "30m";

class ThinkingLoopError extends Error {
  constructor() { super("thinking_loop_detected"); }
}

// Patrones que indican bucle de razonamiento (aparecen repetidos)
const LOOP_PATTERNS = [/\*\*Decisión\*\*/g, /\*\*Refinamiento\*\*/g, /\*\*Plan de respuesta\*\*/g, /\*\*Análisis\*\*/g];
const LOOP_THRESHOLD = 4; // si algún patrón aparece ≥4 veces, es bucle
const LOOP_MAX_CHARS  = 32000; // cortar si el thinking supera 4000 chars sin cerrar

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = "http://localhost:11434", model = "qwen3.5:4b") {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  /**
   * Carga el modelo en memoria SIN generar nada (petición sin mensajes), para que el primer mensaje real no pague la carga.
   * Se pide el mismo contexto base que se usará después, así no hace falta recargar. Falla en silencio.
   */
  async warmup(model?: string, contextLength = 8192): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || this.model, messages: [], keep_alive: KEEP_ALIVE, options: { num_ctx: contextLength } }),
        signal: AbortSignal.timeout(120000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Qué fracción del modelo cargado está en la tarjeta de video (1 = entero en GPU, 0 = entero en el procesador), según
   * `/api/ps` de Ollama. null si no se pudo saber. Ver ContextPlanner.markOffloaded.
   */
  /** Descarga el modelo de la memoria (la próxima llamada lo vuelve a cargar, con la tarjeta de video libre). */
  async unload(model?: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || this.model, keep_alive: 0 }), signal: AbortSignal.timeout(5000) });
    } catch { /* si no responde, queda como estaba */ }
  }

  async gpuFraction(model?: string): Promise<number | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/ps`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return null;
      const data = await res.json() as { models?: Array<{ name?: string; model?: string; size?: number; size_vram?: number }> };
      const want = model || this.model;
      const m = data.models?.find((x) => x.name === want || x.model === want);
      if (!m || !m.size) return null;
      return (m.size_vram ?? 0) / m.size;
    } catch {
      return null;
    }
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
      contextLength?: number;
      modelOverride?: string;
      enableThinking?: boolean;
      onToken?: StreamCallback;
      onThinking?: StreamCallback;
      signal?: AbortSignal;
    }
  ): Promise<LLMResponse> {
    const isStreaming = !!options?.onToken;
    const activeModel = options?.modelOverride || this.model;

    const body = {
      model: activeModel,
      // Antes esto convertía role:"tool" a "user" y descartaba tool_calls/
      // tool_call_id por completo — Ollama (vía la plantilla de Qwen) espera
      // el rol "tool" real y el tool_calls del turno assistant que lo
      // originó para poder re-renderizar correctamente una conversación
      // multi-turno con tools. Con el shape roto, confirmado con curl
      // directo, Ollama a veces fallaba al re-renderizar el historial en un
      // turno POSTERIOR (error interno de parseo de su propia plantilla,
      // no algo que nosotros generáramos) — el bug era acumulativo, no
      // aparecía en el turno donde se llamaba la tool sino en el siguiente
      // mensaje de la misma conversación.
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.role === "tool" && m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0
          ? { tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, function: { name: tc.name, arguments: tc.arguments } })) }
          : {}),
      })),
      // Tool calling NATIVO de Ollama (/api/chat acepta "tools" y devuelve
      // message.tool_calls estructurado) — antes esto se simulaba pidiéndole
      // al modelo por texto que escribiera un bloque ```tool {json}``` y
      // parseándolo con regex (ver parseToolCalls, que queda solo como
      // fallback). Era frágil: el modelo respondía en texto normal la mayoría
      // de las veces en vez de emitir el bloque, así que las tools casi nunca
      // se ejecutaban de verdad. Confirmado con Ollama real (curl directo a
      // /api/chat con "tools") que el modelo SÍ soporta tool calling nativo
      // de forma confiable — este es el camino correcto, no un truco de prompt.
      tools: tools && tools.length > 0 ? this.formatToolsForOllama(tools) : undefined,
      stream: isStreaming,
      // Parámetro nativo Ollama/Qwen3: false = sin <think>, directo al grano
      think: options?.enableThinking ?? true,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 2048,
        // Sin contexto pedido (resumen del historial, voz, tarjeta del día, reportes…): el MISMO que tiene cargado el chat.
        // Antes iba 4096 y cambiar num_ctx obliga a Ollama a recargar el modelo: medido 24,8 s para bajar a 4096 y 5,4 s
        // para volver a 8192 en el mensaje siguiente, que además esperaba en cola detrás de esa recarga.
        num_ctx: options?.contextLength ?? plannerFor(activeModel, parseKeepAlive(KEEP_ALIVE)).forSideCall(),
      },
      keep_alive: KEEP_ALIVE,
    };

    // Cuánto ocupó esta llamada (medición de la beta, ModelMeter): lo que trabajó el modelo y lo que esperó en cola.
    // Un reintento cuenta aparte: el intento que falló también ocupó el equipo.
    const t0 = Date.now();
    let medida: LLMResponse | null = null;
    try {
      // Combinar el timeout de siempre con el AbortSignal opcional que pasa el
      // caller (server.ts, cuando el usuario toca "detener") — así un abort
      // externo corta este fetch exactamente igual que el timeout ya lo hacía.
      const timeoutSignal = AbortSignal.timeout(300000);
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options?.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Ollama HTTP ${res.status}: ${errorText}`);
      }

      medida = isStreaming
        ? await this.handleStream(res, options!.onToken!, options?.onThinking, options?.signal)
        : await this.handleNonStream(res);
      registrarLlamada(Date.now() - t0, medida.modeloMs ?? null, true);
      return medida;
    } catch (err) {
      if (!medida) registrarLlamada(Date.now() - t0, null, false);
      // Bucle detectado en thinking → reintentar sin thinking para sacar respuesta directa
      if (err instanceof ThinkingLoopError) {
        if (options?.onThinking) {
          options.onThinking("\n\n⚠️ [Razonamiento en bucle — respondiendo directamente...]");
        }
        return this.generate(messages, tools, {
          ...options,
          enableThinking: false,
          modelOverride: options?.modelOverride,
          // Quitar onThinking para que el retry no emita más thinking
          onThinking: undefined,
        });
      }
      // Cancelación explícita del usuario (botón "detener") — no es un error real,
      // devolvemos una respuesta vacía marcada como "stopped" en vez de throw.
      if (err instanceof DOMException && err.name === "AbortError" && options?.signal?.aborted) {
        return { content: "", stopped: true };
      }
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error("Timeout: el modelo tardó demasiado (>5 min)");
      }
      // El proceso del modelo se cayó antes de responder («HTTP 500: EOF»: se quedó sin memoria o se estaba recargando).
      // Pasa de vez en cuando con la RAM justa; antes la persona recibía un error. Se reintenta UNA vez: el error llega
      // antes de cualquier texto, así que no se duplica nada (banco de chat 2026-11-04, «v1-cena» dos veces).
      if (err instanceof Error && /^Ollama HTTP 5\d\d/.test(err.message) && /EOF|runner|terminated|unexpectedly|connection/i.test(err.message)
        && !(options as any)?._reintento && !options?.signal?.aborted) {
        console.warn(`[Ollama] ${err.message.slice(0, 80)}: reintento una vez`);
        await new Promise((r) => setTimeout(r, 1500));
        return this.generate(messages, tools, { ...options, _reintento: true } as any);
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
    onThinking?: StreamCallback,
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No se pudo obtener el stream");

    const decoder = new TextDecoder();
    let fullContent = "";
    let nativeThinking = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let modeloMs: number | undefined;
    const nativeToolCalls: LLMToolCall[] = [];
    let wasStopped = false;

    // Tracking de lo que ya se emitió
    let lastThinkEmitted = 0;
    let lastResponseEmitted = 0;

    while (true) {
      // Cancelación explícita a mitad de stream (botón "detener"): cortamos el
      // loop en vez de relanzar, así el código de limpieza de abajo (que arma
      // cleanContent/finalContent) igual corre y devuelve una respuesta parcial
      // coherente en vez de perder todo lo ya generado.
      if (signal?.aborted) {
        wasStopped = true;
        await reader.cancel().catch(() => {});
        break;
      }

      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          wasStopped = true;
          await reader.cancel().catch(() => {});
          break;
        }
        throw err;
      }
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);

          if (data.message?.thinking) {
            nativeThinking += data.message.thinking;
            if (onThinking) onThinking(data.message.thinking);
          }

          // Tool calling nativo — llega en su propio chunk, separado del texto,
          // con "arguments" ya como objeto (no hace falta JSON.parse).
          if (data.message?.tool_calls?.length) {
            for (const tc of data.message.tool_calls) {
              nativeToolCalls.push({
                id: tc.id || `call_${Date.now()}_${nativeToolCalls.length}`,
                name: tc.function?.name,
                arguments: tc.function?.arguments || {},
              });
            }
          }

          if (data.message?.content) {
            const chunkContent = data.message.content;
            fullContent += chunkContent;

            // ── Detección de bucle de razonamiento ──────────────────────
            // Si algún patrón de thinking aparece ≥ LOOP_THRESHOLD veces,
            // o el thinking acumulado supera LOOP_MAX_CHARS sin cerrar,
            // cancelamos el stream y reintentamos sin thinking.
            const thinkOpenIdx = fullContent.indexOf("<think>");
            const thinkCloseIdx = fullContent.indexOf("</think>");
            const insideThinking = thinkOpenIdx !== -1 && thinkCloseIdx === -1;
            const nativeThinkingOnly = nativeThinking.length > 0;

            if (insideThinking || nativeThinkingOnly) {
              const thinkContent = nativeThinkingOnly ? nativeThinking : fullContent.slice(thinkOpenIdx + 7);
              const isLoop = LOOP_PATTERNS.some(p => (thinkContent.match(p) ?? []).length >= LOOP_THRESHOLD);
              const isTooLong = thinkContent.length > LOOP_MAX_CHARS;
              if (isLoop || isTooLong) {
                await reader.cancel().catch(() => {});
                throw new ThinkingLoopError();
              }
            }

            // Si Ollama está enviando thinking nativo, el content ya viene limpio
            if (nativeThinking.length > 0) {
              if (onToken) onToken(chunkContent);
            } else {
              // Fallback para modelos/versiones que mezclan <think> en el content
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
          }

          if (data.done) {
            promptTokens = data.prompt_eval_count || 0;
            completionTokens = data.eval_count || 0;
            if (typeof data.total_duration === "number") modeloMs = data.total_duration / 1e6;
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

    const rawThinking = nativeThinking || fullContent.match(/<think>([\s\S]*?)<\/think>/)?.[1]?.trim();
    
    // Si el contenido limpio está vacío pero hay "thinking", usar el thinking como respuesta
    // Esto ocurre con modelos que no cierran bien el tag o ponen todo dentro.
    const finalDisplayContent = cleanContent || rawThinking || "";

    // Preferir tool calls nativos (confiables); el parseo por regex del texto
    // queda solo como red de seguridad si por algún motivo no llegó ninguno
    // nativo pero el modelo igual escribió un bloque ```tool``` a mano.
    // Si se canceló a mitad de stream, un tool call puede haber llegado
    // incompleto — no lo ejecutamos, solo devolvemos el texto parcial.
    const toolCalls = wasStopped
      ? []
      : nativeToolCalls.length > 0
        ? nativeToolCalls
        : this.parseToolCalls(finalDisplayContent);
    const finalContent =
      toolCalls.length > 0 && nativeToolCalls.length === 0
        ? this.removeToolCallsFromContent(finalDisplayContent)
        : finalDisplayContent;

    return {
      content: finalContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: rawThinking,
      stopped: wasStopped,
      tokensUsed: {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens,
      },
      ...(modeloMs !== undefined ? { modeloMs } : {}),
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

    const nativeToolCalls: LLMToolCall[] = (data.message?.tool_calls || []).map((tc: any, i: number) => ({
      id: tc.id || `call_${Date.now()}_${i}`,
      name: tc.function?.name,
      arguments: tc.function?.arguments || {},
    }));

    // Preferir tool calls nativos (confiables); el parseo por regex queda solo
    // como red de seguridad si no llegó ninguno nativo.
    const toolCalls = nativeToolCalls.length > 0 ? nativeToolCalls : this.parseToolCalls(content);
    const cleanContent =
      toolCalls.length > 0 && nativeToolCalls.length === 0
        ? this.removeToolCallsFromContent(content)
        : content;

    return {
      content: cleanContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: data.message?.thinking,
      tokensUsed: {
        prompt: data.prompt_eval_count || 0,
        completion: data.eval_count || 0,
        total:
          (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      ...(typeof data.total_duration === "number" ? { modeloMs: data.total_duration / 1e6 } : {}),
    };
  }

  /**
   * Convierte nuestras ToolDefinition (name/description/inputSchema) al formato
   * que espera /api/chat de Ollama para tool calling nativo. inputSchema ya
   * viene en forma de JSON Schema (Tool.ts la genera así), encaja directo.
   */
  private formatToolsForOllama(tools: ToolDefinition[]): any[] {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
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
