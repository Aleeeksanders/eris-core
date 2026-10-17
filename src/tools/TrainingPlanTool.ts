// ============================================================
// Eris — TrainingPlanTool
// Planificación de entrenamiento conversacional para Forge/Toji.
// Eris lee la rutina del usuario (o ayuda a crearla), propone qué
// entrenar hoy, y carga los ejercicios al plan de hoy en la app.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { formatGuidanceForLLM } from "../services/MedicalKnowledgeBase.js";
import type { MedicalProfile } from "../memory.js";

// ─── Vocabulario fijo de Forge (debe coincidir con MUSCLE_GROUPS en
// eris-mobile/assets/toji.html) — cualquier newExercise.muscles debe usar
// SOLO estos ids, o el ejercicio no se verá bien en el árbol de stats. ───
const MUSCLE_VOCAB: Record<string, string> = {
  delt_ant: "Deltoide anterior", delt_lat: "Deltoide lateral", delt_post: "Deltoide posterior",
  pec_sup: "Pecho superior", pec_med: "Pecho medio/inferior",
  dorsal: "Dorsal ancho", trapecio: "Trapecio", lumbar: "Espalda baja (lumbar)",
  biceps: "Bíceps", triceps: "Tríceps", antebrazo: "Antebrazos",
  abs: "Recto abdominal", oblicuos: "Oblicuos", core_prof: "Core profundo",
  cuadriceps: "Cuádriceps", femoral: "Femoral/Glúteo", gemelos: "Gemelos",
  pliometria: "Pliometría", reactividad: "Reactividad",
  equilibrio: "Equilibrio", aereo: "Control aéreo", coordinacion: "Coordinación",
};
const MUSCLE_IDS = Object.keys(MUSCLE_VOCAB);
const EXERCISE_GROUPS = ["empuje", "tiron", "pierna", "core_ej", "atletico"] as const;
// Mismos valores que INTENSITY.media en toji.html — default razonable para
// ejercicios creados por Eris cuando no hay más contexto.
const DEFAULT_INTENSITY = { met: 6, min: 2.5 };

// ─── Schema ───────────────────────────────────────────────────────

const TrainingPlanInputSchema = z.object({
  action: z.enum(["get_routine", "save_routine", "get_catalog", "apply_plan"])
    .describe("Acción a ejecutar"),

  routineMd: z.string().optional()
    .describe("Contenido Markdown de la rutina completa (para save_routine). Debe incluir encabezados claros por día/grupo muscular, ej. '## Día A — Jalón y bíceps', para que luego puedas ofrecer esas opciones como [Opción: ...] al usuario."),
  routineName: z.string().optional().describe("Nombre del archivo de rutina, ej. 'rutina.md' (para save_routine)"),

  dayLabel: z.string().optional().describe("Etiqueta del día/grupo elegido, ej. 'Día A — Jalón y bíceps' (para apply_plan, se muestra en el toast de confirmación)"),

  entries: z.array(z.object({
    exerciseId: z.string().optional()
      .describe("Id de un ejercicio YA EXISTENTE en el catálogo (obtenido de get_catalog). Usa esto cuando el ejercicio ya existe."),
    newExerciseName: z.string().optional()
      .describe("Nombre de un ejercicio NUEVO que no está en el catálogo. Requiere 'muscles'. SOLO úsalo después de que el usuario haya confirmado en el chat que quiere crearlo."),
    muscles: z.array(z.string()).optional()
      .describe(`Para newExerciseName: 2 o 3 ids de músculo (el primero es el principal) tomados EXACTAMENTE de este vocabulario fijo: ${MUSCLE_IDS.join(", ")}. Determínalos usando web_search sobre qué músculos trabaja el ejercicio, y mapea el resultado a estos ids — no inventes ids nuevos.`),
    group: z.enum(EXERCISE_GROUPS).optional()
      .describe("Grupo del ejercicio nuevo: empuje (pecho/hombro/tríceps), tiron (espalda/bíceps), pierna, core_ej, o atletico (potencia/agilidad). Solo para newExerciseName."),
    loadType: z.enum(["db", "bw", "hold"]).optional()
      .describe("Tipo de carga del ejercicio nuevo: 'db' (con mancuerna/peso externo), 'bw' (peso corporal), 'hold' (sostén isométrico, ej. plancha). Default 'bw' si no se especifica."),
    targetSets: z.number().optional().describe("Series objetivo para hoy, 1-12. Default 3 si no se especifica."),
  })).optional()
    .describe(
      "Lista de ejercicios a cargar al plan de hoy (para apply_plan). Cada entrada es UNA de estas dos formas: " +
      "{exerciseId:'flexiones', targetSets:4} para un ejercicio existente, o " +
      "{newExerciseName:'Remo en polea', muscles:['dorsal','biceps'], group:'tiron', loadType:'db', targetSets:3} para uno nuevo. " +
      "Ejemplo de array completo: [{\"exerciseId\":\"dominadas\",\"targetSets\":4},{\"newExerciseName\":\"Remo en polea\",\"muscles\":[\"dorsal\",\"biceps\"],\"group\":\"tiron\",\"loadType\":\"db\",\"targetSets\":3}]"
    ),
});

