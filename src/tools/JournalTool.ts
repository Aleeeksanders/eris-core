// ============================================================
// Eris — JournalTool
// Bloc de notas personal: journaling directo del usuario (ánimo +
// texto libre), algo que hoy no existe en ningún lado — todo lo
// demás que Eris sabe es biométrico o financiero. El moodScore
// alimenta el mismo daily_rollup_log/BaselineEngine que las demás
// métricas, así que el ánimo también obtiene baseline personal y
// detección de tendencia (BaselineEngine.ts) gratis.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { localDateKey } from "../memory.js";

export interface JournalEntry {
  id: string;
  date: string;          // YYYY-MM-DD local
  moodScore?: number;    // 1-5
  note?: string;
  createdAt: string;     // ISO
}

const MAX_ENTRIES = 500;
const STORAGE_KEY = "journal_log";

export async function getJournalEntries(memory: any): Promise<JournalEntry[]> {
  const entries = await memory?.get?.(STORAGE_KEY);
  return Array.isArray(entries) ? entries : [];
}

/** Agrega una entrada y recalcula el promedio de ánimo del día en daily_rollup_log — compartido por la tool (LLM) y el WS directo (UI del móvil), igual que UserContextTool. */
export async function addJournalEntry(memory: any, input: { moodScore?: number; note?: string }): Promise<JournalEntry> {
  const entries = await getJournalEntries(memory);
  const today = localDateKey();
  const entry: JournalEntry = {
    id: crypto.randomUUID(),
    date: today,
    moodScore: input.moodScore,
    note: input.note?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
  entries.unshift(entry);
  await memory.set(STORAGE_KEY, entries.slice(0, MAX_ENTRIES));

  if (typeof input.moodScore === "number") {
    const todayMoods = entries.filter(e => e.date === today && typeof e.moodScore === "number").map(e => e.moodScore as number);
    const avg = Math.round((todayMoods.reduce((a, b) => a + b, 0) / todayMoods.length) * 10) / 10;
    await memory.upsertDailyRollup?.({ moodScore: avg });
  }

  return entry;
}

const JournalInputSchema = z.object({
  action: z.enum(["add_entry", "list_entries"]),
  moodScore: z.number().min(1).max(5).optional().describe("Ánimo del usuario de 1 (muy mal) a 5 (muy bien). Opcional — puede ser solo texto."),
  note: z.string().optional().describe("Texto libre de lo que el usuario quiera anotar. Opcional — puede ser solo un ánimo sin texto."),
  limit: z.number().optional().describe("Cuántas entradas recientes traer para list_entries. Default 14."),
});

type JournalInput = z.infer<typeof JournalInputSchema>;

export class JournalTool extends Tool<JournalInput> {
  readonly name = "personal_journal";
  readonly description =
    "Bloc de notas personal del usuario — para cuando comparta cómo se siente (ánimo, estrés, motivación) o quiera " +
    "anotar algo del día que no encaja en ningún otro módulo (no es un hecho durable sobre su modus operandi como " +
    "'manage_user_context', es una entrada de diario puntual del momento). USAR 'add_entry' cuando el usuario " +
    "exprese explícitamente su estado de ánimo ('hoy me siento agotado', 'estuve muy estresado', 'excelente día') " +
    "o pida anotar algo — traduce su estado a moodScore de 1 (muy mal) a 5 (muy bien) solo si es razonablemente " +
    "claro, y guarda también sus palabras en 'note' si las hay. NO fuerces un moodScore si el usuario no dio pistas " +
    "de cómo se siente — el campo es opcional. El ánimo guardado alimenta el mismo motor de patrones que el sueño " +
    "o la hidratación, así que con el tiempo Eris también aprenderá el patrón de ánimo personal del usuario y podrá " +
    "detectar si está sostenidamente más bajo de lo habitual. USAR 'list_entries' si el usuario pregunta qué ha " +
    "anotado o cómo ha estado su ánimo últimamente.";
  readonly inputSchema = JournalInputSchema;

  async execute(input: JournalInput, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    if (!memory) return { output: "", error: "No hay memoria activa en este contexto." };

    try {
      if (input.action === "add_entry") {
        if (input.moodScore === undefined && !input.note?.trim()) {
          return { output: "", error: "Necesito al menos un moodScore o una nota de texto." };
        }
        const entry = await addJournalEntry(memory, { moodScore: input.moodScore, note: input.note });
        const parts = ["Anotado en tu bloc de notas."];
        if (entry.moodScore !== undefined) parts.push(`Ánimo: ${entry.moodScore}/5.`);
        if (entry.note) parts.push(`"${entry.note}"`);
        return { output: parts.join(" ") };
      }

      if (input.action === "list_entries") {
        const entries = (await getJournalEntries(memory)).slice(0, input.limit ?? 14);
        if (entries.length === 0) return { output: "No hay entradas en el bloc de notas todavía." };
        return {
          output: entries.map(e => `- ${e.date}${e.moodScore !== undefined ? ` (ánimo ${e.moodScore}/5)` : ''}: ${e.note ?? '(sin texto)'}`).join("\n"),
        };
      }

      return { output: "", error: "Acción no reconocida." };
    } catch (err) {
      return { output: "", error: `Error en el bloc de notas: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
