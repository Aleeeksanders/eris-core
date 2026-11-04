import { test, expect } from "bun:test";
import { FinanceTrackerTool } from "C:/Proyectos/eris/src/tools/FinanceTrackerTool.ts";
import { resolveFinanceOp } from "C:/Proyectos/eris/src/services/FinanceBridge.ts";
import { formatFinanceReply } from "C:/Proyectos/eris/src/services/FinanceReply.ts";

/** Teléfono falso: responde a cada finance_op con lo que devuelva `answer(op)`. */
function fakePhone(answer: (op: any) => any) {
  const sent: any[] = [];
  const ws: any = {
    data: { canFinance: true },
    send(raw: string) {
      const msg = JSON.parse(raw); sent.push(msg);
      if (msg.type === "finance_op") setTimeout(() => resolveFinanceOp(ws, { type: "finance_op_result", requestId: msg.requestId, result: answer(msg.op) }), 5);
    },
  };
  return { ws, sent };
}
function fakeMemory(init: Record<string, any> = {}) {
  const m = new Map(Object.entries(init));
  return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { m.set(k, v); }, _m: m };
}

test("preroute + execute: gasto con respuesta rápida y saldos reales", async () => {
  const tool = new FinanceTrackerTool();
  const memory = fakeMemory({ financial_context_latest: "  · BCI · Cuenta corriente (débito): $400.000\n" });
  const msg = "gasté 5 lucas en almuerzo con la BCI";
  const input = await tool.preroute(msg, { memory });
  expect(input).toMatchObject({ action: "gasto", monto: 5000, cuenta: "bci" });
  const { ws, sent } = fakePhone((op) => ({
    ok: true,
    data: { desc: op.descripcion, monto: op.monto, cat: "alimentacion", catLabel: "Provisiones", catIcon: "⚔️", fecha: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10),
      cuenta: { nombre: "BCI · Cuenta corriente", tipo: "debito", saldo: 395000 }, mesCat: { gastado: 185000, presup: 200000 } },
  }));
  const res = await tool.run(input!, { memory, wsClient: ws, userMessage: msg });
  expect(sent[0]).toMatchObject({ type: "finance_op", op: { action: "gasto", monto: 5000, descripcion: "Almuerzo", categoria: "alimentacion", cuenta: "bci" } });
  const q = (res.metadata as any).quickReply as string;
  expect(q).toContain("✅ Anotado en Finanzas: **Almuerzo** — $5.000 · ⚔️ Provisiones · desde BCI · Cuenta corriente.");
  expect(q).toContain("Te quedan $395.000 en BCI · Cuenta corriente.");
  expect(q).toContain("Ojo: Provisiones lleva $185.000 de $200.000 este mes (93 %).");
  expect((res.metadata as any).financeOk).toBe(true);
});

test("cuenta no encontrada → chips y la respuesta corta completa la operación", async () => {
  const tool = new FinanceTrackerTool();
  const memory = fakeMemory();
  const msg = "gasté 8 lucas en uber con la santander";
  const input = await tool.preroute(msg, { memory });
  let call = 0;
  const { ws, sent } = fakePhone((op) => {
    call++;
    if (call === 1) return { ok: false, code: "cuenta_no_encontrada", msg: 'No encontré la cuenta "santander"', opciones: ["Efectivo", "BCI · Cuenta corriente"], data: { campo: "cuenta" } };
    return { ok: true, data: { desc: op.descripcion, monto: op.monto, cat: "transporte", catLabel: "Desplazam.", catIcon: "🐉", fecha: "2026-09-30", cuenta: { nombre: "BCI · Cuenta corriente", tipo: "debito", saldo: 392000 } } };
  });
  const r1 = await tool.run(input!, { memory, wsClient: ws, userMessage: msg });
  const q1 = (r1.metadata as any).quickReply as string;
  expect(q1).toContain("Todavía no lo anoto");
  expect(q1).toContain("[Opción: BCI · Cuenta corriente]");
  expect((r1.metadata as any).financeOk).toBe(false);
  expect(r1.output).toContain("NO se anotó");

  // "gracias" no es una cuenta: no completa nada
  expect(await tool.preroute("gracias", { memory })).toBeNull();
  // El usuario toca el chip
  const input2 = await tool.preroute("BCI · Cuenta corriente", { memory });
  expect(input2).toMatchObject({ action: "gasto", monto: 8000, cuenta: "BCI · Cuenta corriente" });
  const r2 = await tool.run(input2!, { memory, wsClient: ws, userMessage: "BCI · Cuenta corriente" });
  expect((r2.metadata as any).quickReply).toContain("✅ Anotado en Finanzas: **Uber** — $8.000");
  expect(sent.length).toBe(2);
  expect(await memory.get("finance_pending")).toBeNull();
});

