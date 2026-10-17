// ============================================================
// Eris — Recomendador de comidas
//
// Arma platos concretos (proteína + carbohidrato + verdura) con porciones y macros
// EXACTOS del catálogo (src/data/food_catalog.json). El LLM no elige alimentos ni
// cantidades: solo presenta lo que sale de acá.
//
// Orden de los filtros (cada uno solo puede quitar opciones, nunca agregar):
//   1. Restricciones alimentarias — FAIL-CLOSED (celiaquía, alergias, vegetariano…)
//   2. Despensa — si el usuario dijo qué tiene, solo eso
//   3. Presupuesto — nivel de precio máximo (solo si NO hay despensa: lo que ya tienes en casa no se vuelve a comprar)
//   4. Puntaje — ajuste al hueco de macros, momento (pre/post entreno), condiciones y afinidad
// ============================================================

import catalog from "../data/food_catalog.json";
import { hasWord, norm, type Affinity } from "./CarbOptions.js";
import { isAllowed, hasAnyRestriction, type FoodSafety } from "./DietaryRestrictions.js";
import type { MetabolicContext, Analysis, Macros } from "./MetabolicAnalysis.js";

export type Role = "proteina" | "carbo" | "verdura" | "fruta" | "lacteo" | "grasa" | "snack" | "bebida" | "plato" | "aderezo" | "legumbre";
export type Moment = "pre_entreno" | "post_entreno" | "comida" | "colacion" | "cena_liviana";

export interface CatalogFood extends FoodSafety {
  id: string; name: string; aliases: string[]; role: Role;
  portion: string; grams: number; kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number;
  gi: "bajo" | "medio" | "alto"; sodium: "bajo" | "medio" | "alto";
  priceTier: 1 | 2 | 3; prep: "listo" | "simple" | "cocinar"; moments: string[];
  // Por porción, desde USDA SR Legacy (faltan en los platos chilenos compuestos)
  potassium?: "bajo" | "medio" | "alto";
  sodiumMg?: number; potassiumMg?: number; phosphorusMg?: number; satFat?: number; cholesterolMg?: number;
}

export const FOODS: CatalogFood[] = (catalog as { items: CatalogFood[] }).items as any;
const BY_ID = new Map(FOODS.map((f) => [f.id, f]));

export interface PlateComponent { id: string; name: string; grams: number; portionText: string; kcal: number; protein: number; carbs: number; fat: number }
export interface Plate {
  components: PlateComponent[];
  totals: Macros;
  score: number;
  reasons: string[];
  warnings: string[];
  prep: "listo" | "simple" | "cocinar";
  /** Incluye algo que su condición desaconseja (mucha sal, procesado, potasio en ERC): solo se muestra si no hay alternativa. */
  flagged: boolean;
}

export interface Recommendation {
  moment: Moment;
  targetText: string;
  plates: Plate[];
  /** Cosas de la despensa que NO se usaron y por qué (para que el usuario sepa que no fue un olvido). */
  excluded: Array<{ name: string; reason: string }>;
  /** Cosas de la despensa que no están en el catálogo: no se pueden evaluar. */
  unmatched: string[];
  usedPantry: boolean;
  tierCap?: 1 | 2 | 3;
}

// ─── Sinónimos → ids del catálogo (para la despensa y la afinidad) ───────────

