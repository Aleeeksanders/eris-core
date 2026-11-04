// ⚡ Modo Rendimiento · R0: la curva de alerta (sleepCore), el día exigente (DayPlan), el servicio y el chat.
import { test, expect } from "bun:test";
process.env.TZ = "America/Santiago";
import { alertCurve, alertCurveText, type SleepInsights } from "C:/Proyectos/eris/src/services/SleepCore.ts";
import { gatherDayPlanInput, buildDayPlan, parseMente, cafeTope, previewText, planText, type DayPlanInput, type DayPlan } from "C:/Proyectos/eris/src/services/DayPlan.ts";
import { buildPlan, previewPlans, planForClient, dailyMode, autoTick, setAuto } from "C:/Proyectos/eris/src/services/DayPlanService.ts";
import { DayPlanTool, RENDIR_ASK } from "C:/Proyectos/eris/src/tools/DayPlanTool.ts";

const at = (h: number, m = 0, d = 29) => new Date(2026, 9, d, h, m);
const fakeMemory = (conditions: string[] = [], extra: Record<string, any> = {}, medical: Record<string, any> = {}) => {
  const m = new Map<string, any>(Object.entries(extra));
  return {
    m,
    get: async (k: string) => (m.has(k) ? m.get(k) : null),
    set: async (k: string, v: any) => { m.set(k, v); },
    getProfile: async () => ({ name: "Alex", medical: { conditions: conditions.map((id) => ({ id })), ...medical } }),
  };
};
const ins = (o: Partial<SleepInsights> = {}): SleepInsights => ({
  nights: 10, need: 7.5, needEstimated: false, avgTotalH: 6.5, avgNightH: 6.5, debtH: 4, onsetSdMin: 30, wakeSdMin: 20, sri: 80, regularity: "regular",
  usualOnset: 23.5, usualWakeH: 7, msf: null, socialJetlagH: null, chronotype: null, trendMinPerDay: null,
  bedtime: { target: 23.5, from: 23, to: 24, wake: 7, napShiftMin: 0 }, caffeineUntil: 17.5, score: null, last3AvgH: 5.5, ...o,
} as SleepInsights);
const corta = { totalH: 4.5 };
const training = { rest: false, name: "Día A: Empuje", items: [{ name: "Press de banca", text: "3×6–8" }, { name: "Fondos", text: "3×8–10" }, { name: "Press militar", text: "3×8" }], doneSets: 0 };
async function base(now: Date, over: Partial<DayPlanInput> = {}, conditions: string[] = [], medical: Record<string, any> = {}): Promise<DayPlanInput> {
  const i = await gatherDayPlanInput(fakeMemory(conditions, {}, medical), now);
  return { ...i, sleep: ins(), sleepAny: ins(), lastSleep: corta, wakeH: 7, ...over };
}
const step = (p: DayPlan, id: string) => p.pasos.find((s) => s.id === id);
const cues = (p: DayPlan, cue: string) => p.pasos.filter((s) => s.accion.type === "cue" && (s.accion as any).cue === cue);

// ─── La curva ────────────────────────────────────────────────────────────────
test("curva: el mejor foco a las 2–4 h de despertar, el bajón ~6–9 h y el segundo aire en la tarde; se corre con el despertar", () => {
  const c7 = alertCurve(ins({ debtH: 0 }), { totalH: 7.5 }, 7);
  expect(c7.foco[0]).toBeGreaterThanOrEqual(8);
  expect(c7.foco[0]).toBeLessThanOrEqual(11);
  expect(c7.bajon[0]).toBeGreaterThanOrEqual(12.5);
  expect(c7.bajon[0]).toBeLessThanOrEqual(16);
  expect(c7.segundoAire).not.toBeNull();
  expect(c7.segundoAire![0]).toBeGreaterThanOrEqual(17);
  expect(c7.nivel).toBe("bueno");
  expect(c7.estimado).toBe(true);
  // trasnochador: despierta a las 11 con su reloj tarde (punto medio 5:30) → todo ~3–4 h después
  const c11 = alertCurve(ins({ msf: 5.5, usualWakeH: 11, bedtime: { target: 27, from: 26.5, to: 27.5, wake: 11, napShiftMin: 0 }, debtH: 0 }), { totalH: 7.5 }, 11);
  expect(c11.foco[0] - c7.foco[0]).toBeGreaterThanOrEqual(2.5);
  expect(c11.bajon[0] - c7.bajon[0]).toBeGreaterThanOrEqual(2);
  expect(c11.bed).toBe(27);
  expect(alertCurveText(c7)).toMatch(/^mejor foco \d\d:\d\d–\d\d:\d\d · bajón \d\d:\d\d–\d\d:\d\d · segundo aire/);
});

