// Medición de la beta (2026-11-11): conteos por día con alias, el informe de cohortes y el trabajo del modelo por persona.
import { test, expect } from "bun:test";
import { mkdtemp, readFile, readdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { BetaMetrics, diaVacio, tramoDe, leerMetricas, SISTEMA, type DiaUso, type PerfilUso } from "../src/services/BetaMetrics";
import { armarInforme, informeEnTexto } from "../src/services/BetaReport";
import { alMedirModelo, contextoUso, registrarLlamada, type ContextoUso } from "../src/services/llm/ModelMeter";

const secreto = async () => Buffer.from("llave-de-prueba-del-servidor-32b");
async function nueva(ahora = new Date(2026, 10, 11, 13, 30)) {
  const dir = await mkdtemp(join(tmpdir(), "eris-uso-"));
  let t = ahora;
  const bm = new BetaMetrics({ dir, secreto, ahora: () => t, cadaMs: 60_000 });
  return { bm, dir, mover: (d: Date) => { t = d; } };
}

test("las personas van con un alias: estable, distinto por perfil y sin el id ni el correo en los archivos", async () => {
  const { bm, dir } = await nueva();
  const a = await bm.alias("tester.uno"), b = await bm.alias("tester.uno"), c = await bm.alias("otra.persona");
  expect(a).toBe(b);
  expect(a).not.toBe(c);
  expect(a).toHaveLength(12);
  await bm.conectar("tester.uno", { rol: "eris", alta: "2026-10-01T15:00:00.000Z" });
  await bm.chat("tester.uno", { voz: false, porModelo: true, ms: 4200 });
  await bm.guardar();
  for (const f of await readdir(dir)) expect(await readFile(join(dir, f), "utf-8")).not.toContain("tester.uno");
  // Otra llave, otro alias: sin la llave del servidor no se puede saber quién es
  const otra = new BetaMetrics({ dir, secreto: async () => Buffer.from("otra-llave-distinta-de-servidor!") });
  expect(await otra.alias("tester.uno")).not.toBe(a);
});

test("conectar: el alta es la de la cuenta de Google y cada inicio suma una conexión", async () => {
  const { bm } = await nueva();
  await bm.conectar("ana", { rol: "eris", alta: "2026-11-02T12:00:00.000Z" });
  await bm.conectar("ana", { rol: "eris" });
  const d = await bm.datos();
  const a = await bm.alias("ana");
  expect(d.perfiles[a].alta).toBe("2026-11-02");
  expect(d.dias[a]["2026-11-11"].conexiones).toBe(2);
  // Sin cuenta de Google: el primer día que se vio
  await bm.conectar("legado", { rol: "eris" });
  expect((await bm.datos()).perfiles[await bm.alias("legado")].alta).toBe("2026-11-11");
});

test("solo cuentan como acción las cosas que hace una persona; las sincronizaciones no", async () => {
  const { bm } = await nueva();
  for (const t of ["message", "log_water_quick", "food_search", "update_health_snapshot", "sync_nutrition_today", "update_financial_context"]) await bm.accion("ana", t);
  const dia = (await bm.datos()).dias[await bm.alias("ana")]["2026-11-11"];
  expect(dia.acciones).toBe(3);
});

test("chat: mensajes, por voz, por el modelo y el tramo del tiempo de respuesta", async () => {
  const { bm } = await nueva();
  await bm.chat("ana", { voz: false, porModelo: false, ms: 300 });
  await bm.chat("ana", { voz: true, porModelo: true, ms: 14_000 });
  await bm.chat("ana", { voz: false, porModelo: true, ms: 200_000 });
  const d = (await bm.datos()).dias[await bm.alias("ana")]["2026-11-11"];
  expect([d.mensajes, d.voz, d.porModelo]).toEqual([3, 1, 2]);
  expect(d.msRespuesta).toBe(214_300);
  expect(d.tramos).toEqual({ "1": 1, "20": 1, mas: 1 });
  expect(tramoDe(5000)).toBe("5");
  expect(tramoDe(5001)).toBe("10");
});

test("registros: comidas y agua valen por el máximo del día que manda el teléfono; el resto suma; y van al día que corresponde", async () => {
  const { bm } = await nueva();
  await bm.registro("ana", "comidas", 3, "2026-11-11");
  await bm.registro("ana", "comidas", 2, "2026-11-11"); // un envío viejo no baja la cuenta
  await bm.registro("ana", "aguaMl", 1250.4, "2026-11-11");
  await bm.registro("ana", "finanzas");
  await bm.registro("ana", "finanzas");
  await bm.registro("ana", "comidas", 1, "2026-11-10"); // la comida de las 2 AM sin haber dormido es de ayer
  await bm.registro("ana", "aguaMl", 0);                // cero no anota nada
  const filas = (await bm.datos()).dias[await bm.alias("ana")];
  expect(filas["2026-11-11"].reg).toEqual({ comidas: 3, aguaMl: 1250, finanzas: 2 });
  expect(filas["2026-11-10"].reg).toEqual({ comidas: 1 });
});

test("«Ayudar a mejorar Eris» apagado: no se anota nada y se borra lo anotado; encendido vuelve a contar", async () => {
  const { bm, dir } = await nueva();
  await bm.conectar("ana", { rol: "eris" });
  await bm.chat("ana", { voz: false, porModelo: true, ms: 1000 });
  await bm.guardar();
  await bm.setFuera("ana", true);
  expect(await bm.estaFuera("ana")).toBe(true);
  await bm.chat("ana", { voz: false, porModelo: true, ms: 1000 });
  await bm.modelo("ana", { tipo: "chat", modeloMs: 9000, esperaMs: 0 });
  await bm.guardar();
  const a = await bm.alias("ana");
  expect((await leerMetricas(dir)).dias[a]).toBeUndefined();
  await bm.setFuera("ana", false);
  await bm.chat("ana", { voz: false, porModelo: false, ms: 500 });
  expect((await bm.datos()).dias[a]["2026-11-11"].mensajes).toBe(1);
});

test("lo guardado se lee sin la llave (scripts) y sobrevive a reiniciar el servidor", async () => {
  const { bm, dir } = await nueva();
  await bm.conectar("ana", { rol: "eris", alta: "2026-11-01T10:00:00.000Z" });
  await bm.modelo("ana", { tipo: "chat", modeloMs: 12_345.6, esperaMs: 800 });
  await bm.modelo(null, { tipo: "lateral", modeloMs: 2000, esperaMs: 0 }); // precarga: del servidor
  await bm.guardar();
  const leido = await leerMetricas(dir);
  const a = await bm.alias("ana");
  expect(leido.dias[a]["2026-11-11"].modelo.chat).toBe(12_346);
  expect(leido.dias[a]["2026-11-11"].horas["13"]).toBe(12_346);
  expect(leido.dias[a]["2026-11-11"].esperaMs).toBe(800);
  expect(leido.dias[SISTEMA]["2026-11-11"].modelo.lateral).toBe(2000);
  const otra = new BetaMetrics({ dir, secreto, ahora: () => new Date(2026, 10, 11, 20) });
  await otra.chat("ana", { voz: false, porModelo: false, ms: 100 });
  expect((await otra.datos()).dias[a]["2026-11-11"].llamadas).toBe(1);
});

test("el grupo lo marca el administrador: pagado guarda desde qué día paga", async () => {
  const { bm, mover } = await nueva();
  await bm.conectar("ana", { rol: "eris" });
  expect((await bm.setGrupo("ana", "pagado")).pagoDesde).toBe("2026-11-11");
  mover(new Date(2026, 10, 20));
  expect((await bm.setGrupo("ana", "pagado")).pagoDesde).toBe("2026-11-11"); // no se corre
  expect((await bm.setGrupo("ana", "beta")).pagoDesde).toBeUndefined();
  expect(await bm.grupoDe("ana")).toBe("beta");
});

test("el trabajo del modelo se atribuye a quien mandó el mensaje y cuenta si la respuesta pasó por el modelo", async () => {
  const vistos: any[] = [];
  alMedirModelo((l) => vistos.push(l));
  const ctx: ContextoUso = { profileId: "ana", tipo: "voz", llamadas: 0 };
  await contextoUso.run(ctx, async () => {
    await new Promise((r) => setTimeout(r, 5));
    registrarLlamada(9000, 7000, true);      // Ollama dijo 7 s; 2 s fueron de espera
    ctx.tipo = "chat";
    registrarLlamada(3000, null, false);     // cortada: todo cuenta como trabajo
  });
  registrarLlamada(500, 400, true);           // fuera de un mensaje: del servidor
  alMedirModelo(null);
  expect(ctx.llamadas).toBe(2);
  expect(vistos).toEqual([
    { profileId: "ana", tipo: "voz", modeloMs: 7000, esperaMs: 2000, ok: true },
    { profileId: "ana", tipo: "chat", modeloMs: 3000, esperaMs: 0, ok: false },
    { profileId: null, tipo: "lateral", modeloMs: 400, esperaMs: 100, ok: true },
  ]);
});

// ─── El informe ───

const dia = (o: Partial<DiaUso> & { reg?: DiaUso["reg"] } = {}): DiaUso => ({ ...diaVacio(), ...o, reg: { ...(o.reg ?? {}) } });
const sumar = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86_400_000).toISOString().slice(0, 10);

