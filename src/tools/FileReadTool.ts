// ============================================================
// Eris — FileReadTool
// Lectura de archivos del sistema
// ============================================================

import { z } from "zod";
import { readFile, stat } from "fs/promises";
import { Tool, type ToolExecutionResult } from "../Tool.js";

const FileReadInputSchema = z.object({
  path: z.string().describe("Ruta absoluta del archivo a leer"),
  startLine: z
    .number()
    .optional()
    .describe("Línea inicial (1-indexed, opcional)"),
  endLine: z
    .number()
    .optional()
    .describe("Línea final (1-indexed, inclusive, opcional)"),
});

type FileReadInput = z.infer<typeof FileReadInputSchema>;

export class FileReadTool extends Tool<FileReadInput> {
  readonly name = "file_read";
  readonly description =
    "Lee el contenido de un archivo del sistema. Soporta rangos de líneas opcionales.";
  readonly inputSchema = FileReadInputSchema;

  async execute(input: FileReadInput): Promise<ToolExecutionResult> {
    const { path, startLine, endLine } = input;

    try {
      // Verificar que el archivo existe
      const fileStat = await stat(path);
      if (!fileStat.isFile()) {
        return { output: "", error: `"${path}" no es un archivo` };
      }

      const content = await readFile(path, "utf-8");

      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split("\n");
        const start = (startLine ?? 1) - 1;
        const end = endLine ?? lines.length;
        const selected = lines.slice(start, end);

        return {
          output: selected
            .map((line, i) => `${start + i + 1}: ${line}`)
            .join("\n"),
          metadata: {
            totalLines: lines.length,
            shownLines: selected.length,
          },
        };
      }

      return {
        output: content,
        metadata: { size: fileStat.size },
      };
    } catch (err) {
      return {
        output: "",
        error: `Error leyendo archivo: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
