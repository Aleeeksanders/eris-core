// ============================================================
// Eris — «¿y si me como un completo?»: simular antes de comer, en el chat
//
// 2026-10-15, idea aprobada por el usuario («dale, me parece buena idea»). Es el MISMO cálculo de la tarjeta de calidad
// de la app (NutritionQualityCore.ts, copia exacta del núcleo del teléfono), con y sin lo que se piensa comer, y parte
// del mismo día: el registro que manda el teléfono (con sus valores por 100 g) más lo anotado por chat que aún no copió.
// Nada se anota. Todo es código, así que funciona con el chat en pausa y no inventa cifras. Dice:
//   - cuánto cambia la nota del día, cómo es el alimento (letra, sellos, ultraprocesado) y qué aporta;
//   - si hay algo que convenga más (un acompañamiento, media porción, agua en vez de bebida, otra colación), con la
//     nota que quedaría. Lo que se sugiere pasa por sus restricciones (fail-closed) y sus condiciones de salud.
// ============================================================

import { simulateAdd, evaluateDay, toQualityItem, type QualityItem, type QualitySim, type Letter, type ItemQuality } from "./NutritionQualityCore.js";
import { MEAL_NAME, fitsSlot, slotIsPast, slotAt, typicalTimeOf, nutritionDayOf, type DayCtx } from "./MealSchedule.js";
import { itemKey, type PhoneFoodLog } from "./NutritionLog.js";
import { dayCtxOf, todayKeyOf, wakeHourOf } from "./NutritionDay.js";
import { loadTargets } from "./DailyTargets.js";
import { FOODS, NEVER_RECOMMEND, conditionPenalty, unparsedAllergyIds, recommendMeals, loadFoodAffinity, type CatalogFood, type Moment, type Plate, type PlateComponent } from "./MealRecommender.js";
import { isAllowed } from "./DietaryRestrictions.js";
import { gatherMetabolicContext, analyze, type MetabolicContext } from "./MetabolicAnalysis.js";
import { portionPhrase, suggestNudge } from "./NudgeSuggest.js";
import { DEFAULT_TONE, getTone, type Tone } from "./Tone.js";
import { beverageTypeOf } from "./Beverage.js";

/** Lo que la persona piensa comer, ya buscado en las bases: valores por 100 g. */
export interface WhatIfFood {
  name: string;
  grams: number;
  per100: { kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar?: number; sodium?: number; satFat?: number };
}

type Opts = Parameters<typeof evaluateDay>[1];
const r1 = (n: number) => Math.round(n * 10) / 10;

// ─── Lo de hoy, como lo ve el teléfono ───────────────────────────────────────

/**
 * Lo comido hoy: la lista del teléfono (con sus valores por 100 g, `q`) más lo anotado por chat que el teléfono todavía no
 * copió, sin lo borrado. Es lo mismo que suma la app (su registro + lo pendiente del chat), así la nota "antes" calza.
 * Sin `q` (app anterior a la 1.42) se usan los totales del alimento: la nota puede variar un poco.
 */
