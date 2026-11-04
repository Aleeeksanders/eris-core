// ============================================================
// Copia el núcleo de Suplementos de la app al servidor (COPIA EXACTA: el núcleo no tiene imports):
//   eris-mobile/src/services/supplements/supplementCore.ts → eris/src/services/SupplementCore.ts
// Así el chat («me tomé la creatina», las fichas, lo que suman a vitaminas y minerales) calcula lo mismo que la app.
//   bun scripts/sync_supplement_core.ts            → copia
//   bun scripts/sync_supplement_core.ts --revisar  → solo revisa que estén iguales (sale con 1 si no)
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const APP_SUPPLEMENT_CORE = "C:/Proyectos/eris-mobile/src/services/supplements/supplementCore.ts";
export const SRV_SUPPLEMENT_CORE = join(import.meta.dir, "..", "src", "services", "SupplementCore.ts");

if (import.meta.main) {
  const app = readFileSync(APP_SUPPLEMENT_CORE, "utf-8");
  if (/^\s*import\s/m.test(app)) { console.error("El núcleo de Suplementos de la app ahora tiene imports: ya no puede ser copia exacta."); process.exit(1); }
  if (process.argv.includes("--revisar")) {
    let have = "";
    try { have = readFileSync(SRV_SUPPLEMENT_CORE, "utf-8"); } catch {}
    if (have !== app) { console.error("SupplementCore.ts del servidor NO es copia del de la app. Corre: bun scripts/sync_supplement_core.ts"); process.exit(1); }
    console.log("Núcleo de Suplementos: servidor = app ✓");
  } else {
    writeFileSync(SRV_SUPPLEMENT_CORE, app, "utf-8");
    console.log(`Copiado → ${SRV_SUPPLEMENT_CORE}`);
  }
}
