// Hestia como JARVIS · L1 (2026-11-17): presencia y personalidad. Solo Hestia (Ikaros en Modo AXS).
// Cuándo puede hablar sola (Interrupciones), la vuelta a casa y los audífonos (Presencia), la bienvenida y el saludo armados por
// código (Llegada), el altavoz (a quién y por dónde), «mis constantes» y las respuestas de siempre (Personalidad).
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import { leerEstado, guardarHablar, cambiarEstado, pausar, _olvidarEstado, PRESENCIA_INICIAL, LIMITES_INICIALES } from "C:/Proyectos/eris/src/services/hestia/Estado.ts";
import { decidir, esNoche, TOPE_HORA, type Aviso, type CtxHablar, type Sensores } from "C:/Proyectos/eris/src/services/hestia/Interrupciones.ts";
import { alCambiar, armarBienvenida, loQueSigue } from "C:/Proyectos/eris/src/services/hestia/Presencia.ts";
import { Altavoz, sensoresDe } from "C:/Proyectos/eris/src/services/hestia/Altavoz.ts";
import { procesarSensores, ojoEquipo, type DepsLlegada } from "C:/Proyectos/eris/src/services/hestia/Llegada.ts";
import { pideConstantes, armarConstantes, musculosAhora, entrenosDeLaSemana } from "C:/Proyectos/eris/src/services/hestia/Constantes.ts";
import { personalidad, esperaRespuesta } from "C:/Proyectos/eris/src/services/hestia/Personalidad.ts";

beforeEach(() => {
  const h = mkdtempSync(join(os.tmpdir(), "erishome_l1_"));
  process.env.USERPROFILE = h; process.env.HOME = h;
  _olvidarEstado();
});

const DIA = new Date(2026, 10, 17, 18, 30); // martes 17-nov, 18:30
const sen = (p: Partial<Sensores> = {}, t = DIA.getTime()): Sensores => ({ audifonos: true, audifonosNombre: "Buds", enCasa: true, noMolestar: false, llamadaTel: false, dirigido: false, t, ...p });
const aviso = (p: Partial<Aviso> = {}): Aviso => ({ clave: "bienvenida", tipo: "bienvenida", prioridad: "normal", titulo: "Bienvenido a casa", texto: "Bienvenido a casa.", ...p });
const ctx = (p: Partial<CtxHablar> = {}): CtxHablar => ({ ahora: DIA, sensores: sen(), enLlamadaHestia: false, sueno: { dormir: 23.5, despertar: 7.5 }, enReunion: false, pausada: false, permitido: true, dichos: [], ...p });

// ─── C5: Interrupciones ───
test("habla sola SOLO con audífonos, de día, sin «no molestar», sin llamada, sin reunión y sin el modo dirigido", () => {
  expect(decidir(aviso(), ctx()).via).toBe("voz");
  expect(decidir(aviso(), ctx({ sensores: sen({ audifonos: false }) }))).toEqual({ via: "notificacion", motivo: "sin audífonos" });
  expect(decidir(aviso(), ctx({ sensores: sen({ noMolestar: true }) })).via).toBe("notificacion");
  expect(decidir(aviso(), ctx({ sensores: sen({ llamadaTel: true }) })).motivo).toBe("estás en una llamada");
  expect(decidir(aviso(), ctx({ sensores: sen({ dirigido: true }) })).via).toBe("notificacion");
  expect(decidir(aviso(), ctx({ enReunion: true })).motivo).toBe("en una reunión");
  expect(decidir(aviso(), ctx({ pausada: true })).motivo).toBe("en pausa");
  expect(decidir(aviso(), ctx({ permitido: false })).motivo).toBe("apagado en el panel");
  // de noche (desde 30 min antes de dormirte hasta tu hora de despertar)
  expect(decidir(aviso(), ctx({ ahora: new Date(2026, 10, 17, 23, 10) })).motivo).toBe("de noche");
  expect(decidir(aviso(), ctx({ ahora: new Date(2026, 10, 18, 6, 0) })).motivo).toBe("de noche");
  // sin datos del teléfono (o viejos: más de 30 min), no sabe si tienes los audífonos → escrito
  expect(decidir(aviso(), ctx({ sensores: null })).motivo).toBe("sin datos del teléfono");
  expect(decidir(aviso(), ctx({ sensores: sen({}, DIA.getTime() - 40 * 60_000) })).via).toBe("notificacion");
});

