// ============================================================
// Hestia como JARVIS · L3 (2026-11-17): el entrenador en el oído. En la llamada con Hestia, por código (sin el modelo):
//  - «vamos a entrenar» → lo de hoy y la primera serie: «Press de banca: serie 1 de 4, 60 kg por 6 a 8»;
//  - «hice 8», «hice 8 con 62,5», «6 y 3 negativas», «8 al fallo», «me quedaron 2» → se anota en Forge (ForgeBridge) con la
//    carga que no dijiste (la de tu serie anterior o la del objetivo), y «Descansa dos minutos y medio»;
//  - el descanso contado: «Un minuto», «Treinta segundos» y «Vamos: serie 3 de 4…» (lo que Forge ya aprendió de tus descansos);
//  - «¿qué sigue?», «¿cuánto me falta?», «ya estoy» (corta el descanso), «dame 30 segundos más», «¿cuánto me queda?»;
//  - los récords: «¡Nuevo récord, Alesito! Máximo estimado de unos 82 kg»;
//  - «borra la última serie» (con tu «sí»), «terminé» → el resumen del día.
// Funciona con el teléfono bloqueado (entrenas con el teléfono en el bolsillo): solo anota tus series, nada más.
// ============================================================
import { esTitulo } from "../voz/Escaner.js";

export type PedidoEntreno =
  | { tipo: "empezar" }
  | { tipo: "serie"; reps: number; kg: number | null; rir: number | null; neg: number | null; ejercicio: string | null }
  | { tipo: "sigue" }
  | { tipo: "cuanto_falta" }
  | { tipo: "descanso_cortar" }
  | { tipo: "descanso_mas"; segundos: number }
  | { tipo: "descanso_menos"; segundos: number }
  | { tipo: "descanso_cuanto" }
  | { tipo: "borrar" }
  | { tipo: "terminar" };

/** Sin tildes ni mayúsculas; los decimales con punto («62,5» → «62.5») y sin «Hestia» al comienzo */
export function plegarEntreno(texto: string): string {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2").replace(/[¿?¡!;:«»"]+/g, " ").replace(/,/g, " ").replace(/\.(?!\d)/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^(?:(?:oye|ok|okey|ya|bueno) )?h?estia /, "").replace(/ (?:por favor|porfa|po)$/, "").trim();
}

const NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100 };
const N = `(\\d+(?:\\.\\d+)?|${Object.keys(NUM).join("|")})`;
const num = (s: string | undefined): number | null => (s == null ? null : /^\d/.test(s) ? Number(s) : NUM[s] ?? null);

// («anota» y «registra» NO: «Anota un gasto de 5 mil pesos» era una serie de 1 repetición: banco «voz», 2026-11-17)
const VERBO = /^(?:ya )?(?:hice|saque|salieron|me salieron|fueron|complete|logre|alcance a hacer)\s+/;
const NO_SERIE = /\b(km|kilometros?|metros?|minutos?|horas?|pasos|kilometro|calorias|kcal|litros?|vasos?|platos?|tareas?|cosas?|pesos|lucas|mil|gasto|plata|cuotas?|dias?|semanas?|meses|veces al dia)\b/;

/**
 * Lo que dice en el gimnasio. `activo`: ya está entrenando (dijo «vamos a entrenar» o anotó una serie en esta llamada):
 * ahí basta «8 con 60», «¿qué sigue?» o «terminé». `descansando`: hay un descanso corriendo («ya estoy», «¿cuánto me queda?»).
 */
