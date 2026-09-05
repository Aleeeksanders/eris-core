import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import path from "node:path";
import { VaultService } from "../services/vault/VaultService.js";

const CrystallizeInputSchema = z.object({
  decision: z.string().describe("La decisión o acuerdo alcanzado en la conversación"),
  context: z.string().describe("Breve contexto de por qué se tomó esta decisión"),
  project: z.string().optional().describe("Nombre del proyecto relacionado"),
});

type CrystallizeInput = z.infer<typeof CrystallizeInputSchema>;

export class CrystallizeTool extends Tool<CrystallizeInput> {
  readonly name = "crystallize";
  readonly description =
    "Guarda una decisión estratégica o acuerdo en el registro oficial de AXS (Obsidian). " +
    "Úsala automáticamente cuando Alex esté de acuerdo con una propuesta o se llegue a un consenso final.";
  readonly inputSchema = CrystallizeInputSchema;

  private vaultService: VaultService;

  constructor() {
    super();
    this.vaultService = new VaultService();
  }

  async execute(input: CrystallizeInput): Promise<ToolExecutionResult> {
    const { decision, context, project } = input;
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timestamp = now.toLocaleTimeString();

    // Slug legible derivado de la decisión (antes: timestamp Unix, no navegable)
    const slug = decision
      .normalize("NFD").replace(/[^\x00-\x7F]/g, "")  // quita acentos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-").slice(0, 6).join("-") || String(now.getTime());

    const fileName = `decision-${dateStr}-${slug}.md`;
    const relPath = path.join("50-59 Intelligence Feed", "53 Decisions", fileName);

    const content = `---
date: ${dateStr}
time: ${timestamp}
project: ${project || "General"}
type: Decisión Ejecutiva
---

# 🧠 Cristalización de Decisión — ${dateStr}

## 📝 Acuerdo
${decision}

## 📋 Contexto
${context}

---
*Registrado automáticamente por Eris - Protocolo Antigravity*`;

    try {
      await this.vaultService.writeVaultFile(relPath, content);

      return {
        output: `Decisión cristalizada con éxito en: ${fileName}. El acuerdo ahora es permanente en Obsidian.`,
        metadata: { filePath: relPath }
      };
    } catch (err) {
      return {
        output: "",
        error: `Error al cristalizar la decisión: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
}