function beta() {
  const hoy = "2026-12-20";
  const perfiles: Record<string, PerfilUso> = {
    a: { alta: "2026-11-02", rol: "eris", visto: hoy, grupo: "pagado", pagoDesde: "2026-11-20" }, // lunes
    b: { alta: "2026-11-04", rol: "eris", visto: hoy },
    c: { alta: "2026-11-05", rol: "eris", visto: hoy },
    d: { alta: "2026-12-18", rol: "eris", visto: hoy },
    yo: { alta: "2026-09-03", rol: "ikaros", visto: hoy },
    hermano: { alta: "2026-11-03", rol: "eris", visto: hoy, grupo: "equipo" },
    sin: { alta: "2026-11-03", rol: "eris", visto: hoy, fuera: true },
  };
  const dias: Record<string, Record<string, DiaUso>> = { a: {}, b: {}, c: {}, d: {}, yo: {}, hermano: {} };
  // a: activada, vuelve todos los días; anota comida a diario y agua día por medio; chatea 4 al día, 3 por el modelo
  for (let k = 0; k <= 48; k++) {
    dias.a[sumar("2026-11-02", k)] = dia({ acciones: 6, mensajes: 4, porModelo: 3, modelo: { chat: 45_000, voz: 0, lateral: 5_000 }, llamadas: 4, esperaMs: 2_000,
      tramos: { "10": 3, "1": 1 }, horas: { "13": 30_000, "21": 20_000 }, reg: { comidas: 3, ...(k % 2 ? { aguaMl: 1500 } : {}) } });
  }
  // b: solo el día de alta (anota y hace 3 cosas): activada, no vuelve
  dias.b["2026-11-04"] = dia({ acciones: 3, reg: { comidas: 1 } });
  // c: entra, mira, no anota nada; vuelve el día 7
  dias.c["2026-11-05"] = dia({ acciones: 1, conexiones: 1 });
  dias.c["2026-11-12"] = dia({ acciones: 2 });
  // d: recién llegada (2 días): vuelve al día siguiente; no entra en el día 7 ni en el 30
  dias.d["2026-12-18"] = dia({ acciones: 5, reg: { aguaMl: 500 } });
  dias.d["2026-12-19"] = dia({ acciones: 1 });
  // El equipo usa el PC: entra en el uso del PC, no en las cohortes
  dias.yo["2026-12-19"] = dia({ acciones: 20, mensajes: 10, porModelo: 7, modelo: { chat: 100_000, voz: 0, lateral: 0 }, horas: { "13": 100_000 } });
  dias.hermano["2026-12-19"] = dia({ acciones: 2 });
  return { hoy, perfiles, dias };
}

