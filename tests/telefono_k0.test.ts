// Hestia Manos (K0, 2026-11-16): las órdenes del teléfono por código, lo que se dice y cómo se aprueban.
import { test, expect } from "bun:test";
import { parseTelefono, horaDicha, duracionDicha, appDelTelefono } from "C:/Proyectos/eris/src/services/TelefonoParse.ts";
import { TelefonoTool, preguntaTelefono, respuestaTelefono, duracionTexto } from "C:/Proyectos/eris/src/tools/TelefonoTool.ts";
import { claseAprobacion, preguntaHablada } from "C:/Proyectos/eris/src/services/voz/AprobacionVoz.ts";
import { paraHablar } from "C:/Proyectos/eris/src/services/voz/Hablar.ts";
import { groupsFor, TOOL_GROUP } from "C:/Proyectos/eris/src/services/ToolRouter.ts";

const APPS = ["WhatsApp", "Spotify", "Maps", "Reloj", "Cámara", "Fotos", "Instagram", "Gmail", "YouTube Music"];

test("horas y duraciones dichas", () => {
  expect(horaDicha("pon una alarma a las 7")).toEqual({ hora: 7, minuto: 0 });
  expect(horaDicha("a las 6 y media")).toEqual({ hora: 6, minuto: 30 });
  expect(horaDicha("a las 8 y cuarto de la noche")).toEqual({ hora: 20, minuto: 15 });
  expect(horaDicha("a las 19:45")).toEqual({ hora: 19, minuto: 45 });
  expect(horaDicha("a la una de la tarde")).toEqual({ hora: 13, minuto: 0 });
  expect(horaDicha("para las 5:10 am")).toEqual({ hora: 5, minuto: 10 });
  expect(horaDicha("a las 25")).toBeNull();
  expect(duracionDicha("temporizador de 10 minutos")).toBe(600);
  expect(duracionDicha("una hora y media")).toBe(5400);
  expect(duracionDicha("media hora")).toBe(1800);
  expect(duracionDicha("1 hora y 20 minutos")).toBe(4800);
  expect(duracionDicha("30 segundos")).toBe(30);
  expect(duracionTexto(5400)).toBe("1 hora y 30 minutos");
});

test("las órdenes del teléfono por código", async () => {
  expect(parseTelefono("Pon una alarma a las 7 de la mañana")).toEqual({ accion: "alarma", hora: 7, minuto: 0 });
  expect(parseTelefono("Despiértame a las 6 y media para ir al gym")).toEqual({ accion: "alarma", hora: 6, minuto: 30, mensaje: "ir al gym" });
  expect(parseTelefono("Pon un temporizador de 10 minutos para el arroz")).toEqual({ accion: "temporizador", segundos: 600, mensaje: "el arroz" });
  expect(parseTelefono("Avísame en media hora")).toEqual({ accion: "temporizador", segundos: 1800 });
  expect(parseTelefono("Que me avise en un cuarto de hora")).toEqual({ accion: "temporizador", segundos: 900 });
  expect(parseTelefono("Necesito que el celular me suene en 15 minutos para sacar el pan del horno")).toEqual({ accion: "temporizador", segundos: 900, mensaje: "sacar el pan del horno" });
  // si el modelo igual calcula una hora para «en 15 minutos», la herramienta le pide un temporizador
  const pre = await new TelefonoTool().preflight({ accion: "alarma", hora: 15, minuto: 55 }, { userMessage: "que me suene en 15 minutos" });
  expect(pre.ok).toBe(false);
  // «a eso de las siete y cuarto»: el código lo entiende, y si el modelo pone otra hora, se le corrige
  expect(parseTelefono("¿Me dejas una alarma para mañana temprano, a eso de las siete y cuarto?")).toEqual({ accion: "alarma", hora: 7, minuto: 15 });
  expect((await new TelefonoTool().preflight({ accion: "alarma", hora: 7, minuto: 30 }, { userMessage: "a eso de las siete y cuarto" })).ok).toBe(false);
  expect((await new TelefonoTool().preflight({ accion: "alarma", hora: 19, minuto: 15 }, { userMessage: "a las siete y cuarto" })).ok).toBe(true); // 7 o 19: igual
  expect(parseTelefono("Prende la linterna")).toEqual({ accion: "linterna", encender: true });
  expect(parseTelefono("Apaga la linterna")).toEqual({ accion: "linterna", encender: false });
  expect(parseTelefono("Sube el volumen")).toEqual({ accion: "volumen", cambio: "subir" });
  expect(parseTelefono("Bájale")).toBeNull(); // sin «volumen»: no se adivina
  expect(parseTelefono("Volumen al 40%")).toEqual({ accion: "volumen", cambio: "nivel", nivel: 40 });
  expect(parseTelefono("Silencia el teléfono")).toEqual({ accion: "volumen", cambio: "silencio" });
  expect(parseTelefono("¿Cuánta batería tengo?")).toEqual({ accion: "bateria" });
  expect(parseTelefono("Llévame a la casa de mi mamá")).toEqual({ accion: "navegar", destino: "la casa de mi mama" });
  expect(parseTelefono("Abre Spotify", APPS)).toEqual({ accion: "abrir_app", nombre: "Spotify" });
  expect(parseTelefono("Ábreme el wsp", APPS)).toEqual({ accion: "abrir_app", nombre: "WhatsApp" });
  expect(parseTelefono("Abre Tinder en el celular", APPS)).toEqual({ accion: "abrir_app", nombre: "tinder" }); // dicho el teléfono: lo busca allá
});

