// ============================================================
// Hestia como JARVIS · L0 (2026-11-17): el vigía del equipo («el traje está al 48 %»). Cada 60 s mide (Equipo.medir, ~0,3 s),
// guarda 24 h de historial (una muestra por minuto) y compara con los límites que eligió en el panel (Estado.limites):
//  - aviso: le avisa (notificación «Hestia · equipo»; con audífonos, por voz cuando esté el Altavoz) — a lo más 1 vez por hora
//    por límite (el disco, 1 vez al día);
//  - acción: pausar los trabajos de fondo, no crear archivos grandes o pausar a Hestia (solo Hestia). Lo que hizo el vigía lo
//    deshace él mismo cuando el equipo vuelve a estar bien (con margen: VUELVE), y lo dice.
// `evaluar` es una función pura (se prueba sin el equipo); el bucle es `iniciarVigia`.
// ============================================================
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import * as os from "node:os";
import { medir, type Medicion } from "./Equipo.js";
import { leerEstado, cambiarEstado, pausaVigente, VUELVE, type ClaveLimite, type EstadoHestia, type Limites } from "./Estado.js";

export interface Alerta { clave: ClaveLimite; nivel: "aviso" | "accion" | "vuelve"; texto: string }
/** Lo que el vigía cambia en el estado (undefined = no toca; null = lo quita) */
export interface Cambios { pausaVigia?: string | null; fondoPausado?: string | null; sinArchivos?: string | null }
/** Lo que el vigía recuerda entre una muestra y otra */
export interface Memoria { cpuAltaDesde: number | null; ultimoAviso: Partial<Record<string, number>> }

const NOMBRE: Record<ClaveLimite, string> = { ramLibreGb: "la RAM", discoLibreGb: "el disco", gpuTempC: "la tarjeta de video", vramGb: "la memoria de la tarjeta", cpuPct: "la CPU", bateriaPct: "la batería" };
const coma = (n: number) => n.toLocaleString("es-CL", { maximumFractionDigits: 1 });

/** El valor de una medición para ese límite (null si no se pudo medir o no aplica) */
export function valor(m: Medicion, k: ClaveLimite): number | null {
  switch (k) {
    case "ramLibreGb": return m.ramLibreGb;
    case "discoLibreGb": return m.discoLibreGb;
    case "gpuTempC": return m.gpu?.tempC ?? null;
    case "vramGb": return m.gpu?.vramUsadaGb ?? null;
    case "cpuPct": return m.cpuPct;
    case "bateriaPct": return m.bateria && !m.bateria.enchufado ? m.bateria.pct : null; // enchufado: no cuenta
  }
}
/** ¿Más es peor? (temperatura, memoria de la tarjeta, CPU) o ¿menos es peor? (RAM y disco libres, batería) */
const SUBE_MAL: Record<ClaveLimite, boolean> = { ramLibreGb: false, discoLibreGb: false, gpuTempC: true, vramGb: true, cpuPct: true, bateriaPct: false };
const pasa = (k: ClaveLimite, v: number, umbral: number) => (SUBE_MAL[k] ? v >= umbral : v <= umbral);
const unidad = (k: ClaveLimite, v: number) => (k === "gpuTempC" ? `${Math.round(v)} °C` : k === "cpuPct" || k === "bateriaPct" ? `${Math.round(v)} %` : `${coma(v)} GB`);

const CPU_SOSTENIDA_MS = 5 * 60_000;
const ENTRE_AVISOS_MS: Partial<Record<ClaveLimite, number>> = { discoLibreGb: 24 * 3600_000 };
const ENTRE_AVISOS_DEF = 3600_000;
const ENTRE_ACCIONES_MS = 15 * 60_000;

/**
 * Compara una medición con los límites. Devuelve qué avisar y qué cambiar. No toca nada (la memoria sí: es la del vigía).
 * Lo que puso el vigía (pausa, fondo, sin archivos) se quita cuando ese valor vuelve a estar bien con margen.
 */
