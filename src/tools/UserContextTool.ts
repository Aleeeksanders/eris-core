// ============================================================
// Eris — UserContextTool
// Memoria adaptativa: hechos y preferencias que el usuario cuenta
// en el chat sobre su propio modus operandi ("no tomo agua en la
// mañana porque me da reflujo") y que deben informar análisis y
// tips futuros — distinto del perfil médico formal (eso es
// ProfileManagementTool) y distinto de la base de conocimiento
// médico (eso es MedicalKnowledgeBase, contenido curado, no
// personal). Esto es lo que el usuario mismo aporta.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";

const NOTE_CATEGORIES = ["hydration", "sleep", "nutrition", "training", "finance", "general"] as const;
export type NoteCategory = typeof NOTE_CATEGORIES[number];

export interface PersonalNote {
  id: string;
  category: NoteCategory;
  note: string;
  createdAt: string;
}

const MAX_NOTES = 200;
const STORAGE_KEY = "personal_context_notes";

export async function getUserNotes(memory: any): Promise<PersonalNote[]> {
  const notes = await memory?.get?.(STORAGE_KEY);
  return Array.isArray(notes) ? notes : [];
}

/** Borrado directo (no vía LLM) — usado por la pantalla "Sobre mí" cuando el usuario borra una nota a mano, igual que `save_profile` edita el perfil sin pasar por `manage_user_profile`. */
export async function deleteUserNote(memory: any, noteId: string): Promise<void> {
  const notes = await getUserNotes(memory);
  await memory.set(STORAGE_KEY, notes.filter(n => n.id !== noteId));
}

/** Bloque de texto compacto con las notas relevantes, listo para inyectar en un prompt de LLM. Sin scope, trae todas; con scope, trae esa categoría + 'general'. */
export function formatNotesForLLM(notes: PersonalNote[], scope?: NoteCategory): string {
  const filtered = scope ? notes.filter(n => n.category === scope || n.category === "general") : notes;
  if (filtered.length === 0) return "";
  return filtered.map(n => `- ${n.note}`).join("\n");
}

const UserContextInputSchema = z.object({
  action: z.enum(["add_note", "list_notes", "remove_note"]),
  note: z.string().optional().describe("Texto breve y concreto del hecho o preferencia a recordar. Requerido para add_note."),
  category: z.enum(NOTE_CATEGORIES).optional().describe("Módulo al que aplica la nota: hydration, sleep, nutrition, training, finance, o general si no calza claramente en uno. Default 'general'."),
  noteId: z.string().optional().describe("Id de la nota a borrar. Requerido para remove_note."),
});

type UserContextInput = z.infer<typeof UserContextInputSchema>;

export class UserContextTool extends Tool<UserContextInput> {
  readonly name = "manage_user_context";
  readonly dangerous = true;
  readonly description =
    "Memoria adaptativa del usuario — hechos, preferencias o razones sobre CÓMO opera el usuario en su día a día, que " +
    "deben recordarse para análisis y tips futuros. Ejemplos que SÍ ameritan guardar: 'no tomo agua en la mañana " +
    "porque me da reflujo', 'prefiero entrenar de noche', 'gasto más los fines de semana porque salgo con amigos', " +
    "'duermo peor los domingos por ansiedad del lunes'. NO uses esto para condiciones médicas, medicamentos o " +
    "alergias formales — eso va en 'manage_user_profile'. NO la uses para quejas puntuales o desahogos de un solo " +
    "momento — solo para patrones/razones durables que vale la pena recordar siempre. " +
    "USAR 'add_note' apenas el usuario comparta algo así en la conversación, sin esperar a que lo pida explícitamente " +
    "— pero antes de agregar, si tienes dudas de si ya existe algo parecido, usa 'list_notes' primero para no " +
    "duplicar. USAR 'remove_note' si el usuario dice que algo ya no aplica o cambió.";
  readonly inputSchema = UserContextInputSchema;

  async execute(input: UserContextInput, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    if (!memory) return { output: "", error: "No hay memoria activa en este contexto." };

    try {
      if (input.action === "add_note") {
        if (!input.note?.trim()) {
          return { output: "", error: "Falta el texto de la nota (campo 'note')." };
        }
        const notes = await getUserNotes(memory);
        const entry: PersonalNote = {
          id: crypto.randomUUID(),
          category: input.category || "general",
          note: input.note.trim(),
          createdAt: new Date().toISOString(),
        };
        notes.unshift(entry);
        await memory.set(STORAGE_KEY, notes.slice(0, MAX_NOTES));
        return { output: `Anotado (${entry.category}): "${entry.note}". Lo tendré en cuenta de ahora en adelante.` };
      }

      if (input.action === "list_notes") {
        const notes = await getUserNotes(memory);
        if (notes.length === 0) return { output: "No hay notas de contexto personal guardadas todavía." };
        return {
          output: notes.map(n => `- [${n.category}] (${n.id}) ${n.note}`).join("\n"),
        };
      }

      if (input.action === "remove_note") {
        if (!input.noteId) return { output: "", error: "Falta el id de la nota a borrar (campo 'noteId')." };
        const notes = await getUserNotes(memory);
        const next = notes.filter(n => n.id !== input.noteId);
        await memory.set(STORAGE_KEY, next);
        return { output: next.length < notes.length ? "Nota eliminada." : "No encontré una nota con ese id." };
      }

      return { output: "", error: "Acción no reconocida." };
    } catch (err) {
      return { output: "", error: `Error en memoria de contexto personal: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
