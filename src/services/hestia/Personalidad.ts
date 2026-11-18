// ============================================================
// Hestia como JARVIS · L1 (2026-11-17): la personalidad en lo de siempre, por código y al instante (IM1: «For you, sir, always»).
// Corta, cortés, con humor seco y su alias de vez en cuando. Solo frases que son SOLO eso: «gracias, ¿y qué tengo mañana?» no
// entra (eso lo contesta el resto). «Eso es todo» en la llamada se despide y cuelga.
// ============================================================
import { esTitulo } from "../voz/Escaner.js";

const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,;:…]+/g, " ").replace(/\s+/g, " ").trim();
/** Sin «Hestia» al principio ni al final, ni muletillas sueltas */
const limpio = (t: string) => fold(t).replace(/^(oye |ya |ok |okay |bueno |listo )?h?estia /, "").replace(/ h?estia$/, "").replace(/^(oye|ya|ok|okay|bueno) /, "").trim();

const ESTAS = /^(estas (ahi|despierta|conmigo|por ahi)|sigues (ahi|despierta|conmigo)|hola estas|estas)$/;
const ESCUCHAS = /^(me (escuchas|oyes)|me escuchas bien|se escucha|me copias)$/;
const GRACIAS = /^((muchas |mil )?gracias( hestia)?( por todo)?|te pasaste|eres (la mejor|una seca)|bien hecho|(perfecto|listo|ya|genial) (muchas )?gracias)$/;
const ES_TODO = /^((eso|esto) (es|seria|era) todo( por (ahora|hoy))?( gracias)?|(gracias )?(eso es todo|nada mas|seria todo)( gracias)?|(listo|ya|ok) (eso es todo|nada mas)|chao|chau|adios|hasta luego|nos vemos|corto|cuelga|corta la llamada|cuelga la llamada)$/;

export interface RespuestaPersonalidad { texto: string; colgar?: boolean }

/** Una de dos, según el minuto (no siempre lo mismo, pero repetible en las pruebas con un reloj fijo) */
const una = (xs: string[], ahora: Date) => xs[ahora.getMinutes() % xs.length];

/**
 * ¿Lo último que dijo ella fue una pregunta (que no sea «¿algo más?»)? Entonces «gracias» o «ya, gracias» pueden ser la respuesta
 * («¿te lo anoto?» → «no, gracias»): eso lo ve el resto, con el contexto.
 */
export function esperaRespuesta(ultimaSuya: string | null | undefined): boolean {
  const u = String(ultimaSuya ?? "").trim();
  return /\?\s*$/.test(u) && !/algo m[aá]s\??\s*$/i.test(u);
}

export function personalidad(texto: string, o: { trato?: string | null; ahora?: Date; enLlamada?: boolean } = {}): RespuestaPersonalidad | null {
  const t = limpio(texto);
  if (!t || t.split(" ").length > 7) return null;
  const ahora = o.ahora ?? new Date();
  const trato = o.trato?.trim() || null;
  const usted = esTitulo(trato);
  const conNombre = (s: string) => (trato ? `${s}, ${trato}.` : `${s}.`);
  if (ESTAS.test(t)) return { texto: una([conNombre("Para ti, siempre"), usted ? "Aquí estoy, como siempre." : "Aquí, como siempre."], ahora) };
  if (ESCUCHAS.test(t)) return { texto: una(["Fuerte y claro.", conNombre("Te escucho perfecto")], ahora) };
  if (GRACIAS.test(t)) return { texto: una([conNombre(usted ? "A su servicio" : "A tu servicio"), "Para eso estoy."], ahora) };
  if (ES_TODO.test(t)) {
    const h = ahora.getHours();
    const adios = h >= 21 || h < 5 ? (usted ? "Que descanse" : "Que descanses") : usted ? "Que le vaya bien" : "Que te vaya bien";
    return { texto: conNombre(adios), colgar: o.enLlamada === true };
  }
  return null;
}
