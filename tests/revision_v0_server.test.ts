// Revisión V0 (servidor): S1 claves de memoria que no salen del perfil · H1 la guía de síntomas antes que cualquier atajo
process.env.TZ = "America/Santiago";
import { test, expect } from "bun:test";



import { QueryEngine } from "C:/Proyectos/eris/src/QueryEngine.ts";
import { ToolRegistry } from "C:/Proyectos/eris/src/tools.ts";
import { createMessage } from "C:/Proyectos/eris/src/types/message.ts";
import { claveSegura, FileSystemAdapter } from "C:/Proyectos/eris/src/memory.ts";
import { DayPlanTool } from "C:/Proyectos/eris/src/tools/DayPlanTool.ts";
import { DayAgendaTool } from "C:/Proyectos/eris/src/tools/DayAgendaTool.ts";
import { InventoryTrackerTool } from "C:/Proyectos/eris/src/tools/InventoryTrackerTool.ts";
import { SymptomGuideTool } from "C:/Proyectos/eris/src/tools/SymptomGuideTool.ts";

test("S1: una clave de memoria es un nombre, nunca una ruta", async () => {
  expect(claveSegura("hydration_log_Sat Oct 31 2026")).toBe("hydration_log_Sat Oct 31 2026");
  expect(claveSegura("pref_auto_prefs")).toBe("pref_auto_prefs");
  for (const k of ["../otro/kv_x", "x/../../roles", "a\\b", "..", "", "x".repeat(200)]) expect(() => claveSegura(k)).toThrow();
  // set con una clave mala no escribe nada (se rechaza antes de armar la ruta) y no revienta
  const mem: any = new FileSystemAdapter("perfil_prueba_s1", "1234");
  await expect(mem.set("pref_../../roles", { pwned: true })).resolves.toBeUndefined();
  await expect(mem.get("pref_../../roles")).rejects.toThrow();
});

const memoria = () => {
  const m = new Map<string, any>();
  return { get: async (k: string) => (m.has(k) ? m.get(k) : null), set: async (k: string, v: any) => { m.set(k, v); }, getProfile: async () => ({ name: "Alex", medical: { conditions: [] } }), getDailyRollupLog: async () => [] };
};
async function quien(msg: string) {
  let modelo = 0;
  const model = { async generate() { modelo++; return { content: "respuesta del modelo", toolCalls: [] }; } } as any;
  // El orden real de registro: plan, agenda e inventario antes que la guía de síntomas
  const reg = new ToolRegistry([new DayPlanTool(), new DayAgendaTool(), new InventoryTrackerTool(), new SymptomGuideTool()] as any);
  const eng = new QueryEngine(model, reg, "SYS", {});
  const corrio: string[] = [];
  await eng.query(msg, [createMessage("user", msg)], { onToolCall: (tc: any) => corrio.push(tc.name) } as any, null, "flash", { memory: memoria(), role: "ikaros" } as any);
  return corrio[0] ?? (modelo ? "modelo" : "nada");
}

test("H1: con una señal de alarma (o una pregunta por un síntoma), primero la guía de síntomas", async () => {
  expect(await quien("¿Qué me recomiendas? Me duele el pecho y el brazo izquierdo")).toBe("symptom_guide");
  expect(await quien("¿Qué hago hoy con este dolor de espalda?")).toBe("symptom_guide");
  expect(await quien("¿Tengo un infarto? me duele mucho el pecho")).toBe("symptom_guide");
  // Lo de siempre sigue igual
  expect(await quien("¿Qué me recomiendas hoy?")).toBe("day_plan");
  expect(await quien("¿Qué tengo hoy?")).toBe("day_agenda");
});
