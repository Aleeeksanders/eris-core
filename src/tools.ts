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

/**
 * Registro centralizado de todas las herramientas de Eris.
 * Nuevas herramientas se registran aquí.
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerDefaults();
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
