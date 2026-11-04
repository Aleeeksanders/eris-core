// ============================================================
// El núcleo del Sueño del servidor (src/services/SleepCore.ts) es COPIA EXACTA del de la app. Revisa el archivo y que los dos
// den lo mismo con un día partido (el 24-10 del usuario, según Mi Fitness) y uno normal.
//   bun scripts/sleep_parity_test.ts    (sale con 1 si algo difiere)
// ============================================================

import { readFileSync } from "fs";
import { APP_SLEEP_CORE, SRV_SLEEP_CORE } from "./sync_sleep_core.ts";

const app = await import(APP_SLEEP_CORE);
const srv = await import(SRV_SLEEP_CORE);
let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };

check(readFileSync(SRV_SLEEP_CORE, "utf-8") === readFileSync(APP_SLEEP_CORE, "utf-8"), "SleepCore.ts: el del servidor es copia del de la app");

const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();
const seq = (start: number, parts: Array<[number, number]>) => {
  const out: Array<{ start: number; end: number; stage: number }> = [];
  let t = start;
  for (const [stage, min] of parts) { out.push({ start: t, end: t + min * 60_000, stage }); t += min * 60_000; }
  return out;
};
const partido = [
  { start: at(23, 2, 10), end: at(23, 8, 0) },
  { start: at(24, 2, 33), end: at(24, 3, 18) },
  { start: at(24, 4, 20), end: at(24, 9, 5), stages: seq(at(24, 4, 20), [[4, 60], [5, 50], [4, 50], [1, 1], [6, 15], [5, 35], [4, 58], [6, 16]]) },
  { start: at(24, 13, 51), end: at(24, 17, 54), stages: seq(at(24, 13, 51), [[4, 40], [5, 45], [6, 20], [4, 44], [1, 1], [5, 32], [6, 21], [4, 40]]) },
];
const normal = [{ start: at(25, 0, 5), end: at(25, 7, 40) }, { start: at(25, 15, 0), end: at(25, 15, 20) }];
const opts = { usualWake: 7.75, usualSleepH: 7.25 };

