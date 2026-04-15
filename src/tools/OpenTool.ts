// ============================================================
// Eris — OpenTool
// Abre archivos, URLs y aplicaciones con el programa predeterminado
// ============================================================

import { z } from "zod";
import { exec } from "child_process";
import * as os from "os";
import { Tool, type ToolExecutionResult } from "../Tool.js";

const OpenInputSchema = z.object({
  target: z
    .string()
    .describe(
      "Ruta del archivo, URL o nombre de aplicación a abrir"
    ),
});

type OpenInput = z.infer<typeof OpenInputSchema>;

export class OpenTool extends Tool<OpenInput> {
  readonly name = "open";
  readonly description =
    "Abre un archivo con su programa predeterminado, una URL en el navegador, " +
    "o lanza una aplicación. Usa esto cuando el usuario pida abrir, ver o ejecutar algo.";
  readonly inputSchema = OpenInputSchema;

  async execute(input: OpenInput): Promise<ToolExecutionResult> {
    let { target } = input;

    // Auto-corregir rutas Desktop/Documents si OneDrive está activo
    const homeDir = os.homedir();
    const oldDesktop = homeDir + "\\Desktop";
    const oneDriveDesktop = homeDir + "\\OneDrive\\Desktop";
    const oldDocs = homeDir + "\\Documents";
    const oneDriveDocs = homeDir + "\\OneDrive\\Documents";

    const { existsSync } = await import("fs");

    if (target.includes(oldDesktop) && !target.includes("OneDrive") && existsSync(oneDriveDesktop)) {
      target = target.replace(oldDesktop, oneDriveDesktop);
    }
    if (target.includes(oldDocs) && !target.includes("OneDrive") && existsSync(oneDriveDocs)) {
      target = target.replace(oldDocs, oneDriveDocs);
    }

    return new Promise((resolve) => {
      // En Windows usamos Invoke-Item que maneja mejor las rutas con espacios
      const command = `Invoke-Item -LiteralPath "${target.replace(/"/g, '`"')}"`;

      exec(
        command,
        { shell: "powershell.exe", timeout: 10000 },
        (error) => {
          if (error) {
            // Intentar con 'start' como fallback (para URLs y apps)
            const fallback = `start "" "${target.replace(/"/g, '\\"')}"`;
            exec(fallback, { shell: "cmd.exe", timeout: 10000 }, (err2) => {
              if (err2) {
                resolve({
                  output: "",
                  error: `No se pudo abrir "${target}": ${err2.message}`,
                });
              } else {
                resolve({ output: `Abierto: ${target}` });
              }
            });
          } else {
            resolve({ output: `Abierto: ${target}` });
          }
        }
      );
    });
  }
}
