// ============================================================
// Hestia por voz (2026-11-17, pedido del usuario: «que reconozca sólo mi voz y dirigida a ella»). En una llamada, todo lo que
// oía lo tomaba como para ella, también una conversación al lado («el de Michael me pasó la suya…»). Con el modo «solo si digo
// Hestia», el teléfono ignora (y ni manda) lo que no la nombra, salvo el «sí» o «no» a una pregunta suya. Se activa con un botón
// en la llamada o diciéndolo; acá se entiende el comando (por código) y se le avisa a la app (`voz_modo`).
// ============================================================

const fold = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;:«»"]+/g, " ").replace(/\s+/g, " ").trim();

const ACTIVAR = /\b(solo|nada mas) (cuando|si) te (hablo|hable|nombro|nombre|llamo|llame|digo (tu nombre|hestia))\b|\bresponde(me)? solo (cuando|si) te (hablo|nombro|llamo|digo hestia)\b|\bmodo (reunion|con gente|dirigido|privado)\b|\bno (me )?respondas (a todo|lo que no es para ti)\b/;
const APAGAR = /\b(escuchame|escucha|respondeme|responde) (siempre|todo)\b|\bmodo normal\b|\b(ya )?no hace falta (que te nombre|decir tu nombre|decir hestia)\b|\b(sal|salte) del modo (reunion|con gente|dirigido|privado)\b/;

/** «Hestia, solo cuando te hable» → true; «escúchame siempre» → false; null si no es eso */
export function modoDirigido(texto: string): boolean | null {
  const t = fold(texto);
  if (t.length > 120) return null;
  if (APAGAR.test(t)) return false;
  if (ACTIVAR.test(t)) return true;
  return null;
}

/** Lo que dice al cambiar de modo (con el «Nombre o alias» del perfil, si hay) */
export function respuestaModo(dirigido: boolean, trato?: string | null): string {
  const t = trato ? `, ${trato}` : "";
  return dirigido
    ? `Listo${t}: desde ahora te respondo solo cuando me digas «Hestia».`
    : `Listo${t}: te escucho siempre.`;
}

/** ¿La frase la nombra? (como la deja el reconocimiento: «Hestia», «Estia») — la misma cuenta que la app (HestiaLlamada) */
export const LA_NOMBRA = /\bh?estia\b/i;
