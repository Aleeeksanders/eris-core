// ⚡ Modo Rendimiento · R2: señales de mente (check-ins, pulso en reposo contra su promedio, lo que se repite después de los
// días exigentes), en el plan, en la línea para Eris y en el chat. Nunca como puntaje.
import { test, expect, setSystemTime } from "bun:test";
process.env.TZ = "America/Santiago";
import { pulseSignal, afterPattern, mindSignals, mindLine, mindText, addDaysIso, type MindCheckin } from "C:/Proyectos/eris/src/services/MindSignals.ts";
import { gatherDayPlanInput, buildDayPlan } from "C:/Proyectos/eris/src/services/DayPlan.ts";
import { buildPlan, previewPlans, mindSignalsFor, rendimientoPista } from "C:/Proyectos/eris/src/services/DayPlanService.ts";
import { DayPlanTool, SENALES_ASK } from "C:/Proyectos/eris/src/tools/DayPlanTool.ts";
import { buildTodayBrief } from "C:/Proyectos/eris/src/services/LiveContext.ts";

const TODAY = "2026-10-29";
const NOW = new Date(2026, 9, 29, 8, 0);
/** 20 días de registro: pulso ~61, sueño ~7 h 06, ánimo 3,8; y los días después de los exigentes, más sueño y menos ánimo */
function rollup(o: { hoyHR?: number; despues?: string[] } = {}) {
  const out: any[] = [];
  for (let k = 20; k >= 0; k--) {
    const date = addDaysIso(TODAY, -k);
    const post = (o.despues ?? []).includes(date);
    out.push({ date, restingHR: k === 0 ? o.hoyHR : 60 + (k % 3), sleepHours: post ? 8.3 : 7.1, moodScore: post ? 3 : 3.8, updatedAt: "" });
  }
  return out.filter((r) => r.restingHR !== undefined || r.date !== TODAY);
}
const fakeMemory = (seed: Record<string, any> = {}, roll: any[] = []) => {
  const m = new Map<string, any>(Object.entries(seed));
  return {
    m, get: async (k: string) => (m.has(k) ? m.get(k) : null), set: async (k: string, v: any) => { m.set(k, v); },
    getProfile: async () => ({ medical: { conditions: [] } }), getDailyRollupLog: async () => roll,
  };
};
const EXIG = [addDaysIso(TODAY, -10), addDaysIso(TODAY, -6), addDaysIso(TODAY, -3)];
const LOG = EXIG.map((day) => ({ day, mode: "rendimiento" }));

test("pulso en reposo contra SU promedio: sin 7 días no se sabe; +5 o más es «alto»", () => {
  expect(pulseSignal(rollup().slice(-5), TODAY, 70)).toBeNull();
  const p = pulseSignal(rollup(), TODAY, 68)!;
  expect(p.base).toBe(61);
  expect(p.delta).toBe(7);
  expect(p.alto).toBe(true);
  expect(pulseSignal(rollup(), TODAY, 63)!.alto).toBe(false);
  // el de hoy también puede venir del registro del día
  expect(pulseSignal(rollup({ hoyHR: 67 }), TODAY)!.hoy).toBe(67);
  // valores imposibles no cuentan
  expect(pulseSignal(rollup(), TODAY, 300)).toBeNull();
});

test("lo que se repite después de los días exigentes (desde 3): sueño de esa noche y ánimo del día siguiente", () => {
  expect(afterPattern(LOG.slice(0, 2), rollup({ despues: EXIG.map((d) => addDaysIso(d, 1)) }), TODAY)).toBeNull();
  const p = afterPattern(LOG, rollup({ despues: EXIG.map((d) => addDaysIso(d, 1)) }), TODAY)!;
  expect(p.n).toBe(3);
  expect(p.sueno).toBe(8.3);
  expect(p.suenoBase).toBe(7.1);
  expect(p.animo).toBe(3);
  expect(p.animoBase).toBe(3.8);
});

