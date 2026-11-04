// training_plan get_progress (F6): lee el progreso que manda el teléfono (progressContext) y el router lo activa.
import { test, expect } from "bun:test";
import { TrainingPlanTool } from "C:/Proyectos/eris/src/tools/TrainingPlanTool.ts";
import { sanitizeProjection } from "C:/Proyectos/eris/src/services/TrainingIntent.ts";
import { routeTools, TOOL_GROUP } from "C:/Proyectos/eris/src/services/ToolRouter.ts";
import * as C from "C:/Proyectos/eris/src/services/forge/forgeCore.ts";
import * as P from "C:/Proyectos/eris/src/services/forge/forgeProgress.ts";

const ago = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

test("get_progress: cifras del teléfono, sin inventar si no hay", async () => {
  let s = C.newState(); s.bodyKg = 85; s.sex = "h";
  for (let w = 16; w >= 0; w--) for (let k = 0; k < 3; k++) s = C.logSet(s, ago(w * 7 + 1), "press_banca", { reps: 5, kg: 60 + (16 - w) * 2.5, rir: 2 });
  const proj = sanitizeProjection({ day: ago(0), progress: P.progressContext(s) })!;
  expect(proj.progress.records.length).toBeGreaterThan(0);
  const m = new Map<string, any>([["forge_projection", proj]]);
  const memory = { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { m.set(k, v); } };
  const t = new TrainingPlanTool();
  const r = await t.execute({ action: "get_progress" } as any, { memory });
  console.log(r.output);
  expect(r.output).toContain("Score de fuerza:");
  expect(r.output).toContain("Hace 3 meses → hoy");
  expect(r.output).toContain("Press de banca");
  expect(r.output).toContain("100 kg × 5");
  const empty = await t.execute({ action: "get_progress" } as any, { memory: { get: async () => null, set: async () => {} } });
  expect(empty.output).toContain("No inventes cifras");
});

test("el router muestra training_plan con «¿cómo voy en el gym?», récords o fuerza", () => {
  for (const msg of ["¿cómo voy en el gym?", "cuáles son mis récords", "cuánto levanto en press de banca", "cómo va mi fuerza"]) {
    const r = routeTools(msg, [], Object.keys(TOOL_GROUP));
    expect([...r.tools].includes("training_plan")).toBe(true);
  }
});
