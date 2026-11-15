// Sueño por chat, con sus horas (2026-11-07). «me dormí a las 5:30pm y desperté a las 23:50» no se reconocía, «me dormí a las 5 y media»
// se anotaba como 5,5 horas, y con «de 17:30 a 23:50» preguntaba «¿son aparte o reemplazan?»: eso nadie sabe responderlo.
process.env.TZ = "America/Santiago";
import { test, expect, setSystemTime, afterAll, beforeEach } from "bun:test";
import { parseSleepTimes, parseSleepOnset, parseSleepStatement, parseWakeAnswer, resolveSleepSaid } from "../src/services/SleepParse.js";
import { SleepLogTool, manualSleepFor } from "../src/tools/SleepLogTool.js";

const h = (d: number, hh: number, mm = 0) => new Date(2026, 10, d, hh, mm).getTime();
const ahora = h(7, 0, 40);
const tarde = { start: h(6, 17, 30), end: h(6, 23, 50) };

function mem(inicial: Record<string, any> = {}) {
  const kv: Record<string, any> = { ...inicial };
  const filas: Array<{ campos: any; dia?: string }> = [];
  return { kv, filas, get: async (k: string) => kv[k] ?? null, set: async (k: string, v: any) => { kv[k] = v; }, upsertDailyRollup: async (campos: any, dia?: string) => { filas.push({ campos, dia }); } };
}
function ws() { const sent: any[] = []; return { sent, send: (s: string) => sent.push(JSON.parse(s)) }; }
const tool = new SleepLogTool();
/** Lo que hace el motor: preroute y, si calza, execute (con zod, como en producción: borra lo que el esquema no declara) */
async function decir(msg: string, memory: any, wsClient: any, ultimo = "") {
  const input = await tool.preroute(msg, { memory, lastAssistantMessage: ultimo });
  if (!input) return null;
  const limpio = tool.inputSchema.parse(input);
  return tool.execute(limpio as any, { memory, wsClient });
}

beforeEach(() => setSystemTime(new Date(ahora)));
afterAll(() => setSystemTime());

test("las frases: con las dos horas sale el tramo, en cualquier orden", () => {
  for (const f of ["me dormí a las 5:30pm y desperté a las 23:50", "me dormi a las 17:30 y desperte a las 23:50", "dormí de 17:30 a 23:50", "dormí de 5:30 de la tarde a 11:50 de la noche",
    "dormí de 5:30 a 11:50", "desperté a las 23:50, me había dormido a las 5 y media de la tarde", "me acosté como a las 17:30 y me levanté a las 23:50"]) {
    const d = parseSleepTimes(f);
    expect(d, f).not.toBeNull();
    expect(resolveSleepSaid(d!, ahora, f), f).toEqual(tarde);
  }
});

test("«recién», y las preguntas o lo que no es sueño no se toman", () => {
  const f = "recién desperté, me dormí a las 17:30";
  expect(resolveSleepSaid(parseSleepTimes(f)!, tarde.end + 60_000, f)).toEqual({ start: tarde.start, end: tarde.end + 60_000 });
  for (const no of ["¿dormí de 8 a 11?", "no dormí de 3 a 5", "trabajé de 8 a 5", "desperté a las 8, ¿qué como?", "voy a dormir a las 11", "almorcé de 1 a 2"]) expect(parseSleepTimes(no), no).toBeNull();
});

test("«ayer» y «anteanoche» corren el día", () => {
  const f = "ayer dormí de 3 a 5";
  const r = resolveSleepSaid(parseSleepTimes(f)!, h(7, 18), f)!;
  expect([r.start, r.end]).toEqual([h(6, 15), h(6, 17)]);
  const g = "anteanoche me dormí a las 23:00 y desperté a las 7:00";
  const r2 = resolveSleepSaid(parseSleepTimes(g)!, h(7, 10), g)!;
  expect([r2.start, r2.end]).toEqual([h(5, 23), h(6, 7)]);
  // «ayer» cuando el tramo ya fue ayer: no se corre otra vez
  const k = "ayer dormí de 17:30 a 23:50";
  expect(resolveSleepSaid(parseSleepTimes(k)!, ahora, k)).toEqual(tarde);
});

test("«me dormí a las 5 y media» no son 5,5 horas de sueño", () => {
  expect(parseSleepStatement("me dormí a las 5 y media")).toBeNull();
  expect(parseSleepStatement("desperté recién, me dormí a las 5 y media")).toBeNull();
  expect(parseSleepOnset("me dormí a las 5 y media")).toEqual({ min: 330, amb: true });
  expect(parseSleepOnset("anoche me dormí a las 3, por eso ando cansado y no sé si ir al gym hoy o no")).toBeNull();
  // Lo de siempre sigue igual
  expect(parseSleepStatement("dormí 7 horas")!.hours).toBe(7);
  expect(parseSleepStatement("anoche dormí 6 y media")!.hours).toBe(6.5);
  expect(parseSleepStatement("dormí 6 horas, me acosté a las 11")!.hours).toBe(6);
});

test("la respuesta a «¿a qué hora despertaste?»", () => {
  expect(parseWakeAnswer("recién")).toBe("ahora");
  expect(parseWakeAnswer("ahora")).toBe("ahora");
  expect(parseWakeAnswer("a las 11:50")).toEqual({ min: 710, amb: true });
  expect(parseWakeAnswer("23:50")).toEqual({ min: 1430, amb: false });
  expect(parseWakeAnswer("me desperté a las 7")).toEqual({ min: 420, amb: true });
  expect(parseWakeAnswer("no sé, tengo hambre")).toBeNull();
});

