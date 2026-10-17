// ============================================================
// Eris — InsightFeedbackTool
// La mitad "de riesgo" de la retroalimentación del usuario sobre
// los JUICIOS calculados de Eris (distinto de UserContextTool, que
// guarda hechos sobre el usuario sin necesitar evidencia — ahí el
// usuario siempre tiene razón porque es su propia vida).
//
// Acá el usuario puede estar equivocado, así que la aritmética
// NUNCA se recalcula solo porque no le gustó el resultado:
//   - 'dismiss'            → silencia ese tema por un tiempo, reversible,
//                            sin tocar ningún número.
//   - 'set_verified_target'→ SOLO si cita una fuente real (médico,
//                            especialista) — ahí deja de ser opinión.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";

const METRIC_KEYS = ["hydrationL", "sleepHours", "proteinG", "steps", "restingHR", "disponible", "savingsRate", "moodScore"] as const;
export type FeedbackMetricKey = typeof METRIC_KEYS[number];

const METRIC_LABELS: Record<FeedbackMetricKey, string> = {
  hydrationL: "Hidratación", sleepHours: "Sueño", proteinG: "Proteína", steps: "Actividad",
  restingHR: "FC en reposo", disponible: "Disponible", savingsRate: "Tasa de ahorro", moodScore: "Ánimo",
};

const DEFAULT_DISMISS_DAYS = 14;
const DISMISSALS_KEY = "metric_dismissals";
const OVERRIDES_KEY = "verified_overrides";

export interface VerifiedTargetRecord { value: number; source: string; setAt: string }

export async function getDismissals(memory: any): Promise<Partial<Record<FeedbackMetricKey, string>>> {
  const v = await memory?.get?.(DISMISSALS_KEY);
  return v && typeof v === "object" ? v : {};
}

export async function getOverrides(memory: any): Promise<Partial<Record<FeedbackMetricKey, VerifiedTargetRecord>>> {
  const v = await memory?.get?.(OVERRIDES_KEY);
  return v && typeof v === "object" ? v : {};
}

export async function dismissMetric(memory: any, metric: FeedbackMetricKey, days: number): Promise<string> {
  const dismissals = await getDismissals(memory);
  const until = new Date(Date.now() + days * 86_400_000).toISOString();
  await memory.set(DISMISSALS_KEY, { ...dismissals, [metric]: until });
  return until;
}

export async function clearDismissal(memory: any, metric: FeedbackMetricKey): Promise<void> {
  const dismissals = await getDismissals(memory);
  delete dismissals[metric];
  await memory.set(DISMISSALS_KEY, dismissals);
}

export async function setVerifiedTarget(memory: any, metric: FeedbackMetricKey, value: number, source: string): Promise<void> {
  const overrides = await getOverrides(memory);
  await memory.set(OVERRIDES_KEY, { ...overrides, [metric]: { value, source, setAt: new Date().toISOString() } });
}

export async function clearOverride(memory: any, metric: FeedbackMetricKey): Promise<void> {
  const overrides = await getOverrides(memory);
  delete overrides[metric];
  await memory.set(OVERRIDES_KEY, overrides);
}

const InsightFeedbackInputSchema = z.object({
  action: z.enum(["dismiss", "set_verified_target", "clear_dismissal", "clear_override", "list"]),
  metric: z.enum(METRIC_KEYS).optional().describe("Requerido para dismiss/set_verified_target/clear_dismissal/clear_override."),
  days: z.number().optional().describe("Días de silencio para 'dismiss'. Default 14."),
  value: z.number().optional().describe("El número real que el usuario reportó. Requerido para set_verified_target."),
  source: z.string().optional().describe("De dónde salió ese número — ej. 'su médico', 'su nutricionista'. Requerido para set_verified_target; nunca lo inventes ni lo dejes vacío."),
});

type InsightFeedbackInput = z.infer<typeof InsightFeedbackInputSchema>;

