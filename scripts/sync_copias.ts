// ============================================================
// Copias exactas de la app al servidor que no tenían script (revisión N1/N3, 2026-11-04): cómo se escribe un alimento
// (foodText), el horario de las comidas (mealSchedule) y los valores nutricionales posibles (nutrientSanity). Antes eran
// «copia exacta» solo de palabra: una tenía otro fin de línea, otra otras comillas y una función menos, y la limpieza de
// los códigos de barras tenía menos reglas en la app que en el servidor.
//   bun scripts/sync_copias.ts            → copia las tres
//   bun scripts/sync_copias.ts --revisar  → solo revisa que estén iguales (sale con 1 si no)
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const APP = "C:/Proyectos/eris-mobile/src/services";
const SRV = join(import.meta.dir, "..", "src", "services");
export const COPIAS: Array<[string, string, string]> = [
  ["Cómo se escribe un alimento", join(APP, "foodText.ts"), join(SRV, "FoodText.ts")],
  ["Horario de las comidas", join(APP, "mealSchedule.ts"), join(SRV, "MealSchedule.ts")],
  ["Valores nutricionales posibles", join(APP, "nutrientSanity.ts"), join(SRV, "NutrientSanity.ts")],
];

if (import.meta.main) {
  let mal = 0;
  for (const [nombre, app, srv] of COPIAS) {
    const a = readFileSync(app, "utf-8");
    if (/^\s*import\s/m.test(a)) { console.error(`${nombre}: la copia de la app ahora tiene imports; ya no puede ser copia exacta.`); mal++; continue; }
    if (process.argv.includes("--revisar")) {
      let s = "";
      try { s = readFileSync(srv, "utf-8"); } catch {}
      if (s !== a) { console.error(`${nombre}: el servidor NO es copia de la app. Corre: bun scripts/sync_copias.ts`); mal++; }
      else console.log(`${nombre}: servidor = app ✓`);
    } else {
      writeFileSync(srv, a, "utf-8");
      console.log(`${nombre}: copiado → ${srv}`);
    }
  }
  if (mal) process.exit(1);
}
