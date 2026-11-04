// ============================================================
// Construye src/data/chilean-foods.json (y la copia de la app) desde scripts/food_db_spec.ts con USDA FoodData
// Central. Las respuestas de USDA quedan en scripts/data/usda_cache.json: correrlo de nuevo no vuelve a consultar.
//
// Uso:  bun --env-file=.env scripts/build_food_db.ts [--dry]
//   --dry  muestra qué alimento de USDA eligió para cada descripción (para revisar) sin escribir nada
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { NEW_FOODS, ENRICH, ALIAS_MOVES, ALIAS_ADDS, CATALOG_SAME, MERGE_INTO, CATALOG_ALIAS_MOVES, MICRO_FROM, type FoodSpec, type RecipeSpec, type Ingredient } from "./food_db_spec.ts";

const ROOT = resolve(import.meta.dir, "..");
const OUT = [resolve(ROOT, "src/data/chilean-foods.json"), resolve(ROOT, "../eris-mobile/src/data/chilean-foods.json")];
const CACHE = resolve(ROOT, "scripts/data/usda_cache.json");
const DRY = process.argv.includes("--dry");
const KEY = process.env.USDA_API_KEY;
if (!KEY) { console.error("Falta USDA_API_KEY (bun --env-file=.env …)"); process.exit(1); }

interface Per100 { kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number; sodium: number; satFat: number }
interface Hit { fdcId: number; description: string; per100: Per100; score: number }

const cache: Record<string, Hit> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const saveCache = () => { mkdirSync(dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify(cache, null, 1)); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tokens = (s: string) => new Set(s.toLowerCase().replace(/\(includes[^)]*\)/g, "").match(/[a-z0-9%/]+/g) ?? []);
function similarity(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

function per100From(nutrients: any[]): Per100 {
  const v = (...ids: number[]) => {
    for (const id of ids) {
      const n = nutrients.find((x: any) => (x.nutrientId ?? x.nutrient?.id) === id);
      const val = n ? Number(n.value ?? n.amount) : NaN;
      if (Number.isFinite(val)) return val;
    }
    return 0;
  };
  return {
    kcal: v(1008, 2047, 2048), protein: v(1003), carbs: v(1005), fat: v(1004), fiber: v(1079),
    sugar: v(2000, 1063), sodium: v(1093), satFat: v(1258),
  };
}

// ─── Vitaminas y minerales (fase I5, 2026-10-23) ───────────────
// Por 100 g, con las claves del núcleo de suplementos (eris-mobile/src/services/supplements/supplementCore.ts). Se piden
// por fdcId a FDC (el detalle trae todos los nutrientes) y quedan en scripts/data/usda_micro_cache.json.
type Micro = Partial<Record<string, number>>;
const MICRO_IDS: Record<string, number[]> = {
  vA: [1106], vC: [1162], vD: [1114], vE: [1109], vK: [1185], b1: [1165], b2: [1166], b3: [1167], b6: [1175], b12: [1178],
  fol: [1190, 1177], ca: [1087], fe: [1089], mg: [1090], k: [1092], zn: [1095], p: [1091],
};
const MICRO_KEYS = Object.keys(MICRO_IDS);
const rm = (n: number) => (n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100);
function microFrom(nutrients: any[]): Micro {
  const val = (id: number) => {
    const n = nutrients.find((x: any) => (x.nutrientId ?? x.nutrient?.id) === id);
    const v = n ? Number(n.value ?? n.amount) : NaN;
    return Number.isFinite(v) ? v : undefined;
  };
  const out: Micro = {};
  for (const [k, ids] of Object.entries(MICRO_IDS)) for (const id of ids) { const v = val(id); if (v !== undefined) { out[k] = rm(v); break; } }
  // Vitamina D solo en UI en algunos alimentos: 40 UI = 1 µg
  if (out.vD === undefined) { const iu = val(1110); if (iu !== undefined) out.vD = rm(iu / 40); }
  return out;
}
const MCACHE = resolve(ROOT, "scripts/data/usda_micro_cache.json");
const mcache: Record<string, Micro> = existsSync(MCACHE) ? JSON.parse(readFileSync(MCACHE, "utf8")) : {};
async function microOf(fdcId: number): Promise<Micro> {
  const k = String(fdcId);
  if (mcache[k]) return mcache[k];
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${KEY}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const f: any = await res.json();
      mcache[k] = microFrom(f.foodNutrients ?? []);
      writeFileSync(MCACHE, JSON.stringify(mcache));
      return mcache[k];
    } catch { await sleep(3000 * attempt); }
  }
  throw new Error(`USDA no respondió el detalle de ${fdcId}`);
}
/** Micronutrientes por 100 g de una receta: cada uno solo si se conoce en ingredientes que suman ≥ 80 % del peso sólido. */
async function recipeMicro(recipe: Ingredient[], yieldG?: number): Promise<Micro> {
  const total: Record<string, number> = {}, known: Record<string, number> = {};
  let grams = 0, solid = 0;
  for (const [ing, g] of recipe) {
    grams += g;
    if (ing === "agua" || ing === "sal") continue;
    solid += g;
    const m = await microOf((await usda(ing)).fdcId);
    for (const k of MICRO_KEYS) if (m[k] !== undefined) { total[k] = (total[k] ?? 0) + (m[k]! * g) / 100; known[k] = (known[k] ?? 0) + g; }
  }
  const w = yieldG ?? grams;
  const out: Micro = {};
  for (const k of MICRO_KEYS) if (total[k] !== undefined && (known[k] ?? 0) >= 0.8 * solid) out[k] = rm((total[k] / w) * 100);
  return out;
}