test("en una llamada con ella lo dice ahí (aunque sea de noche); nada repetido; tope por hora salvo lo urgente", () => {
  expect(decidir(aviso(), ctx({ enLlamadaHestia: true, ahora: new Date(2026, 10, 18, 1, 0) })).via).toBe("llamada");
  const t = DIA.getTime();
  expect(decidir(aviso(), ctx({ dichos: [{ clave: "bienvenida", t: t - 10 * 60_000, via: "notificacion" }] })).via).toBe("nada");
  expect(decidir(aviso(), ctx({ dichos: [{ clave: "bienvenida", t: t - 2 * 3_600_000, via: "voz" }] })).via).toBe("voz");
  const muchos = Array.from({ length: TOPE_HORA }, (_, i) => ({ clave: `x${i}`, t: t - i * 60_000, via: "voz" as const }));
  expect(decidir(aviso(), ctx({ dichos: muchos })).motivo).toBe("tope de la hora");
  expect(decidir(aviso({ clave: "equipo-gpu", tipo: "equipo", prioridad: "urgente" }), ctx({ dichos: muchos })).via).toBe("voz");
});

test("esNoche: con el horario que cruza la medianoche y con el de un trasnochador", () => {
  const h = (hh: number, mm = 0) => new Date(2026, 10, 17, hh, mm);
  expect(esNoche(h(22, 0), { dormir: 23.5, despertar: 7.5 })).toBe(false);
  expect(esNoche(h(23, 0), { dormir: 23.5, despertar: 7.5 })).toBe(true);
  expect(esNoche(h(7, 40), { dormir: 23.5, despertar: 7.5 })).toBe(false);
  // se duerme a las 2:00 y despierta a las 10:00
  expect(esNoche(h(0, 30), { dormir: 2, despertar: 10 })).toBe(false);
  expect(esNoche(h(1, 40), { dormir: 2, despertar: 10 })).toBe(true);
  expect(esNoche(h(9, 30), { dormir: 2, despertar: 10 })).toBe(true);
  expect(esNoche(h(10, 30), { dormir: 2, despertar: 10 })).toBe(false);
  expect(esNoche(h(3, 0), null)).toBe(true); // sin horario: 23:30–7:00
});

// ─── C4 + L1: Presencia ───
test("la vuelta a casa: bienvenida solo tras 1 h fuera, una cada 3 h; la primera lectura no cuenta", () => {
  const P = { ...PRESENCIA_INICIAL };
  // primera lectura: ya en casa (el servidor recién partió): sin bienvenida
  let r = alCambiar(P, null, sen({ enCasa: true }), new Date(2026, 10, 17, 9, 0));
  expect(r.eventos).toEqual([]);
  // sale a las 9:10…
  r = alCambiar(r.presencia, sen(), sen({ enCasa: false, audifonos: false }), new Date(2026, 10, 17, 9, 10));
  expect(r.presencia.fueraDesde).toBeTruthy();
  // …un corte del WiFi de 20 min no es «volver»
  const corta = alCambiar(r.presencia, sen({ enCasa: false }), sen({ enCasa: true }), new Date(2026, 10, 17, 9, 30));
  expect(corta.eventos).toEqual([]);
  // vuelve a las 18:30: bienvenida
  r = alCambiar(r.presencia, sen({ enCasa: false }), sen({ enCasa: true }), DIA);
  expect(r.eventos).toEqual(["bienvenida"]);
  expect(r.presencia.fueraDesde).toBeNull();
  // sale a las 18:40 y vuelve a las 20:00 (1 h 20 fuera, pero hace menos de 3 h de la bienvenida): nada
  const s2 = alCambiar(r.presencia, sen(), sen({ enCasa: false }), new Date(2026, 10, 17, 18, 40));
  expect(alCambiar(s2.presencia, sen({ enCasa: false }), sen({ enCasa: true }), new Date(2026, 10, 17, 20, 0)).eventos).toEqual([]);
});

