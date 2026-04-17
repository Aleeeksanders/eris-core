// ============================================================
// Eris — VaultHealerTool
// Sanación autónoma y masiva de la boveda AXS
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import fs from "node:fs/promises";
import path from "node:path";

const VaultHealerInputSchema = z.object({
  action: z.enum(["auto_heal", "fix_links", "inject_metadata"]).default("auto_heal").describe("Acción de sanación a ejecutar"),
  scope: z.array(z.string()).optional().describe("Lista opcional de carpetas o archivos a sanar"),
});

type VaultHealerInput = z.infer<typeof VaultHealerInputSchema>;

export class VaultHealerTool extends Tool<VaultHealerInput> {
  readonly name = "vault_healer";
  readonly description =
    "Herramienta ejecutiva para el mantenimiento masivo de AXS. " +
    "Repara enlaces, inyecta metadatos corporativos y crea archivos de proyecto faltantes de forma autónoma.";
  readonly inputSchema = VaultHealerInputSchema;

  private readonly VAULT_ROOT = "c:\\Proyectos\\AXS";

  async execute(input: VaultHealerInput): Promise<ToolExecutionResult> {
    const { action } = input;
    
    try {
      const allFiles = await this.getAllFiles(this.VAULT_ROOT);
      const mdFiles = allFiles.filter(f => f.endsWith(".md"));
      
      // Mapa de nombres base -> rutas relativas para resolución de enlaces
      const fileMap = new Map<string, string>();
      allFiles.forEach(f => {
        const name = path.basename(f, ".md");
        const rel = path.relative(this.VAULT_ROOT, f).replace(/\\/g, "/");
        fileMap.set(name, rel);
      });

      let healedCount = 0;
      let linksRepaired = 0;
      let createdFiles: string[] = [];

      for (const filePath of mdFiles) {
        let content = await fs.readFile(filePath, "utf-8");
        const originalContent = content;
        const relPath = path.relative(this.VAULT_ROOT, filePath).replace(/\\/g, "/");

        // 1. Inyectar Metadatos (YAML)
        if (action === "auto_heal" || action === "inject_metadata") {
           content = this.ensureMetadata(content, relPath);
        }

        // 2. Sanar Enlaces
        if (action === "auto_heal" || action === "fix_links") {
           const { newContent, repaired, missing } = this.healLinks(content, fileMap);
           content = newContent;
           linksRepaired += repaired;

           // 3. Autocreación de placeholders (Carta Blanca)
           if (action === "auto_heal") {
             for (const missingLink of missing) {
               // Heurística: Si empieza por Mayúscula y no es un path complejo, asumimos proyecto/entidad
               if (/^[A-Z][a-zA-Z0-0]/.test(missingLink) && !missingLink.includes("/")) {
                 const created = await this.createPlaceholder(missingLink);
                 if (created) {
                   createdFiles.push(missingLink);
                   // Actualizar mapa para siguientes archivos
                   fileMap.set(missingLink, `20-29 R&D (The Forge)/${missingLink}.md`);
                 }
               }
             }
           }
        }

        if (content !== originalContent) {
          await fs.writeFile(filePath, content, "utf-8");
          healedCount++;
        }
      }

      let summary = `# ✅ Protocolo de Sanación Completado\n\n`;
      summary += `- **Archivos curados:** ${healedCount}\n`;
      summary += `- **Enlaces reparados:** ${linksRepaired}\n`;
      if (createdFiles.length > 0) {
        summary += `- **Nuevos placeholders creados:** ${createdFiles.join(", ")}\n`;
      }
      summary += `\n**Boveda AXS estandarizada bajo protocolo corporativo.**`;

      return { output: summary };
    } catch (err) {
      return {
        output: "",
        error: `Error en vault_healer: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }

  private ensureMetadata(content: string, relPath: string): string {
    const tier = this.getTier(relPath);
    const yamlBlock = `---\nowner: Eris Potts\ntier: ${tier}\nstatus: Activo\n---\n\n`;

    if (!content.trim().startsWith("---")) {
      return yamlBlock + content;
    } else {
      let newContent = content;
      if (!content.includes("owner:")) {
        newContent = newContent.replace("---", "---\nowner: Eris Potts");
      }
      if (!content.includes("tier:")) {
        newContent = newContent.replace("---", `---\ntier: ${tier}`);
      }
      return newContent;
    }
  }

  private getTier(relPath: string): string {
    if (relPath.startsWith("00-09")) return "Directivo";
    if (relPath.startsWith("10-19")) return "Estratégico";
    if (relPath.startsWith("20-29")) return "Técnico";
    if (relPath.startsWith("30-39")) return "Operativo";
    return "Operativo";
  }

  private healLinks(content: string, fileMap: Map<string, string>): { newContent: string, repaired: number, missing: string[] } {
    let repaired = 0;
    let missing: string[] = [];
    const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

    const newContent = content.replace(linkRegex, (match, linkTarget, alias) => {
      const cleanTarget = linkTarget.trim();
      if (fileMap.has(cleanTarget)) {
        const newPath = fileMap.get(cleanTarget);
        if (newPath !== cleanTarget) {
            repaired++;
            return `[[${newPath}${alias ? "|" + alias : ""}]]`;
        }
      } else {
          missing.push(cleanTarget);
      }
      return match;
    });

    return { newContent, repaired, missing };
  }

  private async createPlaceholder(name: string): Promise<boolean> {
    const targetDir = path.join(this.VAULT_ROOT, "20-29 R&D (The Forge)");
    const filePath = path.join(targetDir, `${name}.md`);

    try {
      await fs.access(filePath);
      return false; // Ya existe
    } catch {
      const template = `---\nowner: Eris Potts\ntier: Técnico\nstatus: Placeholder\n---\n# 🆕 ${name}\nArchivo creado automáticamente por protocolo de sanación.\n\n## Descripción\n_Pendiente de definición._`;
      await fs.writeFile(filePath, template, "utf-8");
      return true;
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