test("curva: la noche corta y la deuda la bajan; una siesta la sube después", () => {
  const bien = alertCurve(ins({ debtH: 0 }), { totalH: 7.5 }, 7);
  const mal = alertCurve(ins({ debtH: 5 }), { totalH: 4 }, 7);
  const avg = (c: typeof bien) => c.puntos.reduce((a, p) => a + p[1], 0) / c.puntos.length;
  expect(avg(mal)).toBeLessThan(avg(bien) - 0.15);
  expect(mal.nivel).toBe("bajo");
  const siesta = alertCurve(ins({ debtH: 5 }), { totalH: 4 }, 7, { naps: [{ start: 14.5, end: 14.83 }] });
  const at16 = (c: typeof bien) => c.puntos.find((p) => p[0] === 16)![1];
  expect(at16(siesta)).toBeGreaterThan(at16(mal) + 0.05);
  // durante la siesta no hay puntos
  expect(siesta.puntos.some((p) => p[0] === 14.5)).toBe(false);
});

// ─── El día exigente ─────────────────────────────────────────────────────────
test("protocolo: luz, café antes del mejor rato, bloque, siesta-café en el bajón, segundo aire, último café y la cama", async () => {
  const i = await base(at(7, 30), { training, ready: { level: "liviano", why: "Dormiste 4 h 30.", tip: "" } as any });
  const p = buildDayPlan(i, "rendimiento");
  const c = p.curva!;
  expect(c).toBeDefined();
  expect(step(p, "mente-luz")!.hora).toBe(7.5);
  const c1 = step(p, "mente-cafe1")!;
  expect(c1.hora).toBe(c.foco[0] - 0.5);
  expect(step(p, "mente-bloque1")!.hora).toBe(c.foco[0]);
  expect(step(p, "mente-bajon")!.titulo).toBe("☕😴 Siesta-café, 20 min");
  expect(step(p, "mente-bloque2")!.titulo).toBe("💡 Segundo aire: ideas y estrategia"); // sin check-in: «de todo»
  const ult = step(p, "mente-cafe2");
  if (ult) expect(ult.hora!).toBeLessThanOrEqual(17.5);
  for (const s of cues(p, "cafe").concat(cues(p, "siesta_cafe"))) expect(s.hora!).toBeLessThanOrEqual(17.5);
  expect(cues(p, "cafe").length + cues(p, "siesta_cafe").length).toBeLessThanOrEqual(4);
  expect(step(p, "mente-seguridad")!.detalle).toMatch(/Nada de energéticas con alcohol ni pastillas/);
  const sueno = step(p, "sueno")!;
  expect(sueno.titulo).toBe("😴 A la cama a las 23:00");
  expect(sueno.detalle).toMatch(/mañana te sugiero Óptimo/);
  // entreno con «liviano»: corto y sin cargas
  const e = step(p, "entreno")!;
  expect(e.titulo).toMatch(/\(liviana, 25–30 min\)/);
  expect(e.accion).toEqual({ type: "load_routine", deload: true, shorter: true });
  // comida: almuerzo moderado y kcal de Óptimo, sin gusto
  expect(p.kcal).toBe(buildDayPlan(i, "optimo").kcal);
  expect(step(p, "gusto")).toBeUndefined();
  expect(p.tazas).toEqual({ max: 4, llevas: 0 });
  expect(p.resumen).toMatch(/^foco \d\d:\d\d–\d\d:\d\d · hasta 4 cafés/);
  const t = planText(p);
  expect(t).toMatch(/^⚡ Tu día en modo \*\*Rendimiento\*\*/);
  expect(t).toMatch(/📈 Tu curva de hoy \(estimada: todavía no la ajusto a ti\): mejor foco/);
  expect(t).toMatch(/Si me cuentas cómo estás \(estrés y foco, del 1 al 5\)/);
  // orden: todo el día arriba, después por hora
  const horas = p.pasos.filter((s) => s.hora != null).map((s) => s.hora!);
  expect([...horas].sort((a, b) => a - b)).toEqual(horas);
});

