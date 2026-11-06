// ============================================================
// Eris — el tono con que habla (lo elige la persona)
//
// 2026-10-14, pedido del usuario: "que el lenguaje sea según la generación de la persona, para que se sientan mejor
// acompañados". Amarrarlo solo a la edad cae en estereotipos y la jerga envejece rápido, así que la edad SOLO sugiere uno
// y la persona elige (bienvenida y Perfil). Los datos son los mismos en los tres: cambia la forma, nunca el contenido.
//   humor   — cercano y con humor: tutea, cálido, algún emoji
//   directo — cercano y directo: tutea, al grano, casi sin emojis
//   usted   — de usted: respetuoso y cálido, sin emojis ni jerga (a mucha gente mayor en Chile le cae mejor que el tuteo)
// ============================================================

//   brigida — (2026-11-05, pedido del usuario: «me gustaría que fuera más brígida, tú me entiendes») sin anestesia: el
//             veredicto primero, opina, pica cuando se está quedando; garabatos solo si la persona los usa primero. Nunca con
//             el cuerpo ni la comida (medir sin obsesión) y seria ante síntomas, duelo o plata complicada.

export type Tone = "humor" | "directo" | "usted" | "brigida";
export const TONES: Tone[] = ["humor", "directo", "usted", "brigida"];
export const DEFAULT_TONE: Tone = "directo";

export const isTone = (x: unknown): x is Tone => typeof x === "string" && (TONES as string[]).includes(x);

/** Sugerencia por edad (solo para preseleccionar; la persona elige). Sin edad: cercano y directo. */
export function toneForAge(age?: number | null): Tone {
  if (typeof age !== "number" || !Number.isFinite(age)) return DEFAULT_TONE;
  if (age < 35) return "humor";
  if (age >= 60) return "usted";
  return "directo";
}

export async function getTone(memory: { get(k: string): Promise<any> } | null | undefined): Promise<Tone | null> {
  try { const t = await memory?.get("tone"); return isTone(t) ? t : null; } catch { return null; }
}

/** Garabatos chilenos (sin tildes). Sin «pico» ni «huevo»: «las 3 y pico», «un huevo duro». */
const GARABATO = /\b(weon\w*|weona\w*|wn|wna|aweona\w*|hue(a|as|on|ona|ones|onas|ada|adas)|huevad\w*|huevon\w*|weas?|weaa+|conchetumadre|conchetumare|ctm|csm|chucha|puta|puto|mierda|cagad\w*|cague|culiao|culia\w*)\b/;
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** ¿La persona usó garabatos en lo que dijo? (para que Eris brígida solo los use si la persona los usó primero) */
export function usaGarabatos(dichos: string[]): boolean {
  return dichos.some((d) => GARABATO.test(fold(String(d ?? ""))));
}

/**
 * La instrucción para el chat (va en cada consulta, así un cambio se nota al tiro). `garabatos`: la persona los usó en esta
 * conversación; `serio`: el mensaje trae un síntoma o una alarma (el tono «brígida» se pone serio).
 */
export function toneInstruction(t: Tone, o: { garabatos?: boolean; serio?: boolean } = {}): string {
  if (t === "brigida") {
    if (o.serio) return "[Tono que eligió el usuario: brígida, pero ahora habla de un síntoma] Tutéalo, seria, clara y cálida: sin bromas, sin picarlo ni garabatos.";
    return "[Tono que eligió el usuario: brígida] Háblale como una amiga chilena con calle que no se anda con rodeos. Tutéalo, frases cortas. " +
      "La primera oración es el veredicto («Sí.», «No.», «Más o menos:», «Vas atrasado.») y después el dato que lo respalda. " +
      "Opina y juégatela con una recomendación concreta; si se está quedando o pone excusas, pícalo con cariño («ya po», «sin cuento»). " +
      "Nada de sermones que no pidió, nada de rellenos ni de «¿quieres que…?» al final (máximo una pregunta, solo si hace falta), casi sin emojis. " +
      "Quédate en el tema que preguntó: no le saques la comida, el agua ni el cuerpo si no los preguntó. " +
      "Nunca te burles de su cuerpo, su peso ni de lo que comió, y nunca contradigas sus cifras. Ante duelo o problemas serios de plata: seria y cálida. " +
      (o.garabatos ? "En esta conversación usó garabatos: puedes soltar alguno suave (huevada, weón) si sale natural, nunca para insultar."
        : "Sin garabatos: no los ha usado.");
  }
  if (t === "usted") {
    return "[Tono que eligió el usuario: de usted] Trátalo de usted en todo (usted, su, le, «cuénteme», «tome»; nunca tú, te, tu ni «cuéntame»). " +
      "Cálido y respetuoso, frases claras y cortas, sin emojis ni jerga.";
  }
  if (t === "humor") {
    return "[Tono que eligió el usuario: cercano y con humor] Tutéalo con calidez y un toque de humor chileno suave (sin garabatos ni burlas), " +
      "y algún emoji cuando sume. Ante síntomas, salud delicada, duelo o problemas de plata, deja el humor: serio y cálido.";
  }
  return "[Tono que eligió el usuario: cercano y directo] Tutéalo, cálido pero al grano, sin jerga y casi sin emojis.";
}
