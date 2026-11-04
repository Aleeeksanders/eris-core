// ============================================================
// Eris — La despensa de verdad (fase I7, 2026-10-23)
//
// Lo que hay en Alimentos y Despensa del Inventario (el último respaldo que mandó el teléfono, que se manda con cada cambio),
// convertido en alimentos del catálogo del asesor. Reemplaza al «¿qué tienes a mano?» dicho de palabra (`pantry_latest`):
// el asesor arma primero con lo que hay en casa, lo que vence pronto antes, para llegar a las metas de Forge.
// Lo vencido no se propone. Las cosas que el catálogo no conoce (una galleta de marca, el detergente) no entran.
// ============================================================

import { lastInventoryState } from "./InventoryBackup.js";
import { hoyStr } from "./InventoryCore.js";
import { matchFoods } from "./MealRecommender.js";

export interface HomePantry {
  /** los nombres tal como están en el Inventario, solo los que el catálogo reconoce */
  frags: string[];
  /** ids del catálogo de lo que hay */
  ids: Set<string>;
  /** ids de lo que vence en 3 días o menos (se usa primero) */
  pronto: Set<string>;
  /** los nombres que vencen pronto, para decirlo */
  prontoNombres: string[];
  /** cuándo mandó el teléfono ese estado */
  at: string;
}

const AREAS = new Set(["alimentos", "despensa"]);
const DAY = 86_400_000;

type Mem = Parameters<typeof lastInventoryState>[0];

/** La despensa de la casa, o null si no hay Inventario o casi nada de lo que tiene se puede cocinar. */
export async function homePantry(memory: Mem | null | undefined, now: Date = new Date()): Promise<HomePantry | null> {
  if (!memory) return null;
  const last = await lastInventoryState(memory).catch(() => null);
  return last ? pantryFrom(last.state, last.at, now) : null;
}

/** Lo mismo desde un estado del Inventario (puro: lo usan las pruebas). */
export function pantryFrom(state: { items?: Array<{ nombre: string; area: string; cantidad: number; vence?: string | null; archivado?: boolean }> } | null | undefined, at: string, now: Date = new Date()): HomePantry | null {
  const last = { state, at };
  if (!last.state?.items?.length) return null;
  const hoy = hoyStr(now);
  const frags: string[] = [];
  const ids = new Set<string>();
  const pronto = new Set<string>();
  const prontoNombres: string[] = [];
  for (const it of last.state.items!) {
    if (it.archivado || !AREAS.has(it.area) || !(it.cantidad > 0)) continue;
    if (it.vence && it.vence < hoy) continue; // vencido: no se propone
    const found = matchFoods(it.nombre);
    if (!found.length) continue;
    frags.push(it.nombre);
    for (const f of found) ids.add(f.id);
    if (it.vence && new Date(`${it.vence}T12:00:00`).getTime() - now.getTime() <= 3 * DAY) {
      for (const f of found) pronto.add(f.id);
      prontoNombres.push(it.nombre);
    }
  }
  return frags.length >= 2 ? { frags, ids, pronto, prontoNombres, at: last.at } : null;
}

/** «el 23-10 a las 14:05» */
export function cuando(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `el ${d.getDate()}-${d.getMonth() + 1} a las ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}
