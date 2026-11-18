// ============================================================
// Hestia como JARVIS · L5 (2026-11-18): cómo es un protocolo (una escena con nombre: «gimnasio», «dormir», «foco»…) y cómo se
// revisa lo guardado en ~/.eris/hestia.json (es un archivo: se valida todo al leerlo, como el resto del estado).
// Aparte de Protocolos.ts para que Estado.ts lo use sin importarse en círculo.
// ============================================================
import type { TelefonoOp } from "../TelefonoBridge.js";

/** Mientras está activo, cómo te habla Hestia sola: todo, solo lo urgente (una llamada que entra), o nada */
export type HablarProtocolo = "todo" | "urgente" | "nada";

/**
 * Un paso. Lo del teléfono va por Hestia Manos (solo lo que no llega a otras personas: OPS_PROTOCOLO); lo demás lo arma el
 * código con los datos de Eris (nada usa el modelo).
 */
export type Paso =
  | { tipo: "telefono"; op: TelefonoOp }
  /** «No molestar»: por `minutos`, lo que dura el protocolo (`delProtocolo`) o hasta la alarma que puso el mismo protocolo */
  | { tipo: "no_molestar"; encender: boolean; minutos?: number | null; delProtocolo?: boolean; hastaAlarma?: boolean }
  /** tu música: sigue lo último que sonaba; si no hay nada, abre tu app de música */
  | { tipo: "musica" }
  /** la alarma según lo que necesitas dormir y lo primero de tu agenda de mañana */
  | { tipo: "alarma_sueno" }
  /** L3: el entrenador en el oído (en la llamada) */
  | { tipo: "entrenador" }
  /** el cierre del día en 20 segundos (comida, agua, entreno, mañana) */
  | { tipo: "cierre_dia" }
  /** tu día (la agenda de siempre) */
  | { tipo: "agenda" }
  /** al salir: lo que viene mientras no estás (eventos, remedios) y el cargador si hace falta */
  | { tipo: "salida" }
  /** al salir: ¿avanzo con lo pendiente en el PC o lo dejo quieto? */
  | { tipo: "pc_mientras" }
  | { tipo: "bienvenida" }
  | { tipo: "constantes" }
  /** lo de fondo del PC (L4): quieto o que siga */
  | { tipo: "fondo"; quieto: boolean };

export interface Protocolo {
  /** como se busca: sin tildes, minúsculas («gimnasio») */
  nombre: string;
  /** como se dice («Gimnasio», «Salir de casa») */
  titulo: string;
  /** otras formas de nombrarlo («gym», «entreno») */
  alias: string[];
  pasos: Paso[];
  hablar: HablarProtocolo;
  /** cuánto dura (min) si tiene término (el foco: 50); null = no queda activo, o hasta que digas «termina» */
  duracionMin: number | null;
  /** lo creaste tú (o cambiaste uno de los que vienen) */
  propio?: boolean;
  creado?: string;
}

/** El que está corriendo (foco hasta las 15:40, gimnasio, dormir hasta la alarma) */
export interface ProtocoloActivo {
  nombre: string; titulo: string; desde: string; hasta: string | null; hablar: HablarProtocolo;
  /** Hestia puso el «No molestar» (al terminar, lo quita) */
  dnd: boolean;
  /** avisa al terminar («Terminó tu bloque de foco») */
  aviso: boolean;
}

/** Lo del teléfono que puede ir en un protocolo: lo que no manda nada a otros, no llama y no toca apps por ti */
export const OPS_PROTOCOLO = new Set(["alarma", "temporizador", "linterna", "volumen", "musica", "abrir_app", "navegar", "no_molestar"]);
/** Un protocolo guardado tiene a lo más esto */
export const MAX_PASOS = 8;
export const MAX_PROPIOS = 20;

export const plegarNombre = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
const txt = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");
const entero = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined);
const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
const HABLAR = new Set(["todo", "urgente", "nada"]);

