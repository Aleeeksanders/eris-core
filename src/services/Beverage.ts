// ============================================================
// Eris — ¿es una bebida?
//
// Vive aparte de NutritionTool para que la cuenta del agua (WaterToday, FoodWater) la use sin cargar la herramienta.
// La app tiene la misma regla en eris-mobile/src/services/beverage.ts.
// ============================================================

/** ¿Este alimento es una bebida? Su tipo para la meta de agua (la leche, el yogur y la sopa cuentan como comida). */
export function beverageTypeOf(name: string): string | null {
  const t = String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(leche|yogur|yoghurt|yogurt|batido|smoothie|sopa|caldo|cazuela)\b/.test(t)) return null;
  if (/\b(cerveza|vino|pisco|piscola|ron|whisky|vodka|trago)\b/.test(t)) return "alcohol";
  if (/\b(isotonic\w*|gatorade|powerade)\b/.test(t)) return "bebida_isotonica";
  if (/\b(jugo|nectar)\b/.test(t)) return /\b(natural|exprimido)\b/.test(t) ? "jugo_natural" : "jugo_artificial";
  if (/\b(cafe|te|infusion|mate)\b/.test(t)) return "te_cafe";
  if (/\b(coca|cola|bebida|gaseosa|fanta|sprite|pepsi|energetica|red ?bull|monster|limonada|kombucha)\b/.test(t)) return "bebida_fantasia";
  if (/\bagua\b/.test(t)) return "agua";
  return null;
}

/** "355 ml" para una bebida, "120 g" para lo demás: como se ingresa en la app (2026-10-15, antes todo salía en gramos). */
export function amountText(name: string, grams: number): string {
  return `${Math.round(grams)} ${beverageTypeOf(name) ? "ml" : "g"}`;
}