test("los audífonos: el saludo solo al ponérselos en la mañana, y no si ya estaban (o si ya saludó hoy)", () => {
  const P = { ...PRESENCIA_INICIAL, enCasa: true };
  const m = new Date(2026, 10, 17, 7, 45);
  expect(alCambiar(P, sen({ audifonos: false }), sen({ audifonos: true }), m).eventos).toEqual(["saludo_audifonos"]);
  expect(alCambiar(P, null, sen({ audifonos: true }), m).eventos).toEqual([]); // primera lectura: ya estaban
  expect(alCambiar(P, sen({ audifonos: false }), sen({ audifonos: true }), new Date(2026, 10, 17, 15, 0)).eventos).toEqual([]); // de tarde
  expect(alCambiar({ ...P, saludoAudifonos: m.toDateString() }, sen({ audifonos: false }), sen({ audifonos: true }), m).eventos).toEqual([]);
});

const AGENDA = [
  "🏋️ **Entreno:** toca **Pierna** — sentadilla 4×6.",
  "💧 **Agua:** llevas 1,2 de 2,8 L; para ir al día te faltan 2 vasos (~500 ml).",
  "",
  "**Lo que sigue:**",
  "• Agua: 2 vasos (~500 ml) para ir al día",
  "• Entreno: Pierna (cuando te acomode)",
  "• Cena ~20:30",
].join("\n");

test("la bienvenida: corta, con lo que sigue del día, quién te escribió y el equipo", () => {
  expect(loQueSigue(AGENDA, 3)).toEqual(["agua, 2 vasos (~500 ml) para ir al día", "el entreno de pierna", "la cena a eso de las 20:30"]);
  const t = armarBienvenida({ trato: "Alesito", ahora: DIA, agenda: AGENDA, remitentes: ["Mamá", "Pedro", "Mamá"], equipo: "Ojo con el disco: quedan 18 GB" });
  expect(t).toBe("Bienvenido a casa, Alesito. Lo que sigue: agua, 2 vasos (~500 ml) para ir al día y el entreno de pierna. Te escribieron Mamá y Pedro. Ojo con el disco: quedan 18 GB.");
  expect(t.split(/\s+/).length).toBeLessThanOrEqual(42);
  expect(armarBienvenida({ trato: "señor", mujer: false, ahora: DIA, agenda: "**Lo que sigue:**\n" })).toBe("Bienvenido a casa, señor. Por hoy no te queda nada pendiente.");
  expect(armarBienvenida({ mujer: true, ahora: DIA })).toBe("Bienvenida a casa.");
  expect(armarBienvenida({ ahora: DIA, remitentes: ["A", "B", "C", "D", "E"] })).toContain("Te escribieron A, B, C y 2 más.");
});

test("ojoEquipo: solo lo que cruzó el aviso, lo más importante primero", () => {
  const m: any = { t: "", cpuPct: 20, ramLibreGb: 5, ramTotalGb: 16, discoLibreGb: 18, discoTotalGb: 448, gpu: { tempC: 60 }, modelo: null, bateria: { pct: 90, enchufado: true } };
  expect(ojoEquipo(m, LIMITES_INICIALES)).toBe("Ojo con el disco: quedan 18 GB");
  expect(ojoEquipo({ ...m, gpu: { tempC: 84 } }, LIMITES_INICIALES)).toBe("Ojo: la tarjeta de video está a 84 grados");
  expect(ojoEquipo({ ...m, discoLibreGb: 100 }, LIMITES_INICIALES)).toBeNull();
  expect(ojoEquipo(null, LIMITES_INICIALES)).toBeNull();
});

// ─── C3: el Altavoz ───
function telefono(nombre: string) {
  const enviados: any[] = [];
  return { ws: { data: { role: "ikaros", authenticated: true }, readyState: 1, send: (m: string) => enviados.push(JSON.parse(m)), nombre }, enviados };
}
function altavoz(o: { conexiones: any[]; sintetizar?: (t: string) => Promise<Buffer | null>; reunion?: boolean; log?: string[] }) {
  return new Altavoz({
    conexiones: () => o.conexiones,
    sintetizar: o.sintetizar ?? (async (t) => Buffer.from(`wav:${t}`)),
    sueno: async () => ({ dormir: 23.5, despertar: 7.5 }),
    enReunion: async () => o.reunion === true,
    log: (s) => o.log?.push(s),
  });
}

