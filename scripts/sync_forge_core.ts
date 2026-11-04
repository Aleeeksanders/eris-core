// ============================================================
// Copia el núcleo de Forge de la app al servidor (COPIA EXACTA de los tres archivos; solo se importan entre ellos):
//   eris-mobile/src/services/forge/{forgeLegacy,forgeCatalog,forgeCore,forgeTrain}.ts → eris/src/services/forge/
// Así el chat (TrainingPlanTool: catálogo, rutinas, metas del día) calcula lo mismo que la app.
//   bun scripts/sync_forge_core.ts            → copia
//   bun scripts/sync_forge_core.ts --revisar  → solo revisa que estén iguales (sale con 1 si no)
// forgeLegacy.ts lo genera un script desde assets/toji.html: no se edita a mano.
// ============================================================

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export const FORGE_FILES = ["forgeLegacy.ts", "forgeCatalog.ts", "forgeCore.ts", "forgeTrain.ts", "forgeStrength.ts", "forgeRoutine.ts", "forgeProgress.ts", "forgeMdRoutine.ts", "forgeSkillsExt.ts", "forgeAthletic.ts"];
export const APP_FORGE_DIR = "C:/Proyectos/eris-mobile/src/services/forge";
export const SRV_FORGE_DIR = join(import.meta.dir, "..", "src", "services", "forge");

if (import.meta.main) {
  let bad = 0;
  for (const f of FORGE_FILES) {
    const app = readFileSync(join(APP_FORGE_DIR, f), "utf-8");
    const imports = [...app.matchAll(/^\s*import\s[^;]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const outside = imports.filter((p) => !/^\.\/forge(Legacy|Catalog|Core|Train|Strength|Routine|MdRoutine|SkillsExt|Athletic)$/.test(p));
    if (outside.length) { console.error(`${f} importa algo fuera del núcleo (${outside.join(", ")}): ya no puede ser copia exacta.`); process.exit(1); }
    if (process.argv.includes("--revisar")) {
      let have = "";
      try { have = readFileSync(join(SRV_FORGE_DIR, f), "utf-8"); } catch {}
      if (have !== app) { console.error(`${f} del servidor NO es copia del de la app. Corre: bun scripts/sync_forge_core.ts`); bad++; }
    } else {
      mkdirSync(SRV_FORGE_DIR, { recursive: true });
      writeFileSync(join(SRV_FORGE_DIR, f), app, "utf-8");
      console.log(`Copiado → ${join(SRV_FORGE_DIR, f)}`);
    }
  }
  if (process.argv.includes("--revisar")) { if (bad) process.exit(1); console.log("Núcleo de Forge: servidor = app ✓"); }
}
