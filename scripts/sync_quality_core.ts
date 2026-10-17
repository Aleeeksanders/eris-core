// ============================================================
// Copia el núcleo de calidad de la app al servidor (COPIA EXACTA salvo las rutas de los import):
//   eris-mobile/src/services/nutritionQualityCore.ts → eris/src/services/NutritionQualityCore.ts
// Así el chat («¿y si me como un completo?») calcula la misma nota que la tarjeta de la app.
//   bun scripts/sync_quality_core.ts            → copia
//   bun scripts/sync_quality_core.ts --revisar  → solo revisa que estén iguales (sale con 1 si no)
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const APP = "C:/Proyectos/eris-mobile/src/services/nutritionQualityCore.ts";
const SRV = join(import.meta.dir, "..", "src", "services", "NutritionQualityCore.ts");

/** Las únicas diferencias permitidas: dónde están los módulos en cada proyecto. */
const IMPORTS: Array<[string, string]> = [
  ["import { plausibleSodiumMg } from './nutrientSanity';", "import { plausibleSodiumMg } from './NutrientSanity.js';"],
  ["import { effectiveSlot, slotIsPast, normDayHour } from './mealSchedule';", "import { effectiveSlot, slotIsPast, normDayHour } from './MealSchedule.js';"],
];

export function serverVersion(app: string): string {
  let out = app;
  for (const [a, s] of IMPORTS) {
    if (!out.includes(a)) throw new Error(`El núcleo de la app ya no tiene «${a}»: revisa IMPORTS`);
    out = out.replace(a, s);
  }
  return out;
}

if (import.meta.main) {
  const want = serverVersion(readFileSync(APP, "utf-8"));
  if (process.argv.includes("--revisar")) {
    let have = "";
    try { have = readFileSync(SRV, "utf-8"); } catch {}
    if (have !== want) { console.error("NutritionQualityCore.ts del servidor NO es copia del de la app. Corre: bun scripts/sync_quality_core.ts"); process.exit(1); }
    console.log("Núcleo de calidad: servidor = app ✓");
  } else {
    writeFileSync(SRV, want, "utf-8");
    console.log(`Copiado → ${SRV}`);
  }
}
