// ============================================================
// Eris — FileWriteTool
// Escritura de archivos del sistema
// ============================================================

import { z } from "zod";
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import * as os from "os";
import { Tool, type ToolExecutionResult, type PreflightResult } from "../Tool.js";
import { checkPath } from "../services/security/PathPolicy.js";
import { existsSync, statSync } from "fs";

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
  readonly dangerous = true;
  readonly description =
    "Escribe contenido en un archivo. Crea el archivo si no existe. " +
    "CUIDADO: Sobrescribe el contenido existente. " +
    "Usa las rutas del contexto del sistema para Escritorio y Documentos.";
  readonly inputSchema = FileWriteInputSchema as any;
  readonly requiresConfirmation = true;

  /** Placeholders (<usuario>) y redirección Desktop/Documents → OneDrive cuando está activo. */
  private normalize(rawPath: string): string {
    let path = rawPath;
    const username = os.userInfo().username;
    const homeDir = os.homedir();
    path = path
      .replace(/<nombre_usuario>/gi, username)
      .replace(/<usuario>/gi, username)
      .replace(/<user>/gi, username);

    const oldDesktop = homeDir + "\\Desktop";
    const oneDriveDesktop = homeDir + "\\OneDrive\\Desktop";
    const oldDocs = homeDir + "\\Documents";
    const oneDriveDocs = homeDir + "\\OneDrive\\Documents";

    // Solo redirigir si la carpeta OneDrive existe
    if (path.startsWith(oldDesktop) && !path.includes("OneDrive") && existsSync(oneDriveDesktop)) {
      path = path.replace(oldDesktop, oneDriveDesktop);
    }
    if (path.startsWith(oldDocs) && !path.includes("OneDrive") && existsSync(oneDriveDocs)) {
      path = path.replace(oldDocs, oneDriveDocs);
    }
    return path;
  }

  preflight(input: FileWriteInput): PreflightResult {
    const path = this.normalize(input.path);
    const chk = checkPath(path, "write");
    if (!chk.ok) return { ok: false, reason: chk.reason };

    let existing = "";
    try {
      if (existsSync(chk.resolved)) existing = `\n⚠ SOBRESCRIBE un archivo que ya existe (${statSync(chk.resolved).size} bytes).`;
    } catch {}
    const preview = input.content.length > 500 ? input.content.slice(0, 500) + `\n… (+${input.content.length - 500} caracteres)` : input.content;
    return {
      ok: true,
      approval: {
        title: existing ? "Sobrescribir un archivo" : "Crear un archivo",
        detail: `${chk.resolved}\n${input.content.length} caracteres${existing}\n\n${preview}`,
        risk: existing ? "high" : "normal",
        flags: existing ? ["sobrescribe un archivo existente"] : [],
      },
    };
  }

  async execute(input: FileWriteInput): Promise<ToolExecutionResult> {
    let { path, content } = input;
    const createDirs = input.createDirs ?? true;

    try {
      path = this.normalize(path);
      // Última línea de defensa: misma política que en la revisión previa
      const chk = checkPath(path, "write");
      if (!chk.ok) return { output: "", error: `Bloqueado: ${chk.reason}` };
      path = chk.resolved;

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
