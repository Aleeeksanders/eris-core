// ============================================================
// Eris — KnowledgeTool
// Búsqueda profunda en el cerebro de Alex (Obsidian AXS)
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execAsync = promisify(exec);

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

  private readonly AXS_PATH = "c:\\Proyectos\\AXS";
  private readonly ERIS_PATH = "c:\\Proyectos\\eris";

  async execute(input: KnowledgeInput): Promise<ToolExecutionResult> {
    const { query, scope } = input;
    
    const searchPaths: string[] = [];
    if (scope === "notes" || scope === "all") searchPaths.push(this.AXS_PATH);
    if (scope === "code" || scope === "all") searchPaths.push(this.ERIS_PATH);

    try {
      let results = "";
      
      for (const searchPath of searchPaths) {
        // Usar ripgrep (rg) si está instalado, si no, buscar archivos recursivamente
        // Intentamos un comando simple de búsqueda de texto
        try {
          // Buscamos archivos .md o .ts que contengan la palabra
          const command = `grep -rEi "${query}" "${searchPath}" --include="*.md" --include="*.ts" --include="*.tsx" | head -n 15`;
          const { stdout } = await execAsync(command);
          
          if (stdout) {
            results += `\n--- Resultados en ${path.basename(searchPath)} ---\n${stdout}`;
          }
        } catch (e) {
          // Si grep falla (ej. no hay matches), intentamos listar archivos
          const commandList = `dir /s /b "${searchPath}" | findstr /i "${query}" | head -n 10`;
          try {
            const { stdout } = await execAsync(commandList);
            if (stdout) {
              results += `\n--- Archivos encontrados en ${path.basename(searchPath)} ---\n${stdout}`;
            }
          } catch(e2) {
             // Silencioso si no hay nada
          }
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
