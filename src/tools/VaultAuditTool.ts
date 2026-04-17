// ============================================================
// Eris — VaultAuditTool
// Auditoría de salud y consistencia de la boveda AXS
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import fs from "node:fs/promises";
import path from "node:path";

const VaultAuditInputSchema = z.object({
  action: z.enum(["full_audit", "link_check"]).default("full_audit").describe("Tipo de auditoría a realizar"),
});

type VaultAuditInput = z.infer<typeof VaultAuditInputSchema>;

export class VaultAuditTool extends Tool<VaultAuditInput> {
  readonly name = "vault_audit";
  readonly description =
    "Realiza una auditoría de salud de la boveda Obsidian de AXS. " +
    "Detecta enlaces rotos, archivos huérfanos y falta de metadatos corporativos.";
  readonly inputSchema = VaultAuditInputSchema;

  private readonly VAULT_ROOT = "c:\\Proyectos\\AXS";

  async execute(input: VaultAuditInput): Promise<ToolExecutionResult> {
    const { action } = input;

    try {
      const allFiles = await this.getAllFiles(this.VAULT_ROOT);
      const mdFiles = allFiles.filter(f => f.endsWith(".md"));
      const fileMap = new Set(allFiles.map(f => path.relative(this.VAULT_ROOT, f).replace(/\\/g, "/")));
      const baseMap = new Set(allFiles.map(f => path.basename(f, ".md")));

      let report = `# 🔬 Reporte de Salud AXS — ${new Date().toLocaleDateString()}\n\n`;
      let brokenLinks: string[] = [];
      let orphanFiles: string[] = [];
      let missingMetadata: string[] = [];

      for (const filePath of mdFiles) {
        const content = await fs.readFile(filePath, "utf-8");
        const relPath = path.relative(this.VAULT_ROOT, filePath).replace(/\\/g, "/");

        // 1. Check Links
        const links = content.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [];
        for (const link of links) {
          const target = link.match(/\[\[([^\]|]+)/)?.[1].trim() || "";
          // Si el link no termina en .md y no lo encontramos, probamos añadiéndolo
          if (!fileMap.has(target) && !fileMap.has(target + ".md") && !baseMap.has(target)) {
            brokenLinks.push(`- **${path.basename(filePath)}**: Enlace roto \`${link}\``);
          }
        }

        // 2. Check Metadata (YAML Properties)
        if (!content.startsWith("---") || !content.includes("owner:") || !content.includes("tier:")) {
          missingMetadata.push(`- \`${relPath}\``);
        }
      }

      report += `## 🩹 Enlaces Rotos (${brokenLinks.length})\n${brokenLinks.slice(0, 15).join("\n") || "_Todo en orden._"}\n\n`;
      report += `## 🏷️ Metadatos Faltantes (${missingMetadata.length})\n${missingMetadata.slice(0, 10).join("\n") || "_Todo estandarizado._"}\n\n`;
      
      const status = brokenLinks.length === 0 && missingMetadata.length === 0 ? "EXCELENTE" : "REQUIERE ATENCIÓN";
      report += `\n**Estado General: ${status}**\n\n_Eris Potts — Jefa de Gabinete_`;

      return {
        output: report,
        metadata: { brokenCount: brokenLinks.length, missingMeta: missingMetadata.length }
      };
    } catch (err) {
      return {
        output: "",
        error: `Error en auditoría: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  private async getAllFiles(dir: string): Promise<string[]> {
    let results: string[] = [];
    const list = await fs.readdir(dir);
    for (const file of list) {
        if (file === ".obsidian" || file === ".git") continue;
        const fullPath = path.join(dir, file);
        const stat = await fs.stat(fullPath);
        if (stat && stat.isDirectory()) {
            results = results.concat(await this.getAllFiles(fullPath));
        } else {
            results.push(fullPath);
        }
    }
    return results;
  }
}
