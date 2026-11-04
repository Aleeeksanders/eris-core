import { test, expect } from "bun:test";
import { parseFinanceMessage, findAmounts, fold, accountNamesFromContext } from "C:/Proyectos/eris/src/services/FinanceParse.ts";

const NOW = new Date(2026, 8, 30, 14, 0); // mié 30 sep 2026
const P = (m: string, names: string[] = []) => parseFinanceMessage(m, { now: NOW, accountNames: names });
const amt = (s: string) => findAmounts(fold(s)).map((a) => a.value);

test("montos a la chilena", () => {
  expect(amt("5 lucas")).toEqual([5000]);
  expect(amt("una luca")).toEqual([1000]);
  expect(amt("luca y media")).toEqual([1500]);
  expect(amt("me costó luca y media")).toEqual([1500]);
  expect(amt("una luca y media")).toEqual([1500]);
  expect(amt("media luca")).toEqual([500]);
  expect(amt("quince lucas")).toEqual([15000]);
  expect(amt("treinta y cinco lucas")).toEqual([35000]);
  expect(amt("1,5 lucas")).toEqual([1500]);
  expect(amt("un palo")).toEqual([1_000_000]);
  expect(amt("1.2 palos")).toEqual([1_200_000]);
  expect(amt("palo y medio")).toEqual([1_500_000]);
  expect(amt("15 mil")).toEqual([15000]);
  expect(amt("quince mil quinientos")).toEqual([15500]);
  expect(amt("$4.990")).toEqual([4990]);
  expect(amt("4990 pesos")).toEqual([4990]);
  expect(amt("12.500")).toEqual([12500]);
  expect(amt("gasté 3500 en pan")).toEqual([3500]);
  expect(amt("5k")).toEqual([5000]);
  expect(amt("2 gambas")).toEqual([200]);
  expect(amt("gasté 5 en almuerzo")).toEqual([]); // ambiguo
  expect(amt("200 g de arroz")).toEqual([]);
  expect(amt("me lo devuelve el 5 de octubre de 2026")).toEqual([]);
});

test("gasto simple con cuenta", () => {
  expect(P("gasté 5 lucas en almuerzo con la BCI")).toEqual({ action: "gasto", monto: 5000, descripcion: "Almuerzo", categoria: "alimentacion", cuenta: "bci" });
  expect(P("Eris, gasté 20 lucas en el super en efectivo")).toEqual({ action: "gasto", monto: 20000, descripcion: "Super", categoria: "alimentacion", cuenta: "efectivo" });
  expect(P("pagué 45 lucas de luz")).toEqual({ action: "gasto", monto: 45000, descripcion: "Luz", categoria: "vivienda" });
  expect(P("me salió 8 lucas el uber")).toEqual({ action: "gasto", monto: 8000, descripcion: "Uber", categoria: "transporte" });
  expect(P("anota 3 lucas de uber")).toEqual({ action: "gasto", monto: 3000, descripcion: "Uber", categoria: "transporte" });
  expect(P("compré unas zapatillas a 30 lucas con la tarjeta de crédito")).toEqual({ action: "gasto", monto: 30000, descripcion: "Zapatillas", categoria: "otros", cuenta: "tarjeta de credito" });
  expect(P("pagué la cuenta de la luz, 32 lucas")).toMatchObject({ action: "gasto", monto: 32000, categoria: "vivienda" });
  expect(P("ayer gasté 12 lucas en bencina con débito")).toEqual({ action: "gasto", monto: 12000, descripcion: "Bencina", categoria: "transporte", cuenta: "debito", fecha: "2026-09-29" });
  expect(P("gasté 15 lucas")).toEqual({ action: "gasto", monto: 15000, descripcion: "Gasto", categoria: "otros" });
  expect(P("cargué la bip con 5 lucas")).toMatchObject({ action: "gasto", monto: 5000, categoria: "transporte" });
  expect(P("compré en el Lider 20 lucas con la tarjeta Lider BCI")).toMatchObject({ action: "gasto", monto: 20000, descripcion: "Lider", cuenta: "tarjeta lider bci" });
});

test("frases largas: descripción después del monto y cuenta rut", () => {
  expect(P("ayer en la feria se me fue harta plata, unas 15 lucas en verduras, pagué con la cuenta rut"))
    .toEqual({ action: "gasto", monto: 15000, descripcion: "Verduras", categoria: "alimentacion", cuenta: "cuenta rut", fecha: "2026-09-29" });
  expect(P("gasté 12 lucas en el super en efectivo")).toMatchObject({ descripcion: "Super", cuenta: "efectivo" });
  expect(P("gasté 6 lucas en un café y un pan con la BCI")).toMatchObject({ descripcion: "Café", cuenta: "bci" });
});

