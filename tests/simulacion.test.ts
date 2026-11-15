// Simulador del negocio de Eris y AXS (2026-11-11): el modelo que usa la página. Las cuentas se revisan a mano acá.
import { test, expect } from "bun:test";
await import("../scripts/simulacion/modelo.js");
const S = (globalThis as any).SimAXS;
const cerca = (a: number, b: number, tol = 1) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

test("de cada suscripción: primero el IVA y, sobre lo que queda, la comisión de la tienda", () => {
  const c = S.porSuscripcion({}, 3990);
  cerca(c.iva, 637.06);
  cerca(c.comision, 502.94);
  cerca(c.queda, 2850);
  cerca(c.iva + c.comision + c.queda, 3990, 0.01);
  cerca(S.porSuscripcion({}, 39990).queda, 28564.3);
  // Cobrando directo (≈4,2 % con IVA) queda más
  expect(S.porSuscripcion({ comision: 0.0415 }, 3990).queda).toBeGreaterThan(3200);
});

test("cuántas personas aguanta un PC: con lo medido y 15 s por respuesta, 445", () => {
  // 3,0 mensajes × 69 % × 15 s × 13 % en la hora punta = 4,04 s por persona; el PC da 1.800 s útiles en esa hora
  expect(S.capacidadPorServidor({})).toBe(445);
  // Con los 48 s del notebook, muchas menos; si todo lo respondiera el código, sin tope
  expect(S.capacidadPorServidor({ segundosModelo: 48 })).toBe(139);
  expect(S.capacidadPorServidor({ fraccionModelo: 0 })).toBe(Infinity);
});

test("antes de cobrar no entra plata; al partir, también paga parte de los que venían de la beta", () => {
  const s = S.simular({ mesCobro: 3, instalacionesMes0: 100, crecimientoMensual: 0, conversion: 0.029 });
  expect(s.filas.slice(0, 3).every((f: any) => f.ingreso === 0 && f.suscriptores === 0)).toBe(true);
  // mes 4: 100 instalaciones nuevas + 300 de la beta, al 2,9 %
  cerca(s.filas[3].nuevos, 400 * 0.029, 0.001);
  cerca(s.filas[4].nuevos, 100 * 0.029, 0.001);
});

test("las renovaciones: 57 % el segundo mes y 85 % después; el anual paga de una vez y de nuevo al año", () => {
  // Con los precios de antes y sin elasticidad, para revisar las cuentas a mano
  const p = { mesCobro: 0, instalacionesMes0: 1000, crecimientoMensual: 0, conversion: 0.029, mixModulo: 0, mixAnual: 0, maxInstalacionesMes: 1000, meses: 4, usoPrueba: 0, precioCompleto: 3990, precioAnual: 39990, elasticidad: 0 };
  const f = S.simular(p).filas;
  cerca(f[0].suscriptores, 29, 0.001);
  cerca(f[1].suscriptores, 29 + 29 * 0.57, 0.001);
  cerca(f[2].suscriptores, 29 + 29 * 0.57 + 29 * 0.57 * 0.85, 0.001);
  // Casi todo anual, una sola tanda de gente: paga el mes 1 y de nuevo el 13
  const una = S.simular({ ...p, mixAnual: 0.95, meses: 14, crecimientoMensual: -1 }).filas; // solo el primer mes instala alguien
  cerca(una[0].bruto, 1000 * 0.029 * 0.95 * 39990 + 1000 * 0.029 * 0.05 * 3990, 1);
  cerca(una[12].bruto - una[11].bruto, 1000 * 0.029 * 0.95 * 0.25 * 39990 + (una[12].subsCompleto - una[11].subsCompleto) * 3990, 1);
  cerca(una[12].subsAnual, 1000 * 0.029 * 0.95 * 0.25, 0.001);
});

test("la caja cuadra: la de cada mes es la anterior más lo que entra menos lo que sale", () => {
  const s = S.simular({ mesSueldo: 10, marketingMensual: 100000 });
  let caja = 0;
  for (const f of s.filas) {
    cerca(f.ingreso, f.bruto - f.iva - f.comision, 0.01);
    cerca(f.quedaParaSueldos, f.ingreso - f.luz - f.internet - f.contador - f.fijos - f.marketing, 0.01);
    caja += f.quedaParaSueldos - f.sueldos - f.capex - f.unaVez - f.impuesto;
    cerca(f.caja, caja, 0.5);
  }
  expect(s.resumen.hayQuePoner).toBeCloseTo(-Math.min(0, ...s.filas.map((f: any) => f.caja)), 0);
  // Sueldos desde el mes 11 y no antes
  expect(s.filas[9].sueldos).toBe(0);
  cerca(s.filas[10].sueldos, 1000000 * 1.31, 0.5);
});

