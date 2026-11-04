// «¿Y si me compro…?»: lector (FinanceParse.parseFinanceWhatIf), núcleo (simularCompra) y herramienta (finance_tracker simular)
import { test, expect } from "bun:test";
import { parseFinanceWhatIf, parseFinanceMessage, categoryFor } from "C:/Proyectos/eris/src/services/FinanceParse.ts";
import * as C from "C:/Proyectos/eris/src/services/FinanceCore.ts";
import { saveFinanceBackup } from "C:/Proyectos/eris/src/services/FinanceBackup.ts";
import { FinanceTrackerTool } from "C:/Proyectos/eris/src/tools/FinanceTrackerTool.ts";

const NOW = new Date(2026, 9, 15, 14, 0); // jue 15 oct 2026

test("lector: qué piensa comprar, cuánto, en cuotas, con qué", () => {
  expect(parseFinanceWhatIf("¿y si me compro unas zapatillas de 60 lucas?")).toEqual({ action: "simular", monto: 60000, descripcion: "Zapatillas" });
  expect(parseFinanceWhatIf("¿puedo gastar 20 lucas en un carrete?")).toEqual({ action: "simular", monto: 20000, descripcion: "Carrete", categoria: "entretenimiento" });
  expect(parseFinanceWhatIf("¿me alcanza para un celular de 300 lucas en 6 cuotas?")).toEqual({ action: "simular", monto: 300000, descripcion: "Celular", cuotas: 6 });
  const h = parseFinanceWhatIf("si compro detergente y confort por 15 mil, ¿cómo quedo?");
  expect(h?.monto).toBe(15000); expect(h?.categoria).toBe("hogar");
  const n = parseFinanceWhatIf("¿me conviene comprarme un notebook de 1 palo en 12 cuotas con la CMR?");
  expect(n).toMatchObject({ monto: 1_000_000, cuotas: 12, cuenta: "cmr", descripcion: "Notebook" });
  expect(parseFinanceWhatIf("¿qué pasa si pago 45 lucas de luz?")?.categoria).toBe("vivienda");
  expect(parseFinanceWhatIf("simula un gasto de 30 lucas")?.monto).toBe(30000);
  expect(parseFinanceWhatIf("estoy pensando en comprarme una polera de 15 lucas")?.descripcion).toBe("Polera");
});

test("lector: no confunde", () => {
  expect(parseFinanceWhatIf("¿y si me como un completo?")).toBeNull();             // comida, sin monto
  expect(parseFinanceWhatIf("¿y si me compro 300 gramos de queso?")).toBeNull();   // gramos no son plata
  expect(parseFinanceWhatIf("gasté 5 lucas en almuerzo")).toBeNull();               // eso se anota
  expect(parseFinanceWhatIf("¿y si me compro algo de 20 o 30 lucas?")).toBeNull();  // dos montos: lo ve el modelo
  expect(parseFinanceWhatIf("¿cuánta plata tengo?")).toBeNull();
  // y lo de siempre sigue igual
  expect(parseFinanceMessage("gasté 5 lucas en almuerzo con la BCI", { now: NOW })).toMatchObject({ action: "gasto", monto: 5000, categoria: "alimentacion" });
  expect(categoryFor("Detergente")).toBe("hogar");
  expect(categoryFor("almuerzo con Ariel")).toBe("alimentacion");
});

// Finanzas de prueba: sueldo $1.200.000 el 30 en la BCI, BCI $400.000, CMR cupo $800.000 con $100.000 de deuda,
// arriendo fijo $350.000 el 20, topes Comida $250.000 y Ocio $60.000
function escenario(): C.FinanceState {
  let id = 1000;
  const ctx = { now: new Date(2026, 9, 1, 9, 0), newId: () => id++ };
  const S = C.draft(C.onboarding({ sueldo: 1_200_000, presup: { alimentacion: 250_000, entretenimiento: 60_000 } }, ctx));
  expect(C.formCuenta(S, { banco: "BCI", tipo: "debito", saldo: 400_000 }, ctx).ok).toBe(true);
  expect(C.formCuenta(S, { banco: "CMR", tipo: "credito", cupo: 800_000, deuda: 100_000 }, ctx).ok).toBe(true);
  const bci = S.cuentas.find((c) => c.nombre === "BCI")!.id;
  expect(C.formSueldo(S, { monto: 1_200_000, dia: 30, cuenta: bci }, ctx).ok).toBe(true);
  expect(C.formProg(S, { tipo: "gasto", desc: "Arriendo", monto: 350_000, dia: 20, cat: "vivienda", cuenta: bci }, ctx).ok).toBe(true);
  for (const [d, desc, monto, cat] of [[3, "Almuerzo", 8000, "alimentacion"], [7, "Super", 42000, "alimentacion"], [10, "Carrete", 25000, "entretenimiento"], [14, "Almuerzo", 9000, "alimentacion"]] as const) {
    expect(C.formGasto(S, { desc, monto, cat, cuenta: bci, fecha: `2026-10-${String(d).padStart(2, "0")}` }, { now: new Date(2026, 9, d, 13), newId: () => id++ }).ok).toBe(true);
  }
  return S;
}

