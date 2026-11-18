// Hestia como JARVIS · L2 (2026-11-17): avisos que hablan. Solo Hestia (Ikaros en Modo AXS).
// Lo que manda el teléfono (eventoDe), la llamada que entra mientras suena, los mensajes de los importantes (solo de quién), el
// cargo raro (sin el monto en voz alta con el teléfono bloqueado), la agenda en voz (reunión en 15 minutos, la hora del remedio),
// lo que respondes por voz y «avísame cuando me escriba Pedro».
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import { leerEstado, guardarHablar, guardarImportantes, agregarImportante, quitarImportante, limpiarImportantes, claveHablar, _olvidarEstado } from "C:/Proyectos/eris/src/services/hestia/Estado.ts";
import { decidir, enUnaLlamada, type Aviso, type CtxHablar, type Sensores } from "C:/Proyectos/eris/src/services/hestia/Interrupciones.ts";
import { Altavoz, sensoresDe } from "C:/Proyectos/eris/src/services/hestia/Altavoz.ts";
import {
  eventoDe, avisoLlamada, avisoMensaje, avisoCargo, importanteDe, coincide, avisosAgenda, comandoLlamada, responderPregunta,
  pideImportantes, nombreOriginal, registrarLlamada, llamadaEntrante, textoQuienLlama, pareceNumero, _olvidarLlamada,
  type EventoLlamada, type EventoMensaje, type EventoCargo,
} from "C:/Proyectos/eris/src/services/hestia/Avisos.ts";
import { comandoHestia } from "C:/Proyectos/eris/src/services/hestia/Comandos.ts";

beforeEach(() => {
  const h = mkdtempSync(join(os.tmpdir(), "erishome_l2_"));
  process.env.USERPROFILE = h; process.env.HOME = h;
  _olvidarEstado();
  _olvidarLlamada();
});

const DIA = new Date(2026, 10, 17, 18, 30); // martes 17-nov, 18:30
const sen = (p: Partial<Sensores> = {}, t = DIA.getTime()): Sensores => ({ audifonos: true, audifonosNombre: "Buds", enCasa: true, noMolestar: false, llamadaTel: false, dirigido: false, t, ...p });
const ctx = (p: Partial<CtxHablar> = {}): CtxHablar => ({ ahora: DIA, sensores: sen(), enLlamadaHestia: false, sueno: { dormir: 23.5, despertar: 7.5 }, enReunion: false, pausada: false, permitido: true, dichos: [], ...p });
const llamada = (p: Partial<EventoLlamada> = {}): EventoLlamada => ({ tipo: "llamada", estado: "sonando", de: "Mamá", conocido: true, app: "Teléfono", spam: false, final4: null, clave: "k1", t: DIA.getTime(), ...p });
const mensaje = (p: Partial<EventoMensaje> = {}): EventoMensaje => ({ tipo: "mensaje", de: "Pedro Pérez", chat: "Pedro Pérez", grupo: false, app: "WhatsApp", t: DIA.getTime(), ...p });
const cargo = (p: Partial<EventoCargo> = {}): EventoCargo => ({ tipo: "cargo", id: "bci|123", txId: 77, monto: 89990, comercio: "Falabella", razon: "un comercio nuevo", porConfirmar: false, t: DIA.getTime(), ...p });

function telefono() {
  const enviados: any[] = [];
  return { ws: { data: { role: "ikaros", authenticated: true }, readyState: 1, send: (m: string) => enviados.push(JSON.parse(m)) }, enviados };
}
function altavoz(conexiones: any[], reunion = false) {
  let preguntoReunion = 0;
  const av = new Altavoz({
    conexiones: () => conexiones,
    sintetizar: async (t) => Buffer.from(`wav:${t}`),
    sueno: async () => ({ dormir: 23.5, despertar: 7.5 }),
    enReunion: async () => { preguntoReunion++; return reunion; },
  });
  return { av, reuniones: () => preguntoReunion };
}

