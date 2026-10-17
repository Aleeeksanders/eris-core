// ============================================================
// Eris — AxsBriefingTool
//
// "¿Cómo va AXS?": el estado de la bóveda calculado en código (salud según CLAUDE.md, pendientes, actividad, logs,
// inbox, ficha de un proyecto). El modelo NO lee las notas: recibe solo hechos ya calculados (cifras y estados) y
// comenta lo más importante; el informe completo, con enlaces y textos, se anexa debajo de su respuesta.
// Así no puede inventar cifras y el contenido de una nota nunca actúa como instrucción.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { VaultService } from "../services/vault/VaultService.js";
import { VaultIndex, fold } from "../services/vault/VaultIndex.js";
import { buildBriefing, buildPending, buildProject } from "../services/vault/VaultBriefing.js";
import { isPure } from "../services/Intent.js";

const Schema = z.object({
  focus: z.enum(["general", "pendientes", "proyecto"]).default("general")
    .describe("general = estado de AXS (salud, movimiento, pendientes, logs); pendientes = todas las tareas abiertas; proyecto = ficha de una nota/proyecto"),
  project: z.string().optional().describe("Solo con focus=proyecto: nombre de la nota o proyecto (p. ej. Lander, Toji, Hunter Wallet, TSN)"),
});
type Input = z.infer<typeof Schema>;

export class AxsBriefingTool extends Tool<Input> {
  readonly name = "axs_briefing";
  readonly description =
    "Estado de AXS calculado desde la bóveda: briefing general, pendientes o ficha de un proyecto. " +
    "Úsala ante «cómo va AXS», «briefing», «resumen», «qué tengo pendiente», «en qué está Lander». Devuelve el informe exacto; no lo reescribas.";
  readonly inputSchema = Schema;

  /**
   * Un modelo de 4B a veces contesta «¿en qué está Lander?» de memoria (y se equivoca) en vez de consultar. Cuando el pedido
   * es inequívoco, el código llama a la herramienta. Lo de proyecto solo se dispara si la nota EXISTE en la bóveda
   * («¿cómo va mi glucosa?» no la toca).
   */
  async preroute(message: string): Promise<Record<string, unknown> | null> {
    const t = fold(message).replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();
    if (!t || t.length > 120) return null;
    if (/\bbriefing\b|como (va|vamos|estamos) (en )?(axs|la boveda|el vault)|como esta axs|estado de axs|resumen de axs|informe de axs/.test(t)) return { focus: "general" };
    if (/(que|cuales|cuantos?|cuantas?) (pendientes?|tareas|cosas) (tengo|hay|me quedan|tenemos|quedan)|(que|cuales) (tengo|hay|me queda|tenemos) (pendiente|por hacer)|\b(mis|los|dame los|lista de) pendientes\b|\bbacklog\b/.test(t)) return { focus: "pendientes" };
    const m = t.match(/(?:en que esta|como va|como esta|como anda|estado de|estado del|ficha de|ficha del|que hay de|que sabes de|dime de|dime sobre|cuentame de|cuentame sobre)\s+(?:el |la |los |las |mi )?(?:proyecto |modulo |nota )?(.{2,40})$/);
    if (m) {
      const name = m[1].trim();
      const idx = await VaultIndex.build(new VaultService().getVaultPath());
      const hit = idx.find(name, 1)[0];
      const hn = hit && fold(hit.name);
      if (hit && (hn === name || hn!.startsWith(name) || name.startsWith(hn!))) return { focus: "proyecto", project: hit.name };
    }
    return null;
  }

  async execute(input: Input, context?: any): Promise<ToolExecutionResult> {
    try {
      const idx = await VaultIndex.build(new VaultService().getVaultPath());
      let text: string, facts: string[], marker: string, tip: string, quick: string;

      if (input.focus === "pendientes") {
        const r = buildPending(idx);
        text = r.text; facts = r.facts; quick = r.quick; marker = "# 📋 Pendientes de AXS"; // solo existe en el bloque anexo, nunca en la frase del modelo
        tip = "Di cuántos hay y cuáles son los inmediatos de MEMORY.md; deja el detalle al informe.";
      } else if (input.focus === "proyecto") {
        if (!input.project?.trim()) return { output: "", error: "Falta el nombre del proyecto o nota (parámetro project)." };
        const r = buildProject(idx, input.project.trim());
        if (!r.found) return { output: r.text };
        text = r.text; facts = r.facts; quick = r.quick; marker = "# 📁 ";
        tip = "Resume en 2 frases en qué estado está y qué le falta (tareas abiertas, conexiones, salud).";
      } else {
        const r = buildBriefing(idx);
        text = r.text; facts = r.facts; quick = r.quick; marker = "# 🧭 Briefing AXS";
        tip = "Empieza por lo que «merece atención», luego cómo va el resto en una frase.";
      }

      return {
        output:
          `HECHOS CALCULADOS (no inventes nada fuera de esto):\n${facts.map((f) => `- ${f}`).join("\n")}\n\n` +
          `[Cómo presentarlo: el informe completo (con enlaces y detalle) se mostrará AUTOMÁTICAMENTE debajo de tu mensaje: NO lo repitas ni des listas. ` +
          `Escribe 2-3 frases ejecutivas. ${tip} Cierra ofreciendo profundizar.]`,
        // Respuesta al instante solo si el mensaje pide ESTO (si mezcla, p. ej., AXS y salud, sigue el camino de siempre)
        metadata: { appendToReply: { text, marker }, quickReply: isPure(context?.userMessage, ["axs"]) ? quick : undefined },
      };
    } catch (err) {
      return { output: "", error: `Error en axs_briefing: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