test("el altavoz: con audífonos lo dice solo al teléfono de los sensores; sin audífonos queda escrito; el equipo, con su canal", async () => {
  const a = telefono("pixel"), b = telefono("tablet");
  const av = altavoz({ conexiones: [a.ws, b.ws] });
  av.actualizar(sen(), a.ws);
  expect(await av.avisar(aviso({ texto: "Bienvenido a casa, Alesito." }), DIA)).toBe("voz");
  expect(a.enviados.map((m) => m.type)).toEqual(["hestia_decir"]);
  expect(Buffer.from(a.enviados[0].wav, "base64").toString()).toContain("Bienvenido a casa");
  expect(b.enviados).toEqual([]); // nunca dos a la vez
  // lo mismo otra vez: nada (ya lo dijo)
  expect(await av.avisar(aviso(), DIA)).toBe("nada");
  // sin audífonos: escrito
  av.actualizar(sen({ audifonos: false }), a.ws);
  expect(await av.avisar(aviso({ clave: "otro" }), DIA)).toBe("notificacion");
  expect(a.enviados.at(-1).type).toBe("hestia_aviso");
  // una alerta del equipo escrita sigue llegando como siempre (hestia_alerta, a «Hestia · equipo»)
  expect(await av.avisar(aviso({ clave: "equipo-discoLibreGb-aviso", tipo: "equipo", texto: "Quedan 18 GB." }), DIA)).toBe("notificacion");
  expect(a.enviados.at(-1)).toMatchObject({ type: "hestia_alerta", nivel: "aviso", texto: "Quedan 18 GB." });
  // el saludo de la mañana no se escribe: si no puede decirlo, nada
  expect(await av.avisar({ ...aviso({ clave: "saludo-hoy", tipo: "saludo" }), soloVoz: true }, DIA)).toBe("nada");
});

test("el altavoz: en una reunión o con Piper caído no habla; en la llamada lo dice ahí; apagado en el panel, escrito", async () => {
  const a = telefono("pixel");
  const enReunion = altavoz({ conexiones: [a.ws], reunion: true });
  enReunion.actualizar(sen(), a.ws);
  expect(await enReunion.avisar(aviso(), DIA)).toBe("notificacion");
  const sinPiper = altavoz({ conexiones: [a.ws], sintetizar: async () => null });
  sinPiper.actualizar(sen(), a.ws);
  expect(await sinPiper.avisar(aviso(), DIA)).toBe("notificacion");
  // en una llamada abierta con ella: es un turno suyo
  const turnos: string[] = [];
  const conLlamada = { ...a.ws, data: { ...a.ws.data, voz: { cerrada: false, history: [], sesion: { ocupada: false, turno: async (_t: string, _f: number, d: any) => { turnos.push(d.respuesta); } } } } };
  const av = altavoz({ conexiones: [conLlamada] });
  av.actualizar(sen({ audifonos: false }), conLlamada);
  expect(await av.avisar(aviso({ texto: "Bienvenido a casa." }), DIA)).toBe("llamada");
  expect(turnos).toEqual(["Bienvenido a casa."]);
  // el panel lo apagó
  await guardarHablar({ bienvenida: false });
  const av2 = altavoz({ conexiones: [a.ws] });
  av2.actualizar(sen(), a.ws);
  expect(await av2.avisar(aviso(), DIA)).toBe("notificacion");
  // en pausa: escrito
  await guardarHablar({ bienvenida: true });
  await pausar("prueba", "panel", null, DIA);
  expect(await altavoz({ conexiones: [a.ws] }).avisar(aviso({ clave: "z" }), DIA)).toBe("notificacion");
});

test("sensoresDe: valida lo que manda el teléfono (es entrada externa)", () => {
  expect(sensoresDe(null)).toBeNull();
  const s = sensoresDe({ audifonos: "sí", enCasa: true, noMolestar: 1, audifonosNombre: "x".repeat(200), t: 5 }, 1_000_000_000_000)!;
  expect(s).toMatchObject({ audifonos: false, enCasa: true, noMolestar: false, llamadaTel: false, dirigido: false, t: 1_000_000_000_000 });
  expect(s.audifonosNombre!.length).toBe(60);
});