test("el equipo: un PC desde el inicio, el de repuesto al llegar a 50 que pagan, y otro cuando no alcanza", () => {
  const chico = S.simular({});
  expect(chico.filas[0].servidores).toBe(1);
  cerca(chico.filas[0].capex, 950000, 0.5);
  const grande = S.simular({ instalacionesMes0: 20000, crecimientoMensual: 0, mesCobro: 0 });
  const cap = grande.resumen.capacidad;
  for (const f of grande.filas) expect((f.servidores - 1) * cap).toBeGreaterThanOrEqual(f.carga - 0.001); // sin contar el de repuesto, alcanza
  expect(grande.filas[35].servidores).toBeGreaterThan(3);
  const sinRepuesto = S.simular({ instalacionesMes0: 20000, crecimientoMensual: 0, mesCobro: 0, respaldo: false });
  expect(sinRepuesto.filas[35].servidores).toBe(grande.filas[35].servidores - 1);
  // Un PC de 3 años se reemplaza
  const largo = S.simular({ meses: 40 });
  expect(largo.filas[36].capex).toBeGreaterThanOrEqual(850000);
});

test("la luz: encendido sin uso, lo del plan de compra (~40 kWh, ~$9.500)", () => {
  const s = S.simular({ instalacionesMes0: 0 });
  cerca(s.filas[0].luz, (55 * 730 / 1000) * 236, 0.5);
  expect(s.filas[0].luz).toBeGreaterThan(9000);
  expect(s.filas[0].luz).toBeLessThan(10000);
});

test("impuestos: solo sobre utilidad, descontando las pérdidas de antes, y con la tasa de cada año", () => {
  const pierde = S.simular({});
  expect(pierde.filas[11].impuesto).toBe(0); // el primer año se pierde plata
  const gana = S.simular({ instalacionesMes0: 20000, crecimientoMensual: 0, mesCobro: 0 });
  const anio1 = gana.filas.slice(0, 12).reduce((a: number, f: any) => a + f.resultado, 0);
  expect(anio1).toBeGreaterThan(0);
  cerca(gana.filas[11].impuesto, anio1 * 0.125, 1);
  const anio2 = gana.filas.slice(12, 24).reduce((a: number, f: any) => a + f.resultado, 0);
  cerca(gana.filas[23].impuesto, anio2 * 0.15, 1);
});

test("lo que deja una persona y lo que costaría traerla con publicidad", () => {
  const d = S.duracion({});
  cerca(d.mesesMensual, 1 + 0.57 / 0.15, 0.001); // 4,8 meses
  cerca(d.pagosAnual, 1 + 0.25 / 0.4, 0.001);
  const v = S.valorPorPersona({});
  cerca(v.traerla, (0.8 * 975) / 0.02, 1);      // $39.000
  expect(v.deja).toBeLessThan(v.traerla);        // con las referencias, la publicidad no se paga sola
  expect(S.valorPorPersona({ conversion: 0.05, renovSiguientes: 0.92 }).deja).toBeGreaterThan(S.valorPorPersona({ conversion: 0.05, renovSiguientes: 0.92 }).traerla);
});

test("cuántos suscriptores cubren un sueldo: con todo en Eris completo mensual, el monto dividido por $2.850", () => {
  expect(S.suscriptoresParaCubrir({ mixModulo: 0, mixAnual: 0, precioCompleto: 3990 }, 2850 * 100)).toBe(100);
  cerca(S.costoSueldos({ personas: 2 }), 2 * 1000000 * 1.31, 0.5);
  expect(S.suscriptoresParaCubrir({}, S.costoSueldos({}))).toBeGreaterThan(450);
  expect(S.suscriptoresParaCubrir({}, S.costoSueldos({}))).toBeLessThan(620);
});

