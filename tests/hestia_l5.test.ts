// Hestia como JARVIS · L5 (2026-11-18): los protocolos. Lo que se dice (por código), la alarma para dormir, cada paso con un
// teléfono falso (lo que de verdad pasó), el «No molestar» con las interrupciones, el término con tiempo, crear, borrar y
// restaurar, y lo que no va en un protocolo (mensajes, llamadas).
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import {
  entender, comandoProtocolo, activar, terminar, vencido, calcularAlarma, textoAlarma, pasosDe, nombreYPasos, buscarProtocolo, listaProtocolos,
  protocoloVigente, tomasMientras, textoCierre, minutosDichos, horasDichas, alLlegar, PROTOCOLOS_BASE, _olvidarProtocolos, type DepsProtocolo, type CtxProtocolo,
} from "C:/Proyectos/eris/src/services/hestia/Protocolos.ts";
import { leerEstado, cambiarEstado, _olvidarEstado } from "C:/Proyectos/eris/src/services/hestia/Estado.ts";
import { protocoloSano } from "C:/Proyectos/eris/src/services/hestia/ProtocoloTipos.ts";
import { decidir, type Aviso, type CtxHablar } from "C:/Proyectos/eris/src/services/hestia/Interrupciones.ts";
import { parseTelefono, permitidoBloqueado } from "C:/Proyectos/eris/src/services/TelefonoParse.ts";
import { puedeFondo } from "C:/Proyectos/eris/src/services/hestia/Presupuesto.ts";
import { LIMITES_INICIALES } from "C:/Proyectos/eris/src/services/hestia/Estado.ts";
import type { TelefonoOp } from "C:/Proyectos/eris/src/services/TelefonoBridge.ts";

beforeEach(() => {
  const h = mkdtempSync(join(os.tmpdir(), "erishome_l5_"));
  process.env.USERPROFILE = h; process.env.HOME = h;
  _olvidarEstado(); _olvidarProtocolos();
});

/** Un teléfono falso: anota lo pedido y contesta como Hestia Manos */
function telefono(o: { sinMusica?: boolean; sinDnd?: boolean; viejo?: boolean; eventos?: any[]; bateria?: number; cargando?: boolean } = {}) {
  const ops: TelefonoOp[] = [];
  const fn = async (op: TelefonoOp) => {
    ops.push(op);
    switch (op.accion) {
      case "no_molestar":
        if (o.viejo) return { ok: false, code: "desconocida", msg: "No sé hacer «no_molestar» todavía." };
        if (o.sinDnd) return { ok: false, code: "sin_acceso", msg: "a Hestia Manos le falta el acceso a «No molestar»" };
        return { ok: true, data: { encendido: op.encender !== false, ...(op.minutos ? { hasta: Date.now() + op.minutos * 60_000 } : {}) } };
      case "musica": return o.sinMusica ? { ok: false, code: "sin_musica", msg: "No está sonando nada." } : { ok: true, data: { cancion: "Back in Black", artista: "AC/DC", app: "Spotify", sonando: true } };
      case "abrir_app": return { ok: true, data: { app: op.nombre } };
      case "alarma": return { ok: true, data: { hora: op.hora, minuto: op.minuto } };
      case "eventos": return { ok: true, data: { eventos: o.eventos ?? [] } };
      case "bateria": return { ok: true, data: { porcentaje: o.bateria ?? 80, cargando: o.cargando ?? false } };
      case "volumen": return { ok: true, data: { porcentaje: op.cambio === "silencio" ? 0 : 40 } };
      default: return { ok: true, data: {} };
    }
  };
  return { ops, fn };
}
function deps(tel: ReturnType<typeof telefono> | null, o: Partial<DepsProtocolo> = {}): DepsProtocolo {
  return {
    telefono: tel ? (tel.fn as any) : null, apps: ["Spotify", "WhatsApp", "Reloj", "Calendar"], entrenador: null,
    sueno: async () => ({ need: 8, debtH: 1 }),
    cierre: async () => ({ kcal: { comida: 1850, meta: 2300 }, proteina: { comida: 120, meta: 150 }, agua: { totalL: 2.1, goalL: 2.8 }, entrenoHoy: true }),
    agenda: async () => "Hoy te queda la cena.", bienvenida: async () => "Bienvenido a casa, Alesito.", constantes: async () => "Tus constantes.",
    sups: async () => null, trabajosPendientes: async () => 0, ...o,
  };
}
const ctx = (d: DepsProtocolo, o: Partial<CtxProtocolo> = {}): CtxProtocolo => ({ profileId: "p1", trato: "Alesito", por: "voz", deps: d, ...o });

