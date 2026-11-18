// ============================================================
// Hestia por voz (J2, 2026-11-16): lo que se responde por código en la llamada, sin pasar por el modelo.
// La hora y la fecha: el modelo tardaba 3,4 s y agregaba comentarios («Ya te avisé que hoy es lunes… ¿Qué te pasa?», banco «voz»).
// ============================================================

const normalizar = (t: string) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** Un saludo o un vocativo delante («oye», «Hestia», «oye Hestia») no cambia la pregunta */
const PREVIO = /^((oye|hola|ya|ok|okey|y|hestia|oye hestia|hola hestia|hestia oye)\s+)*/;

const HORA = /^(que hora (es|son)|me (dices|das) la hora|dime la hora|que hora tenemos|la hora|tienes la hora)( porfa| por favor)?$/;
// («¿a cuánto estamos?», «¿qué día es?»: banco telefono_banco, 2026-11-17)
const FECHA = /^(que (dia|fecha) (es|tenemos)( hoy)?|a que (dia|fecha) estamos( hoy)?|que dia es hoy|dime la fecha|en que (dia|fecha) estamos|a cuanto estamos( hoy)?|que fecha es)( porfa| por favor)?$/;

/** «Son las 7:52.» / «Hoy es lunes 16 de noviembre.» (en cifras: Hablar las dice en palabras). null = no es una pregunta así. */
export function respuestaDirecta(texto: string, ahora: Date = new Date()): string | null {
  const n = normalizar(texto).replace(PREVIO, "");
  if (HORA.test(n)) {
    const h = ahora.getHours(), m = ahora.getMinutes();
    const hm = `${h}:${String(m).padStart(2, "0")}`;
    return h === 1 || h === 13 ? `Es la ${hm}.` : `Son las ${hm}.`;
  }
  if (FECHA.test(n)) {
    const dia = ahora.toLocaleDateString("es-CL", { weekday: "long" });
    const mes = ahora.toLocaleDateString("es-CL", { month: "long" });
    return `Hoy es ${dia} ${ahora.getDate()} de ${mes}.`;
  }
  return null;
}