test("la semana: un check-in por día (el último), cuántos con estrés alto, días exigentes", () => {
  const checkins: MindCheckin[] = [
    { at: "", day: addDaysIso(TODAY, -2), estres: 2, foco: 4 },
    { at: "", day: addDaysIso(TODAY, -1), estres: 3, foco: 3 },
    { at: "", day: addDaysIso(TODAY, -1), estres: 5, foco: 2 }, // cambió de opinión: cuenta el último
    { at: "", day: TODAY, estres: 4, foco: 2, tipo: "ideas" },
    { at: "", day: addDaysIso(TODAY, -12), estres: 5 }, // fuera de la semana
  ];
  const s = mindSignals({ checkins, log: [...LOG, { day: TODAY, mode: "rendimiento" }], rollup: rollup(), todayKey: TODAY, restingToday: 68 });
  expect(s.semana).toEqual({ n: 3, estresAlto: 2, focoBajo: 2 });
  expect(s.hoy?.tipo).toBe("ideas");
  expect(s.exigentes7).toBe(3); // −6, −3 y hoy
  expect(s.exigentesTotal).toBe(4);
});

test("la línea para Eris: solo si usa el día exigente, en palabras y sin poner nota al estrés", () => {
  // solo el pulso, sin check-ins ni días exigentes: nada (eso lo cubre la tarjeta del día)
  expect(mindLine(mindSignals({ checkins: [], log: [], rollup: rollup(), todayKey: TODAY, restingToday: 70 }))).toBeNull();
  const s = mindSignals({ checkins: [{ at: "", day: TODAY, estres: 4, foco: 2, tipo: "ideas" }], log: LOG, rollup: rollup({ despues: EXIG.map((d) => addDaysIso(d, 1)) }), todayKey: TODAY, restingToday: 68 });
  const l = mindLine(s)!;
  expect(l).toMatch(/^- Mente \(/);
  expect(l).toMatch(/NO es diagnóstico ni puntaje/);
  expect(l).toMatch(/hoy contó: estrés alto · foco bajo · día de ideas/);
  expect(l).toMatch(/pulso en reposo hoy 68 lpm \(su promedio de 4 semanas: 61; \+7\): señal de estrés/);
  expect(l).toMatch(/después de sus días exigentes durmió más/);
  expect(l).not.toMatch(/estr[eé]s:? \d|\d\s*\/\s*5/);
});

test("«¿cómo vengo de estrés?»: lo que hay, en palabras; sin datos lo dice; nunca un puntaje", () => {
  const vacio = mindText(mindSignals({ checkins: [], log: [], rollup: [], todayKey: TODAY }));
  expect(vacio).toMatch(/Todavía no tengo check-ins tuyos/);
  expect(vacio).toMatch(/No es un puntaje ni un diagnóstico/);
  const s = mindSignals({ checkins: [{ at: "", day: addDaysIso(TODAY, -1), estres: 5, foco: 2 }, { at: "", day: TODAY, estres: 4, foco: 3 }],
    log: LOG, rollup: rollup({ despues: EXIG.map((d) => addDaysIso(d, 1)) }), todayKey: TODAY, restingToday: 68 });
  const t = mindText(s);
  expect(t).toMatch(/Esta semana: 2 días exigentes y 2 check-ins/);
  expect(t).toMatch(/Viniste con estrés alto 2 de esos 2 días y con el foco bajo 1/);
  expect(t).toMatch(/Tu pulso en reposo hoy viene más alto que tu promedio \(68 vs 61\)/);
  expect(t).toMatch(/Después de tus días exigentes dormiste más: ~8 h 18 \(lo de siempre: 7 h 06\) y al otro día tu ánimo bajó un poco\./);
  expect(t).not.toMatch(/\d\s*\/\s*5|estr[eé]s \d/);
  // con 1 o 2 días exigentes: cuánto falta para ver el patrón
  expect(mindText(mindSignals({ checkins: [], log: LOG.slice(0, 1), rollup: rollup(), todayKey: TODAY }))).toMatch(/necesito al menos 3; llevas 1/);
});

// ─── En el plan del día exigente ──────────────────────────────────────────────
const sl: any = { nights: 10, need: 7.5, debtH: 2, usualWakeH: 7, msf: null, bedtime: { target: 23.5, from: 23, to: 24, wake: 7, napShiftMin: 0 }, caffeineUntil: 17.5 };
async function input(o: any = {}) {
  const mem = fakeMemory();
  return { ...(await gatherDayPlanInput(mem, NOW)), sleep: sl, sleepAny: sl, lastSleep: { totalH: 6.5 }, wakeH: 7,
    training: { rest: false, name: "Día A: Empuje", items: [{ name: "Press de banca", text: "3×6–8" }], doneSets: 0 }, intent: { answer: "si", time: "19:00" },
    ready: { level: "normal", why: "", tip: "" }, ...o } as any;
}
const PULSO_ALTO = { hoy: 68, base: 61, delta: 7, dias: 20, alto: true };

test("pulso alto: un café menos, respiración antes de los bloques, entreno en versión corta y lo dice", async () => {
  const base = buildDayPlan(await input(), "rendimiento");
  const p = buildDayPlan(await input({ pulso: PULSO_ALTO }), "rendimiento");
  expect(base.tazas!.max).toBe(4);
  expect(p.tazas!.max).toBe(3);
  expect(p.pasos.some((s) => s.id === "mente-respira1")).toBe(true);
  expect(base.pasos.some((s) => s.id === "mente-respira1")).toBe(false);
  expect(p.pasos.find((s) => s.modulo === "entreno")!.titulo).toMatch(/versión corta/);
  expect(base.pasos.find((s) => s.modulo === "entreno")!.titulo).not.toMatch(/versión corta/);
  const nota = p.notas!.find((n) => /pulso en reposo/.test(n))!;
  expect(nota).toMatch(/\(68 vs 61\): puede ser estrés, cansancio o algo que empieza\. Hoy, un café menos y respiración antes de lo importante\. Si te sientes decaído o con fiebre, mejor Óptimo/);
  // dijo que viene tranquilo: el café igual baja (el pulso), pero no se le impone respirar
  const tranq = buildDayPlan(await input({ pulso: PULSO_ALTO }), "rendimiento", undefined, undefined, { estres: 2 });
  expect(tranq.pasos.some((s) => s.id === "mente-respira1")).toBe(false);
  expect(tranq.notas!.find((n) => /pulso en reposo/.test(n))).toMatch(/Hoy, un café menos\./);
  // embarazo: ya sin café, así que no hay «un café menos»
  const emb = buildDayPlan(await input({ pulso: PULSO_ALTO, condText: "embarazada" }), "rendimiento");
  expect(emb.tazas!.max).toBe(0);
  expect(emb.notas!.find((n) => /pulso en reposo/.test(n))).not.toMatch(/un café menos/);
  // el pulso no destaca el día exigente (podría ser algo que empieza)
  expect(rendimientoPista(PULSO_ALTO, 0)).toMatch(/lo armo con un café menos/);
  expect(rendimientoPista(null, 2)).toBe("Esta semana ya llevas 2 días exigentes.");
  expect(rendimientoPista(null, 1)).toBeNull();
});

test("lo que se repite va en las notas del plan, con lo que conviene esta noche", async () => {
  const p = buildDayPlan(await input({ despues: { n: 3, sueno: 8.3, suenoBase: 7.1, animo: null, animoBase: null, nAnimo: 0 } }), "rendimiento");
  expect(p.notas!.join(" ")).toMatch(/Después de tus días exigentes dormiste más: ~8 h 18 \(lo de siempre: 7 h 06\)\. Esta noche, deja ese espacio para dormir\./);
  const menos = buildDayPlan(await input({ despues: { n: 4, sueno: 6.2, suenoBase: 7.1, animo: 3, animoBase: 3.9, nAnimo: 4 } }), "rendimiento");
  expect(menos.notas!.join(" ")).toMatch(/dormiste menos: ~6 h 12 .* y al otro día tu ánimo bajó un poco\. Esta noche, a la cama a la hora/);
  // otros caminos no lo dicen
  expect((buildDayPlan(await input({ pulso: PULSO_ALTO }), "optimo").notas ?? []).join(" ")).not.toMatch(/pulso en reposo/);
});

test("el servicio: el check-in se guarda con el pulso, su promedio y lo dormido; la hoja trae la pista", async () => {
  const roll = rollup({ despues: EXIG.map((d) => addDaysIso(d, 1)) });
  const snap = { lastUpdated: NOW.toISOString(), heartRate: { resting: 68, average: 75 }, sleep: { durationHours: 6.5, nightHours: 6.5 } };
  const mem = fakeMemory({ health_snapshot_latest: snap, day_plan_log: [...LOG, { day: addDaysIso(TODAY, -1), mode: "rendimiento" }] }, roll);
  const i = await gatherDayPlanInput(mem, NOW);
  expect(i.pulso?.alto).toBe(true);
  expect(i.pulso?.base).toBe(61);
  expect(i.despues?.n).toBe(3);
  await buildPlan(mem, "rendimiento", null, NOW, null, null, { estres: 4, foco: 2, tipo: "detalle" });
  const row = mem.m.get("mind_checkins").at(-1);
  expect(row).toMatchObject({ day: TODAY, estres: 4, foco: 2, tipo: "detalle", restingHR: 68, rhrBase: 61 });
  const pv = await previewPlans(mem, NOW, { rendimiento: true });
  const r = pv.find((x) => x.mode === "rendimiento")!;
  expect(r.pista).toMatch(/Tu pulso en reposo viene más alto que tu promedio \(68 vs 61\).*Esta semana ya llevas 3 días exigentes./);
  const s = await mindSignalsFor(mem, NOW);
  expect(s.hoy?.estres).toBe(4);
  expect(s.pulso?.delta).toBe(7);
});

test("el chat: «¿cómo vengo de estrés?» por código, solo con el modo habilitado; no se roba otras frases", async () => {
  const tool = new DayPlanTool();
  const roll = rollup({ despues: EXIG.map((d) => addDaysIso(d, 1)) });
  const mem = fakeMemory({ day_plan_log: LOG, mind_checkins: [{ at: "", day: TODAY, estres: 4, foco: 2 }] }, roll);
  for (const q of ["¿Cómo vengo de estrés?", "cómo he andado de foco", "¿Cómo me han ido los días exigentes?", "muéstrame mis check-ins", "¿qué notas de mi estrés?", "ando muy estresado últimamente"]) {
    expect(await tool.preroute(q, { memory: mem, role: "ikaros" })).toEqual({ action: "senales" });
  }
  for (const q of ["estoy estresado y tengo que concentrarme", "¿cómo vengo de agua?", "el estrés me tiene mal", "¿cómo vengo de plata este mes?"]) {
    expect(await tool.preroute(q, { memory: mem, role: "ikaros" })).not.toEqual({ action: "senales" });
  }
  expect(SENALES_ASK.test("como vengo de estres")).toBe(true);
  // Revisión V3 (2026-11-04): «esta semana» se cuenta con el reloj; con el del escenario (29-10), no con el de hoy
  setSystemTime(NOW);
  const out = await tool.execute({ action: "senales" } as any, { memory: mem, role: "ikaros" }).finally(() => setSystemTime());
  expect(out.output).toMatch(/Esta semana: 2 días exigentes y 1 check-in\./);
  expect(out.output).toMatch(/Hoy me contaste: estrés alto · foco bajo\./);
  expect(out.output).toMatch(/Después de tus días exigentes dormiste más/);
  expect((out.metadata as any).quickReply).toBe(out.output);
});

test("la línea de mente llega al contexto de Eris de hoy", async () => {
  const roll = rollup();
  const snap = { lastUpdated: new Date().toISOString(), heartRate: { resting: 69, average: 75 } };
  const mem: any = fakeMemory({ health_snapshot_latest: snap, day_plan_log: [{ day: addDaysIso(new Date().toISOString().slice(0, 10), -1), mode: "rendimiento" }] }, roll);
  const brief = await buildTodayBrief(mem, "hola");
  expect(brief).toMatch(/- Mente \(check-ins del día exigente/);
  expect(brief).toMatch(/días exigentes esta semana: 1/);
  // sin días exigentes ni check-ins, no aparece
  const sin = await buildTodayBrief(fakeMemory({ health_snapshot_latest: snap }, roll) as any, "hola");
  expect(sin).not.toMatch(/- Mente/);
});
