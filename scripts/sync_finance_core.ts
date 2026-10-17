// ============================================================
// Copia el núcleo de Finanzas de la app al servidor (COPIA EXACTA: el núcleo no tiene imports):
//   eris-mobile/src/services/finance/financeCore.ts → eris/src/services/FinanceCore.ts
// Así el chat (resumen, «¿y si me compro…?») calcula lo mismo que la app.
//   bun scripts/sync_finance_core.ts            → copia
//   bun scripts/sync_finance_core.ts --revisar  → solo revisa que estén iguales (sale con 1 si no)
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const APP_FINANCE_CORE = "C:/Proyectos/eris-mobile/src/services/finance/financeCore.ts";
export const SRV_FINANCE_CORE = join(import.meta.dir, "..", "src", "services", "FinanceCore.ts");

if (import.meta.main) {
  const app = readFileSync(APP_FINANCE_CORE, "utf-8");
  if (/^\s*import\s/m.test(app)) { console.error("El núcleo de Finanzas de la app ahora tiene imports: ya no puede ser copia exacta."); process.exit(1); }
  if (process.argv.includes("--revisar")) {
    let have = "";
    try { have = readFileSync(SRV_FINANCE_CORE, "utf-8"); } catch {}
    if (have !== app) { console.error("FinanceCore.ts del servidor NO es copia del de la app. Corre: bun scripts/sync_finance_core.ts"); process.exit(1); }
    console.log("Núcleo de Finanzas: servidor = app ✓");
  } else {
    writeFileSync(SRV_FINANCE_CORE, app, "utf-8");
    console.log(`Copiado → ${SRV_FINANCE_CORE}`);
  }
}
