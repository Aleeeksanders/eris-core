// ============================================================
// Eris — BashTool
// Ejecuta comandos del sistema operativo
// ============================================================

import { z } from "zod";
import { spawn } from "child_process";
import { Tool, type ToolExecutionResult, type PreflightResult } from "../Tool.js";
import { checkCommand, cleanEnv } from "../services/security/PathPolicy.js";

const BashInputSchema = z.object({
  command: z
    .string()
    .describe("El comando a ejecutar en la terminal del sistema"),
  cwd: z
    .string()
    .optional()
    .describe("Directorio de trabajo para el comando (opcional)"),
  timeout: z
    .number()
    .optional()
    .describe("Timeout en milisegundos (default: 30000)"),
});

type BashInput = z.infer<typeof BashInputSchema>;

export class BashTool extends Tool<BashInput> {
  readonly name = "bash";
  readonly dangerous = true;
  readonly description =
    "Ejecuta un comando en la terminal del sistema operativo (PowerShell en Windows). " +
    "Úsalo para ejecutar programas, scripts, ver contenido de carpetas, gestionar procesos, etc.";
  readonly inputSchema = BashInputSchema;
  readonly requiresConfirmation = true;

  preflight(input: BashInput): PreflightResult {
    const chk = checkCommand(input.command, input.cwd);
    if (!chk.ok) return { ok: false, reason: chk.reason || "Comando no permitido." };
    return {
      ok: true,
      approval: {
        title: "Ejecutar un comando en tu PC",
        detail: input.command + (input.cwd ? `\n\n(en la carpeta ${input.cwd})` : ""),
        risk: chk.risk,
        flags: chk.flags,
      },
    };
  }

  async execute(input: BashInput): Promise<ToolExecutionResult> {
    const { command, cwd } = input;
    // Última línea de defensa (si alguien llama a run() sin pasar por el motor): misma política.
    const chk = checkCommand(command, cwd);
    if (!chk.ok) return { output: "", error: `Bloqueado: ${chk.reason}` };
    const timeout = Math.min(Math.max(input.timeout ?? 30000, 1000), 120000);

    return new Promise((resolve) => {
      const proc = spawn("powershell", ["-NoProfile", "-Command", command], {
        cwd: cwd || process.cwd(),
        // Sin el PIN de administración, llaves ni tokens del entorno del servidor
        env: cleanEnv(process.env),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      // Tope de salida: un comando que escupe megas no debe inundar el contexto del modelo
      const CAP = 8000; // ~2 500 tokens: cabe en la ventana de Ikaros junto a su prompt
      proc.stdout.on("data", (data) => {
        if (stdout.length < CAP) stdout += data.toString().slice(0, CAP - stdout.length);
      });

      proc.stderr.on("data", (data) => {
        if (stderr.length < CAP) stderr += data.toString().slice(0, CAP - stderr.length);
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        resolve({
          output: stdout,
          error: `Comando cancelado: timeout de ${timeout}ms excedido`,
        });
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && stderr) {
          resolve({
            output: stdout,
            error: `Exit code ${code}: ${stderr}`,
          });
        } else {
          resolve({
            output: stdout || "(sin output)",
            metadata: { exitCode: code },
          });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          output: "",
          error: `Error al ejecutar comando: ${err.message}`,
        });
      });
    });
  }
}