type TrainingPlanInput = z.infer<typeof TrainingPlanInputSchema>;

// ─── Tool ─────────────────────────────────────────────────────────

export class TrainingPlanTool extends Tool<TrainingPlanInput> {
  readonly name = "training_plan";
  readonly description =
    "Planifica y carga el entrenamiento del día en Forge (el módulo de acondicionamiento de la app). " +
    "ACTIVAR cuando el usuario exprese intención de entrenar: 'voy a entrenar', 'quiero entrenar', " +
    "'qué entreno hoy', 'toca pierna hoy', y similares.\n\n" +
    "FLUJO COMPLETO (síguelo en orden):\n" +
    "1. Llama a get_routine. Si el usuario NO tiene una rutina guardada, ayúdalo a crear una conversacionalmente " +
    "(pregunta objetivo, equipo disponible, días por semana) y luego guárdala con save_routine — usa encabezados " +
    "claros por día en el Markdown (ej. '## Día A — Jalón y bíceps') para que después puedas ofrecerlos como opciones.\n" +
    "2. Con la rutina en mano, PREGUNTA al usuario qué día/grupo muscular va a entrenar hoy, presentando cada opción " +
    "de la rutina con la sintaxis EXACTA '[Opción: texto]' (una por línea) — el cliente las convierte en botones tocables. " +
    "Ejemplo: '¿Qué entrenamos hoy?\\n\\n[Opción: Día A — Jalón y bíceps]\\n[Opción: Día B — Empuje y hombros]\\n[Opción: Día C — Piernas y core]'.\n" +
    "3. Cuando el usuario elija (tocará el botón, que reenvía el texto tal cual como mensaje), llama a get_catalog para saber " +
    "qué ejercicios de ese día YA existen en la app y con qué id.\n" +
    "4. Para cada ejercicio de esa sesión: si existe en el catálogo, agrégalo a 'entries' con exerciseId. Si NO existe, " +
    "PRIMERO pregunta al usuario en el chat si quieres crearlo (nunca lo crees en silencio), luego usa web_search para " +
    `averiguar qué 2-3 músculos principales trabaja, mapea el resultado a este vocabulario fijo (usa SOLO estos ids): ${MUSCLE_IDS.join(", ")}. ` +
    "Recién entonces agrégalo a 'entries' con newExerciseName + muscles + group + loadType.\n" +
    "5. Llama a apply_plan con dayLabel y la lista completa de entries. Esto carga todo al plan de hoy en la pestaña CUERPO " +
    "de Forge y confirma al usuario. No necesitas repetir la lista en tu respuesta de texto si apply_plan ya confirmó.";

  readonly inputSchema = TrainingPlanInputSchema;

  async execute(input: TrainingPlanInput, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    const wsClient = context?.wsClient;
    const medical: MedicalProfile | undefined = memory
      ? (await memory.getProfile?.().catch(() => null))?.medical
      : undefined;

    switch (input.action) {
      case "get_routine":
        return this.handleGetRoutine(memory);
      case "save_routine":
        return this.handleSaveRoutine(input, memory, wsClient);
      case "get_catalog":
        return this.handleGetCatalog(memory);
      case "apply_plan":
        return this.handleApplyPlan(input, memory, wsClient, medical);
      default:
        return { output: "", error: "Acción no reconocida" };
    }
  }

  // ─── Leer rutina sincronizada ───────────────────────────────────
  private async handleGetRoutine(memory: any): Promise<ToolExecutionResult> {
    if (!memory) return { output: "No hay acceso a la memoria del perfil." };
    try {
      const stored = await memory.get("toji_routine_md");
      if (stored && stored.md) {
        return {
          output: `## Rutina actual (${stored.name || "sin nombre"})\n\n${stored.md}`,
        };
      }
    } catch {}
    return {
      output:
        "El usuario todavía no tiene una rutina de entrenamiento guardada en Forge (o Forge nunca se abrió para sincronizarla). " +
        "Ofrécete a ayudarlo a crear una: pregunta objetivo (fuerza/calistenia/movilidad), equipo disponible y cuántos días " +
        "a la semana quiere entrenar, redacta una rutina en Markdown con encabezados claros por día (ej. '## Día A — Jalón y bíceps'), " +
        "y guárdala con save_routine una vez que el usuario la apruebe.",
    };
  }

  // ─── Guardar/generar rutina ─────────────────────────────────────
  private async handleSaveRoutine(input: TrainingPlanInput, memory: any, wsClient: any): Promise<ToolExecutionResult> {
    if (!input.routineMd) return { output: "Falta el contenido de la rutina (routineMd)." };
    const name = input.routineName || "rutina.md";

    if (memory) {
      try {
        await memory.set("toji_routine_md", { md: input.routineMd, name });
      } catch {}
    }
    if (wsClient) {
      try {
        wsClient.send(JSON.stringify({ type: "toji_save_routine", md: input.routineMd, name }));
      } catch {}
    }
    return { output: `✅ Rutina "${name}" guardada. Se aplicará en Forge (de inmediato si está abierto, o la próxima vez que se abra).` };
  }

