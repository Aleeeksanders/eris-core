import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { diagnoseBaseline, formatDiagnosisForLLM } from "../services/BaselineEngine.js";
import { getDismissals, getOverrides } from "./InsightFeedbackTool.js";
import { dayCtxFrom } from "../services/MealSchedule.js";

const PersonalBaselineInputSchema = z.object({
  focus: z.enum(["auto", "sleep", "hydration", "nutrition", "steps", "restingHR", "finance"])
    .optional()
    .describe(
      "Usa 'auto' (default) cuando el usuario pregunta algo genérico ('¿cómo voy hoy?') o para generar un tip espontáneo — " +
      "la herramienta identifica automáticamente cuál variable se desvía más de TU patrón personal. " +
      "Usa un valor específico solo si el usuario preguntó por esa métrica en particular."
    ),
});

type PersonalBaselineInput = z.infer<typeof PersonalBaselineInputSchema>;

export class PersonalBaselineTool extends Tool<PersonalBaselineInput> {
  readonly name = "personal_baseline";
  readonly description =
    "Analiza cómo está el usuario HOY comparado con SU PROPIO patrón histórico — nunca con umbrales genéricos de " +
    "industria presentados como si fueran personales. ACTIVAR cuando el usuario pregunte cómo va su día, su sueño, " +
    "su hidratación, su alimentación, sus pasos o sus finanzas, o para generar un tip espontáneo. " +
    "La herramienta YA calculó en código (no confíes en tu propia aritmética) el valor de hoy, el punto de " +
    "comparación (tu propio promedio si ya hay suficiente historial, separado entre días laborales y fines de " +
    "semana; o un valor de referencia general SOLO mientras el perfil todavía está en aprendizaje), el % de " +
    "desviación y un nivel de confianza. El texto te dice explícitamente si el perfil está 'DESBLOQUEADO' (análisis " +
    "100% personal) o 'EN APRENDIZAJE' (todavía usando referencias generales para algunas métricas, con los días " +
    "que faltan para desbloquearlo). Tu trabajo es SOLO redactar: (1) menciona ÚNICAMENTE la variable marcada como " +
    "'VARIABLE PRINCIPAL A COMENTAR' — no mezcles todo en un mensaje genérico tipo 'tu score bajó'; (2) si la " +
    "comparación es contra tu patrón personal, dilo así ('tu promedio habitual'), nunca como un número genérico; " +
    "(3) si la comparación es GENÉRICA (perfil aún en aprendizaje), acláralo EXPLÍCITAMENTE en tu respuesta — nunca " +
    "la presentes como si fuera el patrón del usuario — y opcionalmente menciona cuántos días faltan para tener " +
    "análisis personalizado; (4) usa la pista de consecuencia que te da la herramienta, sin inventar datos médicos " +
    "o financieros adicionales; (5) si ni siquiera hay referencia genérica disponible para nada, dilo explícitamente " +
    "y NO inventes un promedio; (6) si nada está fuera de rango, dilo brevemente y en tono positivo. " +
    "IMPORTANTE — TENDENCIAS: además del desvío de hoy, el texto puede incluir un bloque separado 'TENDENCIA " +
    "SOSTENIDA DETECTADA', que compara la última semana completa contra la semana anterior. Esto es un tipo de " +
    "señal DISTINTO al desvío de hoy — un día atípico dentro de un patrón estable NO es lo mismo que llevar varios " +
    "días empeorando de forma sostenida, y no deben mezclarse en una sola frase. Si aparece este bloque, coméntalo " +
    "explícitamente como un patrón de varios días (con más peso/seriedad si empeora, o como reconocimiento genuino " +
    "si mejora), sea o no que también haya una 'VARIABLE PRINCIPAL' de hoy en el mismo texto. " +
    "Si el usuario dice que un análisis no le sirve o no aplica, o te da un objetivo real de una fuente concreta " +
    "(su médico, su nutricionista), usa la herramienta 'insight_feedback' — nunca ignores el comentario ni le digas " +
    "que no puedes hacer nada al respecto.";
  readonly inputSchema = PersonalBaselineInputSchema;

  async execute(_input: PersonalBaselineInput, context?: any): Promise<ToolExecutionResult> {
    try {
      const [log, profile, dismissals, overrides] = await Promise.all([
        context?.memory?.getDailyRollupLog?.(),
        context?.memory?.getProfile?.(),
        getDismissals(context?.memory),
        getOverrides(context?.memory),
      ]);
      const snap = await context?.memory?.get?.("health_snapshot_latest").catch?.(() => null);
      const diagnosis = diagnoseBaseline(Array.isArray(log) ? log : [], new Date(), { medical: profile?.medical, dismissals, overrides, day: dayCtxFrom(snap) });
      return { output: formatDiagnosisForLLM(diagnosis) };
    } catch (err) {
      return {
        output: "",
        error: `Error calculando patrón personal: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