// ─── Lo que manda el teléfono ───
test("eventoDe: valida la llamada, el mensaje y el cargo (entrada externa); nunca hay texto de mensajes", () => {
  expect(eventoDe(null)).toBeNull();
  expect(eventoDe({ tipo: "llamada", estado: "x" })).toBeNull();
  const l = eventoDe({ tipo: "llamada", estado: "sonando", de: "Mamá\n\u0000", conocido: true, app: "Teléfono", final4: "12345", clave: "a" }) as EventoLlamada;
  expect(l).toMatchObject({ de: "Mamá", conocido: true, final4: null, spam: false });
  // un número no es un contacto, aunque diga «conocido»
  expect((eventoDe({ tipo: "llamada", estado: "sonando", de: "+56 9 1234 5678", conocido: true, final4: "5678" }) as EventoLlamada).conocido).toBe(false);
  const m = eventoDe({ tipo: "mensaje", de: "Pedro", texto: "esto no debería pasar", grupo: "sí" }) as any;
  expect(m).toMatchObject({ de: "Pedro", chat: "Pedro", grupo: false });
  expect(m.texto).toBeUndefined();
  expect(eventoDe({ tipo: "cargo", id: "x", monto: -5 })).toBeNull();
  expect(eventoDe({ tipo: "cargo", id: "x", monto: "89990.4", comercio: "Lider" })).toMatchObject({ monto: 89990, comercio: "Lider", txId: null });
  expect(pareceNumero("Privado")).toBe(true);
  expect(pareceNumero("Mamá")).toBe(false);
});

test("sensoresDe: lo nuevo de L2 (sonando, en curso, bloqueado) solo si viene; las Interrupciones con la app vieja siguen igual", () => {
  const s = sensoresDe({ audifonos: true, sonando: true, enCurso: false, bloqueado: true })!;
  expect(s).toMatchObject({ sonando: true, enCurso: false, bloqueado: true });
  expect("sonando" in sensoresDe({ audifonos: true })!).toBe(false);
  // app vieja: llamadaTel incluye el timbre
  expect(enUnaLlamada(sen({ llamadaTel: true }))).toBe(true);
  expect(enUnaLlamada(sen({ llamadaTel: true }), true)).toBe(false);
  // app nueva: sonando ≠ en curso
  expect(enUnaLlamada(sen({ llamadaTel: true, sonando: true, enCurso: false }), true)).toBe(false);
  expect(enUnaLlamada(sen({ llamadaTel: true, sonando: true, enCurso: false }))).toBe(true);
  expect(enUnaLlamada(sen({ llamadaTel: true, sonando: false, enCurso: true }), true)).toBe(true);
});

// ─── La llamada que entra ───
test("la llamada se anuncia MIENTRAS suena (con audífonos); lo demás espera a que deje de sonar; en otra llamada, nada", () => {
  const a = avisoLlamada(llamada(), { trato: "Alesito" });
  expect(a.texto).toBe("Alesito, te llama Mamá.");
  expect(a).toMatchObject({ prioridad: "urgente", soloVoz: true, sinReunion: true });
  const sonando = sen({ llamadaTel: true, sonando: true, enCurso: false });
  expect(decidir(a, ctx({ sensores: sonando })).via).toBe("voz");
  // otro aviso mientras suena: espera
  const otro: Aviso = { clave: "x", tipo: "mensaje", prioridad: "normal", titulo: "", texto: "Te escribió Pedro." };
  expect(decidir(otro, ctx({ sensores: sonando })).motivo).toBe("está sonando el teléfono");
  // en otra llamada (en espera): no se habla encima
  expect(decidir(a, ctx({ sensores: sen({ llamadaTel: true, sonando: true, enCurso: true }) })).motivo).toBe("estás en una llamada");
  // el panel la apagó
  expect(claveHablar("llamada")).toBe("llamadas");
  expect(claveHablar("reunion")).toBe("agenda");
});

