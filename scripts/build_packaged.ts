// Uso: bun scripts/build_packaged.ts <carpeta con páginas .json de Open Food Facts>
// Convierte productos de OFF (Chile) a src/data/packaged_cl.json con alérgenos interpretados.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fromOff, bulkUpsert, packagedCount, type OffProduct } from "../src/services/PackagedFoods.ts";

const dir = process.argv[2];
if (!dir) { console.error("Falta la carpeta de entrada"); process.exit(1); }
let seen = 0; const list = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  for (const p of JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as OffProduct[]) {
    seen++;
    const rec = fromOff(p);
    if (rec) list.push(rec);
  }
}
bulkUpsert(list);
const verified = list.filter((p) => p.ingredientsComplete).length;
console.log(`OFF: ${seen} productos leídos · ${list.length} utilizables (nombre + macros) · ${verified} con ingredientes completos (verificables) · total en base: ${packagedCount()}`);