export class InsightFeedbackTool extends Tool<InsightFeedbackInput> {
  readonly name = "insight_feedback";
  readonly description =
    "Gestiona la retroalimentación del usuario sobre los JUICIOS CALCULADOS de Eris (personal_baseline) — distinto " +
    "de 'manage_user_context', que guarda hechos sobre el usuario sin necesitar evidencia. Acá el usuario puede " +
    "estar equivocado, así que las acciones NUNCA recalculan un número por una simple opinión: " +
    "(1) 'dismiss' — usar cuando el usuario diga algo como 'eso no me sirve', 'no me interesa que me digas eso', o " +
    "'ese consejo no aplica' sobre una métrica específica. Esto SOLO silencia ese tema por un tiempo (14 días por " +
    "defecto) — no cambia ningún cálculo, es reversible, y si el patrón persiste volverá a aparecer después. Es " +
    "seguro usarlo liberalmente porque no toca la aritmética. " +
    "(2) 'set_verified_target' — usar SOLO cuando el usuario cite una fuente real y concreta (ej. 'mi médico me " +
    "indicó 3.5 litros', 'mi nutricionista me dijo 90g de proteína') — NUNCA por una opinión personal sin respaldo " +
    "('yo creo que debería ser diferente' NO califica). El campo 'source' es obligatorio y debe describir esa " +
    "fuente real. Este valor reemplaza la referencia genérica mientras el usuario no tenga suficiente historial " +
    "propio — nunca reemplaza su propio promedio real una vez que exista. " +
    "(3) 'clear_dismissal' / 'clear_override' — si el usuario pide deshacer alguna de las anteriores. " +
    "(4) 'list' — para ver qué hay silenciado o con objetivo verificado actualmente.";
  readonly inputSchema = InsightFeedbackInputSchema;

  async execute(input: InsightFeedbackInput, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    if (!memory) return { output: "", error: "No hay memoria activa en este contexto." };

    try {
      if (input.action === "dismiss") {
        if (!input.metric) return { output: "", error: "Falta 'metric'." };
        const until = await dismissMetric(memory, input.metric, input.days ?? DEFAULT_DISMISS_DAYS);
        return { output: `Listo, no volveré a mencionar ${METRIC_LABELS[input.metric]} hasta el ${new Date(until).toLocaleDateString('es-ES')} (a menos que me lo pidas antes).` };
      }

      if (input.action === "set_verified_target") {
        if (!input.metric || input.value === undefined || !input.source?.trim()) {
          return { output: "", error: "Faltan 'metric', 'value' y/o 'source' (la fuente es obligatoria)." };
        }
        // El número tiene que estar en lo que dijo el usuario: el 2026-10-07 el modelo "verificó" proteína 136 g "según tu
        // médico" cuando el usuario solo había contado su HbA1c (136 era la meta calculada, no algo que dijo su médico)
        const said = String(context?.userMessage ?? "").replace(/(\d)[.](\d{3})\b/g, "$1$2").replace(",", ".");
        const v = String(input.value);
        if (!new RegExp(`(^|[^\\d.])${v.replace(".", "[.,]")}([^\\d]|$)`).test(said.replace(/,/g, "."))) {
          return { output: "", error: `El usuario no dijo ese número (${v}) en este mensaje: NO es un objetivo verificado. No lo registres ni digas que lo hiciste.` };
        }
        await setVerifiedTarget(memory, input.metric, input.value, input.source.trim());
        return { output: `Registrado: tu meta de ${METRIC_LABELS[input.metric]} es ${input.value}, según ${input.source.trim()}. La usaré en vez de una referencia genérica.` };
      }

      if (input.action === "clear_dismissal") {
        if (!input.metric) return { output: "", error: "Falta 'metric'." };
        await clearDismissal(memory, input.metric);
        return { output: `Listo, vuelvo a comentar ${METRIC_LABELS[input.metric]} normalmente.` };
      }

      if (input.action === "clear_override") {
        if (!input.metric) return { output: "", error: "Falta 'metric'." };
        await clearOverride(memory, input.metric);
        return { output: `Listo, quité el objetivo verificado de ${METRIC_LABELS[input.metric]}.` };
      }

      if (input.action === "list") {
        const [dismissals, overrides] = await Promise.all([getDismissals(memory), getOverrides(memory)]);
        const lines: string[] = [];
        for (const [key, until] of Object.entries(dismissals)) {
          if (until && new Date(until).getTime() > Date.now()) {
            lines.push(`- Silenciado: ${METRIC_LABELS[key as FeedbackMetricKey] || key} hasta ${new Date(until).toLocaleDateString('es-ES')}`);
          }
        }
        for (const [key, ov] of Object.entries(overrides)) {
          if (ov) lines.push(`- Objetivo verificado: ${METRIC_LABELS[key as FeedbackMetricKey] || key} = ${ov.value} (fuente: ${ov.source})`);
        }
        return { output: lines.length > 0 ? lines.join("\n") : "No hay nada silenciado ni ningún objetivo verificado ahora mismo." };
      }

      return { output: "", error: "Acción no reconocida." };
    } catch (err) {
      return { output: "", error: `Error en retroalimentación de análisis: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