test("los textos de la llamada: WhatsApp, número sin guardar (los últimos dígitos uno a uno), privado, spam, «señor»", () => {
  expect(avisoLlamada(llamada({ app: "WhatsApp" })).texto).toBe("Te llama Mamá por WhatsApp.");
  expect(avisoLlamada(llamada({ de: "+56 9 1234 5678", conocido: false, final4: "5678" })).texto).toBe("Te llama un número que no tienes guardado, terminado en 5 6 7 8.");
  expect(avisoLlamada(llamada({ de: null, conocido: false })).texto).toBe("Te llama un número privado.");
  expect(avisoLlamada(llamada({ de: "+56 2 2222 0000", conocido: false, final4: "0000", spam: true })).texto).toContain("puede ser spam");
  expect(avisoLlamada(llamada(), { trato: "Señor" }).texto).toBe("Señor, le llama Mamá.");
  // en la llamada con ella pregunta si contesta
  expect(avisoLlamada(llamada()).enLaLlamada).toMatchObject({ texto: "Te llama Mamá. ¿Contesto?", pregunta: { tipo: "llamada", de: "Mamá" } });
});

test("la llamada que suena: «contesta», «recházala» / «cuelga», «¿quién llama?»; se olvida al contestar o al minuto", () => {
  expect(comandoLlamada("Hestia, contesta")).toBe("contestar");
  expect(comandoLlamada("contéstala por favor")).toBe("contestar");
  expect(comandoLlamada("recházala")).toBe("rechazar");
  expect(comandoLlamada("cuelga")).toBe("rechazar");
  expect(comandoLlamada("¿Quién me llama?")).toBe("quien");
  expect(comandoLlamada("contesta el mensaje de Pedro")).toBeNull();
  registrarLlamada(llamada());
  expect(llamadaEntrante(DIA.getTime() + 10_000)?.de).toBe("Mamá");
  expect(textoQuienLlama(llamadaEntrante(DIA.getTime())!, "Alesito")).toBe("Alesito, te llama Mamá.");
  expect(llamadaEntrante(DIA.getTime() + 120_000)).toBeNull();
  registrarLlamada(llamada({ estado: "fin" }));
  expect(llamadaEntrante(DIA.getTime())).toBeNull();
});

test("lo que respondes a «¿Contesto?»: sí contesta, «recházala» rechaza, «no» la deja sonar, otra cosa no es respuesta", () => {
  const p = { tipo: "llamada" as const, de: "Mamá", t: 0 };
  expect(responderPregunta("sí", p)?.accion).toBe("contestar");
  expect(responderPregunta("dale, contesta", p)?.accion).toBe("contestar");
  expect(responderPregunta("no, recházala", p)?.accion).toBe("rechazar");
  expect(responderPregunta("cuélgale", p)?.accion).toBe("rechazar");
  expect(responderPregunta("no", p)?.accion).toBe("dejar");
  expect(responderPregunta("¿qué hora es?", p)).toBeNull();
});