export function evaluar(m: Medicion, e: EstadoHestia, mem: Memoria, ahora = Date.now()): { alertas: Alerta[]; cambios: Cambios } {
  const alertas: Alerta[] = [];
  const cambios: Cambios = {};
  const L: Limites = e.limites;
  // la CPU cuenta solo si está alta 5 minutos seguidos
  const cpuAlta = L.cpuPct.aviso != null && m.cpuPct >= L.cpuPct.aviso;
  mem.cpuAltaDesde = cpuAlta ? mem.cpuAltaDesde ?? ahora : null;
  const puedeAvisar = (clave: string, cada: number) => { const u = mem.ultimoAviso[clave]; if (u != null && ahora - u < cada) return false; mem.ultimoAviso[clave] = ahora; return true; };
  const motivos: Record<"pausar_hestia" | "pausar_fondo" | "sin_archivos", string[]> = { pausar_hestia: [], pausar_fondo: [], sin_archivos: [] };
  for (const k of Object.keys(L) as ClaveLimite[]) {
    const v = valor(m, k);
    if (v == null) continue;
    if (k === "cpuPct" && (mem.cpuAltaDesde == null || ahora - mem.cpuAltaDesde < CPU_SOSTENIDA_MS)) continue;
    const lim = L[k];
    const enAccion = lim.accion != null && pasa(k, v, lim.accion);
    const enAviso = lim.aviso != null && pasa(k, v, lim.aviso);
    if (enAccion && lim.que !== "solo_aviso") {
      motivos[lim.que].push(`${NOMBRE[k]} en ${unidad(k, v)}`);
      if (puedeAvisar(`${k}:accion`, ENTRE_ACCIONES_MS)) alertas.push({ clave: k, nivel: "accion", texto: textoAccion(k, v, lim.que) });
    } else if (enAviso || enAccion) {
      if (puedeAvisar(`${k}:aviso`, ENTRE_AVISOS_MS[k] ?? ENTRE_AVISOS_DEF)) alertas.push({ clave: k, nivel: "aviso", texto: textoAviso(k, v) });
    }
  }
  // Lo que hace el vigía (y lo que deshace cuando todo vuelve a estar bien, con margen)
  const bien = (que: "pausar_hestia" | "pausar_fondo" | "sin_archivos") => (Object.keys(L) as ClaveLimite[])
    .filter((k) => L[k].que === que && L[k].accion != null)
    .every((k) => { const v = valor(m, k); if (v == null) return true; const vuelve = VUELVE[k] ?? L[k].aviso ?? L[k].accion!; return !pasa(k, v, vuelve); });
  const pausaDelVigia = e.pausa?.por === "vigia" && pausaVigente(e);
  if (motivos.pausar_hestia.length) { if (!pausaDelVigia) cambios.pausaVigia = motivos.pausar_hestia.join(" y "); }
  else if (pausaDelVigia && bien("pausar_hestia")) { cambios.pausaVigia = null; alertas.push({ clave: "gpuTempC", nivel: "vuelve", texto: "El equipo ya está bien: vuelvo a estar activa." }); }
  if (motivos.pausar_fondo.length) { if (!e.fondoPausado) cambios.fondoPausado = motivos.pausar_fondo.join(" y "); }
  else if (e.fondoPausado && bien("pausar_fondo")) cambios.fondoPausado = null;
  if (motivos.sin_archivos.length) { if (!e.sinArchivos) cambios.sinArchivos = motivos.sin_archivos.join(" y "); }
  else if (e.sinArchivos && bien("sin_archivos")) { cambios.sinArchivos = null; alertas.push({ clave: "discoLibreGb", nivel: "vuelve", texto: "Ya hay espacio en el disco: vuelvo a guardar respaldos." }); }
  return { alertas, cambios };
}

