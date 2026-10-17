// ============================================================
// Eris — Opciones concretas de carbohidratos
// "15 g de carbohidratos rápidos" no le dice nada a nadie. Esto convierte
// una meta en gramos a alimentos y porciones que la persona reconoce
// (un vaso de bebida, un Chocman, una porción de Tritón), con los gramos
// reales por unidad y priorizando lo que el usuario ya come.
//
// Los datos vienen de src/data/carb_options.json (curados y verificados),
// NO del LLM: el modelo solo presenta lo que devuelve este módulo.
// ============================================================

import carbData from "../data/carb_options.json";
import { getUserNotes } from "../tools/UserContextTool.js";
import { isAllowed, describeRestrictions, hasAnyRestriction, type Restrictions, type FoodSafety } from "./DietaryRestrictions.js";

export type CarbSpeed = "rapida" | "media" | "lenta";
export type CarbPurpose = "hipoglucemia" | "colacion" | "energia";

interface CarbItem extends FoodSafety {
  id: string;
  name: string;
  aliases: string[];
  speed: CarbSpeed;
  unit: string;
  unitPlural: string;
  unitDetail: string;
  carbsPerUnit: number;
  step: number;
  source: string;
}

export interface CarbSuggestion {
  id: string;
  name: string;
  speed: CarbSpeed;
  quantity: number;
  portionText: string; // "1 vaso chico (150 ml)"
  carbs: number;       // gramos reales que aporta esa porción
  affinity: number;    // >0 si el usuario ya lo come / lo mencionó
  affinityReason?: string;
}

const ITEMS = (carbData as { items: CarbItem[] }).items;
const HISTORY_DAYS = 30;

// ─── Afinidad: ¿qué come realmente este usuario? ─────────────────────────────

export const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

const SUGAR_FREE = /\b(zero|light|diet)\b|sin azucar/;