const SYN: Record<string, string[]> = {
  pollo: ["pechuga_plancha", "muslo_pollo", "pollo_muslo_sin_piel"], pavo: ["pavo_pechuga"], cordero: ["cordero_pierna"], higado: ["vacuno_higado"], tocino: ["tocino"], pechuga: ["pechuga_plancha"], "pechuga de pollo": ["pechuga_plancha"], muslo: ["muslo_pollo"], pernil: ["muslo_pollo"],
  carne: ["carne_molida", "bife_vacuno", "vacuno_posta", "vacuno_filete", "vacuno_molida_magra"], vacuno: ["carne_molida", "bife_vacuno", "vacuno_posta", "vacuno_filete", "vacuno_molida_magra"], filete: ["vacuno_filete"], "carne molida": ["carne_molida"], bife: ["bife_vacuno"], lomo: ["bife_vacuno", "lomo_cerdo"], posta: ["bife_vacuno"],
  cerdo: ["lomo_cerdo"], chuleta: ["lomo_cerdo"],
  pescado: ["merluza", "salmon", "congrio", "bacalao", "trucha", "tilapia", "lenguado", "atun_fresco", "jurel_lata", "sardina_lata"], congrio: ["congrio"], jurel: ["jurel_lata"], sardinas: ["sardina_lata"], trucha: ["trucha"], bacalao: ["bacalao"], tilapia: ["tilapia"], lenguado: ["lenguado"], mariscos: ["camaron", "choritos", "machas", "ostiones", "pulpo", "jaiba"], camarones: ["camaron"], choritos: ["choritos"], machas: ["machas"], pulpo: ["pulpo"], jaiba: ["jaiba"], merluza: ["merluza"], salmon: ["salmon"], reineta: ["merluza"], atun: ["atun_agua", "atun_aceite", "atun_fresco"], "lata de atun": ["atun_agua", "atun_aceite"],
  huevo: ["huevo"], huevos: ["huevo"], clara: ["clara_huevo"], claras: ["clara_huevo"],
  arroz: ["arroz_blanco", "arroz_integral"], fideos: ["fideos_cocidos", "fideos_integrales", "fideos_arroz"], pasta: ["fideos_cocidos"], tallarines: ["fideos_cocidos"], espagueti: ["fideos_cocidos"],
  pan: ["marraqueta", "hallulla", "pan_molde_blanco", "pan_integral"], marraqueta: ["marraqueta"], hallulla: ["hallulla"], "pan de molde": ["pan_molde_blanco", "pan_integral"],
  papa: ["papa"], papas: ["papa"], patata: ["papa"], camote: ["camote"], quinoa: ["quinoa"], avena: ["avena", "avena_cocida"], cuscus: ["couscous"], yuca: ["yuca"], granola: ["granola"],
  lentejas: ["lentejas"], porotos: ["porotos"], garbanzos: ["garbanzos"], arvejas: ["arvejas"], legumbres: ["lentejas", "porotos", "garbanzos", "arvejas", "porotos_negros", "porotos_blancos", "habas"], tofu: ["tofu"], edamame: ["edamame"], habas: ["habas"],
  leche: ["leche_entera", "leche_descremada"], yogur: ["yogur_natural", "yogur_griego", "yogur_descremado"], yogurt: ["yogur_natural", "yogur_griego", "yogur_descremado"], quesillo: ["quesillo"], queso: ["quesillo", "queso_gauda", "queso_cottage", "queso_ricotta", "queso_mozzarella", "queso_parmesano", "queso_crema"], "leche de soya": ["leche_soya"], "leche de almendras": ["leche_almendras"],
  palta: ["palta"], nueces: ["nueces"], almendras: ["almendras"], mani: ["mani"], "frutos secos": ["nueces", "almendras", "castana_caju", "pistachos", "avellanas"], chia: ["semillas_chia"], linaza: ["linaza"],
  platano: ["platano"], banana: ["platano"], manzana: ["manzana"], naranja: ["naranja"], pera: ["pera"], uvas: ["uva"], sandia: ["sandia"], frutilla: ["frutilla"], frutillas: ["frutilla"],
  kiwi: ["kiwi"], durazno: ["durazno"], fruta: ["role:fruta"], frutas: ["role:fruta"],
  verduras: ["role:verdura"], verdura: ["role:verdura"], ensalada: ["lechuga", "tomate", "pepino", "zanahoria"], lechuga: ["lechuga"], tomate: ["tomate"], zanahoria: ["zanahoria"],
  zapallo: ["zapallo"], brocoli: ["brocoli"], espinaca: ["espinaca"], acelga: ["acelga"], choclo: ["choclo"], cebolla: ["cebolla"], pepino: ["pepino"], pimenton: ["pimenton"],
  whey: ["proteina_whey"], proteina: ["proteina_whey"], "proteina en polvo": ["proteina_whey"],
  vienesa: ["vienesa"], vienesas: ["vienesa"], salchicha: ["vienesa"], longaniza: ["longaniza"], jamon: ["jamon_cocido"],
};

function plainForms(w: string): string[] {
  // Singular simple de una palabra ya normalizada.
  const out = new Set([w]);
  if (w.length > 4 && w.endsWith("es")) out.add(w.slice(0, -2));
  if (w.length > 3 && w.endsWith("s")) out.add(w.slice(0, -1));
  return [...out];
}

