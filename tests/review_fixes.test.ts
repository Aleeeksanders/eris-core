// Revisión de las fases I0–I9 (2026-10-23): los bugs encontrados, con su prueba.
import { test, expect } from "bun:test";
import * as I from "C:/Proyectos/eris-mobile/src/services/inventory/inventoryCore.ts";
import { respuestaAntojo, PENDIENTE_KEY } from "C:/Proyectos/eris/src/services/Antojo.ts";

const ctxAt = (now: Date) => { let id = 1000; return { now, newId: () => ++id }; };

test("Inventario: el bocado de las 00:15 de quien trasnocha no vuelve a la despensa a la mañana siguiente", () => {
  const W = I.emptyState();
  const c0 = ctxAt(new Date(2026, 9, 23, 20));
  const huevos = I.agregar(W, { nombre: "Huevos", cantidad: 12 }, c0).id!;
  I.procesarComidas(W, [], c0, "Fri Oct 23 2026"); // se activa
  // 00:15 del sábado, sigue despierto: su día de comida sigue siendo el viernes
  const noche = ctxAt(new Date(2026, 9, 24, 0, 15));
  const snack = { key: "k1", name: "Huevo entero", grams: 110, at: noche.now.toISOString() };
  expect(I.procesarComidas(W, [snack], noche, "Fri Oct 23 2026").descontadas.length).toBe(1);
  expect(W.items.find((i) => i.id === huevos)!.cantidad).toBe(10);
  // a la mañana: su día de comida es el sábado y el snack no está en «hoy», pero NO se borró
  const manana = ctxAt(new Date(2026, 9, 24, 9));
  expect(I.procesarComidas(W, [], manana, "Sat Oct 24 2026").devueltas).toBe(0);
  expect(W.items.find((i) => i.id === huevos)!.cantidad).toBe(10);
  // borrado de verdad el mismo día de comida: vuelve
  const W2 = I.emptyState();
  const h2 = I.agregar(W2, { nombre: "Huevos", cantidad: 12 }, c0).id!;
  I.procesarComidas(W2, [], c0, "Fri Oct 23 2026");
  I.procesarComidas(W2, [snack], noche, "Fri Oct 23 2026");
  expect(I.procesarComidas(W2, [], ctxAt(new Date(2026, 9, 24, 1)), "Fri Oct 23 2026").devueltas).toBe(1);
  expect(W2.items.find((i) => i.id === h2)!.cantidad).toBe(12);
  // el estado guardado conserva el día (hidratar)
  expect(I.normalizar(JSON.parse(JSON.stringify(W))).nutri?.dias).toEqual({ k1: "Fri Oct 23 2026" });
});

test("Antojo: «hecho, ya entrené» o «paso por el súper» no responden al trato", async () => {
  const mem = new Map<string, any>([[PENDIENTE_KEY, { said: "x", kcal: 500, contra: {}, strict: false, dia: "2026-10-23", at: new Date().toISOString() }]]);
  const memory = { get: async (k: string) => mem.get(k) ?? null, set: async (k: string, v: any) => { mem.set(k, v); } };
  expect(await respuestaAntojo(memory, "hecho, ya entrené")).toBeNull();
  expect(await respuestaAntojo(memory, "paso por el súper después")).toBeNull();
  expect((await respuestaAntojo(memory, "Hecho"))?.accept).toBe(true);
  expect((await respuestaAntojo(memory, "Paso, gracias"))?.accept).toBe(false);
  expect((await respuestaAntojo(memory, "Sí, acepto"))?.accept).toBe(true);
});

test("«carga mi rutina»: verbos de pedido, no cualquier forma", async () => {
  const { MD_ROUTINE_ASK } = await import("C:/Proyectos/eris/src/tools/TrainingPlanTool.ts");
  const f = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const t of ["Carga mi rutina", "¿puedes cargar mi rutina?", "usa mi rutina escrita", "convierte mi rutina en plan"]) expect(MD_ROUTINE_ASK.test(f(t))).toBe(true);
  for (const t of ["¿ya usaste la rutina de ayer?", "pasaste la rutina?", "leíste mi rutina?", "ármame una rutina"]) expect(MD_ROUTINE_ASK.test(f(t))).toBe(false);
});