/** Coincidencia por palabra completa: "cola" no debe calzar con "chocolate" ni "pan" con "empanada". */
export function hasWord(normalizedText: string, alias: string): boolean {
  const a = norm(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${a}([^a-z0-9]|$)`).test(normalizedText);
}

export interface Affinity {
  score: number;
  reason?: string;
}

/**
 * Cuenta cuántas veces el usuario registró cada alimento (historial de
 * comidas de los últimos 30 días + `frequent_foods`) y suma peso extra si lo
 * mencionó en sus notas personales ("me encanta el Chocman").
 */
export async function loadAffinity(memory: any): Promise<Map<string, Affinity>> {
  const counts = new Map<string, number>();
  const notesHit = new Set<string>();
  if (!memory) return new Map();

  const bump = (rawName: string, by: number) => {
    const n = norm(rawName);
    const sugarFree = SUGAR_FREE.test(n);
    for (const item of ITEMS) {
      // Una bebida "zero"/"light" NO es afinidad por la versión con azúcar (ni sirve para un bajón).
      if (sugarFree && item.speed === "rapida") continue;
      if (item.aliases.some((a) => hasWord(n, a))) {
        counts.set(item.id, (counts.get(item.id) || 0) + by);
      }
    }
  };

  try {
    const frequent = await memory.get("frequent_foods");
    if (frequent && typeof frequent === "object") {
      for (const [name, v] of Object.entries<any>(frequent)) bump(name, Number(v?.count) || 1);
    }
  } catch {}

  const now = Date.now();
  for (let d = 0; d < HISTORY_DAYS; d++) {
    try {
      const day = new Date(now - d * 86400000).toDateString();
      const log = await memory.get(`nutrition_log_${day}`);
      if (!Array.isArray(log)) continue;
      for (const entry of log) for (const item of entry?.items || []) bump(String(item?.name || ""), 1);
    } catch {}
  }

  try {
    const notes = await getUserNotes(memory);
    for (const note of notes) {
      const n = norm(note.note || "");
      for (const item of ITEMS) {
        if (item.aliases.some((a) => hasWord(n, a))) {
          counts.set(item.id, (counts.get(item.id) || 0) + 3);
          notesHit.add(item.id);
        }
      }
    }
  } catch {}

  const out = new Map<string, Affinity>();
  for (const [id, score] of counts) {
    out.set(id, {
      score,
      reason: notesHit.has(id) ? "lo mencionaste en tus notas" : `lo has registrado ${score} ${score === 1 ? "vez" : "veces"}`,
    });
  }
  return out;
}

// ─── Porciones ───────────────────────────────────────────────────────────────

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Cantidad práctica (respetando el paso de la unidad) que cubre la meta sin pasarse demasiado. */
function pickQuantity(item: CarbItem, target: number): number {
  const stepCarbs = item.carbsPerUnit * item.step;
  // La menor cantidad que llega al 90% de la meta (para bajones es mejor cubrir que quedarse corto).
  let qty = Math.max(item.step, Math.ceil((target * 0.9) / stepCarbs) * item.step);
  // Si quedarse en la cantidad anterior está más cerca de la meta y aporta al menos el 75%, mejor esa.
  const lower = qty - item.step;
  if (lower >= item.step && item.carbsPerUnit * lower >= target * 0.75 &&
      Math.abs(item.carbsPerUnit * lower - target) < Math.abs(item.carbsPerUnit * qty - target)) {
    qty = lower;
  }
  return qty;
}

function portionLabel(item: CarbItem, qty: number): string {
  if (qty === 0.5) return `media ${item.unit} (mitad de ${item.unitDetail})`;
  const whole = Math.floor(qty);
  const hasHalf = qty % 1 === 0.5;
  const q = hasHalf ? `${whole} y media` : String(qty);
  const word = qty > 1 ? item.unitPlural : item.unit;
  // "c/u" solo tiene sentido con más de una unidad
  return qty > 1 ? `${q} ${word} (${item.unitDetail} c/u)` : `${q} ${word} (${item.unitDetail})`;
}

export interface SuggestOptions {
  grams: number;
  purpose: CarbPurpose;
  affinity?: Map<string, Affinity>;
  limit?: number;
  /** Restricciones del usuario (celiaquía, alergias…). Fail-closed: lo no verificado NO se ofrece. */
  restrictions?: Restrictions;
}

/** Arma las opciones. Puro (sin red ni LLM) para poder probarlo. */
export function suggestCarbOptions({ grams, purpose, affinity = new Map(), limit = 4, restrictions }: SuggestOptions): CarbSuggestion[] {
  const target = Math.max(5, Math.min(grams, 80));
  // Keto / bajo en carbos NO aplican acá: ante un bajón de glucosa hacen falta carbohidratos rápidos sí o sí.
  const rr = restrictions ? { ...restrictions, keto: false, lowCarb: false } : undefined;
  const usable = rr ? ITEMS.filter((i) => isAllowed(i, rr).ok) : ITEMS;

  const toSuggestion = (item: CarbItem): CarbSuggestion | null => {
    const qty = pickQuantity(item, target);
    const carbs = round1(item.carbsPerUnit * qty);
    // Descarta porciones absurdas: muy lejos de la meta (ej. pan entero para 15 g).
    if (carbs < target * 0.6 || carbs > target * 1.7) return null;
    const aff = affinity.get(item.id);
    return {
      id: item.id, name: item.name, speed: item.speed, quantity: qty,
      portionText: portionLabel(item, qty), carbs,
      affinity: aff?.score || 0, affinityReason: aff?.reason,
    };
  };

  const rank = (a: CarbSuggestion, b: CarbSuggestion) =>
    b.affinity - a.affinity || Math.abs(a.carbs - target) - Math.abs(b.carbs - target);

  if (purpose === "hipoglucemia") {
    // Ante un bajón: primero lo que sube rápido (sin grasa). Lo lento solo si es algo que el
    // usuario ya come, y claramente marcado como más lento.
    const fast = usable.filter((i) => i.speed === "rapida").map(toSuggestion).filter((s): s is CarbSuggestion => !!s).sort(rank);
    const slowFavorites = usable.filter((i) => i.speed !== "rapida").map(toSuggestion)
      .filter((s): s is CarbSuggestion => !!s && s.affinity > 0).sort(rank);
    return [...fast.slice(0, Math.max(2, limit - Math.min(slowFavorites.length, 2))), ...slowFavorites.slice(0, 2)].slice(0, limit);
  }

  const all = usable.map(toSuggestion).filter((s): s is CarbSuggestion => !!s).sort(rank);
  return all.slice(0, limit);
}

/**
 * Favoritos del usuario que NO se pueden recomendar por sus restricciones ("te encanta el Chocman, pero
 * tiene gluten"). Mejor decirlo que dejar que el usuario piense que Eris no se acordó de él.
 */
export function blockedFavorites(affinity: Map<string, Affinity>, restrictions: Restrictions | undefined): string[] {
  const rr = restrictions ? { ...restrictions, keto: false, lowCarb: false } : undefined;
  if (!rr || !hasAnyRestriction(rr)) return [];
  const out: string[] = [];
  for (const item of ITEMS) {
    if ((affinity.get(item.id)?.score || 0) <= 0) continue;
    const r = isAllowed(item, rr);
    if (!r.ok) out.push(`${item.name.split(" (")[0]} (${r.reason})`);
  }
  return out;
}

// ─── Texto para el LLM ───────────────────────────────────────────────────────

const SPEED_LABEL: Record<CarbSpeed, string> = {
  rapida: "sube rápido",
  media: "sube a ritmo medio",
  lenta: "sube más lento por la grasa",
};

export interface FormatContext {
  restrictions?: Restrictions;
  blocked?: string[];
}

export function formatCarbOptions(grams: number, purpose: CarbPurpose, options: CarbSuggestion[], ctx: FormatContext = {}): string {
  if (options.length === 0) {
    return `No encontré una opción segura para ${grams} g de carbohidratos con tus restricciones` +
      (ctx.restrictions ? ` (${describeRestrictions(ctx.restrictions)})` : "") + ". Usa algo simple que sepas que puedes tomar (azúcar o jugo natural) y revisa etiquetas.";
  }

  const head =
    purpose === "hipoglucemia"
      ? `Para subir la glucosa (regla de 15: ~${grams} g de carbohidratos rápidos), estas son las opciones concretas:`
      : `Opciones concretas para ~${grams} g de carbohidratos:`;

  const adaptedNote = ctx.restrictions && hasAnyRestriction(ctx.restrictions)
    ? `\nAdaptado a tus restricciones: ${describeRestrictions(ctx.restrictions)}.` : "";
  const blockedNote = ctx.blocked && ctx.blocked.length
    ? `\nNo te recomiendo estos favoritos: ${ctx.blocked.join("; ")}.` : "";

  const lines = options.map((o, i) => {
    const fav = o.affinityReason ? ` — ${o.affinityReason}` : "";
    const alreadyNamed = norm(o.portionText).includes(norm(o.name.split(" (")[0]));
    const what = alreadyNamed ? o.portionText : `${o.portionText} de ${o.name}`;
    return `${i + 1}. ${what}: ${o.carbs} g de carbohidratos (${SPEED_LABEL[o.speed]})${fav}`;
  });

  let tail = "";
  if (purpose === "hipoglucemia") {
    tail =
      "\n\nCómo usarlo: toma UNA opción, espera 15 minutos y vuelve a medir; si sigue bajo, repite. " +
      "Las opciones que suben más lento (las que llevan grasa) sirven pero tardan más: " +
      "si estás bajo de verdad, elige una de las rápidas. Si estás muy bajo o con síntomas fuertes (confusión, temblor intenso), pide ayuda.";
  }
  const howToPresent =
    "\n\n[Cómo presentarlo: da 3 opciones (prioriza las marcadas como favoritas). Di CADA una con esta forma exacta: " +
    "«<porción con su medida> de <alimento> (<gramos> g de carbohidratos)», por ejemplo «1 vaso chico (150 ml) de jugo (15 g de carbohidratos)». " +
    "No abrevies a 'un vaso' sin la medida y no cambies medidas ni cifras.]";
  return `${head}${adaptedNote}${blockedNote}\n${lines.join("\n")}${tail}${howToPresent}`;
}
