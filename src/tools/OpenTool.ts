// ============================================================
// Eris — OpenTool
// Abre archivos, URLs y aplicaciones con el programa predeterminado
// ============================================================

import { z } from "zod";
import { exec } from "child_process";
import * as os from "os";
import { Tool, type ToolExecutionResult, type PreflightResult } from "../Tool.js";
import { checkPath, isExecutableTarget } from "../services/security/PathPolicy.js";

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
  readonly dangerous = true;
  readonly description =
    "Abre un archivo con su programa predeterminado, una URL en el navegador, " +
    "o lanza una aplicación. Usa esto cuando el usuario pida abrir, ver o ejecutar algo.";
  readonly inputSchema = OpenInputSchema;
  readonly requiresConfirmation = true;

  /** ¿Es una URL web? Solo http(s): nada de file:, javascript:, ms-*: ni otros esquemas que lanzan programas. */
  private classify(target: string): { kind: "url" | "path" | "app"; value: string } | { kind: "bad"; reason: string } {
    const t = target.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[a-z]:[\\/]/i.test(t)) {
      // Sin comillas, espacios ni metacaracteres de shell: la URL termina interpolada en un comando
      if (/^https?:\/\/[^\s"'`<>^|\\;]+$/i.test(t) && t.length <= 2000) return { kind: "url", value: t };
      if (/^https?:\/\//i.test(t)) return { kind: "bad", reason: "La URL trae caracteres que no se permiten (comillas, espacios o símbolos de shell)." };
      return { kind: "bad", reason: "Solo se pueden abrir enlaces http(s) o archivos; ese tipo de enlace puede lanzar programas." };
    }
    if (/[\\/]/.test(t) || /^[a-z]:/i.test(t)) return { kind: "path", value: t };
    return { kind: "app", value: t };
  }

  preflight(input: OpenInput): PreflightResult {
    const c = this.classify(input.target);
    if (c.kind === "bad") return { ok: false, reason: c.reason };
    if (/["`$;&|<>\r\n]/.test(c.value) && c.kind !== "url") return { ok: false, reason: "El nombre trae caracteres que no se permiten al abrir." };
    if (c.kind === "path") {
      const chk = checkPath(c.value, "read");
      if (!chk.ok) return { ok: false, reason: chk.reason };
      const exe = isExecutableTarget(chk.resolved);
      return { ok: true, approval: {
        title: exe ? "Ejecutar un programa o script" : "Abrir un archivo",
        detail: chk.resolved,
        risk: exe ? "high" : "normal",
        flags: exe ? ["es un ejecutable o script: abrirlo corre código"] : [],
      } };
    }
    if (c.kind === "url") return { ok: true, approval: { title: "Abrir un enlace en el navegador", detail: c.value, risk: "normal", flags: [] } };
    return { ok: true, approval: { title: "Abrir una aplicación", detail: c.value, risk: isExecutableTarget(c.value) ? "high" : "normal", flags: [] } };
  }

  async execute(input: OpenInput): Promise<ToolExecutionResult> {
    let { target } = input;
    const c = this.classify(target);
    if (c.kind === "bad") return { output: "", error: `Bloqueado: ${c.reason}` };
    if (c.kind === "path") {
      const chk = checkPath(c.value, "read");
      if (!chk.ok) return { output: "", error: `Bloqueado: ${chk.reason}` };
    }
    if (c.kind !== "url" && /["`$;&|<>\r\n]/.test(c.value)) return { output: "", error: "Bloqueado: caracteres no permitidos." };

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