/** La operación del teléfono, solo con sus campos y en rango (lo demás se descarta) */
function opSana(x: any): TelefonoOp | null {
  if (!x || typeof x !== "object" || !OPS_PROTOCOLO.has(x.accion)) return null;
  switch (x.accion) {
    case "alarma": {
      const hora = entero(x.hora, 0, 23), minuto = entero(x.minuto, 0, 59);
      if (hora === undefined || minuto === undefined || x.hora !== hora || x.minuto !== minuto) return null;
      const mensaje = txt(x.mensaje, 60);
      return { accion: "alarma", hora, minuto, ...(mensaje ? { mensaje } : {}) };
    }
    case "temporizador": {
      const segundos = entero(x.segundos, 1, 86_399);
      if (segundos === undefined) return null;
      const mensaje = txt(x.mensaje, 60);
      return { accion: "temporizador", segundos, ...(mensaje ? { mensaje } : {}) };
    }
    case "linterna": return { accion: "linterna", encender: x.encender !== false };
    case "volumen": {
      if (!["subir", "bajar", "silencio", "maximo", "nivel"].includes(x.cambio)) return null;
      const nivel = entero(x.nivel, 0, 100);
      if (x.cambio === "nivel" && nivel === undefined) return null;
      return { accion: "volumen", cambio: x.cambio, ...(x.cambio === "nivel" ? { nivel } : {}) };
    }
    case "musica": return ["pausa", "sigue", "siguiente", "anterior"].includes(x.que) ? { accion: "musica", que: x.que } : null;
    case "abrir_app": { const nombre = txt(x.nombre, 60); return nombre ? { accion: "abrir_app", nombre } : null; }
    case "navegar": { const destino = txt(x.destino, 80); return destino ? { accion: "navegar", destino } : null; }
    case "no_molestar": {
      const minutos = entero(x.minutos, 1, 24 * 60);
      return { accion: "no_molestar", encender: x.encender !== false, ...(minutos ? { minutos } : {}) };
    }
  }
  return null;
}

export function pasoSano(x: any): Paso | null {
  if (!x || typeof x !== "object") return null;
  switch (x.tipo) {
    case "telefono": { const op = opSana(x.op); return op ? { tipo: "telefono", op } : null; }
    case "no_molestar": {
      const minutos = entero(x.minutos, 1, 24 * 60);
      return { tipo: "no_molestar", encender: x.encender !== false, ...(minutos ? { minutos } : {}), ...(x.delProtocolo === true ? { delProtocolo: true } : {}), ...(x.hastaAlarma === true ? { hastaAlarma: true } : {}) };
    }
    case "fondo": return { tipo: "fondo", quieto: x.quieto === true };
    case "musica": case "alarma_sueno": case "entrenador": case "cierre_dia": case "agenda": case "salida": case "pc_mientras": case "bienvenida": case "constantes":
      return { tipo: x.tipo };
  }
  return null;
}

export function protocoloSano(x: any): Protocolo | null {
  if (!x || typeof x !== "object") return null;
  const nombre = plegarNombre(x.nombre);
  const titulo = txt(x.titulo, 40) || nombre;
  if (!nombre) return null;
  const pasos = (Array.isArray(x.pasos) ? x.pasos : []).map(pasoSano).filter((p: Paso | null): p is Paso => !!p).slice(0, MAX_PASOS);
  if (!pasos.length) return null;
  const alias = (Array.isArray(x.alias) ? x.alias : []).map(plegarNombre).filter(Boolean).slice(0, 8);
  const dur = entero(x.duracionMin, 1, 24 * 60);
  return {
    nombre, titulo, alias: alias.includes(nombre) ? alias : [nombre, ...alias].slice(0, 8), pasos,
    hablar: HABLAR.has(x.hablar) ? x.hablar : "todo", duracionMin: dur ?? null,
    ...(x.propio === true ? { propio: true } : {}), ...(iso(x.creado) ? { creado: x.creado } : {}),
  };
}

export function activoSano(x: any): ProtocoloActivo | null {
  if (!x || typeof x !== "object") return null;
  const nombre = plegarNombre(x.nombre);
  const desde = iso(x.desde);
  if (!nombre || !desde) return null;
  return { nombre, titulo: txt(x.titulo, 40) || nombre, desde, hasta: iso(x.hasta), hablar: HABLAR.has(x.hablar) ? x.hablar : "todo", dnd: x.dnd === true, aviso: x.aviso === true };
}
