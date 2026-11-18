// ============================================================
// Hestia como JARVIS · C2 (2026-11-17): el estado de Hestia en un solo lugar, ~/.eris/hestia.json. Lo leen y escriben el panel
// AXS (Sistema), la voz («Hestia, pausa»), el chat de AXS y el vigía del equipo (Vigia.ts):
//  - la pausa (solo Hestia: Eris sigue igual para todos): desde cuándo, hasta cuándo, por qué y quién la puso;
//  - los límites del equipo (aviso y acción) que eligió en el panel;
//  - si los trabajos de fondo están en pausa (lo decide el vigía; L4 los respeta).
// Escritura atómica (a un temporal y se reemplaza de una vez), como el kv del perfil.
// ============================================================
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as os from "node:os";
import { activoSano, protocoloSano, MAX_PROPIOS, type Protocolo, type ProtocoloActivo } from "./ProtocoloTipos.js";

export type QuienPausa = "panel" | "voz" | "chat" | "vigia";
export interface Pausa { desde: string; hasta: string | null; motivo: string; por: QuienPausa }

/** Qué hace al cruzar el umbral de acción */
export type AccionLimite = "solo_aviso" | "pausar_fondo" | "pausar_hestia" | "sin_archivos";
export interface Limite { aviso: number | null; accion: number | null; que: AccionLimite }
export interface Limites {
  /** RAM libre (GB): menos que esto */
  ramLibreGb: Limite;
  /** disco C: libre (GB): menos que esto */
  discoLibreGb: Limite;
  /** temperatura de la tarjeta (°C): más que esto */
  gpuTempC: Limite;
  /** memoria usada de la tarjeta (GB): más que esto */
  vramGb: Limite;
  /** CPU sostenida (%) por 5 minutos: más que esto */
  cpuPct: Limite;
  /** batería del notebook (%) sin cargador: menos que esto */
  bateriaPct: Limite;
}
export type ClaveLimite = keyof Limites;

/** La propuesta del plan (L0), con el disco de hoy (26 GB libres) en mente */
export const LIMITES_INICIALES: Limites = {
  ramLibreGb: { aviso: 2, accion: 1, que: "pausar_fondo" },
  discoLibreGb: { aviso: 20, accion: 10, que: "sin_archivos" },
  gpuTempC: { aviso: 80, accion: 87, que: "pausar_hestia" },
  vramGb: { aviso: 5.6, accion: null, que: "solo_aviso" },
  cpuPct: { aviso: 90, accion: null, que: "pausar_fondo" },
  bateriaPct: { aviso: 20, accion: 10, que: "pausar_fondo" },
};
/** Si se baja (sube) más allá de esto, lo que hizo el vigía se deshace solo (histéresis: no prende y apaga a cada minuto) */
export const VUELVE: Partial<Record<ClaveLimite, number>> = { gpuTempC: 75, ramLibreGb: 1.5, cpuPct: 70, bateriaPct: 15 };

/** L1 (C5): qué puede decirte en voz alta, sola (si no, queda como notificación). Lo eliges en el panel. */
export interface Hablar {
  /** «Bienvenido a casa» al volver (C4: la red de la casa) */
  bienvenida: boolean;
  /** el saludo del día al ponerte los audífonos por primera vez en la mañana */
  saludo: boolean;
  /** las alertas del equipo (L0) */
  equipo: boolean;
  /** L2: «Te llama Mamá» (con audífonos, mientras suena) */
  llamadas: boolean;
  /** L2: «Te escribió Pedro», solo de tus contactos importantes */
  mensajes: boolean;
  /** L2: un cargo del banco fuera de lo común («¿lo reconoces?») */
  cargos: boolean;
  /** L2: una reunión en 15 minutos y la hora de tus remedios o suplementos */
  agenda: boolean;
  /** L4: «terminé lo que me pediste» y los vigías del PC */
  trabajos: boolean;
  /** L5: «terminó tu bloque de foco» (el fin de un protocolo con tiempo) */
  protocolos: boolean;
}
export const HABLAR_INICIAL: Hablar = { bienvenida: true, saludo: true, equipo: true, llamadas: true, mensajes: true, cargos: true, agenda: true, trabajos: true, protocolos: true };

