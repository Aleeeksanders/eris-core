// ============================================================
// Eris — Web Server
// Servidor HTTP + WebSocket con proyectos + compresión de contexto
// ============================================================

import { QueryEngine } from "./QueryEngine.js";
import { ToolRegistry } from "./tools.js";
import { OllamaProvider } from "./services/llm/OllamaProvider.js";
import { ContextCompressor } from "./services/ContextCompressor.js";
import { loadSystemPrompt } from "./context.js";
import { DEFAULT_CONFIG } from "./types/config.js";
import { Memory } from "./memory.js";
import { join } from "path";
import type { Message } from "./types/message.js";
import { createMessage } from "./types/message.js";

const PORT = 3000;
const CONTEXT_RECENT = 12; // Mensajes recientes a enviar al modelo
const COMPRESS_THRESHOLD = 16; // Comprimir cuando hay más de esto

async function startServer() {
  const provider = new OllamaProvider(
    DEFAULT_CONFIG.llm.baseUrl,
    DEFAULT_CONFIG.llm.model
  );

  const isAvailable = await provider.isAvailable();
  if (!isAvailable) {
    console.log("⚠️  Ollama no está disponible. Ejecuta: ollama serve");
    process.exit(1);
  }

  const promptPath = join((import.meta as any).dir, "..", "data", "system-prompt.md");
  const systemPrompt = await loadSystemPrompt(promptPath);
  const toolRegistry = new ToolRegistry();
  const queryEngine = new QueryEngine(provider, toolRegistry, systemPrompt);
  const compressor = new ContextCompressor(provider);

  const memory = new Memory();
  await memory.load();
  console.log("  💾 Memoria cargada");

  const sessions = new Map<string, Message[]>();
  const webDir = join((import.meta as any).dir, "..", "web");

  const server = Bun.serve({
    port: PORT,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const sessionId = url.searchParams.get("session") || crypto.randomUUID();
        const upgraded = server.upgrade(req, { data: { sessionId } });
        if (upgraded) return undefined as any;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      if (url.pathname === "/api/status") {
        const ollamaOk = await provider.isAvailable();
        return Response.json({
          status: "ok",
          ollama: ollamaOk,
          model: DEFAULT_CONFIG.llm.model,
          tools: toolRegistry.listNames(),
        });
      }

      if (url.pathname === "/api/conversations") {
        return Response.json(memory.listConversations());
      }

      // Archivos estáticos
      let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const fullPath = join(webDir, filePath);

      try {
        const file = Bun.file(fullPath);
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": getContentType(filePath) },
          });
        }
      } catch {}

      return new Response("404 Not Found", { status: 404 });
    },

    websocket: {
      open(ws) {
        const { sessionId } = ws.data as any;
        if (!sessions.has(sessionId)) {
          const saved = memory.getConversation(sessionId);
          sessions.set(sessionId, saved);
        }
        const history = sessions.get(sessionId) || [];
        ws.send(JSON.stringify({
          type: "connected",
          sessionId,
          conversations: memory.listConversations(),
          history: history.map(m => ({ role: m.role, content: m.content, id: m.id })),
        }));
      },

      async message(ws, message) {
        const { sessionId } = ws.data as any;

        try {
          const data = JSON.parse(message as string);

          if (data.type === "new_chat") {
            const newId = crypto.randomUUID();
            sessions.set(newId, []);
            (ws.data as any).sessionId = newId;
            ws.send(JSON.stringify({
              type: "chat_switched",
              sessionId: newId,
              history: [],
              conversations: memory.listConversations(),
            }));
            return;
          }

          if (data.type === "switch_chat") {
            const targetId = data.conversationId;
            if (!sessions.has(targetId)) {
              const saved = memory.getConversation(targetId);
              sessions.set(targetId, saved);
            }
            (ws.data as any).sessionId = targetId;
            const history = sessions.get(targetId) || [];
            ws.send(JSON.stringify({
              type: "chat_switched",
              sessionId: targetId,
              history: history.map(m => ({ role: m.role, content: m.content, id: m.id })),
              conversations: memory.listConversations(),
            }));
            return;
          }

          if (data.type === "delete_chat") {
            const targetId = data.conversationId;
            sessions.delete(targetId);
            await memory.clearConversation(targetId);
            const currentId = (ws.data as any).sessionId;
            if (currentId === targetId) {
              const newId = crypto.randomUUID();
              sessions.set(newId, []);
              (ws.data as any).sessionId = newId;
              ws.send(JSON.stringify({
                type: "chat_switched",
                sessionId: newId,
                history: [],
                conversations: memory.listConversations(),
              }));
            } else {
              ws.send(JSON.stringify({
                type: "conversations_updated",
                conversations: memory.listConversations(),
              }));
            }
            return;
          }

          if (data.type === "message") {
            const currentSessionId = (ws.data as any).sessionId;
            const history = sessions.get(currentSessionId) || [];
            const userText = data.content;

            const userMsg = createMessage("user", userText);
            history.push(userMsg);

            ws.send(JSON.stringify({ type: "thinking", status: "Pensando..." }));

            // Obtener contexto optimizado (resumen + recientes)
            const ctx = memory.getConversationContext(currentSessionId, CONTEXT_RECENT);
            const recentHistory = history.slice(-CONTEXT_RECENT);

            const response = await queryEngine.query(
              userText,
              recentHistory,
              {
                onToken: (token) => {
                  ws.send(JSON.stringify({ type: "token", content: token }));
                },
                onThinking: (text) => {
                  ws.send(JSON.stringify({ type: "thinking_token", content: text }));
                },
                onToolCall: (tc) => {
                  ws.send(JSON.stringify({
                    type: "tool_call",
                    name: tc.name,
                    input: tc.input,
                  }));
                },
                onToolResult: (result) => {
                  ws.send(JSON.stringify({
                    type: "tool_result",
                    name: result.name,
                    output: result.output,
                    error: result.error,
                    duration: result.duration,
                  }));
                },
              },
              ctx.summary // Inyectar resumen de contexto previo
            );

            history.push(response);
            sessions.set(currentSessionId, history);
            await memory.saveConversation(currentSessionId, history);

            // Guardar para training (en background)
            memory.saveTrainingData(currentSessionId, history).catch(() => {});

            ws.send(JSON.stringify({
              type: "stream_end",
              content: response.content,
              id: response.id,
            }));

            ws.send(JSON.stringify({
              type: "conversations_updated",
              conversations: memory.listConversations(),
            }));

            // ─── Compresión en background ───
            if (history.length > COMPRESS_THRESHOLD) {
              const toSummarize = memory.getMessagesToSummarize(currentSessionId, 6);
              if (toSummarize && toSummarize.length > 0) {
                console.log(`  🗜️ Comprimiendo ${toSummarize.length} mensajes...`);
                compressor
                  .compress(toSummarize, ctx.summary)
                  .then((summary) => {
                    const upTo = history.length - 6;
                    memory.updateSummary(currentSessionId, summary, upTo);
                    console.log(`  ✅ Resumen guardado (${summary.length} chars)`);
                  })
                  .catch((err) => {
                    console.error("  ❌ Error comprimiendo:", err);
                  });
              }
            }
          }

          if (data.type === "clear") {
            const currentSessionId = (ws.data as any).sessionId;
            sessions.set(currentSessionId, []);
            await memory.clearConversation(currentSessionId);
            ws.send(JSON.stringify({ type: "cleared" }));
            ws.send(JSON.stringify({
              type: "conversations_updated",
              conversations: memory.listConversations(),
            }));
          }
        } catch (err) {
          ws.send(JSON.stringify({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          }));
        }
      },

      close(ws) {},
    },
  });

  console.log(`
  ███████╗██████╗ ██╗███████╗
  ██╔════╝██╔══██╗██║██╔════╝
  █████╗  ██████╔╝██║███████╗
  ██╔══╝  ██╔══██╗██║╚════██║
  ███████╗██║  ██║██║███████║
  ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝

  🌐 Eris GUI corriendo en: http://localhost:${PORT}
  🧠 Modelo: ${DEFAULT_CONFIG.llm.model}
  🔧 Tools: ${toolRegistry.listNames().join(", ")}
  🗜️  Compresión: >16 msgs → auto-resumen

  Abre tu navegador en http://localhost:${PORT}
  `);
}

function getContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    json: "application/json",
    png: "image/png",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    woff2: "font/woff2",
  };
  return types[ext || ""] || "application/octet-stream";
}

startServer();