export function qualityItemsToday(chatLog: unknown, phone: unknown, day: string, deleted: unknown, wakeHour?: number): QualityItem[] {
  const gone = new Set(Array.isArray(deleted) ? deleted.map(String) : []);
  const have = new Set<string>();
  const out: QualityItem[] = [];
  const p = phone as PhoneFoodLog | null | undefined;
  if (p && p.date === day && Array.isArray(p.items)) {
    for (const i of p.items) {
      const k = itemKey(i.t, i.name, i.grams);
      if (gone.has(k) || have.has(k)) continue;
      have.add(k);
      const f = i.grams > 0 ? 100 / i.grams : 1;
      const q = i.q;
      out.push(toQualityItem({
        name: i.name, grams: i.grams, mealType: i.meal ?? "", at: new Date(i.t),
        per100: q ? { kcal: q.kcal, protein: q.protein, carbs: q.carbs, fat: q.fat, fiber: q.fiber, sugar: q.sugar, sodium: q.sodium, satFat: q.satFat }
          : { kcal: i.kcal * f, protein: i.protein * f, carbs: i.carbs * f, fat: i.fat * f, fiber: (i.fiber ?? 0) * f },
        group: q?.group, nova: q?.nova, nutriscore: q?.nutriscore,
      }, wakeHour));
    }
  }
  for (const e of Array.isArray(chatLog) ? (chatLog as any[]) : []) {
    if (!e || !Array.isArray(e.items) || typeof e.timestamp !== "string") continue;
    for (const it of e.items) {
      const k = itemKey(e.timestamp, it.name, it.grams);
      if (gone.has(k) || have.has(k)) continue;
      have.add(k);
      // Igual que el teléfono cuando copia lo del chat (nutritionSync.serverEntryToLogged): por 100 g, sin azúcar ni sodio
      const f = it.grams > 0 ? 100 / it.grams : 1;
      out.push(toQualityItem({
        name: it.name, grams: it.grams, mealType: e.mealType ?? "", at: new Date(e.timestamp),
        per100: { kcal: Math.round((it.calories ?? 0) * f), protein: r1((it.protein ?? 0) * f), carbs: r1((it.carbs ?? 0) * f), fat: r1((it.fat ?? 0) * f), fiber: r1((it.fiber ?? 0) * f), sugar: 0, sodium: 0 },
      }, wakeHour));
    }
  }
  return out;
}

/** Cuándo se lo comería: ahora, o a la hora típica de la comida que nombró si todavía no llega ("y si en la cena…"). */
export function whenFor(meal: string | null | undefined, now: Date, wakeHour?: number, dayCtx: DayCtx = {}): { at: Date; mealType: string } {
  if (meal && !fitsSlot(meal, now, wakeHour) && !slotIsPast(meal, now, wakeHour)) {
    return { at: typicalTimeOf(meal, nutritionDayOf(now, dayCtx), { wakeHour }), mealType: meal };
  }
  return { at: now, mealType: meal ?? slotAt(now, { wakeHour }) };
}

// ─── Lo que convendría más ───────────────────────────────────────────────────

export interface WhatIfAlt { kind: "lado" | "media" | "agua" | "cambio"; text: string; after: number; letter: Letter }

const VEG_SIDE = ["tomate", "lechuga", "zanahoria", "pepino", "repollo", "betarraga", "brocoli", "porotos_verdes"];
const FRUIT_SIDE = ["manzana", "naranja", "platano", "pera", "frutilla", "kiwi", "durazno", "uva"];
const PROTEIN_SIDE = ["huevo_cocido", "yogur_griego", "quesillo", "queso_cottage", "yogur_descremado"];
const BY_ID = new Map(FOODS.map((f) => [f.id, f]));
const MAIN = new Set(["desayuno", "almuerzo", "once", "cena"]);
/** De desayuno u once, no de un plato de almuerzo o cena */
const BREAKFAST_ONLY = new Set(["avena", "avena_cocida", "granola", "cereal_azucarado", "pan_molde_blanco", "pan_integral", "marraqueta", "hallulla", "mermelada", "manjar"]);
const SNACK = new Set(["colacion_am", "colacion_pm", "merienda"]);

/** ¿Se le puede sugerir? Sus restricciones (fail-closed), lo nombrado en alergias sin reconocer y lo que su condición desaconseja. */
function safeFor(f: CatalogFood, ctx: MetabolicContext): boolean {
  return !NEVER_RECOMMEND.has(f.id) && !unparsedAllergyIds(ctx.restrictions).has(f.id) && isAllowed(f, ctx.restrictions).ok
    && !conditionPenalty(f, ctx, { closeToWorkout: false }).hard;
}

/** Un alimento del catálogo (valores por porción) como ítem evaluable; `grams` si no es la porción de siempre. */
export function catalogItem(f: CatalogFood, mealType: string, at: Date, wakeHour?: number, grams = f.grams): QualityItem {
  const k = 100 / f.grams;
  return toQualityItem({
    name: f.name, grams, mealType, at,
    per100: { kcal: f.kcal * k, protein: f.protein * k, carbs: f.carbs * k, fat: f.fat * k, fiber: f.fiber * k, sugar: f.sugar * k,
      sodium: f.sodiumMg != null ? f.sodiumMg * k : undefined, satFat: f.satFat != null ? f.satFat * k : undefined },
  }, wakeHour);
}