const DATA_TYPES: Record<string, string[]> = { sr: ["SR Legacy"], fndds: ["Survey (FNDDS)"], foundation: ["Foundation"] };

async function usda(query: string | number, src = "sr"): Promise<Hit> {
  const key = `${src}|${query}`;
  if (cache[key]) return cache[key];
  let hit: Hit | null = null;
  for (let attempt = 1; attempt <= 4 && !hit; attempt++) {
    try {
      if (typeof query === "number") {
        const res = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${query}?api_key=${KEY}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const f: any = await res.json();
        hit = { fdcId: f.fdcId, description: f.description, per100: per100From(f.foodNutrients ?? []), score: 1 };
      } else {
        const res = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${KEY}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          // "/", "%" y comillas rompen el buscador de FDC: se buscan las palabras, se compara contra el nombre completo
          body: JSON.stringify({ query: query.replace(/[\/%"()]/g, " ").replace(/\s+/g, " ").trim(), dataType: DATA_TYPES[src] ?? DATA_TYPES.sr, pageSize: 50 }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const foods: any[] = ((await res.json()) as any).foods ?? [];
        if (!foods.length) throw new Error("sin resultados");
        const q = query.toLowerCase().trim();
        const exact = foods.find((f) => f.description.toLowerCase().trim() === q);
        const best = exact ?? foods.map((f) => ({ f, s: similarity(query, f.description) })).sort((a, b) => b.s - a.s)[0].f;
        hit = { fdcId: best.fdcId, description: best.description, per100: per100From(best.foodNutrients ?? []), score: exact ? 1 : similarity(query, best.description) };
      }
    } catch (e) {
      if ((e as Error).message === "sin resultados") throw new Error(`USDA no encontró «${query}»`);
      await sleep(3000 * attempt);
    }
  }
  if (!hit) throw new Error(`USDA no respondió para «${query}»`);
  cache[key] = hit;
  saveCache();
  return hit;
}

const SALT: Per100 = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 38758, satFat: 0 };
const ZERO: Per100 = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0, satFat: 0 };
const KEYS = Object.keys(ZERO) as (keyof Per100)[];

const warnings: string[] = [];
const picks: string[] = [];

async function per100Of(spec: FoodSpec): Promise<{ per100: Per100; ref: string }> {
  if ("usda" in spec) {
    const h = await usda(spec.usda, spec.src);
    picks.push(`${h.score < 1 ? (h.score < 0.6 ? "⚠️ " : "~  ") : "   "}${spec.id}: «${spec.usda}» → ${h.fdcId} ${h.description}`);
    if (h.score < 0.6) warnings.push(`${spec.id}: coincidencia dudosa «${h.description}»`);
    return { per100: h.per100, ref: `USDA FDC ${h.fdcId}` };
  }
  const r = spec as RecipeSpec;
  const total: Per100 = { ...ZERO };
  let grams = 0;
  for (const [ing, g] of r.recipe) {
    const p = ing === "sal" ? SALT : ing === "agua" ? ZERO : (await usda(ing)).per100;
    if (ing !== "sal" && ing !== "agua") {
      const h = await usda(ing);
      if (h.score < 0.6) warnings.push(`${spec.id}: ingrediente dudoso «${ing}» → «${h.description}»`);
      picks.push(`${h.score < 1 ? (h.score < 0.6 ? "⚠️ " : "~  ") : "   "}${spec.id} ⟵ «${ing}» → ${h.fdcId} ${h.description}`);
    }
    for (const k of KEYS) total[k] += (p[k] * g) / 100;
    grams += g;
  }
  const w = r.yield ?? grams;
  const per100 = Object.fromEntries(KEYS.map((k) => [k, (total[k] / w) * 100])) as unknown as Per100;
  return { per100, ref: "receta casera (ingredientes USDA FDC)" };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
function portion(desc: string, grams: number, p: Per100, liquid?: boolean) {
  const k = grams / 100;
  return {
    description: `${desc} (${grams}${liquid ? "ml" : "g"})`, grams,
    calories: Math.round(p.kcal * k), carbs: r1(p.carbs * k), protein: r1(p.protein * k), fat: r1(p.fat * k),
    fiber: r1(p.fiber * k), sugar: r1(p.sugar * k), sodium: Math.round(p.sodium * k), satFat: r1(p.satFat * k),
  };
}

// ─── Construcción ──────────────────────────────────────────────
const existing: any[] = JSON.parse(readFileSync(OUT[0], "utf8"));
const ids = new Set(existing.map((f) => f.id));

// 1) Lo que ya estaba: grupo, procesamiento, bebida, sodio y grasa saturada (sin tocar calorías ni macros)
for (const f of existing) {
  // Alias que ahora son otro alimento (o que se suman): también en lo que se agregó después del primer enriquecimiento
  const drop = new Set((ALIAS_MOVES[f.id] ?? []).map((a) => a.toLowerCase()));
  f.aliases = [...new Set([...(f.aliases ?? []).filter((a: string) => !drop.has(a.toLowerCase())), ...(ALIAS_ADDS[f.id] ?? [])])];
  const e = ENRICH[f.id];
  if (!e) continue; // agregado desde NEW_FOODS: ya tiene grupo, procesamiento, sodio y grasa saturada
  f.group = e.group; f.nova = e.nova;
  if (e.liquid) f.liquid = true;
  let sodium100 = e.sodium100, satFat100 = e.satFat100;
  if (e.usda) {
    const h = await usda(e.usda);
    picks.push(`${h.score < 1 ? (h.score < 0.6 ? "⚠️ " : "~  ") : "   "}${f.id} (sodio/sat): «${e.usda}» → ${h.fdcId} ${h.description}`);
    if (h.score < 0.6) warnings.push(`${f.id}: coincidencia dudosa «${h.description}»`);
    sodium100 = h.per100.sodium; satFat100 = h.per100.satFat;
  }
  for (const s of [f.serving, ...(f.alt ?? [])]) {
    if (sodium100 !== undefined) s.sodium = Math.round((sodium100 * s.grams) / 100);
    if (satFat100 !== undefined) s.satFat = r1((satFat100 * s.grams) / 100);
  }
}

// Catálogo del asesor metabólico: lo nuevo que ya tenía se alinea a su id y nombre; sus alias que ahora son otro alimento se sacan
const CATALOG_PATH = resolve(ROOT, "src/data/food_catalog.json");
const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
const catById = new Map<string, any>(catalog.items.map((c: any) => [c.id, c]));
for (const [cid, drop] of Object.entries(CATALOG_ALIAS_MOVES)) {
  const c = catById.get(cid);
  if (!c) { warnings.push(`catálogo sin «${cid}»`); continue; }
  const d = new Set(drop.map((a) => a.toLowerCase()));
  c.aliases = (c.aliases ?? []).filter((a: string) => !d.has(a.toLowerCase()));
}

// 2) Lo nuevo
const added: any[] = [];
for (const raw of NEW_FOODS) {
  // Fusionado en otro (pan de completo → pan de hamburguesa / hot dog): solo aporta sus alias
  if (MERGE_INTO[raw.id]) continue;
  const extraAliases = NEW_FOODS.filter((x) => MERGE_INTO[x.id] === raw.id).flatMap((x) => [x.name, ...(x.aliases ?? [])]);
  const cat = CATALOG_SAME[raw.id] ? catById.get(CATALOG_SAME[raw.id]) : undefined;
  if (CATALOG_SAME[raw.id] && !cat) warnings.push(`${raw.id}: el catálogo no tiene «${CATALOG_SAME[raw.id]}»`);
  // La porción del catálogo va primero: es la que ya entendía el registro por chat ("1 lata de jurel")
  const catServing = cat?.portion && cat.grams ? [[String(cat.portion).replace(/\s*\(.*$/, "").trim(), Number(cat.grams)] as [string, number]] : [];
  const spec: FoodSpec = cat
    ? {
        ...raw, id: `cl:${cat.id}`, name: cat.name,
        aliases: [...new Set([...(cat.aliases ?? []), raw.name, ...(raw.aliases ?? []), ...extraAliases])].filter((a) => a.toLowerCase() !== cat.name.toLowerCase()),
        servings: [...catServing, ...raw.servings.filter(([d]) => !catServing.some(([cd]) => cd === d))],
      }
    : { ...raw, aliases: [...new Set([...(raw.aliases ?? []), ...extraAliases])] };
  if (ids.has(spec.id)) { warnings.push(`${spec.id}: ya existe, se omite`); continue; }
  const { per100, ref } = await per100Of(spec);
  const atwater = 4 * per100.protein + 4 * per100.carbs + 9 * per100.fat;
  if (per100.kcal > 20 && spec.group !== "alcohol" && Math.abs(atwater - per100.kcal) / per100.kcal > 0.25) {
    warnings.push(`${spec.id}: kcal ${Math.round(per100.kcal)} vs macros ${Math.round(atwater)} — revisar`);
  }
  const servings = spec.servings.map(([d, g]) => portion(d, g, per100, spec.liquid));
  const entry: any = {
    id: spec.id, name: spec.name, aliases: spec.aliases ?? [], category: spec.category,
    group: spec.group, nova: spec.nova, ...(spec.liquid ? { liquid: true } : {}),
    serving: servings[0],
    alt: [portion("100", 100, per100, spec.liquid), ...servings.slice(1)].map((s, i) => (i === 0 ? { ...s, description: spec.liquid ? "100ml" : "100g" } : s)),
    ref,
  };
  added.push(entry);
  ids.add(spec.id);
}

// 3) Vitaminas y minerales de TODOS (lo de antes y lo nuevo), sin tocar calorías ni macros
const specById = new Map<string, FoodSpec>();
for (const raw of NEW_FOODS) specById.set(CATALOG_SAME[raw.id] ? `cl:${CATALOG_SAME[raw.id]}` : raw.id, raw);
let withMicro = 0;
for (const f of [...existing, ...added]) {
  let micro: Micro | null = null;
  const fdc = /USDA FDC (\d+)/.exec(f.ref ?? "");
  const spec = specById.get(f.id);
  const mf = MICRO_FROM[f.id];
  try {
    if (fdc) micro = await microOf(Number(fdc[1]));
    else if (spec && "recipe" in spec) micro = await recipeMicro(spec.recipe, spec.yield);
    else if (ENRICH[f.id]?.usda !== undefined) micro = await microOf((await usda(ENRICH[f.id].usda!)).fdcId);
    else if (mf) micro = "recipe" in mf ? await recipeMicro(mf.recipe, mf.yield) : await microOf((await usda(mf.usda, mf.src)).fdcId);
  } catch (e) { warnings.push(`${f.id}: sin vitaminas (${(e as Error).message})`); }
  if (micro && Object.keys(micro).length) { f.micro = micro; withMicro++; } else { delete f.micro; if (!micro) warnings.push(`${f.id}: sin vitaminas ni minerales`); }
}
console.log(`Vitaminas y minerales: ${withMicro} de ${existing.length + added.length}`);

// Alias repetidos entre alimentos distintos (base + catálogo): la búsqueda no sabría cuál elegir
const owner = new Map<string, string>();
const catAsFoods = catalog.items.map((c: any) => ({ id: `cl:${c.id}`, name: c.name, aliases: c.aliases }));
for (const f of [...existing, ...added, ...catAsFoods]) {
  for (const a of [f.name, ...(f.aliases ?? [])].map((x: string) => x.toLowerCase())) {
    if (owner.has(a) && owner.get(a) !== f.id) warnings.push(`alias repetido «${a}»: ${owner.get(a)} y ${f.id}`);
    else owner.set(a, f.id);
  }
}

console.log(picks.join("\n"));
console.log(`\n${existing.length} existentes enriquecidos + ${added.length} nuevos = ${existing.length + added.length}`);
if (warnings.length) console.log(`\nRevisar:\n  ${warnings.join("\n  ")}`);
if (!DRY) {
  const all = [...existing, ...added];
  const text = `[\n${all.map((f) => `  ${JSON.stringify(f)}`).join(",\n")}\n]\n`;
  for (const p of OUT) writeFileSync(p, text);
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 1) + "\n");
  console.log(`\nEscrito en:\n  ${[...OUT, CATALOG_PATH].join("\n  ")}`);
}
