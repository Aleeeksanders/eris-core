// Eris administra (A2): el Plan de Eris agrega «⚖ Cuadra tu BCI (2 min)» cuando lo anotado y el banco no calzan
import { test, expect } from "bun:test";
process.env.TZ = "America/Santiago";
import { gatherDayPlanInput, buildDayPlan } from "C:/Proyectos/eris/src/services/DayPlan.ts";

const NOW = new Date(2026, 9, 30, 11, 0);
const mem = (fin: any) => {
  const m = new Map<string, any>([["financial_summary_latest", fin]]);
  return { get: async (k: string) => (m.has(k) ? m.get(k) : null), set: async () => {}, getProfile: async () => ({ name: "Alex", medical: { conditions: [] } }) };
};

test("con una cuenta que no calza: el paso de Plata «Cuadra tu …» (y sin ella, no)", async () => {
  const fin = { at: NOW.toISOString(), libre: 300000, porDia: 15000, cuadre: { noCalzan: 1, cuentas: [{ nombre: "BCI", estado: "calza", diff: 0, horas: 2 }, { nombre: "Santander", estado: "no_calza", diff: 11990, horas: 5 }], alertas: [] } };
  const i = await gatherDayPlanInput(mem(fin), NOW);
  expect(i.finance?.cuadre).toEqual({ nombre: "Santander", diff: 11990 });
  const p = buildDayPlan(i, "optimo");
  const s = p.pasos.find((x) => x.id === "plata-cuadre")!;
  expect(s.titulo).toBe("⚖ Cuadra tu Santander (2 min)");
  expect(s.detalle).toContain("$11.990");
  expect(s.accion).toEqual({ type: "cuadrar" });
  expect(p.pasos.some((x) => x.id === "plata")).toBe(true);
  const sin = await gatherDayPlanInput(mem({ ...fin, cuadre: { noCalzan: 0, cuentas: [], alertas: [] } }), NOW);
  expect(buildDayPlan(sin, "optimo").pasos.some((x) => x.id === "plata-cuadre")).toBe(false);
});
