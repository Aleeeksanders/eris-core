// ============================================================
// Eris — FileWriteTool
// Escritura de archivos del sistema
// ============================================================

import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import * as os from "os";
import { Tool, type ToolExecutionResult } from "../Tool.js";

// Preprocess para manejar strings "true"/"false" que los LLMs mandan como booleans
const coerceBoolean = z.preprocess((val) => {
  if (typeof val === "string") {
    if (val.toLowerCase() === "true") return true;
    if (val.toLowerCase() === "false") return false;
  }
  return val;
}, z.boolean().optional());

const FileWriteInputSchema = z.object({
  path: z.string().describe(
    "Ruta absoluta del archivo a escribir"
  ),
  content: z.string().describe("Contenido a escribir en el archivo"),
  createDirs: coerceBoolean.describe(
    "Crear directorios padre si no existen (default: true)"
  ),
});

type FileWriteInput = z.infer<typeof FileWriteInputSchema>;

export class FileWriteTool extends Tool<FileWriteInput> {
  readonly name = "file_write";
  readonly description =
    "Escribe contenido en un archivo. Crea el archivo si no existe. " +
    "CUIDADO: Sobrescribe el contenido existente. " +
    "Usa las rutas del contexto del sistema para Escritorio y Documentos.";
  readonly inputSchema = FileWriteInputSchema as any;
  readonly requiresConfirmation = true;

  async execute(input: FileWriteInput): Promise<ToolExecutionResult> {
    let { path, content } = input;
    const createDirs = input.createDirs ?? true;

    try {
      // Resolver <nombre_usuario> o <usuario> placeholders
      const username = os.userInfo().username;
      const homeDir = os.homedir();
      path = path
        .replace(/<nombre_usuario>/gi, username)
        .replace(/<usuario>/gi, username)
        .replace(/<user>/gi, username);

      // Auto-corregir rutas Desktop/Documents si OneDrive está activo
      const oldDesktop = homeDir + "\\Desktop";
      const oneDriveDesktop = homeDir + "\\OneDrive\\Desktop";
      const oldDocs = homeDir + "\\Documents";
      const oneDriveDocs = homeDir + "\\OneDrive\\Documents";

      // Solo redirigir si la carpeta OneDrive existe
      const { existsSync } = await import("fs");
      if (path.startsWith(oldDesktop) && !path.includes("OneDrive") && existsSync(oneDriveDesktop)) {
        path = path.replace(oldDesktop, oneDriveDesktop);
      }
      if (path.startsWith(oldDocs) && !path.includes("OneDrive") && existsSync(oneDriveDocs)) {
        path = path.replace(oldDocs, oneDriveDocs);
      }

      // Crear directorios padre (ignorar EEXIST para OneDrive junctions)
      if (createDirs) {
        try {
          await mkdir(dirname(path), { recursive: true });
        } catch (mkdirErr: any) {
          // Ignorar si el directorio ya existe (común con OneDrive)
          if (mkdirErr?.code !== "EEXIST") {
            throw mkdirErr;
          }
        }
      }

      await writeFile(path, content, "utf-8");

      return {
        output: `Archivo escrito exitosamente: ${path} (${content.length} bytes)`,
        metadata: { path, bytesWritten: content.length },
      };
    } catch (err) {
      return {
        output: "",
        error: `Error escribiendo archivo: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
