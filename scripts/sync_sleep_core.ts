// ============================================================
// Copia el núcleo del Sueño de la app al servidor (COPIA EXACTA: el núcleo no tiene imports):
//   eris-mobile/src/services/sleep/sleepCore.ts → eris/src/services/SleepCore.ts
// Así el chat cuenta el sueño igual que la app: las partes del día (la noche, un segundo sueño, siestas) y la misma frase.
//   bun scripts/sync_sleep_core.ts            → copia
//   bun scripts/sync_sleep_core.ts --revisar  → solo revisa que estén iguales (sale con 1 si no)
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const APP_SLEEP_CORE = "C:/Proyectos/eris-mobile/src/services/sleep/sleepCore.ts";
export const SRV_SLEEP_CORE = join(import.meta.dir, "..", "src", "services", "SleepCore.ts");

if (import.meta.main) {
  const app = readFileSync(APP_SLEEP_CORE, "utf-8");
  if (/^\s*import\s/m.test(app)) { console.error("El núcleo del Sueño de la app ahora tiene imports: ya no puede ser copia exacta."); process.exit(1); }
  if (process.argv.includes("--revisar")) {
    let have = "";
    try { have = readFileSync(SRV_SLEEP_CORE, "utf-8"); } catch {}
    if (have !== app) { console.error("SleepCore.ts del servidor NO es copia del de la app. Corre: bun scripts/sync_sleep_core.ts"); process.exit(1); }
    console.log("Núcleo del Sueño: servidor = app ✓");
  } else {
    writeFileSync(SRV_SLEEP_CORE, app, "utf-8");
    console.log(`Copiado → ${SRV_SLEEP_CORE}`);
  }
}
