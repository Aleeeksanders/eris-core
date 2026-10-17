// ============================================================
// Eris — búsqueda por código de barras, en cascada
//
// Antes el teléfono solo le preguntaba a Open Food Facts y, si el producto no tenía las calorías cargadas (muy común:
// vienen en kJ o faltan), lo daba por "no encontrado". Ahora:
//   1. base local (packaged_cl.json): productos de OFF importados de Chile + los que el usuario cargó a mano
//   2. Open Food Facts, probando las variantes del código (EAN-13 ↔ UPC-A con o sin 0 adelante, GTIN-14)
//   3. USDA FoodData Central (productos con GTIN, varios importados)
//   4. UPCitemdb: solo NOMBRE y marca, para que el usuario complete la tabla nutricional del envase
// Lo que se encuentra afuera se aprende (queda en la base local para la próxima vez).
// ============================================================
import { getByCode, learnFromOff, scanText, upsert, type PackagedProduct } from "./PackagedFoods.js";

const UA = "Eris-Health-App/1.0 (contact@axs-eris.app)";
const OFF_FIELDS = "code,product_name,product_name_es,brands,nutriments,serving_size,serving_quantity,quantity,allergens_tags,traces_tags,ingredients_text,ingredients_text_es,states_tags,labels_tags,nova_group,nutrition_grades,ingredients_analysis_tags,categories_tags";

export interface BarcodeHit {
  found: boolean;
  /** de dónde salió */
  source?: "local" | "usuario" | "off" | "usda" | "nombre";
  product?: PackagedProduct;
  /** solo se conoce el nombre (y quizá la marca): el usuario completa la tabla nutricional */
  nameOnly?: { name: string; brand?: string };
  code: string;
}

/** Variantes del mismo código: EAN-13 / UPC-A (12) / GTIN-14 con ceros a la izquierda. */
export function codeVariants(raw: string): string[] {
  const c = String(raw || "").replace(/\D/g, "");
  if (!c) return [];
  const out = new Set<string>([c]);
  const stripped = c.replace(/^0+/, "");
  if (stripped.length >= 8) out.add(stripped);
  for (const len of [12, 13, 14]) if (stripped.length < len) out.add(stripped.padStart(len, "0"));
  return [...out];
}