test("lo que se dice: activar (con tiempo), terminar, estado, listar, describir, crear, borrar, restaurar y lo natural (que se pregunta)", () => {
  expect(entender("Hestia, protocolo gimnasio")).toEqual({ que: "activar", nombre: "gimnasio", minutos: null, modo: false });
  expect(entender("activa el protocolo foco por 25 minutos")).toEqual({ que: "activar", nombre: "foco", minutos: 25, modo: false });
  expect(entender("modo foco una hora")).toMatchObject({ que: "activar", nombre: "foco una hora" });
  expect(entender("modo foco por una hora")).toEqual({ que: "activar", nombre: "foco", minutos: 60, modo: true });
  expect(entender("inicia el protocolo salir de casa")).toEqual({ que: "activar", nombre: "salir de casa", minutos: null, modo: false });
  expect(entender("termina el protocolo")).toEqual({ que: "terminar", nombre: null, explicito: true });
  expect(entender("ya terminé el foco")).toEqual({ que: "terminar", nombre: "foco", explicito: false });
  expect(entender("¿cuánto le queda al foco?")).toEqual({ que: "estado" });
  expect(entender("¿qué protocolos tengo?")).toEqual({ que: "listar" });
  expect(entender("¿qué hace el protocolo dormir?")).toEqual({ que: "describir", nombre: "dormir" });
  expect(entender("crea un protocolo lectura que ponga no molestar por una hora")).toMatchObject({ que: "crear" });
  expect(entender("borra el protocolo lectura")).toEqual({ que: "borrar", nombre: "lectura" });
  expect(entender("restaura el protocolo gimnasio como venía")).toEqual({ que: "restaurar", nombre: "gimnasio" });
  expect(entender("me voy a dormir")).toEqual({ que: "sugerir", nombre: "dormir" });
  expect(entender("voy al gym")).toEqual({ que: "sugerir", nombre: "gimnasio" });
  // no es de esto
  for (const t of ["pon el celular en silencio", "¿qué hora es?", "pon una alarma a las 7", "terminé", "investiga los protocolos de seguridad y me avisas"]) expect([t, entender(t)]).toEqual([t, null]);
});

test("los nombres: alias, «el gym», tu versión de uno de los que vienen y los tuyos", () => {
  const l = listaProtocolos({ protocolos: [] });
  expect(l.map((p) => p.nombre)).toEqual(["gimnasio", "dormir", "foco", "salir", "casa"]);
  expect(buscarProtocolo("el gym", l)?.nombre).toBe("gimnasio");
  expect(buscarProtocolo("modo concentración", l)?.nombre).toBe("foco");
  expect(buscarProtocolo("salir de casa", l)?.nombre).toBe("salir");
  expect(buscarProtocolo("dorm", l)?.nombre).toBe("dormir");
  expect(buscarProtocolo("cine", l)).toBeNull();
});

