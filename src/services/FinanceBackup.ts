// ============================================================
// Eris — respaldo de Finanzas en el PC (2026-10-15)
//
// Los datos de plata vivían SOLO en el teléfono (localStorage del WebView de Finanzas): si se borraban los datos de la
// app, se perdía todo. Ahora el teléfono manda un volcado de todas las claves de Finanzas cada vez que algo cambia
// (eris-mobile/src/services/financeBackup.ts) y acá se guarda CIFRADO, como todo lo del perfil (memory.ts, ERISENC1):
//   - una copia por día, las últimas 7 (`finance_backup_d_<día>`), y un índice con lo que trae cada una;
//   - un Finanzas VACÍO nunca pisa un respaldo con datos (reinstalaste o borraste los datos de la app): se responde
//     con el respaldo que hay, para que el teléfono ofrezca restaurarlo.
// ============================================================

import { isoDayKey } from "./MealSchedule.js";

export interface FinanceDump {
  v: number; profile: string; at: string;
  keys: Record<string, string>;
  stats: { tx: number; cuentas: number; claves: number };
}
export interface BackupCopy { day: string; at: string; hash: string; stats: FinanceDump["stats"]; size: number }
interface Mem { get(key: string): Promise<any>; set(key: string, value: any): Promise<void> }

export const KEEP_DAYS = 7;
const MAX_TOTAL = 8 * 1024 * 1024;   // 8 MB de texto: años de movimientos
const KEY_RX = /^hw[\w-]{0,60}$/;
const INDEX = "finance_backup_index";
const copyKey = (day: string) => `finance_backup_d_${day}`;

function countOf(raw: string | undefined): number {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v.length : 0; } catch { return 0; }
}

/** Lo que manda el teléfono es entrada externa: solo claves de Finanzas, solo texto, con tope de tamaño. */
export function sanitizeDump(raw: unknown, profileId: string): FinanceDump | null {
  const r = raw as any;
  if (!r || typeof r !== "object" || !r.keys || typeof r.keys !== "object" || Array.isArray(r.keys)) return null;
  if (typeof r.profile !== "string" || r.profile !== profileId) return null; // nunca el Finanzas de otra cuenta
  const keys: Record<string, string> = {};
  let size = 0;
  for (const [k, v] of Object.entries(r.keys)) {
    if (!KEY_RX.test(k) || typeof v !== "string") continue;
    size += k.length + v.length;
    if (size > MAX_TOTAL) return null;
    keys[k] = v;
  }
  const at = typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? r.at : new Date().toISOString();
  // Las cifras se cuentan acá, no se confía en las del teléfono
  return { v: 1, profile: profileId, at, keys, stats: { tx: countOf(keys.hw2_tx), cuentas: countOf(keys.hw2_cuentas), claves: Object.keys(keys).length } };
}

export function hashOf(d: FinanceDump): string {
  const s = JSON.stringify(Object.keys(d.keys).sort().map((k) => [k, d.keys[k]]));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

const isEmpty = (d: { stats: FinanceDump["stats"] }) => d.stats.tx === 0 && d.stats.cuentas === 0;

async function readIndex(memory: Mem): Promise<BackupCopy[]> {
  const idx = await memory.get(INDEX).catch(() => null);
  return Array.isArray(idx?.copies) ? (idx.copies as BackupCopy[]) : [];
}

type SaveResult = { ok: true; hash: string; saved: boolean; unchanged?: boolean; kept?: "previous"; restore?: Omit<BackupCopy, "hash"> };

// Un respaldo a la vez por perfil: dos volcados seguidos (la pantalla y el chat) no se pisan el índice
const chains = new WeakMap<object, Promise<unknown>>();

/**
 * Guarda el volcado como la copia de hoy. `kept: "previous"` = no se guardó porque venía vacío y hay un respaldo con
 * datos (`restore` dice cuál); `unchanged` = igual a la copia de hoy.
 */
export function saveFinanceBackup(memory: Mem, dump: FinanceDump, now = new Date()): Promise<SaveResult> {
  const run = (chains.get(memory) ?? Promise.resolve()).then(() => save(memory, dump, now), () => save(memory, dump, now));
  chains.set(memory, run.catch(() => {}));
  return run;
}

async function save(memory: Mem, dump: FinanceDump, now: Date): Promise<SaveResult> {
  const hash = hashOf(dump);
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

/** Las copias (sin el contenido), la más nueva primero. */
export async function listFinanceBackups(memory: Mem): Promise<Array<Omit<BackupCopy, "hash">>> {
  return (await readIndex(memory)).map(({ hash: _h, ...c }) => c);
}

/** El contenido de una copia (por día; sin día, la más nueva). */
export async function pullFinanceBackup(memory: Mem, day?: string): Promise<FinanceDump | null> {
  const copies = await readIndex(memory);
  const pick = day ? copies.find((c) => c.day === day) : copies[0];
  if (!pick) return null;
  const d = await memory.get(copyKey(pick.day)).catch(() => null);
  return d && typeof d === "object" && d.keys ? (d as FinanceDump) : null;
}