/** L2: qué interruptor del panel manda en cada tipo de aviso */
export function claveHablar(tipo: string): keyof Hablar {
  switch (tipo) {
    case "llamada": return "llamadas";
    case "mensaje": return "mensajes";
    case "cargo": return "cargos";
    case "reunion": case "remedio": return "agenda";
    case "trabajo": return "trabajos";
    case "protocolo": return "protocolos";
    case "bienvenida": case "saludo": case "equipo": return tipo;
    default: return "equipo";
  }
}

/** L2: los contactos de los que te avisa cuando te escriben (máximo y largo de cada nombre) */
export const MAX_IMPORTANTES = 30;
const plegar = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
export const clavePersona = plegar;

/** L1 (C4): dónde estás según el teléfono (la red de la casa) y lo que ya se dijo hoy. Persiste: un reinicio no te da otra bienvenida. */
export interface Presencia {
  /** null = todavía no se sabe */
  enCasa: boolean | null;
  /** desde cuándo está así (ISO) */
  desde: string | null;
  /** cuándo saliste (ISO), mientras estés fuera */
  fueraDesde: string | null;
  ultimaBienvenida: string | null;
  /** el día (toDateString) del saludo con los audífonos */
  saludoAudifonos: string | null;
}
export const PRESENCIA_INICIAL: Presencia = { enCasa: null, desde: null, fueraDesde: null, ultimaBienvenida: null, saludoAudifonos: null };

export interface EstadoHestia {
  version: 1;
  pausa: Pausa | null;
  limites: Limites;
  /** los trabajos de fondo esperan (por qué), o null */
  fondoPausado: string | null;
  /** no crear archivos grandes ni respaldos (disco casi lleno), o null */
  sinArchivos: string | null;
  /** L1: qué puede decir en voz alta, sola */
  hablar: Hablar;
  /** L1: en casa o fuera, y lo ya dicho */
  presencia: Presencia;
  /** L2: de quién te avisa cuando te escribe (como los nombras tú: «Mamá», «Pedro»), sin números ni textos */
  importantes: string[];
  /** L5: los protocolos que creaste (o los que vienen, cambiados por ti: mismo nombre) */
  protocolos: Protocolo[];
  /** L5: el que está corriendo, o null */
  protocolo: ProtocoloActivo | null;
  /** L5: lo de fondo quieto porque lo pediste (al salir de casa: «déjalo quieto»), o null. Aparte de fondoPausado, que es del vigía */
  fondoQuieto: string | null;
  /** L6: en la llamada, solo tu voz (frase por frase; services/voz/VozFrase.ts) y cómo fue la última llamada */
  voz: VozLlamada;
}

/** L6: «solo tu voz» (lo que dice otra voz no se toma) y las frases de la última llamada, por clase */
export interface VozLlamada {
  soloTuya: boolean;
  ultima: { t: string; cuenta: Record<"tuya" | "dudosa" | "otra" | "corta" | "sin", number> } | null;
}
const VOZ_INICIAL: VozLlamada = { soloTuya: true, ultima: null };

const archivo = () => join(os.homedir(), ".eris", "hestia.json");
let cache: EstadoHestia | null = null;
let cola: Promise<unknown> = Promise.resolve();

const nuevo = (): EstadoHestia => ({ version: 1, pausa: null, limites: structuredClone(LIMITES_INICIALES), fondoPausado: null, sinArchivos: null,
  hablar: { ...HABLAR_INICIAL }, presencia: { ...PRESENCIA_INICIAL }, importantes: [], protocolos: [], protocolo: null, fondoQuieto: null,
  voz: structuredClone(VOZ_INICIAL) });
const isoO = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);