  // ─── Leer catálogo sincronizado ─────────────────────────────────
  private async handleGetCatalog(memory: any): Promise<ToolExecutionResult> {
    const vocabLine = `Vocabulario de músculos válido: ${MUSCLE_IDS.map(id => `${id} (${MUSCLE_VOCAB[id]})`).join(", ")}.`;
    if (!memory) return { output: vocabLine };

    try {
      const stored = await memory.get("toji_exercise_catalog");
      const custom = Array.isArray(stored?.custom) ? stored.custom : [];
      if (custom.length === 0) {
        return { output: `El usuario aún no tiene ejercicios personalizados sincronizados (solo el catálogo base de la app, que no está listado aquí). ${vocabLine}` };
      }
      const lines = custom.map((c: any) => {
        const muscles = c?.m ? Object.keys(c.m).join(", ") : "?";
        return `- id:"${c.id}" name:"${c.name}" músculos:[${muscles}]`;
      });
      return {
        output: `## Ejercicios personalizados del usuario\n${lines.join("\n")}\n\n${vocabLine}\n\nNota: además de estos, la app trae un catálogo base amplio (empuje/tirón/pierna/core/atlético) — si el usuario menciona un ejercicio común (flexiones, dominadas, sentadillas, etc.) probablemente ya exista ahí; solo trátalo como "nuevo" si el usuario confirma que no aparece en su plan al aplicarlo.`,
      };
    } catch {
      return { output: vocabLine };
    }
  }

  // ─── Aplicar plan de hoy ────────────────────────────────────────
  private async handleApplyPlan(input: TrainingPlanInput, memory: any, wsClient: any, medical?: MedicalProfile): Promise<ToolExecutionResult> {
    if (!input.entries || input.entries.length === 0) {
      return { output: "No especificaste ningún ejercicio. Dame al menos un exerciseId o newExerciseName con sus músculos." };
    }
    if (!wsClient) {
      return { output: "", error: "No hay conexión activa con la app para aplicar el plan." };
    }

    const exercises: Array<{ id: string; targetSets: number }> = [];
    const newExercises: Array<Record<string, unknown>> = [];
    const rejected: string[] = [];

    input.entries.forEach((entry, i) => {
      const targetSets = Math.max(1, Math.min(12, entry.targetSets || 3));
      if (entry.exerciseId) {
        exercises.push({ id: entry.exerciseId, targetSets });
        return;
      }
      if (entry.newExerciseName) {
        const muscles = (entry.muscles || []).filter(m => MUSCLE_IDS.includes(m));
        if (muscles.length === 0) {
          rejected.push(entry.newExerciseName);
          return;
        }
        const m: Record<string, number> = {};
        muscles.slice(0, 3).forEach((id, idx) => { m[id] = idx === 0 ? 2 : 1; });
        const loadType = entry.loadType || "bw";
        const load = loadType === "db" ? { db: true } : { bw: loadType === "hold" ? 0.35 : 0.6 };
        newExercises.push({
          id: `cx_${Date.now()}_${i}`,
          name: entry.newExerciseName,
          group: entry.group || "custom",
          met: DEFAULT_INTENSITY.met,
          min: DEFAULT_INTENSITY.min,
          m,
          load,
          reps: loadType === "hold" ? 30 : 10,
          unit: loadType === "hold" ? "seg" : undefined,
          targetSets,
        });
        return;
      }
      rejected.push(`entrada #${i + 1} sin exerciseId ni newExerciseName`);
    });

    if (exercises.length === 0 && newExercises.length === 0) {
      return {
        output: "",
        error: `Ninguna entrada era válida (faltó exerciseId, o newExerciseName sin 'muscles' válidos del vocabulario fijo). Rechazadas: ${rejected.join("; ")}`,
      };
    }

    try {
      wsClient.send(JSON.stringify({
        type: "toji_apply_plan",
        dayLabel: input.dayLabel || null,
        exercises,
        newExercises,
      }));
    } catch (e: any) {
      return { output: "", error: `No se pudo enviar el plan a la app: ${e?.message || String(e)}` };
    }

    const parts: string[] = [];
    if (input.dayLabel) parts.push(`**${input.dayLabel}**`);
    if (exercises.length) parts.push(`${exercises.length} ejercicio(s) existente(s)`);
    if (newExercises.length) parts.push(`${newExercises.length} ejercicio(s) nuevo(s) creado(s): ${newExercises.map(e => e.name).join(", ")}`);
    let output = `✅ Plan cargado ${parts.join(" — ")}. Se aplicó en Forge (de inmediato si está abierto, o la próxima vez que se abra).`;
    if (rejected.length) output += `\n\n⚠️ No pude cargar: ${rejected.join("; ")}.`;

    const kbNote = formatGuidanceForLLM(medical, 'training');
    if (kbNote) output += `\n\n*Nota:*\n${kbNote}`;

    return { output };
  }
}