/** Dígito verificador GS1 (EAN-8/UPC-A/EAN-13/GTIN-14): un código mal leído no se manda a buscar nombres afuera. */
export function validGtin(raw: string): boolean {
  const c = String(raw || "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(c.length)) return false;
  const digits = c.slice(0, -1).split("").map(Number).reverse();
  const sum = digits.reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(c.at(-1));
}

const timeout = (ms: number) => { const ac = new AbortController(); setTimeout(() => ac.abort(), ms); return ac.signal; };

async function offLookup(code: string): Promise<{ product?: PackagedProduct; nameOnly?: { name: string; brand?: string } } | null> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`, { headers: { "User-Agent": UA }, signal: timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (data.status !== 1 || !data.product) return null;
    const p = { ...data.product, code: data.product.code || code };
    const learned = learnFromOff(p);
    if (learned) return { product: learned };
    const name = (p.product_name_es || p.product_name || "").trim();
    return name ? { nameOnly: { name, brand: p.brands?.split(",")[0]?.trim() || undefined } } : null;
  } catch { return null; }
}

async function usdaLookup(code: string): Promise<PackagedProduct | null> {
  const key = process.env.USDA_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: timeout(8000),
      body: JSON.stringify({ query: code, dataType: ["Branded"], pageSize: 5 }),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const f = (data.foods ?? []).find((x: any) => String(x.gtinUpc || "").replace(/^0+/, "") === code.replace(/^0+/, ""));
    if (!f) return null;
    const val = (id: number) => { const n = (f.foodNutrients ?? []).find((x: any) => x.nutrientId === id); return n ? Number(n.value) : undefined; };
    const kcal = val(1008), protein = val(1003), carbs = val(1005), fat = val(1004);
    if (kcal === undefined || protein === undefined || carbs === undefined || fat === undefined) return null;
    const name = String(f.description || "").trim();
    const rec: PackagedProduct = {
      code, name: name.charAt(0) + name.slice(1).toLowerCase(), brand: f.brandName || f.brandOwner || undefined,
      servingG: f.servingSizeUnit === "g" && f.servingSize ? Math.round(f.servingSize) : undefined,
      servingText: f.householdServingFullText || undefined,
      per100: {
        kcal: Math.round(kcal), protein: r1(protein), carbs: r1(carbs), fat: r1(fat), fiber: r1(val(1079) ?? 0),
        sugar: val(2000) !== undefined ? r1(val(2000)!) : undefined, sodiumMg: val(1093) !== undefined ? Math.round(val(1093)!) : undefined,
        satFat: val(1258) !== undefined ? r1(val(1258)!) : undefined,
      },
      ingredients: f.ingredients ? String(f.ingredients).slice(0, 600) : undefined,
      ingredientsComplete: false, allergens: scanText(`${name} ${f.ingredients || ""}`), traces: [], verifiedFor: [],
      source: "off",
    };
    upsert(rec);
    return rec;
  } catch { return null; }
}

async function nameLookup(code: string): Promise<{ name: string; brand?: string } | null> {
  try {
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`, { headers: { "User-Agent": UA }, signal: timeout(6000) });
    if (!res.ok) return null;
    const it = ((await res.json()) as any).items?.[0];
    return it?.title ? { name: String(it.title).slice(0, 80), brand: it.brand || undefined } : null;
  } catch { return null; }
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function lookupBarcode(raw: string): Promise<BarcodeHit> {
  const variants = codeVariants(raw);
  const code = variants[0] ?? String(raw);
  for (const v of variants) {
    const p = getByCode(v);
    if (p) return { found: true, source: p.source === "usuario" ? "usuario" : "local", product: p, code };
  }
  // Todo en paralelo (antes era en serie: el peor caso pasaba de 40 s y el teléfono se aburría de esperar). Se
  // respeta la prioridad al elegir: OFF (más completo, con alérgenos) > USDA > solo el nombre.
  const [offs, usda] = await Promise.all([
    Promise.all(variants.map(offLookup)),
    Promise.all(variants.slice(0, 2).map(usdaLookup)),
  ]);
  const off = offs.find((r) => r?.product);
  if (off?.product) return { found: true, source: "off", product: off.product, code };
  const u = usda.find(Boolean);
  if (u) return { found: true, source: "usda", product: u, code };
  // UPCitemdb (cupo diario chico) solo cuando nadie tiene la tabla: al menos el nombre para que el usuario la complete
  const nameOnly = offs.find((r) => r?.nameOnly)?.nameOnly ?? (validGtin(code) && code.replace(/^0+/, "").length >= 8 ? await nameLookup(code) : null) ?? undefined;
  return { found: false, code, ...(nameOnly ? { source: "nombre" as const, nameOnly } : {}) };
}

/**
 * Producto cargado a mano desde la app (tabla nutricional del envase). Queda en la base local para todos los perfiles
 * de este servidor. Fail-closed: sin lista de ingredientes verificada, no se recomienda a nadie con restricciones.
 */
export function contributeProduct(input: {
  code: string; name: string; brand?: string; servingG?: number;
  per100: { kcal: number; protein: number; carbs: number; fat: number; fiber?: number; sugar?: number; sodiumMg?: number; satFat?: number };
  ingredients?: string;
}): PackagedProduct | null {
  const code = codeVariants(input.code)[0];
  const name = String(input.name || "").trim().slice(0, 80);
  const p = input.per100;
  const ok = (n: unknown, max: number) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;
  if (!code || !name || !ok(p?.kcal, 900) || !ok(p?.protein, 100) || !ok(p?.carbs, 100) || !ok(p?.fat, 100)) return null;
  const ingredients = String(input.ingredients || "").trim().slice(0, 600) || undefined;
  const rec: PackagedProduct = {
    code, name, brand: input.brand?.trim() || undefined,
    servingG: ok(input.servingG, 2000) && input.servingG! > 0 ? Math.round(input.servingG!) : undefined,
    per100: {
      kcal: Math.round(p.kcal), protein: r1(p.protein), carbs: r1(p.carbs), fat: r1(p.fat), fiber: r1(ok(p.fiber, 100) ? p.fiber! : 0),
      sugar: ok(p.sugar, 100) ? r1(p.sugar!) : undefined, sodiumMg: ok(p.sodiumMg, 40000) ? Math.round(p.sodiumMg!) : undefined,
      satFat: ok(p.satFat, 100) ? r1(p.satFat!) : undefined,
    },
    ingredients, ingredientsComplete: false,
    allergens: scanText(`${name} ${ingredients || ""}`), traces: [], verifiedFor: [],
    source: "usuario",
  };
  upsert(rec);
  return rec;
}
