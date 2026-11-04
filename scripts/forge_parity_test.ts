// ============================================================
// El núcleo de Forge del servidor (src/services/forge/) es COPIA EXACTA del de la app. Revisa los archivos y que los dos
// den lo mismo con un estado de prueba (series con mancuernas, máquina en libras, asistida, lastre; RPG y cuerpo).
//   bun scripts/forge_parity_test.ts    (sale con 1 si algo difiere)
// La paridad con el HTML anterior (toji.html) se prueba aparte: las funciones del HTML contra forgeLegacy (2026-10-17).
// ============================================================

import { readFileSync } from "fs";
import { join } from "path";
import { FORGE_FILES, APP_FORGE_DIR, SRV_FORGE_DIR } from "./sync_forge_core.ts";

const app = { ...(await import(join(APP_FORGE_DIR, "forgeCore.ts"))), T: await import(join(APP_FORGE_DIR, "forgeTrain.ts")), S: await import(join(APP_FORGE_DIR, "forgeStrength.ts")), P: await import(join(APP_FORGE_DIR, "forgeProgress.ts")) };
const srv = { ...(await import(join(SRV_FORGE_DIR, "forgeCore.ts"))), T: await import(join(SRV_FORGE_DIR, "forgeTrain.ts")), S: await import(join(SRV_FORGE_DIR, "forgeStrength.ts")), P: await import(join(SRV_FORGE_DIR, "forgeProgress.ts")) };
let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };

for (const f of FORGE_FILES) check(readFileSync(join(SRV_FORGE_DIR, f), "utf-8") === readFileSync(join(APP_FORGE_DIR, f), "utf-8"), `${f}: el del servidor es copia del de la app`);

const run = (C: any) => {
  let s = C.newState();
  s.bodyKg = 82; s.heightCm = 178; s.age = 30; s.sex = "h";
  const tk = C.L.todayKey();
  s = C.logSet(s, tk, "press_mil", { reps: 10, kg: 7, rir: 2, at: 1 });
  s = C.logSet(s, tk, "jalon", { reps: 10, kg: 100, unit: "lb", rir: 2, at: 2 });
  s = C.logSet(s, tk, "dom_asist", { reps: 8, assist: 25, rir: 1, at: 3 });
  s = C.logSet(s, tk, "dom_prona", { reps: 5, kg: 10, rir: 1, at: 4 });
  s = C.logSet(s, tk, "prensa", { reps: 12, kg: 120, rir: 2, at: 5 });
  s = C.togglePlan(s, "prensa");
  return {
    summary: C.rpgSummary(s), groups: C.groupLevels(s), combat: C.combatStats(s), body: C.T.bodySync(s), catalog: C.BASE_EXERCISES.length,
    energy: C.T.dayEnergy(s, tk), plan: C.T.planProjection(s), strength: C.S.liftRatings(s), weekly: C.S.weeklySets(s), auto: C.S.applyAutoSkills(s).checked,
    progress: C.P.progressContext(s), records: C.P.records(s),
  };
};
check(JSON.stringify(run(app)) === JSON.stringify(run(srv)), "mismo RPG, músculos, Arena, cuerpo, gasto, fuerza, árbol y progreso con las mismas series");

if (fails) { console.error(`\n${fails} diferencia(s)`); process.exit(1); }
console.log("\nNúcleo de Forge: app = servidor ✓");
