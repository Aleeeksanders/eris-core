// ============================================================
// Muestra la FORMA (nombres de campos y tipos) de los datos que usaría el informe del mes, sin imprimir valores.
// Solo lectura: abre el perfil con la llave del servidor sin pasar por load() (load crea archivos y migra).
//
//   bun scripts/informe/forma_datos.ts <perfil>
// ============================================================
import { readFile } from "fs/promises";
import { join } from "path";
import * as os from "os";
import { FileSystemAdapter } from "../../src/memory.js";
import { AccountStore } from "../../src/services/security/AccountStore.js";

const id = process.argv[2];
if (!id) { console.error("falta el perfil"); process.exit(1); }

async function abrir(profileId: string): Promise<FileSystemAdapter | null> {
  const keyFile = join(os.homedir(), ".eris", "profiles", profileId, "key.json");
  let km: any;
  try { km = JSON.parse(await readFile(keyFile, "utf-8")); } catch { return null; }
  const a = new FileSystemAdapter(profileId);
  return (a as any).crypto.unlock(await new AccountStore().derivePin(profileId), km) ? a : null;
}

/** La forma de un valor: tipos y claves, nunca el contenido. */
function forma(v: any, prof = 0): any {
  if (v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return v.length ? [`${v.length} elementos`, forma(v[0], prof + 1)] : "[]";
  if (typeof v === "object") {
    if (prof > 3) return "{…}";
    const o: any = {};
    for (const [k, x] of Object.entries(v)) o[k] = forma(x, prof + 1);
    return o;
  }
  return typeof v;
}

const a = await abrir(id);
if (!a) { console.error("no se pudo abrir con la llave del servidor"); process.exit(1); }
const perfil = await a.getProfile();
console.log("perfil.medical:", JSON.stringify(forma((perfil as any)?.medical), null, 1));
for (const k of ["daily_rollup_log", "sleep_log", "supplements_state", "mind_checkins", "body_profile", "health_snapshot_latest"]) {
  const v = await a.get(k);
  console.log(`\n${k}:`, JSON.stringify(forma(v), null, 1).slice(0, 2500));
}
