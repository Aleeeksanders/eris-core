// training_plan (F5): build_routine y adjust_routine por código; apply_plan rechaza ids que no existen.
import { test, expect } from "bun:test";
import { TrainingPlanTool } from "C:/Proyectos/eris/src/tools/TrainingPlanTool.ts";
import { defaultGym } from "C:/Proyectos/eris/src/services/forge/forgeCatalog.ts";

const mem = () => {
  const m = new Map<string, any>([
    ["body_profile", { weightKg: 85, sex: "h", age: 27, heightCm: 179, goal: "recomp" }],
    ["forge_projection", { day: "x", at: "", gym: defaultGym("smartfit"), e1rm: { press_banca_db: 32 }, experience: "principiante" }],
  ]);
  return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { m.set(k, v); }, getProfile: async () => ({ medical: { conditions: [{ id: "hypertension" }] } }) };
};

test("build_routine arma por código, la manda a la app y queda para ajustar", async () => {
  const memory = mem(); const sent: any[] = [];
  const ws = { send: (x: string) => sent.push(JSON.parse(x)) };
  const t = new TrainingPlanTool();
  const r = await t.execute({ action: "build_routine", days: 4, minutes: 60, goal: "hipertrofia" } as any, { memory, wsClient: ws });
  console.log(r.output.slice(0, 600));
  expect(r.error).toBeUndefined();
  expect(sent.map((x) => x.type)).toEqual(["forge_routine", "toji_save_routine"]);
  expect(sent[0].routine.split).toBe("torso_pierna");
  expect(sent[0].routine.source).toBe("eris");
  expect(sent[0].routine.notes.join(" ")).toContain("presión alta");
  expect(memory.m.get("forge_projection").routine.days.length).toBe(4);
  // falta días: pide preguntarlos
  expect(((await t.execute({ action: "build_routine" } as any, { memory, wsClient: ws })).metadata as any).quickReply).toContain("¿Cuántos días a la semana"); // ahora pregunta (2026-10-21)
  // cambiar un ejercicio por su nombre
  const first = sent[0].routine.days[0].items[0].exId;
  const { BASE_BY_ID } = await import("C:/Proyectos/eris/src/services/forge/forgeCore.ts");
  const name = BASE_BY_ID[first].name.toLowerCase();
  const a = await t.execute({ action: "adjust_routine", swapExercise: `el ${name}` } as any, { memory, wsClient: ws });
  console.log(a.output);
  expect(a.output).toContain("Cambié");
  // cambiar los días: vuelve a armar
  const b = await t.execute({ action: "adjust_routine", days: 3 } as any, { memory, wsClient: ws });
  expect(sent.filter((x) => x.type === "forge_routine").pop().routine.split).toBe("full");
  expect(b.output).toContain("ajustada");
});

test("apply_plan ya no acepta ids inventados", async () => {
  const memory = mem(); const sent: any[] = [];
  const r = await new TrainingPlanTool().execute({ action: "apply_plan", entries: [{ exerciseId: "jalon", targetSets: 3 }, { exerciseId: "remo_volador", targetSets: 3 }] } as any, { memory, wsClient: { send: (x: string) => sent.push(JSON.parse(x)) } });
  expect(sent[0].exercises).toEqual([{ id: "jalon", targetSets: 3 }]);
  expect(r.output).toContain("remo_volador");
});
