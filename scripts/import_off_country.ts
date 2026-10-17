// ============================================================
// Importa a la base local de envasados (src/data/packaged_cl.json) todos los productos de Open Food Facts de un país,
// con sus alérgenos interpretados (PackagedFoods.fromOff). Así el escáner reconoce los productos SIN depender de que
// OFF responda en ese momento (y con la información de calidad: NOVA, Nutri-Score, sodio, grasas saturadas…).
//
// Uso:  bun scripts/import_off_country.ts chile [argentina peru …]
// Respeta el límite de la API de búsqueda de OFF (~10 pedidos por minuto). Datos ODbL © contribuidores de OFF.
// ============================================================
import { bulkUpsert, fromOff, getByCode, packagedCount, type PackagedProduct } from "../src/services/PackagedFoods.ts";

const UA = "Eris-Health-App/1.0 (contact@axs-eris.app)";
const FIELDS = [
  "code", "product_name", "product_name_es", "brands", "nutriments", "serving_size", "serving_quantity", "quantity",
  "allergens_tags", "traces_tags", "ingredients_text", "ingredients_text_es", "states_tags", "labels_tags",
  "nova_group", "nutrition_grades", "ingredients_analysis_tags", "categories_tags",
].join(",");
const PAGE = 100; // máximo que entrega OFF por página
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Dos buscadores de OFF: "search-a-licious" (Elasticsearch, rápido y estable) y el clásico /api/v2/search (más
// productos, pero hoy responde 503 a menudo). Por defecto el nuevo; `--v2` usa el clásico.
const USE_V2 = process.argv.includes("--v2");
// `--from=N`: retomar desde la página N (si una corrida anterior se cortó)
const FROM = Math.max(1, Number(process.argv.find((a) => a.startsWith("--from="))?.slice(7)) || 1);

async function page(country: string, n: number): Promise<{ count: number; products: any[] } | null> {
  const url = USE_V2
    ? `https://world.openfoodfacts.org/api/v2/search?countries_tags_en=${encodeURIComponent(country)}&fields=${FIELDS}&page_size=${PAGE}&page=${n}&sort_by=unique_scans_n`
    : `https://search.openfoodfacts.org/search?q=${encodeURIComponent(`countries_tags:"en:${country}"`)}&fields=${FIELDS}&page_size=${PAGE}&page=${n}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        const d = await res.json() as any;
        return { count: Number(d.count) || 0, products: d.products ?? d.hits ?? [] };
      }
      console.warn(`  página ${n}: HTTP ${res.status}, reintento ${attempt}`);
    } catch (e) {
      console.warn(`  página ${n}: ${(e as Error).message}, reintento ${attempt}`);
    }
    await sleep(10000 * attempt);
  }
  return null; // se salta esa página: lo demás igual se importa (y se puede volver a correr, es idempotente)
}

/** search-a-licious entrega algunos campos con otra forma (marcas como lista, textos por idioma): se dejan como en /api/v2. */
function normalize(p: any): any {
  const out: any = { ...p };
  const text = (v: any) => (v && typeof v === "object" && !Array.isArray(v) ? v.es ?? v.main ?? Object.values(v)[0] : v);
  if (Array.isArray(out.brands)) out.brands = out.brands.join(",");
  for (const k of ["product_name", "product_name_es", "ingredients_text", "ingredients_text_es", "serving_size", "quantity"]) {
    const v = text(out[k]);
    out[k] = v == null ? undefined : String(v);
  }
  return out;
}

const countries = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!countries.length) { console.log("Uso: bun scripts/import_off_country.ts chile [argentina …] [--v2]"); process.exit(1); }
const before = packagedCount();
for (const country of countries) {
  const first = await page(country, 1);
  if (!first) { console.warn(`${country}: no pude leer la primera página, se omite`); continue; }
  const perPage = Math.max(1, first.products.length || PAGE);
  const pages = Math.ceil(first.count / perPage);
  console.log(`${country}: ${first.count} productos en OFF (${pages} páginas)`);
  let added = 0, updated = 0, skipped = 0;
  const failed: number[] = [];
  for (let n = FROM; n <= pages; n++) {
    const data = n === 1 ? first : await page(country, n);
    if (!data) { failed.push(n); continue; }
    const batch: PackagedProduct[] = [];
    for (const raw of data.products ?? []) {
      const p = normalize(raw);
      const rec = fromOff(p);
      if (!rec) { skipped++; continue; }
      if (getByCode(rec.code)) updated++; else added++;
      batch.push(rec);
    }
    bulkUpsert(batch);
    console.log(`  página ${n}/${pages}: +${batch.length} (nuevos ${added}, actualizados ${updated}, sin datos mínimos ${skipped})`);
    if (n < pages) await sleep(USE_V2 ? 7000 : 2500); // v2: < 10 pedidos/min
  }
  if (failed.length) console.warn(`  ${country}: páginas que no se pudieron leer: ${failed.join(", ")}`);
}
console.log(`Listo: ${before} → ${packagedCount()} productos en la base local.`);
