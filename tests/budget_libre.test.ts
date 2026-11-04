// Presupuesto de comida sin tope en Finanzas: lo que queda hasta el próximo ingreso, no el «disponible del mes» (2026-10-21).
import { test, expect } from "bun:test";
import { parseFoodBudget } from "C:/Proyectos/eris/src/services/MetabolicAnalysis.ts";
const TXT = "\n## Finanzas del Usuario (Hunter Wallet):\n- Sueldo esperado: $1.000.000 líquido — este mes llegaron $200.000\n- Gastos octubre 2026: $140.000\n  · Otros: $80.000\n  · Alimentacion: $30.000\n- Disponible del mes: $860.000 (ingresos del mes, contando lo que aún no llega, menos lo gastado; NO es plata a mano)\n- Plata a mano (efectivo + débito): $60.000\n- Para gastar hasta el próximo ingreso (Sueldo (saldo), en 10 días): $60.000 (~$6.000 por día)\n";
test("sin tope de comida: un tercio de lo que queda hasta el sueldo", () => {
  const r = parseFoodBudget(TXT, new Date(2026, 9, 21));
  expect(r.budget?.perDayBasis).toBe("libre");
  expect(r.budget?.daysLeft).toBe(10);
  expect(r.budget?.perDay).toBe(Math.round(60000 / 10 / 3));
  expect(r.budget?.tier).toBe(1);
});
test("la etiqueta vieja («Disponible:») se sigue leyendo", () => {
  const r = parseFoodBudget("- Gastos octubre 2026: $1\n  · Alimentacion: $1.000 / $100.000 presup (1%)\n- Disponible: $500.000\n", new Date(2026, 9, 21));
  expect(r.budget?.perDayBasis).toBe("presupuesto");
  expect(r.budget?.disponible).toBe(500000);
});