test("la alarma para dormir: lo que necesitas (y media hora más con deuda) o una hora antes de lo primero de mañana", () => {
  const noche = new Date(2026, 10, 18, 23, 0);
  const a = calcularAlarma(noche, { need: 8, debtH: 1 }, []);
  expect([a.hora, a.minuto, a.motivo]).toEqual([7, 15, "necesidad"]);
  expect(textoAlarma(a)).toBe("Alarma a las 7:15: tus 8 horas de sueño");
  const d = calcularAlarma(noche, { need: 7.5, debtH: 4 }, []);
  expect([d.hora, d.minuto, d.extraPorDeuda]).toEqual([7, 15, true]);
  expect(textoAlarma(d)).toContain("y media hora más, por la deuda de sueño");
  const reunion = { titulo: "Reunión con Brian", inicio: new Date(2026, 10, 19, 7, 30).getTime(), fin: 0, todoElDia: false };
  const r = calcularAlarma(noche, { need: 8, debtH: 0 }, [reunion, { titulo: "Feriado", inicio: new Date(2026, 10, 19, 0, 0).getTime(), fin: 0, todoElDia: true }]);
  expect([r.hora, r.minuto, r.motivo]).toEqual([6, 30, "agenda"]);
  expect(textoAlarma(r)).toBe("Alarma a las 6:30: mañana a las 7:30 tienes «Reunión con Brian», así que dormirías 7 horas y 15 minutos, menos de tus 8 horas");
  // (algo dentro de las próximas 3 horas no cuenta: no te despierta a la 1)
  expect(calcularAlarma(noche, null, [{ titulo: "x", inicio: new Date(2026, 10, 19, 1, 0).getTime(), fin: 0, todoElDia: false }]).motivo).toBe("necesidad");
  expect(minutosDichos(50)).toBe("50 minutos");
  expect(minutosDichos(150)).toBe("2 horas y media");
  expect(horasDichas(6.75)).toBe("6 horas y 45 minutos");
});

test("protocolo gimnasio: No molestar por lo que dura, tu música y el entrenador; queda activo y Hestia habla solo lo urgente", async () => {
  const tel = telefono();
  const ahora = new Date(2026, 10, 18, 18, 0);
  const r = await comandoProtocolo("Hestia, protocolo gimnasio", ctx(deps(tel, { entrenador: async () => "Vamos con press de banca: serie 1 de 4, 60 kilos por 8." }), { ahora }));
  expect(r?.texto).toBe("Protocolo gimnasio, Alesito. No molestar hasta las 20:30 y la música sonando («Back in Black»). Vamos con press de banca: serie 1 de 4, 60 kilos por 8.");
  expect(r?.externo).toBe(true); // (el nombre de la canción lo escribieron otros)
  expect(tel.ops.map((o) => o.accion)).toEqual(["no_molestar", "musica"]);
  expect(tel.ops[0]).toEqual({ accion: "no_molestar", encender: true, minutos: 150 });
  const act = protocoloVigente(await leerEstado(), ahora);
  expect(act).toMatchObject({ nombre: "gimnasio", hablar: "urgente", dnd: true, aviso: true });
  // las interrupciones: con el No molestar que puso el protocolo, lo urgente (una llamada) sí; un mensaje, no
  const sens = { audifonos: true, enCasa: false, noMolestar: true, llamadaTel: false, dirigido: false, t: ahora.getTime() };
  const base: CtxHablar = { ahora, sensores: sens, enLlamadaHestia: false, sueno: null, enReunion: false, pausada: false, permitido: true, dichos: [], protocolo: act };
  const llamada: Aviso = { clave: "l", tipo: "llamada", prioridad: "urgente", titulo: "", texto: "Te llama Mamá" };
  const mensaje: Aviso = { clave: "m", tipo: "mensaje", prioridad: "normal", titulo: "", texto: "Te escribió Pedro" };
  expect(decidir(llamada, base).via).toBe("voz");
  expect(decidir(mensaje, base)).toEqual({ via: "notificacion", motivo: "protocolo gimnasio: solo lo urgente" });
  // un «No molestar» que no puso Hestia sigue callándola
  expect(decidir(llamada, { ...base, protocolo: null }).motivo).toBe("no molestar");
});

