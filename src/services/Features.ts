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
}

export const FEATURE_DEFAULTS: Features = { glucose: false };
export const FEATURE_LABELS: Record<keyof Features, string> = { glucose: "Módulo de glucosa e insulina" };

const file = () => join(os.homedir(), ".eris", "features.json");
let cache: { at: number; value: Features } | null = null;

/** Lo vigente. Un archivo ilegible o ausente = todo apagado (nunca se enciende algo por error). */
export async function getFeatures(): Promise<Features> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  let value: Features = { ...FEATURE_DEFAULTS };
  try {
    const raw = JSON.parse(await readFile(file(), "utf-8"));
    value = { glucose: raw?.glucose === true };
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
