// ============================================================
// Eris — secciones del prompt según las herramientas del turno
//
// El prompt de sistema explica cómo usar cada herramienta (registro de comida, asesor, Finanzas, síntomas). Si en este turno
// el modelo no ve esa herramienta, esas instrucciones solo ocupan contexto (y a veces lo empujan a nombrar algo que no
// tiene). Una sección marcada así
//   <!-- si: nutrition_tracker, carb_options -->
//   …
//   <!-- fin -->
// va solo cuando alguna de esas herramientas está a la vista. Lo que no está marcado va siempre.
// ============================================================

const SECTION = /<!--\s*si:\s*([^>]*?)\s*-->\n?([\s\S]*?)<!--\s*fin\s*-->\n?/g;

export function promptForTools(prompt: string, visible: Set<string>): string {
  if (!prompt.includes("<!--")) return prompt;
  return prompt
    .replace(SECTION, (_m, names: string, body: string) =>
      names.split(/[\s,]+/).filter(Boolean).some((n) => visible.has(n)) ? body : "")
    .replace(/\n{3,}/g, "\n\n");
}
