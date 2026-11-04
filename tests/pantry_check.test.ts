// Despensa (2026-10-21): una lista de alimentos sí; una frase («voy bien con el agua, estoy en el trabajo…») no.
import { test, expect } from "bun:test";
import { MetabolicAdvisorTool } from "C:/Proyectos/eris/src/tools/MetabolicAdvisorTool.ts";
const mk = () => { const m = new Map<string, any>([["advisor_pending", { focus: "comida", awaiting: "pantry", at: new Date().toISOString() }]]); return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { m.set(k, v); } }; };
const ASK = "¿Qué tienes a mano para comer?";
test("listas de lo que tiene: despensa", async () => {
  const t = new MetabolicAdvisorTool();
  for (const msg of ["Tengo yogur, una manzana y avena", "Osea, tengo pollo, chuleta de cerdo, queso, pan castaño y pan normal", "arroz, 2 huevos y tomates"]) {
    const r: any = await t.preroute(msg, { memory: mk(), lastAssistantMessage: ASK });
    expect(r?.pantry).toBe(msg);
  }
});
test("frases que no son una despensa", async () => {
  const t = new MetabolicAdvisorTool();
  const r: any = await t.preroute("Voy bien en la línea de agua, y lo otro es que estoy en el trabajo, así que no puedo cocinar", { memory: mk(), lastAssistantMessage: ASK });
  expect(r).toMatchObject({ no_cook: true, no_pantry: true, ideas: true });
  expect(r.pantry).toBeUndefined();
  const r2: any = await t.preroute("voy bien con el agua", { memory: mk(), lastAssistantMessage: ASK });
  expect(r2?.pantry).toBeUndefined();
});
test("pedidos de snack / fibra / sin cocinar", async () => {
  const t = new MetabolicAdvisorTool();
  const m = { get: async () => null, set: async () => {} };
  expect(await t.preroute("Recomiendame un snack con fibra que no se pase de mis calorías", { memory: m })).toMatchObject({ ideas: true, snack: true, fiber: true });
  expect(await t.preroute("Voy a salir, dame algo de bajas calorías y que tenga fibra, pero que me deje espacio para la once/cena", { memory: m })).toMatchObject({ snack: true, no_cook: true, fiber: true });
});

test("«estoy en el trabajo» después de las opciones: las mismas ideas, sin cocinar; un snack no hereda «antes de entrenar»", async () => {
  const t = new MetabolicAdvisorTool();
  const m = new Map<string, any>([["advisor_intent", { focus: "pre_entreno", minutes: 60, at: new Date().toISOString() }]]);
  const memory = { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { m.set(k, v); } };
  const r: any = await t.preroute("Estoy en el trabajo, así que no puedo cocinar", { memory, lastAssistantMessage: "La mejor opción es la Opción 1… **Opción 1** ⭐" });
  expect(r).toMatchObject({ no_cook: true, no_pantry: true, ideas: true });
  const s: any = await t.preroute("Recomiéndame un snack con fibra", { memory, lastAssistantMessage: "" });
  expect(s.focus).toBe("comida");
  expect(s).toMatchObject({ snack: true, fiber: true });
});