function sano(x: any): EstadoHestia {
  const e = nuevo();
  if (!x || typeof x !== "object") return e;
  const p = x.pausa;
  if (p && typeof p.desde === "string" && typeof p.motivo === "string") {
    e.pausa = { desde: p.desde, hasta: typeof p.hasta === "string" ? p.hasta : null, motivo: p.motivo.slice(0, 200), por: ["panel", "voz", "chat", "vigia"].includes(p.por) ? p.por : "panel" };
  }
  for (const k of Object.keys(e.limites) as ClaveLimite[]) {
    const l = x.limites?.[k];
    if (!l) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : v === null ? null : undefined);
    const a = num(l.aviso), b = num(l.accion);
    if (a !== undefined) e.limites[k].aviso = a;
    if (b !== undefined) e.limites[k].accion = b;
    if (["solo_aviso", "pausar_fondo", "pausar_hestia", "sin_archivos"].includes(l.que)) e.limites[k].que = l.que;
  }
  e.fondoPausado = typeof x.fondoPausado === "string" ? x.fondoPausado : null;
  e.sinArchivos = typeof x.sinArchivos === "string" ? x.sinArchivos : null;
  for (const k of Object.keys(e.hablar) as Array<keyof Hablar>) if (typeof x.hablar?.[k] === "boolean") e.hablar[k] = x.hablar[k];
  if (Array.isArray(x.importantes)) e.importantes = limpiarImportantes(x.importantes);
  if (Array.isArray(x.protocolos)) {
    const vistos = new Set<string>();
    for (const p of x.protocolos.map(protocoloSano)) if (p && !vistos.has(p.nombre) && vistos.size < MAX_PROPIOS) { vistos.add(p.nombre); e.protocolos.push({ ...p, propio: true }); }
  }
  e.protocolo = activoSano(x.protocolo);
  e.fondoQuieto = typeof x.fondoQuieto === "string" ? x.fondoQuieto.slice(0, 120) : null;
  if (x.voz && typeof x.voz === "object") {
    if (typeof x.voz.soloTuya === "boolean") e.voz.soloTuya = x.voz.soloTuya;
    const u = x.voz.ultima, c = u?.cuenta;
    if (u && isoO(u.t) && c && typeof c === "object") {
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(100_000, Math.round(v)) : 0);
      e.voz.ultima = { t: u.t, cuenta: { tuya: n(c.tuya), dudosa: n(c.dudosa), otra: n(c.otra), corta: n(c.corta), sin: n(c.sin) } };
    }
  }
  const pr = x.presencia;
  if (pr && typeof pr === "object") {
    e.presencia = {
      enCasa: typeof pr.enCasa === "boolean" ? pr.enCasa : null, desde: isoO(pr.desde), fueraDesde: isoO(pr.fueraDesde),
      ultimaBienvenida: isoO(pr.ultimaBienvenida), saludoAudifonos: typeof pr.saludoAudifonos === "string" ? pr.saludoAudifonos.slice(0, 20) : null,
    };
  }
  return e;
}

/** El estado (en memoria después de la primera lectura) */
export async function leerEstado(): Promise<EstadoHestia> {
  if (cache) return cache;
  try { cache = sano(JSON.parse(await readFile(archivo(), "utf-8"))); } catch { cache = nuevo(); }
  return cache;
}

