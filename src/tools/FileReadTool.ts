// ============================================================
// Eris — FileReadTool
// Lectura de archivos del sistema
// ============================================================

import { z } from "zod";
import { readFile, stat } from "fs/promises";
import { Tool, type ToolExecutionResult, type PreflightResult } from "../Tool.js";
import { checkPath } from "../services/security/PathPolicy.js";

const MAX_READ_BYTES = 2 * 1024 * 1024;

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
  readonly untrustedOutput = true;
  readonly description =
    "Lee el contenido de un archivo del sistema. Soporta rangos de líneas opcionales.";
  readonly inputSchema = FileReadInputSchema;

  preflight(input: FileReadInput): PreflightResult {
    const chk = checkPath(input.path, "read");
    return chk.ok ? { ok: true } : { ok: false, reason: chk.reason };
  }

  async execute(input: FileReadInput): Promise<ToolExecutionResult> {
    const { startLine, endLine } = input;

    try {
      // Política de rutas: nada de llaves, cuentas, sesiones, .env ni datos de navegadores
      const chk = checkPath(input.path, "read");
      if (!chk.ok) return { output: "", error: `Bloqueado: ${chk.reason}` };
      const path = chk.resolved;

      // Verificar que el archivo existe
      const fileStat = await stat(path);
      if (!fileStat.isFile()) {
        return { output: "", error: `"${path}" no es un archivo` };
      }
      const ranged = startLine !== undefined || endLine !== undefined;
      if (fileStat.size > (ranged ? MAX_READ_BYTES * 25 : MAX_READ_BYTES)) {
        return {
          output: "",
          error: ranged
            ? `El archivo pesa ${(fileStat.size / 1048576).toFixed(0)} MB: demasiado grande incluso por rangos.`
            : `El archivo pesa ${(fileStat.size / 1048576).toFixed(1)} MB; para leerlo de una vez el máximo es 2 MB (pide un rango de líneas con startLine/endLine).`,
        };
      }

      const content = await readFile(path, "utf-8");

      if (startLine !== undefined || endLine !== undefined) {
        const lines = content.split("\n");
        const start = (startLine ?? 1) - 1;
        const end = endLine ?? lines.length;
        const selected = lines.slice(start, end);
        const rangeText = selected.map((line, i) => `${start + i + 1}: ${line}`).join("\n");

        return {
          output: rangeText.length > 12000
            ? `${rangeText.slice(0, 12000)}\n\n[… recortado: pide un rango más corto para ver el resto.]`
            : rangeText,
          metadata: {
            totalLines: lines.length,
            shownLines: selected.length,
          },
        };
      }

      // El resultado entra al contexto del modelo: se recorta a lo que cabe (~3 500 tokens) y se avisa cómo pedir el resto
      const MAX_CHARS = 12000;
      return {
        output: content.length > MAX_CHARS
          ? `${content.slice(0, MAX_CHARS)}\n\n[… recortado: el archivo tiene ${content.length} caracteres. Pide un rango con startLine/endLine para ver el resto.]`
          : content,
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