// ─── L1: procesarSensores (la llegada, de punta a punta con datos inventados) ───
function deps(av: Altavoz, ws: any, o: Partial<DepsLlegada> = {}): DepsLlegada & { saludo: { dia: string | null } } {
  const saludo = { dia: null as string | null };
  return {
    altavoz: av, ws, perfil: async () => ({ displayName: "Alesito" }), sexo: async () => "h",
    agenda: async () => AGENDA, inmediatas: async () => ["Probar la L1 en el teléfono"], remitentesDesde: async () => ["Mamá"],
    equipo: async () => null, saludoDia: { get: async () => saludo.dia, set: async (d) => { saludo.dia = d; } }, saludo, ...o,
  };
}

test("procesarSensores: volviste a casa con audífonos → Hestia te da la bienvenida (y queda guardado: un reinicio no la repite)", async () => {
  const a = telefono("pixel");
  const av = altavoz({ conexiones: [a.ws] });
  await cambiarEstado((e) => { e.presencia = { ...PRESENCIA_INICIAL, enCasa: false, fueraDesde: new Date(2026, 10, 17, 9, 10).toISOString() }; });
  const r = await procesarSensores({ audifonos: true, enCasa: true, t: DIA.getTime() }, { ...deps(av, a.ws), ahora: DIA });
  expect(r?.eventos).toEqual(["bienvenida"]);
  expect(r?.vias.bienvenida).toBe("voz");
  expect(a.enviados[0].texto).toBe("Bienvenido a casa, Alesito. Lo que sigue: agua, 2 vasos (~500 ml) para ir al día y el entreno de pierna. Te escribió Mamá.");
  _olvidarEstado();
  expect((await leerEstado()).presencia.enCasa).toBe(true);
  expect((await leerEstado()).presencia.ultimaBienvenida).toBe(DIA.toISOString());
});

test("procesarSensores: los audífonos en la mañana → el saludo del día (una vez; no si la llamada ya saludó)", async () => {
  const a = telefono("pixel");
  const av = altavoz({ conexiones: [a.ws] });
  const m = new Date(2026, 10, 17, 7, 50);
  const d = deps(av, a.ws);
  await procesarSensores({ audifonos: false, enCasa: true, t: m.getTime() }, { ...d, ahora: m });
  const r = await procesarSensores({ audifonos: true, enCasa: true, t: m.getTime() }, { ...d, ahora: m });
  expect(r?.vias.saludo_audifonos).toBe("voz");
  expect(a.enviados[0].texto).toMatch(/^Buenos días, Alesito\. Hoy toca Pierna\./);
  expect(d.saludo.dia).toBe(m.toDateString());
  // se los saca y se los vuelve a poner: ya saludó
  await procesarSensores({ audifonos: false, enCasa: true, t: m.getTime() }, { ...d, ahora: m });
  const r2 = await procesarSensores({ audifonos: true, enCasa: true, t: m.getTime() }, { ...d, ahora: new Date(2026, 10, 17, 8, 30) });
  expect(r2?.vias.saludo_audifonos).toBeUndefined();
  expect(a.enviados.length).toBe(1);
});

// ─── L1: «mis constantes» ───
test("pideConstantes: lo que es y lo que no", () => {
  for (const t of ["Hestia, mis constantes", "dame mis constantes", "¿cómo están mis constantes?", "constantes", "reporte de mis constantes", "mis signos vitales"]) expect(pideConstantes(t)).toBe(true);
  for (const t of ["las constantes de Planck", "gastos constantes", "es constante en el gym"]) expect(pideConstantes(t)).toBe(false);
});

