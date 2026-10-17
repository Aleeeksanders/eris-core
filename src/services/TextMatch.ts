// ============================================================
// Eris — Comparación de textos tolerante a cómo suena/se escribe
//
// La voz llega transcrita por Whisper y en español de Chile/Latinoamérica (seseo) "Zucaritas" sale "sucaritas",
// "Vilay" → "Bilay", "Kellogg's" → "Kelogs". Buscar por texto exacto falla justo con las marcas. `phon` reduce
// una palabra a una forma fonética aproximada: dos escrituras que SUENAN igual quedan iguales.
// ============================================================

/**
 * Forma fonética aproximada (español latinoamericano): sin tildes ni mayúsculas, z/c(e,i)/s → s, c/qu/k → k,
 * v → b, h muda fuera, ll → y, letras dobles colapsadas. No es un fonetizador completo: solo iguala los errores típicos.
 */
export function phon(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/qu/g, "k")
    .replace(/c(?=[ei])/g, "s")
    .replace(/[zx]/g, "s")
    .replace(/c/g, "k")
    .replace(/v/g, "b")
    .replace(/h/g, "")
    .replace(/ll/g, "y")
    .replace(/w/g, "u")
    .replace(/(.)\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Palabras (≥2 letras) en forma fonética. */
export function phonTokens(text: string): string[] {
  return phon(text).split(" ").filter((t) => t.length > 1);
}