/** ¿A qué alimentos del catálogo se refiere este texto? Coincidencia por palabra completa (nunca por subcadena). */
export function matchFoods(text: string): CatalogFood[] {
  const n0 = norm(text);
  if (!n0) return [];
  // Se agregan las formas en singular de cada palabra ("tomates" → "tomate", "huevos" → "huevo").
  const n = n0 + " " + n0.split(/[^a-z0-9]+/).filter(Boolean).flatMap(plainForms).join(" ");
  const ids = new Set<string>();
  const add = (v: string) => {
    if (v.startsWith("role:")) FOODS.filter((f) => f.role === v.slice(5)).forEach((f) => ids.add(f.id));
    else ids.add(v);
  };
  // Nombres y alias exactos del catálogo (frases completas, ej. "pechuga de pollo")
  // Las palabras de un nombre específico que calzó ("atún fresco", "salmón ahumado") NO deben expandirse a la
  // versión genérica ("atún" → también el enlatado): el usuario dijo cuál es.
  const covered = new Set<string>();
  const hits = new Map<string, Set<string>>(); // id → palabras de su clave más específica que calzó
  for (const f of FOODS) {
    const keys = [f.name, ...f.aliases, f.id.replace(/_/g, " ")];
    for (const k of keys) {
      if (k.length > 2 && hasWord(n, k)) {
        const w = new Set(norm(k).split(/[^a-z0-9]+/).filter(Boolean));
        w.forEach((x) => covered.add(x));
        if (!hits.has(f.id) || w.size > hits.get(f.id)!.size) hits.set(f.id, w);
      }
    }
  }
  // Si "salmón ahumado" calzó, "salmón" (más genérico) sobra: gana el nombre más específico.
  for (const [id, w] of hits) {
    const dominated = [...hits].some(([other, ow]) => other !== id && ow.size > w.size && [...w].every((x) => ow.has(x)));
    if (!dominated) ids.add(id);
  }
  // Sinónimos genéricos
  // (frases primero: "pan de molde" y "lata de atún" tapan a "pan" y "atún" sueltos)
  const synEntries = Object.entries(SYN).sort((a, b) => Number(b[0].includes(" ")) - Number(a[0].includes(" ")));
  for (const [k, targets] of synEntries) {
    if (!k.includes(" ") && covered.has(norm(k))) continue;
    if (hasWord(n, k)) {
      targets.forEach(add);
      if (k.includes(" ")) norm(k).split(/[^a-z0-9]+/).forEach((w) => w && covered.add(w));
    }
  }
  return [...ids].map((id) => BY_ID.get(id)!).filter(Boolean);
}

/** Separa "arroz, pollo y 2 tomates" en fragmentos. */
export function splitPantry(text: string): string[] {
  return norm(text)
    .split(/[,;\n]|\by\b|\bcon\b|\btambien\b|\+/)
    .map((f) => f.replace(/^\s*(tengo|hay|me queda|me quedan|solo|un poco de|un|una|unos|unas|algo de)\s+/g, "").replace(/\b\d+\s*(kg|g|gr|unidades?|u)?\b/g, "").trim())
    .filter((f) => f.length > 1);
}

// ─── Afinidad sobre el catálogo (lo que el usuario realmente come) ───────────

export async function loadFoodAffinity(memory: any, days = 30): Promise<Map<string, Affinity>> {
  const counts = new Map<string, number>();
  const bump = (name: string, by: number) => { for (const f of matchFoods(name)) counts.set(f.id, (counts.get(f.id) || 0) + by); };
  if (!memory) return new Map();
  try {
    const frequent = await memory.get("frequent_foods");
    if (frequent && typeof frequent === "object") for (const [name, v] of Object.entries<any>(frequent)) bump(name, Number(v?.count) || 1);
  } catch {}
  const now = Date.now();
  for (let d = 0; d < days; d++) {
    try {
      const log = await memory.get(`nutrition_log_${new Date(now - d * 86400000).toDateString()}`);
      if (!Array.isArray(log)) continue;
      for (const e of log) for (const it of e?.items || []) bump(String(it?.name || ""), 1);
    } catch {}
  }
  const out = new Map<string, Affinity>();
  for (const [id, score] of counts) out.set(id, { score, reason: `lo has registrado ${score} ${score === 1 ? "vez" : "veces"}` });
  return out;
}

// ─── Porciones legibles ──────────────────────────────────────────────────────


function pluralize(unit: string): string {
  const w = unit.trim();
  if (/[aeiouáéíóú]$/i.test(w)) return w + "s";
  if (/ón$/i.test(w)) return w.slice(0, -2) + "ones";
  if (/z$/i.test(w)) return w.slice(0, -1) + "ces";
  return w + "es";
}