test("lo que no es del teléfono no se toma", () => {
  expect(parseTelefono("Abre Spotify en el PC", APPS)).toBeNull();
  expect(parseTelefono("Abre YouTube en el navegador", APPS)).toBeNull(); // no es una app del teléfono: sigue al PC
  expect(parseTelefono("¿Cuánta batería tiene el notebook?")).toBeNull();
  expect(parseTelefono("Quita la alarma de las 7")).toBeNull(); // borrar no está en K0
  expect(parseTelefono("La alarma del auto suena mucho")).toBeNull();
  expect(parseTelefono("Tengo que comprar una batería nueva")).toBeNull();
  expect(appDelTelefono("youtube", APPS)).toBe("YouTube Music"); // empieza así
  expect(appDelTelefono("yo", APPS)).toBeNull(); // muy corto
});

test("aprobaciones: lo que crea o abre algo se pregunta (en la llamada basta un «sí»); linterna, volumen y batería van directo", async () => {
  const t = new TelefonoTool();
  const alarma = await t.preflight({ accion: "alarma", hora: 7, minuto: 0 });
  expect(alarma.ok && alarma.approval?.detail.split("\n")[0]).toBe("¿Pongo una alarma a las 07:00?");
  const req = { tool: "telefono", title: (alarma as any).approval.title, detail: (alarma as any).approval.detail, risk: "normal" as const, flags: [] };
  expect(claseAprobacion(req)).toBe("voz");
  expect(preguntaHablada(req, "voz")).toBe("¿Pongo una alarma a las 07:00? Dime sí o no.");
  expect(paraHablar(preguntaHablada(req, "voz"))).toBe("¿Pongo una alarma a las siete de la mañana? Dime sí o no.");
  expect(await t.preflight({ accion: "linterna", encender: true })).toEqual({ ok: true });
  expect(await t.preflight({ accion: "bateria" })).toEqual({ ok: true });
  expect((await t.preflight({ accion: "alarma" })).ok).toBe(false); // sin hora
  expect(preguntaTelefono({ accion: "temporizador", segundos: 600, mensaje: "el arroz" })).toBe("¿Pongo un temporizador de 10 minutos para el arroz?");
});

test("lo que se dice después, con lo que respondió el teléfono", () => {
  expect(respuestaTelefono({ accion: "alarma", hora: 7, minuto: 0 }, { ok: true, data: { hora: 7, minuto: 0 } })).toBe("Listo: alarma a las 07:00.");
  expect(respuestaTelefono({ accion: "bateria" }, { ok: true, data: { porcentaje: 54, cargando: true } })).toBe("Tu teléfono tiene 54 % de batería y está cargando.");
  expect(respuestaTelefono({ accion: "abrir_app", nombre: "x" }, { ok: false, code: "ambigua", opciones: ["Fotos", "Fotos de Google"] })).toBe("Hay varias apps así: Fotos, Fotos de Google. ¿Cuál abro?");
  expect(respuestaTelefono({ accion: "linterna", encender: true }, { ok: false, code: "sin_manos" })).toContain("Hestia Manos");
});

test("solo en Modo AXS, solo Ikaros y solo con Hestia Manos en el teléfono", async () => {
  const t = new TelefonoTool();
  const ws = { data: { canTelefono: true, telefonoApps: APPS } };
  expect(await t.preroute("prende la linterna", { axsMode: true, role: "ikaros", wsClient: ws })).toEqual({ accion: "linterna", encender: true });
  expect(await t.preroute("prende la linterna", { axsMode: false, role: "ikaros", wsClient: ws })).toBeNull();
  expect(await t.preroute("prende la linterna", { axsMode: true, role: "eris", wsClient: ws })).toBeNull();
  expect(await t.preroute("prende la linterna", { axsMode: true, role: "ikaros", wsClient: { data: {} } })).toBeNull();
  expect(TOOL_GROUP.telefono).toBe("telefono");
  expect(groupsFor("pon una alarma a las 7").has("telefono")).toBe(true);
  // «navegador» no es navegar (banco: «Abre YouTube en el navegador» terminó en «¿Te abro Maps rumbo a YouTube?»)
  expect(groupsFor("Abre YouTube en el navegador").has("telefono")).toBe(false);
  expect(groupsFor("Navega a la casa de mi mamá").has("telefono")).toBe(true);
  expect(t.dangerous).toBe(true); // con contenido externo en el turno, no corre
});
