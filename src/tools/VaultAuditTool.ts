// ============================================================
// Eris — VaultAuditTool
// Auditoría de la bóveda AXS contra las reglas de su CLAUDE.md (ver services/vault/VaultLint.ts).
// El informe exacto lo calcula el código y se anexa a la respuesta; el modelo solo recibe las cifras.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { VaultService } from "../services/vault/VaultService.js";
import { VaultIndex, fold } from "../services/vault/VaultIndex.js";
import { lintVault, formatLint, summarize, issueLabel, type IssueCode } from "../services/vault/VaultLint.js";
import { isPure } from "../services/Intent.js";

const VaultAuditInputSchema = z.object({
  action: z.enum(["full_audit", "link_check"]).default("full_audit").describe("full_audit = todas las reglas de la bóveda; link_check = solo enlaces"),
});

type VaultAuditInput = z.infer<typeof VaultAuditInputSchema>;

const LINK_CODES = new Set<IssueCode>(["broken_link", "ambiguous_link", "short_link", "partial_path", "table_alias", "orphan", "feed_unindexed"]);

export class VaultAuditTool extends Tool<VaultAuditInput> {
  readonly name = "vault_audit";
  readonly description =
    "Audita la bóveda de AXS contra sus reglas (CLAUDE.md): enlaces rotos o sin ruta completa, notas huérfanas o vacías, " +
    "frontmatter (owner/tier/status), nombres, tags, feed sin índice y codificación. Solo lee; no modifica nada.";
  readonly inputSchema = VaultAuditInputSchema;

  /** «audita la bóveda», «¿hay enlaces rotos?», «¿está sana la bóveda?» → se ejecuta por código, sin depender de que el modelo lo elija. */
  async preroute(message: string): Promise<Record<string, unknown> | null> {
    const t = fold(message).replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();
    if (!t || t.length > 120) return null;
    if (/enlaces? rotos?|huerfan\w*/.test(t) && /(boveda|vault|axs|notas|hay|revisa|busca|dame)/.test(t)) return { action: "link_check" };
    if (/\baudit\w*/.test(t) && /(boveda|vault|axs)/.test(t)) return { action: "full_audit" };
    if (/(revisa|chequea|verifica)\w* (la )?(boveda|vault)|salud de (la )?(boveda|vault)|(esta|anda) sana la (boveda|vault)|como esta la (boveda|vault)/.test(t)) return { action: "full_audit" };
    return null;
  }

  async execute(input: VaultAuditInput, context?: any): Promise<ToolExecutionResult> {
    try {
      const idx = await VaultIndex.build(new VaultService().getVaultPath());
      let issues = lintVault(idx);
      if (input.action === "link_check") issues = issues.filter((i) => LINK_CODES.has(i.code));
      const s = summarize(issues);
      const kinds = [...new Set(issues.filter((i) => i.severity !== "info").map((i) => issueLabel(i.code)))];

      return {
        output:
          `HECHOS CALCULADOS: ${idx.notes.size} notas revisadas. Estado ${s.light}: ${s.errors} error(es), ${s.warns} aviso(s), ${s.infos} deuda(s) conocida(s) ya documentadas.` +
          (kinds.length ? ` Tipos: ${kinds.join(", ")}.` : " Sin hallazgos.") +
          `\n\n[Cómo presentarlo: el informe exacto con rutas se mostrará AUTOMÁTICAMENTE debajo de tu mensaje: NO lo repitas. ` +
          `Di en 1-2 frases si la bóveda está sana y qué es lo primero que arreglarías. Si algo se puede reparar, ofrece hacerlo.]`,
        metadata: {
          brokenCount: s.byCode.broken_link ?? 0,
          appendToReply: { text: `# 🔬 Auditoría de la bóveda AXS\n\n${formatLint(issues, { perCode: 5 })}`, marker: "# 🔬 Auditoría" },
          quickReply: isPure(context?.userMessage, ["axs"])
            ? `La bóveda está ${s.light}: ${s.errors} error(es) y ${s.warns} aviso(s)${kinds.length ? `. Lo primero que arreglaría: ${kinds[0].toLowerCase()}` : ". Todo en orden"}. Abajo está el informe exacto con las rutas.`
            : undefined,
        },
      };
    } catch (err) {
      return { output: "", error: `Error en auditoría: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