test("el último café nunca después de su hora límite; si el bajón queda tarde, siesta sola o caminar", async () => {
  // la hora límite cae justo antes del bajón: la siesta va sin café
  const lim = buildDayPlan(await base(at(7, 30)), "rendimiento").curva!.bajon[0] - 0.25;
  const i = await base(at(7, 30), { sleep: ins({ caffeineUntil: lim }), sleepAny: ins({ caffeineUntil: lim }) });
  const p = buildDayPlan(i, "rendimiento");
  for (const s of [...cues(p, "cafe"), ...cues(p, "siesta_cafe")]) expect(s.hora!).toBeLessThanOrEqual(lim);
  expect(step(p, "mente-bajon")!.titulo).not.toMatch(/café/i);
  // ya tomó 4 tazas: ninguna más
  const lleno = buildDayPlan({ ...(await base(at(7, 30))), cafeHoy: 4 }, "rendimiento");
  expect(cues(lleno, "cafe").length + cues(lleno, "siesta_cafe").length).toBe(0);
  expect(lleno.tazas).toEqual({ max: 4, llevas: 4 });
});

test("condiciones: presión o corazón y ansiedad hasta 2 tazas con «consulta»; embarazo sin café; diabetes cuida el azúcar", async () => {
  const hta = buildDayPlan(await base(at(7, 30), {}, ["hypertension"]), "rendimiento");
  expect(hta.tazas!.max).toBe(2);
  expect(hta.notas!.join(" ")).toMatch(/hasta 2 tazas por la presión.*consúltalo con tu médico/);
  expect(cues(hta, "cafe").length + cues(hta, "siesta_cafe").length).toBeLessThanOrEqual(2);
  const ans = await base(at(7, 30), {}, ["anxiety"]);
  expect(cafeTope(ans, null, false)).toEqual({ max: 2, por: "la ansiedad", consulta: true });
  const arr = await base(at(7, 30), {}, ["other"], { conditions: [{ id: "other", notes: "arritmia" }] });
  expect(cafeTope(arr, null, false).por).toBe("tu corazón");
  const emb = buildDayPlan(await base(at(7, 30), {}, [], { dietaryRestrictions: ["embarazo"] }), "rendimiento");
  expect(emb.tazas!.max).toBe(0);
  expect(step(emb, "mente-sincafe")!.detalle).toMatch(/médico o matrona/);
  expect(cues(emb, "cafe").length + cues(emb, "siesta_cafe").length).toBe(0);
  expect(emb.resumen).toMatch(/sin café/);
  const dia = buildDayPlan(await base(at(7, 30), {}, ["diabetes_t2"]), "rendimiento");
  expect(step(dia, "mente-bajon")!.detalle).toMatch(/10 min caminando después de almorzar: con poco sueño el azúcar sube más/);
});