test("los rangos se mueven con la base y respetan los topes", () => {
  const r0 = S.rangoDe(S.unir({}), "conversion");
  cerca(r0[0], 0.01, 1e-9);
  cerca(r0[1], 0.05, 1e-9);
  const r = S.rangoDe(S.unir({ conversion: 0.04 }), "conversion");
  cerca(r[0], 0.02, 0.0001);
  cerca(r[1], 0.1, 0.0001);
  expect(S.rangoDe(S.unir({ renovSiguientes: 0.97 }), "renovSiguientes")[1]).toBe(0.98);
});

test("muchas corridas: repetibles con la misma semilla, ordenadas, y la base cae dentro del rango", () => {
  const a = S.monteCarlo({}, 300, 11), b = S.monteCarlo({}, 300, 11), c = S.monteCarlo({}, 300, 12);
  expect(a.bandas.caja.p50).toEqual(b.bandas.caja.p50);
  expect(a.bandas.caja.p50).not.toEqual(c.bandas.caja.p50);
  const base = S.simular({});
  for (let t = 0; t < 36; t++) {
    expect(a.bandas.suscriptores.p10[t]).toBeLessThanOrEqual(a.bandas.suscriptores.p50[t]);
    expect(a.bandas.suscriptores.p50[t]).toBeLessThanOrEqual(a.bandas.suscriptores.p90[t]);
  }
  expect(base.filas[35].suscriptores).toBeGreaterThan(a.bandas.suscriptores.p10[35] * 0.5);
  expect(base.filas[35].suscriptores).toBeLessThan(a.bandas.suscriptores.p90[35] * 2);
  expect(a.sePagaSola.antesDe12).toBeLessThanOrEqual(a.sePagaSola.antesDe24);
  expect(a.sePagaSola.antesDe24).toBeLessThanOrEqual(a.sePagaSola.antesDeFin);
  expect(a.hitos[36].alcanzaSueldos).toBeGreaterThanOrEqual(0);
  expect(a.hitos[36].alcanzaSueldos).toBeLessThanOrEqual(1);
});

test("quien no paga: prueba el primer mes, después sigue una parte y cada mes se va otra; con 'codigo' ya no usa el modelo", () => {
  const p = { mesCobro: 0, instalacionesMes0: 1000, crecimientoMensual: -1, meses: 4, activosMes1: 0.05, quedanCadaMes: 0.8, usoPrueba: 0.25, usoGratis: 0.5 };
  const f = S.simular(p).filas; // solo el primer mes instala alguien
  cerca(f[0].gratisActivos, 250, 0.001);
  cerca(f[1].gratisActivos, 50, 0.001);
  cerca(f[2].gratisActivos, 40, 0.001);
  cerca(f[3].gratisActivos, 32, 0.001);
  // La carga en «personas que pagan equivalentes»: el primer mes prueban a la mitad de uso; después, según el plan
  cerca(f[0].carga, f[0].suscriptores + 250 * 0.5, 0.001);
  cerca(f[1].carga, f[1].suscriptores + 50 * 0.5, 0.001);
  cerca(S.simular({ ...p, planChat: "codigo" }).filas[1].carga, f[1].suscriptores, 0.001);
});

test("el tope del modelo casi no cambia el promedio: recorta a los que más usan", () => {
  expect(S.factorGratis({ planChat: "libre" })).toBe(0.5);
  expect(S.factorGratis({ planChat: "codigo" })).toBe(0);
  // Promedio 3,0 × 0,69 × 0,5 = 1,035 respuestas al día; con tope 5 queda 1 − e^(−5/1,035)
  cerca(S.factorGratis({ planChat: "tope", topeModeloDia: 5 }), 0.5 * (1 - Math.exp(-5 / 1.035)), 1e-9);
  expect(S.factorGratis({ planChat: "tope", topeModeloDia: 1 })).toBeLessThan(0.4);
  // Un PC al mes: equipo en 36 meses + luz a su capacidad; por persona que paga, eso dividido por lo que aguanta
  const pc = S.costoMesPorPc({});
  expect(pc).toBeGreaterThan(35000);
  expect(pc).toBeLessThan(45000);
  cerca(S.costoPorPersona({}).paga, pc / 445, 0.01);
  cerca(S.costoPorPersona({}).gratis, (pc / 445) * 0.5, 0.01);
});