test("sin música en pausa abre tu app de música; sin acceso al No molestar o con Hestia Manos vieja, lo dice (y no queda «puesto»)", async () => {
  const tel = telefono({ sinMusica: true, sinDnd: true });
  const r = await activar(PROTOCOLOS_BASE[0], ctx(deps(tel), { ahora: new Date(2026, 10, 18, 18, 0) }));
  expect(r.texto).toContain("Abrí Spotify (no había nada en pausa: dale play).");
  expect(r.texto).toContain("El No molestar: a Hestia Manos le falta el acceso a «No molestar».");
  expect(r.texto).toContain("El entrenador va en la llamada: ábrela y dime «vamos a entrenar».");
  // (con tiempo igual queda activo, pero sin el No molestar puesto)
  expect((await leerEstado()).protocolo).toMatchObject({ nombre: "gimnasio", dnd: false });
  _olvidarEstado();
  const viejo = await activar(PROTOCOLOS_BASE[2], ctx(deps(telefono({ viejo: true })), { ahora: new Date(2026, 10, 18, 18, 0) }));
  expect(viejo.texto).toBe("Protocolo foco, Alesito. El No molestar: necesito la versión nueva de Hestia Manos.");
  const sinTel = await activar(PROTOCOLOS_BASE[2], ctx(deps(null)));
  expect(sinTel.texto).toContain("El No molestar: sin el teléfono no pude.");
});

test("protocolo dormir: la alarma con tu agenda, No molestar hasta esa hora y el cierre del día; queda hasta la alarma y no habla", async () => {
  const ahora = new Date(2026, 10, 18, 23, 0);
  const tel = telefono({ eventos: [{ titulo: "Clase de inglés", inicio: new Date(2026, 10, 19, 9, 0).getTime(), fin: 0, todoElDia: false }] });
  let anotada = false;
  const r = await comandoProtocolo("protocolo dormir", ctx(deps(tel, { alarmaPuesta: () => { anotada = true; } }), { ahora }));
  expect(r?.texto).toBe("Protocolo dormir, Alesito. Alarma a las 7:15: tus 8 horas de sueño y No molestar hasta esa hora. " +
    "Cierre del día: comiste 1.850 de 2.300 calorías y 120 de 150 gramos de proteína; agua, 2,1 de 2,8 litros. Hoy entrenaste. Mañana a las 9:00, «Clase de inglés». Que descanses.");
  expect(anotada).toBe(true); // («cámbiala a las 8» después es esa alarma)
  const alarma = tel.ops.find((o) => o.accion === "alarma")!;
  expect([alarma.hora, alarma.minuto, alarma.mensaje]).toEqual([7, 15, "Dormir (Hestia)"]);
  expect(tel.ops.find((o) => o.accion === "no_molestar")).toEqual({ accion: "no_molestar", encender: true, minutos: 495 });
  const act = (await leerEstado()).protocolo!;
  expect(act).toMatchObject({ nombre: "dormir", hablar: "nada", dnd: true, aviso: false });
  expect(new Date(act.hasta!).getHours()).toBe(7);
  const urgente: Aviso = { clave: "l", tipo: "llamada", prioridad: "urgente", titulo: "", texto: "" };
  expect(decidir(urgente, { ahora, sensores: null, enLlamadaHestia: false, sueno: null, enReunion: false, pausada: false, permitido: true, dichos: [], protocolo: act }).motivo).toBe("protocolo dormir");
  expect(textoCierre(null, null)).toBe("Cierre del día: hoy no tengo ni tu comida ni tu agua anotadas. Que descanses.");
  expect(textoCierre({ kcal: { comida: 0, meta: 2850 }, proteina: { comida: 0, meta: 136 }, agua: { totalL: 1.2, goalL: 4 }, entrenoHoy: false }, null, "Alex"))
    .toBe("Cierre del día: agua, 1,2 de 4 litros. Que descanses, Alex.");
});

