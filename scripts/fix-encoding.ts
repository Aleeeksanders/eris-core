import { VaultService } from "../src/services/vault/VaultService.js";
import { VaultAuditTool } from "../src/tools/VaultAuditTool.js";

async function run() {
  console.log("🛠️ Iniciando reparación de codificación en enlaces...");
  const vaultService = new VaultService();
  const mdFiles = await vaultService.getAllMarkdownFiles();

  let filesChanged = 0;
  let totalReplacements = 0;

  const replacements = [
    { bad: "AdministraciÃ³n", good: "Administración" },
    { bad: "DocumentaciÃ³n", good: "Documentación" },
    { bad: "CompresiÃ³n", good: "Compresión" },
    { bad: "EvoluciÃ³n", good: "Evolución" },
    { bad: "FilosofÃ­a", good: "Filosofía" },
    { bad: "MatemÃ¡ticas", good: "Matemáticas" },
    { bad: "ExperimentaciÃ³n", good: "Experimentación" },
    { bad: "AutomatizaciÃ³n", good: "Automatización" },
    { bad: "GestiÃ³n", good: "Gestión" },
    { bad: "Ã¡", good: "á" },
    { bad: "Ã©", good: "é" },
    { bad: "Ã­", good: "í" },
    { bad: "Ã³", good: "ó" },
    { bad: "Ãº", good: "ú" },
    { bad: "Ã±", good: "ñ" },
    { bad: "Ã", good: "í" } // A veces "í" se corta si le seguía un espacio en latin1, pero usaremos los de arriba primero.
  ];

  for (const filePath of mdFiles) {
    let content = await vaultService.readVaultFile(filePath);
    const originalContent = content;

    for (const r of replacements) {
      if (content.includes(r.bad)) {
        const regex = new RegExp(r.bad, "g");
        const matches = content.match(regex);
        if (matches) {
          totalReplacements += matches.length;
          content = content.replace(regex, r.good);
        }
      }
    }

    if (content !== originalContent) {
      await vaultService.writeVaultFile(filePath, content);
      filesChanged++;
    }
  }

  console.log(`✅ Reparación completada. Se modificaron ${filesChanged} archivos con un total de ${totalReplacements} correcciones.`);

  console.log("\n🔬 Ejecutando Auditoría Post-Sanación (VaultAuditTool)...");
  const auditor = new VaultAuditTool();
  const auditResult = await auditor.execute({ action: "full_audit" });
  console.log(auditResult.output);
}

run();
