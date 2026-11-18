// ============================================================
// Hestia como JARVIS · C6 (L4, 2026-11-18): ¿puede usar el modelo para algo de fondo AHORA? Por código, sin el modelo.
// El modelo es uno solo y lo comparten Eris (todas sus cuentas) y Hestia: lo de fondo nunca le quita el turno a nadie.
//  - no: Hestia en pausa, lo de fondo en espera (el vigía del equipo, L0), una llamada abierta con ella, alguien usando el chat
//    (una respuesta en curso, o un mensaje hace menos de 90 s);
//  - no: el equipo justo (RAM libre bajo el límite de acción + un margen, la tarjeta caliente, la CPU al tope, el notebook con
//    poca batería y sin cargador).
// ============================================================
import type { Limites } from "./Estado.js";
import type { Medicion } from "./Equipo.js";

export interface CtxPresupuesto {
  pausada: boolean;
  /** el vigía puso lo de fondo en espera (por qué), o null */
  fondoPausado: string | null;
  /** L5: lo pediste quieto (al salir de casa), o null */
  fondoQuieto?: string | null;
  /** hay una llamada abierta con Hestia */
  llamada: boolean;
  /** alguna respuesta en curso (de cualquier cuenta) */
  consultaEnCurso: boolean;
  /** ms desde el último mensaje de alguien (chat o voz) */
  msDesdeUltima: number;
  medicion: Medicion | null;
  limites: Limites;
}

/** Sin nadie usando el chat por esto, se puede (el banco de pruebas lo acorta con HESTIA_QUIETO_MS) */
export const QUIETO_MS = process.env.HESTIA_QUIETO_MS != null && Number.isFinite(Number(process.env.HESTIA_QUIETO_MS)) ? Number(process.env.HESTIA_QUIETO_MS) : 90_000;

export function puedeFondo(c: CtxPresupuesto): { ok: boolean; motivo: string } {
  const no = (motivo: string) => ({ ok: false, motivo });
  if (c.pausada) return no("Hestia en pausa");
  if (c.fondoPausado) return no(`lo de fondo en espera: ${c.fondoPausado}`);
  if (c.fondoQuieto) return no(`lo de fondo quieto: ${c.fondoQuieto}`);
  if (c.llamada) return no("estás en una llamada con Hestia");
  if (c.consultaEnCurso) return no("alguien está usando el chat");
  if (c.msDesdeUltima < QUIETO_MS) return no("hace poco usaron el chat");
  const m = c.medicion;
  if (m) {
    const L = c.limites;
    const ramMin = (L.ramLibreGb.accion ?? 1) + 0.25;
    if (m.ramLibreGb < ramMin) return no(`poca RAM libre (${m.ramLibreGb.toLocaleString("es-CL")} GB)`);
    if (m.gpu && L.gpuTempC.aviso != null && m.gpu.tempC >= L.gpuTempC.aviso) return no(`la tarjeta está a ${Math.round(m.gpu.tempC)} °C`);
    if (L.cpuPct.aviso != null && m.cpuPct >= L.cpuPct.aviso) return no(`la CPU al ${Math.round(m.cpuPct)} %`);
    if (m.bateria && !m.bateria.enchufado && L.bateriaPct.aviso != null && m.bateria.pct < L.bateriaPct.aviso) return no("el notebook con poca batería y sin cargador");
  }
  return { ok: true, motivo: "el PC está libre" };
}
