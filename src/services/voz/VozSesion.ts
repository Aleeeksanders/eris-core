// ============================================================
// Hestia por voz (J1, 2026-11-16): una llamada. Cada turno: el texto de la persona → el motor de voz (tokens en vivo) → trozos
// (CortadorFrases) → lo que se dice (Hablar) → Piper, uno tras otro → al teléfono como `voz_audio` numerados.
// «Cortar» (la persona habló encima, o tocó el botón) aborta la generación y todo lo pendiente: lo que ya iba en camino se descarta
// por el número de turno. Mientras corre una herramienta, una muletilla ya generada («Dame un segundo.»), para que no quede en silencio.
// ============================================================

import { CortadorFrases } from "./CortadorFrases.js";
import { paraHablar } from "./Hablar.js";

export interface VozDeps {
  /** El motor: genera la respuesta a `texto`, avisando cada token. `content` es la respuesta final completa. */
  generar: (texto: string, onToken: (t: string) => void, signal: AbortSignal) => Promise<{ content: string; quick?: boolean; stopped?: boolean }>;
  /** Piper: el WAV de un texto ya normalizado */
  sintetizar: (texto: string, signal: AbortSignal) => Promise<Buffer>;
  enviar: (msg: Record<string, unknown>) => void;
  /** Una muletilla ya generada para cuando corre una herramienta (o null si no hay) */
  muletilla?: () => Promise<{ wav: Buffer; texto: string } | null>;
  /** Cuánto esperar antes de la muletilla: si en ese rato ya hay algo que decir (un atajo por código responde en ~100 ms), no va */
  esperaMuletillaMs?: number;
  /** La segunda, si la espera se alarga («Sigo en eso, ya casi.»), y cuánto después de la primera */
  muletillaLarga?: () => Promise<{ wav: Buffer; texto: string } | null>;
  esperaLargaMs?: number;
  /** Para medir (pruebas: un reloj fijo) */
  ahora?: () => number;
  log?: (s: string) => void;
}

/** Una respuesta que no vino por tokens (atajo por código, o la redacción tras una herramienta) se dice hasta este largo */
// (J2: 70 eran ~25 s hablando; en una llamada se siente eterno. 45 ≈ 15 s)
const MAX_PALABRAS_DICHAS = 45;

interface Turno {
  id: number; seq: number; audios: number; muletilla: boolean; cadena: Promise<void>; ac: AbortController;
  /** decir un trozo en este turno (en orden con lo demás) y el cortador de lo que va llegando por tokens */
  decir?: (trozo: string) => void; cortador?: CortadorFrases;
}

/** Una frase para compararla con lo ya dicho: sin tildes, emojis, signos ni mayúsculas */
const normalizarFrase = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Un atajo por código llega entero en un solo «token» (QueryEngine.finishQuick): no se dice tal cual, se trata como respuesta entera */
const TOKEN_BLOQUE = 80;

/** Una tabla o una lista larga no se lee en voz alta: va a la pantalla */
const ESTRUCTURADO = (t: string) => /^\s*\|/m.test(t) || (t.match(/^\s*([-•*·]|\d+[.)])\s/gm)?.length ?? 0) > 4;

/**
 * Lo esencial de un texto largo para decirlo: sin títulos ni tablas, las primeras frases hasta `max` palabras.
 * (Exportada para las pruebas.)
 */
