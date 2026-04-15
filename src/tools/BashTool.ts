// ============================================================
// Eris — BashTool
// Ejecuta comandos del sistema operativo
// ============================================================

import { z } from "zod";
import { spawn } from "child_process";
import { Tool, type ToolExecutionResult } from "../Tool.js";

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
  readonly description =
    "Ejecuta un comando en la terminal del sistema operativo (PowerShell en Windows). " +
    "Úsalo para ejecutar programas, scripts, ver contenido de carpetas, gestionar procesos, etc.";
  readonly inputSchema = BashInputSchema;
  readonly requiresConfirmation = true;

  async execute(input: BashInput): Promise<ToolExecutionResult> {
    const { command, cwd, timeout = 30000 } = input;

    return new Promise((resolve) => {
      const proc = spawn("powershell", ["-NoProfile", "-Command", command], {
        cwd: cwd || process.cwd(),
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
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
