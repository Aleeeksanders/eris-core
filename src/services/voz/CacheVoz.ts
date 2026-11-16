// ============================================================
// Hestia por voz (J3, 2026-11-16): el primer trozo de una respuesta suele ser corto y repetido («Claro,», «Mira,», «Sí.»), porque el
// prompt de voz le pide empezar así. Generarlo con Piper toma ~0,3–0,5 s cada vez; guardado, suena apenas llega el token.
// Solo frases cortas (hasta 4 palabras): lo demás cambia siempre.
// ============================================================

const MAX_PALABRAS = 4;

/** Cómo arranca Hestia casi siempre (se generan al empezar la primera llamada, si Piper está libre) */
export const ARRANQUES = ["Claro.", "Claro,", "Mira,", "Sí.", "Sí,", "No.", "Dale.", "Ya.", "Ya,", "Listo.", "Okey.", "Uf,", "A ver,", "Bueno,", "Perfecto.",
  "Buena pregunta.", "Sí, claro.", "Ya, mira,", "Hola.", "De nada.", "Ojo,", "Vale."];

export class CacheVoz {
  private m = new Map<string, Buffer>();
  constructor(private readonly max = 300) {}

  /** ¿Se guarda este texto? (corto) */
  static corto(texto: string): boolean {
    const t = String(texto ?? "").trim();
    return !!t && t.split(/\s+/).length <= MAX_PALABRAS && t.length <= 40;
  }

  get tamano(): number { return this.m.size; }
  tiene(texto: string): boolean { return this.m.has(texto.trim()); }

  /** El WAV de `texto`: del caché si es corto y ya se dijo; si no, `sintetizar` (y se guarda si es corto) */
  async decir(texto: string, sintetizar: (t: string) => Promise<Buffer>): Promise<Buffer> {
    const k = String(texto ?? "").trim();
    if (!CacheVoz.corto(k)) return sintetizar(texto);
    const ya = this.m.get(k);
    if (ya) { this.m.delete(k); this.m.set(k, ya); return ya; } // al final: el más reciente
    const wav = await sintetizar(texto);
    if (wav?.length) {
      this.m.set(k, wav);
      if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
    }
    return wav;
  }
}
