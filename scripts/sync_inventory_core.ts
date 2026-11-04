// ============================================================
// Copia el núcleo de Inventario de la app al servidor (COPIA EXACTA: el núcleo no tiene imports):
//   eris-mobile/src/services/inventory/inventoryCore.ts → eris/src/services/InventoryCore.ts
// Así el chat (¿tengo arroz?, la lista de compras, lo que se vence) calcula lo mismo que la app, aunque el teléfono no
// esté conectado (sobre el último respaldo).
//   bun scripts/sync_inventory_core.ts            → copia
//   bun scripts/sync_inventory_core.ts --revisar  → solo revisa que estén iguales (sale con 1 si no)
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const APP_INVENTORY_CORE = "C:/Proyectos/eris-mobile/src/services/inventory/inventoryCore.ts";
export const SRV_INVENTORY_CORE = join(import.meta.dir, "..", "src", "services", "InventoryCore.ts");

if (import.meta.main) {
  const app = readFileSync(APP_INVENTORY_CORE, "utf-8");
  if (/^\s*import\s/m.test(app)) { console.error("El núcleo de Inventario de la app ahora tiene imports: ya no puede ser copia exacta."); process.exit(1); }
  if (process.argv.includes("--revisar")) {
    let have = "";
    try { have = readFileSync(SRV_INVENTORY_CORE, "utf-8"); } catch {}
    if (have !== app) { console.error("InventoryCore.ts del servidor NO es copia del de la app. Corre: bun scripts/sync_inventory_core.ts"); process.exit(1); }
    console.log("Núcleo de Inventario: servidor = app ✓");
  } else {
    writeFileSync(SRV_INVENTORY_CORE, app, "utf-8");
    console.log(`Copiado → ${SRV_INVENTORY_CORE}`);
  }
}
