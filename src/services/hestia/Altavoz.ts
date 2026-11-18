// ============================================================
// Hestia como JARVIS · C3 (L1, 2026-11-17): el altavoz de Hestia, para que hable SIN abrir la llamada. Un aviso (la bienvenida,
// el saludo con los audífonos, una alerta del equipo) pasa por las Interrupciones (C5) y llega:
//  - «voz»: Piper lo dice con la misma voz de la llamada y la app lo reproduce bajando la música (hestia_decir) — al teléfono que
//    mandó los sensores (el de los audífonos), nunca a dos a la vez;
//  - «llamada»: hay una llamada abierta con ella → lo dice ahí, como un turno suyo;
//  - «notificacion»: queda escrito (hestia_aviso; las del equipo, con su canal de siempre: hestia_alerta);
//  - «nada»: ya lo dijo hace poco.
// Solo Ikaros (Puerta.ts): a un usuario de Eris nunca le llega nada de esto.
// ============================================================
import { randomUUID } from "node:crypto";
import { claveHablar, leerEstado, pausaVigente } from "./Estado.js";
import { protocoloVigente } from "./Protocolos.js";
import { decidir, SENSORES_VIGENTES_MIN, type Aviso, type Sensores, type Via } from "./Interrupciones.js";
import { esIkaros } from "./Puerta.js";
import { paraHablar } from "../voz/Hablar.js";

export interface DepsAltavoz {
  /** las conexiones de Ikaros abiertas */
  conexiones(): any[];
  /** Piper (la voz de la llamada); null si no pudo */
  sintetizar(texto: string): Promise<Buffer | null>;
  /** tu horario de sueño (del perfil de Ikaros) */
  sueno(): Promise<{ dormir: number; despertar: number } | null>;
  /** ¿estás en una reunión del calendario ahora? (Hestia Manos; si no responde, no) */
  enReunion(ws: any): Promise<boolean>;
  log?(s: string): void;
  /** cómo se guarda un turno suyo en el historial de la llamada (createMessage) */
  mensaje?(texto: string): any;
}

/**
 * L2: lo que Hestia preguntó en la llamada y espera tu respuesta («Te llama Mamá. ¿Contesto?», «¿Reconoces el cargo?»). Lo
 * contesta el código (Avisos.responderPregunta), no el modelo.
 */
export type PreguntaBase = { tipo: "llamada"; de: string | null } | { tipo: "cargo"; id: string; txId?: string | number | null } | { tipo: "mensaje"; de: string };
export type PreguntaAviso = PreguntaBase & { t: number };

/**
 * `soloVoz`: si no puede decirse en voz, mejor nada (el saludo de la mañana como notificación es ruido).
 * L2: `enLaLlamada` = cómo decirlo si hay una llamada abierta con ella (con la pregunta que espera); `botones` = la
 * notificación lleva botones en la app («Sí, era yo» / «No, revisar»), y se deja también cuando se dijo en voz; `datos` =
 * lo que la app necesita para esos botones; `sinReunion` = no mirar el calendario (una llamada que suena no espera);
 * `externo` = trae lo que escribieron otros (títulos del calendario, nombres de grupos): en el historial va como dato.
 */
export type AvisoAltavoz = Aviso & {
  soloVoz?: boolean;
  enLaLlamada?: { texto: string; pregunta?: PreguntaBase };
  botones?: "cargo";
  datos?: Record<string, unknown>;
  /** lo que queda escrito en la notificación, si es distinto de lo dicho (el cargo: con el monto aunque no se diga) */
  escrito?: string;
  sinReunion?: boolean;
  externo?: boolean;
};

const abierta = (ws: any) => ws && (ws.readyState === undefined || ws.readyState === 1);

export class Altavoz {
  /** lo último que mandó el teléfono, y desde qué conexión */
  sensores: Sensores | null = null;
  private wsSensores: any = null;
  private dichos: Array<{ clave: string; t: number; via: Via }> = [];
  constructor(private readonly deps: DepsAltavoz) {}

  /** Llegó una lectura del teléfono (ya validada). Devuelve la anterior. */
  actualizar(s: Sensores, ws: any): Sensores | null {
    const antes = this.sensores;
    this.sensores = s;
    if (esIkaros(ws)) this.wsSensores = ws;
    return antes;
  }

