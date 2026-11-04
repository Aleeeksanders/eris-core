// ============================================================
// Eris — Intent
//
// Las herramientas deterministas (guía de síntomas, briefing, auditoría…) pueden responder al instante sin pasar por el
// modelo. Pero SOLO si el mensaje del usuario pide esa única cosa: si mezcla varias ("me duele la cabeza y qué como",
// "anota que comí pan y tomé agua"), la respuesta rápida se saltaría una parte, así que ahí se sigue el camino de siempre
// (el modelo con sus herramientas). `isPure` es esa comprobación, deliberadamente conservadora: ante la duda, no es pura.
// ============================================================

import { looksLikeSymptom } from "./SymptomGuide.js";

export type Intent = "food" | "water" | "glucose" | "train" | "axs" | "symptom" | "advisor" | "finance" | "inventory" | "supplement";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const RX: Record<Exclude<Intent, "symptom">, RegExp> = {
  food: /\b(comi|comer|comimos|desayun\w*|almorc\w*|almuerz\w*|cene|cenar|onces?|colacion|kcal|calorias?)\b/,
  water: /\b(agua|litros?|ml|mililitros?|vasos?|botellas?|hidrat\w*)\b/,
  glucose: /\b(glucos\w*|glucemia|azucar|insulina|hipoglucemia|hiperglucemia)\b/,
  train: /\b(entren\w*|rutina|gym|gimnasio|ejercicio)\b/,
  axs: /\b(axs|boveda|vault|notas?|proyectos?|pendientes?|roadmap|briefing|lander|toji)\b/,
  advisor: /\b(que como|que comer|que compro|receta\w*|dieta|tengo hambre|despensa)\b/,
  finance: /\b(gaste|gastamos|pague|compre|lucas?|luquitas?|palos?|pesos|plata|efectivo|cajero|saque|gire|transferi|deposit\w*|abon\w*|preste|devolvio|ahorre|sueldo|finanzas|saldos?|tarjeta)\b|\$\s?\d/,
  inventory: /\b(inventario|despensa|refri\w*|botiquin|stock|lista de (las )?compras?|se (me )?(acabo|acabaron|termino|agoto|vencio)|por vencer|bote|tire|repuse)\b/,
  // Suplementos (fase I5)
  supplement: /\b(suplement\w*|creatina|omega ?3|vitamina\w*|magnesio|zinc|hierro|b12|whey|cafeina|electrolitos|calcio|colageno|multivitaminico)\b/,
};

/** Qué tipos de pedido aparecen en el mensaje. */
export function intentsIn(message: string): Set<Intent> {
  const t = fold(message);
  const out = new Set<Intent>();
  for (const [k, re] of Object.entries(RX) as Array<[Exclude<Intent, "symptom">, RegExp]>) if (re.test(t)) out.add(k);
  if (looksLikeSymptom(message)) out.add("symptom");
  return out;
}

/**
 * ¿El mensaje pide SOLO lo que la herramienta resuelve (`own`)? Si no hay mensaje (llamada directa, pruebas) o es largo
 * (más de una idea), no es puro y la respuesta rápida no se usa.
 */
export function isPure(message: unknown, own: Intent[]): boolean {
  if (typeof message !== "string" || !message.trim() || message.length > 240) return false;
  for (const i of intentsIn(message)) if (!own.includes(i)) return false;
  return true;
}
