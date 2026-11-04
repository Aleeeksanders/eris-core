// ============================================================
// Eris — respaldo de Inventario en el PC (2026-10-22, fase I2)
//
// Inventario vive en el teléfono (AsyncStorage, por cuenta). Cada vez que cambia, el teléfono manda su estado
// (eris-mobile/src/services/inventoryBackup.ts) y acá se guarda CIFRADO, como todo lo del perfil (memory.ts, ERISENC1).
// Mismo esquema que Finanzas y Forge:
//   - una copia por día, las últimas 7 (`inventory_backup_d_<día>`), y un índice con lo que trae cada una;
//   - un Inventario VACÍO nunca pisa un respaldo con datos (reinstalaste o borraste los datos de la app): se responde con
//     el respaldo que hay, para que el teléfono ofrezca restaurarlo.
// El chat también lee la última copia («¿tengo arroz?») cuando el teléfono no está conectado.
// ============================================================

import { isoDayKey } from "./MealSchedule.js";
import { normalizar, type InventoryState } from "./InventoryCore.js";
import { moduloOn } from "./AutoPrefs.js";

export interface InventoryStats { items: number; conStock: number; movs: number }
export interface InventoryDump { v: number; profile: string; at: string; keys: Record<string, string>; stats: InventoryStats }
export interface InventoryBackupCopy { day: string; at: string; hash: string; stats: InventoryStats; size: number }
interface Mem { get(key: string): Promise<any>; set(key: string, value: any): Promise<void> }

export const KEEP_DAYS = 7;
const MAX_TOTAL = 4 * 1024 * 1024;   // miles de cosas y su historial caben de sobra
/** La clave que se respalda (el estado completo del Inventario). */
export const INVENTORY_KEY = "inventory_state_v1";
const INDEX = "inventory_backup_index";
const copyKey = (day: string) => `inventory_backup_d_${day}`;

/** Lo que trae un volcado (se cuenta acá, no se confía en el teléfono). */
export function inventoryStatsOf(keys: Record<string, string>): InventoryStats {
  let st: InventoryState | null = null;
  try { st = normalizar(JSON.parse(keys[INVENTORY_KEY] ?? "null")); } catch {}
  const items = (st?.items ?? []).filter((i) => !i.archivado);
  return { items: items.length, conStock: items.filter((i) => i.cantidad > 0).length, movs: st?.movs.length ?? 0 };
}

/** Lo que manda el teléfono es entrada externa: solo la clave de Inventario, solo texto JSON válido, con tope de tamaño. */
export function sanitizeInventoryDump(raw: unknown, profileId: string): InventoryDump | null {
  const r = raw as any;
  if (!r || typeof r !== "object" || !r.keys || typeof r.keys !== "object" || Array.isArray(r.keys)) return null;
  if (typeof r.profile !== "string" || r.profile !== profileId) return null; // nunca el Inventario de otra cuenta
  const v = r.keys[INVENTORY_KEY];
  if (typeof v !== "string" || v.length > MAX_TOTAL) return null;
  try { JSON.parse(v); } catch { return null; }
  const keys = { [INVENTORY_KEY]: v };
  const at = typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? r.at : new Date().toISOString();
  return { v: 1, profile: profileId, at, keys, stats: inventoryStatsOf(keys) };
}

export function inventoryHashOf(d: { keys: Record<string, string> }): string {
  const s = JSON.stringify(Object.keys(d.keys).sort().map((k) => [k, d.keys[k]]));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

const isEmpty = (d: { stats: InventoryStats }) => d.stats.items === 0 && d.stats.movs === 0;

async function readIndex(memory: Mem): Promise<InventoryBackupCopy[]> {
  const idx = await memory.get(INDEX).catch(() => null);
  return Array.isArray(idx?.copies) ? (idx.copies as InventoryBackupCopy[]) : [];
}

type SaveResult = { ok: true; hash: string; saved: boolean; unchanged?: boolean; kept?: "previous"; restore?: Omit<InventoryBackupCopy, "hash"> };

// Un respaldo a la vez por perfil: dos volcados seguidos no se pisan el índice
const chains = new WeakMap<object, Promise<unknown>>();

export function saveInventoryBackup(memory: Mem, dump: InventoryDump, now = new Date()): Promise<SaveResult> {
  const run = (chains.get(memory) ?? Promise.resolve()).then(() => save(memory, dump, now), () => save(memory, dump, now));
  chains.set(memory, run.catch(() => {}));
  return run;
}

async function save(memory: Mem, dump: InventoryDump, now: Date): Promise<SaveResult> {
  const hash = inventoryHashOf(dump);
  const copies = await readIndex(memory);
  const withData = copies.find((c) => !isEmpty(c));
  if (isEmpty(dump) && withData) {
    const { hash: _h, ...restore } = withData;
    return { ok: true, hash, saved: false, kept: "previous", restore };
  }
  const day = isoDayKey(now);
  const today = copies.find((c) => c.day === day);
  if (today?.hash === hash) return { ok: true, hash, saved: false, unchanged: true };

  const size = Object.entries(dump.keys).reduce((a, [k, v]) => a + k.length + v.length, 0);
  await memory.set(copyKey(day), dump);
  const next = [{ day, at: dump.at, hash, stats: dump.stats, size }, ...copies.filter((c) => c.day !== day)]
    .sort((a, b) => (a.day < b.day ? 1 : -1));
  const keep = next.slice(0, KEEP_DAYS);
  for (const old of next.slice(KEEP_DAYS)) await memory.set(copyKey(old.day), null);
  await memory.set(INDEX, { copies: keep });
  return { ok: true, hash, saved: true };
}

export async function listInventoryBackups(memory: Mem): Promise<Array<Omit<InventoryBackupCopy, "hash">>> {
  return (await readIndex(memory)).map(({ hash: _h, ...c }) => c);
}

/** El contenido de una copia (por día; sin día, la más nueva). */
export async function pullInventoryBackup(memory: Mem, day?: string): Promise<InventoryDump | null> {
  const copies = await readIndex(memory);
  const pick = day ? copies.find((c) => c.day === day) : copies[0];
  if (!pick) return null;
  const d = await memory.get(copyKey(pick.day)).catch(() => null);
  return d && typeof d === "object" && d.keys ? (d as InventoryDump) : null;
}

/** El estado del último respaldo (para leerlo desde el chat sin el teléfono). */
export async function lastInventoryState(memory: Mem): Promise<{ state: InventoryState; at: string } | null> {
  // Revisión A2: con el Inventario apagado en Perfil, ni el Plan, ni el asesor, ni la agenda ven la despensa
  if (!(await moduloOn(memory, "inventario"))) return null;
  const d = await pullInventoryBackup(memory).catch(() => null);
  if (!d) return null;
  try { return { state: normalizar(JSON.parse(d.keys[INVENTORY_KEY] ?? "null")), at: d.at }; } catch { return null; }
}