test("sin app (web) o sin respuesta del teléfono: nunca dice anotado", async () => {
  const tool = new FinanceTrackerTool();
  const r = await tool.run({ action: "gasto", monto: 5000, descripcion: "Pan" }, { memory: fakeMemory(), wsClient: { data: {}, send() {} }, userMessage: "gasté 5 lucas en pan" });
  expect((r.metadata as any).quickReply).toContain("pídemelo desde la app de Eris");
  expect(r.output).toContain("NO se anotó");
  const reply = formatFinanceReply({ action: "gasto", monto: 5000 }, { ok: false, code: "timeout", msg: "Finanzas no respondió a tiempo en el teléfono." });
  expect(reply).toBe("No pude anotarlo: Finanzas no respondió a tiempo en el teléfono. Abre la app de Eris y pídemelo de nuevo.");
});

test("mensaje mixto: sin respuesta rápida (lo redacta el modelo con el resultado)", async () => {
  const tool = new FinanceTrackerTool();
  const { ws } = fakePhone((op) => ({ ok: true, data: { desc: "Pan", monto: 2000, cat: "alimentacion", catLabel: "Provisiones", catIcon: "⚔️", fecha: "2026-09-30" } }));
  const r = await tool.run({ action: "gasto", monto: 2000, descripcion: "Pan" }, { memory: fakeMemory(), wsClient: ws, userMessage: "gasté 2 lucas en pan y me duele la cabeza" });
  expect((r.metadata as any).quickReply).toBeUndefined();
  expect(r.output).toContain("Operación aplicada en Finanzas");
});

test("respuestas de cada acción", () => {
  const acc = (nombre: string, tipo: any, saldo: number, cupo?: number) => ({ nombre, tipo, saldo, ...(cupo ? { cupo } : {}) });
  expect(formatFinanceReply({ action: "prestamo" }, { ok: true, data: { persona: "Juan", monto: 10000, devolucion: "2026-10-02", cuenta: acc("Efectivo", "efectivo", 5000) } }))
    .toBe("📋 Anotado: le prestaste $10.000 a Juan desde Efectivo. Te lo devuelve el 2 oct.\nTe quedan $5.000 en Efectivo.");
  expect(formatFinanceReply({ action: "cobro" }, { ok: true, data: { persona: "Juan", monto: 5000, parcial: true, restante: 5000, cuenta: acc("Efectivo", "efectivo", 10000) } }))
    .toBe("✓ Juan te devolvió $5.000; todavía te debe $5.000.\nVolvió a Efectivo: ahora tienes $10.000.");
  expect(formatFinanceReply({ action: "pago_tarjeta" }, { ok: true, data: { monto: 100000, desde: acc("BCI", "debito", 300000), hacia: acc("CMR", "credito", 800000, 800000), deuda: 0 } }))
    .toBe("💳 Pagaste $100.000 de CMR desde BCI. Quedó sin deuda. 🎉\nTe quedan $300.000 en BCI.");
  // 2026-10-22: sin «rango de ahorro» por sueldo mínimo (la app ya no lo muestra): el avance de sus metas, como en Plan
  expect(formatFinanceReply({ action: "ahorro" }, { ok: true, data: { desc: "Viaje", monto: 50000, ahorroAcum: 300000, metas: [{ desc: "Viaje", target: 500000, pct: 60 }], tier: { id: "D", siguiente: "C", falta: 720000 } } }))
    .toBe("💰 Ahorro anotado: $50.000 para viaje. Llevas $300.000 ahorrados.\n🏁 Meta «Viaje»: 60 % (te faltan $200.000).");
  expect(formatFinanceReply({ action: "sin_fondos" as any }, { ok: false, code: "sin_fondos", msg: "Saldo insuficiente en Efectivo (tiene $2.000)", opciones: ["BCI"] }))
    .toBe("No lo anoté: Saldo insuficiente en Efectivo (tiene $2.000). ¿Lo pagaste con otra?\n[Opción: BCI]");
});
