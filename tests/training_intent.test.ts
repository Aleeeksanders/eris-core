// El entreno de hoy (servidor): el chat por código, metas según el día con el fantasma, y la herramienta.
import { test, expect } from "bun:test";
import { parseTrainingStatement, buildIntent, saveIntent, intentFor } from "C:/Proyectos/eris/src/services/TrainingIntent.ts";
import { computeTargets, localDay } from "C:/Proyectos/eris/src/services/DailyTargets.ts";
import { intentOf, groupsFor } from "C:/Proyectos/eris/src/services/ToolRouter.ts";
import { TrainingTodayTool } from "C:/Proyectos/eris/src/tools/TrainingTodayTool.ts";

const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };

test("el chat: entreno, descanso, «al final no», actividades, horas y duración", () => {
  expect(parseTrainingStatement("hoy entreno pierna a las 7", at(15))).toEqual({ answer: "si", kind: "rutina", label: "Pierna", time: "19:00" });
  expect(parseTrainingStatement("hoy entreno pierna a las 7", at(5))).toMatchObject({ time: "07:00" });
  expect(parseTrainingStatement("Hoy descanso")).toEqual({ answer: "no", cancel: false });
  expect(parseTrainingStatement("al final no entreno hoy")).toEqual({ answer: "no", cancel: true });
  expect(parseTrainingStatement("voy a jugar básquet 2 horas a las 8 de la noche", at(12))).toEqual({ answer: "si", kind: "otra", activity: "basquet", label: "básquet", minutes: 120, time: "20:00" });
  expect(parseTrainingStatement("hoy toca día B a las 18:30")).toMatchObject({ label: "Día B", time: "18:30" });
  expect(parseTrainingStatement("voy al gym en la tarde")).toMatchObject({ answer: "si", time: "18:30" });
  expect(parseTrainingStatement("hoy salgo a correr una hora y media")).toMatchObject({ activity: "trote", minutes: 90 });
  // preguntas y otras cosas: no
  expect(parseTrainingStatement("¿qué entreno hoy?")).toBeNull();
  expect(parseTrainingStatement("qué me conviene, entreno hoy?")).toBeNull();
  expect(parseTrainingStatement("me comí un pan con palta")).toBeNull();
  // el router: solo eso → training_today
  const msg = "hoy entreno pierna a las 7";
  expect(intentOf(msg, groupsFor(msg))).toBe("entreno_hoy");
  expect(intentOf("hoy entreno y me comí un completo", groupsFor("hoy entreno y me comí un completo"))).not.toBe("entreno_hoy");
});

const body = { weightKg: 85, heightCm: 179, age: 27, sex: "h" as const, activity: 1.375, activityAuto: true, date: localDay(), trainingKcal: 0, trainingSets: 0 };
const auto = { factor: 1.45, label: "Moderado", perWeek: 3, days: 28, neatKcal: 180, exKcal: 280 };
const BMR = 10 * 85 + 6.25 * 179 - 5 * 27 + 5;

test("metas según el día: sin respuesta igual que siempre; descanso baja; entreno sube con el fantasma", () => {
  const today = localDay();
  const base = computeTargets({ body, today, autoLevel: auto, now: at(12) });
  expect(base.byDay).toBeUndefined();
  const rest = computeTargets({ body, today, autoLevel: auto, now: at(12), intent: { day: today, answer: "no", source: "app", at: "" } });
  expect(rest.byDay).toBe("descanso");
  expect(rest.kcal).toBe(Math.round(Math.round(BMR) * 1.2 + 180));
  expect(rest.kcal).toBeLessThan(base.kcal);
  const intent = { day: today, answer: "si" as const, kind: "rutina" as const, label: "Pierna", time: "19:00", kcal: 520, waterMl: 600, source: "app" as const, at: "" };
  const train = computeTargets({ body, today, autoLevel: auto, now: at(12), intent });
  console.log("sin respuesta", base.kcal, "· descanso", rest.kcal, "· entreno", train.kcal, train.kcalGhost, train.kcalNoGhost, "|", train.sources.kcal);
  expect(train.byDay).toBe("entreno");
  expect(train.kcal).toBe(rest.kcal + 520);
  expect(train.kcalGhost).toBe(520);
  expect(train.kcalNoGhost).toBe(rest.kcal);
  expect(train.intentPhrase).toBe("tu pierna de las 19:00");
  expect(train.minutesToWorkout).toBe(7 * 60);
  expect(train.waterL!).toBeGreaterThan(rest.waterL!);
  // ya entrenó 300 de 520: el fantasma baja a 220, la meta no cambia
  const half = computeTargets({ body: { ...body, trainingKcal: 300, trainingSets: 10 }, today, autoLevel: auto, now: at(19, 30), intent });
  expect(half.kcalGhost).toBe(220);
  expect(half.kcal).toBe(train.kcal);
  // entrenó más de lo planificado: manda lo hecho
  const more = computeTargets({ body: { ...body, trainingKcal: 700 }, today, autoLevel: auto, now: at(20), intent });
  expect(more.kcal).toBe(rest.kcal + 700);
  expect(more.kcalGhost).toBeUndefined();
  // se durmió sin entrenar: a las 23 el fantasma se apaga sin reproche
  const late = computeTargets({ body, today, autoLevel: auto, now: at(23), intent });
  expect(late.kcalGhost).toBeUndefined();
  expect(late.kcal).toBe(rest.kcal);
  // con objetivo (recomposición) el fantasma también se descuenta bien
  const goal = computeTargets({ body: { ...body, goal: "recomp" }, today, autoLevel: auto, now: at(12), intent });
  expect(goal.kcalNoGhost).toBeLessThan(goal.kcal);
});

test("la herramienta: anota, responde con cifras reales y avisa al teléfono", async () => {
  const store = new Map<string, any>();
  const memory = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: any) => { store.set(k, v); }, getProfile: async () => null };
  store.set("body_profile", body);
  store.set("health_snapshot_latest", { activityLevel: auto });
  store.set("forge_projection", { day: localDay(), plan: { kcal: 480, minutes: 60, sets: 18 }, typical: { kcal: 300, minutes: 50 }, at: "" });
  const sent: any[] = [];
  const tool = new TrainingTodayTool();
  const input = await tool.preroute("hoy entreno pierna a las 7");
  expect(input).toEqual({ action: "set", message: "hoy entreno pierna a las 7" });
  const r = await tool.execute(input as any, { memory, wsClient: { send: (m: string) => sent.push(JSON.parse(m)) } });
  console.log(r.output);
  expect(r.output).toContain("hoy entrenas pierna");
  expect(r.output).toContain("480 kcal");
  expect((r.metadata as any).quickReply).toBe(r.output);
  expect(sent[0]).toMatchObject({ type: "training_intent", intent: { answer: "si", kcal: 480, label: "Pierna" } });
  expect((await intentFor(memory))?.kcal).toBe(480);
  const r2 = await tool.execute({ action: "set", message: "al final no entreno" } as any, { memory });
  expect(r2.output).toContain("Sin drama");
  expect((await intentFor(memory))?.answer).toBe("no");
});
