// ============================================================
// (2026-11-17, su pedido: «todo lo que reviso y lo que pido es referente al celu, nunca al PC») ¿Habla del PC? Si no, Hestia hace
// todo en el teléfono: las herramientas del PC (bash, open, archivos, system_info) quedan fuera de ese turno (QueryEngine: sinPC).
// En su primera llamada real «Abre la aplicación» terminó en explorer.exe y «abre el calendario» en «¿te lo busco en tu PC?».
// Vale en la llamada y en el chat de AXS desde el teléfono; en la web del PC no se aplica.
// ============================================================

const PC = /\b(pc|computador\w*|compu|notebook|laptop|escritorio|windows|powershell|terminal|consola|carpetas?|archivos?|disco|ram|cpu|servidor|ollama|whisper|piper|procesos?|descargas|documentos|navegador del (pc|computador))\b/;

const plegar = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** «Abre la aplicación» / «ábrela» sin decir cuál (y sin un tema reciente que lo diga): se pregunta, no se adivina */
export function abreSinDecirCual(texto: string): boolean {
  const t = plegar(texto).replace(/[¿?¡!.,;:]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(?:(?:oye|ok|ya|bueno) )?h?estia /, "");
  return /^(?:abre(?:me)?|abrela|abrelo|abrir|abreme esa|abre esa) ?(?:la (?:app|aplicacion)|una (?:app|aplicacion)|esa (?:app|aplicacion)|la app del (?:telefono|celular|celu))?$/.test(t);
}

/**
 * ¿Lo que dijo nombra el PC? También si lo anterior de Hestia fue en el PC (un «sí, ábrelo» después de «¿abro el archivo?»).
 * `previa` = la última respuesta de Hestia (con las herramientas que usó).
 */
export function nombraPC(texto: string, previa?: { trace?: { tools?: string[] } } | null): boolean {
  if (PC.test(plegar(texto))) return true;
  const tools = previa?.trace?.tools ?? [];
  return tools.some((t) => ["bash", "open", "file_read", "file_write", "system_info"].includes(t));
}
