// ============================================================
// Eris — LogManagementTool
// Gestión automatizada del ciclo de vida de registros de AXS
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import path from "node:path";
import { LLMProvider } from "../services/llm/LLMProvider.js";
import { VaultService } from "../services/vault/VaultService.js";

const LogManagementInputSchema = z.object({
  action: z.enum(["rotate", "create_today"]).describe("Acción a realizar: rotar registros o crear el de hoy"),
  date: z.string().optional().describe("Fecha en formato YYYY-MM-DD (por defecto hoy)"),
});

type LogManagementInput = z.infer<typeof LogManagementInputSchema>;

export class LogManagementTool extends Tool<LogManagementInput> {
  readonly name = "log_management";
  readonly description =
    "Gestiona el ciclo de vida de los logs diarios de AXS. " +
    "Realiza la síntesis de ayer hacia el Timeline mensual y crea el nuevo log del día.";
  readonly inputSchema = LogManagementInputSchema;

  private readonly LOGS_DIR = path.join("50-59 Intelligence Feed", "52 Logs");
  private readonly UPDATES_DIR = path.join("50-59 Intelligence Feed", "51 Updates");

  private provider: LLMProvider;
  private vaultService: VaultService;

  constructor(provider: LLMProvider) {
    super();
    this.provider = provider;
    this.vaultService = new VaultService();
  }

  async execute(input: LogManagementInput): Promise<ToolExecutionResult> {
    const { action } = input;
    const now = new Date();
    const todayStr = input.date || now.toISOString().split("T")[0];

    try {
      if (action === "create_today") {
        return await this.createTodayLog(todayStr);
      } else if (action === "rotate") {
        return await this.rotateLogs(todayStr);
      }
      return { output: "Acción no reconocida." };
    } catch (err) {
      return {
        output: "",
        error: `Error en log_management: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async createTodayLog(date: string): Promise<ToolExecutionResult> {
    const fileName = `log-${date}.md`;
    const relPath = path.join(this.LOGS_DIR, fileName);

    const exists = await this.vaultService.fileExists(relPath);
    if (exists) {
      return { output: `El registro diario de hoy (${date}) ya existe en ${relPath}.` };
    }

    const template = `# 📝 AXS Daily Log — ${date}
    
## 🎯 Objetivos Principales
- [ ] 
- [ ] 

## 🚀 Avances y Ejecución (Bullets para Eris)
> Escribe aquí tus hitos. Mañana los resumiré automáticamente.
- 

## 🧩 Bloqueos y Riesgos
- 

## 💡 Ideas de Futuro
- 

---
*Documento generado automáticamente por Eris.*`;

    await this.vaultService.writeVaultFile(relPath, template);

    return {
      output: `Se ha creado el registro diario para hoy: ${relPath}. Escribe tus avances en la sección correspondiente.`,
    };
  }

  private async rotateLogs(todayDate: string): Promise<ToolExecutionResult> {
    // 1. Buscar archivos de días anteriores
    const allFiles = await this.vaultService.getAllFiles(path.join(this.vaultService.getVaultPath(), this.LOGS_DIR));
    const logFiles = allFiles
        .map(f => path.basename(f))
        .filter(f => f.startsWith("log-") && f.endsWith(".md") && !f.includes(todayDate));

    if (logFiles.length === 0) {
      return { output: "No hay registros anteriores para rotar." };
    }

    let summaryResults = "";

    for (const fileName of logFiles) {
      const relPath = path.join(this.LOGS_DIR, fileName);
      const content = await this.vaultService.readVaultFile(relPath);
      const dateStr = fileName.replace("log-", "").replace(".md", "");

      // 2. Extraer bullets usando LLM
      const summary = await this.summarizeLog(content, dateStr);
      
      // 3. Escribir en el Timeline Mensual
      await this.updateMonthlyTimeline(summary, dateStr);

      // 4. Eliminar el archivo viejo
      // Import fs just for unlink since we didn't put unlink in VaultService to keep it simple,
      // or we can just use fs.unlink(absolutePath).
      const fs = await import("node:fs/promises");
      await fs.unlink(path.join(this.vaultService.getVaultPath(), relPath));
      
      summaryResults += `- Registro ${dateStr} sintetizado y archivado.\n`;
    }

    return {
      output: `Rotación completada con éxito:\n${summaryResults}`,
    };
  }

  private async summarizeLog(content: string, date: string): Promise<string> {
    const systemPrompt = "Eres un sintetizador ejecutivo de AXS. Tu trabajo es extraer 3-5 bullets de máximo valor estratégico de un log diario. Ignora el relleno. Sé técnico y directo.";
    const userPrompt = `Resume este log diario del día ${date} en bullets de impacto:\n\n${content}`;

    const response = await this.provider.generate([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], undefined, { temperature: 0.1, maxTokens: 256 });

    return response.content.trim();
  }

  private async updateMonthlyTimeline(summary: string, date: string): Promise<void> {
    const [year, month] = date.split("-");
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const monthName = monthNames[parseInt(month) - 1];
    
    const relPath = path.join(this.UPDATES_DIR, year, `${month} - ${monthName}.md`);
    
    let existingContent = "";
    if (await this.vaultService.fileExists(relPath)) {
      existingContent = await this.vaultService.readVaultFile(relPath);
    } else {
      existingContent = `# 📈 Timeline Mensual — ${monthName} ${year}\n\n`;
    }

    const newEntry = `### 📅 Día ${date}\n${summary}\n\n---\n`;
    const updatedContent = existingContent + newEntry;

    await this.vaultService.writeVaultFile(relPath, updatedContent);
  }
}
