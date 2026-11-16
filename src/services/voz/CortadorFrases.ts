// ============================================================
// Hestia por voz (J1): los tokens del modelo → trozos para decir apenas están listos.
//
// J0 (2026-11-16): esperar la frase completa dejaba el primer audio en ~3,2 s; cortando el PRIMER trozo en la primera pausa («Mira,»,
// «Sí, te alcanza,») o a las 6 palabras, en ~2,1 s. Después, frase por frase (suena más natural). Nunca corta dentro de una cifra
// («2,8 L», «$45.196»): la coma o el punto tienen que ir seguidos de un espacio.
// ============================================================

/** Palabras que no pueden cerrar un trozo (lo que sigue depende de ellas) */
const ENLACE = /^(a|al|de|del|la|las|el|los|lo|un|una|unos|unas|y|e|o|u|ni|que|con|sin|en|por|para|se|me|te|le|les|nos|mi|mis|tu|tus|su|sus|muy|más|menos|tan|como|pero|si|cuando|donde|hasta|desde|entre|sobre|hay|es|son|está|están)$/i;

export class CortadorFrases {
  private buf = "";
  private n = 0;
  constructor(private readonly opts: { primeraPalabras: number; maxPalabras: number } = { primeraPalabras: 6, maxPalabras: 28 }) {}

  /** Agrega tokens; devuelve los trozos que ya se pueden decir */
  push(tokens: string): string[] {
    this.buf += tokens;
    const out: string[] = [];
    let c: string | null;
    while ((c = this.cortar(false))) out.push(c);
    return out;
  }
  /** Lo que quedó al terminar la respuesta */
  flush(): string[] {
    const out: string[] = [];
    let c: string | null;
    while ((c = this.cortar(false))) out.push(c);
    const r = this.buf.trim();
    this.buf = "";
    if (r) { out.push(r); this.n++; }
    return out;
  }
  get cortados(): number { return this.n; }

  private sacar(hasta: number): string | null {
    const trozo = this.buf.slice(0, hasta).trim();
    this.buf = this.buf.slice(hasta);
    if (!trozo) return null;
    this.n++;
    return trozo;
  }

  private cortar(_fin: boolean): string | null {
    this.buf = this.buf.replace(/^\s+/, "");
    const b = this.buf;
    if (!b.trim()) return null;
    // fin de línea (listas) o de frase: «.», «!», «?», «…» seguidos de espacio
    const linea = b.indexOf("\n");
    const fin = b.search(/[.!?…](?=\s)/);
    const corte = [linea >= 0 && b.slice(0, linea).trim() ? linea : -1, fin >= 0 ? fin + 1 : -1].filter((x) => x >= 0);
    if (corte.length) return this.sacar(Math.min(...corte)) ?? this.cortar(_fin);
    const palabras = b.trim().split(/\s+/);
    if (this.n === 0) {
      // el primero, cuanto antes: en la primera pausa («Mira,») o a las N palabras (en un borde de palabra)
      const pausa = b.search(/[,;:](?=\s)/);
      if (pausa >= 0 && b.slice(0, pausa).trim()) return this.sacar(pausa + 1);
      // …pero no después de una palabra de enlace («con Brian a | las 10:00», «de agua y | te quedan»): suena cortado
      if (palabras.length > this.opts.primeraPalabras && /\s$/.test(b) && !ENLACE.test(palabras[palabras.length - 1])) return this.sacar(b.length);
      return null;
    }
    // una frase muy larga sin punto: en la última pausa, o en la última palabra completa
    if (palabras.length > this.opts.maxPalabras) {
      const pausa = Math.max(b.lastIndexOf(", "), b.lastIndexOf("; "));
      if (pausa > 0) return this.sacar(pausa + 1);
      const esp = b.lastIndexOf(" ");
      if (esp > 0) return this.sacar(esp);
    }
    return null;
  }
}
