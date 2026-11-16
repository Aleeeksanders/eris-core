// ============================================================
// Eris — ContextPlanner
//
// Ollama recarga el modelo (~5 s + volver a leer todo el prompt) cada vez que cambia `num_ctx`, y un contexto más grande
// también es más lento (medido en la RTX 3050: 8192 → 18 t/s, 12288 → 16,5, 16384 → 15,5, y menos capas en GPU).
// Antes cada modo/perfil tenía su valor fijo (Flash 6144, Deep 8192, Ikaros 16384): cambiar de uno a otro recargaba el
// modelo, y Flash quedaba justo (el prompt público solo ya mide ~5 400 tokens): con unos pocos turnos de historial
// Ollama descartaba conversación en silencio.
//
// Ahora el contexto se elige por turno: el más chico que alcanza para lo que de verdad se va a enviar (con margen), y NO se
// achica mientras el modelo siga cargado (así no hay recargas de ida y vuelta). El estimador aprende cuántos caracteres
// son un token a partir de lo que devuelve Ollama, y si detecta que el prompt llenó el contexto, sube el nivel.
// ============================================================

export const CONTEXT_LEVELS = [8192, 10240, 12288, 16384] as const;
// Medido el 2026-11-05 en los recortes de Ollama: ~3,1 caracteres por token (español + esquemas JSON de herramientas).
// Antes empezaba en 3,4 y podía subir a 3,9 aprendiendo de envíos YA recortados (ver observe): estimaba de menos.
const MIN_RATIO = 2.6, MAX_RATIO = 3.6;

export interface PlanInput {
  /** Caracteres de todo lo que se envía: mensajes + definiciones de herramientas. */
  chars: number;
  /** Tokens que se reservan para la respuesta (y el razonamiento, si hay). */
  reserve: number;
  /** Piso pedido por quien llama (p. ej. la configuración del modo). */
  floor?: number;
  /** Techo pedido por quien llama (Hestia por voz: 8192; si no cabe, se recorta lo viejo antes que recargar el modelo). */
  cap?: number;
}

export class ContextPlanner {
  private current = 0;
  private lastUse = 0;
  /** caracteres por token; empieza en el valor medido (3,1) y se corrige con cada respuesta que NO se recortó */
  private ratio = 3.1;
  /**
   * Tope por memoria de video. Un contexto más grande también ocupa más VRAM: en la RTX 3050 de 6 GB, con otras apps
   * usando ~1,8 GB (fondo animado, grabador, navegadores), el modelo a 16384 (6,2 GB) no cabía y Ollama lo corría ENTERO
   * en el procesador — respuestas de varios minutos, y como el nivel no baja mientras el modelo esté cargado, todas las
   * siguientes también. Cuando se detecta, ese nivel queda vetado un rato y se vuelve a uno que sí cabe.
   */
  private ceiling: number | null = null;
  private ceilingUntil = 0;

  constructor(private keepAliveMs: number = 30 * 60_000, private now: () => number = Date.now) {}

  get level() { return this.current; }
  get charsPerToken() { return this.ratio; }
  get maxLevel() { return this.ceiling !== null && this.now() < this.ceilingUntil ? this.ceiling : null; }

  /**
   * El modelo cargado con `ctx` quedó (en parte) fuera de la tarjeta de video. Desde ahora se pide el nivel anterior
   * (recarga una vez, pero vuelve a la velocidad de GPU). Se reintenta el tamaño grande pasado `forMs`: la VRAM libre cambia.
   */
  markOffloaded(ctx: number, forMs = 30 * 60_000): number {
    const below = [...CONTEXT_LEVELS].reverse().find((l) => l < ctx) ?? CONTEXT_LEVELS[0];
    this.ceiling = Math.min(this.ceiling ?? Infinity, below);
    this.ceilingUntil = this.now() + forMs;
    if (this.current > this.ceiling) this.current = this.ceiling;
    return this.ceiling;
  }

  private levelFor(tokens: number): number {
    return CONTEXT_LEVELS.find((l) => l >= tokens) ?? CONTEXT_LEVELS[CONTEXT_LEVELS.length - 1];
  }

  /**
   * Contexto para una llamada que NO es del chat (resumen del historial, voz, tarjeta del día, reportes): el que ya está
   * cargado, para no obligar a Ollama a recargar el modelo. Si se había descargado, se carga con el nivel base. Cuenta como uso.
   */
  forSideCall(): number {
    const t = this.now();
    if (this.current && t - this.lastUse > this.keepAliveMs) this.current = 0;
    if (!this.current) this.current = CONTEXT_LEVELS[0];
    this.lastUse = t;
    return this.current;
  }

  /** Contexto a pedir para este envío. */
  pick(p: PlanInput): number {
    const t = this.now();
    // Si pasó más que el keep_alive, el modelo ya se descargó: se empieza de cero (no hay nada que recargar por cambiar)
    if (this.current && t - this.lastUse > this.keepAliveMs) this.current = 0;
    const need = Math.ceil((p.chars / this.ratio + p.reserve) * 1.08);
    let level = this.levelFor(Math.max(need, p.floor ?? 0));
    if (this.current) level = Math.max(level, this.current); // mientras esté cargado, nunca se achica
    const cap = this.maxLevel;
    if (cap !== null) level = Math.min(level, cap); // …salvo que no quepa en la tarjeta: mejor perder historial viejo que tardar minutos
    if (p.cap) level = Math.min(level, this.levelFor(p.cap));
    this.current = level;
    this.lastUse = t;
    return level;
  }

  /**
   * Se llama con lo que Ollama reporta tras cada generación. Ajusta el estimador y avisa si el prompt llenó el contexto
   * (señal de que Ollama descartó parte de la conversación): en ese caso sube el nivel para el siguiente envío.
   */
  observe(chars: number, promptTokens: number, ctx: number): { truncated: boolean; next: number } {
    const lleno = promptTokens > 0 && promptTokens >= ctx - 24;
    // Un envío recortado reporta tokens = el contexto, no los reales: aprender de él hacía creer que caben más caracteres
    // por token y el siguiente se estimaba aún más corto (2026-11-05)
    if (promptTokens > 0 && chars > 3000 && !lleno) {
      const measured = chars / promptTokens;
      this.ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, this.ratio * 0.7 + measured * 0.3));
    }
    const truncated = lleno;
    if (truncated) {
      const up = CONTEXT_LEVELS.find((l) => l > ctx);
      const cap = this.maxLevel;
      if (up && (cap === null || up <= cap)) this.current = Math.max(this.current, up);
    }
    return { truncated, next: this.current };
  }
}

// Un planificador por modelo: `num_ctx` es una propiedad del modelo cargado en Ollama, no de cada perfil.
const planners = new Map<string, ContextPlanner>();
export function plannerFor(model: string, keepAliveMs?: number): ContextPlanner {
  let p = planners.get(model);
  if (!p) { p = new ContextPlanner(keepAliveMs); planners.set(model, p); }
  return p;
}

/** Solo para pruebas. */
export function _resetPlannersForTests() { planners.clear(); }

/** Duración del keep_alive de Ollama en ms a partir de un texto tipo "30m", "2h", "90s" (o "-1" = siempre). */
export function parseKeepAlive(s: string): number {
  const m = String(s).trim().match(/^(-?\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i);
  if (!m) return 30 * 60_000;
  const n = Number(m[1]);
  if (n < 0) return Number.POSITIVE_INFINITY;
  const unit = (m[2] ?? "s").toLowerCase();
  return n * (unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000);
}