export function esencial(texto: string, max = 35): string {
  const lineas = String(texto ?? "").split("\n").filter((l) => !/^\s*(#{1,6}\s|\||[-=]{3,})/.test(l) && paraHablar(l));
  const frases = lineas.join("\n").split(/(?<=[.!?\n])\s+/).filter((f) => paraHablar(f));
  let n = 0; const corto: string[] = [];
  for (const f of frases) {
    const w = f.split(/\s+/).length;
    if (n + w > max && corto.length) break;
    corto.push(f.trim()); n += w;
  }
  return corto.join("\n");
}

export class VozSesion {
  private turnoId = 0;
  private actual: Turno | null = null;
  constructor(private readonly deps: VozDeps) {}

  get turnoActual(): number { return this.turnoId; }
  get ocupada(): boolean { return !!this.actual; }

  /** Corta lo que está diciendo o pensando (la persona habló encima). Lo pendiente de ese turno ya no se manda. */
  cortar(): void {
    this.turnoId++;
    this.actual?.ac.abort();
    this.actual = null;
  }

  /**
   * Corre una herramienta: si en un rato (`esperaMuletillaMs`) todavía no hay nada que decir en este turno, una muletilla
   * («Dame un segundo.»). Una sola vez por turno. (Antes de esperar sonaba también antes de los atajos instantáneos.)
   */
  herramienta(): void {
    const e = this.actual;
    if (!e || !this.deps.muletilla || e.muletilla || e.seq > 0 || e.id !== this.turnoId) return;
    e.muletilla = true;
    const decirMuletilla = (cual: () => Promise<{ wav: Buffer; texto: string } | null>) => {
      const s = ++e.seq;
      e.cadena = e.cadena.then(async () => {
        const m = await cual();
        if (!m || e.id !== this.turnoId) return;
        e.audios++;
        this.deps.enviar({ type: "voz_audio", turno: e.id, seq: s, wav: m.wav.toString("base64"), texto: m.texto, muletilla: true });
      }).catch(() => {});
      return s;
    };
    setTimeout(() => {
      if (e.seq > 0 || e.id !== this.turnoId || e.ac.signal.aborted) return;
      const s = decirMuletilla(this.deps.muletilla!);
      // J2: si después sigue sin haber nada (escribir una nota larga tardó 75 s), una segunda, una vez
      if (!this.deps.muletillaLarga) return;
      setTimeout(() => {
        if (e.seq !== s || e.id !== this.turnoId || e.ac.signal.aborted) return;
        decirMuletilla(this.deps.muletillaLarga!);
      }, this.deps.esperaLargaMs ?? 8000);
    }, this.deps.esperaMuletillaMs ?? 700);
  }

  /**
   * Decir algo YA, dentro del turno en curso (la pregunta de una aprobación mientras el motor espera la respuesta).
   * Lo que el modelo alcanzó a decir antes va primero. false = no hay turno en curso.
   */
  anunciar(texto: string): boolean {
    const e = this.actual;
    if (!e || !e.decir || e.id !== this.turnoId || e.ac.signal.aborted) return false;
    for (const t of e.cortador?.flush() ?? []) e.decir(t);
    e.decir(texto);
    return true;
  }

  /**
   * Un turno. `finHabla`: cuándo terminó de hablar la persona (reloj del servidor al recibirlo), para medir hasta el primer audio.
   * Devuelve la respuesta completa (para la transcripción de la llamada), o null si se cortó.
   */
  async turno(
    texto: string, finHabla?: number,
    /** J3: lo que se dice ya está armado por código (el saludo del día): sin el motor. `detalle` va a la pantalla tal cual. */
    directo?: { respuesta: string; detalle?: string | null },
  ): Promise<{ respuesta: string; primerAudioMs: number | null } | null> {
    if (this.actual) this.cortar();
    const e: Turno = { id: ++this.turnoId, seq: 0, audios: 0, muletilla: false, cadena: Promise.resolve(), ac: new AbortController() };
    this.actual = e;
    const ahora = this.deps.ahora ?? Date.now;
    const t0 = finHabla ?? ahora();
    const vigente = () => e.id === this.turnoId && !e.ac.signal.aborted;
    const cortador = new CortadorFrases();
    let primerAudioMs: number | null = null;
    let dicho = "";
    this.deps.enviar({ type: "voz_pensando", turno: e.id });

    const dichas = new Set<string>();
    const decir = (trozo: string) => {
      const habla = paraHablar(trozo);
      if (!habla || !vigente()) return;
      // J3: el mismo trozo dos veces en un turno no se repite (una guardia que pide otra pasada: «Te lo abro.» «Te lo abro.»)
      const n = normalizarFrase(habla);
      if (n.split(" ").length >= 2 && dichas.has(n)) return;
      dichas.add(n);
      const s = ++e.seq;
      this.deps.enviar({ type: "voz_texto", turno: e.id, seq: s, texto: trozo });
      e.cadena = e.cadena.then(async () => {
        if (!vigente()) return;
        const wav = await this.deps.sintetizar(habla, e.ac.signal);
        if (!vigente() || !wav.length) return;
        if (primerAudioMs == null) {
          primerAudioMs = ahora() - t0;
          this.deps.log?.(`[Voz] fin→audio ${primerAudioMs} ms (turno ${e.id})`);
        }
        e.audios++;
        this.deps.enviar({ type: "voz_audio", turno: e.id, seq: s, wav: wav.toString("base64"), texto: trozo });
      }).catch((err) => { if (vigente()) this.deps.log?.(`[Voz] no pude decir un trozo: ${err instanceof Error ? err.message : err}`); });
    };
    e.decir = decir;
    e.cortador = cortador;

    try {
      const r = directo ? { content: directo.respuesta, quick: true } : await this.deps.generar(texto, (tok) => {
        if (!vigente()) return;
        if (tok.length > TOKEN_BLOQUE) return; // la respuesta entera de un atajo: se dice al final (lo esencial, si es larga)
        dicho += tok;
        for (const t of cortador.push(tok)) decir(t);
      }, e.ac.signal);
      if (!vigente()) return null;
      // Lo que no llegó por tokens: un atajo por código (respuesta entera), la redacción después de una herramienta (otro mensaje,
      // no sigue a lo dicho) o un bloque anexado (briefing, lista con cifras: appendToReply)
      // Se dice solo lo que falta, frase por frase: así no se repite lo ya dicho cuando la respuesta final es lo dicho + un bloque,
      // ni cuando una guardia la corrigió (banco «voz»: «…el mes está seguro» se decía dos veces y después la corrección)
      const d = dicho.trim();
      const yaDicho = ` ${normalizarFrase(d)} `;
      let quitadas = 0;
      const lineas = r.content.split("\n").map((l) => l.split(/(?<=[.!?…])\s+/).filter((f) => {
        const n = normalizarFrase(f);
        if (n && d && yaDicho.includes(` ${n} `)) { quitadas++; return false; }
        return true;
      }).join(" ")).filter((l) => l.trim());
      // ¿lo que falta es la respuesta entera (nada dicho, o un mensaje nuevo tras la herramienta) o sigue a lo ya dicho?
      const entera = quitadas === 0;
      let resto = lineas.join("\n").trim();
      let detalle = false;
      if (directo?.detalle) {
        // armado por código: se dice tal cual (ya viene corto) y el detalle propio va a la pantalla
        for (const t of cortador.push(resto)) decir(t);
        resto = "";
        detalle = true;
        this.deps.enviar({ type: "voz_detalle", turno: e.id, texto: directo.detalle });
      }
      if (resto) {
        const palabras = resto.split(/\s+/).length;
        if (palabras > MAX_PALABRAS_DICHAS || ESTRUCTURADO(resto)) {
          // Largo o con forma de tabla o lista (una agenda, un briefing): lo esencial en voz y el detalle a la pantalla
          detalle = true;
          const corto = entera ? esencial(resto) : "";
          resto = `${corto}\nTe dejé el detalle en la pantalla.`.trim();
        }
        // (con salto: lo dicho puede seguir en el cortador sin espacio al final, «…briefing.» + «Te dejé…»)
        for (const t of cortador.push(d ? `\n${resto}` : resto)) decir(t);
      }
      for (const t of cortador.flush()) decir(t);
      if (detalle && !directo?.detalle) this.deps.enviar({ type: "voz_detalle", turno: e.id, texto: r.content });
      await e.cadena;
      if (!vigente()) return null;
      this.deps.enviar({ type: "voz_fin", turno: e.id, texto: r.content, detalle });
      return { respuesta: r.content, primerAudioMs };
    } catch (err) {
      if (!vigente()) return null;
      this.deps.log?.(`[Voz] el turno falló: ${err instanceof Error ? err.message : err}`);
      this.deps.enviar({ type: "voz_error", turno: e.id, mensaje: "Se me cortó la idea, ¿me lo repites?" });
      return null;
    } finally {
      if (this.actual === e) this.actual = null;
    }
  }
}