// ─── Los mensajes de tus importantes ───
test("mensajes: solo de los importantes (por nombre, sin tildes ni emojis), del grupo si el grupo es importante; nunca el texto", () => {
  const imp = ["Mamá", "Pedro", "Familia"];
  expect(coincide("Mamá ❤️", imp)).toBe("Mamá");
  expect(coincide("mama", imp)).toBe("Mamá");
  expect(coincide("Pedro Pérez", imp)).toBe("Pedro");
  expect(coincide("Juan Pedro", imp)).toBeNull();
  expect(importanteDe(mensaje({ de: "Carla", chat: "Carla" }), imp)).toBeNull();
  expect(importanteDe(mensaje({ de: "Tía Rosa", chat: "Familia", grupo: true }), imp)).toEqual({ quien: "Familia", porGrupo: true });
  const a = avisoMensaje(mensaje(), importanteDe(mensaje(), imp)!, { trato: "Alesito" });
  expect(a.texto).toBe("Alesito, te escribió Pedro Pérez por WhatsApp.");
  expect(a).toMatchObject({ soloVoz: true, repetirMin: 20, externo: true, clave: "mensaje-pedro perez" });
  expect(avisoMensaje(mensaje({ de: "Tía Rosa", chat: "Familia", grupo: true }), { quien: "Familia", porGrupo: true }).texto).toBe("Hay mensajes nuevos en el grupo Familia por WhatsApp.");
  expect(avisoMensaje(mensaje({ app: "Mensajes" }), { quien: "Pedro Pérez", porGrupo: false }).texto).toBe("Te escribió Pedro Pérez por mensaje de texto.");
  // en la llamada: «¿Te lo leo?» → «sí» = «lee los mensajes de Pedro Pérez» (con sus reglas)
  expect(responderPregunta("sí", { tipo: "mensaje", de: "Pedro Pérez" })).toEqual({ accion: "leer", texto: "lee los mensajes de Pedro Pérez" });
  expect(responderPregunta("no, después", { tipo: "mensaje", de: "Pedro" })?.accion).toBe("dejar");
  // si sigue escribiendo, una vez cada 20 minutos
  const c = ctx({ dichos: [{ clave: a.clave, t: DIA.getTime() - 10 * 60_000, via: "voz" }] });
  expect(decidir(a, c).via).toBe("nada");
  expect(decidir(a, { ...c, dichos: [{ clave: a.clave, t: DIA.getTime() - 25 * 60_000, via: "voz" }] }).via).toBe("voz");
});

test("«avísame cuando me escriba Pedro»: agrega, no repite, quita y lista (con tildes y mayúsculas como lo dijo)", async () => {
  expect(pideImportantes("Hestia, avísame cuando me escriba Mamá")).toEqual({ agregar: "Mamá" });
  expect(pideImportantes("avísame si me escribe la Carla por WhatsApp")).toEqual({ agregar: "Carla" });
  expect(pideImportantes("agrega a José Pérez como importante")).toEqual({ agregar: "José Pérez" });
  expect(pideImportantes("deja de avisarme de Pedro")).toEqual({ quitar: "Pedro" });
  expect(pideImportantes("¿de quién me avisas?")).toEqual({ lista: true });
  expect(pideImportantes("avísame a las 8")).toBeNull();
  expect(pideImportantes("¿quién me escribió?")).toBeNull();
  expect(nombreOriginal("avísame cuando me escriba MAMÁ!", "mama")).toBe("MAMÁ");
  expect(await comandoHestia("avísame cuando me escriba Mamá", { trato: "Alesito", por: "voz" })).toMatch(/^Listo, Alesito: cuando te escriba Mamá, te aviso/);
  expect(await comandoHestia("avísame cuando me escriba mama", { por: "voz" })).toBe("Ya te aviso cuando te escribe Mamá.");
  expect(await comandoHestia("avísame cuando me escriba Pedro", { por: "chat" })).toMatch(/Pedro/);
  expect((await leerEstado()).importantes).toEqual(["Mamá", "Pedro"]);
  expect(await comandoHestia("¿de quién me avisas?", { por: "voz" })).toMatch(/^Te aviso cuando te escriben Mamá y Pedro/);
  expect(await comandoHestia("deja de avisarme de Pedro", { por: "voz" })).toBe("Listo, ya no te aviso de Pedro.");
  expect(await comandoHestia("deja de avisarme de Carla", { por: "voz" })).toBe("Carla no estaba entre los que te aviso.");
  expect(await agregarImportante("MAMA")).toBe(false);
  expect(await quitarImportante("mamá")).toBe("Mamá");
  // el panel: la lista entera, limpia
  await guardarImportantes(["  Ana  ", "ana", 5, "x".repeat(80)]);
  expect((await leerEstado()).importantes).toEqual(["Ana", "x".repeat(40)]);
  expect(limpiarImportantes(Array.from({ length: 50 }, (_, i) => `P${i}`)).length).toBe(30);
});