test("frecuencia: el 3.er día de la semana lo avisa; desde el 4.º, más suave (menos café)", async () => {
  const tres = buildDayPlan(await base(at(7, 30), { usesRendimiento7d: 2 }), "rendimiento");
  expect(tres.notas!.join(" ")).toMatch(/ya van 3 días exigentes/);
  expect(tres.tazas!.max).toBe(4);
  const cuatro = buildDayPlan(await base(at(7, 30), { usesRendimiento7d: 3 }), "rendimiento");
  expect(cuatro.notas!.join(" ")).toMatch(/Es el 4\.º día exigente de la semana: lo armé más suave/);
  expect(cuatro.tazas!.max).toBe(3);
});

test("check-in: ideas cambia el orden (decidir primero, ideas caminando en el bajón); detalle repite bloque; estrés alto respira y baja el café; foco bajo en tandas", async () => {
  const i = await base(at(7, 30));
  const ideas = buildDayPlan(i, "rendimiento", null, null, { tipo: "ideas" });
  expect(step(ideas, "mente-bloque1")!.titulo).toBe("🎯 Tu mejor rato: decidir y ordenar");
  expect(step(ideas, "mente-ideas")!.hora).toBe(ideas.curva!.bajon[1]);
  expect(step(ideas, "mente-bloque2")!.titulo).toBe("🔭 Segundo aire: el panorama completo");
  const det = buildDayPlan(i, "rendimiento", null, null, { tipo: "detalle" });
  expect(step(det, "mente-bloque1")!.titulo).toBe("🎯 Tu mejor rato: lo de detalle");
  expect(step(det, "mente-ideas")).toBeUndefined();
  expect(step(det, "mente-bloque2")!.titulo).toBe("🎯 Segundo aire: otro bloque de detalle");
  const est = buildDayPlan(i, "rendimiento", null, null, { estres: 5, foco: 2 });
  expect(step(est, "mente-respira1")!.hora).toBe(est.curva!.foco[0] - 0.25);
  expect(step(est, "mente-respira2")).toBeDefined();
  expect(step(est, "mente-respira")).toBeUndefined();
  expect(est.tazas!.max).toBe(3);
  expect(step(est, "mente-bloque1")!.detalle).toMatch(/tandas de 25 min/);
  expect((step(est, "mente-bloque1")!.accion as any).minutes).toBe(25);
  expect(est.mente).toEqual({ estres: 5, foco: 2 });
  expect(planText(est)).not.toMatch(/Si me cuentas cómo estás/);
});

test("parseMente: frases de chat a estrés, foco y tipo de día", () => {
  expect(parseMente("estoy estresado y tengo que concentrarme")).toEqual({ estres: 4, tipo: "detalle" });
  expect(parseMente("estrés 4, foco 2, ideas")).toEqual({ estres: 4, foco: 2, tipo: "ideas" });
  expect(parseMente("muy estresada, no me puedo concentrar y tengo examen")).toEqual({ estres: 5, foco: 2, tipo: "detalle" });
  expect(parseMente("tengo que pensar la estrategia del trimestre")).toEqual({ tipo: "ideas" });
  expect(parseMente("un poco de todo, reuniones")).toEqual({ tipo: "todo" });
  expect(parseMente("necesito rendir hoy")).toBeNull();
});

test("a media tarde: solo lo que queda; trasnochador: la cama pasada la medianoche", async () => {
  const tarde = buildDayPlan(await base(at(17, 0)), "rendimiento");
  expect(step(tarde, "mente-luz")).toBeUndefined();
  expect(step(tarde, "mente-cafe1")).toBeUndefined();
  expect(step(tarde, "mente-bloque1")).toBeUndefined();
  for (const s of tarde.pasos) if (s.modulo === "mente" && s.hora != null) expect(s.hora).toBeGreaterThanOrEqual(17);
  const noct = ins({ msf: 5.5, usualWakeH: 11, bedtime: { target: 27, from: 26.5, to: 27.5, wake: 11, napShiftMin: 0 }, caffeineUntil: 21 });
  const t = buildDayPlan(await base(at(11, 30), { sleep: noct, sleepAny: noct, wakeH: 11 }), "rendimiento");
  expect(step(t, "sueno")!.titulo).toBe("😴 A la cama a las 02:30");
  expect(step(t, "mente-bloque1")!.hora!).toBeGreaterThanOrEqual(12);
});

