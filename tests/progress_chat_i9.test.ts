// Fase I9: «¿cómo voy en el gym?» también trae los parámetros atléticos (del teléfono, con el bono de sus clases).
import { test, expect } from "bun:test";
import { TrainingPlanTool } from "C:/Proyectos/eris/src/tools/TrainingPlanTool.ts";
import { PROJECTION_KEY } from "C:/Proyectos/eris/src/services/TrainingIntent.ts";

test("get_progress nombra sus parámetros y sus clases", async () => {
  const mem = new Map<string, any>([[PROJECTION_KEY, { day: "2026-10-23", at: new Date().toISOString(), progress: {
    score: 40, scoreTrend: 2, missing: [], month: { sessions: 10, prev: 8, bestWeek: 3, streak: 4 }, records: [], vs3m: null, lifts: [],
    athletic: { params: [{ label: "Potencia", value: 29, boost: 0.13 }, { label: "Velocidad", value: 48, boost: 0.12 }], classes: ["muay_thai", "boxeo"] },
  } }]]);
  const memory = { get: async (k: string) => mem.get(k) ?? null, set: async () => {}, getProfile: async () => null };
  const r = await new TrainingPlanTool().execute({ action: "get_progress" } as any, { memory });
  expect(r.output).toContain("Parámetros atléticos (0–100, de lo que entrena en 4 semanas, con el bono de Muay Thai + Boxeo): Potencia 29, Velocidad 48.");
});