// ─── El cargo fuera de lo común ───
test("el cargo: con el teléfono bloqueado (o sin saberlo) no dice el monto; escrito sí; botones; la respuesta por voz", () => {
  const des = avisoCargo(cargo(), { trato: "Alesito", bloqueado: false });
  expect(des.texto).toBe("Ojo, Alesito: un cargo de $89.990 en Falabella, un comercio nuevo. ¿Lo reconoces?");
  const bloq = avisoCargo(cargo(), { bloqueado: true });
  expect(bloq.texto).not.toMatch(/\d|Falabella/);
  expect(bloq.escrito).toBe("$89.990 en Falabella · un comercio nuevo.");
  expect(bloq).toMatchObject({ botones: "cargo", datos: { id: "bci|123", txId: 77 } });
  // en la llamada con ella: según la llamada (desbloqueada) aunque los sensores digan bloqueado
  expect(avisoCargo(cargo(), { bloqueado: true, bloqueadoLlamada: false }).enLaLlamada!.texto).toMatch(/\$89\.990/);
  const p = { tipo: "cargo" as const, id: "bci|123", t: 0 };
  expect(responderPregunta("sí, era yo", p)).toMatchObject({ accion: "cargo", era: true });
  expect(responderPregunta("fui yo", p)).toMatchObject({ era: true });
  expect(responderPregunta("no lo reconozco", p)).toMatchObject({ era: false });
  expect(responderPregunta("no", p)).toMatchObject({ era: false });
  expect((responderPregunta("no", p) as any).decir).toMatch(/llama a tu banco/);
  expect(responderPregunta("¿cuánto gasté hoy?", p)).toBeNull();
});

test("el altavoz: el cargo con audífonos se dice Y queda la notificación con botones; sin audífonos, escrita con el monto", async () => {
  const a = telefono();
  const { av } = altavoz([a.ws]);
  av.actualizar(sen({ bloqueado: true }), a.ws);
  expect(await av.avisar(avisoCargo(cargo(), { bloqueado: true }), DIA)).toBe("voz");
  const m = a.enviados.at(-1);
  expect(m).toMatchObject({ type: "hestia_decir", nota: true, botones: "cargo", escrito: "$89.990 en Falabella · un comercio nuevo." });
  expect(m.texto).not.toMatch(/\d/);
  av.actualizar(sen({ audifonos: false }), a.ws);
  expect(await av.avisar(avisoCargo(cargo({ id: "otro" }), { bloqueado: true }), DIA)).toBe("notificacion");
  expect(a.enviados.at(-1)).toMatchObject({ type: "hestia_aviso", botones: "cargo", texto: "$89.990 en Falabella · un comercio nuevo." });
  // apagado en el panel: escrito igual (es plata: que quede)
  await guardarHablar({ cargos: false });
  av.actualizar(sen(), a.ws);
  expect(await av.avisar(avisoCargo(cargo({ id: "tercero" }), { bloqueado: false }), DIA)).toBe("notificacion");
});

