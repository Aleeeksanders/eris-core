// ============================================================
// Eris — KnowledgeTool
// Búsqueda profunda en el cerebro de Alex (Obsidian AXS)
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import path from "node:path";
import { VaultService } from "../services/vault/VaultService.js";

const KnowledgeInputSchema = z.object({
  query: z.string().describe("El término o concepto a buscar en las notas de AXS"),
  scope: z.enum(["notes", "code", "all"]).default("all").describe("Ámbito de búsqueda (notas, código o todo)"),
});

type KnowledgeInput = z.infer<typeof KnowledgeInputSchema>;

export class KnowledgeTool extends Tool<KnowledgeInput> {
  readonly name = "knowledge_search";
  readonly description =
    "Busca en la base de conocimientos de AXS (Obsidian) y en el código fuente del proyecto. " +
    "Úsala para entender las teorías de Alex, la arquitectura del sistema o buscar fragmentos de código específicos.";
  readonly inputSchema = KnowledgeInputSchema;

  private vaultService: VaultService;
  private erisVaultService: VaultService;

  constructor() {
    super();
    this.vaultService = new VaultService();
    this.erisVaultService = new VaultService("c:\\Proyectos\\eris");
  }

  async execute(input: KnowledgeInput): Promise<ToolExecutionResult> {
    const { query, scope } = input;
    
    try {
      let results = "";
      
      if (scope === "notes" || scope === "all") {
        const axsResults = await this.vaultService.searchInVault(query, 15);
        if (axsResults.length > 0) {
          results += `\n--- Resultados en AXS ---\n${axsResults.join("\n")}\n`;
        }
      }

      if (scope === "code" || scope === "all") {
        const erisResults = await this.erisVaultService.searchInVault(query, 15);
        if (erisResults.length > 0) {
          results += `\n--- Resultados en Eris ---\n${erisResults.join("\n")}\n`;
        }
      }

      const finalOutput = results.trim() 
        ? `He encontrado lo siguiente sobre "${query}":\n${results}\n\nUsa 'file_read' si necesitas ver el contenido completo de un archivo específico.`
        : `No encontré menciones directas de "${query}" en las notas o el código. ¿Quizás está bajo otro nombre?`;

      return {
        output: finalOutput,
        metadata: { query, scope }
      };
    } catch (err) {
      return {
        output: "",
        error: `Error buscando conocimiento: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
}