export function pideEntreno(texto: string, o: { activo: boolean; descansando: boolean }): PedidoEntreno | null {
  const t = plegarEntreno(texto);
  if (!t || t.length > 120) return null;
  if (/^(?:vamos a entrenar|empecemos (?:el |a )?entren\w*|empieza el entreno|empecemos|modo (?:entrenador|gym|gimnasio)|entrenemos|comencemos (?:el )?entreno|arranquemos (?:el )?entreno|a entrenar|estoy en el (?:gym|gimnasio)|llegue al (?:gym|gimnasio)|empezamos el entreno|vamos con el entreno)$/.test(t)) return { tipo: "empezar" };
  if (/\b(?:borra|elimina|quita|borrame|eliminame|quitame)(?: la)? ultima serie\b|\bme equivoque\b.*\b(?:borra|elimina|quita)\w*\b/.test(t)) return { tipo: "borrar" };
  if (/^(?:ya )?termine(?: el| mi)? entreno$|^(?:listo|fin del|se acabo el) entreno$/.test(t) || (o.activo && /^(?:termine|terminamos|ya termine|listo por hoy|eso es todo por hoy|eso fue todo)$/.test(t))) return { tipo: "terminar" };
  // el descanso
  if (o.descansando) {
    if (/^(?:ya estoy|estoy listo|listo|vamos|dale|corta el descanso|termina el descanso|ya descanse|sin descanso|vamos de nuevo|siguiente serie)$/.test(t)) return { tipo: "descanso_cortar" };
    if (/^cuanto (?:me )?(?:queda|falta)(?: de descanso)?$|^cuanto descanso me queda$/.test(t)) return { tipo: "descanso_cuanto" };
  }
  if (o.activo || o.descansando) {
    const mas = new RegExp(`^(?:dame |quiero |necesito )?(?:${N} (segundos?|minutos?) mas|mas descanso|un poco mas(?: de descanso)?|un minuto mas)(?: de descanso)?$`).exec(t);
    if (mas) { const n = num(mas[1]) ?? 1; const u = mas[2] ?? (/minuto/.test(t) ? "minuto" : "segundos"); return { tipo: "descanso_mas", segundos: Math.round(mas[1] ? (/^min/.test(u) ? n * 60 : n) : /un minuto/.test(t) ? 60 : 30) }; }
    const menos = new RegExp(`^(?:quita(?:le)?|menos|saca(?:le)?) ${N} segundos(?: de descanso)?$`).exec(t);
    if (menos) return { tipo: "descanso_menos", segundos: num(menos[1]) ?? 15 };
  }
  if (/^(?:que sigue|cual sigue|y ahora que|que me toca ahora|que viene|cual es la siguiente(?: serie)?|que hago ahora|siguiente ejercicio)$/.test(t) && (o.activo || o.descansando)) return { tipo: "sigue" };
  if (/\bque (?:sigue|me toca) en (?:el|mi) entreno\b/.test(t)) return { tipo: "sigue" };
  if (o.activo && /^(?:cuanto me falta|cuantas (?:series )?me (?:faltan|quedan)|cuanto queda(?: del entreno)?|como voy)$/.test(t)) return { tipo: "cuanto_falta" };
  return serieDicha(t, o.activo);
}

/** «hice 8 con 62.5», «8 al fallo», «6 y 3 negativas», «hice 10 de sentadilla con 80 y me quedaron 2» */
export function serieDicha(t: string, activo: boolean): PedidoEntreno | null {
  const v = VERBO.exec(t);
  if (!v && !activo) return null;
  const resto = v ? t.slice(v[0].length) : t;
  const m = new RegExp(`^${N}(?:\\s+(?:reps?|repeticiones|veces|segundos))?\\b`).exec(resto);
  if (!m) return null;
  const reps = num(m[1]);
  if (reps == null || reps < 1 || reps > 300 || !Number.isInteger(reps)) return null;
  const cola = resto.slice(m[0].length);
  if (NO_SERIE.test(cola.replace(/\bsegundos\b/, ""))) return null;
  // sin verbo (ya entrenando) solo si es corto y parece una serie: «8 con 60», «8», «diez al fallo»
  if (!v && cola.split(" ").filter(Boolean).length > 9) return null;
  const kgM = new RegExp(`\\b(?:con|a) ${N}(?: y medio)?(?:\\s*(?:kilos?|kg|libras?|lb))?\\b`).exec(cola);
  let kg = kgM ? num(kgM[1]) : null;
  if (kg != null && /\by medio\b/.test(kgM![0])) kg += 0.5;
  const rirM = new RegExp(`\\b(?:me )?(?:quedaron|quedaban|quedo|quedaba|dejo|deje) ${N}(?: (?:en reserva|de reserva|mas|en el tanque))?\\b|\\b${N} en reserva\\b`).exec(cola);
  const rir = /\b(?:al fallo|hasta el fallo|fallo)\b/.test(cola) ? 0 : rirM ? num(rirM[1] ?? rirM[2]) : null;
  const negM = new RegExp(`\\by ${N} negativas?\\b`).exec(cola);
  const ejM = /\b(?:de|en) ((?!reserva\b|descanso\b|ayuda\b)[a-z][a-z ]{2,40}?)(?= con | a \d| y | al fallo| me |$)/.exec(cola);
  return { tipo: "serie", reps, kg: kg != null && kg > 0 && kg <= 1000 ? kg : null, rir: rir != null && rir >= 0 && rir <= 10 ? rir : null, neg: negM ? num(negM[1]) : null, ejercicio: ejM ? ejM[1].trim() : null };
}

// ─── Lo que dice ───
/** 150 → «dos minutos y medio», 90 → «un minuto y medio», 200 → «3 minutos y 20 segundos», 45 → «45 segundos» */
export function duracionVoz(secs: number): string {
  const s = Math.max(0, Math.round(secs / 5) * 5);
  if (s < 60) return `${s} segundos`;
  const m = Math.floor(s / 60), r = s % 60;
  const mins = m === 1 ? "un minuto" : m === 2 ? "dos minutos" : `${m} minutos`;
  if (!r) return mins;
  if (r === 30) return `${mins} y medio`;
  return `${mins} y ${r} segundos`;
}

