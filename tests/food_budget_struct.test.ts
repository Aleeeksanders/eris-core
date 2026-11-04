// F5: el asesor de comida usa el presupuesto de comida como dato (resumen del núcleo), con el texto como respaldo.
import { test, expect } from "bun:test";
import { foodBudgetFromSummary, parseFoodBudget } from "C:/Proyectos/eris/src/services/MetabolicAnalysis.ts";

const NOW = new Date(2026, 9, 15, 13, 0); // quedan 17 días de octubre (con hoy)

test("del resumen estructurado: la misma cifra por día que la app", () => {
  const sm = { at: new Date(2026, 9, 15, 9).toISOString(), disponible: 300000, presupuesto: [
    { cat: "entretenimiento", presup: 60000, gastado: 25000, queda: 35000, porDia: 2059, estado: "al_dia" },
    { cat: "alimentacion", presup: 250000, gastado: 120000, queda: 130000, porDia: 7647, estado: "al_dia" },
  ] };
  expect(foodBudgetFromSummary(sm, NOW)).toEqual({ spent: 120000, budget: 250000, remaining: 130000, disponible: 300000, daysLeft: 17, perDay: 7647, perDayBasis: "presupuesto", tier: 2 });
  // de otro día del mes: se recalcula por día con los días que quedan hoy
  const ayer = { ...sm, at: new Date(2026, 9, 14, 20).toISOString() };
  expect(foodBudgetFromSummary(ayer, NOW)?.perDay).toBe(Math.round(130000 / 17));
});

test("sin dato útil: null (y se usa el texto como antes)", () => {
  expect(foodBudgetFromSummary(null, NOW)).toBeNull();
  expect(foodBudgetFromSummary({ at: new Date(2026, 8, 30).toISOString(), presupuesto: [{ cat: "alimentacion", presup: 1, gastado: 0, queda: 1, porDia: 1 }] }, NOW)).toBeNull(); // del mes pasado
  expect(foodBudgetFromSummary({ at: NOW.toISOString(), presupuesto: [{ cat: "transporte", presup: 50000 }] }, NOW)).toBeNull();      // sin tope de comida
  const txt = "- Gastos octubre 2026: $200.000\n  · Alimentacion: $120.000 / $250.000 presup (48%)\n- Disponible: $300.000\n";
  expect(parseFoodBudget(txt, NOW).budget?.perDay).toBe(Math.round(130000 / 17));
});