/** Cambia el estado y lo guarda de una vez (uno a la vez: dos cambios seguidos no se pisan) */
export function cambiarEstado(f: (e: EstadoHestia) => void): Promise<EstadoHestia> {
  const run = cola.then(async () => {
    const e = structuredClone(await leerEstado());
    f(e);
    const sanoE = sano(e);
    await mkdir(join(os.homedir(), ".eris"), { recursive: true });
    const tmp = `${archivo()}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(sanoE, null, 1), "utf-8");
    for (let i = 0; ; i++) {
      try { await rename(tmp, archivo()); break; } catch (err: any) {
        if (i < 6 && ["EPERM", "EBUSY", "EACCES"].includes(err?.code)) { await new Promise((r) => setTimeout(r, 20 * (i + 1))); continue; }
        await unlink(tmp).catch(() => {});
        throw err;
      }
    }
    cache = sanoE;
    return sanoE;
  });
  cola = run.catch(() => {});
  return run;
}

/** ¿Está en pausa ahora? (una pausa con hora de término vencida ya no cuenta) */
export function pausaVigente(e: EstadoHestia, ahora = new Date()): Pausa | null {
  if (!e.pausa) return null;
  if (e.pausa.hasta && Date.parse(e.pausa.hasta) <= ahora.getTime()) return null;
  return e.pausa;
}

export async function pausar(motivo: string, por: QuienPausa, minutos?: number | null, ahora = new Date()): Promise<EstadoHestia> {
  return cambiarEstado((e) => {
    e.pausa = { desde: ahora.toISOString(), hasta: minutos && minutos > 0 ? new Date(ahora.getTime() + minutos * 60_000).toISOString() : null, motivo, por };
  });
}

export async function reanudar(): Promise<EstadoHestia> {
  return cambiarEstado((e) => { e.pausa = null; });
}

export async function guardarLimites(l: Partial<Record<ClaveLimite, Partial<Limite>>>): Promise<EstadoHestia> {
  return cambiarEstado((e) => {
    for (const k of Object.keys(l) as ClaveLimite[]) if (e.limites[k] && l[k]) e.limites[k] = { ...e.limites[k], ...l[k] } as Limite;
  });
}

/** L1: qué puede decir en voz alta (desde el panel) */
export async function guardarHablar(h: Partial<Hablar>): Promise<EstadoHestia> {
  return cambiarEstado((e) => { for (const k of Object.keys(e.hablar) as Array<keyof Hablar>) if (typeof h[k] === "boolean") e.hablar[k] = h[k]!; });
}

/** L6: «solo tu voz» en la llamada (desde el panel) */
export async function guardarVoz(v: { soloTuya?: unknown }): Promise<EstadoHestia> {
  return cambiarEstado((e) => { if (typeof v.soloTuya === "boolean") e.voz.soloTuya = v.soloTuya; });
}

/** L6: cómo fue la última llamada (cuántas frases de cada clase); una llamada sin frases revisadas no borra la anterior */
export async function guardarVozLlamada(cuenta: NonNullable<VozLlamada["ultima"]>["cuenta"], t = new Date()): Promise<void> {
  const total = Object.values(cuenta).reduce((a, b) => a + b, 0);
  if (!total) return;
  await cambiarEstado((e) => { e.voz.ultima = { t: t.toISOString(), cuenta: { ...cuenta } }; });
}

/** L2: la lista de importantes, sin repetidos (por nombre plegado), cortos y con tope */
export function limpiarImportantes(xs: unknown[]): string[] {
  const out: string[] = [], vistos = new Set<string>();
  for (const x of xs) {
    if (typeof x !== "string") continue;
    const n = x.replace(/\s+/g, " ").trim().slice(0, 40);
    const k = plegar(n);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    out.push(n);
    if (out.length >= MAX_IMPORTANTES) break;
  }
  return out;
}

export async function guardarImportantes(lista: unknown[]): Promise<EstadoHestia> {
  return cambiarEstado((e) => { e.importantes = limpiarImportantes(lista); });
}

/** «avísame cuando me escriba Pedro»: true si se agregó (false si ya estaba) */
export async function agregarImportante(nombre: string): Promise<boolean> {
  const k = plegar(nombre);
  let nuevo = false;
  await cambiarEstado((e) => { if (k && !e.importantes.some((x) => plegar(x) === k)) { e.importantes = limpiarImportantes([...e.importantes, nombre]); nuevo = true; } });
  return nuevo;
}

/** «deja de avisarme de Pedro»: el nombre como estaba guardado, o null si no estaba */
export async function quitarImportante(nombre: string): Promise<string | null> {
  const k = plegar(nombre);
  let quitado: string | null = null;
  await cambiarEstado((e) => {
    const i = e.importantes.findIndex((x) => plegar(x) === k);
    if (i >= 0) { quitado = e.importantes[i]; e.importantes = e.importantes.filter((_, j) => j !== i); }
  });
  return quitado;
}

/** Para las pruebas: olvidar lo leído (otro HOME) */
export function _olvidarEstado(): void { cache = null; cola = Promise.resolve(); }