export interface SerieQueSigue { exId: string; nombre: string; serie: number; de: number | null; carga: string | null; reps: string | null; cambio: boolean }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Press de banca: serie 2 de 4, 62,5 kg por 8.» / «Sigue sentadilla: serie 1 de 3, 80 kg por 6 a 8.» */
export function textoSigue(s: SerieQueSigue | null | undefined): string {
  if (!s) return "No tengo una serie que siga en tu plan de hoy.";
  const cuerpo = `serie ${s.serie}${s.de ? ` de ${s.de}` : ""}${s.carga ? `, ${s.carga}` : ""}${s.reps ? ` por ${s.reps}` : ""}`;
  return s.cambio ? `Sigue ${s.nombre}: ${cuerpo}.` : `${cap(s.nombre)}: ${cuerpo}.`;
}

export interface SesionVoz {
  hayPlan: boolean; descansoRutina: boolean; nombreDia: string | null; hechas: number; total: number | null; ejercicios: number;
  sigue: SerieQueSigue | null; listo: boolean; descanso: { quedan: number; siguiente: string } | null;
  ultima: { exId: string; nombre: string; texto: string; at: number } | null;
}

const conTrato = (t?: string | null) => (t ? `, ${t}` : "");

/** «Vamos, Alesito. Hoy toca Empuje: 5 ejercicios, 16 series. Press de banca: serie 1 de 4, 60 kg por 6 a 8.» */
export function textoEmpezar(s: SesionVoz, trato?: string | null): string {
  if (!s.hayPlan) {
    return s.descansoRutina
      ? `Hoy tu rutina dice descanso${conTrato(trato)}. Si igual entrenas, dime lo que hagas, por ejemplo «hice 8 de sentadilla con 60», y lo anoto.`
      : `No tienes un plan para hoy en Forge${conTrato(trato)}. Dime lo que hagas, por ejemplo «hice 8 de sentadilla con 60», y lo anoto.`;
  }
  if (s.listo) return `Ya hiciste todo el plan de hoy${conTrato(trato)}: ${s.hechas} series. Si sigues, lo anoto igual.`;
  const dia = s.nombreDia ? `Hoy toca ${s.nombreDia}: ` : "Hoy: ";
  const lleva = s.hechas ? `, llevas ${s.hechas}` : "";
  return `Vamos${conTrato(trato)}. ${dia}${s.ejercicios} ${s.ejercicios === 1 ? "ejercicio" : "ejercicios"}, ${s.total} series${lleva}. ${textoSigue(s.sigue)}`;
}

/** Lo que dice al anotar una serie (lo que quedó de verdad en Forge) */
export function textoSerie(d: any, trato?: string | null): string {
  const partes = [`Anotada: ${d?.anotada?.texto ?? "la serie"}.`];
  if (d?.record) partes.push(`¡Nuevo récord${conTrato(trato)}! ${cap(String(d.record))}.`);
  if (d?.listo) partes.push(`Plan de hoy listo: ${d?.sesion?.hechas ?? ""} series. Buen trabajo.`.replace(":  series", ""));
  else if (d?.descanso?.secs > 0) partes.push(`Descansa ${duracionVoz(d.descanso.secs)}.`);
  else if (d?.sigue) partes.push(textoSigue(d.sigue));
  return partes.join(" ");
}

/** «Llevas 6 de 16 series; te quedan 10. Sigue: …» */
export function textoFalta(s: SesionVoz): string {
  if (!s.hayPlan) return `Hoy llevas ${s.hechas} ${s.hechas === 1 ? "serie" : "series"}; no tienes un plan para hoy en Forge.`;
  if (s.listo) return `Ya hiciste todo el plan: ${s.hechas} series.`;
  const quedan = Math.max(0, (s.total ?? 0) - s.hechas);
  return `Llevas ${s.hechas} de ${s.total} series; te quedan ${quedan}. ${textoSigue(s.sigue)}`;
}

/** El resumen al terminar */
export function textoTerminar(d: { series: number; minutos: number; kcal: number }, records: string[], trato?: string | null): string {
  if (!d?.series) return `Hoy no anotaste series${conTrato(trato)}. Cuando entrenes, dime lo que hagas y lo anoto.`;
  const rec = records.length ? ` ${records.length === 1 ? "Un récord" : `${records.length} récords`} hoy.` : "";
  return `Listo${conTrato(trato)}: ${d.series} ${d.series === 1 ? "serie" : "series"} en ${d.minutos} minutos, unas ${d.kcal} kcal.${rec} ${esTitulo(trato) ? "Buen trabajo." : "Buen entreno."}`;
}

/** Los avisos del descanso: a 1 minuto y a 30 segundos del final (lo que quepa) */
export function hitosDescanso(secs: number): Array<{ en: number; texto: string }> {
  const out: Array<{ en: number; texto: string }> = [];
  if (secs >= 100) out.push({ en: secs - 60, texto: "Un minuto." });
  if (secs >= 55) out.push({ en: secs - 30, texto: "Treinta segundos." });
  return out;
}