for (const [name, ses] of [["partido (24-10)", partido], ["normal con siesta", normal]] as const) {
  const a = app.sleepDay(ses, opts), b = srv.sleepDay(ses, opts);
  check(JSON.stringify(a) === JSON.stringify(b), `${name}: mismas partes, totales y despertar del día`);
  check(app.sleepSummaryText(a) === srv.sleepSummaryText(b), `${name}: misma frase («${app.sleepSummaryText(a).slice(0, 60)}…»)`);
  check(app.sleepReading(a, 7.25) === srv.sleepReading(b, 7.25), `${name}: misma lectura`);
}
check(JSON.stringify([...app.sleepByDay(partido, opts)]) === JSON.stringify([...srv.sleepByDay(partido, opts)]), "historial por día igual");
// S1: las 2 semanas (deuda, regularidad, cronotipo, puntaje, hora para acostarse) y sus frases
const semana = [...Array.from({ length: 12 }, (_, i) => ({ start: at(10 + i, 0, 30), end: at(10 + i, 7, 45) })), ...partido.slice(1)];
const io = { ...opts, now: at(24, 20, 30) };
const ia = app.sleepInsights(semana, io), ib = srv.sleepInsights(semana, io);
check(JSON.stringify(ia) === JSON.stringify(ib), `2 semanas: mismos números (deuda ${ia.debtH} h, ${ia.regularity}, puntaje ${ia.score?.total})`);
check(app.insightsText(ia) === srv.insightsText(ib) && app.bedtimeText(ia) === srv.bedtimeText(ib), "2 semanas: mismas frases");
// S2: lo de la pantalla de Sueño (día cualquiera, hipnograma, correcciones, la acción y el plan)
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
check(same(app.sleepDayOn(semana, "2026-10-15", opts), srv.sleepDayOn(semana, "2026-10-15", opts)), "un día cualquiera igual");
check(same(app.hypnogram(partido, at(24, 2, 33), at(24, 9, 5)), srv.hypnogram(partido, at(24, 2, 33), at(24, 9, 5))), "hipnograma igual");
const edits = { excluded: [{ start: at(24, 13, 51), end: at(24, 17, 54) }], manual: [{ start: at(22, 23, 30), end: at(23, 7, 0) }] };
check(same(app.applySleepEdits(semana, edits), srv.applySleepEdits(semana, edits)), "correcciones iguales");
check(app.sleepAction(ia) === srv.sleepAction(ib), `misma acción («${app.sleepAction(ia).slice(0, 50)}…»)`);
const pa = app.suggestPlan(ia, "2026-10-24"), pb = srv.suggestPlan(ib, "2026-10-24");
check(same(pa, pb), `mismo plan (${pa?.kind ?? "ninguno"})`);
// S3: el sueño en el resto del día (entrenar, la recomendación, el entreno tarde y el café tarde)
const last = app.lastSleepFrom({ durationHours: 9.52, nightHours: 5.48, split: true, episodes: [{ kind: "noche" }, { kind: "segundo" }] });
check(same(last, srv.lastSleepFrom({ durationHours: 9.52, nightHours: 5.48, split: true, episodes: [{ kind: "noche" }, { kind: "segundo" }] })), "lo de anoche igual");
check(same(app.sleepReadiness(ia, last), srv.sleepReadiness(ib, last)), `misma disposición para entrenar (${app.sleepReadiness(ia, last)?.level})`);
check(same(app.sleepDayTip(ia, { totalH: 5.2 }, { diabetic: true }), srv.sleepDayTip(ib, { totalH: 5.2 }, { diabetic: true })), "misma recomendación del día");
check(app.trainingTimeNote(23, ia) === srv.trainingTimeNote(23, ib), "mismo aviso de entreno tarde");
const cafes = [{ name: "Café con leche", at: at(24, 21, 0) }, { name: "Descafeinado", at: at(24, 22, 0) }];
check(same(app.lateCaffeine(cafes, ia), srv.lateCaffeine(cafes, ib)), "mismo aviso de café tarde");
// S4: lo que se repite en las noches y su frase (el teléfono lo calcula, el servidor lo dice)
const ev = { caffeine: [at(21, 20, 0), at(23, 20, 0)], alcohol: [], meals: [at(21, 13, 0), at(22, 13, 0), at(23, 13, 0)], training: [], logged: [at(21, 13, 0), at(22, 13, 0), at(23, 13, 0)] };
const pp = app.sleepPatterns(semana, ev, { ...opts, now: at(24, 20, 30) });
check(same(pp, srv.sleepPatterns(semana, ev, { ...opts, now: at(24, 20, 30) })), `mismos patrones (${pp.nights} noches)`);
check(app.patternsText(pp, ia) === srv.patternsText(pp, ib) && app.isAlcohol("Piscola") === srv.isAlcohol("Piscola"), "misma respuesta a «¿por qué duermo mal?»");
if (pa) check(same(app.planProgress(pa.plan, app.nightRecords(semana, opts), at(28, 12, 0)), srv.planProgress(pb.plan, srv.nightRecords(semana, opts), at(28, 12, 0))), "mismo avance del plan");
// ⚡ Modo Rendimiento: la curva de alerta estimada
const ca = app.alertCurve(ia, { totalH: 4.5 }, 7.25, { naps: [{ start: 15, end: 15.33 }] });
check(same(ca, srv.alertCurve(ib, { totalH: 4.5 }, 7.25, { naps: [{ start: 15, end: 15.33 }] })) && app.alertCurveText(ca) === srv.alertCurveText(ca), `misma curva de alerta (${app.alertCurveText(ca)})`);

console.log(fails ? `\n${fails} diferencia(s)` : "\nNúcleo del Sueño: app = servidor ✓");
process.exit(fails ? 1 : 0);
