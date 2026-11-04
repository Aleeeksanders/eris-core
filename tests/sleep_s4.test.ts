// Sueño 2.0 · S4: «¿por qué duermo mal?» (lo que se repite en 30 días, como asociación) y los avisos de sueño.
import { test, expect } from "bun:test";
process.env.TZ = "America/Santiago";
import { sleepPatterns, patternsText, isAlcohol, sleepInsights, type RawSession, type HabitEvents } from "C:/Proyectos/eris-mobile/src/services/sleep/sleepCore.ts";
import { planReminders, dayKey, DEFAULT_REMINDER_SETTINGS, type PlanInput } from "C:/Proyectos/eris-mobile/src/services/reminderRules.ts";

const H = 3_600_000;
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const noche = (d: number, h: number, m: number, horas: number): RawSession => { const s = at(d, h, m); return { start: s, end: s + horas * H }; };

// 30 noches (30-09 → 28-10, día del mes de octubre). Los días pares: café a las 20:00 y la noche siguiente 1 h más corta
// (se duerme a la 01:30 en vez de 00:30, despierta igual). Todos los días se anota comida (almuerzo 13:30).
function mes(opts: { cafe?: boolean; alcohol?: boolean } = {}) {
  const sessions: RawSession[] = [];
  const ev: HabitEvents = { caffeine: [], alcohol: [], meals: [], training: [], logged: [] };
  for (let d = 1; d <= 28; d++) {
    const par = d % 2 === 0;
    ev.logged.push(at(d - 1, 13, 30)); ev.meals.push(at(d - 1, 13, 30));
    if (opts.cafe && par) { ev.caffeine.push(at(d - 1, 20)); ev.logged.push(at(d - 1, 20)); }
    if (opts.alcohol && par) { ev.alcohol.push(at(d - 1, 22)); ev.logged.push(at(d - 1, 22)); }
    sessions.push(par && opts.cafe ? noche(d, 1, 30, 6.25) : noche(d, 0, 30, 7.25));
  }
  return { sessions, ev };
}

test("café tarde: las noches con café a < 6 h, ~1 h menos y más tarde; asociación, no causa, y UNA cosa para probar", () => {
  const { sessions, ev } = mes({ cafe: true });
  const p = sleepPatterns(sessions, ev, { now: at(28, 20), usualWake: 7.75 });
  expect(p.nights).toBeGreaterThanOrEqual(25);
  expect(p.found[0].key).toBe("cafe");
  expect(p.found[0].nightDiffMin).toBe(-60);
  expect(p.found[0].onsetDiffMin).toBe(60);
  expect(p.found[0].text).toMatch(/^Las 14 noches con café \(o algo con cafeína\) a menos de 6 h de dormirte, dormiste ~1 h menos y te dormiste ~1 h más tarde que las otras 1[34]\.$/);
  const ins = sleepInsights(sessions, { now: at(28, 20), usualWake: 7.75 });
  const t = patternsText(p, ins);
  expect(t).toMatch(/no prueba que sea la causa/);
  expect(t).toMatch(/deja la cafeína hasta las \d\d:\d\d por 2 semanas/);
  expect(t).not.toMatch(/insomnio/); // no despierta en la noche: sin la línea del médico
});

test("sin nada que se repita: lo dice y no inventa", () => {
  const { sessions, ev } = mes();
  const p = sleepPatterns(sessions, ev, { now: at(28, 20), usualWake: 7.75 });
  expect(p.found).toEqual([]);
  const t = patternsText(p, sleepInsights(sessions, { now: at(28, 20), usualWake: 7.75 }));
  expect(t).toMatch(/no veo que el café, el alcohol, comer o entrenar tarde, ni las siestas cambien tu sueño/);
  expect(t).not.toMatch(/causa/);
});

