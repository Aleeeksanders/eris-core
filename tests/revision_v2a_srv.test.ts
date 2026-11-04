// Revisión V2a (servidor): I3 los caminos que salían iguales; F2 el presupuesto de comida con «Comida»
process.env.TZ = "America/Santiago";
import { test, expect } from "bun:test";
import { resumenesDe, type DayPlan } from "C:/Proyectos/eris/src/services/DayPlan.ts";
import { parseFoodBudget } from "C:/Proyectos/eris/src/services/MetabolicAnalysis.ts";

const base = (mode: any, o: Partial<DayPlan> = {}): DayPlan => ({
  mode, day: "2026-10-29", creado: "", kcal: 2448, proteinG: 120, resumen: "2.448 kcal · Piernas y core · cama 23:45", avisos: [],
  pasos: [
    { id: "comida-almuerzo", modulo: "comida", hora: 13, titulo: "🍽️ Almuerzo", detalle: "x", accion: { type: "info" } },
    { id: "comida-cena", modulo: "comida", hora: 20, titulo: "🍽️ Cena", detalle: "x", accion: { type: "info" } },
    { id: "entreno", modulo: "entreno", hora: 19, titulo: "🏋️ Piernas y core", detalle: "Sentadilla…", accion: { type: "info" } },
  ] as any, ...o,
});
const I = (o: any = {}) => ({ diabetic: true, targets: { kcal: 2448, proteinG: 120, proteinMax: null, goal: "mantener" }, ...o }) as any;

test("I3: si Estricto y Óptimo salen iguales, se dice lo que los distingue", () => {
  const e = base("estricto", { proteinG: 132, pasos: [...base("x").pasos.slice(0, 2), { id: "entreno", modulo: "entreno", hora: 19, titulo: "🏋️ Piernas y core", detalle: "Sentadilla… Completa, como dice tu rutina.", accion: { type: "info" } }] as any });
  const o = base("optimo", { pasos: [...base("x").pasos, { id: "comida-colacion_pm", modulo: "comida", hora: 17, titulo: "Colación", detalle: "x", accion: { type: "info" } }] as any });
  const f = base("flexible", { resumen: "2.648 kcal con un gusto · Piernas y core (versión corta) · cama hasta las 00:45" });
  const r = resumenesDe(I(), [e, o, f]);
  expect(r[0]).toContain("132 g de proteína");
  expect(r[0]).toContain("la rutina completa");
  expect(r[0]).toContain("sin colación de la tarde");
  expect(r[1]).toContain("con colación de la tarde");
  expect(r[0]).not.toBe(r[1]);
  expect(r[2]).toBe(f.resumen); // el distinto queda igual
});

test("I3: si de verdad dan lo mismo, Estricto lo dice y por qué", () => {
  const r = resumenesDe(I(), [base("estricto"), base("optimo"), base("flexible", { resumen: "otro" })]);
  expect(r[0]).toBe("2.448 kcal · Piernas y core · cama 23:45 · hoy da lo mismo que Óptimo (con diabetes no te recorto calorías)");
  expect(r[1]).toBe("2.448 kcal · Piernas y core · cama 23:45");
  const r2 = resumenesDe(I({ diabetic: false }), [base("estricto"), base("optimo")]);
  expect(r2[0]).toContain("(tu objetivo no es bajar de peso)");
});

test("F2: el presupuesto de comida se lee con «Comida» (y con «Alimentacion» de apps viejas)", () => {
  const hoy = new Date(2026, 10, 4, 12);
  const nuevo = "## Finanzas del usuario:\n- Gastos noviembre 2026: $50.637\n  · Comida: $26.419 / $200.000 presup (13%)\n  · Ocio: $20.240\n";
  expect(parseFoodBudget(nuevo, hoy).budget?.spent).toBe(26419);
  expect(parseFoodBudget(nuevo, hoy).budget?.budget).toBe(200000);
  const viejo = "## Finanzas del Usuario (Hunter Wallet):\n- Gastos noviembre 2026: $50.637\n  · Alimentacion: $26.419 / $200.000 presup (13%)\n- Disponible: $10.000\n";
  expect(parseFoodBudget(viejo, hoy).budget?.spent).toBe(26419);
  // «Comida fuera y delivery» no es el gasto en comida del mes
  const fuera = "- Gastos noviembre 2026: $1\n- Comida fuera y delivery este mes: $9.999 en 2 compras\n- Para gastar hasta el próximo ingreso (Sueldo, en 3 días): $30.000 (~$10.000 por día)\n";
  expect(parseFoodBudget(fuera, hoy).budget?.spent).toBeUndefined();
});
