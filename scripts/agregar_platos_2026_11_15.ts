// ============================================================
// Platos comunes que faltaban en la base (2026-11-15, banco de platos dichos en el chat): se calculan con la MISMA cuenta
// que scripts/build_food_db.ts (suma de ingredientes USDA por 100 g, de la caché, sin internet) y se agregan al final de
// src/data/chilean-foods.json y de la copia de la app. Correr build_food_db entero reescribía las 546 entradas; esto solo
// agrega estas. Las recetas también quedan en food_db_spec.ts (NEW_FOODS) para el próximo armado completo.
//   bun scripts/agregar_platos_2026_11_15.ts           → muestra lo que agregaría
//   bun scripts/agregar_platos_2026_11_15.ts --aplicar → lo escribe (si ya están, no hace nada)
// ============================================================
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PLATOS_2026_11_15 } from "./food_db_spec.ts";

const ROOT = resolve(import.meta.dir, "..");
const cache = JSON.parse(readFileSync(resolve(ROOT, "scripts/data/usda_cache.json"), "utf8"));
const mcache = JSON.parse(readFileSync(resolve(ROOT, "scripts/data/usda_micro_cache.json"), "utf8"));
const OUT = [resolve(ROOT, "src/data/chilean-foods.json"), resolve(ROOT, "../eris-mobile/src/data/chilean-foods.json")];
const KEYS = ["kcal", "protein", "carbs", "fat", "fiber", "sugar", "sodium", "satFat"] as const;
const MICRO = ["vA", "vC", "vD", "vE", "vK", "b1", "b2", "b3", "b6", "b12", "fol", "ca", "fe", "mg", "k", "zn", "p"];
const SALT = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 38758, satFat: 0 };
const r1 = (n: number) => Math.round(n * 10) / 10;
const rm = (n: number) => (n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100);
const hit = (ing: string) => { const h = cache[`sr|${ing}`]; if (!h) throw new Error(`no está en la caché: ${ing}`); return h; };

function calcular(spec: any) {
  const total: Record<string, number> = Object.fromEntries(KEYS.map((k) => [k, 0]));
  const mt: Record<string, number> = {}, known: Record<string, number> = {};
  let grams = 0, solid = 0;
  for (const [ing, g] of spec.recipe as Array<[string, number]>) {
    grams += g;
    const p = ing === "sal" ? SALT : hit(ing).per100;
    for (const k of KEYS) total[k] += (p[k] * g) / 100;
    if (ing === "sal") continue;
    solid += g;
    const m = mcache[String(hit(ing).fdcId)] ?? {};
    for (const k of MICRO) if (m[k] !== undefined) { mt[k] = (mt[k] ?? 0) + (m[k] * g) / 100; known[k] = (known[k] ?? 0) + g; }
  }
  const per100 = Object.fromEntries(KEYS.map((k) => [k, (total[k] / grams) * 100])) as Record<string, number>;
  const portion = (desc: string, g: number) => {
    const k = g / 100;
    return { description: `${desc} (${g}g)`, grams: g, calories: Math.round(per100.kcal * k), carbs: r1(per100.carbs * k), protein: r1(per100.protein * k),
      fat: r1(per100.fat * k), fiber: r1(per100.fiber * k), sugar: r1(per100.sugar * k), sodium: Math.round(per100.sodium * k), satFat: r1(per100.satFat * k) };
  };
  const micro: Record<string, number> = {};
  for (const k of MICRO) if (mt[k] !== undefined && (known[k] ?? 0) >= 0.8 * solid) micro[k] = rm((mt[k] / grams) * 100);
  const [desc, g] = spec.servings[0];
  return {
    id: spec.id, name: spec.name, aliases: spec.aliases, category: spec.category, group: spec.group, nova: spec.nova,
    serving: portion(desc, g), alt: [portion("100g", 100)], ref: "receta casera (ingredientes USDA FDC)", ...(Object.keys(micro).length ? { micro } : {}),
  };
}

const nuevos = PLATOS_2026_11_15.map(calcular);
for (const f of nuevos) console.log(`${f.id}: ${f.serving.description} → ${f.serving.calories} kcal · C ${f.serving.carbs} · P ${f.serving.protein} · G ${f.serving.fat}`);
if (process.argv.includes("--aplicar")) {
  for (const p of OUT) {
    const txt = readFileSync(p, "utf8");
    const ya = new Set((JSON.parse(txt) as any[]).map((f) => f.id));
    const faltan = nuevos.filter((f) => !ya.has(f.id));
    if (!faltan.length) { console.log(`${p}: ya estaban`); continue; }
    const fin = txt.lastIndexOf("]");
    const antes = txt.slice(0, fin).replace(/\s+$/, "");
    writeFileSync(p, `${antes},\n${faltan.map((f) => `  ${JSON.stringify(f)}`).join(",\n")}\n]\n`);
    JSON.parse(readFileSync(p, "utf8")); // sigue siendo JSON válido
    console.log(`${p}: +${faltan.length}`);
  }
}
