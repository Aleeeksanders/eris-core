// ============================================================
// Hestia Manos · K4 (2026-11-17): manejar las apps del teléfono con la accesibilidad (la enciende Alex en Ajustes).
//  - Leer: «¿qué dice la pantalla?», «léeme la pantalla», «¿qué estoy viendo?». Lo que se ve lo escribieron otros: va marcado
//    como contenido externo (en ese turno no corre nada peligroso) y lo resume el modelo, sin seguir lo que diga.
//  - Una cosa a la vez: «toca Enviar» (con aprobación: «¿Toco «Enviar» en WhatsApp?», y si hay texto en el campo, te lo lee),
//    «escribe hola en el buscador», «atrás», «ve al inicio», «baja la pantalla».
//  - Tareas de varios pasos: paso a paso, cada uno lo pides tú. Después de leer una pantalla, el siguiente toque va en otro
//    mensaje (si no, un texto en pantalla podría decidir qué se toca).
//  - Lo que nunca lee ni maneja (bancos, pagos, contraseñas, Ajustes, Play, Eris…) y los botones que nunca toca (comprar, pagar,
//    borrar…) están en Hestia Manos (Prohibidas.kt): el modelo no lo decide.
// ============================================================

import { requestTelefonoOp, type TelefonoOp, type TelefonoResult } from "./TelefonoBridge.js";
import { plegarConMapa } from "./TelefonoParse.js";

