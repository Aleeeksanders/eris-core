// ============================================================
// Eris — respaldo de Forge en el PC (2026-10-17, Forge 2.0 F0)
//
// Forge vivía SOLO en el teléfono (localStorage del WebView: `toji-rpg-v1-<perfil>` y la rutina): borrar los datos de
// la app perdía nivel, XP, racha, árbol y todo el historial de entrenos. Ahora el teléfono manda un volcado de esas
// claves cada vez que algo cambia (eris-mobile/src/services/forgeBackup.ts) y acá se guarda CIFRADO, como todo lo del
// perfil (memory.ts, ERISENC1). Mismo esquema que Finanzas (FinanceBackup.ts):
//   - una copia por día, las últimas 7 (`forge_backup_d_<día>`), y un índice con lo que trae cada una;
//   - un Forge VACÍO nunca pisa un respaldo con datos (reinstalaste o borraste los datos de la app): se responde con el
//     respaldo que hay, para que el teléfono ofrezca restaurarlo.
// Las claves van sin el perfil (`toji-rpg-v1`, `toji-routine-md`): el teléfono se lo agrega al restaurar.
// ============================================================

import { isoDayKey } from "./MealSchedule.js";

export interface ForgeStats { dias: number; habilidades: number; xp: number; rutina: boolean; ultimo: string | null; claves: number }
export interface ForgeDump { v: number; profile: string; at: string; keys: Record<string, string>; stats: ForgeStats }
export interface ForgeBackupCopy { day: string; at: string; hash: string; stats: ForgeStats; size: number }
interface Mem { get(key: string): Promise<any>; set(key: string, value: any): Promise<void> }

export const KEEP_DAYS = 7;
const MAX_TOTAL = 6 * 1024 * 1024;   // años de entrenos caben de sobra
/** Las claves de Forge que se respaldan (el estado del RPG y la rutina). */
export const FORGE_KEYS = ["toji-rpg-v1", "toji-routine-md"] as const;
const INDEX = "forge_backup_index";
const copyKey = (day: string) => `forge_backup_d_${day}`;

/** Lo que dice un volcado (se cuenta acá, no se confía en el teléfono). */
export function forgeStatsOf(keys: Record<string, string>): ForgeStats {
  let st: any = null;
  try { st = JSON.parse(keys["toji-rpg-v1"] ?? "null"); } catch {}
  const training = st && typeof st.training === "object" && st.training ? st.training : {};
  const days = Object.keys(training).filter((k) => {
    const day = training[k];
    return day && typeof day === "object" && Object.values(day).some((n) => Number(n) > 0);
  }).sort();
  const skills = st && typeof st.skills === "object" && st.skills ? st.skills : {};
  const habilidades = Object.values(skills).filter((v: any) => Array.isArray(v?.steps) && v.steps.some(Boolean)).length;
  let rutina = false;
  try { rutina = !!JSON.parse(keys["toji-routine-md"] ?? "null")?.md; } catch {}
  return {
    dias: days.length,
    habilidades,
    xp: Math.max(0, Math.round(Number(st?.bankedXp) || 0)),
    rutina,
    ultimo: days.length ? days[days.length - 1] : null,
    claves: Object.keys(keys).length,
  };
}

/** Lo que manda el teléfono es entrada externa: solo las claves de Forge, solo texto, con tope de tamaño. */
export function sanitizeForgeDump(raw: unknown, profileId: string): ForgeDump | null {
  const r = raw as any;
  if (!r || typeof r !== "object" || !r.keys || typeof r.keys !== "object" || Array.isArray(r.keys)) return null;
  if (typeof r.profile !== "string" || r.profile !== profileId) return null; // nunca el Forge de otra cuenta
  const keys: Record<string, string> = {};
  let size = 0;
  for (const k of FORGE_KEYS) {
    const v = r.keys[k];
    if (typeof v !== "string") continue;
    size += k.length + v.length;
    if (size > MAX_TOTAL) return null;
    keys[k] = v;
  }
  // El estado tiene que ser JSON válido: un volcado roto no reemplaza una copia buena
  if (keys["toji-rpg-v1"] !== undefined) { try { JSON.parse(keys["toji-rpg-v1"]); } catch { return null; } }
  const at = typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? r.at : new Date().toISOString();
  return { v: 1, profile: profileId, at, keys, stats: forgeStatsOf(keys) };
}

export function forgeHashOf(d: { keys: Record<string, string> }): string {
  const s = JSON.stringify(Object.keys(d.keys).sort().map((k) => [k, d.keys[k]]));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

const isEmpty = (d: { stats: ForgeStats }) => d.stats.dias === 0 && d.stats.habilidades === 0 && d.stats.xp === 0 && !d.stats.rutina;

async function readIndex(memory: Mem): Promise<ForgeBackupCopy[]> {
  const idx = await memory.get(INDEX).catch(() => null);
  return Array.isArray(idx?.copies) ? (idx.copies as ForgeBackupCopy[]) : [];
}

type SaveResult = { ok: true; hash: string; saved: boolean; unchanged?: boolean; kept?: "previous"; restore?: Omit<ForgeBackupCopy, "hash"> };

// Un respaldo a la vez por perfil: dos volcados seguidos no se pisan el índice
const chains = new WeakMap<object, Promise<unknown>>();

/**
 * Guarda el volcado como la copia de hoy. `kept: "previous"` = no se guardó porque venía vacío y hay un respaldo con
 * datos (`restore` dice cuál); `unchanged` = igual a la copia de hoy.
 */
export function saveForgeBackup(memory: Mem, dump: ForgeDump, now = new Date()): Promise<SaveResult> {
  const run = (chains.get(memory) ?? Promise.resolve()).then(() => save(memory, dump, now), () => save(memory, dump, now));
  chains.set(memory, run.catch(() => {}));
  return run;
}

async function save(memory: Mem, dump: ForgeDump, now: Date): Promise<SaveResult> {
  const hash = forgeHashOf(dump);
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
export async function listForgeBackups(memory: Mem): Promise<Array<Omit<ForgeBackupCopy, "hash">>> {
  return (await readIndex(memory)).map(({ hash: _h, ...c }) => c);
}

/** El contenido de una copia (por día; sin día, la más nueva). */
export async function pullForgeBackup(memory: Mem, day?: string): Promise<ForgeDump | null> {
  const copies = await readIndex(memory);
  const pick = day ? copies.find((c) => c.day === day) : copies[0];
  if (!pick) return null;
  const d = await memory.get(copyKey(pick.day)).catch(() => null);
  return d && typeof d === "object" && d.keys ? (d as ForgeDump) : null;
}