test("núcleo: al contado baja lo libre al peso; el presupuesto y el ritmo se recalculan", () => {
  const S = escenario();
  const T0 = C.tablero(S, NOW);
  // BCI: 400.000 − 84.000 = 316.000; menos el arriendo del 20 → 316.000 − 350.000 = −34.000 (ya no alcanza ni sin comprar)
  expect(T0.libre).toBe(-34_000);
  const sim = C.simularCompra(S, { monto: 60_000, desc: "Zapatillas" }, NOW)!;
  expect(sim.despues.libre).toBe(T0.libre - 60_000);
  expect(sim.veredicto).toBe("no_alcanza");
  expect(sim.hasta).toBe("hasta tu sueldo (en 15 días)");
  expect(sim.lineas[1]).toContain("te faltarían $94.000");
  expect(sim.cuenta?.nombre).toBe("BCI");
  // el estado original no se tocó
  expect(C.tablero(S, NOW).libre).toBe(-34_000);
});

test("núcleo: con plata, el tope de la categoría y el veredicto", () => {
  const S = escenario();
  const bci = S.cuentas.find((c) => c.nombre === "BCI")!.id;
  let id = 5000;
  // le llegó un extra de 500 lucas a la BCI
  expect(C.formMov(S, { tipo: "abono", hacia: bci, monto: 500_000, desc: "Pega extra", fuente: "extra" }, { now: NOW, newId: () => id++ }).ok).toBe(true);
  const T0 = C.tablero(S, NOW);
  expect(T0.libre).toBe(466_000);
  const ok = C.simularCompra(S, { monto: 20_000, cat: "entretenimiento", desc: "Carrete" }, NOW)!;
  expect(ok.veredicto).toBe("justo");                        // Ocio queda apurado para el día del mes
  expect(C.simularCompra(S, { monto: 20_000, desc: "Zapatillas" }, NOW)!.veredicto).toBe("holgado");
  expect(ok.presup).toMatchObject({ cat: "entretenimiento", queda: 15_000, sobre: 0 });
  const sobre = C.simularCompra(S, { monto: 40_000, cat: "entretenimiento", desc: "Carrete" }, NOW)!;
  expect(sobre.presup?.sobre).toBe(5_000);
  expect(sobre.veredicto).toBe("justo");
  expect(sobre.lineas.join(" ")).toContain("Ocio: te pasarías del presupuesto del mes por $5.000");
});

test("núcleo: en cuotas va a la tarjeta y pesa desde el próximo mes", () => {
  const S = escenario();
  const sim = C.simularCompra(S, { monto: 300_000, cuotas: 6, desc: "Celular" }, NOW)!;
  expect(sim.cuotas).toBe(6);
  expect(sim.cuenta).toEqual({ nombre: "CMR", tipo: "credito" });
  expect(sim.valorCuota).toBe(50_000);
  expect(sim.despues.libre).toBe(sim.antes.libre);            // este mes no cambia
  expect(sim.antes.deudaTC).toBe(100_000);
  expect(sim.despues.deudaTC).toBe(400_000);
  expect(sim.despues.cuotasProxMes).toBe(50_000);
  expect(sim.veredicto).toBe("holgado");
  const grande = C.simularCompra(S, { monto: 1_000_000, cuotas: 12 }, NOW)!;
  expect(grande.veredicto).toBe("no_alcanza");                // cupo libre 700.000
  expect(grande.lineas.join(" ")).toContain("Cupo insuficiente en CMR");
});

// La herramienta, de punta a punta: frase → preroute → simulación sobre el respaldo del PC → respuesta sin el modelo
function mem() {
  const m = new Map<string, any>();
  return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { if (v == null) m.delete(k); else m.set(k, v); } };
}

test("herramienta: responde con los números del respaldo y no anota nada", async () => {
  const tool = new FinanceTrackerTool();
  const memory = mem();
  const msg = "¿y si me compro unas zapatillas de 60 lucas?";
  // sin respaldo: lo dice, no inventa
  let input = await tool.preroute(msg, { memory });
  expect(input).toMatchObject({ action: "simular", monto: 60000 });
  let r = await tool.execute(input as any, { memory, userMessage: msg });
  expect(String((r.metadata as any).quickReply)).toContain("necesito tu Finanzas");

  const S = escenario();
  const at = new Date().toISOString(); // la herramienta usa la hora real
  await saveFinanceBackup(memory, { v: 1, profile: "p", at, keys: C.toHwKeys(S), stats: { tx: S.tx.length, cuentas: S.cuentas.length, claves: 0 } }, NOW);
  const before = JSON.stringify(await memory.get("finance_backup_index"));
  input = await tool.preroute(msg, { memory });
  r = await tool.execute(input as any, { memory, userMessage: msg });
  const q = String((r.metadata as any).quickReply);
  expect(q).toContain("🧮 Si gastas $60.000 en zapatillas:");
  expect(q).toContain("No te alcanza con lo que tienes hasta tu sueldo");
  expect(q).toContain("no anoté nada");
  expect(q).toContain("Datos de Finanzas de hoy");
  expect(q).toContain("Hoy ya te faltan $34.000 para llegar hasta tu sueldo");
  expect(q).not.toContain("$-");
  expect(r.output).toContain("NO se anotó nada");
  expect(JSON.stringify(await memory.get("finance_backup_index"))).toBe(before);

  // en cuotas
  const m2 = "¿me alcanza para un celular de 300 lucas en 6 cuotas?";
  r = await tool.execute((await tool.preroute(m2, { memory })) as any, { memory, userMessage: m2 });
  expect(String((r.metadata as any).quickReply)).toContain("En 6 cuotas son ~$50.000 al mes");
});
