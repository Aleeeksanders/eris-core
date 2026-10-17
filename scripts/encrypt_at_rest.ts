// ============================================================
// Cifrar en reposo, de una vez, el perfil y los kv_* de todos los perfiles (y sus respaldos).
//
// El backend ya lo hace solo cuando alguien entra (FileSystemAdapter.load → encryptAtRest); este script es para no
// esperar a que cada persona vuelva a entrar y para los respaldos, que nadie abre.
//
//   bun scripts/encrypt_at_rest.ts                                   → solo muestra qué haría (no escribe nada)
//   bun scripts/encrypt_at_rest.ts --aplicar                         → cifra (con el backend DETENIDO)
//   bun scripts/encrypt_at_rest.ts --aplicar --sueltos=<perfil>      → además, los kv_* sueltos en ~/.eris/backups/
//                                                                       son de ese perfil y se cifran con su llave
//
// Solo abre perfiles con la llave del servidor (cuentas de Google, AccountStore.derivePin). Un perfil con PIN propio
// queda como está y se cifra solo la próxima vez que esa persona entre. Nunca imprime contenido, solo cuántos archivos.
// Cada archivo cifrado se vuelve a abrir con un adaptador nuevo y se compara con el original; si no calza, se restaura.
// ============================================================

import { readdir, readFile, writeFile, stat } from "fs/promises";
import { join } from "path";
import * as os from "os";
import { FileSystemAdapter, ENC_PREFIX } from "../src/memory.js";
import { AccountStore } from "../src/services/security/AccountStore.js";

const ERIS = join(os.homedir(), ".eris");
const PROFILES = join(ERIS, "profiles");
const BACKUPS = join(ERIS, "backups");
const apply = process.argv.includes("--aplicar");
const looseOwner = process.argv.find((a) => a.startsWith("--sueltos="))?.split("=")[1];
const store = new AccountStore();

const isTarget = (n: string) => n === "profile.json" || (n.startsWith("kv_") && n.endsWith(".json"));

async function backendRunning(): Promise<boolean> {
  try { await fetch("http://127.0.0.1:3000/", { signal: AbortSignal.timeout(1500) }); return true; } catch (e: any) {
    return e?.name === "TimeoutError"; // conexión rechazada = apagado; si no contesta a tiempo, mejor asumir que está
  }
}

/** Adaptador con la llave del perfil, sin pasar por load() (load crea key.json si falta y migra conversaciones). */
async function unlocked(profileId: string, keyFile: string): Promise<FileSystemAdapter | null> {
  let km: any;
  try { km = JSON.parse(await readFile(keyFile, "utf-8")); } catch { return null; }
  const a = new FileSystemAdapter(profileId);
  return (a as any).crypto.unlock(await store.derivePin(profileId), km) ? a : null;
}

async function plainFiles(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const n of await readdir(dir).catch(() => [] as string[])) {
    if (!isTarget(n)) continue;
    const f = join(dir, n);
    if (!(await stat(f)).isFile()) continue;
    const raw = await readFile(f, "utf-8");
    if (!raw.startsWith(ENC_PREFIX)) out.set(n, raw);
  }
  return out;
}

const totals = { cifrados: 0, sinTocar: 0, restaurados: 0, perfilesSinLlave: [] as string[] };

async function run(label: string, profileId: string, dir: string, keyFile: string, fallbackKeyFile?: string) {
  const plain = await plainFiles(dir);
  if (plain.size === 0) { console.log(`  ${label}: nada en texto plano`); return; }
  let a = await unlocked(profileId, keyFile);
  if (!a && fallbackKeyFile) a = await unlocked(profileId, fallbackKeyFile);
  if (!a) { console.log(`  ${label}: ${plain.size} en texto plano, NO se abre con la llave del servidor (se cifra cuando entre)`); totals.perfilesSinLlave.push(label); return; }
  if (!apply) { console.log(`  ${label}: cifraría ${plain.size} archivo(s)`); return; }

  const res = await a.encryptAtRest(dir);
  // Verificación independiente: otro adaptador con la misma llave abre cada archivo y lo compara con el original
  const check = await unlocked(profileId, keyFile) ?? (fallbackKeyFile ? await unlocked(profileId, fallbackKeyFile) : null);
  let restored = 0;
  for (const [n, original] of plain) {
    const f = join(dir, n);
    const now = await readFile(f, "utf-8");
    if (!now.startsWith(ENC_PREFIX)) continue; // quedó sin tocar (dañado o falló): sigue como estaba
    let same = false;
    try { same = JSON.stringify(JSON.parse((check as any).openFile(now))) === JSON.stringify(JSON.parse(original)); } catch {}
    if (!same) { await writeFile(f, original, "utf-8"); restored++; }
  }
  totals.cifrados += res.migrated - restored;
  totals.sinTocar += res.skipped.length;
  totals.restaurados += restored;
  console.log(`  ${label}: ${res.migrated - restored} cifrado(s)` +
    (res.skipped.length ? `, ${res.skipped.length} sin tocar (${res.skipped.map((s) => s.split(":")[0]).join(", ")})` : "") +
    (restored ? `, ${restored} RESTAURADO(S) al original porque no calzaban` : ""));
}

if (apply && (await backendRunning())) {
  console.error("El backend está corriendo (puerto 3000). Detenlo antes: podría escribir un archivo mientras se cifra.");
  process.exit(2);
}
console.log(apply ? "Cifrando en reposo…" : "Simulación (no escribe nada; usa --aplicar para cifrar):");

console.log("Perfiles:");
for (const id of (await readdir(PROFILES).catch(() => [] as string[])).sort()) {
  const dir = join(PROFILES, id);
  if (!(await stat(dir)).isDirectory()) continue;
  await run(id, id, dir, join(dir, "key.json"));
}

console.log("Respaldos:");
for (const name of (await readdir(BACKUPS).catch(() => [] as string[])).sort()) {
  const dir = join(BACKUPS, name);
  if (!(await stat(dir)).isDirectory()) continue;
  const id = name.replace(/-\d{8}-\d{6}$/, "");
  await run(name, id, dir, join(dir, "key.json"), join(PROFILES, id, "key.json"));
}
const loose = await plainFiles(BACKUPS);
if (loose.size) {
  if (looseOwner) await run(`sueltos en backups (de ${looseOwner})`, looseOwner, BACKUPS, join(PROFILES, looseOwner, "key.json"));
  else console.log(`  sueltos en backups: ${loose.size} en texto plano; indica de quién son con --sueltos=<perfil>`);
}

console.log(`\nListo: ${totals.cifrados} cifrado(s), ${totals.sinTocar} sin tocar, ${totals.restaurados} restaurado(s).` +
  (totals.perfilesSinLlave.length ? ` Sin la llave del servidor: ${totals.perfilesSinLlave.join(", ")}.` : ""));
if (totals.restaurados) process.exit(1);
