import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import path from "node:path";
import { LLMProvider } from "../services/llm/LLMProvider.js";
import { VaultService } from "../services/vault/VaultService.js";

const ExecutiveReportInputSchema = z.object({
  scope: z.enum(["status_check", "full_report"]).default("full_report").describe("Nivel de detalle del reporte"),
});

type ExecutiveReportInput = z.infer<typeof ExecutiveReportInputSchema>;

export class ExecutiveReportTool extends Tool<ExecutiveReportInput> {
  readonly name = "executive_report";
  readonly description =
    "Genera un reporte inicial completo de AXS (Estatus AXS). " +
    "Sintetiza el estado de la empresa comparando el Roadmap estratégico con los avances diarios, semanales y mensuales.";
  readonly inputSchema = ExecutiveReportInputSchema;

  private provider: LLMProvider;
  private vaultService: VaultService;

  constructor(provider: LLMProvider) {
    super();
    this.provider = provider;
    this.vaultService = new VaultService();
  }

  async execute(input: ExecutiveReportInput): Promise<ToolExecutionResult> {
    try {
      // 1. Recopilar datos base
      const roadmap = await this.readRoadmap();
      const lastMonthUpdate = await this.getLastMonthUpdate();
      const todayLog = await this.getTodayLog();

      // 2. Sintetizar con LLM
      const report = await this.generateReportWithLLM(roadmap, lastMonthUpdate, todayLog);

      return {
        output: report,
        metadata: { scope: input.scope }
      };
    } catch (err) {
      return {
        output: "",
        error: `Error generando reporte ejecutivo: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  private async readRoadmap(): Promise<string> {
    const relPath = path.join("00-09 Management & Governance", "00 - AXS Roadmap.md");
    if (await this.vaultService.fileExists(relPath)) {
       return await this.vaultService.readVaultFile(relPath);
    }
    return "Roadmap no encontrado.";
  }

  private async getLastMonthUpdate(): Promise<string> {
    const updatesDir = path.join("50-59 Intelligence Feed", "51 Updates");
    try {
      const fs = await import("node:fs/promises");
      const absUpdatesDir = path.join(this.vaultService.getVaultPath(), updatesDir);
      
      const years = await fs.readdir(absUpdatesDir);
      const lastYear = years.sort().pop();
      if (!lastYear) return "Sin actualizaciones previas.";
      
      const months = await fs.readdir(path.join(absUpdatesDir, lastYear));
      const lastMonth = months.sort().pop();
      if (!lastMonth) return "Sin actualizaciones mensuales.";

      return await this.vaultService.readVaultFile(path.join(updatesDir, lastYear, lastMonth));
    } catch { 
      return "Error leyendo actualizaciones."; 
    }
  }

  private async getTodayLog(): Promise<string> {
    const logsDir = path.join("50-59 Intelligence Feed", "52 Logs");
    const today = new Date().toISOString().split("T")[0];
    const relPath = path.join(logsDir, `log-${today}.md`);
    if (await this.vaultService.fileExists(relPath)) {
      return await this.vaultService.readVaultFile(relPath);
    }
    return "Log diario de hoy aún no creado.";
  }

  private async generateReportWithLLM(roadmap: string, months: string, today: string): Promise<string> {
    const systemPrompt = `Eres la Jefa de Gabinete Eris. Tu misión es generar un REPORTE DE ESTATUS AXS claro, funcional y directo en formato Markdown.
REGLA CRÍTICA: IDIOMA MANDATORIO = ESPAÑOL. NUNCA RESPONDAS EN CHINO O INGLÉS.

Usa Markdown estándar (GitHub Flavored). No uses HTML.
Estructura la información utilizando:
- Encabezados claros (##, ###).
- Listas con viñetas (bullet points) para lectura rápida y concisa.
- Blockquotes (>) o bloques de código para resaltar KPIs, bloqueos o decisiones clave.
- Texto en negrita para enfatizar métricas, tareas completadas o estados.

TONO: Ejecutivo, directo, muy funcional y libre de ruido. Eres Eris, la Jefa de Gabinete Soberana. Ve directo al grano sin florituras innecesarias.`;

    const userPrompt = `Genera el Reporte Estatus AXS (Día, Mes, Año) basado en estos datos:\n\nROADMAP:\n${roadmap}\n\nACTUALIZACIONES RECIENTES:\n${months}\n\nLOG DE HOY:\n${today}`;

    const response = await this.provider.generate([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], undefined, { temperature: 0.2 });

    return response.content;
  }
}
