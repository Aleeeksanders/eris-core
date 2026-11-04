// Eris al timón · T1: el plan guardado y sus acciones (DayPlanService) y «comí lo del plan» por chat.
import { test, expect } from "bun:test";
process.env.TZ = "America/Santiago";
import { buildPlan, loadPlan, doneStep, swapPlan, undoPlan, previewPlans, entryFromStep } from "C:/Proyectos/eris/src/services/DayPlanService.ts";
import { DayPlanTool } from "C:/Proyectos/eris/src/tools/DayPlanTool.ts";

const fakeMemory = () => {
  const m = new Map<string, any>();
  m.set("inventory_backup_latest", null);
  return { m, get: async (k: string) => (m.has(k) ? m.get(k) : null), set: async (k: string, v: any) => { m.set(k, v); }, getProfile: async () => ({ medical: { conditions: [] } }) };
};
const fakeWs = () => { const sent: any[] = []; return { sent, send: (s: string) => sent.push(JSON.parse(s)) }; };

test("armar, «Lo comí» (anota tal cual una sola vez y avisa al teléfono), otra opción y borrar", async () => {
  const mem = fakeMemory(), ws = fakeWs();
  const modos = await previewPlans(mem);
  expect(modos.map((x) => x.mode)).toEqual(["estricto", "optimo", "flexible"]);
  const plan = await buildPlan(mem, "optimo");
  expect((await loadPlan(mem))!.mode).toBe("optimo");
  expect(mem.m.get("day_plan_mode")).toBe("optimo");
  const comida = plan.pasos.find((p) => p.accion.type === "log_food")!;
  expect(comida).toBeDefined();
  const e = entryFromStep(comida, new Date())!;
  expect(e.mealType).toBe((comida.accion as any).slot);
  expect(e.items.length).toBeGreaterThan(0);
  expect(e.totals.calories).toBe(e.items.reduce((a, x) => a + x.calories, 0));
  const r = (await doneStep(mem, ws, comida.id))!;
  expect(r.logged).not.toBeNull();
  expect(r.plan.pasos.find((p) => p.id === comida.id)!.hecho).toBe(true);
  const logKey = [...mem.m.keys()].find((k) => k.startsWith("nutrition_log_"))!;
  expect(mem.m.get(logKey).length).toBe(1);
  expect(ws.sent.some((x) => x.type === "nutrition_logged" && x.entry.mealType === e.mealType)).toBe(true);
  // dos toques no anotan dos veces
  expect((await doneStep(mem, ws, comida.id))!.logged).toBeNull();
  expect(mem.m.get(logKey).length).toBe(1);
  // rearmar con otro camino conserva lo hecho que no es comida (la comida rehecha ya considera lo comido)
  const otro = await buildPlan(mem, "estricto");
  expect(otro.mode).toBe("estricto");
  const sw = await swapPlan(mem, "cena");
  if (sw) expect((sw.paso.accion as any).alt).toBe(1);
  expect((await undoPlan(mem))!.mode).toBe("estricto");
  expect(await loadPlan(mem)).toBeNull();
});

test("chat: «comí lo del plan» anota la comida que toca y el teléfono se entera", async () => {
  const mem = fakeMemory(), ws = fakeWs();
  const tool = new DayPlanTool();
  expect(await tool.preroute("comí lo del plan", { memory: mem })).toBeNull(); // sin plan, no es suyo
  await buildPlan(mem, "optimo");
  expect(await tool.preroute("Comí lo del plan", { memory: mem })).toEqual({ action: "done" });
  expect(await tool.preroute("listo, almorcé lo que me dijiste", { memory: mem })).toEqual({ action: "done" });
  expect(await tool.preroute("me comí la cena del plan", { memory: mem })).toEqual({ action: "done", slot: "cena" });
  const out = await tool.execute({ action: "done" } as any, { memory: mem, wsClient: ws });
  expect(out.output).toMatch(/^✅ Anoté (el|la) .+ del plan tal cual/);
  expect(ws.sent.some((x) => x.type === "day_plan" && x.plan)).toBe(true);
  expect(ws.sent.some((x) => x.type === "nutrition_logged")).toBe(true);
  // armar por chat le llega al teléfono para aplicarlo
  const ws2 = fakeWs();
  await tool.execute({ action: "build", mode: "flexible" } as any, { memory: mem, wsClient: ws2 });
  expect(ws2.sent.find((x) => x.type === "day_plan")).toMatchObject({ aplicar: true });
});
