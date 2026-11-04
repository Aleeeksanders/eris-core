// Forge (toji.html) y el servidor (DailyTargets) dan la MISMA meta con la regla nueva: el nivel ya trae el ejercicio típico.
import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { computeTargets } from "C:/Proyectos/eris/src/services/DailyTargets.ts";

const html = readFileSync("C:/Proyectos/eris-mobile/assets/toji.html", "utf8");
const grab = (start: string, end: string) => { const a = html.indexOf(start); const b = html.indexOf(end, a); if (a < 0 || b < 0) throw new Error(start); return html.slice(a, b); };
const code = [
  grab("const todayKey = () => {", "const prevKey"),
  grab("const bmrOf = s => {", "// Objetivos (CUERPO"),
  grab("const tdeeOf = s => {", "const TREE_WEIGHT"),
].join("\n");
const win: any = {};
const F = new Function("window", `${code}; return { bmrOf, tdeeOf, typicalExerciseOf, watchToday, activitySuggestion, hydrationOf, todayKey, effActivity, isAutoLevel };`)(win);

const today = F.todayKey();
const st = (over: any = {}) => ({ bodyKg: 85, heightCm: 179, age: 27, sex: "h", activity: 1.375, training: {}, today: {}, ...over });
const body = (s: any, trainingKcal = 0, sets = 0) => ({ weightKg: s.bodyKg, heightCm: s.heightCm, age: s.age, sex: s.sex, activity: F.effActivity(s), activityAuto: F.isAutoLevel(s), date: today, trainingKcal, trainingSets: sets });
const forgeTotal = (s: any, forgeKcal: number) => {
  const w = F.watchToday(s);
  const ex = Math.max(forgeKcal, w ? w.kcal : 0);
  return F.tdeeOf(s) + Math.max(0, ex - F.typicalExerciseOf(s));
};

test("misma meta en Forge y en el servidor (reloj, Forge y ambos)", () => {
  const watch = { day: today, kcal: 1200, minutes: 120, vigorousMin: 120, label: "básquet 2 h" };
  for (const [s, fk] of [[st(), 0], [st({ today: { watch } }), 0], [st({ today: { watch } }), 400], [st({ activity: 1.55 }), 300], [st({ activity: 1.2 }), 300]] as const) {
    const act = (s as any).today.watch ? { day: today, minutes: 120, vigorousMin: 120, kcal: 1200, bouts: [] } : null;
    const server = computeTargets({ body: body(s, fk as number), today, activity: act });
    expect(forgeTotal(s, fk as number)).toBe(server.kcal);
    const hyd = F.hydrationOf(s, 0, F.watchToday(s));
    console.log((s as any).activity, fk, !!act, "forge", hyd.total, hyd.base, hyd.train, "server", server.waterL, server.sources.water);
    expect(Number((hyd.total / 1000).toFixed(1))).toBe(server.waterL!); // lo que muestra Forge
  }
});

test("la sugerencia de nivel: con 2+ semanas de datos y ~4 días/sem → Moderado", () => {
  const training: Record<string, any> = {};
  const d = new Date();
  for (let k = 1; k <= 28; k++) { const x = new Date(d); x.setDate(d.getDate() - k); const key = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; if (k % 7 < 4) training[key] = { sentadilla: 4 }; }
  const sug = F.activitySuggestion(st({ training }));
  console.log(sug);
  expect(sug?.label).toBe("Moderado");
  expect(F.activitySuggestion(st({ training, activity: 1.55 }))).toBeNull(); // ya calza
  expect(F.activitySuggestion(st({ training: { [today]: { sentadilla: 4 } } }))).toBeNull(); // menos de 2 semanas de datos
});

test("con el nivel automático también dan lo mismo (y elegir a mano lo apaga)", () => {
  const autoLevel = { factor: 1.48, label: "Moderado", perWeek: 2, days: 28 };
  const watch = { day: today, kcal: 1200, minutes: 120, vigorousMin: 120, label: "básquet 2 h" };
  for (const s of [st({ autoLevel }), st({ autoLevel, today: { watch } }), st({ autoLevel, activityMode: "manual" })]) {
    const act = (s as any).today.watch ? { day: today, minutes: 120, vigorousMin: 120, kcal: 1200, bouts: [] } : null;
    const server = computeTargets({ body: body(s), today, activity: act, autoLevel });
    expect(forgeTotal(s, 0)).toBe(server.kcal);
    expect(Number((F.hydrationOf(s, 0, F.watchToday(s)).total / 1000).toFixed(1))).toBe(server.waterL!);
  }
  expect(F.effActivity(st({ autoLevel }))).toBe(1.48);
  expect(F.effActivity(st({ autoLevel, activityMode: "manual" }))).toBe(1.375);
  expect(F.activitySuggestion(st({ autoLevel }))).toBeNull(); // el automático ya sigue lo real
});
