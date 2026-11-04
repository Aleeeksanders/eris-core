// ============================================================
// Eris — funciones con visto bueno
//
// Módulos que existen en el código pero que el administrador todavía no aprueba para los usuarios (2026-10-07: el de
// glucosa, porque la integración con el sensor —LibreLinkUp, Linx— no está revisada). Apagados por defecto; solo un
// Ikaros los enciende desde el panel de administración. Viven en ~/.eris/features.json para que activarlos no
// necesite una APK nueva ni reiniciar el servidor.
// ============================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import os from "node:os";

export interface Features {
  /** Módulo de glucosa: lectura del sensor, alertas, registro de insulina, pestaña en la app y consultas por chat. */
  glucose: boolean;
  /** ⚡ Modo Rendimiento (día exigente) en «¿Qué recomienda Eris?»: empuja contra el cansancio, así que primero solo Ikaros. */
  rendimiento: boolean;
  /** «Eris administra» Finanzas: anota sola lo que avisa el banco (2026-10-30). Primero solo Ikaros (lo decide la app con su rol). */
  finanzasAuto: boolean;
}

export const FEATURE_DEFAULTS: Features = { glucose: false, rendimiento: false, finanzasAuto: false };
export const FEATURE_LABELS: Record<keyof Features, string> = { glucose: "Módulo de glucosa e insulina", rendimiento: "Modo Rendimiento (día exigente)", finanzasAuto: "Finanzas en automático (avisos del banco)" };

const file = () => join(os.homedir(), ".eris", "features.json");
let cache: { at: number; value: Features } | null = null;

/** Lo vigente. Un archivo ilegible o ausente = todo apagado (nunca se enciende algo por error). */
export async function getFeatures(): Promise<Features> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  let value: Features = { ...FEATURE_DEFAULTS };
  try {
    const raw = JSON.parse(await readFile(file(), "utf-8"));
    value = { glucose: raw?.glucose === true, rendimiento: raw?.rendimiento === true, finanzasAuto: raw?.finanzasAuto === true };
  } catch { /* sin archivo: valores por defecto */ }
  cache = { at: Date.now(), value };
  return value;
}

export async function setFeature(name: keyof Features, enabled: boolean): Promise<Features> {
  const next = { ...(await getFeatures()), [name]: enabled === true };
  await mkdir(dirname(file()), { recursive: true });
  await writeFile(file(), JSON.stringify(next, null, 2), "utf-8");
  cache = { at: Date.now(), value: next };
  return next;
}

export const isFeatureName = (s: unknown): s is keyof Features => typeof s === "string" && s in FEATURE_DEFAULTS;
