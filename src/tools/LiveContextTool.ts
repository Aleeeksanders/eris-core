import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { buildLiveContextText } from "../services/LiveContext.js";

const LiveContextInputSchema = z.object({
  scope: z.enum(["health", "medical", "financial", "personal", "all"]).optional()
    .describe("Qué categoría de datos reales del usuario traer: 'health' (sueño, pasos, FC, nutrición, hidratación), " +
      "'medical' (condiciones, medicamentos, umbrales), 'financial' (contexto de Finanzas), 'personal' " +
      "(notas que el usuario ha compartido). 'all' (default) trae todo — úsalo si no está claro cuál aplica."),
});

type LiveContextInput = z.infer<typeof LiveContextInputSchema>;

export class LiveContextTool extends Tool<LiveContextInput> {
  readonly name = "get_live_context";
  readonly description =
    "Trae datos REALES y actuales del usuario — salud, historial médico, notas personales que ha compartido, y " +
    "contexto financiero. Esta es tu ventaja sobre un LLM genérico: tienes acceso directo a la vida real del " +
    "usuario. PERO estos datos NO se inyectan solos en cada mensaje — vos decidís cuándo pedirlos, igual que " +
    "cualquier buen conversador decide cuándo sacar un tema. NO llames esta herramienta para saludos, small talk, " +
    "o mensajes sin relación con salud/finanzas/vida personal — responde esos de forma natural y breve, sin forzar " +
    "un análisis. SÍ llámala — SIEMPRE, sin excepción — apenas el usuario pregunte algo que dependa de estos datos: " +
    "'cuánta agua he tomado', 'cómo estuvo mi sueño', 'cuántos pasos llevo', 'cuál es mi FC', 'qué métricas tengo " +
    "hoy', 'cómo van mis finanzas', o cualquier variante. Esta es tu herramienta POR DEFECTO para '¿cómo voy hoy?' " +
    "en general (para comparar contra tu propio promedio histórico en vez del valor de hoy, usa 'personal_baseline'; " +
    "para glucosa específicamente, usa 'gluco_tracker'). NUNCA respondas 'no tengo registro' o 'no tengo acceso' a " +
    "una pregunta de este tipo sin haber llamado esta herramienta primero — si después de llamarla el dato " +
    "realmente no está, ahí sí dilo, pero nunca lo asumas sin verificar.";
  readonly inputSchema = LiveContextInputSchema;

  async execute(input: LiveContextInput, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    if (!memory) return { output: "", error: "No hay memoria activa en este contexto." };
    try {
      const text = await buildLiveContextText(memory, input.scope ?? "all");
      return { output: text };
    } catch (err) {
      return { output: "", error: `Error obteniendo contexto en vivo: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