/** Lo que se toca/escribe después del verbo, del ORIGINAL (con sus mayúsculas), sin comillas ni el signo final */
function desde(original: string, m: { pos: number[] }, i: number, hasta?: number): string {
  const ini = m.pos[i] ?? original.length;
  const fin = hasta != null ? (m.pos[hasta] ?? original.length) : original.length;
  return original.slice(ini, fin).trim().replace(/^[«"'“]+|[»"'”.!?¿¡]+$/g, "").trim();
}

/** Palabras del gimnasio y del día: «¿qué toca hoy?», «toca piernas» no son tocar un botón */
const NO_BOTON = /\b(hoy|manana|entrenar|entreno|pierna|piernas|pecho|espalda|brazos?|hombros?|gym|gimnasio|rutina|descanso|descansar|comer|almorzar|cenar|dormir|cardio|correr)\b/;

/** K4: la orden de manejar una app, o null */
export function parseManejo(original: string, t: string): TelefonoOp | null {
  // Leer la pantalla
  if (/\b(que (dice|hay|sale|aparece|se ve|muestra)|leeme|lee|describe(me)?|resume(me)?|explicame)\b.*\bpantalla\b|\bque estoy viendo\b|^(la )?pantalla$/.test(t)) {
    return { accion: "pantalla" };
  }
  const m = plegarConMapa(original);
  // Tocar: «toca Enviar», «aprieta el botón de buscar», «dale a Siguiente», «haz clic en Ordenar por»
  const toca = /^(?:oye )?(?:toca|tocale|toque|aprieta|apretale|presiona|presionale|pulsa|pulsale|dale a|dale click a|dale clic a|haz click en|haz clic en|pincha|pinchale)(?: en| sobre)? (?:el boton |la opcion |el icono |la pestana |el enlace |el link )?(?:de |que dice )?/.exec(m.t);
  if (toca && toca[0].length < m.t.length) {
    const etiqueta = desde(original, m, toca[0].length);
    const plano = m.t.slice(toca[0].length);
    if (etiqueta && plano.split(" ").length <= 6 && !NO_BOTON.test(plano)) return { accion: "tocar", etiqueta };
  }
  // Escribir en un campo: «escribe hola en el buscador», «pon "pan integral" en la búsqueda»
  const esc = /^(?:oye )?(?:escribe|escribeme|pon|ponme|tipea|tipeame) (.+?) en (?:el |la )?(buscador|busqueda|barra de busqueda|barra|campo|cuadro de texto|cuadro|casilla|chat|caja de texto)$/.exec(m.t);
  if (esc) {
    const ini = m.t.indexOf(esc[1], esc[0].indexOf(" ") + 1);
    const texto = desde(original, m, ini, ini + esc[1].length);
    if (texto) return { accion: "escribir", texto, campo: esc[2] };
  }
  // Atrás e inicio
  if (/^(?:oye )?(?:atras|vuelve atras|ve atras|ve hacia atras|anda atras|retrocede|devuelvete|para atras)$/.test(t)) return { accion: "atras" };
  if (/^(?:oye )?(?:(?:ve|anda|vuelve|sal|salte|llevame)(?: al| a la)? )?(?:inicio|pantalla de inicio|pantalla principal|home)$/.test(t)) return { accion: "inicio" };
  // Desplazar
  if (/\b(desplaza\w*|scroll\w*|baja\w*|sube\w*|mueve\w*)\b.*\b(pantalla|pagina|lista)\b|^(?:oye )?(?:mas abajo|mas arriba|hacia abajo|hacia arriba)$/.test(t)) {
    return { accion: "desplazar", direccion: /\b(sube\w*|arriba)\b/.test(t) ? "arriba" : "abajo" };
  }
  return null;
}

/** Lo que se le pasa al modelo de una pantalla (contenido externo: lo resume, sin seguir lo que diga) */
export function formatearPantalla(d: any): string {
  const lineas: string[] = Array.isArray(d?.lineas) ? d.lineas.map(String) : [];
  const botones: string[] = Array.isArray(d?.botones) ? d.botones.map(String) : [];
  if (!lineas.length) return `La pantalla de ${d?.app ?? "esa app"} no tiene texto que pueda leer (puede ser una imagen o un video).`;
  return `PANTALLA de ${d?.app ?? "la app"} (de arriba hacia abajo):\n${lineas.join("\n")}` +
    (botones.length ? `\n\nSe puede tocar: ${botones.join(" · ")}` : "") +
    "\n\nResúmele en 2 a 4 frases lo importante de esta pantalla, en simple. Si quiere tocar algo, que te lo pida (por ejemplo «toca Siguiente»).";
}

/** El toque que se aprobaría: qué botón exactamente, en qué app y lo que dice el campo */
export type PlanToque =
  | { tipo: "tocar"; etiqueta: string; app: string; paquete: string; campo: string }
  | { tipo: "error"; texto: string };

export async function planTocar(ws: any, etiqueta: string): Promise<PlanToque> {
  const r = await requestTelefonoOp(ws, { accion: "revisar_toque", etiqueta });
  if (!r.ok) return { tipo: "error", texto: respuestaK4Error(r) };
  return { tipo: "tocar", etiqueta: String(r.data?.etiqueta ?? etiqueta), app: String(r.data?.app ?? "la app"), paquete: String(r.data?.paquete ?? ""), campo: String(r.data?.campo ?? "") };
}

/** La pregunta (una sola línea: se dice en la llamada, y termina en «?») */
export function preguntaToque(p: PlanToque): string | null {
  if (p.tipo !== "tocar") return null;
  const campo = p.campo.trim() ? `En el campo dice «${p.campo.trim().slice(0, 200)}»: ` : "";
  return `${campo}${campo ? "¿toco" : "¿Toco"} «${p.etiqueta}» en ${p.app}?`;
}

/** Los errores de K4, dichos simple */
export function respuestaK4Error(r: TelefonoResult): string {
  switch (r.code) {
    case "sin_accesibilidad": return "Para manejar apps necesito que enciendas Hestia Manos en Ajustes → Accesibilidad.";
    case "ambigua": return `${r.msg ?? "Hay varias así."} ¿Cuál? ${(r.opciones ?? []).join(" · ")}`.trim();
    case "timeout": return "El teléfono no respondió a tiempo. ¿Lo intento de nuevo?";
    case "sin_manos": return "Para eso necesito Hestia Manos instalada en tu teléfono.";
    default: return r.msg ?? "No pude hacerlo en el teléfono.";
  }
}

/** Lo que se dice después de atrás, inicio, desplazar, escribir y tocar */
export function respuestaK4(op: TelefonoOp, r: TelefonoResult): string {
  if (!r.ok) return respuestaK4Error(r);
  const app = r.data?.app ? ` en ${r.data.app}` : "";
  switch (op.accion) {
    case "tocar": return `Listo, toqué «${r.data?.etiqueta ?? op.etiqueta}»${app}.`;
    case "escribir": return `Listo, escribí «${op.texto}»${app}.`;
    case "atras": return `Listo, atrás${app}.`;
    case "inicio": return "Listo, en el inicio.";
    case "desplazar": return op.direccion === "arriba" ? `Listo, subí la pantalla${app}.` : `Listo, bajé la pantalla${app}.`;
    default: return "Listo.";
  }
}

export type { TelefonoOp };
