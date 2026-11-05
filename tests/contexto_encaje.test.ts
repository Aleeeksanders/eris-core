// Que lo que se manda al modelo quepa (2026-11-05): Ollama recortaba el COMIENZO (instrucciones y herramientas) en ~1 de 4
import { test, expect } from "bun:test";
import { encajar, tokensDe, compactar, PRIORIDAD_HERRAMIENTAS } from "C:/Proyectos/eris/src/services/llm/ContextFit.ts";
import { ContextPlanner } from "C:/Proyectos/eris/src/services/llm/ContextPlanner.ts";

const SYS = { role: "system" as const, content: "INSTRUCCIONES ".repeat(900) }; // ~12 600 car, como las de Eris
const BRIEF = { role: "system" as const, content: "Números de hoy: 1.250 de 2.850 kcal, agua 1,4 de 2,8 L. ".repeat(38) };
const RESUMEN = { role: "system" as const, content: `[Contexto de conversación previa]\n${"Hablamos de su rutina. ".repeat(40)}` };
const tool = (name: string, n = 1500) => ({ name, description: `${"Para qué sirve y cuándo usarla. ".repeat(Math.round(n / 34))}`, inputSchema: { type: "object", properties: { action: { type: "string", enum: ["a", "b"], description: "Qué hacer con la herramienta, explicado con mucho detalle para el modelo. ".repeat(3) } } } });
const TOOLS = ["nutrition_tracker", "metabolic_advisor", "symptom_guide", "get_live_context", "day_plan", "day_agenda", "training_today", "sleep_log", "supplement_tracker", "carb_options", "lab_results", "web_search"].map((n) => tool(n));
const conv = (n: number) => Array.from({ length: n }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `Turno ${i}: ${"bla ".repeat(150)}` }));
const ACTUAL = { role: "user" as const, content: "Voy a hacer la cena" };
const O = { ctx: 8192, reserve: 700, ratio: 3.1 };

test("si cabe, no se toca nada", () => {
  const msgs = [SYS, { role: "user" as const, content: "hola" }];
  const r = encajar(msgs, TOOLS.slice(0, 2), O);
  expect(r.msgs).toEqual(msgs);
  expect(r.tools.length).toBe(2);
  expect(r.quitados).toEqual({ mensajes: 0, sistema: 0, herramientas: [], compactadas: false });
});

test("no cabe: las instrucciones, el mensaje actual y los números de hoy se quedan; cabe en el contexto", () => {
  const msgs = [SYS, RESUMEN, BRIEF, ...conv(16), ACTUAL];
  expect(tokensDe(msgs, TOOLS, 3.1)).toBeGreaterThan(8192); // antes se mandaba así y Ollama cortaba el comienzo
  const r = encajar(msgs, TOOLS, O);
  expect(r.cabe).toBe(true);
  expect(r.tokens).toBeLessThanOrEqual(8192 - 700);
  expect(r.msgs[0]).toBe(SYS);
  expect(r.msgs.at(-1)).toBe(ACTUAL);
  expect(r.msgs).toContain(BRIEF);
  expect(r.quitados.mensajes).toBeGreaterThan(0);
  // lo primero que se va es lo más viejo: el último intercambio sigue
  expect(r.msgs.some((m) => m.content.startsWith("Turno 15"))).toBe(true);
  expect(r.msgs.some((m) => m.content.startsWith("Turno 0"))).toBe(false);
});

test("las herramientas: primero se compactan, después se van las de menor prioridad; nunca las de la intención ni las usadas", () => {
  const msgs = [SYS, BRIEF, ACTUAL, { role: "assistant" as const, content: "", toolCalls: [{ id: "t1", name: "web_search", arguments: {} }] }, { role: "tool" as const, content: "resultado", toolCallId: "t1" }];
  const muchas = TOOLS.map((t) => tool(t.name, 4000));
  const r = encajar(msgs, muchas, { ...O, protegidas: new Set(["lab_results"]) });
  expect(r.cabe).toBe(true);
  expect(r.quitados.compactadas).toBe(true);
  const quedan = r.tools.map((t) => t.name);
  expect(quedan).toContain("lab_results"); // la eligió la intención
  expect(quedan).toContain("web_search"); // se usó en este turno
  expect(quedan).toContain("nutrition_tracker"); // la más útil
  for (const q of r.quitados.herramientas) expect(PRIORIDAD_HERRAMIENTAS.indexOf(q)).toBeGreaterThan(PRIORIDAD_HERRAMIENTAS.indexOf("get_live_context"));
});

test("compactar: descripciones cortas, parámetros en una línea; nombres, tipos y enum intactos", () => {
  const t = tool("training_plan", 2400);
  const c = compactar(t);
  expect(JSON.stringify(c).length).toBeLessThan(JSON.stringify(t).length * 0.4);
  expect(c.name).toBe("training_plan");
  expect((c.inputSchema as any).properties.action.enum).toEqual(["a", "b"]);
  expect(c.description.length).toBeLessThanOrEqual(321);
});

test("no deja resultados de herramienta huérfanos al sacar la conversación vieja", () => {
  const viejo = [
    { role: "user" as const, content: "x ".repeat(4000) },
    { role: "assistant" as const, content: "", toolCalls: [{ id: "v1", name: "nutrition_tracker", arguments: {} }] },
    { role: "tool" as const, content: "y ".repeat(4000), toolCallId: "v1" },
    { role: "assistant" as const, content: "listo" },
  ];
  const r = encajar([SYS, ...viejo, ...conv(4), ACTUAL], TOOLS.slice(0, 3), O);
  for (let i = 0; i < r.msgs.length; i++) if (r.msgs[i].role === "tool") expect(r.msgs[i - 1]?.toolCalls?.length).toBeGreaterThan(0);
});

test("si ni con lo mínimo cabe, lo dice (quien llama pide un contexto mayor)", () => {
  const gigante = { role: "user" as const, content: "z ".repeat(20000) };
  const r = encajar([SYS, gigante], TOOLS, O);
  expect(r.cabe).toBe(false);
  expect(r.msgs.at(-1)).toBe(gigante);
});

test("el planificador ya no aprende de envíos recortados (antes subía la razón y estimaba aún más corto)", () => {
  const p = new ContextPlanner(30 * 60_000, () => 1000);
  expect(p.charsPerToken).toBe(3.1);
  p.observe(40000, 8192, 8192); // recortado: Ollama reporta el contexto, no los tokens reales
  expect(p.charsPerToken).toBe(3.1);
  p.observe(30000, 9000, 12288); // entero: sí aprende
  expect(p.charsPerToken).not.toBe(3.1);
  expect(p.charsPerToken).toBeLessThanOrEqual(3.6);
});