test("protocolo foco: 50 minutos (o los que digas); «¿cuánto queda?»; al vencer, el No molestar fuera y «Terminó tu bloque de foco»", async () => {
  const ahora = new Date(2026, 10, 18, 15, 0);
  const tel = telefono();
  const r = await comandoProtocolo("modo foco por 25 minutos", ctx(deps(tel), { ahora }));
  expect(r?.texto).toBe("Protocolo foco, Alesito. No molestar hasta las 15:25.");
  expect(tel.ops).toEqual([{ accion: "no_molestar", encender: true, minutos: 25 }]);
  expect((await comandoProtocolo("¿cuánto le queda al foco?", ctx(deps(tel), { ahora: new Date(2026, 10, 18, 15, 10) })))?.texto).toBe("Está activo foco, hasta las 15:25 (quedan 15 minutos).");
  expect(await vencido(new Date(2026, 10, 18, 15, 20))).toBeNull();
  const v = await vencido(new Date(2026, 10, 18, 15, 26));
  expect(v?.nombre).toBe("foco");
  const fin = await terminar(ctx(deps(tel), { ahora: new Date(2026, 10, 18, 15, 26) }), null, "vencio");
  expect(fin.texto).toBe("Terminó tu bloque de foco: 26 minutos. Quité el No molestar.");
  expect(tel.ops.at(-1)).toEqual({ accion: "no_molestar", encender: false });
  expect((await leerEstado()).protocolo).toBeNull();
  // terminarlo antes
  await comandoProtocolo("protocolo foco", ctx(deps(tel), { ahora }));
  expect((await comandoProtocolo("ya terminé el foco", ctx(deps(tel), { ahora: new Date(2026, 10, 18, 15, 32) })))?.texto).toBe("Listo, terminé el protocolo foco (32 minutos de foco): quité el No molestar.");
  // «terminé el entreno» sin el gimnasio activo no es de esto (es de Forge)
  expect(await comandoProtocolo("terminé el entreno", ctx(deps(tel)))).toBeNull();
  expect((await comandoProtocolo("termina el protocolo", ctx(deps(tel))))?.texto).toBe("No hay ningún protocolo activo.");
});

test("salir: lo que viene, las tomas, el cargador y «¿avanzo lo del PC o lo dejo quieto?» (quieto → lo de fondo espera; casa → sigue)", async () => {
  const ahora = new Date(2026, 10, 18, 9, 0);
  const tel = telefono({ eventos: [{ titulo: "Dentista", inicio: new Date(2026, 10, 18, 11, 30).getTime(), fin: 0, todoElDia: false }], bateria: 31 });
  const sups = { items: [{ id: "m", nombre: "metformina", horas: [8, 14], aviso: true, activo: true }], log: { "2026-11-18": { m: 1 } } };
  const d = deps(tel, { sups: async () => sups, trabajosPendientes: async () => 2 });
  const r = await comandoProtocolo("protocolo salir", ctx(d, { ahora }));
  expect(r?.texto).toBe("Protocolo salir de casa, Alesito. A las 11:30 tienes «Dentista»; llévate metformina (a las 14:00); el teléfono está al 31 %: llévate el cargador. " +
    "En el PC tengo 2 trabajos pendientes: ¿lo avanzo mientras no estás, o lo dejo quieto?");
  expect((await leerEstado()).protocolo).toBeNull(); // (salir no queda corriendo)
  expect((await comandoProtocolo("no, déjalo quieto", ctx(d, { ahora })))?.texto).toBe("Listo: lo dejo quieto hasta que vuelvas.");
  const e = await leerEstado();
  expect(e.fondoQuieto).toBe("saliste de casa (lo pediste)");
  expect(puedeFondo({ pausada: false, fondoPausado: null, fondoQuieto: e.fondoQuieto, llamada: false, consultaEnCurso: false, msDesdeUltima: 1e9, medicion: null, limites: LIMITES_INICIALES }).ok).toBe(false);
  // al llegar (la bienvenida de L1): lo de fondo sigue
  expect(await alLlegar(ctx(d))).toBe("Retomo lo pendiente en el PC.");
  expect((await leerEstado()).fondoQuieto).toBeNull();
  expect(tomasMientras(sups, new Date(2026, 10, 18, 15, 0))).toEqual([]);
});

test("lo natural se pregunta: «me voy a dormir» → «¿Activo el protocolo dormir?» → sí lo hace; no, nada", async () => {
  const tel = telefono();
  const q = await comandoProtocolo("me voy a dormir", ctx(deps(tel), { ahora: new Date(2026, 10, 18, 23, 0) }));
  expect(q?.texto).toBe("¿Activo el protocolo dormir? (la alarma según lo que necesitas dormir y tu agenda de mañana, No molestar hasta la alarma y el cierre del día)");
  expect(tel.ops).toEqual([]);
  const r = await comandoProtocolo("sí", ctx(deps(tel), { ahora: new Date(2026, 10, 18, 23, 0) }));
  expect(r?.texto).toStartWith("Protocolo dormir, Alesito. Alarma a las 7:15");
  await comandoProtocolo("voy al gym", ctx(deps(tel)));
  expect((await comandoProtocolo("no", ctx(deps(tel))))?.texto).toBe("Ok.");
});