test("comparar el chat: lo que cuesta darlo gratis frente a solo el código, y cuántos que pagan lo cubren", () => {
  const c = S.compararChat({ instalacionesMes0: 4000, crecimientoMensual: 0.03, mesCobro: 0 });
  const { libre, tope, codigo } = c.planes;
  expect(codigo.costoChatMes).toBe(0);
  expect(libre.servidores).toBeGreaterThan(codigo.servidores);
  expect(libre.costoChatMes).toBeGreaterThan(0);
  expect(tope.costoChatMes).toBeLessThanOrEqual(libre.costoChatMes);
  cerca(libre.pagadoresQueLoCubren, libre.costoChatMes / c.netoMesPorSuscriptor, 1e-6);
  expect(libre.conversionNecesaria).toBeGreaterThan(c.conversion);
  // Todo lo demás igual: los mismos suscriptores y la misma gente sin pagar
  expect(libre.suscriptores).toBe(codigo.suscriptores);
  expect(libre.gratisActivos).toBe(codigo.gratisActivos);
});

test("el precio y la conversión: a precio de referencia no cambia; más caro, menos gente paga según la elasticidad", () => {
  expect(S.conversionEfectiva({})).toBe(0.02); // $4.990 es el precio de referencia
  cerca(S.conversionEfectiva({ precioCompleto: 3990 }), 0.02 * Math.pow(4990 / 3990, 0.6), 1e-12);
  cerca(S.conversionEfectiva({ precioCompleto: 5990, elasticidad: 1 }), 0.02 * 4990 / 5990, 1e-12);
  expect(S.conversionEfectiva({ precioCompleto: 3990, elasticidad: 0 })).toBe(0.02);
  // El anual: $34.990 frente a 12 × $4.990 ahorra 41,6 %; la mezcla sube con el ahorro y no pasa del 68 % de salud y deporte
  cerca(S.ahorroAnual({}), 1 - 34990 / 59880, 1e-12);
  cerca(S.mixAnualPorAhorro(0.16), 0.25, 1e-12);
  cerca(S.mixAnualPorAhorro(0.42), 0.5, 1e-12);
  expect(S.mixAnualPorAhorro(0.9)).toBe(0.68);
  expect(S.mixAnualPorAhorro(-0.2)).toBe(0.1);
});

test("comparar precios: los módulos a $1.990 con el completo a $4.990 dejan más que lo de antes y que Eris+ sin módulos", () => {
  const ops = S.compararPrecios({});
  const por = Object.fromEntries(ops.map((o: any) => [o.id, o]));
  expect(Object.keys(por)).toEqual(["antes", "erisplus", "bajo", "propuesta", "alto"]);
  // La fila de la propuesta calza con el caso base
  cerca(por.propuesta.quedaFinal, S.simular({}).resumen.quedaFinal, 1e-6);
  // Con la gente que mira poco o algo el precio (0,2 y la base), gana a lo de antes; si lo mira muchísimo, gana lo barato
  for (let i = 0; i < 2; i++) expect(por.propuesta.porElasticidad[i].quedaFinal).toBeGreaterThan(por.antes.porElasticidad[i].quedaFinal);
  // Eris+ sin módulos vende comodidad: paga menos gente (1,5 % contra 2 %) y deja menos
  cerca(por.erisplus.conversion, 0.015, 1e-12);
  expect(por.propuesta.quedaFinal).toBeGreaterThan(por.erisplus.quedaFinal);
  // Lo que deja por instalación = lo que deja cada persona que paga × la conversión
  cerca(por.propuesta.porInstalacion, por.propuesta.deja * por.propuesta.conversion, 1e-6);
  // Más caro: menos gente paga
  expect(por.alto.conversion).toBeLessThan(por.propuesta.conversion);
  expect(por.bajo.conversion).toBeGreaterThan(por.propuesta.conversion);
});

test("qué mueve más: ordenado de mayor a menor, y más gente que paga siempre deja más", () => {
  const s = S.sensibilidad({});
  for (let i = 1; i < s.filas.length; i++) expect(s.filas[i - 1].efecto).toBeGreaterThanOrEqual(s.filas[i].efecto);
  const conv = s.filas.find((f: any) => f.clave === "conversion");
  expect(conv.conAlto).toBeGreaterThan(conv.conBajo);
  const seg = s.filas.find((f: any) => f.clave === "segundosModelo");
  expect(seg.conAlto).toBeLessThanOrEqual(seg.conBajo); // un PC más lento nunca deja más
});