const simpleName = (n: string) => n.split(" / ")[0].replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Alternativas que mejoran la nota del día, cada una ya simulada; la mejor primero. Solo cuentan si suben la nota del día
 * al menos 3 puntos respecto de comérselo tal cual. Sin contexto (perfil), no se sugiere comida, solo media porción o agua.
 */
export function alternatives(today: QualityItem[], cands: QualityItem[], sim: QualitySim, opts: Opts, ctx: MetabolicContext | null, extra: {
  dayIndex?: number; goal?: string; tone?: Tone;
  /** un plato completo para esa comida (MealRecommender: restricciones, presupuesto, condiciones y lo que suele comer) */
  plateFor?: (moment: Moment) => Plate | null;
} = {}): WhatIfAlt[] {
  const base = sim.after.foodScore ?? 0;
  const slot = sim.meal.slot;
  const { mealType, at } = { mealType: cands[0].slot, at: cands[0].at };
  const out: WhatIfAlt[] = [];
  const tryAlt = (kind: WhatIfAlt["kind"], text: string, items: QualityItem[]) => {
    const d = evaluateDay([...today, ...items], opts);
    if (d.foodScore != null && d.foodScore >= base + 3) out.push({ kind, text, after: d.foodScore, letter: d.letter! });
  };
  const pick = (ids: string[]) => {
    if (!ctx) return null;
    const ok = ids.map((id) => BY_ID.get(id)).filter((f): f is CatalogFood => !!f && safeFor(f, ctx));
    return ok.length ? ok[Math.abs(extra.dayIndex ?? 0) % Math.min(3, ok.length)] : null;
  };
  const notes = sim.meal.after?.notes ?? [];

  // 1) Agua (o una zero) en vez de la bebida azucarada
  const sugary = cands.filter((c, i) => sim.items[i]?.group === "bebida_azucarada");
  if (sugary.length) tryAlt("agua", `con agua o una bebida zero en vez de ${simpleName(sugary[0].name)}`, cands.filter((c) => !sugary.includes(c)));

  // 2) Un acompañamiento que le falta a la comida (verdura o fruta; proteína en el desayuno y la once)
  if (MAIN.has(slot) && notes.some((n) => /^sin verduras/.test(n))) {
    const f = pick(slot === "desayuno" || slot === "once" ? FRUIT_SIDE : VEG_SIDE);
    if (f) tryAlt("lado", `con ${portionPhrase(f)} al lado`, [...cands, catalogItem(f, mealType, at, opts.wakeHour)]);
  }
  if ((slot === "desayuno" || slot === "once") && notes.some((n) => /^poca prote/.test(n))) {
    const f = pick(PROTEIN_SIDE);
    if (f) tryAlt("lado", `con ${portionPhrase(f)} al lado`, [...cands, catalogItem(f, mealType, at, opts.wakeHour)]);
  }

  // 3) Media porción de lo más pesado, si lo malo es la cantidad (te pasas de lo esperable o es comida de baja calidad)
  const heavy = cands.map((c, i) => ({ c, q: sim.items[i] })).sort((a, b) => b.q.kcal - a.q.kcal)[0];
  if (heavy && heavy.q.kcal >= 250 && (sim.worse.some((w) => /^Energ/.test(w)) || heavy.q.letter === "D" || heavy.q.letter === "E")) {
    const half = { ...heavy.c, grams: Math.round(heavy.c.grams / 2) };
    tryAlt("media", `con media porción de ${simpleName(heavy.c.name)} (${half.grams} ${beverageTypeOf(heavy.c.name) ? "ml" : "g"})`, cands.map((c) => (c === heavy.c ? half : c)));
  }

  // 4) Entre comidas (o en el desayuno o la once): algo que sostenga, elegido igual que en los avisos (NudgeSuggest)
  const poor = sim.items.some((q) => q.letter === "D" || q.letter === "E");
  if (ctx && (SNACK.has(slot) || slot === "desayuno" || slot === "once") && poor) {
    const s = suggestNudge(ctx, { need: "colacion", tone: extra.tone }, { goal: extra.goal, dayIndex: extra.dayIndex });
    const f = s ? BY_ID.get(s.id) : undefined;
    if (f) tryAlt("cambio", `${SNACK.has(slot) ? "si es para picar" : "si quieres algo más liviano"}, ${portionPhrase(f)}`, [catalogItem(f, mealType, at, opts.wakeHour)]);
  }

  // 5) Almuerzo o cena de baja calidad: un plato completo en vez de eso (el mismo recomendador del asesor)
  if (extra.plateFor && (slot === "almuerzo" || slot === "cena") && poor) {
    const plate = extra.plateFor(slot === "cena" ? "cena_liviana" : "comida");
    const parts = (plate?.components ?? []).map((c) => ({ c, f: BY_ID.get(c.id) })).filter((x): x is { c: PlateComponent; f: CatalogFood } => !!x.f);
    if (parts.length) {
      const said = parts.map(({ c }) => `${c.portionText} de ${simpleName(c.name)}`);
      const list = said.length > 1 ? `${said.slice(0, -1).join(", ")} y ${said[said.length - 1]}` : said[0];
      tryAlt("cambio", `en vez de eso, ${list}`, parts.map(({ c, f }) => catalogItem(f, mealType, at, opts.wakeHour, c.grams)));
    }
  }
  return out.sort((a, b) => b.after - a.after);
}

