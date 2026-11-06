// ============================================================
// Eris — la sugerencia concreta de un aviso
//
// 2026-10-14: los avisos decían "te faltan ~35 g de proteína… ¿te doy opciones?" y para ver una opción había que abrir el
// chat. Ahora el aviso ya trae UNA comida concreta, elegida por código (nunca por la IA, así no inventa cifras y funciona
// aunque el chat esté apagado):
//   - restricciones alimentarias, fail-closed (lo que no se puede confirmar, no se sugiere)
//   - condiciones de salud: lo que su condición desaconseja NO se sugiere en un aviso (en el chat sí, con advertencia)
//   - presupuesto de comida del mes (Finanzas), objetivo de Forge y lo que queda de calorías del día
//   - despensa reciente y lo que la persona suele comer
// Si no hay una opción limpia, no se sugiere nada y el aviso queda como antes. El texto es fijo (plantillas): lo que dice
// cada alimento sale del catálogo.
// ============================================================

import { FOODS, NEVER_RECOMMEND, PROCESSED, conditionPenalty, matchFoods, loadFoodAffinity, unparsedAllergyIds, type CatalogFood } from "./MealRecommender.js";
import { isAllowed } from "./DietaryRestrictions.js";
import { gatherMetabolicContext, type MetabolicContext } from "./MetabolicAnalysis.js";
import { waterFraction } from "./FoodWater.js";
import type { Affinity } from "./CarbOptions.js";
import { DEFAULT_TONE, getTone, isTone, type Tone } from "./Tone.js";
import { homePantry } from "./HomePantry.js";

export type NudgeNeed = "fibra" | "proteina" | "colacion";
export const NUDGE_NEEDS: NudgeNeed[] = ["fibra", "proteina", "colacion"];

export interface NudgeRequest {
  need: NudgeNeed;
  /** gramos que faltan (de fibra o de proteína) */
  gapG?: number;
  /** proteína para la cena, no para una colación */
  forDinner?: boolean;
  /** lo anotado hoy en el teléfono (más al día que el servidor) */
  eaten?: { kcal?: number };
  /** cómo habla Eris (services/Tone.ts); sin dato, el que eligió la persona o cercano y directo */
  tone?: Tone;
}

export interface NudgeSuggestion {
  id: string; name: string; grams: number; kcal: number; protein: number; fiber: number;
  /** la frase del aviso, lista para mostrar */
  text: string;
}

export interface NudgeOptions {
  /** objetivo de Forge: perder | recomp | mantener | ganar */
  goal?: string;
  affinity?: Map<string, Affinity>;
  /** lo que dijo tener en casa en los últimos días (ids del catálogo) */
  pantryIds?: Set<string>;
  /** para variar entre opciones parecidas de un día a otro (y no sugerir siempre lo mismo) */
  dayIndex?: number;
}

// ─── Qué se puede sugerir ────────────────────────────────────────────────────
// Una colación se come tal cual: nada que haya que cocinar, ni bebidas (ya suman como agua), ni cosas que solas no son
// una colación (limón, parmesano, queso crema, mantequilla de maní, media palta sin pan).
const SNACK_SKIP = new Set(["limon", "queso_parmesano", "queso_crema", "mantequilla_mani", "palta", "leche_entera", "leche_descremada"]);
const snackPool = () => FOODS.filter((f) => !SNACK_SKIP.has(f.id) && f.prep !== "cocinar" && !["bebida", "aderezo", "plato"].includes(f.role)
  && (f.moments.includes("colacion") || f.role === "fruta" || f.role === "lacteo"));
// Para la cena: una proteína de verdad (no un suplemento)
const dinnerPool = () => FOODS.filter((f) => (f.role === "proteina" || f.role === "legumbre") && f.protein >= 10 && f.id !== "proteina_whey");

// Lo que cualquiera tiene a mano o compra en el súper. Lo menos habitual (hígado, pulpo, edamame, chirimoya…) solo se
// sugiere si la persona ya lo come o lo tiene en casa: un aviso que propone algo que no hay en la casa no ayuda.
const EVERYDAY_SNACK = new Set(["manzana", "pera", "platano", "naranja", "durazno", "frutilla", "uva", "kiwi", "sandia", "melon", "pina", "damasco",
  "ciruela", "almendras", "nueces", "mani", "semillas_maravilla", "yogur_natural", "yogur_griego", "yogur_descremado", "quesillo", "queso_gauda",
  "queso_cottage", "huevo_cocido", "pasas", "ciruela_pasa"]);
