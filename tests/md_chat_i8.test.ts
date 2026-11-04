// Fase I8: «carga mi rutina» por chat → cómo quedaría y «¿La cargo?»; «Sí, cárgala» la manda al teléfono con los propios.
import { test, expect } from "bun:test";
import { TrainingPlanTool, MD_ROUTINE_ASK } from "C:/Proyectos/eris/src/tools/TrainingPlanTool.ts";

const MD = "RUTINA DE PRUEBA\n\nDía 1: Empuje (Lunes)\n· Press de Banca (Barra o Mancuernas): 4 series x 6-8 reps. (65-75 kg en barra)\n· Anillas - Ring Dips: 3 series x 6-8 reps.\n· Handstand (Pino contra la pared): 3 series x 45 segundos.\n\nDía 2: Tirón (Jueves)\n· Dominadas Pronas Lastradas: 4 series x 6-8 reps. (+10 kg de lastre)\n· Sprints: 6 series de 30 metros.";

function fakes() {
  const mem = new Map<string, any>([["toji_routine_md", { md: MD, name: "prueba" }]]);
  const memory = { get: async (k: string) => mem.get(k) ?? null, set: async (k: string, v: any) => { mem.set(k, v); }, getProfile: async () => null };
  const sent: any[] = [];
  const wsClient = { send: (s: string) => sent.push(JSON.parse(s)) };
  return { mem, memory, sent, wsClient };
}

test("qué frases piden convertir la rutina escrita (y cuáles no)", () => {
  const f = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const t of ["Carga mi rutina", "cárgame la rutina", "convierte mi rutina en plan", "usa mi rutina escrita", "pasa mi rutina a Forge"]) expect(MD_ROUTINE_ASK.test(f(t))).toBe(true);
  for (const t of ["ármame una rutina de 4 días", "quiero una rutina para el gym", "¿qué entreno hoy?"]) expect(MD_ROUTINE_ASK.test(f(t))).toBe(false);
});

test("preview → «¿La cargo?» → sí: la rutina y los ejercicios nuevos van al teléfono; el texto no se toca", async () => {
  const tool = new TrainingPlanTool();
  const { mem, memory, sent, wsClient } = fakes();
  const pre = await tool.preroute("Carga mi rutina", { memory });
  expect(pre).toMatchObject({ action: "load_md_routine" });
  const r1 = await tool.execute(pre as any, { memory, wsClient });
  expect(r1.output).toContain("¿La cargo?");
  expect(r1.output).toContain("Día 1 — Empuje** (lunes)");
  expect(r1.output).toMatch(/Ring Dips \(anillas\) → Fondos/);
  expect(r1.output).toMatch(/Handstand/);
  expect(sent.length).toBe(0); // nada hasta que diga que sí
  const yes = await tool.preroute("Sí, cárgala", { memory, lastAssistantMessage: r1.output });
  expect(yes).toMatchObject({ action: "load_md_routine", confirm: true });
  const r2 = await tool.execute(yes as any, { memory, wsClient });
  expect(r2.output).toMatch(/^✅ Listo: tu rutina quedó como plan/);
  const msg = sent.find((m) => m.type === "forge_routine");
  expect(msg.routine.source).toBe("md");
  expect(msg.routine.days.map((d: any) => d.weekday)).toEqual([1, 4]);
  expect(msg.newExercises.map((c: any) => c.name)).toEqual(["Handstand"]);
  expect(mem.get("toji_routine_md").md).toBe(MD); // tu texto sigue igual
  expect(sent.some((m) => m.type === "toji_save_routine")).toBe(false);
  // «La reviso en la app»
  const r3pre = await tool.preroute("Carga mi rutina", { memory });
  const r3 = await tool.execute(r3pre as any, { memory, wsClient });
  const rev = await tool.preroute("La reviso en la app", { memory, lastAssistantMessage: r3.output });
  const r4 = await tool.execute(rev as any, { memory, wsClient });
  expect(r4.output).toMatch(/Revisar y convertir/);
});

test("sin rutina escrita: lo dice y cómo hacerla", async () => {
  const tool = new TrainingPlanTool();
  const memory = { get: async () => null, set: async () => {}, getProfile: async () => null };
  const r = await tool.execute({ action: "load_md_routine" } as any, { memory });
  expect(r.output).toMatch(/Todavía no tengo tu rutina escrita/);
});
