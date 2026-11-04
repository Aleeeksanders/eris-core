// «Arma mi rutina» por código (2026-10-21): con los mensajes reales del 18-10 (Toji, 3 o 4 días, gimnasio y casa, hombro).
import { test, expect } from "bun:test";
import { TrainingPlanTool, parseRoutineAnswer, ROUTINE_PENDING_KEY } from "C:/Proyectos/eris/src/tools/TrainingPlanTool.ts";
import { defaultGym } from "C:/Proyectos/eris/src/services/forge/forgeCatalog.ts";

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const mem = () => {
  const m = new Map<string, any>([
    ["body_profile", { weightKg: 85, sex: "h", age: 27, heightCm: 179, goal: "recomp" }],
    ["forge_projection", { day: "x", at: "", gym: defaultGym("smartfit"), e1rm: {}, experience: "intermedio" }],
  ]);
  return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { m.set(k, v); }, getProfile: async () => ({ medical: { conditions: [{ id: "diabetes_t2" }] } }) };
};
const PIDE = "Arma mi rutina en base a Toji fushiguro, dividelo en grupos musculares y si hay algún ejercicio especial dale no más, mi cuerpo ya está acondicionado";
const RESP = "1. 3 o 4 días máximo\n2. Gimnasio y casa deja para ambos casos\n3. Smartfit completo y en casa, mancuernas, anillas de gimnasia y una máquina para hacer dominadas, fondos, abs \n4. En mi hombro izquierdo, se siente raro, no alcanza a doler pero si quiero tomarlo en cuenta";

test("lo que dice de su rutina, por código", () => {
  expect(parseRoutineAnswer(fold(RESP))).toEqual({ days: 3, where: "gym", both: true, care: ["hombro"] });
  expect(parseRoutineAnswer(fold("4 dias, 60 min, en la casa, cuidar la rodilla"))).toEqual({ days: 4, minutes: 60, where: "casa", care: ["rodilla"] });
  expect(parseRoutineAnswer(fold("tres veces por semana una hora"))).toEqual({ days: 3, minutes: 60 });
  expect(parseRoutineAnswer(fold("Mejor de 4 días")).days).toBe(4);
});

test("pide la rutina → preguntas; responde → se arma la del gimnasio y la de casa, y queda en Forge", async () => {
  const memory = mem(); const sent: any[] = [];
  const ws = { send: (x: string) => sent.push(JSON.parse(x)) };
  const t = new TrainingPlanTool();
  // 1) el pedido: preguntas por código
  const in1 = await t.preroute(PIDE, { memory, lastAssistantMessage: "" });
  expect(in1).toMatchObject({ action: "build_routine", viaCode: true });
  const r1: any = await t.execute(in1 as any, { memory, wsClient: ws });
  console.log(r1.metadata.quickReply);
  expect(r1.metadata.quickReply).toContain("¿Cuántos días a la semana");
  expect(memory.m.get(ROUTINE_PENDING_KEY)).toBeTruthy();
  // 2) la respuesta (no es una pregunta ni un síntoma: la rutina la toma)
  const in2 = await t.preroute(RESP, { memory, lastAssistantMessage: r1.metadata.quickReply });
  expect(in2).toMatchObject({ action: "build_routine", days: 3, both: true, care: ["hombro"], where: "gym" });
  const r2: any = await t.execute(in2 as any, { memory, wsClient: ws });
  console.log(r2.metadata.quickReply);
  expect(r2.metadata.quickReply).toContain("✅ Listo: tu rutina de 3 días");
  expect(r2.metadata.quickReply).toContain("🏠 **En casa**");
  expect(r2.metadata.quickReply).toContain("Cuidando el hombro");
  expect(sent.map((x) => x.type)).toEqual(["forge_routine", "toji_save_routine"]);
  expect(sent[0].routine.where).toBe("gym");
  expect(sent[1].md).toContain("Si no puedes ir al gimnasio");
  // 3) «Mejor de 4 días»: se vuelve a armar con lo mismo (gimnasio y casa, hombro)
  const in3 = await t.preroute("Mejor de 4 días", { memory, lastAssistantMessage: r2.metadata.quickReply });
  expect(in3).toMatchObject({ days: 4, both: true, care: ["hombro"] });
  const r3: any = await t.execute(in3 as any, { memory, wsClient: ws });
  expect(r3.metadata.quickReply).toContain("rutina de 4 días (torso y pierna");
});

test("no se mete donde no corresponde", async () => {
  const memory = mem();
  const t = new TrainingPlanTool();
  for (const msg of ["Cambia el press militar de mi rutina", "¿Cómo va mi rutina?", "Registra mi rutina", "hoy entreno pierna a las 7", "4 días"]) {
    expect(await t.preroute(msg, { memory, lastAssistantMessage: "" })).toBeNull();
  }
});

test("«Dale, registra» sigue el hilo: después de hablar de la rutina, training_plan a la vista", async () => {
  const { routeTools, TOOL_GROUP, isBareConfirm } = await import("C:/Proyectos/eris/src/services/ToolRouter.ts");
  const prev = ["Osea, hoy día lo entrené bien, pero quiero mi rutina we, una para el gimnasio y otra para la casa en caso de no poder ir"];
  const r = routeTools("Dale, registra", prev, Object.keys(TOOL_GROUP));
  expect(r.reason).toBe("conversación");
  expect(r.tools.has("training_plan")).toBe(true);
  expect(r.intent).toBeUndefined();
  for (const m of ["Dale, registra", "sí, anótalo porfa", "ya, guárdalo", "dale"]) expect(isBareConfirm(m)).toBe(true);
  for (const m of ["registra 2 marraquetas", "anota que dormí 7 horas", "sí", "no"]) expect(isBareConfirm(m)).toBe(false);
  // después de hablar de comida, sigue siendo comida
  const food = routeTools("Dale, registra", ["Me comí 2 marraquetas con palta"], Object.keys(TOOL_GROUP));
  expect(food.tools.has("nutrition_tracker")).toBe(true);
});

test("«Dale, registra» después de las preguntas: pide solo los días, con botones; el botón arma la rutina", async () => {
  const memory = mem();
  const t = new TrainingPlanTool();
  const q1: any = await t.execute((await t.preroute("Quiero mi rutina, una para el gimnasio y otra para la casa", { memory, lastAssistantMessage: "" })) as any, { memory });
  const in2 = await t.preroute("Dale, registra", { memory, lastAssistantMessage: q1.metadata.quickReply });
  expect(in2).toMatchObject({ reask: true, both: true });
  const q2: any = await t.execute(in2 as any, { memory });
  expect(q2.metadata.quickReply).toContain("[Opción: 3 días]");
  const in3 = await t.preroute("3 días", { memory, lastAssistantMessage: q2.metadata.quickReply });
  expect(in3).toMatchObject({ days: 3, both: true });
  const r3: any = await t.execute(in3 as any, { memory, wsClient: { send: () => {} } });
  expect(r3.metadata.quickReply).toContain("tu rutina de 3 días");
  // ya armada: «gracias» no vuelve a preguntar
  expect(await t.preroute("gracias", { memory, lastAssistantMessage: r3.metadata.quickReply })).toBeNull();
});