  /** El teléfono dejó de mandar (pasaste a Eris o cerraste sesión): sin sensores no habla sola */
  apagar(): void { this.sensores = null; this.wsSensores = null; }

  /** La conexión del teléfono de los sensores (para pedirle algo a Hestia Manos: el calendario, contestar), si sigue abierta */
  get wsTelefono(): any { return this.wsSensores && abierta(this.wsSensores) ? this.wsSensores : null; }

  /**
   * L2: ¿te podría hablar ahora? (una llamada abierta con ella, o los audífonos puestos según lo último del teléfono). Para no
   * gastar en armar avisos que solo van en voz (la reunión en 15 minutos, la hora del remedio) cuando nadie los va a oír.
   */
  escuchando(ahora = Date.now()): boolean {
    if (this.llamada()) return true;
    const s = this.sensores;
    return !!s && ahora - s.t < SENSORES_VIGENTES_MIN * 60_000 && s.audifonos;
  }

  /** La llamada abierta con Hestia (si hay), en cualquiera de sus conexiones */
  llamada(): any {
    for (const w of this.deps.conexiones()) { const v = w?.data?.voz; if (v && !v.cerrada && v.sesion) return v; }
    return null;
  }

  /** A quién mandarle: el teléfono de los sensores si sigue abierto; si no, las conexiones de Ikaros */
  private destinos(): any[] {
    const cs = this.deps.conexiones().filter(abierta);
    if (this.wsSensores && abierta(this.wsSensores) && cs.includes(this.wsSensores)) return [this.wsSensores];
    return cs;
  }

  private anotar(clave: string, via: Via, t: number) {
    this.dichos = [...this.dichos.filter((d) => t - d.t < 6 * 3_600_000), { clave, t, via }].slice(-60);
  }

  /** Lo ya dicho (el panel y las pruebas) */
  get registro(): ReadonlyArray<{ clave: string; t: number; via: Via }> { return this.dichos; }

  private async contexto(a: Aviso, ahora: Date) {
    const e = await leerEstado();
    const llamada = this.llamada();
    return {
      llamada,
      base: {
        // (lo urgente, una llamada que entra, corta lo que esté diciendo; salvo que espere tu sí o no a una aprobación)
        ahora, sensores: this.sensores, enLlamadaHestia: !!llamada && (!llamada.sesion.ocupada || (a.prioridad === "urgente" && !llamada.aprobacion)), sueno: await this.deps.sueno().catch(() => null),
        enReunion: false, pausada: !!pausaVigente(e, ahora), permitido: e.hablar[claveHablar(a.tipo)] !== false, dichos: this.dichos,
        // (L5: el aviso de que terminó el mismo protocolo no lo calla el protocolo)
        protocolo: a.tipo === "protocolo" ? null : protocoloVigente(e, ahora),
      },
    };
  }

  /** Lo que haría ahora, sin la reunión ni mandar nada (para no armar un saludo que no se va a poder decir) */
  async previa(a: Aviso, ahora = new Date()): Promise<Via> {
    return decidir(a, (await this.contexto(a, ahora)).base).via;
  }