test("Rutina escrita: cambiar un ejercicio o los días por chat no reemplaza tu texto", async () => {
  const { TrainingPlanTool } = await import("C:/Proyectos/eris/src/tools/TrainingPlanTool.ts");
  const { PROJECTION_KEY } = await import("C:/Proyectos/eris/src/services/TrainingIntent.ts");
  const FM = await import("C:/Proyectos/eris/src/services/forge/forgeMdRoutine.ts");
  const FC = await import("C:/Proyectos/eris/src/services/forge/forgeCore.ts");
  const MD = "Día 1: Empuje (Lunes)\n· Press de banca: 4 series x 6-8 reps.\n· Elevaciones laterales: 3 series x 12 reps.";
  const s = FC.newState();
  const { routine } = FM.mdToRoutine(s, FM.parseRoutineMd(s, MD));
  const mem = new Map<string, any>([["toji_routine_md", { md: MD, name: "mía" }], [PROJECTION_KEY, { day: "", at: "", routine }]]);
  const memory = { get: async (k: string) => mem.get(k) ?? null, set: async (k: string, v: any) => { mem.set(k, v); }, getProfile: async () => null };
  const sent: any[] = [];
  const wsClient = { send: (x: string) => sent.push(JSON.parse(x)) };
  const tool = new TrainingPlanTool();
  const r1 = await tool.execute({ action: "adjust_routine", swapExercise: "elevaciones laterales" } as any, { memory, wsClient });
  expect(r1.output).toMatch(/^✅ Cambié/);
  expect(mem.get("toji_routine_md").md).toBe(MD);
  expect(sent.find((m) => m.type === "forge_routine").routine.source).toBe("md");
  expect(sent.some((m) => m.type === "toji_save_routine")).toBe(false);
  const r2 = await tool.execute({ action: "adjust_routine", days: 4 } as any, { memory, wsClient });
  expect(r2.output).toMatch(/no la rearmo encima/);
  expect(mem.get("toji_routine_md").md).toBe(MD);
});

test("Búsqueda web por código: preguntas que mejoran con la web (y «sí porfa» tras una de ellas)", async () => {
  const { WebSearchTool } = await import("C:/Proyectos/eris/src/tools/WebSearchTool.ts");
  const t = new WebSearchTool();
  const q = async (m: string, ctx: any = {}) => ((await t.preroute(m, ctx)) as any)?.query ?? null;
  expect(await q("Para hacer básquet, ¿qué zapatillas debo usar?")).toBe("Para hacer básquet, qué zapatillas debo usar");
  expect(await q("¿Cuáles son las mejores zapatillas para correr?")).not.toBeNull();
  expect(await q("Busca en internet el horario del metro")).not.toBeNull();
  expect(await q("Sí porfa", { lastUserMessage: "Para hacer básquet, ¿qué zapatillas debo usar?", lastAssistantMessage: "¿Quieres que te recomiende algo?" })).toContain("zapatillas");
  expect(await q("Sí porfa", { lastUserMessage: "Para hacer básquet, ¿qué zapatillas debo usar?", lastAssistantMessage: "Busca suela de caucho." })).toContain("zapatillas");
  // lo tuyo, lo que no necesita la web, o sin pregunta antes: no
  for (const m of ["¿Qué como ahora?", "¿Cuánta plata tengo?", "¿Qué es el colesterol?", "¿Cuánto es 15 por 4?", "¿Qué me falta comprar?", "Hola Eris"]) expect(await q(m)).toBeNull();
  expect(await q("Sí porfa", { lastUserMessage: "¿Qué como ahora?", lastAssistantMessage: "¿Te armo algo?" })).toBeNull();
});
