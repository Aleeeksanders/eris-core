// ============================================================
// Eris — KnowledgeTool
// Búsqueda en el cerebro de Alex (Obsidian AXS) y en el código de Eris.
// Las notas se buscan con ranking (services/vault/VaultSearch.ts): las MEJORES notas, no las primeras líneas sueltas.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { VaultService } from "../services/vault/VaultService.js";
import { VaultIndex, fold } from "../services/vault/VaultIndex.js";
import { searchVault, tokenize } from "../services/vault/VaultSearch.js";

const KnowledgeInputSchema = z.object({
  query: z.string().describe("Lo que se busca, con las palabras clave (p. ej. «cifrado de perfiles», «Hunter Wallet presupuesto»)"),
  scope: z.enum(["notes", "code", "all"]).default("notes").describe("notes = notas de AXS (por defecto); code = código de Eris; all = ambos"),
});

type KnowledgeInput = z.infer<typeof KnowledgeInputSchema>;

export class KnowledgeTool extends Tool<KnowledgeInput> {
  readonly name = "knowledge_search";
  readonly untrustedOutput = true;
  readonly description =
    "Busca en las notas de AXS (Obsidian) y, si se pide, en el código de Eris. Devuelve las notas más relevantes con la línea que mejor responde. " +
    "Úsala para teoría, arquitectura, decisiones o cualquier «¿qué dice AXS sobre…?».";
  readonly inputSchema = KnowledgeInputSchema;

  /** «¿qué dice AXS sobre X?», «busca en mis notas X»: la búsqueda se hace por código (solo con mención explícita de AXS/notas/bóveda). */
  async preroute(message: string): Promise<Record<string, unknown> | null> {
    const t = fold(message).replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();
    if (!t || t.length > 160) return null;
    const m = t.match(/^(?:que dice|que dicen|que sabes|que tengo|que hay|que documentamos|busca|buscame|encuentra|encuentrame)\s+(?:algo\s+|informacion\s+)?(?:en|de|sobre|acerca de)?\s*(?:axs|mis notas|las notas|la boveda|el vault|obsidian)\s*(?:sobre|de|del|acerca de|respecto a|de la|de los)?\s*(.{3,100})$/);
    if (m && tokenize(m[1]).length) return { query: m[1].trim(), scope: "notes" };
    return null;
  }

  private vaultService = new VaultService();
  private erisVaultService = new VaultService("c:\\Proyectos\\eris");

  async execute(input: KnowledgeInput): Promise<ToolExecutionResult> {
    const { query, scope } = input;
    try {
      let results = "";
      let notesFound = 0;

      if (scope === "notes" || scope === "all") {
        const idx = await VaultIndex.build(this.vaultService.getVaultPath());
        const hits = searchVault(idx, query, 6);
        notesFound = hits.length;
        if (hits.length) {
          results += `--- Notas de AXS (por relevancia) ---\n` + hits.map((h, i) => {
            const fm = h.note.frontmatter;
            const meta = [fm?.tier, fm?.status].filter(Boolean).join("/");
            return `${i + 1}. ${idx.wikilink(h.note.path)}${meta ? ` (${meta})` : ""}\n   línea ${h.line}: ${h.snippet}`;
          }).join("\n") + "\n";
        }
      }

      if (scope === "code" || scope === "all") {
        const erisResults = await this.erisVaultService.searchInVault(query, 15);
        if (erisResults.length > 0) results += `\n--- Código de Eris ---\n${erisResults.join("\n")}\n`;
      }

      return {
        output: results.trim()
          ? `Esto encontré sobre "${query}":\n${results}\nPara leer una nota completa usa 'file_read' con la ruta ABSOLUTA: ${this.vaultService.getVaultPath()}\\<ruta de la nota>.`
          : `No encontré nada sobre "${query}" en las notas${scope === "notes" ? "" : " ni en el código"}. ¿Quizás está con otras palabras?`,
        metadata: { query, scope, notesFound },
      };
    } catch (err) {
      return { output: "", error: `Error buscando conocimiento: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
