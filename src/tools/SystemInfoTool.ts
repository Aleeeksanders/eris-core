// ============================================================
// Eris — SystemInfoTool
// Información del sistema operativo
// ============================================================

import { z } from "zod";
import * as os from "os";
import { Tool, type ToolExecutionResult } from "../Tool.js";

const SystemInfoInputSchema = z.object({
  query: z
    .string()
    .describe(
      "Qué información del sistema consultar. Valores válidos: all, cpu, memory, disk, network, os, processes, time"
    ),
});

type SystemInfoInput = z.infer<typeof SystemInfoInputSchema>;

export class SystemInfoTool extends Tool<SystemInfoInput> {
  readonly name = "system_info";
  readonly description =
    "Obtiene información del sistema operativo: CPU, memoria RAM, disco, red, " +
    "sistema operativo, fecha/hora actual y procesos en ejecución. " +
    'Usa query "all" para toda la info, o valores específicos como "cpu", "memory", "os", "time".';
  readonly inputSchema = SystemInfoInputSchema;

  async execute(input: SystemInfoInput): Promise<ToolExecutionResult> {
    const query = input.query.toLowerCase().trim();

    try {
      const sections: Record<string, () => string> = {
        os: () => this.getOSInfo(),
        cpu: () => this.getCPUInfo(),
        memory: () => this.getMemoryInfo(),
        ram: () => this.getMemoryInfo(),
        network: () => this.getNetworkInfo(),
        net: () => this.getNetworkInfo(),
        disk: () => "Usa el comando: Get-PSDrive -PSProvider FileSystem",
        storage: () => "Usa el comando: Get-PSDrive -PSProvider FileSystem",
        processes: () =>
          "Usa el comando: Get-Process | Sort-Object CPU -Descending | Select-Object -First 20",
        time: () => this.getTimeInfo(),
        datetime: () => this.getTimeInfo(),
        date: () => this.getTimeInfo(),
        hora: () => this.getTimeInfo(),
        fecha: () => this.getTimeInfo(),
      };

      if (query === "all") {
        const uniqueSections = ["os", "cpu", "memory", "network", "disk", "time"];
        const output = uniqueSections
          .map((key) => `## ${key.toUpperCase()}\n${sections[key]!()}`)
          .join("\n\n");
        return { output };
      }

      const fn = sections[query];
      if (!fn) {
        // Si no reconoce la query, devolver todo en vez de fallar
        const allOutput = ["os", "cpu", "memory", "network", "time"]
          .map((key) => `## ${key.toUpperCase()}\n${sections[key]!()}`)
          .join("\n\n");
        return {
          output: `Query "${query}" no reconocida. Aquí va toda la información disponible:\n\n${allOutput}`,
        };
      }

      return { output: fn() };
    } catch (err) {
      return {
        output: "",
        error: `Error obteniendo info del sistema: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private getTimeInfo(): string {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dateStr = now.toLocaleDateString("es-ES", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: tz,
    });
    const timeStr = now.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: tz,
    });
    const offset = -now.getTimezoneOffset() / 60;
    const offsetStr = `UTC${offset >= 0 ? '+' : ''}${offset}`;
    return `Fecha: ${dateStr}\nHora: ${timeStr} (${tz}, ${offsetStr})`;
  }

  private getOSInfo(): string {
    return [
      `Plataforma: ${os.platform()}`,
      `Versión: ${os.release()}`,
      `Arquitectura: ${os.arch()}`,
      `Hostname: ${os.hostname()}`,
      `Usuario: ${os.userInfo().username}`,
      `Home: ${os.homedir()}`,
      `Uptime: ${this.formatUptime(os.uptime())}`,
    ].join("\n");
  }

  private getCPUInfo(): string {
    const cpus = os.cpus();
    const cpu = cpus[0];
    return [
      `Modelo: ${cpu?.model || "Desconocido"}`,
      `Cores: ${cpus.length}`,
      `Velocidad: ${cpu?.speed || 0} MHz`,
    ].join("\n");
  }

  private getMemoryInfo(): string {
    const totalGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const freeGB = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const usedGB = (
      (os.totalmem() - os.freemem()) /
      1024 /
      1024 /
      1024
    ).toFixed(2);
    const usagePercent = (
      ((os.totalmem() - os.freemem()) / os.totalmem()) *
      100
    ).toFixed(1);

    return [
      `Total: ${totalGB} GB`,
      `Usado: ${usedGB} GB (${usagePercent}%)`,
      `Libre: ${freeGB} GB`,
    ].join("\n");
  }

  private getNetworkInfo(): string {
    const interfaces = os.networkInterfaces();
    const lines: string[] = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === "IPv4" && !addr.internal) {
          lines.push(`${name}: ${addr.address}`);
        }
      }
    }

    return lines.length > 0 ? lines.join("\n") : "Sin interfaces de red activas";
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
  }
}
