// ============================================================
// Eris — Registro de Herramientas
// Inspirado en src/tools.ts de Claude Code
// ============================================================

import { Tool } from "./Tool.js";
import { BashTool } from "./tools/BashTool.js";
import { WebSearchTool } from "./tools/WebSearchTool.js";
import { SystemInfoTool } from "./tools/SystemInfoTool.js";
import { FileReadTool } from "./tools/FileReadTool.js";
import { FileWriteTool } from "./tools/FileWriteTool.js";
import { OpenTool } from "./tools/OpenTool.js";
import { KnowledgeTool } from "./tools/KnowledgeTool.js";
import { NutritionTool } from "./tools/NutritionTool.js";
import { TrainingPlanTool } from "./tools/TrainingPlanTool.js";
import { PersonalBaselineTool } from "./tools/PersonalBaselineTool.js";
import { UserContextTool } from "./tools/UserContextTool.js";
import { JournalTool } from "./tools/JournalTool.js";
import { InsightFeedbackTool } from "./tools/InsightFeedbackTool.js";
import { LiveContextTool } from "./tools/LiveContextTool.js";
import { CarbOptionsTool } from "./tools/CarbOptionsTool.js";
import { MetabolicAdvisorTool } from "./tools/MetabolicAdvisorTool.js";
import { SymptomGuideTool } from "./tools/SymptomGuideTool.js";
import { SleepLogTool } from "./tools/SleepLogTool.js";
import { LabResultsTool } from "./tools/LabResultsTool.js";
import { FinanceTrackerTool } from "./tools/FinanceTrackerTool.js";

/**
 * Registro centralizado de todas las herramientas de Eris.
 * Nuevas herramientas se registran aquí.
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor(preloaded?: Tool[]) {
    if (preloaded) {
      // Inicializar con lista pre-filtrada (para roles con permisos restringidos)
      for (const tool of preloaded) {
        this.register(tool);
      }
    } else {
      this.registerDefaults();
    }
  }

  private registerDefaults(): void {
    const defaultTools: Tool[] = [
      new BashTool(),
      new WebSearchTool(),
      new SystemInfoTool(),
      new FileReadTool(),
      new FileWriteTool(),
      new OpenTool(),
      new KnowledgeTool(),
      // Antes que nutrición: su preroute reconoce "gasté 5 lucas en almuerzo" (el almuerzo es la descripción, no una comida a registrar)
      new FinanceTrackerTool(),
      new NutritionTool(),
      new TrainingPlanTool(),
      new PersonalBaselineTool(),
      new UserContextTool(),
      new JournalTool(),
      new InsightFeedbackTool(),
      new LiveContextTool(),
      new CarbOptionsTool(),
      new MetabolicAdvisorTool(),
      new SymptomGuideTool(),
      // Después de la guía de síntomas: "dormí 4 horas y me duele la cabeza" primero es el síntoma
      new SleepLogTool(),
      new LabResultsTool(),
    ];

    for (const tool of defaultTools) {
      this.register(tool);
    }
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return this.getAll().map((t) => t.toDefinition());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }
}

/** Instancia global del registro de herramientas */
export const toolRegistry = new ToolRegistry();