test("sin datos de sueño: la curva sale igual con su despertar (y lo dice como estimada)", async () => {
  const p = buildDayPlan(await base(at(8, 0), { sleep: null, sleepAny: null, lastSleep: null, wakeH: 7.5 }), "rendimiento");
  expect(p.curva!.nivel).toBe("bueno");
  expect(step(p, "sueno")).toBeDefined();
  expect(step(p, "mente-seguridad")).toBeUndefined(); // partió bien: sin el aviso de manejar
});

test("vista previa: el 4.º camino solo si lo tiene, destacado con poco sueño", async () => {
  const i = await base(at(7, 30), { ready: { level: "suave", why: "", tip: "" } as any });
  expect(previewText(i)).not.toMatch(/Rendimiento/);
  const t = previewText(i, { rendimiento: true });
  expect(t).toMatch(/• \*\*⚡ Rendimiento\*\* \(día exigente\): foco/);
  expect(t).toMatch(/Dormiste poco: si igual tienes que rendir hoy, ⚡ Rendimiento\./);
  expect(t).toMatch(/\[Opción: Rendimiento\]\n\[Opción: Otro\]$/);
  const bien = previewText({ ...i, ready: { level: "normal" } as any, lastSleep: { totalH: 7.5 }, sleep: ins({ debtH: 0 }), sleepAny: ins({ debtH: 0 }) }, { rendimiento: true });
  expect(bien).not.toMatch(/Dormiste poco/);
});

// ─── El servicio ─────────────────────────────────────────────────────────────
test("servicio: no cambia el camino de siempre, anota el día y el check-in, y el teléfono viejo lo recibe como Óptimo", async () => {
  const snap = { lastUpdated: at(7, 0).toISOString(), heartRate: { resting: 64 } };
  const mem = fakeMemory([], { day_plan_mode: "estricto", health_snapshot_latest: snap });
  const p = await buildPlan(mem, "rendimiento", null, at(7, 30), null, null, { estres: 4, tipo: "ideas" });
  expect(p.mode).toBe("rendimiento");
  expect(mem.m.get("day_plan_mode")).toBe("estricto");
  expect(mem.m.get("day_plan_log")).toEqual([{ day: "2026-10-29", mode: "rendimiento" }]);
  const ck = mem.m.get("mind_checkins");
  expect(ck.length).toBe(1);
  expect(ck[0]).toMatchObject({ day: "2026-10-29", estres: 4, tipo: "ideas", restingHR: 64 });
  // al rearmar el día (comió otra cosa) el check-in no se pierde ni se duplica
  const p2 = await buildPlan(mem, "rendimiento", null, at(9, 0));
  expect(p2.mente).toEqual({ estres: 4, tipo: "ideas" });
  expect(mem.m.get("mind_checkins").length).toBe(1);
  // compatibilidad: la app 1.71 no conoce el modo
  expect(planForClient({ data: {} }, p)!.mode).toBe("optimo");
  expect(planForClient({ data: { planV: 2 } }, p)!.mode).toBe("rendimiento");
  // mañana, el piloto automático no vuelve a Estricto: toca recuperar
  expect(await dailyMode(mem, at(8, 0, 30))).toBe("optimo");
  expect(await dailyMode(mem, at(8, 0, 31))).toBe("estricto");
  // cuenta los días de la semana (sin hoy)
  mem.m.set("day_plan_log", [{ day: "2026-10-26", mode: "rendimiento" }, { day: "2026-10-27", mode: "optimo" }, { day: "2026-10-28", mode: "rendimiento" }, { day: "2026-10-20", mode: "rendimiento" }]);
  expect((await gatherDayPlanInput(mem, at(7, 30))).usesRendimiento7d).toBe(2);
  const pv = await previewPlans(mem, at(7, 30), { rendimiento: true });
  expect(pv.map((x) => x.mode)).toEqual(["estricto", "optimo", "flexible", "rendimiento"]);
  expect((await previewPlans(mem, at(7, 30))).length).toBe(3);
});

