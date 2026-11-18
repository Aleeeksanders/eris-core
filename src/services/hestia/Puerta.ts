// ============================================================
// Hestia como JARVIS · C1 (2026-11-17): la puerta de Hestia, una sola. REGLA del usuario: «todo lo que pido en Hestia es sólo
// Hestia» — su cuenta (rol ikaros) en Modo AXS. Eris y sus usuarios no reciben ni ven nada de lo de Hestia como JARVIS (pausa,
// vigía, avisos, protocolos…). Todo lo nuevo pregunta acá.
// ============================================================

/** ¿Es la cuenta de Ikaros? (el panel AXS, los avisos del equipo) */
export const esIkaros = (ws: any): boolean => ws?.data?.role === "ikaros" && ws?.data?.authenticated !== false;
/** ¿Le está hablando a Hestia? (Ikaros con la app en Modo AXS: el chat y la llamada de Hestia) */
export const esHestia = (ws: any): boolean => esIkaros(ws) && ws?.data?.persona === "hestia";

/** Las conexiones de Ikaros (para un aviso de Hestia: nunca a un usuario de Eris) */
export function conexionesIkaros(clientes: Map<string, Set<any>>): any[] {
  const out: any[] = [];
  for (const set of clientes.values()) for (const ws of set) if (esIkaros(ws)) out.push(ws);
  return out;
}