// ─── Todo junto ──────────────────────────────────────────────────────────────

export interface WhatIfResult {
  sim: QualitySim;
  foods: WhatIfFood[];
  goals: { kcal: number; protein: number; fiber: number };
  /** lo esperable a esta hora (fracción del día) */
  expectedShare: number;
  alts: WhatIfAlt[];
  tone: Tone;
}

/** Junta lo de hoy (teléfono + chat), las metas y el perfil, y simula. No guarda nada. */
export async function buildWhatIf(memory: any, foods: WhatIfFood[], opts: { meal?: string | null; now?: Date; tone?: Tone } = {}): Promise<WhatIfResult> {
  const now = opts.now ?? new Date();
  const safe = async (k: string) => { try { return await memory.get(k); } catch { return null; } };
  const day = await todayKeyOf(memory, now);
  const dayCtx = await dayCtxOf(memory);
  const wakeHour = await wakeHourOf(memory, now);
  const snap = await safe("health_snapshot_latest");
  const today = qualityItemsToday(await safe(`nutrition_log_${day}`), snap?.foodLog, day, await safe(`nutrition_deleted_${day}`), wakeHour);

  // Las metas que tiene el teléfono (las manda el servidor en nutrition_today: DailyTargets, o lo fijado a mano)
  const stored = (await safe("nutrition_goals")) || {};
  let goals: Opts["goals"] = { kcal: stored.calories, protein: stored.protein, fiber: stored.fiber, water: stored.waterLiters };
  try {
    const t = await loadTargets(memory);
    goals = { kcal: t.kcal ?? stored.calories, protein: t.proteinG ?? stored.protein, fiber: t.fiberGGoal ?? stored.fiber, water: t.waterL ?? undefined };
  } catch {}
  const o: Opts = { now, goals, wakeHour };

  const when = whenFor(opts.meal, now, wakeHour, dayCtx);
  const cands = foods.map((f) => toQualityItem({ name: f.name, grams: f.grams, mealType: when.mealType, at: when.at, per100: f.per100 }, wakeHour));
  const sim = simulateAdd(today, cands, o);

  const ctx = await gatherMetabolicContext(memory, { now }).catch(() => null);
  const body: any = await safe("body_profile");
  const tone = opts.tone ?? (await getTone(memory)) ?? DEFAULT_TONE;
  const affinity = await loadFoodAffinity(memory).catch(() => undefined);
  // El primer plato que sea de almuerzo o cena: el recomendador no distingue comidas y a veces arma carne con avena
  const plateFor = ctx ? (moment: Moment) => {
    try {
      const plates = recommendMeals({ ctx, analysis: analyze(ctx), moment, tierCap: ctx.budget?.tier, affinity, limit: 5 }).plates;
      return plates.find((p) => !p.components.some((c) => BREAKFAST_ONLY.has(c.id))) ?? null;
    } catch { return null; }
  } : undefined;
  const alts = alternatives(today, cands, sim, o, ctx, { dayIndex: Math.floor(now.getTime() / 86400000), goal: body?.goal, tone, plateFor });
  return { sim, foods, goals: { kcal: sim.after.goals.kcal, protein: sim.after.goals.protein, fiber: sim.after.goals.fiber }, expectedShare: sim.after.expectedShare, alts, tone };
}

