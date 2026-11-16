// ============================================================
// Hestia por voz (J3, 2026-11-16): menos herramientas por turno en la llamada. Con este modelo, Ollama lee el prompt entero en cada
// pasada (no reutiliza el caché) y leerlo es lo que más tarda: 4 064 tokens en 6 s para «busca en la bóveda qué dice de Toji», que
// llevaba las 8 herramientas de la bóveda. Dentro de los grupos de la bóveda y del PC quedan solo las que el mensaje pide; si no se
// reconoce ninguna, el grupo completo (como antes).
// ============================================================

const fold = (t: string) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** [herramienta, lo que la pide] por grupo */
const BOVEDA: Array<[string, RegExp]> = [
  ["knowledge_search", /\bbusca|que dice|que sabes|que hay (de|sobre)|informacion|donde (esta|dice)|documentacion|de que se trata|explicame/],
  ["axs_briefing", /briefing|pendiente|como va|resumen|en que estamos|que (tengo|hay) (en|de|para) axs|prioridad|lo inmediato|estado de/],
  ["vault_note", /(crea|haz|escribe|anota|guarda|agrega|arma)\w*\s.{0,25}\bnota\b|\bnota nueva\b/],
  ["crystallize", /decision|decidi|decidimos|cristaliz/],
  ["vault_audit", /audit|revisa la boveda|enlaces rotos|huerfan|salud de la boveda|como esta la boveda/],
  ["vault_healer", /repara|arregla.{0,25}boveda/],
  ["log_management", /\blog\b|bitacora|registro del dia/],
  ["executive_report", /reporte|informe ejecutivo/],
];
const PC: Array<[string, RegExp]> = [
  ["open", /\babr(e|ir|eme|ime|elo|ela)\b|\blanza|\binicia\b|\bpon(e|me)? (musica|un video|la cancion)/],
  ["bash", /comando|proceso|programa|memoria|\bram\b|\bcpu\b|disco|espacio|carpeta|archivo|borra|elimina|mueve|copia|instal|revisa|cuanto pesa|powershell|terminal/],
  ["system_info", /memoria|\bram\b|\bcpu\b|disco|espacio|sistema|bateria|temperatura|como esta (el|mi) pc/],
  ["file_read", /\blee\b|leeme|que dice el archivo|contenido del archivo/],
  ["file_write", /escribe (un|en un|el) archivo|crea (un|el) archivo|guarda(lo)? en un archivo|archivo nuevo/],
];

function afinarGrupo(t: string, tools: Set<string>, grupo: Array<[string, RegExp]>): void {
  const del = grupo.filter(([n]) => tools.has(n));
  if (del.length < 2) return;
  const piden = del.filter(([, re]) => re.test(t)).map(([n]) => n);
  if (!piden.length) return; // no se reconoce: el grupo completo
  for (const [n] of del) if (!piden.includes(n)) tools.delete(n);
}

/**
 * Las herramientas de la bóveda que el mensaje pide (las demás de ese grupo salen). Devuelve un conjunto nuevo.
 * El PC NO se afina: sus 5 herramientas pesan poco (~2 400 caracteres) y con una sola a la vista el modelo de 4B dejaba de
 * llamarla («Te lo abro.» y nada; banco «voz», 3 de 3 casos). `PC` queda para `pcPide` (las pruebas y lo que venga).
 */
export function afinarVoz(mensaje: string, tools: Set<string>): Set<string> {
  const out = new Set(tools);
  afinarGrupo(fold(mensaje), out, BOVEDA);
  return out;
}

/** Qué herramientas del PC pide el mensaje (sin quitar nada) */
export function pcPide(mensaje: string): string[] {
  const t = fold(mensaje);
  return PC.filter(([, re]) => re.test(t)).map(([n]) => n);
}

/** ¿Habla de algo anterior? («lo que hablamos ayer», «te dije», «la otra vez»): ahí sí va el resumen de la llamada anterior */
export const MENCIONA_ANTES = /\b(antes|ayer|anoche|la otra vez|la vez pasada|la llamada|te dije|me dijiste|hablamos|quedamos|conversamos|hace rato|recuerdas|te acuerdas|lo de (la manana|anoche|hace rato|ayer))\b/;
export const mencionaAntes = (mensaje: string) => MENCIONA_ANTES.test(fold(mensaje));
