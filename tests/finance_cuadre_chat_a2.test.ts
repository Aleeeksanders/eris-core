// Eris administra (A2): el chat del cuadre — «¿mis finanzas calzan?», «mi BCI tiene 412 lucas», «arregla mi BCI»
process.env.TZ = "America/Santiago";
import { test, expect } from "bun:test";
import { parseFinanceMessage } from "C:/Proyectos/eris/src/services/FinanceParse.ts";
import { formatFinanceReply } from "C:/Proyectos/eris/src/services/FinanceReply.ts";

const P = (s: string, accountNames: string[] = ["BCI · Cuenta corriente", "Santander"]) => parseFinanceMessage(s, { accountNames, now: new Date(2026, 9, 30, 12) });

test("¿calza? (preguntas y órdenes)", () => {
  expect(P("¿mis finanzas calzan?")).toEqual({ action: "cuadre" });
  expect(P("¿calza mi bci con el banco?")).toEqual({ action: "cuadre", cuenta: "bci" });
  expect(P("cuadra mis finanzas")).toEqual({ action: "cuadre", aplicar: "mejor" });
  expect(P("Arregla mi BCI")).toEqual({ action: "cuadre", cuenta: "bci", aplicar: "mejor" });
  expect(P("Ajusta mi Santander al banco")).toEqual({ action: "cuadre", cuenta: "santander", aplicar: "ajuste" });
  expect(P("ajusta mi bci al saldo del banco")).toEqual({ action: "cuadre", cuenta: "bci", aplicar: "ajuste" });
  expect(P("¿por qué no me cuadran las cuentas?")?.action).toBe("cuadre");
});

test("«mi BCI tiene 412 lucas» y parecidos: el saldo que dice el banco", () => {
  expect(P("mi BCI tiene 412 lucas")).toEqual({ action: "saldo_banco", monto: 412000, cuenta: "bci" });
  expect(P("en el santander tengo 1,2 palos")).toEqual({ action: "saldo_banco", monto: 1200000, cuenta: "santander" });
  expect(P("tengo 20 lucas en efectivo")).toEqual({ action: "saldo_banco", monto: 20000, cuenta: "efectivo" });
  expect(P("el banco dice que tengo $412.300")).toEqual({ action: "saldo_banco", monto: 412300 });
  expect(P("mi saldo en la bci es 412.300")).toEqual({ action: "saldo_banco", monto: 412300, cuenta: "bci" });
  expect(P("me quedan 35 lucas en la cuenta rut")?.action).toBe("saldo_banco");
});

test("lo de antes sigue igual (no es un saldo del banco)", () => {
  expect(P("¿cuánto tengo en el bci?")?.action).toBe("resumen");
  expect(P("¿cuánta plata tengo?")?.action).toBe("resumen");
  expect(P("pagué 5 lucas con la bci")?.action).toBe("gasto");
  expect(P("me llegó el sueldo, 1.2 palos a la bci")?.action).toBe("abono");
  expect(P("transferí 50 lucas del bci al santander")?.action).toBe("transferencia");
  expect(P("saqué 20 lucas del bci")?.action).toBe("giro");
  expect(P("tengo que pagar 50 lucas")).toBeNull();
  expect(P("caminé 10 cuadras")).toBeNull();
  expect(P("le debo 20 lucas al banco")).toBeNull();
  expect(P("pagué 5 lucas con la bci, me quedan 300 lucas")?.action).not.toBe("saldo_banco");
});

test("la respuesta: calza, no calza con lo que cree que es (y chips), sin dato, y lo arreglado", () => {
  const r = formatFinanceReply({ action: "cuadre" }, { ok: true, data: {
    cuentas: [
      { nombre: "BCI", estado: "calza", diff: 0, banco: 412300, libro: 412300, horas: 2, fuente: "aviso", explicacion: null, arreglable: false },
      { nombre: "Santander", estado: "no_calza", diff: 11990, banco: 288010, libro: 300000, horas: 5, fuente: "chat", explicacion: "Spotify ($11.990, 30 oct) está en «Por confirmar»", arreglable: true },
    ], sinDato: [], alertas: [] } } as any);
  expect(r).toContain("✓ BCI calza con el banco: $412.300 (hace 2 h).");
  expect(r).toContain("⚖ Santander no calza: el banco dice $288.010 (hace 5 h) y yo llevaba $300.000 ($11.990 de diferencia). Creo que spotify");
  expect(r).toContain("[Opción: Arregla mi Santander] [Opción: Ajusta mi Santander al banco]");
  const nada = formatFinanceReply({ action: "cuadre" }, { ok: true, data: { cuentas: [], sinDato: ["BCI"], alertas: [] } } as any);
  expect(nada).toContain("mi BCI tiene 412 lucas");
  const hecho = formatFinanceReply({ action: "cuadre", aplicar: "mejor", cuenta: "santander" }, { ok: true, data: { aplicado: "Anoté Spotify ($11.990)", cuentas: [{ nombre: "Santander", estado: "calza", diff: 0, banco: 288010, libro: 288010, horas: 0 }], alertas: [] } } as any);
  expect(hecho).toBe("🔧 Anoté Spotify ($11.990).\n✓ Santander calza con el banco: $288.010 (recién).");
  const pide = formatFinanceReply({ action: "saldo_banco", monto: 412000 }, { ok: false, code: "falta_cuenta", msg: "¿De qué cuenta es ese saldo?", opciones: ["BCI", "Santander"] } as any);
  expect(pide).toContain("[Opción: BCI]");
});