// ─── El texto ────────────────────────────────────────────────────────────────

const miles = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const grade = (score: number | null, letter: Letter | null) => (score == null || !letter ? "—" : `${letter} · ${score}`);

/** "un completo (200 g)", "un completo y una coca-cola (200 g + 355 g)", "200 g de arroz": lo que dijo, con los gramos. */
function foodPhrase(foods: WhatIfFood[], said?: string): string {
  // Las bebidas en ml, como se ingresan en la app
  const amt = (f: WhatIfFood) => `${miles(f.grams)} ${beverageTypeOf(f.name) ? "ml" : "g"}`;
  if (said) return `${said} (${foods.map(amt).join(" + ")})`;
  return foods.map((f) => `${amt(f)} de ${simpleName(f.name)}`).join(" + ");
}

function itemFlags(q: ItemQuality): string {
  const flags: string[] = [];
  if (q.nova >= 4) flags.push("ultraprocesado");
  if (q.sellos.length) flags.push(`ALTO EN ${q.sellos.join(", ")}`);
  return flags.length ? ` · ${flags.join(" · ")}` : "";
}

export interface WhatIfTextOpts {
  /** lo que dijo la persona ("un completo"), para nombrarlo igual */
  said?: string;
  /** avisos de restricciones (FoodSafetyCheck.assessFood): "contiene gluten" */
  risks?: Array<{ name: string; level: "blocked" | "unknown"; reason: string }>;
  restrictionLabels?: string[];
  /** lo que no se encontró (no entra en la simulación) */
  missing?: string[];
  /** nombres corregidos ("«chocapig» como Chocapic") y porciones asumidas */
  notes?: string[];
}