test("armarConstantes: pocas cifras, la tendencia y la plata del mes; sin datos, lo dice", () => {
  const r = armarConstantes({
    trato: "Alesito",
    sueno: { debtH: 4.5, need: 7.5, nights: 12, regularity: "algo irregular", trendMinPerDay: 14, avgTotalH: 6.9 },
    musculos: { cargados: ["cuádriceps"], probables: ["glúteos"] },
    agua: { totalL: 1.2, goalL: 2.8, state: "algo_atras", toCatchUp: 0.5 },
    proteina: { comida: 62, meta: 150 },
    plata: { libre: 128_500, porDia: 9_200 },
    entrenosSemana: 2,
  });
  expect(r.voz).toBe("Tus constantes, Alesito. Sueño: debes 4,5 horas de sueño en dos semanas, algo irregular; te duermes cada día 14 minutos más tarde. "
    + "Músculos: cuádriceps viene recién cargado; glúteos, casi listo. Esta semana entrenaste 2 días. Agua: 1,2 de 2,8 litros, algo atrás. "
    + "Proteína: 62 de 150 gramos. Plata: te quedan 129 mil pesos libres este mes, unos 9.200 pesos por día.");
  expect(r.detalle).toContain("💸 Libre este mes: $128.500 ($9.200 por día).");
  expect(armarConstantes({ sueno: null, musculos: null, agua: null, proteina: null, plata: null, entrenosSemana: null }).voz).toMatch(/Todavía no tengo datos/);
});

test("los músculos se ponen al día con la hora de ahora; los días entrenados cuentan desde el lunes", () => {
  const rec: any = { musculos: [{ nombre: "Pecho", hoursAgo: 20, range: [36, 60] }, { nombre: "Espalda", hoursAgo: 40, range: [36, 60] }], personal: "", pares: 0 };
  expect(musculosAhora(rec, null, DIA)).toEqual({ cargados: ["pecho"], probables: ["espalda"] });
  // calculado hace 24 h: el pecho ya va en 44 h (casi listo) y la espalda en 64 h (lista)
  expect(musculosAhora(rec, new Date(DIA.getTime() - 24 * 3_600_000).toISOString(), DIA)).toEqual({ cargados: [], probables: ["pecho"] });
  expect(entrenosDeLaSemana([{ day: "2026-11-15" }, { day: "2026-11-16" }, { day: "2026-11-17" }, { day: "2026-11-17" }], DIA)).toBe(2); // lunes 16 y martes 17
  expect(entrenosDeLaSemana(undefined, DIA)).toBeNull();
});

// ─── L1: la personalidad ───
test("la personalidad: «¿estás ahí?», «gracias», «eso es todo» (cuelga en la llamada); con una pregunta suya pendiente, no", () => {
  const par = new Date(2026, 10, 17, 18, 30), impar = new Date(2026, 10, 17, 18, 31);
  expect(personalidad("Hestia, ¿estás ahí?", { trato: "Alesito", ahora: par })?.texto).toBe("Para ti, siempre, Alesito.");
  expect(personalidad("¿estás ahí?", { trato: "Alesito", ahora: impar })?.texto).toBe("Aquí, como siempre.");
  expect(personalidad("gracias Hestia", { trato: "Alesito", ahora: par })?.texto).toBe("A tu servicio, Alesito.");
  expect(personalidad("muchas gracias", { trato: "señor", ahora: par })?.texto).toBe("A su servicio, señor.");
  expect(personalidad("¿me escuchas?", { ahora: par })?.texto).toBe("Fuerte y claro.");
  const fin = personalidad("Hestia, eso es todo", { trato: "Alesito", ahora: par, enLlamada: true });
  expect(fin).toEqual({ texto: "Que te vaya bien, Alesito.", colgar: true });
  expect(personalidad("eso sería todo, gracias", { trato: "señor", ahora: new Date(2026, 10, 17, 23, 0) })).toEqual({ texto: "Que descanse, señor.", colgar: false });
  // lo que trae otra cosa, no
  for (const t of ["gracias, ¿y qué tengo mañana?", "¿estás ahí? anota 2 vasos de agua", "eso es todo lo que comí hoy", "buena"]) expect(personalidad(t, { ahora: par })).toBeNull();
  expect(esperaRespuesta("¿Te lo anoto?")).toBe(true);
  expect(esperaRespuesta("Listo. ¿Algo más?")).toBe(false);
  expect(esperaRespuesta("Anotado.")).toBe(false);
});