test("crear el tuyo: Hestia repite los pasos y tú confirmas; sin nombre lo pregunta; mensajes y llamadas no van; borrar y restaurar", async () => {
  const tel = telefono();
  const d = deps(tel);
  const r = await comandoProtocolo("Hestia, crea un protocolo lectura que ponga no molestar por una hora y baje el volumen", ctx(d));
  expect(r?.texto).toBe("El protocolo Lectura haría esto: No molestar por una hora y bajar el volumen. ¿Lo guardo?");
  expect((await leerEstado()).protocolos).toEqual([]); // (todavía no)
  expect((await comandoProtocolo("sí, guárdalo", ctx(d)))?.texto).toBe("Guardado: el protocolo Lectura. Cuando quieras, dime «protocolo lectura».");
  const g = (await leerEstado()).protocolos[0];
  expect(g).toMatchObject({ nombre: "lectura", titulo: "Lectura", hablar: "urgente", duracionMin: 60, propio: true });
  expect(g.pasos).toEqual([{ tipo: "no_molestar", encender: true, minutos: 60 }, { tipo: "telefono", op: { accion: "volumen", cambio: "bajar" } }]);
  const a = await comandoProtocolo("protocolo lectura", ctx(d, { ahora: new Date(2026, 10, 18, 21, 0) }));
  expect(a?.texto).toBe("Protocolo Lectura, Alesito. No molestar hasta las 22:00 y volumen al 40 %.");
  // sin nombre: lo pregunta
  const sn = await comandoProtocolo("crea un protocolo que abra Spotify y prenda la linterna", ctx(d));
  expect(sn?.texto).toBe("Haría esto: abrir Spotify y prender la linterna. ¿Cómo lo llamo?");
  expect((await comandoProtocolo("fiesta", ctx(d)))?.texto).toBe("El protocolo Fiesta haría esto: abrir Spotify y prender la linterna. ¿Lo guardo?");
  expect((await comandoProtocolo("no", ctx(d)))?.texto).toBe("Ok, no lo guardo.");
  // mensajes y llamadas: nunca en un protocolo
  const m = await comandoProtocolo("crea un protocolo llegada que le mande un whatsapp a mamá diciendo que llegué y ponga música", ctx(d));
  expect(m?.texto).toBe("El protocolo Llegada haría esto: tu música. Mandar mensajes o llamar no lo meto en un protocolo: eso siempre te lo pregunto aparte. ¿Lo guardo?");
  await comandoProtocolo("no", ctx(d));
  // lo que no entiende, se lo repite como lo dijo (con tildes)
  expect((await comandoProtocolo("crea un protocolo cine que ponga no molestar y que haga palomitas mágicas", ctx(d)))?.texto)
    .toBe("El protocolo Cine haría esto: No molestar. No entendí «que haga palomitas mágicas», así que eso no va. ¿Lo guardo?");
  await comandoProtocolo("no", ctx(d));
  // tu versión de uno de los que vienen, y volver al de siempre
  const v = await comandoProtocolo("crea un protocolo gimnasio que ponga no molestar por 90 minutos y abra Spotify", ctx(d));
  expect(v?.texto).toBe("El protocolo Gimnasio haría esto: No molestar por una hora y media y abrir Spotify. Reemplaza al que viene hecho (para volver a él: «restaura el protocolo gimnasio»). ¿Lo guardo?");
  await comandoProtocolo("dale", ctx(d));
  expect((await comandoProtocolo("¿qué hace el protocolo gym?", ctx(d)))?.texto).toBe("El protocolo gimnasio hace esto: No molestar por una hora y media y abrir Spotify. Es tu versión; para volver al de siempre, dime «restaura el protocolo gimnasio».");
  expect((await comandoProtocolo("restaura el protocolo gimnasio", ctx(d)))?.texto).toBe("Listo: el protocolo gimnasio vuelve a ser el de siempre (No molestar por 2 horas y media, tu música y el entrenador en el oído).");
  expect((await comandoProtocolo("borra el protocolo lectura", ctx(d)))?.texto).toBe("Listo, borré el protocolo Lectura.");
  expect((await comandoProtocolo("borra el protocolo foco", ctx(d)))?.texto).toContain("Ese viene hecho y no se borra");
  // con el teléfono bloqueado (sin tu voz): crear, no
  expect((await comandoProtocolo("crea un protocolo x que ponga no molestar", ctx(d, { bloqueado: true })))?.texto).toBe("Para crear protocolos, desbloquea el teléfono.");
});