export function formatWhatIf(r: WhatIfResult, t: WhatIfTextOpts = {}): string {
  const usted = r.tone === "usted";
  const { sim } = r;
  const b = sim.before, a = sim.after;
  const lines: string[] = [];
  const what = foodPhrase(r.foods, t.said);
  const meal = MEAL_NAME[sim.meal.slot] ?? sim.meal.label;
  lines.push(`🍽️ **Si ${usted ? "se come" : "te comes"} ${what}**${meal ? ` en ${/^(desayuno|almuerzo)$/.test(sim.meal.slot) ? "el" : "la"} ${meal.toLowerCase()}` : ""}:`);

  // Restricciones primero: es lo más importante
  const risky = (t.risks ?? []).filter(Boolean);
  for (const x of risky) lines.push(`⚠️ **Ojo:** ${simpleName(x.name)} — ${x.reason}.`);
  if (risky.length && t.restrictionLabels?.length) lines.push(`*(${usted ? "Sus" : "Tus"} restricciones: ${t.restrictionLabels.join(", ")}.)*`);

  // La nota del día
  const tu = usted ? "Su" : "Tu";
  if (b.foodScore == null) {
    lines.push(`• Sería lo primero de hoy: ${tu.toLowerCase()} día partiría en **${grade(a.foodScore, a.letter)}**.`);
  } else {
    const d = (a.foodScore ?? 0) - b.foodScore;
    const arrow = d > 0 ? ` (▲${d})` : d < 0 ? ` (▼${-d})` : " (igual)";
    lines.push(`• ${tu} día pasaría de **${grade(b.foodScore, b.letter)}** a **${grade(a.foodScore, a.letter)}**${arrow}.`);
  }

  // Cómo es el alimento y qué aporta
  if (sim.items.length === 1) {
    lines.push(`• Como alimento: **${sim.item.letter}**${itemFlags(sim.item)}.`);
  } else {
    lines.push(`• Cada uno: ${sim.items.map((q, i) => `${simpleName(r.foods[i].name)} **${q.letter}**${itemFlags(q)}`).join("; ")}.`);
  }
  const tot = r.foods.reduce((acc, f) => {
    const k = f.grams / 100;
    return { kcal: acc.kcal + f.per100.kcal * k, protein: acc.protein + f.per100.protein * k, carbs: acc.carbs + f.per100.carbs * k, fiber: acc.fiber + f.per100.fiber * k };
  }, { kcal: 0, protein: 0, carbs: 0, fiber: 0 });
  lines.push(`• Aporta ~${miles(tot.kcal)} kcal · ${Math.round(tot.protein)} g de proteína · ${Math.round(tot.carbs)} g de carbohidratos · ${Math.round(tot.fiber)} g de fibra.`);
  const expected = Math.round(r.goals.kcal * Math.max(0.05, r.expectedShare));
  lines.push(`• Energía del día: ${miles(b.kcal)} → ${miles(a.kcal)} de ${miles(r.goals.kcal)} kcal (a esta hora, lo esperable es ~${miles(expected)}).`);
  for (const w of sim.worse) lines.push(`• Empeora: ${w}.`);
  for (const g of sim.better) lines.push(`• Mejora: ${g}.`);

  // Lo que conviene más: el cambio más chico que ayuda (agua, un acompañamiento, media porción) y, si rinde más, el cambio
  // completo. Cada uno con la nota que quedaría.
  // Si algo choca con sus restricciones, solo sirve cambiarlo (media porción de algo con gluten sigue teniendo gluten)
  const blocked = risky.some((x) => x.level === "blocked");
  const tweak = blocked ? undefined : r.alts.find((x) => x.kind !== "cambio");
  const swap = r.alts.find((x) => x.kind === "cambio");
  const shown = [tweak, swap && (!tweak || swap.after > tweak.after) ? swap : undefined].filter((x): x is WhatIfAlt => !!x);
  const good = (sim.item.letter === "A" || sim.item.letter === "B") && (b.foodScore == null || (a.foodScore ?? 0) >= b.foodScore - 2);
  const conv = `💡 **${usted ? "Le" : "Te"} convendría más:**`;
  if (shown.length === 1) {
    lines.push("", `${conv} ${shown[0].text} → ${tu.toLowerCase()} día quedaría en **${grade(shown[0].after, shown[0].letter)}** en vez de ${grade(a.foodScore, a.letter)}.`);
  } else if (shown.length > 1) {
    lines.push("", `${conv} (${tu.toLowerCase()} día, en vez de ${grade(a.foodScore, a.letter)})`);
    for (const x of shown) lines.push(`• ${x.text} → **${grade(x.after, x.letter)}**`);
  } else if (good && !risky.some((x) => x.level === "blocked")) {
    lines.push("", "✅ Buena elección para esta hora.");
  }

  if (t.missing?.length) lines.push(`(No encontré ${t.missing.map((m) => `«${m}»`).join(" ni ")} en mis bases, así que no entra en la cuenta.)`);
  if (t.notes?.length) lines.push(...t.notes.map((n) => `(${n})`));
  const order = t.said ? `«anota ${t.said}»` : "«anota …» con lo que comas";
  lines.push("", usted
    ? `Es solo una simulación: su registro sigue igual. Si se lo come, escríbame ${order}.`
    : `Es solo una simulación: tu registro sigue igual. Si te lo comes, escribe ${order}.`);
  return lines.join("\n");
}
