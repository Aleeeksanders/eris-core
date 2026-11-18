// ============================================================
// Hestia como JARVIS · C5 (L1, 2026-11-17): ¿puede hablarte ahora, sola? Por código y sin el modelo. La regla de fondo: en voz alta
// SOLO con audífonos puestos (o dentro de una llamada con ella); nunca en «no molestar», en una llamada de teléfono, en una reunión
// del calendario, de noche (tu horario de sueño), en el modo «solo si digo Hestia» ni en pausa. Lo que no puede decirse queda
// como notificación. Además: un tope por hora y nada repetido.
// ============================================================

/** Lo que manda el teléfono (Eris lo arma con Android: audífonos, red de la casa, «no molestar», si estás en una llamada) */
export interface Sensores {
  /** hay audífonos conectados (Bluetooth, con cable o USB) */
  audifonos: boolean;
  audifonosNombre?: string | null;
  /** el teléfono alcanza al PC por la red de la casa; null = no se sabe todavía */
  enCasa: boolean | null;
  /** «no molestar» encendido */
  noMolestar: boolean;
  /** en una llamada de teléfono o de WhatsApp (el audio del teléfono en modo llamada) */
  llamadaTel: boolean;
  /** el modo «solo si digo Hestia» de la llamada */
  dirigido: boolean;
  /** L2: el teléfono está sonando (una llamada entrante). Sin el dato (app vieja): `llamadaTel` lo incluye. */
  sonando?: boolean;
  /** L2: en una llamada ya contestada (o de WhatsApp, Meet…), no solo sonando */
  enCurso?: boolean;
  /** L2: la pantalla está bloqueada (la plata no se dice en voz alta: K5). Sin el dato, se supone bloqueado. */
  bloqueado?: boolean;
  /** cuándo lo midió el teléfono (ms) */
  t: number;
}

export type Prioridad = "urgente" | "normal" | "info";
/** De qué es el aviso (el panel elige cuáles pueden hablar: Estado.hablar) */
export type TipoAviso = "bienvenida" | "saludo" | "equipo" | "llamada" | "mensaje" | "cargo" | "reunion" | "remedio" | "trabajo" | "protocolo";
export interface Aviso {
  clave: string; tipo: TipoAviso; prioridad: Prioridad; titulo: string; texto: string;
  /** L2: la misma clave no se repite antes de esto (si no, NO_REPETIR_MIN) */
  repetirMin?: number;
}

/** Cómo llega: hablado por los audífonos, dentro de la llamada con Hestia, como notificación, o nada (repetido) */
export type Via = "voz" | "llamada" | "notificacion" | "nada";

export interface CtxHablar {
  ahora: Date;
  sensores: Sensores | null;
  /** hay una llamada abierta con Hestia (y no está en medio de un turno) */
  enLlamadaHestia: boolean;
  /** el horario de sueño (horas locales: 23.5 = 23:30; despertar puede ser < dormir) */
  sueno: { dormir: number; despertar: number } | null;
  enReunion: boolean;
  pausada: boolean;
  /** el panel permite que este tipo hable */
  permitido: boolean;
  /** lo ya avisado (clave, cuándo y por dónde) */
  dichos: Array<{ clave: string; t: number; via: Via }>;
  /**
   * L5: el protocolo que está corriendo. Si el «No molestar» lo puso él (dnd), no calla a Hestia: manda cómo habla el protocolo
   * (el gimnasio y el foco, solo lo urgente; dormir, nada).
   */
  protocolo?: { titulo: string; hablar: "todo" | "urgente" | "nada"; dnd: boolean } | null;
}

/** Hablados como máximo por hora (lo urgente no cuenta) */
export const TOPE_HORA = 4;
/** La misma clave no se repite antes de esto */
export const NO_REPETIR_MIN = 60;
/** Lo que mandó el teléfono deja de valer después de esto (si no, no se sabe si tienes los audífonos) */
export const SENSORES_VIGENTES_MIN = 30;

/** ¿Es de noche según tu horario? (desde 30 min antes de dormirte hasta tu hora de despertar) */
export function esNoche(ahora: Date, sueno: { dormir: number; despertar: number } | null): boolean {
  const { dormir, despertar } = sueno ?? { dormir: 23.5, despertar: 7 };
  const h = ahora.getHours() + ahora.getMinutes() / 60;
  const desde = (((dormir - 0.5) % 24) + 24) % 24, hasta = ((despertar % 24) + 24) % 24;
  return desde <= hasta ? h >= desde && h < hasta : h >= desde || h < hasta;
}

/** ¿Está en una llamada (o sonando, salvo que el aviso sea justo esa llamada)? Con la app vieja solo está `llamadaTel`. */
export function enUnaLlamada(s: Sensores, esLaQueSuena = false): boolean {
  if (typeof s.enCurso === "boolean" || typeof s.sonando === "boolean") return !!s.enCurso || (!!s.sonando && !esLaQueSuena);
  return s.llamadaTel && !esLaQueSuena;
}

/** Cómo darle este aviso ahora, y por qué (el porqué va al registro y a las pruebas) */
export function decidir(a: Aviso, c: CtxHablar): { via: Via; motivo: string } {
  const t = c.ahora.getTime();
  const repetir = (a.repetirMin ?? NO_REPETIR_MIN) * 60_000;
  if (c.dichos.some((d) => d.clave === a.clave && t - d.t < repetir)) return { via: "nada", motivo: "ya lo avisé" };
  const notif = (motivo: string) => ({ via: "notificacion" as const, motivo });
  if (c.pausada) return notif("en pausa");
  if (!c.permitido) return notif("apagado en el panel");
  // hablando con ella: lo dice ahí mismo (estás despierto y escuchando, aunque sea de noche)
  if (c.enLlamadaHestia) return { via: "llamada", motivo: "en la llamada" };
  const s = c.sensores && t - c.sensores.t < SENSORES_VIGENTES_MIN * 60_000 ? c.sensores : null;
  // (una llamada que entra se anuncia MIENTRAS suena; lo demás espera a que no suene ni haya una en curso)
  if (s && enUnaLlamada(s, a.tipo === "llamada")) return notif(s.sonando && !s.enCurso ? "está sonando el teléfono" : "estás en una llamada");
  const prot = c.protocolo ?? null;
  if (prot?.hablar === "nada") return notif(`protocolo ${prot.titulo.toLowerCase()}`);
  if (prot?.hablar === "urgente" && a.prioridad !== "urgente") return notif(`protocolo ${prot.titulo.toLowerCase()}: solo lo urgente`);
  if (s?.noMolestar && !prot?.dnd) return notif("no molestar");
  if (s?.dirigido) return notif("modo «solo si digo Hestia»");
  if (c.enReunion) return notif("en una reunión");
  if (esNoche(c.ahora, c.sueno)) return notif("de noche");
  if (a.prioridad !== "urgente") {
    const hablados = c.dichos.filter((d) => (d.via === "voz" || d.via === "llamada") && t - d.t < 3_600_000).length;
    if (hablados >= TOPE_HORA) return notif("tope de la hora");
  }
  if (!s) return notif("sin datos del teléfono");
  if (!s.audifonos) return notif("sin audífonos");
  return { via: "voz", motivo: "con audífonos" };
}
