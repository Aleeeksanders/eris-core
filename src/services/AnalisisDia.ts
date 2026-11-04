// ============================================================
// Eris — «Analiza mi día» (revisión 2026-11-04, R1)
//
// El botón «Analizar con Eris →» de Inicio y «Analizar métricas» tardaban 85 a 192 s (chats reales): la app pegaba todo el
// contexto biométrico al texto, «análisis» activaba el modo Deep (con razonamiento), el selector ofrecía 20 herramientas y el
// contexto subía a 16.384 (fuera de la GPU). Ahora es una intención propia: la variable fuera de patrón la calcula el código
// (personal_baseline → BaselineEngine) y el modelo solo la redacta, en Flash.
// ============================================================

const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** «Profundiza en tu análisis de hoy…», «analiza mis métricas de hoy», «analiza mi día», «¿qué está fuera de mi patrón?» */
const ANALISIS_DIA = /\b(profundiza\w* (en )?(tu|el|mi) analisis|analiza\w* (mis |las )?metricas|analiza\w* (mi|el) dia|analisis (de|del) (mi |hoy|el )?dia|analisis de hoy|(que|cual) variable (esta )?fuera de (mi )?patron|fuera de mi patron( habitual)?)\b/;
/** Lo que pide otra cosa: plata, entreno, sueño puntual, AXS */
const OTRO = /\b(gast\w*|plata|finanzas|presupuesto|sueldo|entren\w*|gym|gimnasio|rutina|axs|boveda|reporte|proyecto\w*)\b/;

export function esAnalisisDia(message: unknown): boolean {
  const t = fold(message);
  return t.length <= 260 && ANALISIS_DIA.test(t) && !OTRO.test(t);
}

/** El bloque de datos que las versiones ≤1.78 de la app pegaban al final del mensaje (el servidor ya los tiene). */
export function sinContextoPegado(text: string): string {
  return String(text ?? "")
    // Inicio › «Analizar con Eris →»
    .replace(/\s*\[Contexto biom[eé]trico detallado:[\s\S]*\]\s*$/, "")
    // Métricas › «Analizar métricas»: «… de hoy. Aquí tienes mi estado detallado:\n\n<todo>\n\nBasado en esto, dame…»
    .replace(/\s*Aqu[ií] tienes mi estado detallado:[\s\S]*?\n\s*\n\s*Basado en esto,\s*/, ": ")
    .trim();
}
