// ============================================================
// Prepara el HOME aislado del banco de pruebas del chat (scripts/chat_eval/chat_eval.ts).
//  - Cuentas de prueba «ikaros» (Alex) y «ana», y sus sesiones en <HOME>/tokens.json (si no existen).
//  - Día limpio para «ikaros»: borra lo anotado HOY (comida, agua, sueño) para que cada corrida parta igual. Antes las
//    corridas se acumulaban y Eris respondía con «9.603 kcal» y «9 litros de agua» del mismo día de prueba.
// Correrlo con el servidor DETENIDO (guarda en memoria lo que lee). Nunca toca los datos reales: exige un HOME con «erishome».
// ============================================================
import * as os from "os";
import { join } from "path";
import { writeFile, mkdir, rm, access } from "fs/promises";
import { AccountStore } from "../../src/services/security/AccountStore.ts";

const home = os.homedir();
if (!/erishome/i.test(home)) { console.log("Usa un HOME aislado: USERPROFILE/HOME con «erishome» en la ruta"); process.exit(2); }

const tokensPath = join(home, "tokens.json");
if (!(await access(tokensPath).then(() => true, () => false))) {
  const store = new AccountStore(join(home, ".eris"));
  await mkdir(join(home, ".eris"), { recursive: true });
  await store.bind("sub-ikaros", "ikaros", "ikaros@test.local", "Alex");
  await store.bind("sub-ana", "ana", "ana@test.local", "Ana");
  const tokens = { ikaros: await store.createSession("sub-ikaros", "ikaros"), ana: await store.createSession("sub-ana", "ana") };
  await writeFile(tokensPath, JSON.stringify(tokens));
  console.log("cuentas de prueba creadas: ikaros, ana");
}

// Las claves del día usan Date.toDateString() («Fri Oct 16 2026»), como memory.set(`nutrition_log_${…}`)
const day = new Date().toDateString();
const dir = join(home, ".eris", "profiles", "ikaros");
// + el último snapshot del teléfono: su `nutrition` de otra corrida quedaba pegado (1.808 kcal «de hoy» con 713 anotadas)
const borrar = [`kv_nutrition_log_${day}.json`, `kv_hydration_log_${day}.json`, `kv_nutrition_deleted_${day}.json`, "kv_sleep_log.json", "kv_sleep_pending.json", "kv_health_snapshot_latest.json", "kv_antojo_pending.json", "kv_antojo_trato.json", "kv_plato_perfil.json"];
for (const f of borrar) await rm(join(dir, f), { force: true });
console.log(`día limpio para ikaros (${day})`);