test("alcohol sin efecto en las horas no se reporta (el umbral protege de ruido)", () => {
  const { sessions, ev } = mes({ alcohol: true });
  expect(sleepPatterns(sessions, ev, { now: at(28, 20) }).found.some((f) => f.key === "alcohol")).toBe(false);
  expect(isAlcohol("Cerveza Kunstmann")).toBe(true);
  expect(isAlcohol("Cerveza sin alcohol")).toBe(false);
  expect(isAlcohol("Vinagre")).toBe(false);
});

test("pocas noches: lo dice; despertarse casi siempre: sugiere el médico (terapia sin remedios), sin diagnosticar", () => {
  expect(patternsText(null, null)).toMatch(/pocas noches/);
  const ses: RawSession[] = [];
  for (let d = 1; d <= 20; d++) { ses.push(noche(d, 0, 30, 3)); ses.push({ start: at(d, 4, 30), end: at(d, 8) }); } // 1 h despierto en medio
  const p = sleepPatterns(ses, { caffeine: [], alcohol: [], meals: [], training: [], logged: [] }, { now: at(20, 20), usualWake: 8 });
  expect(p.frequentWake).toBe(true);
  const t = patternsText(p, null);
  expect(t).toMatch(/terapia cognitivo-conductual para el insomnio/);
  expect(t).not.toMatch(/tienes insomnio|apnea|melatonina/i);
});

test("chat: el sueño por partes sin «horas» en la segunda cifra, y «qué me quita el sueño» no borra nada", async () => {
  const { parseSleepStatement } = await import("C:/Proyectos/eris/src/services/SleepParse.ts");
  expect(parseSleepStatement("Anoche dormí 4 horas y en la tarde una siesta de 2")).toEqual({ hours: 2, base: 4, day: "hoy", extra: true });
  expect(parseSleepStatement("dormí 4 horas y después 3 más")).toEqual({ hours: 3, base: 4, day: "hoy", extra: true });
  expect(parseSleepStatement("dormí 6 horas y una siesta de 20 minutos")).toEqual({ hours: 0.33, base: 6, day: "hoy", extra: true });
  expect(parseSleepStatement("dormí más de 7 horas")).toEqual({ hours: 7, day: "hoy" });
  expect(parseSleepStatement("dormí 7 horas")).toEqual({ hours: 7, day: "hoy" });
  const { SleepLogTool } = await import("C:/Proyectos/eris/src/tools/SleepLogTool.ts");
  const t = new SleepLogTool() as any;
  expect(await t.preroute("¿Qué me está quitando el sueño?", {})).toEqual({ action: "why" });
  expect(await t.preroute("¿Por qué duermo tan mal?", {})).toEqual({ action: "why" });
  expect(await t.preroute("Borra el sueño que anoté", {})).toEqual({ action: "delete", day: "hoy" });
  expect(await t.preroute("Dormí mal, ¿igual entreno?", {})).toBeNull();
});

// ─── Avisos ───────────────────────────────────────────────────────────────────
const NOW = new Date(2026, 9, 29, 9, 0);
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  now: NOW, name: "Alex", settings: { ...DEFAULT_REMINDER_SETTINGS }, modules: { nutri: true, forge: true, finanzas: true },
  mealHistory: [], todayMeals: [], kcalToday: 0, proteinToday: 0, kcalGoal: 2000, proteinGoal: 100, proteinIsCap: false,
  waterToday: 0, waterGoal: 3, trainingDays: {}, forgeStreak: null, finance: null, ...over,
});
const sl = { bedFrom: 23.75, bedTo: 24.75, caffeineUntil: 18.25, drifting: false, debtH: 0, plan: null, coffeeAfternoon: true };
const of = (r: ReturnType<typeof planReminders>, day: string) => r.filter((x) => x.kind === "sleep" && dayKey(new Date(x.at.getTime() - (x.at.getHours() < 12 ? 12 * H : 0))) === day);
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