/** "1 unidad (85g)" × 1,5 → "1 unidad y media (128 g)". Si la unidad no se puede escalar, cae a gramos. */
export function portionText(f: CatalogFood, mult: number): string {
  const amount = Math.round(f.grams * mult);
  const grams = amount; // (para líquidos el catálogo guarda ml en `grams`; ver `u`)
  const u = /\bml\b/i.test(f.portion) ? "ml" : "g";
  const m = f.portion.replace(/½/g, "0.5").match(/^(\d+(?:[.,]\d+)?)\s+(.+?)\s*\(/);
  if (!m) return `${grams} ${u}`;
  const n = Number(m[1].replace(",", ".")) * mult;
  if (!(n > 0) || (n * 2) % 1 !== 0) return `${grams} ${u}`;
  // Primera palabra de la unidad; "mediana/grande" son adjetivos, no unidades ("1 mediana" = 1 unidad).
  let unit = m[2].trim().split(/\s+/)[0];
  if (/^(mediana|mediano|grande|chica|chico|peque[nñ][ao])$/i.test(unit)) unit = "unidad";
  // La porción del catálogo puede venir en plural ("2 unidades (52g)"): se lleva a singular antes de contar, si no salía
  // "4 unidadeses" o "1 unidades" (2026-10-15)
  if (Number(m[1].replace(",", ".")) > 1) unit = /[dlnr]es$/i.test(unit) ? unit.slice(0, -2) : unit.replace(/s$/i, "");
  const feminine = /(a|dad|ción|sión)$/i.test(unit);
  if (n === 0.5) return `${feminine ? "media" : "medio"} ${unit} (${grams} ${u})`;
  const whole = Math.floor(n);
  const half = n % 1 === 0.5;
  const word = whole > 1 ? pluralize(unit) : unit;
  return `${whole} ${word}${half ? " y media" : ""} (${grams} ${u})`;
}

// ─── Objetivos por momento ───────────────────────────────────────────────────

interface Target {
  protein: [number, number]; carbs: [number, number]; kcal: [number, number];
  fatMax?: number; fiberMax?: number;
  text: string;
}

/** Objetivo por momento, ajustado a la dieta (keto / bajo en carbohidratos). */
function targetFor(moment: Moment, ctx: MetabolicContext, a: Analysis, minutes?: number): Target {
  const t = baseTarget(moment, ctx, a, minutes);
  const r = ctx.restrictions;
  if (r.keto) return { ...t, carbs: [0, 10], text: `${t.text}, keto: como máximo ~10 g de carbohidratos netos, el resto en proteína y grasas buenas` };
  if (r.lowCarb) return { ...t, carbs: [Math.min(t.carbs[0], 10), Math.min(t.carbs[1], 30)], text: `${t.text}, bajo en carbohidratos (hasta ~30 g)` };
  return t;
}

function baseTarget(moment: Moment, ctx: MetabolicContext, a: Analysis, minutes?: number): Target {
  const hour = a.hour;
  const proteinNeed = ctx.goals.protein ? a.needs.proteinG : 25;
  const ckd = ctx.goals.protein === null && ctx.medical?.conditions?.some((c) => c.id === "ckd");
  const mealsLeft = hour < 15 ? 2 : 1;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

  if (moment === "pre_entreno") {
    if (minutes !== undefined && minutes < 30) return { protein: [0, 6], carbs: [15, 30], kcal: [60, 140], fatMax: 3, fiberMax: 3, text: "carbohidrato ligero y fácil de digerir (15–30 g), casi sin grasa ni fibra" };
    if (minutes !== undefined && minutes < 60) return { protein: [0, 12], carbs: [25, 45], kcal: [130, 260], fatMax: 8, fiberMax: 5, text: "carbohidrato moderado (25–45 g) con poca grasa y fibra" };
    return { protein: [12, 25], carbs: [40, 65], kcal: [280, 480], fatMax: 12, fiberMax: 8, text: "comida completa con carbohidrato (40–65 g) y algo de proteína, poca grasa" };
  }
  if (moment === "post_entreno") {
    const p = ckd ? [15, 25] as [number, number] : [Math.min(25, Math.max(20, proteinNeed * 0.5)), 40] as [number, number];
    return { protein: p, carbs: [35, 70], kcal: [350, 650], text: `proteína (${p[0]}–${p[1]} g) y carbohidrato (35–70 g) para recuperar` };
  }
  if (moment === "colacion") return { protein: [5, 15], carbs: [10, 35], kcal: [110, 260], text: "colación ligera (110–260 kcal) con algo de proteína" };
  if (moment === "cena_liviana") return { protein: [22, 35], carbs: [15, 45], kcal: [280, 500], fatMax: 20, text: "cena liviana (280–500 kcal) con proteína y poco carbohidrato" };
  // comida principal
  const kcalT = clamp(a.needs.kcal / mealsLeft, 350, 750);
  const pT = ckd ? [15, 25] as [number, number] : [Math.min(20, proteinNeed * 0.5), Math.max(25, Math.min(45, proteinNeed / mealsLeft))] as [number, number];
  const diabetic = ctx.medical?.conditions?.some((c) => ["diabetes_t1", "diabetes_t2", "prediabetes"].includes(c.id));
  const carbHi = Math.min(diabetic ? 60 : 85, clamp(a.needs.carbsG / mealsLeft * 1.2, 45, 85));
  return { protein: pT, carbs: [Math.min(carbHi - 10, Math.max(30, a.needs.carbsG / mealsLeft * 0.6)), carbHi], kcal: [round(kcalT * 0.8), round(kcalT * 1.2)], text: `comida completa de ~${round(kcalT)} kcal con ${pT[0]}–${pT[1]} g de proteína` };
}
const round = (n: number) => Math.round(n);

const dist = (x: number, [lo, hi]: [number, number]) => (x < lo ? (lo - x) / Math.max(hi, 1) : x > hi ? (x - hi) / Math.max(hi, 1) : 0);

// ─── Conocimiento por condición (listas cortas y explícitas) ─────────────────

export const PROCESSED = new Set(["longaniza", "vienesa", "jamon_cocido", "completo_italiano", "empanada_frita", "papas_fritas", "chorrillana"]);
const FODMAP = new Set(["cebolla", "ajo", "leche_entera", "leche_descremada", "yogur_natural", "porotos", "garbanzos", "lentejas", "arvejas", "manzana", "pera", "sandia", "durazno", "lentejas_guiso", "porotos_riendas"]);
const POTASSIUM = new Set(["platano", "papa", "camote", "espinaca", "palta", "naranja", "tomate", "lucuma", "chirimoya", "kiwi", "acelga", "jugo_naranja", "leche_platano", "pure_papas"]);

export function conditionPenalty(f: CatalogFood, ctx: MetabolicContext, near: { closeToWorkout: boolean }): { pen: number; warn?: string; hard: boolean } {
  const c = (id: string) => ctx.medical?.conditions?.some((x) => x.id === id);
  let pen = 0; let warn: string | undefined; let hard = false;
  if ((c("diabetes_t1") || c("diabetes_t2") || c("prediabetes")) && f.gi === "alto" && !near.closeToWorkout) { pen += 0.6; warn = `${f.name}: índice glucémico alto (sube rápido la glucosa)`; }
  if ((c("hypertension") || c("ckd")) && f.sodium === "alto") { pen += 0.7; hard = true; warn = `${f.name}: mucha sal`; }
  if ((c("hypertension") || c("dyslipidemia")) && PROCESSED.has(f.id)) { pen += 0.6; hard = true; warn = warn ?? `${f.name}: procesado/graso`; }
  if (c("ibs") && FODMAP.has(f.id)) { pen += 0.5; warn = warn ?? `${f.name}: puede caer pesado con colon irritable`; }
  if (c("ckd") && (f.potassium ? f.potassium === "alto" : POTASSIUM.has(f.id))) { pen += 0.6; hard = true; warn = warn ?? `${f.name}: rico en potasio (consúltalo con tu nefrólogo)`; }
  // Dislipidemia: mucha grasa saturada por porción (dato USDA cuando existe)
  if (c("dyslipidemia") && (f.satFat ?? 0) >= 5) { pen += 0.4; warn = warn ?? `${f.name}: ${f.satFat} g de grasa saturada por porción`; }
  // Enfermedad renal: el fósforo también se cuida
  if (c("ckd") && (f.phosphorusMg ?? 0) >= 250) { pen += 0.3; warn = warn ?? `${f.name}: rico en fósforo (consúltalo con tu nefrólogo)`; }
  return { pen, warn, hard };
}

/**
 * Alimentos nombrados en el campo de alergias que Eris no reconoce como alergia conocida ("alergia al kiwi"): no se
 * puede saber qué tan grave es, así que nunca se proponen (fail-closed). Antes solo se avisaba "revisa las etiquetas".
 */
export function unparsedAllergyIds(r: { unparsed: string[] }): Set<string> {
  return new Set(r.unparsed.flatMap((t) => matchFoods(t).map((f) => f.id)));
}

/** Existen en el catálogo (para registrar y evaluar lo que el usuario comió) pero Eris no los propone como comida. */
export const NEVER_RECOMMEND = new Set(["papas_fritas", "coca_cola", "chorrillana", "mayonesa", "ketchup", "azucar", "miel"]);

// ─── Recomendador ────────────────────────────────────────────────────────────

export interface RecommendInput {
  ctx: MetabolicContext;
  analysis: Analysis;
  moment: Moment;
  minutesToWorkout?: number;
  pantry?: string[];        // fragmentos ya separados; undefined = sin despensa
  affinity?: Map<string, Affinity>;
  limit?: number;
  /** Con despensa nunca se aplica presupuesto; sin despensa, el nivel máximo de precio. */
  tierCap?: 1 | 2 | 3;
}

const MULTS = [0.5, 1, 1.5, 2];
const PROTEIN_ROLES = new Set<Role>(["proteina", "legumbre"]);   // en una comida principal; los lácteos van en colaciones
const CARB_ROLES = new Set<Role>(["carbo"]);                    // la fruta va en colaciones/pre-entreno, no de "carbohidrato" de un plato

export function recommendMeals(input: RecommendInput): Recommendation {
  const { ctx, analysis, moment, minutesToWorkout, affinity = new Map(), limit = 3 } = input;
  const restrictions = ctx.restrictions;
  const excluded: Array<{ name: string; reason: string }> = [];
  const unmatched: string[] = [];

  // 1) Restricciones (fail-closed) + cosas que Eris nunca recomienda como comida + lo nombrado en alergias sin reconocer
  const unknownAllergy = unparsedAllergyIds(restrictions);
  const allowed = FOODS.filter((f) => !NEVER_RECOMMEND.has(f.id) && !unknownAllergy.has(f.id) && isAllowed(f, restrictions).ok);

  // 2) Despensa
  let pool = allowed;
  const usedPantry = !!input.pantry && input.pantry.length > 0;
  if (usedPantry) {
    const wanted = new Map<string, CatalogFood>();
    for (const frag of input.pantry!) {
      const found = matchFoods(frag);
      if (!found.length) { unmatched.push(frag); continue; }
      const anyAllowed = found.some((f) => isAllowed(f, restrictions).ok);
      if (!anyAllowed) {
        // Todo lo que podría ser eso está vetado: se le dice por qué (p. ej. "el pan lo dejé fuera: no puedo confirmar que no tenga gluten").
        const why = isAllowed(found[0], restrictions).reason ?? "no cumple tus restricciones";
        excluded.push({ name: frag, reason: why });
        continue;
      }
      for (const f of found) if (isAllowed(f, restrictions).ok) wanted.set(f.id, f);
    }
    pool = [...wanted.values()];
  } else if (input.tierCap) {
    // 3) Presupuesto (solo cuando hay que comprar)
    pool = pool.filter((f) => f.priceTier <= input.tierCap!);
  }

  // Cerca del entreno no hay tiempo de cocinar.
  const noTime = minutesToWorkout !== undefined && minutesToWorkout < 45;
  if (noTime) pool = pool.filter((f) => f.prep !== "cocinar");

  const target = targetFor(moment, ctx, analysis, minutesToWorkout);
  const closeToWorkout = moment === "pre_entreno" || moment === "post_entreno";

  // Componentes por rol
  const proteins = pool.filter((f) => PROTEIN_ROLES.has(f.role) && f.protein >= 5);
  const carbs = pool.filter((f) => CARB_ROLES.has(f.role));
  const veggies = pool.filter((f) => f.role === "verdura" && f.id !== "ajo");
  const platos = pool.filter((f) => f.role === "plato");
  const light = pool.filter((f) => (["fruta", "lacteo", "grasa", "snack", "carbo"].includes(f.role) || f.id === "jugo_naranja" || f.id === "leche_platano") && f.kcal > 20);

  const fats = pool.filter((f) => f.role === "grasa" && f.id !== "mantequilla");
  type Combo = Array<{ f: CatalogFood; mults: number[] }>;
  const combos: Combo[] = [];
  const isMeal = moment === "comida" || moment === "post_entreno" || moment === "cena_liviana";

  if (isMeal || (moment === "pre_entreno" && (minutesToWorkout === undefined || minutesToWorkout >= 60))) {
    for (const p of proteins) {
      for (const c of carbs) combos.push([{ f: p, mults: MULTS }, { f: c, mults: MULTS }]);
      combos.push([{ f: p, mults: MULTS }]);
      // Sin (o con poco) carbohidrato permitido — keto, bajo en carbos — la energía viene de una grasa buena
      if (ctx.restrictions.keto || ctx.restrictions.lowCarb || !carbs.length) {
        for (const g of fats) combos.push([{ f: p, mults: [1, 1.5, 2] }, { f: g, mults: [0.5, 1, 2] }]);
      }
    }
    if (moment === "pre_entreno") for (const fr of pool.filter((x) => x.role === "fruta")) for (const p of proteins) combos.push([{ f: p, mults: [0.5, 1] }, { f: fr, mults: [1, 2] }]);
    for (const pl of platos) combos.push([{ f: pl, mults: [0.5, 1, 1.5] }]);
  } else {
    for (const f of light) combos.push([{ f, mults: [0.5, 1, 1.5, 2] }]);
    for (const c of light.filter((x) => x.role === "fruta" || x.role === "carbo"))
      for (const d of light.filter((x) => x.role === "lacteo" || x.role === "grasa")) if (c.id !== d.id) combos.push([{ f: c, mults: [1, 2] }, { f: d, mults: [0.5, 1] }]);
  }
  // Con proteína + carbo, sumar 1 verdura (la mejor por tomar) en comidas principales
  const bestVeg = (): CatalogFood | undefined => {
    if (!veggies.length) return undefined;
    const pref = veggies.filter((v) => v.moments.includes(moment));
    return (pref[0] ?? veggies.sort((a, b) => b.fiber - a.fiber)[0]);
  };
  const veg = moment === "pre_entreno" ? undefined : bestVeg();

  type Scored = { plate: Plate; key: string; main: string };
  const scored: Scored[] = [];

  for (const combo of combos) {
    // Recorre todas las combinaciones de múltiplos de este combo
    const idx = combo.map(() => 0);
    while (true) {
      const parts = combo.map((c, i) => ({ f: c.f, mult: c.mults[idx[i]] }));
      const s = scorePlate(parts, veg, isMeal && parts.length >= 1 && !platos.includes(parts[0].f));
      if (s) scored.push(s);
      let k = combo.length - 1;
      while (k >= 0 && ++idx[k] >= combo[k].mults.length) { idx[k] = 0; k--; }
      if (k < 0) break;
    }
  }

  function scorePlate(parts: Array<{ f: CatalogFood; mult: number }>, vegetable: CatalogFood | undefined, addVeg: boolean): Scored | null {
    const items = [...parts];
    if (addVeg && vegetable && !items.some((i) => i.f.id === vegetable.id)) items.push({ f: vegetable, mult: 1 });
    const t: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    for (const { f, mult } of items) { t.kcal += f.kcal * mult; t.protein += f.protein * mult; t.carbs += f.carbs * mult; t.fat += f.fat * mult; t.fiber += f.fiber * mult; }

    let s = 0;
    s += 1.2 * dist(t.protein, target.protein);
    s += 1.0 * dist(t.carbs, target.carbs);
    s += 1.0 * dist(t.kcal, target.kcal);
    if (target.fatMax !== undefined && t.fat > target.fatMax) s += 0.8 * ((t.fat - target.fatMax) / Math.max(target.fatMax, 5));
    if (target.fiberMax !== undefined && t.fiber > target.fiberMax) s += 0.4 * ((t.fiber - target.fiberMax) / target.fiberMax);

    const reasons: string[] = []; const warnings: string[] = [];
    let bonus = 0; let flagged = false;
    for (const { f } of items) {
      if (f.moments.includes(moment)) bonus += 0.08;
      const aff = affinity.get(f.id)?.score || 0;
      if (aff > 0) { bonus += Math.min(0.25, 0.05 * aff); reasons.push(`${f.name.split(" (")[0]}: ${affinity.get(f.id)!.reason}`); }
      const cp = conditionPenalty(f, ctx, { closeToWorkout });
      s += cp.pen; if (cp.hard) flagged = true; if (cp.warn && !warnings.includes(cp.warn)) warnings.push(cp.warn);
      if (f.prep === "cocinar") s += 0.03;
      if (PROCESSED.has(f.id)) s += 0.15; // los procesados quedan al final salvo que no haya más
    }
    // Un plato con 3 alimentos cuenta más "listo" que uno con 1 (menos monótono), leve.
    s -= bonus;

    const prepRank = { listo: 0, simple: 1, cocinar: 2 } as const;
    const prep = items.reduce<"listo" | "simple" | "cocinar">((acc, { f }) => (prepRank[f.prep] > prepRank[acc] ? f.prep : acc), "listo");

    const comps: PlateComponent[] = items.map(({ f, mult }) => ({
      id: f.id, name: f.name, grams: Math.round(f.grams * mult), portionText: portionText(f, mult),
      kcal: Math.round(f.kcal * mult), protein: round1(f.protein * mult), carbs: round1(f.carbs * mult), fat: round1(f.fat * mult),
    }));
    const totals: Macros = { kcal: Math.round(t.kcal), protein: round1(t.protein), carbs: round1(t.carbs), fat: round1(t.fat), fiber: round1(t.fiber) };

    if (totals.protein >= target.protein[0]) reasons.unshift(`aporta ${totals.protein} g de proteína`);
    if (moment === "pre_entreno") reasons.push(`${totals.carbs} g de carbohidratos como combustible`);
    return {
      plate: { components: comps, totals, score: s, reasons, warnings, prep, flagged },
      key: comps.map((c) => c.id).sort().join("+"),
      main: items[0].f.id,
    };
  }

  scored.sort((a, b) => a.plate.score - b.plate.score);
  // Lo que su condición desaconseja solo aparece si no hay ninguna alternativa limpia.
  const clean = scored.filter((x) => !x.plate.flagged);
  const candidates = clean.length ? clean : scored;
  // Diversidad: que las 3 opciones no sean la misma comida con otra cantidad
  const picked: Scored[] = [];
  const seenKeys = new Set<string>(); const seenMain = new Set<string>();
  for (const s of candidates) {
    if (seenKeys.has(s.key) || seenMain.has(s.main)) continue;
    picked.push(s); seenKeys.add(s.key); seenMain.add(s.main);
    if (picked.length >= limit) break;
  }

  return { moment, targetText: target.text, plates: picked.map((p) => p.plate), excluded, unmatched, usedPantry, tierCap: input.tierCap };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ─── Texto para el LLM ───────────────────────────────────────────────────────

const MOMENT_LABEL: Record<Moment, string> = {
  pre_entreno: "antes de entrenar", post_entreno: "después de entrenar", comida: "para comer ahora", colacion: "una colación", cena_liviana: "una cena liviana",
};
const PREP_LABEL = { listo: "listo para comer", simple: "preparación simple", cocinar: "hay que cocinar" } as const;

export function formatRecommendation(rec: Recommendation, ctx: MetabolicContext): string {
  const lines: string[] = [];
  if (hasAnyRestriction(ctx.restrictions)) lines.push(`Adaptado a tus restricciones: ${ctx.restrictions.labels.join(", ")}.`);
  if (ctx.restrictions.unparsed.length) lines.push(`⚠ No pude interpretar esto de tus alergias: "${ctx.restrictions.unparsed.join('", "')}" — revisa las etiquetas de todo lo que comas.`);

  lines.push(`Objetivo (${MOMENT_LABEL[rec.moment]}): ${rec.targetText}.`);
  if (rec.usedPantry) lines.push("Solo uso lo que dijiste que tienes en casa.");
  else if (rec.tierCap) lines.push(`Filtrado por presupuesto: nivel de precio hasta ${["", "económico", "medio", "caro"][rec.tierCap]}.`);

  if (!rec.plates.length) {
    lines.push("", "No pude armar un plato razonable con esas opciones y tus restricciones.");
  } else {
    rec.plates.forEach((p, i) => {
      lines.push("", `Opción ${i + 1} (${PREP_LABEL[p.prep]}):`);
      for (const c of p.components) lines.push(`  - ${c.portionText} de ${c.name.split(" (")[0]}: ${c.kcal} kcal, ${c.protein} g proteína, ${c.carbs} g carbohidratos`);
      lines.push(`  Total: ${p.totals.kcal} kcal · ${p.totals.protein} g proteína · ${p.totals.carbs} g carbohidratos · ${p.totals.fat} g grasa`);
      if (p.reasons.length) lines.push(`  Por qué: ${p.reasons.slice(0, 3).join("; ")}`);
      if (p.warnings.length) lines.push(`  Ojo: ${p.warnings.join("; ")}`);
    });
  }
  if (rec.excluded.length) {
    lines.push("", "Lo que dejé fuera de tu despensa:");
    for (const e of rec.excluded) lines.push(`  - ${e.name}: ${e.reason}`);
  }
  if (rec.unmatched.length) lines.push("", `No tengo datos nutricionales de: ${rec.unmatched.join(", ")} (no los incluí en los platos).`);
  return lines.join("\n");
}


/** Versión para mostrar en el chat (markdown). Se anexa a la respuesta tal cual: nada de esto pasa por el modelo. */
export function formatRecommendationChat(rec: Recommendation): string {
  if (!rec.plates.length) return "";
  const out: string[] = [];
  rec.plates.forEach((p, i) => {
    out.push(`**Opción ${i + 1}**${i === 0 ? " ⭐ (la que más te conviene)" : ""} · ${PREP_LABEL[p.prep]}`);
    for (const c of p.components) out.push(`- ${c.portionText} de ${c.name.split(" (")[0]} — ${c.kcal} kcal · ${c.protein} g proteína · ${c.carbs} g carbohidratos`);
    out.push(`*Total: ${p.totals.kcal} kcal · ${p.totals.protein} g proteína · ${p.totals.carbs} g carbohidratos · ${p.totals.fat} g grasa*`);
    if (p.warnings.length) out.push(`⚠ ${p.warnings.join("; ")}`);
    out.push("");
  });
  if (rec.excluded.length) out.push(`Dejé fuera: ${rec.excluded.map((e) => `${e.name} (${e.reason})`).join("; ")}.`);
  if (rec.unmatched.length) out.push(`Sin datos nutricionales de: ${rec.unmatched.join(", ")}.`);
  return out.join("\n").trim();
}