const EVERYDAY_DINNER = new Set(["pechuga_plancha", "pollo_muslo_sin_piel", "muslo_pollo", "pavo_pechuga", "merluza", "salmon", "congrio", "trucha",
  "tilapia", "bacalao", "atun_agua", "atun_aceite", "jurel_lata", "vacuno_posta", "vacuno_filete", "bife_vacuno", "vacuno_molida_magra",
  "lomo_cerdo", "lentejas", "porotos", "garbanzos", "porotos_negros", "tofu"]);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Cuántas kcal puede tener la colación: una parte de lo que queda del día, con techo según el objetivo. */
function snackCap(left: number, goal?: string): number {
  const hi = goal === "perder" ? 170 : goal === "ganar" ? 320 : 250;
  if (!(left > 0)) return 100;
  return clamp(left * 0.4, 100, hi);
}

/** Menor es mejor; null = no sirve para esto. */
function fit(f: CatalogFood, req: NudgeRequest, cap: number, goal?: string): number | null {
  if (f.kcal > cap * 1.6) return null; // demasiado para lo que queda del día
  const over = f.kcal > cap ? ((f.kcal - cap) / cap) * 1.5 : 0;
  if (req.need === "fibra") {
    if (f.fiber < 2.5) return null;
    const target = clamp(req.gapG ?? 5, 3, 8);
    return Math.abs(f.fiber - target) / target + over + (goal === "perder" ? f.kcal / 400 : 0);
  }
  if (req.need === "proteina") {
    if (f.protein < (req.forDinner ? 15 : 6)) return null;
    const target = req.forDinner ? clamp(req.gapG ?? 30, 15, 40) : clamp(req.gapG ?? 12, 8, 20);
    return Math.abs(f.protein - target) / target + over + (req.forDinner && goal === "perder" ? f.kcal / 800 : 0);
  }
  // Colación: que sostenga (proteína o fibra) sin pasarse
  const sustain = Math.min(1, f.protein / 10) + Math.min(1, f.fiber / 4);
  if (sustain < 0.5) return null;
  return 1 - sustain / 2 + over + (f.kcal < 70 ? 0.3 : 0);
}

// ─── La frase ────────────────────────────────────────────────────────────────

const FEM_UNITS = new Set(["taza", "tajada", "loncha", "lata", "presa", "pechuga", "porción", "porcion", "cucharada", "rebanada"]);
const SIZE_WORD = /^(mediana|mediano|grande|chica|chico|pequeña|pequeño|unidad|unidades)$/;
const n1 = (x: number) => (Math.round(x * 10) / 10).toString().replace(".", ",");
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const cleanName = (f: CatalogFood) => f.name.split(" / ")[0].replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const isFem = (word: string) => /a$/.test(word);
const plural = (w: string) => (/[aeiouáéíóú]$/.test(w) ? `${w}s` : `${w}es`);

