// ============================================================
// Eris — Cuánto ocupa cada llamada al modelo (2026-11-11)
//
// Cada mensaje del teléfono corre dentro de un contexto con el perfil y el tipo de trabajo (chat, voz o lateral:
// resúmenes, plan del día, tarjetas). Cada llamada a Ollama avisa acá cuánto tardó: el tiempo que el modelo trabajó
// (total_duration de Ollama) y el que esperó en cola. Así se sabe cuánto PC usa cada persona, sin leer lo que escribe.
// Lo recibe la medición de la beta (services/BetaMetrics.ts); sin escucha, no hace nada.
// ============================================================

import { AsyncLocalStorage } from "node:async_hooks";

export type TipoTrabajo = "chat" | "voz" | "lateral";

export interface ContextoUso {
  profileId: string | null;
  tipo: TipoTrabajo;
  /** Llamadas al modelo dentro de este mensaje (dice si la respuesta pasó por el modelo o la dio el código). */
  llamadas: number;
}

export interface LlamadaModelo {
  profileId: string | null;
  tipo: TipoTrabajo;
  /** Lo que el modelo trabajó (carga + leer el prompt + escribir). */
  modeloMs: number;
  /** Lo que la petición esperó antes de que el modelo la tomara (otra respuesta en curso). */
  esperaMs: number;
  ok: boolean;
}

export const contextoUso = new AsyncLocalStorage<ContextoUso>();

let escucha: ((l: LlamadaModelo) => void) | null = null;

/** La medición de la beta se registra acá al arrancar el servidor. */
export function alMedirModelo(fn: ((l: LlamadaModelo) => void) | null): void { escucha = fn; }

/**
 * Lo llama el proveedor del modelo al terminar cada llamada. `modeloMs` es lo que informa Ollama; si no llegó (error o
 * corte), se usa el tiempo total y no se cuenta espera.
 */
export function registrarLlamada(totalMs: number, modeloMs: number | null, ok: boolean): void {
  const ctx = contextoUso.getStore();
  if (ctx) ctx.llamadas++;
  if (!escucha) return;
  const total = Math.max(0, totalMs);
  const trabajo = modeloMs != null && Number.isFinite(modeloMs) && modeloMs >= 0 ? Math.min(modeloMs, total) : total;
  try {
    escucha({ profileId: ctx?.profileId ?? null, tipo: ctx?.tipo ?? "lateral", modeloMs: trabajo, esperaMs: Math.max(0, total - trabajo), ok });
  } catch { /* medir nunca rompe una respuesta */ }
}
