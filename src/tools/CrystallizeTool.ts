import { z } from "zod";
import { Tool, type ToolExecutionResult, type PreflightResult } from "../Tool.js";
import path from "node:path";
import fsp from "node:fs/promises";
import { VaultService } from "../services/vault/VaultService.js";
import { addBulletToSection, backupFile, keepEol } from "../services/vault/VaultEdit.js";

const CrystallizeInputSchema = z.object({
  decision: z.string().describe("La decisión o acuerdo alcanzado en la conversación"),
  context: z.string().describe("Breve contexto de por qué se tomó esta decisión"),
  project: z.string().optional().describe("Nombre del proyecto relacionado"),
});

type CrystallizeInput = z.infer<typeof CrystallizeInputSchema>;

export class CrystallizeTool extends Tool<CrystallizeInput> {
  readonly name = "crystallize";
  readonly dangerous = true;
  readonly description =
    "Guarda una decisión estratégica o acuerdo en el registro oficial de AXS (Obsidian). " +
    "Úsala automáticamente cuando Alex esté de acuerdo con una propuesta o se llegue a un consenso final.";
  readonly inputSchema = CrystallizeInputSchema;

  private vaultService: VaultService;

  constructor() {
    super();
    this.vaultService = new VaultService();
  }

  /**
   * Escribe en la bóveda (una nota nueva + un enlace en el Índice del Feed): como vault_note, primero se aprueba en la app.
   * Antes escribía sola; el prompt le pide usarla "de forma proactiva", así que sin la tarjeta guardaba decisiones sin preguntar.
   */
  preflight(input: CrystallizeInput): PreflightResult {
    return {
      ok: true,
      approval: {
        title: "Guardar una decisión en la bóveda AXS",
        detail: `Proyecto: ${input.project || "General"}\n\nDecisión:\n${input.decision}\n\nContexto:\n${input.context}\n\n` +
          `Se crea en «50-59 Intelligence Feed/53 Decisions» y se enlaza en el Índice del Feed (se guarda una copia antes).`,
        risk: "normal",
        flags: ["modifica el Índice del Feed"],
      },
    };
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
*Registrado por Hestia - Protocolo Antigravity*`;

    try {
      await this.vaultService.writeVaultFile(relPath, content);

      // CLAUDE.md de la bóveda: "al generar un log, decisión o reporte nuevo, enlázalo en el Índice del Feed" (si no, nace huérfana)
      let indexNote = "";
      try {
        const root = this.vaultService.getVaultPath();
        const abs = path.join(root, "50-59 Intelligence Feed", "50 - Índice del Feed.md");
        const raw = await fsp.readFile(abs, "utf-8");
        const link = relPath.split(path.sep).join("/");
        if (!raw.includes(link)) {
          const title = decision.replace(/[\[\]|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70);
          const bullet = `- ${dateStr} · [[${link}|${title}]] — *${project || "General"}*`;
          const next = keepEol(raw, (t) => addBulletToSection(t, /53 Decisions/, bullet) ?? t);
          if (next !== raw) {
            await backupFile(root, abs); // copia previa: si no se puede respaldar, no se toca el índice
            await fsp.writeFile(abs, next, "utf-8");
            indexNote = " Quedó enlazada en el Índice del Feed.";
          } else indexNote = " (No encontré la sección de decisiones del Índice del Feed: falta enlazarla ahí.)";
        }
      } catch {
        indexNote = " (No pude actualizar el Índice del Feed: falta enlazarla ahí.)";
      }

      return {
        output: `Decisión cristalizada con éxito en: ${fileName}. El acuerdo ahora es permanente en Obsidian.${indexNote}`,
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
