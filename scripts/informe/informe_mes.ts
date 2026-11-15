// ============================================================
// El informe del mes para el control médico de un perfil, en texto. SOLO LECTURA: abre el perfil con la llave del
// servidor sin pasar por load() (que crea archivos y migra) y no escribe nada.
//
//   bun scripts/informe/informe_mes.ts <perfil>                → el mes en curso (hasta ayer)
//   bun scripts/informe/informe_mes.ts <perfil> --mes 2026-10  → un mes
//   bun scripts/informe/informe_mes.ts <perfil> --dias 30      → los últimos 30 días
//   bun scripts/informe/informe_mes.ts <perfil> --json         → el informe como datos
// ============================================================
import { readFile } from "fs/promises";
import { join } from "path";
import * as os from "os";
import { FileSystemAdapter, localDateKey } from "../../src/memory.js";
import { AccountStore } from "../../src/services/security/AccountStore.js";
import { loadTargets } from "../../src/services/DailyTargets.js";
import { armarInformeMes, informeEnTexto } from "../../src/services/MonthlyReport.js";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--") && !/^\d/.test(a));
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
if (!id) { console.error("uso: bun scripts/informe/informe_mes.ts <perfil> [--mes AAAA-MM | --dias N] [--json]"); process.exit(1); }

async function abrir(profileId: string): Promise<FileSystemAdapter | null> {
  const keyFile = join(os.homedir(), ".eris", "profiles", profileId, "key.json");
  let km: any;
  try { km = JSON.parse(await readFile(keyFile, "utf-8")); } catch { return null; }
  const a = new FileSystemAdapter(profileId);
  return (a as any).crypto.unlock(await new AccountStore().derivePin(profileId), km) ? a : null;
}

const a = await abrir(id);
if (!a) { console.error("no se pudo abrir el perfil con la llave del servidor"); process.exit(1); }
const safe = async (k: string) => { try { return await a.get(k); } catch { return null; } };
const [perfil, rollup, sup, checkins, body, t] = await Promise.all([
  a.getProfile(), safe("daily_rollup_log"), safe("supplements_state"), safe("mind_checkins"), safe("body_profile"), loadTargets(a),
]);
const hoy = localDateKey();
const dias = Number(opt("--dias"));
const rango = dias > 0 ? (() => { const d = new Date(); d.setDate(d.getDate() - dias); return { desde: localDateKey(d.getTime()), hasta: hoy }; })() : {};
const inf = armarInformeMes({
  hoy, mes: opt("--mes"), ...rango,
  rollup: Array.isArray(rollup) ? rollup : [],
  medical: (perfil as any)?.medical ?? null,
  metas: { kcal: t.kcal, proteinG: t.proteinG, proteinIsCap: t.proteinIsCap, waterL: t.waterL, waterOff: t.waterL == null },
  suplementos: sup?.state ?? null,
  checkins: Array.isArray(checkins) ? checkins : [],
  pesoKg: body?.weightKg ?? t.weightKg ?? null,
});
if (!inf) { console.log("No hay período para ese informe (¿un mes que no ha empezado?)."); process.exit(0); }
console.log(args.includes("--json") ? JSON.stringify(inf, null, 1) : informeEnTexto(inf, (perfil as any)?.displayName));
