// ============================================================
// El núcleo de Finanzas del servidor (src/services/FinanceCore.ts) es COPIA EXACTA del de la app. Revisa el archivo y
// que los dos den lo mismo con un libro de prueba (cuotas, sueldo, préstamos, ahorro, deshacer y resumen).
//   bun scripts/finance_parity_test.ts    (sale con 1 si algo difiere)
// La paridad con la versión web anterior (hunter-wallet.html) se probó aparte, en Chrome, al portarlo (2026-10-15).
// ============================================================

import { readFileSync } from "fs";
import { APP_FINANCE_CORE, SRV_FINANCE_CORE } from "./sync_finance_core.ts";

const app = await import(APP_FINANCE_CORE);
const srv = await import(SRV_FINANCE_CORE);
let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };

check(readFileSync(SRV_FINANCE_CORE, "utf-8") === readFileSync(APP_FINANCE_CORE, "utf-8"), "el archivo del servidor es copia del de la app");

const now = new Date();
const ms = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const seed: Record<string, string> = {
  hw_setup_done: "true", hw_last_cuenta: "101",
  hw2_cuentas: JSON.stringify([{ id: "cash", nombre: "Efectivo", tipo: "efectivo", saldoInicial: 15000 }, { id: 101, nombre: "BCI", banco: "BCI", tipo: "debito", saldoInicial: 300000 },
    { id: 102, nombre: "CMR", banco: "Banco Falabella", tipo: "credito", cupo: 500000, saldoInicial: 450000 }]),
  hw2_prog: JSON.stringify([{ id: 201, tipo: "ingreso", desc: "Sueldo", monto: 800000, dia: 1, cuenta: 101, fuente: "sueldo" }, { id: 203, tipo: "gasto", desc: "Arriendo", monto: 250000, dia: 1, cuenta: 101, cat: "vivienda" }]),
  hw2_tx: JSON.stringify([{ id: 401, tipo: "gasto", fecha: `${ms}-01`, monto: 9990, desde: 101, cat: "alimentacion", desc: "Super" }]),
  hw_presup: JSON.stringify({ alimentacion: 150000 }),
};
const ops = [
  { action: "gasto", monto: 3500, descripcion: "micro", categoria: "transporte" },
  { action: "gasto", monto: 120000, descripcion: "zapatillas", cuenta: "cmr", cuotas: 3, categoria: "otros" },
  { action: "prestamo", monto: 8000, persona: "Ana", cuenta: "bci" },
  { action: "abono", descripcion: "me llegó el sueldo", fuente: "sueldo" },
  { action: "ahorro", monto: 50000, cuenta: "bci" },
  { action: "deshacer" },
  { action: "resumen" },
];
const run = (core: any) => {
  let id = 5_000_000;
  const ctx = { now, newId: () => ++id };
  let S = core.fromHwKeys(seed);
  const results = ops.map((op) => { const r = core.applyOp(S, op, ctx); S = r.state; return r.result; });
  return { results, state: S, extract: core.extractLegacy(S, now), extractNow: core.extract(S, now), hw: core.toHwKeys(S) };
};
const a = run(app), s = run(srv);
check(JSON.stringify(a.results) === JSON.stringify(s.results), `mismos resultados (${a.results.map((r: any) => (r.ok ? "ok" : r.code)).join(", ")})`);
check(JSON.stringify(a.state) === JSON.stringify(s.state), "mismo libro final");
check(JSON.stringify(a.extract) === JSON.stringify(s.extract), "mismo resumen y texto de la versión web (migración)");
check(JSON.stringify(a.extractNow) === JSON.stringify(s.extractNow), "mismo resumen y texto para Eris");
check(JSON.stringify(a.hw) === JSON.stringify(s.hw), "mismas claves para el respaldo");

console.log(fails ? `\n${fails} diferencia(s)` : "\nServidor = app ✓");
process.exit(fails ? 1 : 0);