  async avisar(a: AvisoAltavoz, ahora = new Date()): Promise<Via> {
    const { llamada, base } = await this.contexto(a, ahora);
    let { via, motivo } = decidir(a, base);
    // la reunión se mira solo si de verdad iba a hablar (pregunta al teléfono: hasta 3 s)
    if (via === "voz" && !a.sinReunion && this.wsSensores && (await this.deps.enReunion(this.wsSensores).catch(() => false))) ({ via, motivo } = decidir(a, { ...base, enReunion: true }));
    if (a.soloVoz && via === "notificacion") { motivo = `${motivo}; solo en voz`; via = "nada"; }
    this.deps.log?.(`[Hestia] aviso ${a.clave}: ${via} (${motivo})`);
    if (via === "nada") return via;
    const t = ahora.getTime();

    if (via === "llamada") {
      try {
        const texto = a.enLaLlamada?.texto ?? a.texto;
        const m = this.deps.mensaje ? this.deps.mensaje(texto) : { role: "assistant", content: texto, timestamp: ahora.toISOString() };
        llamada.history?.push?.(a.externo ? { ...m, trace: { tools: [], externo: true } } : m);
        // (la pregunta queda esperando tu respuesta: la contesta el código en el turno siguiente)
        llamada.preguntaAviso = a.enLaLlamada?.pregunta ? { ...a.enLaLlamada.pregunta, t: Date.now() } : null;
        await llamada.sesion.turno("", Date.now(), { respuesta: texto });
        this.anotar(a.clave, via, t);
        // (lo que lleva botones queda también escrito: si no lo contestas en la llamada, lo contestas después)
        if (a.botones) {
          const msg = JSON.stringify({ type: "hestia_aviso", id: randomUUID(), clave: a.clave, tipo: a.tipo, titulo: a.titulo, texto: a.escrito ?? a.texto, botones: a.botones, datos: a.datos ?? {} });
          for (const w of this.destinos()) { try { w.send(msg); } catch {} }
        }
        return via;
      } catch { via = "notificacion"; }
    }
    const destinos = this.destinos();
    if (!destinos.length) return "nada"; // sin la app conectada no hay a quién (y no se anota: si vuelve, se puede decir)
    if (via === "voz") {
      const habla = paraHablar(a.texto);
      const wav = habla ? await this.deps.sintetizar(habla).catch(() => null) : null;
      if (wav?.length) {
        const msg = JSON.stringify({ type: "hestia_decir", id: randomUUID(), clave: a.clave, tipo: a.tipo, titulo: a.titulo, texto: a.texto, wav: wav.toString("base64"),
          ...(a.escrito ? { escrito: a.escrito } : {}), ...(a.soloVoz ? { soloVoz: true } : {}),
          // las del equipo también quedan escritas (son para revisar después), y las que llevan botones (para contestarlas)
          nota: a.tipo === "equipo" || !!a.botones, ...(a.botones ? { botones: a.botones, datos: a.datos ?? {} } : {}) });
        for (const w of destinos.slice(0, 1)) { try { w.send(msg); } catch {} }
        this.anotar(a.clave, via, t);
        return via;
      }
      if (a.soloVoz) return "nada";
      via = "notificacion"; // Piper no pudo: que igual llegue
    }
    const msg = a.tipo === "equipo"
      ? JSON.stringify({ type: "hestia_alerta", nivel: a.prioridad === "urgente" ? "accion" : a.prioridad === "info" ? "vuelve" : "aviso", clave: a.clave, texto: a.texto, t: ahora.toISOString() })
      : JSON.stringify({ type: "hestia_aviso", id: randomUUID(), clave: a.clave, tipo: a.tipo, titulo: a.titulo, texto: a.escrito ?? a.texto, ...(a.botones ? { botones: a.botones, datos: a.datos ?? {} } : {}) });
    for (const w of destinos) { try { w.send(msg); } catch {} }
    this.anotar(a.clave, "notificacion", t);
    return "notificacion";
  }
}

/** Valida lo que manda el teléfono (es entrada externa) */
export function sensoresDe(x: any, ahora = Date.now()): Sensores | null {
  if (!x || typeof x !== "object") return null;
  const b = (v: unknown) => v === true;
  const t = typeof x.t === "number" && Number.isFinite(x.t) && Math.abs(ahora - x.t) < 3_600_000 ? x.t : ahora;
  return {
    audifonos: b(x.audifonos), audifonosNombre: typeof x.audifonosNombre === "string" ? x.audifonosNombre.slice(0, 60) : null,
    enCasa: typeof x.enCasa === "boolean" ? x.enCasa : null, noMolestar: b(x.noMolestar), llamadaTel: b(x.llamadaTel), dirigido: b(x.dirigido), t,
    // L2 (sin el dato, una app vieja: se deja sin definir)
    ...(typeof x.sonando === "boolean" ? { sonando: x.sonando } : {}),
    ...(typeof x.enCurso === "boolean" ? { enCurso: x.enCurso } : {}),
    ...(typeof x.bloqueado === "boolean" ? { bloqueado: x.bloqueado } : {}),
  };
}
