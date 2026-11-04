// ============================================================
// El núcleo de Inventario del servidor (src/services/InventoryCore.ts) es COPIA EXACTA del de la app. Revisa el archivo y
// que los dos den lo mismo con un estado de prueba (compras, consumos con conversión, conteo, lista, vencimientos, chat).
//   bun scripts/inventory_parity_test.ts    (sale con 1 si algo difiere)
// ============================================================

import { readFileSync } from "fs";
import { APP_INVENTORY_CORE, SRV_INVENTORY_CORE } from "./sync_inventory_core.ts";

const app = await import(APP_INVENTORY_CORE);
const srv = await import(SRV_INVENTORY_CORE);
let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };

check(readFileSync(SRV_INVENTORY_CORE, "utf-8") === readFileSync(APP_INVENTORY_CORE, "utf-8"), "InventoryCore.ts: el del servidor es copia del de la app");

const run = (I: any) => {
  const now = new Date(2026, 9, 22, 12);
  let id = 1;
  const ctx = { now, newId: () => id++ };
  const W = I.draft(I.emptyState());
  I.agregar(W, { nombre: "Leche", cantidad: 3, unidad: "u", contenido: { cant: 1, unidad: "L" }, vence: "2026-10-25", precioTotal: 3600 }, ctx);
  I.agregar(W, { nombre: "arroz", cantidad: 2, unidad: "kg" }, ctx);
  I.agregar(W, { nombre: "shampoo", cantidad: 1, minimo: 1, precioTotal: 3990 }, ctx);
  I.consumir(W, W.items[0].id, 750, "ml", ctx);
  I.ajustar(W, W.items[1].id, 1500, "g", ctx);
  I.anotarCompra(W, "pilas AA", 4, "u", ctx);
  let S = W;
  const ops = [
    { action: "compra", producto: "huevos", cantidad: 12 }, { action: "consumo", producto: "huevo", cantidad: 2 },
    { action: "se_acabo", producto: "shampoo" }, { action: "consultar", producto: "leches" }, { action: "lista" }, { action: "por_vencer" },
    { action: "resumen" }, { action: "deshacer" },
  ];
  const results = ops.map((op) => { const r = I.applyOp(S, op, ctx); S = r.state; return r.result; });
  return { S, results, extract: I.extract(S, now), lista: I.listaCompras(S), revision: I.revision(S, new Date(2026, 10, 2)), areas: I.resumenAreas(S, now),
    parse: ["2 paquetes de fideos de 400 g", "media docena de huevos", "1,5 litros de bebida"].map(I.parseCantidad), area: ["leches", "cloro", "creatina"].map(I.areaPara) };
};
check(JSON.stringify(run(app)) === JSON.stringify(run(srv)), "mismo inventario, lista de compras, vencimientos, revisión y respuestas del chat");

if (fails) { console.error(`\n${fails} diferencia(s)`); process.exit(1); }
console.log("\nNúcleo de Inventario: app = servidor ✓");