test("último café: 30 min antes de la hora límite, solo a quien toma café de tarde", () => {
  const r = of(planReminders(base({ sleep: sl })), "2026-10-29");
  expect(r.map((x) => [hm(x.at), x.title])).toEqual([["17:45", "Último café ☕"]]);
  expect(r[0].body).toBe("Hasta las 18:15 puedes tomar café; después, mejor sin cafeína para dormir bien.");
  expect(of(planReminders(base({ sleep: { ...sl, coffeeAfternoon: false } })), "2026-10-29")).toEqual([]);
  // ya tomó café tarde hoy: hoy no se insiste; mañana sí
  const r2 = planReminders(base({ sleep: { ...sl, lateCaffeineToday: true } }));
  expect(of(r2, "2026-10-29")).toEqual([]);
  expect(of(r2, "2026-10-30").length).toBe(1);
});

test("a acostarse: 45 min antes de su ventana (aunque pase de las 22:30), solo si el horario se corre, hay deuda o un plan", () => {
  expect(of(planReminders(base({ sleep: { ...sl, coffeeAfternoon: false } })), "2026-10-29")).toEqual([]);   // duerme bien: nada
  const r = of(planReminders(base({ sleep: { ...sl, coffeeAfternoon: false, drifting: true } })), "2026-10-29");
  expect(r.map((x) => hm(x.at))).toEqual(["23:00"]);
  expect(r[0].body).toBe("Tu hora: entre las 23:45 y las 00:45. Luz baja y menos pantalla desde ahora.");
  const conPlan = of(planReminders(base({ sleep: { ...sl, coffeeAfternoon: false, plan: { title: "Levántate a la misma hora", text: "Día 4 de 14 · 2 de 3 noches cumplidas." } } })), "2026-10-29");
  expect(conPlan[0].body).toMatch(/\(tu meta: levántate a la misma hora\)\.$/);
  // su ventana empieza a las 00:30: el aviso a las 23:45 sí; a las 01:30 (aviso 00:45) ya no (nunca de madrugada)
  expect(of(planReminders(base({ sleep: { ...sl, bedFrom: 24.5, coffeeAfternoon: false, debtH: 4 } })), "2026-10-29").map((x) => hm(x.at))).toEqual(["23:45"]);
  expect(of(planReminders(base({ sleep: { ...sl, bedFrom: 25.5, coffeeAfternoon: false, debtH: 4 } })), "2026-10-29")).toEqual([]);
});

test("el interruptor «Sueño» apagado: ningún aviso de sueño; de usted: sin tuteo ni emoji", () => {
  expect(planReminders(base({ sleep: { ...sl, drifting: true }, settings: { ...DEFAULT_REMINDER_SETTINGS, sleep: false } })).filter((x) => x.kind === "sleep")).toEqual([]);
  const u = of(planReminders(base({ tone: "usted", sleep: { ...sl, drifting: true } })), "2026-10-29");
  expect(u.map((x) => x.title)).toEqual(["Último café", "En 45 min, a acostarse"]);
  expect(u[0].body).toMatch(/puede tomar café/);
  expect(u[1].body).toMatch(/^Su hora/);
});

test("resumen de la mañana: la meta del plan o luz de mañana, y la invitación a ver cómo durmió", () => {
  const early = new Date(2026, 9, 29, 7, 0);
  const m1 = planReminders(base({ now: early, sleep: { ...sl, drifting: true } })).find((x) => x.id.endsWith("2026-10-29-morning"))!;
  expect(m1.body).toMatch(/Luz de mañana apenas puedas: es lo que más ordena tu horario de sueño\. Abre la app y te cuento cómo dormiste\.$/);
  const m2 = planReminders(base({ now: early, sleep: { ...sl, plan: { title: "Dormir 7 h 30", text: "Día 2 de 14 · 1 de 1 noche cumplida." } } })).find((x) => x.id.endsWith("2026-10-29-morning"))!;
  expect(m2.body).toMatch(/Tu meta de sueño: dormir 7 h 30 \(Día 2 de 14 · 1 de 1 noche cumplida\)\./);
  // sin reloj: nada de sueño en la mañana
  const m3 = planReminders(base({ now: early })).find((x) => x.id.endsWith("2026-10-29-morning"));
  expect(m3?.body ?? "").not.toMatch(/dormiste/);
});
