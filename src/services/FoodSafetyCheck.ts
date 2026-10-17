// ============================================================
// Eris — Chequeo de seguridad alimentaria al registrar, buscar o escanear
//
// Antes de esto, las restricciones (celiaquía, alergias…) solo se miraban al RECOMENDAR comida; si el
// usuario registraba o escaneaba algo con gluten, nadie le avisaba. Aquí se evalúa cualquier alimento
// contra su perfil y se devuelve un aviso claro. NO bloquea nada (el usuario ya lo comió o va a
// decidir él): informa, con el mismo criterio fail-closed — si no se puede confirmar, se dice.
// ============================================================

import { isAllowed, isAllowedFull, hasAnyRestriction, puedeTenerAlcohol, type FoodSafety, type Restrictions } from "./DietaryRestrictions.js";
import { matchFoods } from "./MealRecommender.js";
import { scanText } from "./PackagedFoods.js";

export interface ItemRisk {
  name: string;
  /** blocked = contiene (o puede tener trazas de) algo que el usuario debe evitar · unknown = no se puede confirmar */
  level: "blocked" | "unknown";
  /** Unidos en una sola frase — para donde el espacio importa (flag de un resultado de búsqueda). */
  reason: string;
  /** Uno por restricción que aplica (mínimo 1) — para mostrarlas como lista, no como una frase con punto y coma. */
  reasons: string[];
}

/** Comidas típicamente con harina de trigo: solo sirven para decir "revisa los ingredientes" cuando no hay datos. */
const GLUTEN_FOOD_WORDS = /(^|[^a-z])(pan|fideos?|galletas?|pizza|empanadas?|tortas?|pasteles?|queques?|kuchen|sandwich|hamburguesa|completo|churrasco|cereal(es)?|panqueques?|masa)([^a-z]|$)/;

/**
 * Evalúa UN alimento. `safety` viene del catálogo o de un producto envasado; si falta, se intenta resolver
 * el nombre contra el catálogo y, en último caso, se lee el nombre buscando alérgenos evidentes.
 */
export function assessFood(name: string, safety: FoodSafety | undefined, r: Restrictions): ItemRisk | null {
  if (!hasAnyRestriction(r)) return null;

  if (safety) {
    // Todos los motivos, no solo el primero: con varias restricciones activas y un producto sin verificar,
    // antes solo se avisaba de una (ver DietaryRestrictions.allChecks) y las demás parecían confirmadas.
    const { ok, blocked, unknown } = isAllowedFull({ ...safety, name: safety.name ?? name }, r);
    if (ok) return null;
    const reasons = blocked.length ? blocked : unknown;
    return { name, level: blocked.length ? "blocked" : "unknown", reason: reasons.join("; "), reasons };
  }

  // El nombre dice "sin gluten"/"sin lactosa": no se puede dar por bueno solo por eso, pero tampoco es "contiene".
  const claim = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/\b(?:sin|libre de)\s+(gluten|lactosa|soya|mani|huevo)/);
  if (claim && r.excluded.has((claim[1] === "mani" ? "mani" : claim[1]) as any)) {
    const reason = `dice ser sin ${claim[1]}: confirma que tenga el sello o lo indique la etiqueta`;
    return { name, level: "unknown", reason, reasons: [reason] };
  }

  // Sin datos propios: ¿es algo del catálogo? ("camarones", "pan", "lentejas"). Solo vale si calza LO PRINCIPAL del nombre:
  // en "Empanada de queso" calzaba solo "queso" (sin gluten) y la empanada pasaba como apta para un celíaco.
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const sing = (w: string) => w.replace(/(es|s)$/, "");
  const head = fold(name).split(/[^a-z0-9ñ]+/).find((w) => w.length > 2 && !/^\d/.test(w) && !["con", "del", "los", "las", "una", "uno", "unos", "unas"].includes(w));
  const matches = matchFoods(name).filter((m) => !head || [m.name, ...(m.aliases ?? [])].some((k) => fold(k).split(/[^a-z0-9ñ]+/).some((w) => sing(w) === sing(head))));
  if (matches.length) {
    const results = matches.map((m) => isAllowed(m, r));
    if (results.every((x) => x.ok)) return null;
    const blocked = results.filter((x) => !x.ok && x.definite);
    if (blocked.length === results.length) return { name, level: "blocked", reason: blocked[0].reason!, reasons: [blocked[0].reason!] };
    const reason = "depende del tipo o de la marca: revisa la etiqueta";
    return { name, level: "unknown", reason, reasons: [reason] };
  }

  // Nada que resolver: ¿el propio nombre delata un alérgeno? ("fideos con salsa", "torta de chocolate y nueces")
  const hints = scanText(name).filter((t) => r.excluded.has(t as any));
  if (r.excluded.has("gluten" as any) && !hints.includes("gluten") && GLUTEN_FOOD_WORDS.test(name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""))) hints.push("gluten");
  if (hints.length) {
    const reason = `el nombre sugiere ${hints.map((h) => h.replace("_", " ")).join(", ")}: revisa los ingredientes`;
    return { name, level: "unknown", reason, reasons: [reason] };
  }

  // Para restricciones estrictas (celiaquía, alergias) "no sé" también es información. El alcohol no: se nota en qué es
  // el alimento, así que solo cuenta si el nombre lo sugiere (ver puedeTenerAlcohol).
  const strictTags = [...r.excluded.entries()].filter(([tag, x]) => x.strict && !(tag === "alcohol" && !puedeTenerAlcohol(name))).map(([tag]) => tag);
  if (strictTags.length) {
    const reason = strictTags.every((t) => t === "alcohol")
      ? "puede llevar alcohol (licor, vino…): pregunta cómo se preparó o revisa la etiqueta"
      : "no tengo datos de sus ingredientes para confirmarlo";
    return { name, level: "unknown", reason, reasons: [reason] };
  }
  return null;
}

/**
 * Texto para anexar a la respuesta de registrar/buscar. Vacío si no hay nada que avisar. Con un solo motivo va en
 * la misma línea; con varios (ej. sin mariscos + sin mostaza + sin alcohol, todos sin verificar) se listan como
 * sub-viñetas — antes iban unidos con punto y coma en una sola frase larga, más difícil de leer de un vistazo.
 */
export function formatRisks(risks: ItemRisk[], r: Restrictions): string {
  const list = risks.filter(Boolean);
  if (!list.length) return "";
  const blocked = list.filter((x) => x.level === "blocked");
  const unknown = list.filter((x) => x.level === "unknown");
  const itemLine = (x: ItemRisk, bold: boolean): string => {
    const label = bold ? `**${x.name}**` : x.name;
    if (x.reasons.length <= 1) return `- ${label}: ${x.reason}.`;
    return [`- ${label}:`, ...x.reasons.map((r) => `  - ${r}`)].join("\n");
  };
  const lines: string[] = [`⚠️ **Ojo con tus restricciones** (${r.labels.join(", ")}):`];
  for (const b of blocked) lines.push(itemLine(b, true));
  for (const u of unknown) lines.push(itemLine(u, false));
  if (blocked.length) lines.push("Ya quedó registrado tal cual; te lo aviso para que lo tengas presente.");
  return lines.join("\n");
}