/** "1 puñado (30g)" de almendras → "un puñado de almendras (30 g)"; "1 mediana (170g)" de pera → "una pera (170 g)". */
export function portionPhrase(f: CatalogFood): string {
  const name = cleanName(f);
  const head = name.split(" ")[0];
  const g = `${f.grams} ${/\bml\b/i.test(f.portion) ? "ml" : "g"}`;
  const m = f.portion.trim().match(/^(\d+|½|1\/2|1\/4)\s+([^(]+?)\s*\(/);
  if (!m) return `${g} de ${name}`;
  const q = m[1] === "½" || m[1] === "1/2" ? 0.5 : m[1] === "1/4" ? 0.25 : Number(m[1]);
  const unitRaw = m[2].trim();
  const unit = unitRaw.split(/\s+/)[0].toLowerCase();
  if (SIZE_WORD.test(unit) || unit === head) {
    // La porción ES el alimento: "1 mediana" (pera), "1 unidad grande" (huevo), "½ palta", "1 muslo" (muslo de pollo)
    if (q === 1) return `${isFem(head) ? "una" : "un"} ${name} (${g})`;
    if (q === 0.5) return `${isFem(head) ? "media" : "medio"} ${name} (${g})`;
    if (/s$/.test(head)) return `${q} ${name} (${g})`;
    return name.includes(" ") ? `${q} unidades de ${name} (${g})` : `${q} ${plural(name)} (${g})`;
  }
  const fem = FEM_UNITS.has(unit);
  if (q === 1) return `${fem ? "una" : "un"} ${unitRaw} de ${name} (${g})`;
  if (q === 0.5) return `${fem ? "media" : "medio"} ${unitRaw} de ${name} (${g})`;
  if (q === 0.25) return `un cuarto de ${unitRaw} de ${name} (${g})`;
  return `${q} ${unitRaw} de ${name} (${g})`;
}

const NUTS = new Set(["almendras", "nueces", "mani", "pistachos", "avellanas", "castana_caju"]);
const SEEDS_DRIED = new Set(["semillas_maravilla", "semillas_zapallo", "datiles", "pasas", "ciruela_pasa"]);
const PEEL = new Set(["pera", "manzana", "durazno"]);

/** Un dato útil (y cierto) para acompañar la sugerencia, en el tono de la persona. */
function tipFor(f: CatalogFood, need: NudgeNeed, tone: Tone): string {
  const usted = tone === "usted";
  const drink = usted ? "Acompáñelo con un vaso de agua." : tone === "brigida" ? "Y un vaso de agua, sin cuento." : "Acompáñalo con un vaso de agua.";
  if (NUTS.has(f.id)) return tone === "humor" ? "Eso sí, acompáñalo con agua, que por algo se llaman frutos secos 🫰🏻" : drink;
  if (SEEDS_DRIED.has(f.id)) return drink;
  if (PEEL.has(f.id) && need !== "proteina") return `Con cáscara, que ahí va buena parte de la fibra${tone === "humor" ? " 😉" : "."}`;
  if (need === "fibra") {
    const wf = waterFraction({ calories: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, fiber: f.fiber });
    if (wf !== null && wf < 0.5) return `${usted ? "Acompáñelo" : "Acompáñalo"} con agua: la fibra funciona mejor con líquido.`;
  }
  return "";
}

function lineFor(f: CatalogFood, req: NudgeRequest, tone: Tone): string {
  const p = portionPhrase(f);
  const da = tone === "usted" ? "le aporta" : "te da";
  if (req.need === "fibra") return `${cap1(p)} ${da} ~${n1(f.fiber)} g de fibra.`;
  if (req.need === "proteina") return req.forDinner
    ? `En la cena, ${p} ${da} ~${Math.round(f.protein)} g de proteína.`
    : `${cap1(p)} ${da} ~${Math.round(f.protein)} g de proteína.`;
  const extra = f.protein >= 6 ? ` y ${Math.round(f.protein)} g de proteína` : f.fiber >= 2.5 ? ` y ${n1(f.fiber)} g de fibra` : "";
  return `${cap1(p)}: ~${Math.round(f.kcal / 5) * 5} kcal${extra}.`;
}

// ─── La sugerencia ───────────────────────────────────────────────────────────

export function suggestNudge(ctx: MetabolicContext, req: NudgeRequest, opts: NudgeOptions = {}): NudgeSuggestion | null {
  const eatenKcal = typeof req.eaten?.kcal === "number" && Number.isFinite(req.eaten.kcal) && req.eaten.kcal >= 0 ? req.eaten.kcal : ctx.eaten.kcal;
  const dinner = req.need === "proteina" && !!req.forDinner;
  const cap = dinner ? Infinity : snackCap(ctx.goals.kcal - eatenKcal, opts.goal);

  // 1) Restricciones (fail-closed), lo que Eris nunca recomienda y lo nombrado en alergias sin reconocer ("alergia al kiwi")
  const unknownAllergy = unparsedAllergyIds(ctx.restrictions);
  const base = (dinner ? dinnerPool() : snackPool()).filter((f) => !NEVER_RECOMMEND.has(f.id) && !unknownAllergy.has(f.id) && isAllowed(f, ctx.restrictions).ok);
  // 2) Presupuesto del mes: si viene apretado, lo más económico (si no queda nada, sin filtro)
  const tier = ctx.budget?.tier;
  const byBudget = tier && tier < 3 ? base.filter((f) => f.priceTier <= tier) : base;
  const pool = byBudget.length ? byBudget : base;

  const scored: Array<{ f: CatalogFood; s: number; aff: number; inPantry: boolean }> = [];
  for (const f of pool) {
    // 3) Condiciones de salud: en un aviso nunca algo que su condición desaconseja
    const cp = conditionPenalty(f, ctx, { closeToWorkout: false });
    if (cp.hard) continue;
    const s = fit(f, req, cap, opts.goal);
    if (s === null) continue;
    const aff = opts.affinity?.get(f.id)?.score ?? 0;
    const inPantry = opts.pantryIds?.has(f.id) ?? false;
    const everyday = (dinner ? EVERYDAY_DINNER : EVERYDAY_SNACK).has(f.id);
    if (!everyday && aff <= 0 && !inPantry) continue;
    // Lo que tiene en casa manda (si sirve para lo que falta), después lo que suele comer
    const total = s + cp.pen + (PROCESSED.has(f.id) ? 0.3 : 0) - (aff > 0 ? Math.min(0.3, 0.06 * aff) : 0) - (inPantry ? 0.6 : 0) + 0.03 * f.priceTier;
    scored.push({ f, s: total, aff, inPantry });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => a.s - b.s);
  // Variedad: entre las opciones casi igual de buenas, una distinta cada día
  const near = scored.filter((x) => x.s <= scored[0].s + 0.3).slice(0, 3);
  const pick = near[Math.abs(opts.dayIndex ?? 0) % near.length];
  const f = pick.f;

  const tone = req.tone ?? DEFAULT_TONE;
  const usted = tone === "usted";
  const reason = pick.inPantry ? (usted ? "Lo tiene en casa." : "Lo tienes en casa.")
    : pick.aff >= 2 ? (usted ? "Es de lo que suele comer." : "Es de lo que sueles comer.")
      : tier === 1 && f.priceTier === 1 ? "Y es de lo más económico."
        : "";
  const text = [lineFor(f, req, tone), reason, tipFor(f, req.need, tone)].filter(Boolean).join(" ");
  return { id: f.id, name: cleanName(f), grams: f.grams, kcal: f.kcal, protein: f.protein, fiber: f.fiber, text };
}

/** Lo que llega por el WebSocket, validado. null = pedido inválido. */
export function parseNudgeRequest(d: any): NudgeRequest | null {
  if (!d || !NUDGE_NEEDS.includes(d.need)) return null;
  const gap = Number(d.gapG);
  const kcal = Number(d?.eaten?.kcal);
  return {
    need: d.need,
    ...(Number.isFinite(gap) && gap > 0 && gap <= 200 ? { gapG: gap } : {}),
    ...(d.forDinner === true ? { forDinner: true } : {}),
    ...(Number.isFinite(kcal) && kcal >= 0 && kcal <= 15000 ? { eaten: { kcal } } : {}),
    ...(isTone(d.tone) ? { tone: d.tone } : {}),
  };
}

/** Junta lo que sabe el servidor de la persona y elige la sugerencia. */
export async function buildNudge(memory: any, req: NudgeRequest, now = new Date()): Promise<NudgeSuggestion | null> {
  const ctx = await gatherMetabolicContext(memory, { now });
  const body: any = await memory.get("body_profile").catch(() => null);
  const affinity = await loadFoodAffinity(memory).catch(() => new Map<string, Affinity>());
  const saved: any = await memory.get("pantry_latest").catch(() => null);
  let pantryIds: Set<string> | undefined;
  const savedAt = saved?.savedAt ? Date.parse(saved.savedAt) : NaN;
  if (Array.isArray(saved?.items) && Number.isFinite(savedAt) && now.getTime() - savedAt < 3 * 86400000) {
    pantryIds = new Set(saved.items.flatMap((t: unknown) => matchFoods(String(t)).map((f) => f.id)));
  }
  // Lo que hay en casa según el Inventario (fase I7) también cuenta como despensa
  const home = await homePantry(memory, now).catch(() => null);
  if (home) pantryIds = new Set([...(pantryIds ?? []), ...home.ids]);
  const tone = req.tone ?? (await getTone(memory)) ?? DEFAULT_TONE;
  return suggestNudge(ctx, { ...req, tone }, { goal: body?.goal, affinity, pantryIds, dayIndex: Math.floor(now.getTime() / 86400000) });
}
