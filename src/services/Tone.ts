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

export type Tone = "humor" | "directo" | "usted";
export const TONES: Tone[] = ["humor", "directo", "usted"];
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

/** La instrucción para el chat (va en cada consulta, así un cambio se nota al tiro). */
export function toneInstruction(t: Tone): string {
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