test("anota el tramo en su día, al teléfono, sin «aparte o reemplaza», y pregunta cómo sigues", async () => {
  const m = mem({ health_snapshot_latest: { lastUpdated: new Date(ahora).toISOString(), schedule: { usualWake: 7.75, sleepHours: 7.5 }, sleep: { durationHours: 7.75, day: "2026-11-06", episodes: [{ start: new Date(h(5, 23)).toISOString(), end: new Date(h(6, 6, 45)).toISOString() }] } } });
  const w = ws();
  const r = await decir("me dormí a las 5:30pm y desperté a las 23:50", m, w);
  const txt = (r!.metadata as any).quickReply as string;
  expect(txt).toContain("Ayer, de 17:30 a 23:50 · 6 h 20");
  expect(txt).toContain("Despertaste a las 23:50. ¿Cómo sigues?");
  expect(txt).toContain("[Opción: Vuelvo a dormir]");
  expect(txt).not.toMatch(/aparte|reemplaza/i);
  expect(w.sent).toEqual([{ type: "sleep_tramo", start: tarde.start, end: tarde.end }]);
  expect(m.kv.sleep_log["2026-11-07"].hours).toBe(6.33);         // en el día al que cuenta, sin sumarle la noche anterior
  expect(m.kv.sleep_log["2026-11-07"].tramos).toEqual([[tarde.start, tarde.end]]);
  expect(m.filas).toEqual([{ campos: { sleepHours: 6.33, sleepNightHours: 6.33 }, dia: "2026-11-07" }]);
  expect(await manualSleepFor(m, "2026-11-07")).toBeNull();      // el teléfono ya tiene el tramo: no se le manda como «horas» también
  expect((r!.metadata as any).veredicto).toBeUndefined();
});

test("«Parto mi día ahora» y «Vuelvo a dormir» llegan al teléfono", async () => {
  const fin = new Date(tarde.end).toISOString();
  for (const [dicho, choice] of [["Parto mi día ahora", "partir"], ["Vuelvo a dormir", "dormir"]] as const) {
    const m = mem();
    const w = ws();
    await decir("dormí de 17:30 a 23:50", m, w);
    const q = "😴 Anoté: Ayer, de 17:30 a 23:50 · 6 h 20.\n\nDespertaste a las 23:50. ¿Cómo sigues?";
    const r = await decir(dicho, m, w, q);
    expect(w.sent[w.sent.length - 1]).toEqual({ type: "sleep_wake_decision", end: fin, choice });
    expect((r!.metadata as any).quickReply).toContain(choice === "partir" ? "tu día parte a las 23:50" : "tu día sigue igual");
    expect(m.kv.sleep_pending).toBeNull();
    // Y no se confunde con otra cosa si Eris no acaba de preguntar
    const m2 = mem({ sleep_pending: { kind: "seguir", fin, at: new Date(ahora).toISOString() } });
    expect(await tool.preroute(dicho, { memory: m2, lastAssistantMessage: "Tu almuerzo tiene 500 kcal." })).toBeNull();
  }
});

test("una noche normal no pregunta; un segundo tramo del mismo día se suma sin contar dos veces", async () => {
  setSystemTime(new Date(h(7, 9)));
  const m = mem({ health_snapshot_latest: { schedule: { usualWake: 7.75, sleepHours: 7.5 } } });
  const w = ws();
  const r = await decir("me dormí a las 23:00 y desperté a las 7:00", m, w);
  expect((r!.metadata as any).quickReply).toBe("😴 Anoté: Hoy, de 23:00 a 07:00 · 8 h.");
  expect(m.kv.sleep_log["2026-11-07"].hours).toBe(8);
  setSystemTime(new Date(h(7, 17, 40)));
  await decir("dormí de 14:00 a 16:00", m, w);
  expect(m.kv.sleep_log["2026-11-07"].hours).toBe(10);
  await decir("dormí de 15:00 a 16:30", m, w);                    // se pisa con el anterior
  expect(m.kv.sleep_log["2026-11-07"].hours).toBe(10.5);
  const inf = await tool.execute({ action: "report" } as any, { memory: m });
  expect((inf.metadata as any).quickReply).toContain("de 23:00 a 07:00 y de 14:00 a 16:30");
});

test("solo dijo cuándo se durmió: pregunta, y con la respuesta anota", async () => {
  const m = mem();
  const w = ws();
  const r = await decir("me dormí a las 5 y media", m, w);
  expect((r!.metadata as any).quickReply).toContain("¿Y a qué hora despertaste?");
  expect(m.kv.sleep_log).toBeUndefined();
  const r2 = await decir("a las 11:50", m, w, "¿Y a qué hora despertaste?\n[Opción: Recién]");
  expect((r2!.metadata as any).quickReply).toContain("Ayer, de 17:30 a 23:50 · 6 h 20");
  expect(w.sent[0]).toEqual({ type: "sleep_tramo", start: tarde.start, end: tarde.end });
});

test("«dormí 7 horas», sin horas del reloj: sigue como siempre", async () => {
  setSystemTime(new Date(h(7, 9)));
  const m = mem();
  const w = ws();
  const r = await decir("dormí 7 horas", m, w);
  expect((r!.metadata as any).quickReply).toContain("Anoté 7 h");
  expect(w.sent).toEqual([{ type: "sleep_logged", day: "2026-11-07", hours: 7 }]);
  expect(await manualSleepFor(m, "2026-11-07")).toBe(7);
});