test("el altavoz: la llamada no mira el calendario; en la llamada con ella la pregunta queda esperando y lo urgente corta", async () => {
  const a = telefono();
  const { av, reuniones } = altavoz([a.ws], true);
  av.actualizar(sen({ sonando: true, enCurso: false, llamadaTel: true }), a.ws);
  expect(await av.avisar(avisoLlamada(llamada()), DIA)).toBe("voz");
  expect(reuniones()).toBe(0);
  expect(a.enviados.at(-1)).toMatchObject({ type: "hestia_decir", soloVoz: true });
  // sin audífonos: la llamada no se escribe (ya suena el teléfono)
  av.actualizar(sen({ audifonos: false }), a.ws);
  expect(await av.avisar(avisoLlamada(llamada({ clave: "k2" })), DIA)).toBe("nada");
  // en la llamada con Hestia, ocupada en otro turno: lo urgente corta y deja la pregunta
  const turnos: string[] = [];
  const voz: any = { cerrada: false, history: [], sesion: { ocupada: true, turno: async (_t: string, _f: number, d: any) => { turnos.push(d.respuesta); } } };
  const b = { ...a.ws, data: { ...a.ws.data, voz } };
  const { av: av2 } = altavoz([b]);
  expect(await av2.avisar(avisoLlamada(llamada({ clave: "k3" })), DIA)).toBe("llamada");
  expect(turnos).toEqual(["Te llama Mamá. ¿Contesto?"]);
  expect(voz.preguntaAviso).toMatchObject({ tipo: "llamada", de: "Mamá" });
  // un mensaje (normal) con la llamada ocupada no la corta
  voz.preguntaAviso = null;
  expect(await av2.avisar(avisoMensaje(mensaje(), { quien: "Pedro", porGrupo: false }), DIA)).not.toBe("llamada");
  // y lo que dice de otros (nombres de grupos, títulos) va al historial como dato
  voz.sesion.ocupada = false;
  await av2.avisar(avisoMensaje(mensaje({ de: "Ana" }), { quien: "Ana", porGrupo: false }), DIA);
  expect(voz.history.at(-1).trace).toMatchObject({ externo: true });
  expect(av2.escuchando(DIA.getTime())).toBe(true);
});

// ─── La agenda en voz ───
test("la agenda: la reunión entre 8 y 15 minutos antes; los remedios a su hora (hasta 5 min) si esa toma no está anotada", () => {
  const ahora = new Date(2026, 10, 17, 8, 1);
  const ev = (min: number, titulo = "Reunión con Pedro", todoElDia = false) => ({ titulo, inicio: ahora.getTime() + min * 60_000, fin: ahora.getTime() + (min + 30) * 60_000, todoElDia });
  const sups = {
    items: [
      { id: "a", nombre: "Creatina", horas: [8], aviso: true, activo: true },
      { id: "b", nombre: "Vitamina D", horas: [8, 20], aviso: true, activo: true },
      { id: "c", nombre: "Magnesio", horas: [8], aviso: false, activo: true },
      { id: "d", nombre: "Omega 3", horas: [8], aviso: true, activo: false },
    ], log: {} as Record<string, Record<string, number>>,
  };
  const xs = avisosAgenda({ ahora, eventos: [ev(15), ev(30, "Otra"), ev(5, "Ya casi"), ev(12, "Feriado", true)], sups, trato: "Alesito" });
  expect(xs.map((x) => x.texto)).toEqual(["Alesito, en 15 minutos empieza «Reunión con Pedro».", "Alesito, hora de tomar Creatina y Vitamina D."]);
  expect(xs.every((x) => x.soloVoz)).toBe(true);
  expect(xs[0]).toMatchObject({ tipo: "reunion", externo: true });
  // ya se tomó la creatina: solo la vitamina
  sups.log["2026-11-17"] = { a: 1 };
  expect(avisosAgenda({ ahora, eventos: [], sups }).map((x) => x.texto)).toEqual(["Hora de tomar Vitamina D."]);
  // 6 minutos después, ya no
  expect(avisosAgenda({ ahora: new Date(2026, 10, 17, 8, 6), eventos: [], sups })).toEqual([]);
  // la segunda toma (20:00) cuenta la primera
  sups.log["2026-11-17"] = { b: 1 };
  expect(avisosAgenda({ ahora: new Date(2026, 10, 17, 20, 2), eventos: [], sups }).map((x) => x.texto)).toEqual(["Hora de tomar Vitamina D."]);
  sups.log["2026-11-17"] = { b: 2 };
  expect(avisosAgenda({ ahora: new Date(2026, 10, 17, 20, 2), eventos: [], sups })).toEqual([]);
});
