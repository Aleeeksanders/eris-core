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
import * as FC from "../services/forge/forgeCore.js";
import * as FR from "../services/forge/forgeRoutine.js";
import * as FM from "../services/forge/forgeMdRoutine.js";
import * as FX from "../services/forge/forgeSkillsExt.js";
import { loadTargets } from "../services/DailyTargets.js";
import { getProjection, intentFor, PROJECTION_KEY } from "../services/TrainingIntent.js";
import { RECUPERACION_ASK, respuestaRecuperacion, type RecuperacionExtras, DIA_ASK, FUERZA_OPINION, CONTRA_CALLE, parseKilos, respuestaDia, respuestaKilos, fuerzaComparada, veredictoProgreso, veredictoHoy } from "../services/EntrenoChat.js";
import { fmtSleep, sleepReadiness, lastSleepFrom } from "../services/SleepCore.js";

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
  action: z.enum(["get_routine", "save_routine", "get_catalog", "apply_plan", "build_routine", "adjust_routine", "get_progress", "load_md_routine", "get_today", "get_day", "get_recovery"])
    .describe("Acción a ejecutar. build_routine = ARMAR una rutina nueva por código (preferida: usa su equipo, su fuerza y sus cuidados); adjust_routine = cambiar un ejercicio o los días/minutos/objetivo de la rutina que ya tiene; get_progress = su progreso en Forge (récords, fuerza, constancia, «tú hace 3 meses»); get_today = qué le toca hoy según su rutina (o cuándo le toca un día: dayQuery); get_recovery = cómo vienen sus músculos y si tener agujetas importa («¿estoy recuperado?», «tengo agujetas»); get_day = lo que ENTRENÓ un día pasado («¿qué hice ayer?», «mi entreno del domingo»: dayQuery con el día); load_md_routine = convertir SU rutina escrita (la que pegó en Forge) en el plan por días: primero muestra cómo quedaría y pregunta, y con confirm=true la carga."),
  /** load_md_routine: el usuario ya dijo que sí (la carga a Forge) */
  confirm: z.boolean().optional().describe("load_md_routine: true solo después de que el usuario confirmó «sí, cárgala»."),
  /** interno: prefiere revisarla en la app */
  review: z.boolean().optional(),
  dayQuery: z.string().optional().describe("get_today: el día de la rutina por el que pregunta («tirón», «pierna») para decir cuándo le toca."),
  cansancio: z.boolean().optional().describe("get_today: true si pregunta si entrenar igual porque durmió mal o está cansado."),
  lugar: z.boolean().optional().describe("get_today: true si pregunta si le conviene ir al gimnasio o entrenar en casa."),
  flojera: z.boolean().optional().describe("get_today: true si no tiene ganas de ir a entrenar («me da lata ir al gym», «¿lo dejo para mañana?»)."),
  comparar: z.boolean().optional().describe("get_progress: true si pregunta si es fuerte, o si es más fuerte que alguien que no entrena / el promedio."),
  /** interno: «50 kilos de esta que se empuja» (EntrenoChat.parseKilos) */
  kilos: z.number().optional(),
  patron: z.string().optional(),
  kilosDicho: z.string().optional(),

  days: z.number().optional().describe("build_routine/adjust_routine: días por semana (2–6). Pregúntalo si no lo dijo."),
  minutes: z.number().optional().describe("build_routine/adjust_routine: minutos por sesión (30–120). Si no lo dijo, 60."),
  goal: z.enum(["fuerza", "hipertrofia", "salud"]).optional().describe("build_routine/adjust_routine: fuerza, hipertrofia (ganar músculo) o salud (constancia)."),
  where: z.enum(["gym", "casa"]).optional().describe("build_routine: gimnasio o casa."),
  care: z.array(z.enum(["lumbar", "hombro", "rodilla", "muneca", "codo"])).optional().describe("build_routine/adjust_routine: zonas con lesión o molestia a cuidar."),
  swapExercise: z.string().optional().describe("adjust_routine: el ejercicio a cambiar (nombre como lo dijo el usuario: «el press militar», «la prensa»)."),
  both: z.boolean().optional().describe("build_routine: además la versión para la casa (si entrena en el gimnasio y en la casa)."),
  /** interno: lo armó el código (preroute), la respuesta va lista sin pasar por el modelo */
  viaCode: z.boolean().optional(),
  /** interno: respondió sin los días: se piden solo los días, con botones */
  reask: z.boolean().optional(),

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
    "PARA «¿CÓMO VOY EN EL GYM?», RÉCORDS O FUERZA usa get_progress (cifras de Forge; no inventes ninguna).\n" +
    "PARA ARMAR UNA RUTINA usa build_routine (por código: su equipo, su fuerza, sus cuidados y la progresión). Pregunta antes " +
    "cuántos días por semana y cuánto rato (y si tiene alguna lesión); no la redactes tú. Para cambiar un ejercicio o los días, adjust_routine.\n" +
    "1. Llama a get_routine. Si el usuario NO tiene una rutina guardada, ofrece armarla con build_routine " +
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

  /**
   * «Arma mi rutina…» y la respuesta a las preguntas, por código. 2026-10-18 (chat real): el modelo no llamó a build_routine;
   * escribió «llama symptom_guide» como texto, una «rutina» de 30 min de cardio, y «Dale, registra» terminó anotando un
   * completo italiano inventado. Ahora: pide la rutina → preguntas; responde con los días → se arma y se guarda en Forge.
   */
  async preroute(userMessage: string, context?: any): Promise<Record<string, unknown> | null> {
    const memory = context?.memory;
    if (!memory) return null;
    const t = foldText(userMessage || "");
    if (!t || t.length > 500) return null;
    // «Carga mi rutina» (la escrita): se muestra cómo quedaría el plan y se pregunta; «sí, cárgala» la deja en Forge (fase I8)
    if (MD_ROUTINE_ASK.test(t) && !/\b(de hoy|del dia|hoy)\b/.test(t)) return { action: "load_md_routine", viaCode: true };
    const mdPending: any = await memory.get(MD_PENDING_KEY).catch(() => null);
    if (mdPending && Date.now() - Date.parse(mdPending.at) <= 30 * 60_000 && /¿la cargo\?/i.test(String(context?.lastAssistantMessage ?? ""))) {
      if (/^(si|dale|ok|okey|carga\w*|hazlo|listo|perfecto|de una|ya)\b/.test(t) && t.length <= 40) return { action: "load_md_routine", confirm: true, viaCode: true };
      if (/\b(la reviso|revisarla|en la app|yo la reviso)\b/.test(t)) {
        await memory.set(MD_PENDING_KEY, null).catch(() => {});
        return { action: "load_md_routine", review: true, viaCode: true };
      }
    }
    // «¿Qué me toca hoy?», «¿cuándo me toca tirón?», «¿qué tan fuerte estoy en press de banca?»: con sus datos de Forge, por
    // código (2026-10-23, banco «Jarvis»: el modelo decía «pierna» un día de empuje o «no tengo tu progreso»)
    // Chat real 2026-11-05: «mi rutina de ayer», «¿crees que soy fuerte?», «50 kilos de esta huea que se empuja» (EntrenoChat)
    if (RECUPERACION_ASK.test(t) && !/\b(creatina|proteina|suplement\w*|magnesio|omega)\b/.test(t)) return { action: "get_recovery", viaCode: true };
    if (DIA_ASK.test(t) && !ROUTINE_EDIT.test(t)) return { action: "get_day", dayQuery: userMessage, viaCode: true };
    const kil = parseKilos(userMessage);
    if (kil) return { action: "get_progress", kilos: kil.kg, ...(kil.patron ? { patron: kil.patron } : {}), kilosDicho: kil.dicho, viaCode: true };
    if (FUERZA_OPINION.test(t) && !ROUTINE_EDIT.test(t)) return { action: "get_progress", comparar: true, viaCode: true };
    if (PROGRESS_ASK.test(t) && !ROUTINE_EDIT.test(t)) return { action: "get_progress", ...(CONTRA_CALLE.test(t) && /\bfuert/.test(t) ? { comparar: true } : {}), viaCode: true };
    // «Dormí mal, ¿igual entreno hoy?»: según lo que durmió y lo que toca (el modelo decía «no entres al gimnasio» por 6 h)
    if (TIRED.test(t) && TRAIN_WORD.test(t) && t.length <= 160) return { action: "get_today", cansancio: true, viaCode: true };
    // «Me da lata ir al gym, ¿lo dejo para mañana?» (banco brígida 2026-11-05: el modelo contestó «Sí, pero no por eso»)
    if (FLOJERA.test(t) && TRAIN_WORD.test(t) && !ROUTINE_EDIT.test(t) && t.length <= 160) return { action: "get_today", flojera: true, viaCode: true };
    // «¿Me conviene ir al gym o entreno en casa?» (revisión 2026-11-04, C4): lo de hoy, y qué se puede hacer en casa
    if (PLACE_ASK.test(t) && !ROUTINE_EDIT.test(t)) return { action: "get_today", lugar: true, viaCode: true };
    if (TODAY_ASK.test(t) && !ROUTINE_EDIT.test(t) && !ROUTINE_ASK.test(t)) return { action: "get_today", viaCode: true };
    if (NEXT_ASK.test(t) && !ROUTINE_EDIT.test(t)) {
      const proj = await getProjection(memory).catch(() => null);
      const hit = proj?.routine?.days?.length ? dayFromQuery(proj.routine, t) : null;
      if (hit || /\b(entren\w*|entreno|rutina|gym|gimnasio)\b/.test(t)) return { action: "get_today", ...(hit ? { dayQuery: userMessage } : {}), viaCode: true };
    }
    const req = parseRoutineAnswer(t);
    if (ROUTINE_ASK.test(t) && !ROUTINE_EDIT.test(t) && !NOT_GYM_ROUTINE.test(t)) return { action: "build_routine", ...req, viaCode: true };
    // La respuesta a «¿cuántos días…?» (o «mejor de 4 días» después de armarla): solo si lo último que dijo Eris fue eso
    const pending: any = await memory.get(ROUTINE_PENDING_KEY).catch(() => null);
    const fresh = pending && Date.now() - Date.parse(pending.at) <= 30 * 60_000;
    const asked = /d[ií]as a la semana|tu rutina|la rutina/i.test(String(context?.lastAssistantMessage ?? ""));
    if (fresh && asked && req.days && !t.includes("?")) return { action: "build_routine", ...pending.req, ...req, viaCode: true };
    // «Dale», «sí, regístrala» sin los días (antes el modelo contestó «¿Qué pasa?»): se piden los días, con botones
    if (fresh && asked && !pending.built && !t.includes("?") && t.length <= 60) return { action: "build_routine", ...pending.req, ...req, viaCode: true, reask: true };
    return null;
  }

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
      case "build_routine":
        return this.handleBuildRoutine(input, memory, wsClient, medical);
      case "adjust_routine":
        return this.handleAdjustRoutine(input, memory, wsClient, medical);
      case "get_progress":
        return this.handleGetProgress(memory, input.viaCode ? String(context?.userMessage ?? "") : undefined, input);
      case "get_recovery": {
        const proj = await getProjection(memory).catch(() => null);
        const r = respuestaRecuperacion(proj?.recovery, String(context?.userMessage ?? ""), await this.extrasRecuperacion(memory));
        return { output: r.texto, metadata: { quickReply: r.texto, veredicto: r.veredicto } };
      }
      case "get_day": {
        const proj = await getProjection(memory).catch(() => null);
        const r = respuestaDia(String(input.dayQuery ?? context?.userMessage ?? ""), proj?.recent);
        return { output: r.texto, metadata: { quickReply: r.texto, veredicto: r.veredicto } };
      }
      case "load_md_routine":
        return this.handleLoadMdRoutine(input, memory, wsClient);
      case "get_today":
        return this.handleGetToday(input, memory);
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
      const baseLine = baseCatalogText();
      if (custom.length === 0) {
        return { output: `${baseLine}\n\nEl usuario no tiene ejercicios personalizados. ${vocabLine}` };
      }
      const lines = custom.map((c: any) => {
        const muscles = c?.m ? Object.keys(c.m).join(", ") : "?";
        return `- id:"${c.id}" name:"${c.name}" músculos:[${muscles}]`;
      });
      return {
        output: `${baseLine}\n\n## Ejercicios personalizados del usuario\n${lines.join("\n")}\n\n${vocabLine}`,
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
    const customIds = new Set<string>(((await memory?.get?.("toji_exercise_catalog").catch(() => null))?.custom ?? []).map((c: any) => c?.id).filter(Boolean));
    const rejected: string[] = [];

    input.entries.forEach((entry, i) => {
      const targetSets = Math.max(1, Math.min(12, entry.targetSets || 3));
      if (entry.exerciseId) {
        // Solo ids que existen (antes aceptaba cualquiera y el plan quedaba con ejercicios fantasma)
        if (!FC.BASE_BY_ID[entry.exerciseId] && !customIds.has(entry.exerciseId)) { rejected.push(`«${entry.exerciseId}» no existe en el catálogo (usa get_catalog)`); return; }
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

  /** Sueño de las 2 últimas noches y proteína de ayer (el historial del servidor), como aviso: no cambian las horas */
  private async extrasRecuperacion(memory: any): Promise<RecuperacionExtras> {
    try {
      const log: any[] = (await memory?.getDailyRollupLog?.()) ?? [];
      const hoy = localDayOf(new Date());
      const dias = [...log].filter((x) => x?.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const noches = dias.slice(-2).map((x) => Number(x.sleepNightHours ?? x.sleepHours)).filter((h) => h > 0 && h < 14);
      const ayer = dias.filter((x) => String(x.date) < hoy).pop();
      const t = await loadTargets(memory).catch(() => null);
      return { suenoH: noches.length ? noches.reduce((a, b) => a + b, 0) / noches.length : null, proteinaAyer: ayer ? Number(ayer.protein) || null : null, proteinaMeta: t?.proteinIsCap ? null : t?.proteinG ?? null };
    } catch { return {}; }
  }

  // ─── Progreso (forge/forgeProgress.progressContext, calculado en el teléfono con sus series) ───
  private async handleGetProgress(memory: any, quickFor?: string, input?: TrainingPlanInput): Promise<ToolExecutionResult> {
    const proj = await getProjection(memory).catch(() => null);
    const p = proj?.progress;
    const listo = (r: { texto: string; veredicto: string }) => ({ output: r.texto, metadata: { quickReply: r.texto, veredicto: r.veredicto } });
    // «50 kilos de esta que se empuja»: el ejercicio de sus últimos días con esa carga
    if (input?.kilos) {
      const r = respuestaKilos({ kg: input.kilos, patron: input.patron ?? null, dicho: input.kilosDicho ?? `${input.kilos} kg` }, proj?.recent, p?.lifts ?? []);
      if (r) return listo(r);
      const q = `No encuentro un ejercicio con ~${input.kilosDicho ?? `${Math.round(input.kilos)} kg`} en tus últimos días entrenados en Forge. ¿Cuál era? Si no lo anotaste, anótalo en Forge y lo cuento.`;
      return listo({ texto: q, veredicto: "No lo veo anotado." });
    }
    // «¿Crees que soy fuerte?», «¿más que alguien que no entrena?»: con sus cifras (sin inventar una escala)
    if (input?.comparar && p) return listo(fuerzaComparada(p, CONTRA_CALLE.test(foldText(quickFor ?? ""))));
    if (!p) {
      const q = "Todavía no me llega tu progreso de Forge: se sincroniza al abrir Forge en la app con conexión. Ábrelo una vez y te lo cuento con tus cifras.";
      return quickFor !== undefined ? { output: q, metadata: { quickReply: q } } : { output: "No tengo su progreso de Forge todavía (se sincroniza al abrir la app con Forge). No inventes cifras: dile que abra Forge una vez o que mire PROGRESO › Gráficos." };
    }
    if (quickFor !== undefined) {
      const q = progressReply(p, foldText(quickFor), proj?.e1rm);
      return { output: q, metadata: { quickReply: q, veredicto: veredictoProgreso(p) } };
    }
    const n = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
    const d = (k: string) => { const [, m, dd] = String(k).split("-"); return `${dd}/${m}`; };
    const lines: string[] = ["## Progreso en Forge (cifras de la app; úsalas tal cual)"];
    const m = p.month;
    if (m) lines.push(`- Últimos 30 días: ${m.sessions} entrenos (los 30 anteriores: ${m.prev}); mejor semana: ${m.bestWeek}; racha: ${m.streak} días.`);
    if (p.score != null) lines.push(`- Score de fuerza: ${p.score}/100 (percentil contra gente que entrena, su peso y sexo)${p.scoreTrend != null && p.scoreTrend !== 0 ? `; ${p.scoreTrend > 0 ? "+" : ""}${p.scoreTrend} en 4 semanas` : ""}.${p.missing?.length ? ` Sin dato en: ${p.missing.join(", ")}.` : ""}`);
    else lines.push("- Score de fuerza: sin dato (necesita series con peso y RIR, de hasta 10 reps, en levantamientos con estándar).");
    for (const l of p.lifts ?? []) lines.push(`  - ${l.name}: ~${n(l.e1rm)} kg de máximo estimado → ${l.level} (percentil ${l.pct}).`);
    const v = p.vs3m;
    if (v) {
      lines.push(`- Hace 3 meses → hoy: score ${v.scoreThen ?? "—"} → ${v.scoreNow ?? "—"}; entrenos en 4 semanas ${v.sessionsThen} → ${v.sessionsNow}.`);
      for (const l of v.lifts ?? []) lines.push(`  - ${l.name}: ~${n(l.then)} → ~${n(l.now)} kg.`);
    } else lines.push("- Hace 3 meses: todavía no hay historia de entonces.");
    if (p.records?.length) { lines.push("- Récords recientes:"); for (const r of p.records.slice(0, 8)) lines.push(`  - ${d(r.day)} · ${r.name}: ${r.text}`); }
    // Parámetros atléticos (fase I9): de sus series de 4 semanas y los pasos del reloj, con el bono de sus clases
    const ath = p.athletic;
    if (ath?.params?.length) {
      const cls = (ath.classes ?? []).map((id: string) => FX.classById(id)?.name).filter(Boolean);
      lines.push(`- Parámetros atléticos (0–100, de lo que entrena en 4 semanas${cls.length ? `, con el bono de ${cls.join(" + ")}` : ""}): ${ath.params.map((x: any) => `${x.label} ${x.value}`).join(", ")}.`);
    }
    lines.push("", "[Cómo presentarlo: 3-5 líneas, lo positivo primero y sin culpa si entrenó menos; los kg de «máximo estimado» son estimaciones (~). Los gráficos están en Forge › PROGRESO › Gráficos.]");
    return { output: lines.join("\n") };
  }

  // ─── Lo que toca hoy / cuándo toca un día (forge/forgeRoutine.routineToday, calculado en el teléfono) ───
  private async handleGetToday(input: TrainingPlanInput, memory: any): Promise<ToolExecutionResult> {
    let ver: string | undefined;
    const done = (q: string) => ({ output: q, metadata: { quickReply: q, ...(ver ? { veredicto: ver } : {}) } });
    const proj = await getProjection(memory).catch(() => null);
    const r = proj?.routine;
    if (!r?.days?.length) return done("Todavía no tienes una rutina en Forge, así que no hay un día que «toque». Si quieres, te armo una con tu equipo y tus días.\n\n[Opción: Ármame una rutina]");
    const { s } = await this.routineState(memory);
    const cat = FC.catalog(s);
    const nameOf = (id: string) => cat[id]?.name ?? id;
    const now = new Date();
    const today = localDayOf(now);
    const td = proj?.today && proj.today.day === today ? proj.today : null;
    if (!input.cansancio && !input.lugar && !input.dayQuery && !input.flojera) ver = veredictoHoy(td);
    const intent = await intentFor(memory, today).catch(() => null);
    const dayName = (d: any) => cleanDayName(d?.name ?? "");
    const itemsOf = (d: any): string[] => (d?.items ?? []).map((it: any) => `• ${nameOf(it.exId)}: ${FR.targetText(s, it)}${it.optional ? " (opcional)" : ""}`);
    // El orden desde el que toca: el del teléfono si es de hoy; si no, el de la rutina
    const order: string[] = td?.order?.length ? td.order : r.days.map((d: any) => d.id);
    const wk = FR.hasWeekdays(r);
    const when = (d: any): string => {
      if (wk && d.weekday != null) {
        const k = (d.weekday - now.getDay() + 7) % 7;
        return k === 0 ? "hoy" : k === 1 ? "mañana" : `el ${FR.WEEKDAY_NAMES[d.weekday]} (en ${k} días)`;
      }
      const i = order.indexOf(d.id);
      if (i <= 0) return td && !td.rest && td.dayId === d.id ? "hoy" : "en tu próximo entreno";
      return `en ${i + 1} entrenos más (antes: ${order.slice(0, i).map((id) => dayName(r.days.find((x: any) => x.id === id))).join(", ")})`;
    };

    // «Dormí mal, ¿igual entreno hoy?»
    if (input.cansancio) {
      const snap: any = await memory?.get?.("health_snapshot_latest").catch?.(() => null);
      const fresh = snap?.lastUpdated && now.getTime() - Date.parse(snap.lastUpdated) < 20 * 3600_000;
      const h: number | null = fresh && typeof snap?.sleep?.durationHours === "number" && snap.sleep.durationHours > 0 ? snap.sleep.durationHours : null;
      const hTxt = h != null ? `${String(Math.round(h * 10) / 10).replace(".", ",")} h` : null;
      const hoyToca = td?.rest || (!td && wk && FR.isRestDay(r, now)) ? null : td?.items?.length ? cleanDayName(td.name ?? "") : null;
      const out: string[] = [];
      // Sueño 2.0 · S3: con las 2 semanas del teléfono, el juicio mira las 3 últimas noches y la deuda (lo mismo que Forge)
      const rd = fresh && snap?.sleepInsights && typeof snap.sleepInsights.need === "number" ? sleepReadiness(snap.sleepInsights, lastSleepFrom(snap.sleep)) : null;
      if (!hoyToca && (td?.rest || (!td && wk && FR.isRestDay(r, now)))) {
        out.push(`Hoy tu rutina es de descanso${hTxt ? ` y dormiste ${hTxt}` : ""}: perfecto para recuperarte. Si quieres moverte, una caminata suave.`);
      } else if (rd && rd.level !== "normal") {
        out.push(`${rd.why} ${rd.tip}`);
      } else if (rd && h != null && h >= 6) {
        out.push(`Tu reloj marca ${fmtSleep(h)} de sueño y vienes bien de las últimas noches: puedes entrenar normal aunque sientas que dormiste mal.`);
        out.push("Calienta bien, y si te sientes pesado deja una repetición más en reserva.");
      } else if (h != null && snap?.sleep?.split && typeof snap.sleep.nightHours === "number" && snap.sleep.nightHours < 6) {
        // Partido (Sueño 2.0 · S0): mucho en total pero poca noche no es «descansaste lo suficiente»
        out.push(`Dormiste ${fmtSleep(h)} en total, pero partido: la noche fue de ${fmtSleep(snap.sleep.nightHours)}. Puedes entrenar, pero liviano: deja una o dos repeticiones más en reserva y nada de récords hoy.`);
      } else if (h != null && h >= 7) {
        // Dice que durmió mal, pero el reloj marca suficiente: cuenta la calidad, no solo las horas
        out.push(`Tu reloj marca ${hTxt} de sueño, así que descansaste lo suficiente aunque sientas que dormiste mal: entrena normal.`);
        out.push("Calienta bien, y si te sientes pesado deja una repetición más en reserva. Nada de forzar récords hoy si no te sientes al cien.");
      } else if (h == null || h >= 6) {
        out.push(`${hTxt ? `Con ${hTxt} de sueño` : "Si dormiste mal pero te sientes bien"}, sí puedes entrenar: rindes un poco menos, pero no es un riesgo.`);
        out.push("Ajuste para hoy: calienta bien, deja una repetición más en reserva de lo normal y no busques récords. Si una serie se siente muy pesada, quita la última.");
      } else if (h >= 5) {
        out.push(`Con ${hTxt} de sueño puedes entrenar, pero liviano: baja ~10 % el peso o haz una serie menos por ejercicio, y nada de récords hoy.`);
      } else {
        out.push(`Con ${hTxt} de sueño, hoy conviene algo suave (movilidad o caminar 20–30 min) o mover el entreno a mañana: cansado se entrena peor y es más fácil lesionarse. Si igual vas, que sea liviano.`);
      }
      if (hoyToca) out.push(`Hoy te toca **${hoyToca}**${td?.items?.length ? `: ${td.items.slice(0, 3).map((x: any) => x.name.replace(/\s*\([^)]*\)/g, "")).join(", ")}` : ""}.`);
      out.push("Si además te sientes enfermo (fiebre, mareo), mejor descansa. Y esta noche, a dormir un poco antes: es lo que más te va a ayudar mañana.");
      return done(out.join("\n"));
    }

    // «Me da lata ir»: lo de hoy en versión corta (los 2 primeros ejercicios), sin culpa si de verdad está enfermo
    if (input.flojera) {
      const descanso = td?.rest || (!td && wk && FR.isRestDay(r, now)) || intent?.answer === "no";
      if (descanso) {
        ver = "Hoy no toca: descansa sin culpa.";
        return done("Hoy tu rutina es de descanso, así que no tienes que ir. Si te sobran ganas, una caminata suave.");
      }
      const nombre = td?.items?.length ? cleanDayName(td.name ?? "") : null;
      const primeros = (td?.items ?? []).slice(0, 2).map((x: any) => String(x.name).replace(/\s*\([^)]*\)/g, ""));
      const mes = (proj as any)?.progress?.month?.sessions;
      const out = [
        `Hoy toca **${nombre ?? "entrenar"}**. Si te da lata, haz la versión corta: ${primeros.length ? `solo ${primeros.join(" y ")}` : "los 2 primeros ejercicios"} (~25 min) y te vas; muchas veces, una vez allá, sale el resto.`,
        ...(typeof mes === "number" && mes < 8 ? [`Llevas ${mes} ${mes === 1 ? "entreno" : "entrenos"} en 30 días: saltarte hoy te deja más lejos de lo que quieres.`] : []),
        "Si estás enfermo o con dolor, eso sí es motivo: descansa y vuelves mañana.",
      ];
      ver = "No. Ve aunque sea a la versión corta.";
      return done(out.join("\n"));
    }

    // «¿Gym o casa?»: lo de hoy, qué sale en casa con lo que tienes y qué se cambia
    if (input.lugar) return done(this.lugarHoy(s, r, td, wk, now, intent, dayName, nameOf));

    // «¿Cuándo me toca tirón?»
    if (input.dayQuery) {
      const d = dayFromQuery(r, foldText(input.dayQuery));
      if (!d) return done(`En tu rutina no encontré ese día. Tus días: ${r.days.map((x: any) => dayName(x)).join(" · ")}.`);
      const w = when(d);
      const yaHoy = w === "hoy" && td && td.dayId === d.id && td.doneSets > 0 ? ` (ya llevas ${td.doneSets} series hoy)` : "";
      return done(`**${dayName(d)}** te toca ${w}${yaHoy}:\n${itemsOf(d).slice(0, 8).join("\n")}\n\nEse día Forge lo carga solo en ENTRENAR, con el peso que corresponde.`);
    }

    // «¿Qué me toca hoy?»
    const lines: string[] = [];
    if (intent?.answer === "no") lines.push("Dijiste que hoy descansas: perfecto, el descanso también es parte del plan.");
    if (td?.rest || (!td && wk && FR.isRestDay(r, now))) {
      const next = r.days.filter((d: any) => d.weekday != null).map((d: any) => ({ d, k: (d.weekday - now.getDay() + 7) % 7 || 7 })).sort((a: any, b: any) => a.k - b.k)[0]?.d;
      lines.push(`Hoy tu rutina es de **descanso**.${next ? ` Lo próximo es **${dayName(next)}** ${when(next)}.` : ""} Si te sobran ganas, una caminata o movilidad suave suma sin cansarte.`);
      return done(lines.join("\n"));
    }
    if (td && td.items?.length) {
      lines.push(`Hoy te toca **${cleanDayName(td.name ?? "")}**:`);
      lines.push(...td.items.slice(0, 10).map((x: any) => `• ${x.name}: ${x.text}`));
      if (td.doneSets > 0) lines.push(`\nYa llevas ${td.doneSets} series hoy: vas bien.`);
      lines.push("\nEstá cargado en Forge › ENTRENAR, con el peso que corresponde a tu progreso.");
      return done(lines.join("\n"));
    }
    // Sin el cálculo de hoy del teléfono (no ha abierto la app hoy): por día de la semana o el primero del orden
    const d = (wk ? r.days.find((x: any) => x.weekday === now.getDay()) : null) ?? r.days.find((x: any) => x.id === order[0]) ?? r.days[0];
    lines.push(`Según tu rutina, hoy toca **${dayName(d)}**:`, ...itemsOf(d).slice(0, 10));
    lines.push("\nAl abrir Forge te lo carga en ENTRENAR con los pesos de hoy.");
    return done(lines.join("\n"));
  }

  // ─── Armar la rutina por código (forge/forgeRoutine.ts, la misma que el botón de la app) ───
  /** «¿Me conviene ir al gym o entreno en casa?» por código: lo de hoy, cuánto sale en casa y con qué se reemplaza lo que no. */
  private lugarHoy(s: FC.ForgeState, r: any, td: any, wk: boolean, now: Date, intent: any, dayName: (d: any) => string, nameOf: (id: string) => string): string {
    if (intent?.answer === "no") return "Hoy dijiste que descansas, así que no hace falta ir a ningún lado. Si te sobran ganas, una caminata o movilidad en casa suma sin cansarte.";
    if (td?.rest || (!td && wk && FR.isRestDay(r, now))) return "Hoy tu rutina es de **descanso**: no hace falta el gym. Si te sobran ganas, una caminata o movilidad suave en casa.";
    const d = (td?.dayId ? r.days.find((x: any) => x.id === td.dayId) : null)
      ?? (wk ? r.days.find((x: any) => x.weekday === now.getDay()) : null) ?? r.days.find((x: any) => x.id === (td?.order?.[0] ?? r.days[0]?.id)) ?? r.days[0];
    const ids: string[] = (d?.items ?? []).map((it: any) => it.exId);
    if (!ids.length) return "No encontré los ejercicios de hoy en tu rutina. Ábrela en Forge › ENTRENAR y te digo.";
    const res = FR.enCasa(s, r, ids);
    const casa = res.filter((x) => x.ok), gym = res.filter((x) => !x.ok);
    const nombre = dayName(d);
    if (!gym.length) return `Hoy toca **${nombre}** y todo se puede hacer en casa con lo que tienes (${casa.map((x) => nameOf(x.exId)).join(", ")}). Si te ahorra el viaje, entrena en casa; el progreso es el mismo.`;
    const lines = [`Hoy toca **${nombre}**. ${casa.length ? `En casa salen ${casa.length} de ${res.length} ejercicios` : "En casa no sale ninguno tal cual"}; estos necesitan el gimnasio:`];
    for (const x of gym) lines.push(`• ${nameOf(x.exId)}${x.to ? ` → en casa: ${nameOf(x.to)}` : " (sin un reemplazo parecido en casa)"}`);
    const sinReemplazo = gym.filter((x) => !x.to).length;
    lines.push("");
    lines.push(gym.length * 2 > res.length || sinReemplazo
      ? "Si puedes, ve al gym: hoy lo principal necesita sus máquinas o pesos. Si no alcanzas, en casa con esos reemplazos igual cuenta."
      : "Puedes hacerlo en casa con esos reemplazos sin perder mucho; si tienes tiempo de ir, en el gym sale completo.");
    lines.push("Para cambiar dónde entrenas siempre: Forge › Mi gimnasio.");
    return lines.join("\n");
  }

  private async routineState(memory: any) {
    const [proj, body, cat] = await Promise.all([
      getProjection(memory).catch(() => null), memory?.get?.("body_profile").catch(() => null), memory?.get?.("toji_exercise_catalog").catch(() => null),
    ]);
    const s = FC.newState();
    s.bodyKg = body?.weightKg ?? null; s.sex = body?.sex ?? null; s.age = body?.age ?? null; s.heightCm = body?.heightCm ?? null;
    s.goal = body?.goal ?? null; s.gym = proj?.gym ?? null; s.customExercises = Array.isArray(cat?.custom) ? cat.custom : [];
    return { s, proj };
  }

  private async sendRoutine(memory: any, wsClient: any, s: FC.ForgeState, r: FR.Routine, home: FR.Routine | null = null) {
    const md = FR.routineToMd(s, r) + (home ? `\n\n---\n\n## 🏠 Si no puedes ir al gimnasio\n\n${FR.routineToMd(s, home).replace(/^# .*\n/, "")}` : "");
    // La rutina escrita por el usuario (source «md») NO se reemplaza por la tabla: su texto sigue siendo suyo
    const keepText = r.source === "md";
    if (!keepText) await memory?.set?.("toji_routine_md", { md, name: r.name }).catch?.(() => {});
    const proj = (await getProjection(memory).catch(() => null)) ?? { day: "", at: "" };
    await memory?.set?.(PROJECTION_KEY, { ...proj, routine: r }).catch?.(() => {});
    try { wsClient?.send(JSON.stringify({ type: "forge_routine", routine: r })); } catch {}
    if (!keepText) try { wsClient?.send(JSON.stringify({ type: "toji_save_routine", md, name: r.name })); } catch {}
    return md;
  }

  private async handleBuildRoutine(input: TrainingPlanInput, memory: any, wsClient: any, medical?: MedicalProfile): Promise<ToolExecutionResult> {
    // Lo que ya dijo (dónde, cuidados, minutos) queda guardado mientras se pregunta lo que falta
    const known: Record<string, unknown> = Object.fromEntries(Object.entries({ minutes: input.minutes, goal: input.goal, where: input.where, care: input.care, both: input.both }).filter(([, v]) => v !== undefined));
    if (!input.days) {
      await memory?.set?.(ROUTINE_PENDING_KEY, { at: new Date().toISOString(), req: known }).catch?.(() => {});
      const q = input.reask
        ? "Para armarla me falta lo principal: ¿cuántos días a la semana puedes entrenar?\n\n[Opción: 3 días] [Opción: 4 días] [Opción: 5 días]"
        : askRoutineText(known);
      return { output: q, metadata: { quickReply: q } };
    }
    const { s, proj } = await this.routineState(memory);
    const conds = (medical?.conditions ?? []).map((c: any) => c?.id);
    const opts = {
      days: input.days, minutes: input.minutes, goal: input.goal, care: input.care as any,
      hypertension: conds.includes("hypertension"), diabetes: conds.some((c: string) => /diabetes/.test(c)),
      e1rm: proj?.e1rm, experience: proj?.experience, source: "eris" as const,
    };
    const r = FR.buildRoutine(s, { ...opts, where: input.where });
    // Gimnasio y casa: la del gimnasio es la que carga cada día en Forge; la de casa queda en el mismo .md de la pestaña RUTINA
    const home = input.both && r.where === "gym" ? FR.buildRoutine(s, { ...opts, where: "casa" }) : null;
    const md = await this.sendRoutine(memory, wsClient, s, r, home);
    await memory?.set?.(ROUTINE_PENDING_KEY, { at: new Date().toISOString(), req: { ...known, days: input.days }, built: true }).catch?.(() => {});
    if (input.viaCode) {
      const q = routineSummary(s, r, home, input);
      return { output: q, metadata: { quickReply: q } };
    }
    const kbNote = formatGuidanceForLLM(medical, "training");
    return { output: `✅ Rutina armada y guardada en Forge (pestaña RUTINA; cada día carga sola lo que toca, con el peso que corresponde):\n\n${md}${kbNote ? `\n\n*Nota:*\n${kbNote}` : ""}\n\n[Cómo presentarlo: resume los días en 3-5 líneas y ofrece cambiar un ejercicio, los días o los minutos; no repitas la tabla entera.]` };
  }

  // ─── Tu rutina escrita → plan por días (forge/forgeMdRoutine.ts, la misma revisión que la app; fase I8) ───
  private async handleLoadMdRoutine(input: TrainingPlanInput, memory: any, wsClient: any): Promise<ToolExecutionResult> {
    const done = (q: string) => ({ output: q, metadata: { quickReply: q } });
    if (input.review) {
      await memory?.set?.(MD_PENDING_KEY, null).catch?.(() => {});
      return done("Bien: en Forge › RUTINA toca «Revisar y convertir». Ahí puedes cambiar cada ejercicio, crear los nuevos o quitarlos antes de guardar.");
    }
    const stored = await memory?.get?.("toji_routine_md").catch?.(() => null);
    if (!stored?.md) return done("Todavía no tengo tu rutina escrita. Pégala en Forge › RUTINA («Pegar la mía») o mándamela acá, y la convierto en un plan por días.");
    const { s, proj } = await this.routineState(memory);
    // El texto es la tabla de la rutina que ya armé (y ya es un plan): no hay nada que convertir
    const built = proj?.routine && proj.routine.source !== "md" ? proj.routine : null;
    if (built && String(stored.md).trimStart().startsWith(`# ${built.name}`)) {
      await memory?.set?.(MD_PENDING_KEY, null).catch?.(() => {});
      return done(`Tu rutina («${built.name}») ya está como plan en Forge › RUTINA: cada día carga solo lo suyo. Si tienes una escrita por ti, pégala en Forge › RUTINA («Editar») y dime «carga mi rutina».`);
    }
    const md = FM.parseRoutineMd(s, String(stored.md));
    if (!md.days.length) return done("Leí tu rutina, pero no encontré días con ejercicios y series («Día 1: …» y debajo «Press de banca: 4 series x 6-8»). Revísala en Forge › RUTINA y la convierto.");
    const choices = FM.defaultChoices(md);
    const { routine, newExercises } = FM.mdToRoutine(s, md, choices, { name: stored.name });
    // con los propios ya creados, para nombrarlos y escribir sus series
    const s2: FC.ForgeState = { ...s, customExercises: [...(s.customExercises || []), ...newExercises] };
    const nameOf = (id: string) => FC.catalog(s2)[id]?.name ?? id;
    if (!input.confirm) {
      await memory?.set?.(MD_PENDING_KEY, { at: new Date().toISOString() }).catch?.(() => {});
      const sum = FM.mdSummary(md, choices);
      const lines = [`📋 Tu rutina «${routine.name}» tiene ${routine.days.length} días. Así quedaría el plan:`, ""];
      for (const d of routine.days) {
        const wd = d.weekday != null ? ` (${FR.WEEKDAY_NAMES[d.weekday]})` : "";
        lines.push(`• **${d.name}**${wd}: ${d.items.map((i) => `${nameOf(i.exId)} ${FR.targetText(s2, i).split(" · ")[0]}`).join(" · ")}`);
      }
      const unsure = md.days.flatMap((d) => d.lines.filter((l) => l.match.confidence === "probable" && choices[l.key] === l.match.exId).map((l) => `${FM.customName(l.name)} → ${nameOf(l.match.exId!)}`));
      if (unsure.length) lines.push("", `🤔 Los tomé como el más parecido: ${unsure.join(" · ")}.`);
      if (newExercises.length) lines.push("", `🆕 Crearía ${newExercises.length === 1 ? "este ejercicio propio" : `estos ${newExercises.length} ejercicios propios`}: ${newExercises.map((c) => c.name).join(" · ")}.`);
      if (sum.lines > 0) lines.push("", "Cada día carga solo lo suyo. Los pesos parten desde abajo de lo que dice tu rutina, con los pesos reales de tu gimnasio, y suben con tu progreso.");
      lines.push("", "¿La cargo?", "", "[Opción: Sí, cárgala] [Opción: La reviso en la app]");
      return done(lines.join("\n"));
    }
    await memory?.set?.(MD_PENDING_KEY, null).catch?.(() => {});
    if (!wsClient) return done("Necesito la app conectada para dejarla en Forge. Ábrela y pídemelo de nuevo («carga mi rutina»).");
    try { wsClient.send(JSON.stringify({ type: "forge_routine", routine, newExercises })); } catch {}
    await memory?.set?.(PROJECTION_KEY, { ...(proj ?? { day: "", at: "" }), routine }).catch?.(() => {});
    // El texto que escribiste NO se toca: sigue siendo tuyo (toji_routine_md)
    const now = FC.L.forgeNow();
    const next = FR.nextRoutineDay(s, routine, now);
    const today = FR.isRestDay(routine, now)
      ? `Hoy (${FR.WEEKDAY_NAMES[now.getDay()]}) no toca nada: descanso. ${next.weekday != null ? `El ${FR.WEEKDAY_NAMES[next.weekday]}` : "La próxima vez"} toca **${next.name}**.`
      : `Hoy toca **${next.name}**: ya está en ENTRENAR.`;
    const nuevos = newExercises.length === 1 ? ", con un ejercicio propio nuevo" : newExercises.length ? `, con ${newExercises.length} ejercicios propios nuevos` : "";
    return done(`✅ Listo: tu rutina quedó como plan en Forge › RUTINA (${routine.days.length} días${nuevos}). ${today}`);
  }

  private async handleAdjustRoutine(input: TrainingPlanInput, memory: any, wsClient: any, medical?: MedicalProfile): Promise<ToolExecutionResult> {
    const { s, proj } = await this.routineState(memory);
    const current = proj?.routine ? FR.sanitizeRoutine(s, proj.routine) : null;
    if (!current) return { output: "", error: "No tiene una rutina estructurada todavía. Ofrece armarla con build_routine (pregunta días y minutos)." };
    if (input.swapExercise) {
      const fold = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const want = fold(input.swapExercise).replace(/^(el|la|los|las)\s+/, "");
      const cat = FC.catalog(s);
      const ids = current.days.flatMap((d) => d.items.map((i) => i.exId));
      const hit = ids.find((id) => fold(cat[id]?.name ?? "").includes(want)) ?? ids.find((id) => want.split(/\s+/).every((w) => fold(cat[id]?.name ?? "").includes(w)));
      if (!hit) return { output: "", error: `«${input.swapExercise}» no está en su rutina. Sus ejercicios: ${[...new Set(ids)].map((id) => cat[id]?.name).join(", ")}.` };
      const res = FR.swapExercise(s, current, hit, current.where, (input.care as any) ?? []);
      if (!res.to) return { output: `No encontré una alternativa para ${cat[hit]?.name} con su equipo. Puede seguir con ella o pedir otra cosa.` };
      // cambiar un ejercicio no cambia de quién es la rutina (la escrita sigue siendo la suya)
      await this.sendRoutine(memory, wsClient, s, { ...res.routine, source: current.source === "md" ? "md" : "eris" });
      return { output: `✅ Cambié ${cat[hit]?.name} por ${cat[res.to]?.name} en su rutina (Forge ya lo tiene).` };
    }
    // Cambiar días, minutos u objetivo: se vuelve a armar con lo nuevo. La rutina escrita por el usuario no se rearma encima
    // (se perdería lo suyo): se edita el texto y se vuelve a convertir, o se pide una nueva
    if (current.source === "md") {
      const q = "Tu rutina es la que escribiste, así que no la rearmo encima. Para cambiar los días, edítala en Forge › RUTINA («Ver mi texto» y después «Editar mi texto») y la vuelvo a convertir; o, si prefieres una nueva, pídeme «ármame una rutina de 4 días».";
      return { output: q, metadata: { quickReply: q } };
    }
    const conds = (medical?.conditions ?? []).map((c: any) => c?.id);
    const r = FR.buildRoutine(s, {
      days: input.days ?? current.daysPerWeek, minutes: input.minutes ?? current.minutes, goal: input.goal ?? current.goal, where: input.where ?? current.where,
      care: input.care as any, hypertension: conds.includes("hypertension"), diabetes: conds.some((c: string) => /diabetes/.test(c)),
      e1rm: proj?.e1rm, experience: proj?.experience, source: "eris",
    });
    const md = await this.sendRoutine(memory, wsClient, s, r);
    return { output: `✅ Rutina ajustada y guardada en Forge:\n\n${md}\n\n[Cómo presentarlo: di qué cambió en 2-3 líneas.]` };
  }
}

/** El catálogo base (130 ejercicios) en pocas líneas: ids por grupo, para elegir sin inventar. */
function baseCatalogText(): string {
  const groups: Record<string, string[]> = {};
  for (const e of FC.BASE_EXERCISES) (groups[e.group] ||= []).push(`${e.id} (${e.name})`);
  return "## Catálogo base de Forge (usa estos ids)\n" + Object.entries(groups).map(([g, l]) => `- ${g}: ${l.join(", ")}`).join("\n");
}

// ─── «Arma mi rutina» por código ───

export const ROUTINE_PENDING_KEY = "routine_pending";
/** «¿La cargo?» de la rutina escrita (30 min) */
export const MD_PENDING_KEY = "md_routine_pending";
/** «Carga mi rutina», «convierte mi rutina en plan», «usa mi rutina escrita» (no «ármame una rutina»: eso es build_routine) */
// Verbos en imperativo o infinitivo, no cualquier forma («¿ya usaste la rutina?» no pide convertirla)
export const MD_ROUTINE_ASK = /\b(carga(la|me)?|cargar(la)?|cargame|usa(la)?|usar(la)?|pasa(la)?|pasar(la)?|convierte(la)?|convertir(la)?|transforma(la)?|transformar(la)?|importa(la)?|importar(la)?|aplica(la)?|aplicar(la)?|lee(la)?|leer(la)?)\b[^.?!]{0,30}\b(mi|la|esta|esa)\s+rutina\b(?!\s+de\s+\d)|\bmi rutina (escrita|del md|en texto|de texto|del archivo|de toji)\b/;
const foldText = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** Pide una rutina nueva: «arma mi rutina», «hazme una rutina de 4 días», «quiero un plan de entrenamiento». */
export const ROUTINE_ASK = /\b(arma\w*|crea\w*|haz\w*|hace\w*|dame|quiero|necesito|genera\w*|disen\w*|planifica\w*|prepara\w*|propon\w*)\b[^.?!]{0,50}\b(rutina|plan de (entrenamiento|entreno|gimnasio|gym))\b/;
/** «Rutina para dormir», «rutina de skincare», «rutina de estudio»: no son de Forge (revisión 2026-11-04, C2) */
export const NOT_GYM_ROUTINE = /\brutina\w* (para|de|antes de|del?) (dormir|dormirme|acostarme|sueno|la noche|noche|manana|la manana|skin\w*|cuidado\w*|belleza|piel|cara|pelo|estudio|estudiar|trabajo|limpieza|aseo|orden|meditacion|relajacion|respiracion|lectura|higiene|bano|desayuno|comidas?|alimentacion|dieta)\b|\brutina nocturna\b/;
/** «¿Me conviene ir al gym o entreno en casa?», «¿lo de hoy lo puedo hacer en casa?» */
export const PLACE_ASK = /\b((gym|gimnasio)\b[^.?!]{0,40}\b(o|u)\b[^.?!]{0,20}\b(en )?(la )?casa|(en )?casa\b[^.?!]{0,30}\b(o|u)\b[^.?!]{0,20}\b(gym|gimnasio)|(puedo|podria|se puede|alcanzo a) (entrenar|hacer(lo)?|hacer (la|mi) rutina|hacer lo de hoy)( lo de hoy)? en (la )?casa|entreno en (la )?casa hoy|hoy entreno en casa\?|no (puedo|alcanzo a) ir al (gym|gimnasio)\b[^.?!]{0,30}\bque (hago|entreno))\b/;
/** Cambiar o guardar una que ya tiene (eso lo decide el modelo con adjust_routine / save_routine) */
const ROUTINE_EDIT = /\b(cambia\w*|reemplaza\w*|saca\w*|quita\w*|modifica\w*|ajusta\w*|registra\w*|guarda\w*|anota\w*|sube\w*|baja\w*)\b/;
/** «¿Qué me toca hoy?», «¿qué entreno hoy en el gym?», «mi rutina de hoy» */
export const TODAY_ASK = /\b(que (ejercicios?|entrenamiento|rutina|musculos?|grupo( muscular)?) (hago|toca|me toca|entreno|trabajo|hare)( hoy)?|que hago (hoy )?de (ejercicio|entreno|entrenamiento)|que (me )?toca (hoy|entrenar|en el (gym|gimnasio))|que (entreno|hago|toca) hoy( en el (gym|gimnasio))?|que (entreno|hago) en el (gym|gimnasio)( hoy)?|(cual es )?mi (entreno|rutina|entrenamiento|plan de entreno) de hoy|que dia (de (la|mi) rutina )?me toca|me toca entrenar hoy|hoy (me )?toca entrenar)\b/;
/** «¿Cuándo me toca tirón?», «¿qué día es mi próximo entrenamiento de pierna?» */
export const NEXT_ASK = /\b(cuando|que dia)\b[^?.!]{0,40}\b(me toca|toca|es mi|sigue|proximo|siguiente)\b/;
/** «Dormí mal», «estoy reventado», «no pude dormir» + entrenar */
const TIRED = /\b(dormi (mal|poco|poquito|muy poco|re poco|pesimo|fatal|nada|re mal|super mal|como las weas|horrible)|no (pude )?dormi\w*|casi no dormi|estoy (muy )?(cansad\w*|reventad\w*|muert\w*|agotad\w*|sin energia|hecho bolsa)|ando (cansad\w*|sin energia)|tengo sueno|con sueno)\b/;
const TRAIN_WORD = /\b(entren\w*|entreno|gym|gimnasio|rutina|ejercicio|pesas)\b/;
/** Sin ganas de ir (no cansancio): «me da lata», «no tengo ganas», «¿lo dejo para mañana?», «me lo salto» */
const FLOJERA = /\b(me da (lata|paja|flojera)|que lata|flojera|no tengo ganas|sin ganas|no me dan ganas|me cuesta ir|lo dejo (para|pa) manana|me (lo )?salto|saltarme|faltar al|no ir al)\b/;
/** «¿Qué tan fuerte estoy?», «¿cómo voy en el gym?», «mis récords» */
export const PROGRESS_ASK = /\b((analiza\w*|revisa\w*|evalua\w*|como va|como ha ido|como viene|resumen de|resumeme) (mi|el) (entreno|entrenamiento|progreso( en (el )?(gym|gimnasio|forge))?|rendimiento en el (gym|gimnasio))|que tan fuerte|cuan fuerte|cuanto levanto|cuanto (es )?mi (maximo|1 ?rm|rm)|mis records|mi progreso (en|de) (forge|el gym|el gimnasio|fuerza)|como voy (en el (gym|gimnasio)|con (el|mi) (entreno|entrenamiento|fuerza))|como va mi (progreso|fuerza)|he progresado|estoy progresando|estoy mas fuerte|mi score de fuerza|cuanto he subido)\b/;
const localDayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** «Día 2: Tirón (sábado)» → «Tirón» */
const cleanDayName = (n: string) => n.replace(/^\s*d[ií]a\s*[\w]+\s*[:—–-]\s*/i, "").replace(/\s*\((lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\)\s*$/i, "").trim() || n;
const STOP = new Set(["dia", "de", "y", "con", "el", "la", "los", "las", "del", "en", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]);
/** El día de la rutina que nombra el mensaje («tirón», «pierna», «día 2», «día B») */
export function dayFromQuery(r: { days: any[] }, t: string): any | null {
  const num = t.match(/\bdia ([1-7a-f])\b/);
  if (num) {
    const k = num[1];
    const byLabel = r.days.find((d) => new RegExp(`^\\s*d[ií]a\\s*${k}\\b`, "i").test(d.name ?? ""));
    if (byLabel) return byLabel;
  }
  let best: { d: any; hits: number } | null = null;
  for (const d of r.days) {
    const words = foldText(`${cleanDayName(d.name ?? "")} ${d.focus ?? ""}`).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));
    const hits = words.filter((w) => new RegExp(`\\b${w.slice(0, Math.max(4, w.length - 1))}`).test(t)).length;
    if (hits && (!best || hits > best.hits)) best = { d, hits };
  }
  return best?.d ?? null;
}
const kgTxt = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
/** En dominadas y fondos el máximo cuenta el peso del cuerpo («133 kg» solo no se entiende) */
const conPeso = (name: string) => (/dominad|fondo/i.test(name) ? " contando tu peso" : "");
/** «¿Qué tan fuerte estoy en press de banca?» con las cifras del teléfono (progressContext): el levantamiento que nombra, o el resumen */
export function progressReply(p: any, t: string, e1rm?: Record<string, number>): string {
  const lifts: any[] = p.lifts ?? [];
  const named = lifts.find((l) => t.includes(foldText(l.name)) || foldText(l.name).split(" ").filter((w: string) => w.length >= 5).some((w: string) => t.includes(w)));
  const out: string[] = [];
  if (named) {
    out.push(`En **${named.name}** tu máximo estimado es ~${kgTxt(named.e1rm)} kg${conPeso(named.name)}: nivel ${named.level} (percentil ${named.pct} entre gente que entrena, de tu peso y sexo).`);
    const then = (p.vs3m?.lifts ?? []).find((l: any) => l.name === named.name);
    if (then) out.push(then.now > then.then ? `Hace 3 meses estabas en ~${kgTxt(then.then)} kg: subiste ~${kgTxt(then.now - then.then)} kg.` : `Hace 3 meses estabas en ~${kgTxt(then.then)} kg.`);
    const rec = (p.records ?? []).find((x: any) => foldText(x.name).startsWith(foldText(named.name)));
    if (rec) out.push(`Tu último récord ahí: ${rec.text}.`);
  } else {
    if (p.score != null) out.push(`Tu score de fuerza es ${p.score}/100${p.scoreTrend ? ` (${p.scoreTrend > 0 ? "+" : ""}${p.scoreTrend} en 4 semanas)` : ""}.`);
    const top = lifts.slice().sort((a, b) => b.pct - a.pct).slice(0, 4);
    if (top.length) out.push(...top.map((l) => `• ${l.name}: ~${kgTxt(l.e1rm)} kg de máximo estimado${conPeso(l.name)} (${l.level})`));
    else if (e1rm && Object.keys(e1rm).length) out.push("Todavía no tengo levantamientos con estándar para darte un nivel (press de banca, sentadilla, peso muerto, press militar, dominadas).");
    if (p.month) out.push(`En los últimos 30 días: ${p.month.sessions} entrenos${p.month.prev != null ? ` (los 30 anteriores: ${p.month.prev})` : ""}${p.month.streak ? `, racha de ${p.month.streak} días` : ""}.`);
    const recs = (p.records ?? []).slice(0, 3);
    if (recs.length) out.push(`Récords recientes: ${recs.map((r: any) => `${r.name} ${r.text}`).join(" · ")}.`);
  }
  if (!out.length) return "Aún no tengo series suficientes para medir tu fuerza: anota tus series con peso y repeticiones en Forge y te lo cuento.";
  out.push("Los «máximos estimados» salen de tus series (peso × reps); los gráficos están en Forge › PROGRESO.");
  return out.join("\n");
}
const WORD_N: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
const N = "([2-6]|dos|tres|cuatro|cinco|seis)";
const num = (x: string) => WORD_N[x] ?? Number(x);

/** Lo que dijo de su rutina: días (con «3 o 4», el menor: lo sostenible), minutos, dónde, zonas a cuidar y objetivo. */
export function parseRoutineAnswer(t: string): { days?: number; minutes?: number; where?: "gym" | "casa"; both?: boolean; care?: Array<"lumbar" | "hombro" | "rodilla" | "muneca" | "codo">; goal?: "fuerza" | "hipertrofia" | "salud" } {
  const out: ReturnType<typeof parseRoutineAnswer> = {};
  const range = t.match(new RegExp(`\\b${N}\\s*(?:o|a|-|y)\\s*${N}\\s*(?:dias?|veces)\\b`));
  const one = t.match(new RegExp(`\\b${N}\\s*(?:dias?|veces)\\b`));
  if (range) out.days = Math.min(num(range[1]), num(range[2]));
  else if (one) out.days = num(one[1]);
  const mins = t.match(/\b(\d{2,3})\s*(?:min|minutos)\b/);
  if (mins) out.minutes = Number(mins[1]);
  else if (/\bhora y media\b/.test(t)) out.minutes = 90;
  else if (/\bmedia hora\b/.test(t)) out.minutes = 30;
  else if (/\b(una|1) ?(hora|h)\b/.test(t)) out.minutes = 60;
  const gym = /\b(gimnasio|gym|smart ?fit|sportlife|upgrade|pacific)\b/.test(t), casa = /\b(casa|hogar|depa|departamento|pieza)\b/.test(t);
  if (gym) out.where = "gym"; else if (casa) out.where = "casa";
  if (gym && casa) out.both = true;
  const care: NonNullable<typeof out.care> = [];
  if (/\bhombros?\b/.test(t)) care.push("hombro");
  if (/\brodillas?\b/.test(t)) care.push("rodilla");
  if (/\b(lumbar|espalda baja|zona baja|ciatic\w*|cintura)\b/.test(t)) care.push("lumbar");
  if (/\bmunecas?\b/.test(t)) care.push("muneca");
  if (/\bcodos?\b/.test(t)) care.push("codo");
  if (care.length) out.care = care;
  if (/\b(hipertrofia|masa muscular|ganar musculo|volumen|crecer)\b/.test(t)) out.goal = "hipertrofia";
  else if (/\b(mas fuerte|ganar fuerza|fuerza maxima|powerlifting)\b/.test(t)) out.goal = "fuerza";
  else if (/\b(salud|constancia|mantenerme)\b/.test(t)) out.goal = "salud";
  return out;
}

/** Las preguntas, con lo que ya dijo descontado. */
function askRoutineText(known: { where?: unknown; both?: unknown; care?: unknown; minutes?: unknown }): string {
  const qs = ["¿Cuántos días a la semana puedes entrenar (y cuánto rato, si no es ~1 hora)?"];
  if (!known.where) qs.push("¿Dónde: gimnasio, casa o las dos?");
  if (!known.care) qs.push("¿Alguna zona con molestia o lesión que cuidar (hombro, rodilla, espalda baja…)?");
  return `Te la armo con tu equipo y tu fuerza real, y queda en Forge. Necesito:\n${qs.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nRespóndeme todo en un mensaje, por ejemplo: «4 días, 60 min, gimnasio y casa, cuidar el hombro».`;
}

const CARE_NAME: Record<string, string> = { hombro: "el hombro", rodilla: "la rodilla", lumbar: "la espalda baja", muneca: "la muñeca", codo: "el codo" };
const SPLIT_NAME: Record<FR.Routine["split"], string> = { full: "cuerpo completo", torso_pierna: "torso y pierna", ppl: "empuje, tirón y pierna", propia: "tu rutina escrita" };

/** Lo que armó, corto: un renglón por día, los cuidados y cómo cambiarla. */
function routineSummary(s: FC.ForgeState, r: FR.Routine, home: FR.Routine | null, input: { days?: number; care?: string[] }): string {
  const cat = FC.catalog(s);
  const dayLine = (d: FR.RoutineDay) => `• **${d.name}:** ${d.items.map((i) => `${cat[i.exId]?.name ?? i.exId} ${i.sets}×${i.repMin}–${i.repMax}${cat[i.exId]?.unit === "seg" ? " s" : ""}`).join(" · ")}`;
  const out = [`✅ Listo: tu rutina de ${r.daysPerWeek} días (${SPLIT_NAME[r.split]}, ~${r.minutes} min) quedó en Forge › RUTINA. Cada día carga solo lo que toca, con el peso que corresponde.`, "", `🏋️ **${r.where === "casa" ? "En casa" : "Gimnasio"}**`, ...r.days.map(dayLine)];
  if (home) out.push("", "🏠 **En casa** (si no puedes ir)", ...home.days.map(dayLine));
  const care = (input.care ?? []).map((c) => CARE_NAME[c] ?? c);
  if (care.length) out.push("", `🩹 Cuidando ${care.join(" y ")}: dejé fuera lo que más lo carga. Si la molestia pasa a dolor, para y cuéntame.`);
  if (r.split === "full" && r.daysPerWeek <= 3) out.push("", "Con 3 días, cuerpo completo rinde más que separar por grupos musculares: cada músculo se entrena 2–3 veces por semana.");
  const alt = r.daysPerWeek === 3 ? "[Opción: Mejor de 4 días]" : r.daysPerWeek === 4 ? "[Opción: Mejor de 3 días]" : "";
  out.push("", "Si quieres cambiar un ejercicio, dime cuál (por ejemplo «cambia la prensa»).", ...(alt ? ["", alt] : []));
  return out.join("\n");
}
