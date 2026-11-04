// Eris administra (A2): el saldo de una captura de la app del banco (armarSaldos) y el esquema del chat
import { test, expect } from "bun:test";
import { armarSaldos } from "C:/Proyectos/eris/src/services/ReceiptOcr.ts";
import { FinanceTrackerTool } from "C:/Proyectos/eris/src/tools/FinanceTrackerTool.ts";

const L = (...xs: string[]) => ({ ok: true, lines: xs.map((text) => ({ text, words: [] })) }) as any;

test("captura: saldo disponible primero; la línea de crédito y el cupo no son saldo; los 4 dígitos", () => {
  const r: any = armarSaldos(L("Cuenta Corriente ****1234", "Saldo disponible", "$412.300", "Saldo contable $420.000", "Línea de crédito disponible $500.000", "Cupo disponible $800.000", "Últimos movimientos", "Compra LIDER -$12.990"));
  expect(r.ok).toBe(true);
  expect(r.saldos).toEqual([{ etiqueta: "Saldo disponible", monto: 412300 }, { etiqueta: "Saldo contable", monto: 420000 }]);
  expect(r.last4).toEqual(["1234"]);
  expect((armarSaldos(L("Hola", "Compra $5.000")) as any).ok).toBe(false);
});

test("el chat valida las operaciones nuevas", async () => {
  const t = new FinanceTrackerTool();
  expect(t.inputSchema.safeParse({ action: "cuadre", aplicar: "mejor", cuenta: "bci" }).success).toBe(true);
  expect(t.inputSchema.safeParse({ action: "saldo_banco", monto: 412000, cuenta: "bci" }).success).toBe(true);
  expect(await t.preroute("mi BCI tiene 412 lucas", {})).toEqual({ action: "saldo_banco", monto: 412000, cuenta: "bci" });
  const sinTel = await t.execute({ action: "cuadre" } as any, { userMessage: "¿mis finanzas calzan?" });
  expect(sinTel.output).toContain("NO se anotó");
});
