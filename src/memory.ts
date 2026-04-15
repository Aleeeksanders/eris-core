// ============================================================
// Eris — Memoria Persistente
// Guarda conversaciones + resúmenes de contexto comprimido
// ============================================================

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import * as os from "os";
import type { Message } from "./types/message.js";

const MEMORY_DIR = join(os.homedir(), ".eris");
const CONVERSATIONS_FILE = join(MEMORY_DIR, "conversations.json");
const TRAINING_DIR = join(MEMORY_DIR, "training");
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 100;

interface StoredConversation {
  id: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  title?: string;
  summary?: string; // Resumen comprimido de mensajes antiguos
  summaryUpTo?: number; // Índice hasta donde se resumió
}

interface MemoryStore {
  version: number;
  conversations: StoredConversation[];
}

export class Memory {
  private store: MemoryStore = { version: 1, conversations: [] };
  private loaded = false;

  async load(): Promise<void> {
    try {
      await mkdir(MEMORY_DIR, { recursive: true });
      await mkdir(TRAINING_DIR, { recursive: true });
      const data = await readFile(CONVERSATIONS_FILE, "utf-8");
      this.store = JSON.parse(data);
      this.loaded = true;
    } catch {
      this.store = { version: 1, conversations: [] };
      this.loaded = true;
    }
  }

  async save(): Promise<void> {
    try {
      await mkdir(MEMORY_DIR, { recursive: true });
      await writeFile(
        CONVERSATIONS_FILE,
        JSON.stringify(this.store, null, 2),
        "utf-8"
      );
    } catch (err) {
      console.error("Error guardando memoria:", err);
    }
  }

  getConversation(sessionId: string): Message[] {
    const conv = this.store.conversations.find((c) => c.id === sessionId);
    return conv ? conv.messages : [];
  }

  /**
   * Obtiene contexto optimizado: resumen + mensajes recientes.
   */
  getConversationContext(
    sessionId: string,
    recentCount = 12
  ): { summary: string | null; recentMessages: Message[] } {
    const conv = this.store.conversations.find((c) => c.id === sessionId);
    if (!conv) return { summary: null, recentMessages: [] };

    return {
      summary: conv.summary || null,
      recentMessages: conv.messages.slice(-recentCount),
    };
  }

  /**
   * Obtiene mensajes que necesitan ser resumidos (los que no están cubiertos por el resumen).
   */
  getMessagesToSummarize(
    sessionId: string,
    keepRecent = 6
  ): Message[] | null {
    const conv = this.store.conversations.find((c) => c.id === sessionId);
    if (!conv) return null;

    const total = conv.messages.length;
    const summarizedUpTo = conv.summaryUpTo || 0;

    // Solo comprimir si hay suficientes mensajes no resumidos
    if (total - summarizedUpTo <= keepRecent + 4) return null;

    // Retornar los mensajes entre el último resumen y los recientes
    const endIdx = total - keepRecent;
    return conv.messages.slice(summarizedUpTo, endIdx);
  }

  /**
   * Guarda un resumen comprimido.
   */
  async updateSummary(
    sessionId: string,
    summary: string,
    summarizedUpTo: number
  ): Promise<void> {
    const conv = this.store.conversations.find((c) => c.id === sessionId);
    if (!conv) return;

    // Combinar con resumen anterior si existe
    if (conv.summary) {
      conv.summary = `${conv.summary}\n\n${summary}`;
    } else {
      conv.summary = summary;
    }
    conv.summaryUpTo = summarizedUpTo;
    await this.save();
  }

  async saveConversation(
    sessionId: string,
    messages: Message[]
  ): Promise<void> {
    const existing = this.store.conversations.find(
      (c) => c.id === sessionId
    );

    const trimmedMessages = messages.slice(-MAX_MESSAGES_PER_CONVERSATION);

    const firstUserMsg = trimmedMessages.find((m) => m.role === "user");
    const title = firstUserMsg
      ? firstUserMsg.content.substring(0, 60)
      : "Conversación";

    if (existing) {
      existing.messages = trimmedMessages;
      existing.updatedAt = new Date().toISOString();
      existing.title = existing.title || title;
    } else {
      this.store.conversations.push({
        id: sessionId,
        messages: trimmedMessages,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        title,
      });
    }

    if (this.store.conversations.length > MAX_CONVERSATIONS) {
      this.store.conversations = this.store.conversations
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() -
            new Date(a.updatedAt).getTime()
        )
        .slice(0, MAX_CONVERSATIONS);
    }

    await this.save();
  }

  async clearConversation(sessionId: string): Promise<void> {
    this.store.conversations = this.store.conversations.filter(
      (c) => c.id !== sessionId
    );
    await this.save();
  }

  listConversations(): Array<{
    id: string;
    title: string;
    updatedAt: string;
    messageCount: number;
  }> {
    return this.store.conversations
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() -
          new Date(a.updatedAt).getTime()
      )
      .map((c) => ({
        id: c.id,
        title: c.title || "Conversación",
        updatedAt: c.updatedAt,
        messageCount: c.messages.length,
      }));
  }

  // ─── Training Data ───

  /**
   * Guarda una conversación completa como dato de entrenamiento en JSONL.
   */
  async saveTrainingData(
    sessionId: string,
    messages: Message[]
  ): Promise<void> {
    try {
      await mkdir(TRAINING_DIR, { recursive: true });

      // Filtrar solo user/assistant, limpiar think tags
      const cleanMessages = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role,
          content: m.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
        }))
        .filter((m) => m.content.length > 0);

      if (cleanMessages.length < 2) return;

      const entry = {
        id: sessionId,
        timestamp: new Date().toISOString(),
        approved: false,
        messages: cleanMessages,
      };

      const filePath = join(TRAINING_DIR, "conversations.jsonl");
      const line = JSON.stringify(entry) + "\n";

      // Append al archivo
      try {
        const existing = await readFile(filePath, "utf-8");
        // Verificar si ya existe este sessionId
        if (existing.includes(`"id":"${sessionId}"`)) {
          // Reemplazar la línea existente
          const lines = existing.split("\n").filter((l) => l.trim());
          const updated = lines
            .map((l) => {
              try {
                const parsed = JSON.parse(l);
                return parsed.id === sessionId ? JSON.stringify(entry) : l;
              } catch {
                return l;
              }
            })
            .join("\n") + "\n";
          await writeFile(filePath, updated, "utf-8");
        } else {
          await writeFile(filePath, existing + line, "utf-8");
        }
      } catch {
        // Archivo no existe, crear nuevo
        await writeFile(filePath, line, "utf-8");
      }
    } catch (err) {
      console.error("Error guardando training data:", err);
    }
  }
}