test("cuentas propias por nombre", () => {
  const names = accountNamesFromContext("- Cuentas y efectivo (Bóveda):\n  · Efectivo: $1\n  · Coopeuch (débito): $5.000\n  · BCI · Cuenta corriente (débito): $400.000\n  · Banco Falabella (tarjeta de crédito): cupo libre $1\n");
  expect(names).toEqual(["Coopeuch", "BCI · Cuenta corriente", "Banco Falabella"]);
  expect(P("gasté 4 lucas en café con la Coopeuch", names)).toMatchObject({ cuenta: "coopeuch", descripcion: "Café" });
});

test("no es un registro", () => {
  for (const m of [
    "debería gastar menos en uber", "voy a gastar 20 lucas mañana", "no gasté nada hoy",
    "quiero comprar unas zapatillas de 50 lucas", "gasté 5 en almuerzo", "compré 2 cafés a 3 lucas cada uno",
    "comí un completo de 3 lucas", "transferí 10 lucas a Juan", "saqué entradas por 30 lucas", "hola", "tomé 500 ml de agua",
    "registra 200 g de arroz",
  ]) expect([m, P(m)]).toEqual([m, null]);
  // 2026-10-23 («Eris como Jarvis»): no es un registro, pero se contesta por código con el gasto de la categoría y su presupuesto
  expect(P("¿cuánto gasté en comida?")).toMatchObject({ action: "resumen", foco: "categorias", categoria: "alimentacion" });
});

test("préstamos y cobros", () => {
  expect(P("le presté 10 lucas a Juan, me lo devuelve el viernes")).toEqual({ action: "prestamo", monto: 10000, persona: "Juan", devolucion: "2026-10-02" });
  expect(P("le presté 20 lucas al Pedro para la micro desde la BCI")).toMatchObject({ action: "prestamo", monto: 20000, persona: "Pedro", cuenta: "bci" });
  expect(P("le presté a mi hermano 50 lucas hasta fin de mes")).toMatchObject({ action: "prestamo", monto: 50000, persona: "Mi hermano", devolucion: "2026-09-30" });
  expect(P("Juan me devolvió las 10 lucas")).toEqual({ action: "cobro", persona: "Juan", monto: 10000 });
  expect(P("ya me devolvió el Pedro")).toEqual({ action: "cobro", persona: "Pedro" });
  expect(P("la Cata me pagó")).toEqual({ action: "cobro", persona: "Cata" });
  expect(P("Juan me devolvió 5 de las 10 lucas")).toEqual({ action: "cobro", persona: "Juan", monto: 5000 });
});

test("movimientos", () => {
  expect(P("saqué 20 lucas del cajero de la BCI")).toEqual({ action: "giro", monto: 20000, cuenta: "bci" });
  expect(P("saqué 20 lucas")).toEqual({ action: "giro", monto: 20000 });
  expect(P("me llegó el sueldo, 1,2 palos a la BCI")).toEqual({ action: "abono", monto: 1_200_000, cuenta: "bci", descripcion: "Sueldo" });
  expect(P("me pagaron 50 lucas por un trabajo")).toEqual({ action: "abono", monto: 50000 });
  expect(P("transferí 100 lucas de la BCI a la Tenpo")).toEqual({ action: "transferencia", monto: 100000, cuenta: "bci", hacia: "tenpo" });
  expect(P("pagué la tarjeta Falabella, 100 lucas, desde la BCI")).toEqual({ action: "pago_tarjeta", monto: 100000, hacia: "tarjeta falabella", cuenta: "bci" });
  expect(P("pagué el total de la tarjeta")).toEqual({ action: "pago_tarjeta", hacia: "tarjeta de credito" });
  expect(P("ahorré 50 lucas para el viaje")).toEqual({ action: "ahorro", monto: 50000, descripcion: "Viaje" });
  expect(P("pasé al super y gasté 7 lucas")).toMatchObject({ action: "gasto", monto: 7000 });
});

test("deshacer y resumen", () => {
  expect(P("borra el último gasto")).toEqual({ action: "deshacer", objeto: "gasto" });
  expect(P("elimina el gasto del uber")).toEqual({ action: "deshacer", objeto: "gasto", descripcion: "uber" });
  expect(P("¿cuánta plata tengo?")).toEqual({ action: "resumen" });
  expect(P("cuánto llevo gastado este mes")).toEqual({ action: "resumen" });
});