function textoAviso(k: ClaveLimite, v: number): string {
  switch (k) {
    case "ramLibreGb": return `Quedan ${coma(v)} GB de RAM libres: si puedes, cierra algo (el panel te dice qué está usando más).`;
    case "discoLibreGb": return `Quedan ${coma(v)} GB en el disco: conviene liberar espacio pronto.`;
    case "gpuTempC": return `La tarjeta de video está a ${Math.round(v)} °C: revisa que el notebook ventile bien.`;
    case "vramGb": return `La memoria de la tarjeta está en ${coma(v)} GB: no cargo nada más ahí.`;
    case "cpuPct": return `La CPU lleva 5 minutos sobre ${Math.round(v)} %.`;
    case "bateriaPct": return `El notebook está a ${Math.round(v)} % de batería y sin cargador.`;
  }
}
function textoAccion(k: ClaveLimite, v: number, que: string): string {
  const hago = que === "pausar_hestia" ? "me pongo en pausa hasta que se recupere" : que === "pausar_fondo" ? "dejo en espera lo que hago de fondo" : "dejo de guardar respaldos y archivos grandes";
  return `${NOMBRE[k].charAt(0).toUpperCase() + NOMBRE[k].slice(1)} en ${unidad(k, v)}: ${hago}.`;
}

// ─── El bucle ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const MAX = 1440;
let historial: Medicion[] = [];
let ultima: Medicion | null = null;
const memoria: Memoria = { cpuAltaDesde: null, ultimoAviso: {} };
let timer: ReturnType<typeof setInterval> | null = null;
let guardadoEn = 0;
const archivoHist = () => join(os.homedir(), ".eris", "hestia_vigia.json");

/** La última medición (la del vigía, de hace menos de un minuto) */
export const ultimaMedicion = () => ultima;
/** El historial de 24 h, resumido para el panel (cada `paso` minutos) */
export function historialResumido(paso = 10): Array<Pick<Medicion, "t" | "cpuPct" | "ramLibreGb" | "discoLibreGb"> & { gpuTempC: number | null; gpuUsoPct: number | null; vramGb: number | null }> {
  return historial.filter((_, i) => i % paso === 0 || i === historial.length - 1)
    .map((m) => ({ t: m.t, cpuPct: m.cpuPct, ramLibreGb: m.ramLibreGb, discoLibreGb: m.discoLibreGb, gpuTempC: m.gpu?.tempC ?? null, gpuUsoPct: m.gpu?.usoPct ?? null, vramGb: m.gpu?.vramUsadaGb ?? null }));
}

/** Una vuelta: medir, guardar, evaluar y aplicar. `alertar` lo pone el servidor (a Hestia, nunca a Eris). */
export async function vuelta(alertar: (a: Alerta) => void): Promise<Medicion> {
  const m = await medir();
  ultima = m;
  historial.push(m);
  if (historial.length > MAX) historial = historial.slice(-MAX);
  const e = await leerEstado();
  const { alertas, cambios } = evaluar(m, e, memoria);
  if (Object.keys(cambios).length) {
    await cambiarEstado((x) => {
      if (cambios.pausaVigia !== undefined) x.pausa = cambios.pausaVigia ? { desde: m.t, hasta: null, motivo: cambios.pausaVigia, por: "vigia" } : null;
      if (cambios.fondoPausado !== undefined) x.fondoPausado = cambios.fondoPausado;
      if (cambios.sinArchivos !== undefined) x.sinArchivos = cambios.sinArchivos;
    }).catch(() => {});
  }
  for (const a of alertas) { try { alertar(a); } catch {} }
  if (Date.now() - guardadoEn > 10 * 60_000) {
    guardadoEn = Date.now();
    const tmp = `${archivoHist()}.tmp`;
    mkdir(join(os.homedir(), ".eris"), { recursive: true }).then(() => writeFile(tmp, JSON.stringify(historial))).then(() => rename(tmp, archivoHist())).catch(() => {});
  }
  return m;
}

/** Parte el vigía (una vez por servidor): primera vuelta a los 20 s, después cada 60 s */
export async function iniciarVigia(alertar: (a: Alerta) => void): Promise<void> {
  if (timer) return;
  try { const h = JSON.parse(await readFile(archivoHist(), "utf-8")); if (Array.isArray(h)) historial = h.filter((x) => x && typeof x.t === "string" && Date.now() - Date.parse(x.t) < 24 * 3600_000).slice(-MAX); } catch {}
  ultima = historial.at(-1) ?? null;
  let corriendo = false;
  const tick = () => { if (corriendo) return; corriendo = true; vuelta(alertar).catch((e) => console.warn("[Vigía] no pude medir:", e?.message ?? e)).finally(() => { corriendo = false; }); };
  setTimeout(tick, 20_000);
  timer = setInterval(tick, 60_000);
}