test("piloto automático tras un día exigente: arma Óptimo, no Rendimiento ni Estricto", async () => {
  const mem = fakeMemory([], { day_plan_mode: "estricto", day_plan_log: [{ day: "2026-10-28", mode: "rendimiento" }], health_snapshot_latest: { lastUpdated: at(9, 0).toISOString() } });
  await setAuto(mem, true);
  const sent: any[] = [];
  expect(await autoTick(mem, { send: (x: string) => sent.push(JSON.parse(x)) }, at(9, 30))).toBe("hoy");
  expect(mem.m.get("day_plan_2026-10-29").mode).toBe("optimo");
});

// ─── El chat ─────────────────────────────────────────────────────────────────
test("chat: las frases del día exigente, solo con el modo habilitado; el check-in en la misma frase o después", async () => {
  for (const f of ["necesito rendir hoy", "hoy es un día exigente", "modo rendimiento", "tengo que rendir hoy aunque dormí 4 horas", "¿cómo sobrevivo a este día?", "día sacrificado"]) expect(RENDIR_ASK.test(f.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim())).toBe(true);
  for (const f of ["quiero rendir más en el gimnasio este mes", "cómo me fue en el día"]) expect(RENDIR_ASK.test(f.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase())).toBe(false);
  const tool = new DayPlanTool();
  const mem = fakeMemory([], {});
  expect(await tool.preroute("necesito rendir hoy", { memory: mem, role: "eris" })).toBeNull();
  expect(await tool.preroute("necesito rendir hoy", { memory: mem, role: "ikaros" })).toEqual({ action: "build", mode: "rendimiento" });
  expect(await tool.preroute("estoy estresado y tengo que concentrarme", { memory: mem, role: "ikaros" })).toEqual({ action: "build", mode: "rendimiento", mente: { estres: 4, tipo: "detalle" } });
  expect(await tool.preroute("día exigente: tengo examen y almuerzo afuera", { memory: mem, role: "ikaros" }))
    .toEqual({ action: "build", mode: "rendimiento", mente: { tipo: "detalle" }, nota: "día exigente: tengo examen y almuerzo afuera" });
  // Sin check-in queda esperando «estrés 4, foco 2, ideas»
  const sent: any[] = [];
  const ws = { send: (x: string) => sent.push(JSON.parse(x)), data: {} };
  const r = await tool.execute({ action: "build", mode: "rendimiento" }, { memory: mem, role: "ikaros", wsClient: ws });
  expect(r.output).toMatch(/^⚡ Tu día en modo \*\*Rendimiento\*\*/);
  expect(sent[0].plan.mode).toBe("optimo"); // el teléfono viejo
  expect((await mem.get("day_plan_pending")).awaiting).toBe("mente");
  expect(await tool.preroute("estrés 4, foco 2, ideas", { memory: mem, role: "ikaros" })).toEqual({ action: "build", mode: "rendimiento", mente: { estres: 4, foco: 2, tipo: "ideas" } });
  // la cuenta pública sin el modo: si llega igual (el botón), lo dice amable
  const r2 = await tool.execute({ action: "build", mode: "rendimiento" }, { memory: fakeMemory(), role: "eris" });
  expect(r2.output).toMatch(/todavía está en prueba/);
  // la vista previa del chat muestra el 4.º camino solo a quien lo tiene
  expect((await tool.execute({ action: "preview" }, { memory: fakeMemory(), role: "ikaros" })).output).toMatch(/\[Opción: Rendimiento\]/);
  expect((await tool.execute({ action: "preview" }, { memory: fakeMemory(), role: "eris" })).output).not.toMatch(/Rendimiento/);
});