test("cohortes: activadas, vuelta al día 1, 7 y 30 y en la 2.ª y 5.ª semana, con quién ya llegó a ese día", () => {
  const { hoy, perfiles, dias } = beta();
  const r = armarInforme({ perfiles, dias }, hoy);
  expect(r.personas).toBe(4);
  expect([r.equipo, r.fuera]).toEqual([2, 1]);
  expect(r.muestraChica).toBe(true);
  expect(r.cohortes.map((c) => [c.semana, c.altas])).toEqual([["2026-11-02", 3], ["2026-12-14", 1]]);
  const t = r.total;
  expect(t.activadas).toBe(3);                         // a, b y d (c no anotó nada)
  expect([t.d1.vuelven, t.d1.n]).toEqual([2, 4]);      // a y d vuelven al día siguiente
  expect([t.d7.vuelven, t.d7.n]).toEqual([2, 3]);      // a y c; d aún no llega al día 7
  expect([t.d30.vuelven, t.d30.n]).toEqual([1, 3]);
  expect([t.s2.vuelven, t.s2.n]).toEqual([2, 3]);
  expect([t.s5.vuelven, t.s5.n]).toEqual([1, 3]);
});

test("días por semana, primera semana, chat y PC", () => {
  const { hoy, perfiles, dias } = beta();
  const r = armarInforme({ perfiles, dias }, hoy);
  // En las últimas 4 semanas solo a y d estuvieron activos
  expect(r.diasPorSemana.personas).toBe(2);
  expect(r.primeraSemana.chat).toBe(0.333);            // a de 3 con su primera semana completa (d no la tiene)
  expect(r.primeraSemana.comida).toBe(0.667);          // a y b
  expect(r.chat.porModelo).toBe(0.75);
  expect(r.chat.segundosModeloPorRespuesta).toBe(15);  // 45 s de modelo en 3 respuestas
  expect(r.chat.respuestaP50s).toBe(10);
  // El PC: 14 días; a trabaja 50 s al día y el equipo suma 100 s un día
  expect(r.pc.dias).toBe(14);
  expect(r.pc.modeloSegundosDia).toBe(Math.round((14 * 50 + 100) / 14));
  expect(r.pc.horaPuntaEs).toBe(13);
  expect(r.pc.horaPunta).toBeCloseTo((14 * 30 + 100) / (14 * 50 + 100), 3);
  expect(r.pc.esperaPromedioS).toBe(0.5);
  expect(r.pagan).toEqual({ pagados: 1, elegibles35: 3, pagados35: 1, conversion35: 0.333 });
  expect(r.simulador.fraccionModelo).toBe(0.75);
  const txt = informeEnTexto(r);
  expect(txt).toContain("4 personas en la beta");
  expect(txt).toContain("Ojo: con menos de 20 personas");
});

test("sin nadie todavía: el informe sale con guiones, no con errores", () => {
  const r = armarInforme({ perfiles: {}, dias: {} }, "2026-11-11");
  expect(r.personas).toBe(0);
  expect(r.chat.mensajesPorDia).toBeNull();
  expect(r.pc.personasPorPc).toBeNull();
  expect(informeEnTexto(r)).toContain("0 personas en la beta");
});