test("los pasos de lo dicho: subjuntivos e infinitivos, «una hora y media» entera, y lo que no entiende", () => {
  expect(nombreYPasos(" que se llame cine y que ponga no molestar")).toEqual({ nombre: "cine", pasos: "ponga no molestar" });
  expect(nombreYPasos(" para leer: no molestar")).toEqual({ nombre: "leer", pasos: "no molestar" });
  expect(nombreYPasos(" que me despierte a las 7")).toEqual({ nombre: null, pasos: "que me despierte a las 7" });
  const r = pasosDe("que me despierte a las 6 y media, ponga no molestar por una hora y media y después el cierre del día y que haga algo raro", []);
  expect(r.pasos).toEqual([{ tipo: "telefono", op: { accion: "alarma", hora: 6, minuto: 30 } }, { tipo: "no_molestar", encender: true, minutos: 90 }, { tipo: "cierre_dia" }]);
  expect(r.noEntendi).toEqual(["que haga algo raro"]);
  expect(pasosDe("llama a mi mamá").aOtros).toEqual(["llama a mi mama"]);
});

test("con el teléfono bloqueado (sin tu voz): solo lo seguro; lo personal, al desbloquear", async () => {
  const tel = telefono();
  const r = await activar(PROTOCOLOS_BASE[1], ctx(deps(tel), { bloqueado: true, ahora: new Date(2026, 10, 18, 23, 0) }));
  expect(r.texto).toBe("Protocolo dormir, Alesito. Alarma a las 7:15: tus 8 horas de sueño y No molestar hasta esa hora. Con el teléfono bloqueado no hice el cierre del día: eso, al desbloquear.");
});

test("el «No molestar» como orden del teléfono (también bloqueado) y lo guardado se revisa al leerlo", async () => {
  expect(parseTelefono("pon no molestar por una hora", [])).toEqual({ accion: "no_molestar", encender: true, minutos: 60 });
  expect(parseTelefono("Hestia, quita el no molestar", [])).toEqual({ accion: "no_molestar", encender: false });
  expect(parseTelefono("activa el modo no molestar", [])).toEqual({ accion: "no_molestar", encender: true });
  expect(parseTelefono("pon el celular en silencio", [])).toEqual({ accion: "volumen", cambio: "silencio" });
  expect(permitidoBloqueado("pon no molestar")).toBe(true);
  // un archivo cambiado a mano: lo que no va en un protocolo se descarta
  expect(protocoloSano({ nombre: "X", pasos: [{ tipo: "telefono", op: { accion: "whatsapp", texto: "hola" } }, { tipo: "telefono", op: { accion: "alarma", hora: 25, minuto: 0 } }] })).toBeNull();
  await cambiarEstado((e) => { (e as any).protocolos = [{ nombre: "Cine!", titulo: "Cine", pasos: [{ tipo: "no_molestar", encender: true, minutos: 9999 }, { tipo: "rm -rf" }] }]; (e as any).protocolo = { nombre: "foco", desde: "no es fecha" }; });
  const e = await leerEstado();
  expect(e.protocolos).toEqual([{ nombre: "cine", titulo: "Cine", alias: ["cine"], pasos: [{ tipo: "no_molestar", encender: true, minutos: 1440 }], hablar: "todo", duracionMin: null, propio: true }]);
  expect(e.protocolo).toBeNull();
});
