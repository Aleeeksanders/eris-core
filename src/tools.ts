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
import { TrainingTodayTool } from "./tools/TrainingTodayTool.js";
import { LabResultsTool } from "./tools/LabResultsTool.js";
import { FinanceTrackerTool } from "./tools/FinanceTrackerTool.js";
import { InventoryTrackerTool } from "./tools/InventoryTrackerTool.js";
import { SupplementTrackerTool } from "./tools/SupplementTrackerTool.js";
import { DayAgendaTool } from "./tools/DayAgendaTool.js";
import { DayPlanTool } from "./tools/DayPlanTool.js";

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
      // «¿Qué tengo para hoy?», «planifícame el resto del día»: el día cruzando los módulos (antes que Finanzas: «qué tengo» no es un saldo)
      // «¿Qué recomienda Eris?» / «decide tú»: Eris arma el día en 3 caminos (antes que la agenda: «qué me recomiendas hoy» no es «qué tengo hoy»)
      new DayPlanTool(),
      new DayAgendaTool(),
      // Antes que nutrición: su preroute reconoce "gasté 5 lucas en almuerzo" (el almuerzo es la descripción, no una comida a registrar)
      new FinanceTrackerTool(),
      // Después de Finanzas («compré leche en 2 lucas» es un gasto) y antes de Nutrición: «me quedan 3 huevos» o «compré
      // 2 L de leche» son del Inventario, no comidas a registrar
      new InventoryTrackerTool(),
      // Antes que Nutrición: «me tomé la creatina» es un suplemento, no una comida (y «compré creatina» ya lo vio el Inventario)
      new SupplementTrackerTool(),
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
      new TrainingTodayTool(),
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
