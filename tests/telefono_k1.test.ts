// Hestia Manos · K1 (2026-11-16): mensajes, llamadas y música, con un teléfono falso.
import { test, expect } from "bun:test";
import { parseTelefono } from "C:/Proyectos/eris/src/services/TelefonoParse.ts";
import { resolveTelefonoOp } from "C:/Proyectos/eris/src/services/TelefonoBridge.ts";
import { planear, preguntaPlan, formatearMensajes, respuestaMusica, type MsgTel } from "C:/Proyectos/eris/src/services/TelefonoK1.ts";
import { TelefonoTool } from "C:/Proyectos/eris/src/tools/TelefonoTool.ts";
import { claseAprobacion, preguntaHablada } from "C:/Proyectos/eris/src/services/voz/AprobacionVoz.ts";

const hace = (min: number) => Date.now() - min * 60_000;
const MSGS: MsgTel[] = [
  { app: "WhatsApp", chat: "Brian", de: "Brian", grupo: false, hora: hace(30), texto: "¿Llegas a la reunión?", puedeResponder: true },
  { app: "WhatsApp", chat: "Brian", de: "Brian", grupo: false, hora: hace(20), texto: "Avísame", puedeResponder: true },
  { app: "WhatsApp", chat: "Mamá", de: "Mamá", grupo: false, hora: hace(10), texto: "Hijo, ¿vienes a almorzar?", puedeResponder: true },
  { app: "Gmail", chat: "BCI", de: "BCI", grupo: false, hora: hace(5), texto: "Tu código es ••••", puedeResponder: false },
];
const CONTACTOS = [{ nombre: "Brian", numero: "+56911111111" }, { nombre: "Mamá", numero: "+56922222222" }, { nombre: "Mamá trabajo", numero: "+56233333333" },
  { nombre: "Pedro", numero: "+56944444444" }, { nombre: "Carla Soto", numero: "+56955555555" }, { nombre: "Carla Díaz", numero: "+56966666666" }];

/** Un teléfono falso: contesta cada telefono_op como lo haría Hestia Manos */
function telefono() {
  const pedidos: any[] = [];
  const ws: any = { data: { canTelefono: true, telefonoApps: [] } };
  ws.send = (raw: string) => {
    const m = JSON.parse(raw);
    const op = m.op; pedidos.push(op);
    const q = (s?: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^mi /, "");
    let result: any = { ok: true, data: {} };
    if (op.accion === "mensajes") result.data = { mensajes: MSGS.filter((x) => !op.persona || q(x.de).includes(q(op.persona))) };
    if (op.accion === "contactos") {
      const exactos = CONTACTOS.filter((c) => q(c.nombre) === q(op.nombre));
      result.data = { contactos: exactos.length === 1 ? exactos : CONTACTOS.filter((c) => q(c.nombre).includes(q(op.nombre))) };
    }
    setTimeout(() => resolveTelefonoOp(ws, { requestId: m.requestId, result }), 1);
  };
  return { ws, pedidos };
}

test("las órdenes de mensajes, llamadas y música por código (con el texto tal cual lo dijo)", () => {
  expect(parseTelefono("Léeme los mensajes")).toEqual({ accion: "mensajes" });
  expect(parseTelefono("¿Quién me escribió?")).toEqual({ accion: "mensajes" });
  expect(parseTelefono("¿Tengo mensajes nuevos de WhatsApp?")).toEqual({ accion: "mensajes", app: "whatsapp" });
  expect(parseTelefono("¿Qué me dijo Brian?")).toEqual({ accion: "mensajes", persona: "brian" });
  expect(parseTelefono("Léeme los mensajes de mi mamá")).toEqual({ accion: "mensajes", persona: "mi mama" });
  expect(parseTelefono("Respóndele que llego en 10, ¡Brian!")).toEqual({ accion: "responder", texto: "llego en 10, ¡Brian" });
  expect(parseTelefono("Contéstale a Brian que sí, voy")).toEqual({ accion: "responder", persona: "brian", texto: "sí, voy" });
  expect(parseTelefono("Dile a mi mamá que voy a almorzar")).toEqual({ accion: "responder", persona: "mi mama", texto: "voy a almorzar", canal: "auto" });
  expect(parseTelefono("Mándale un WhatsApp a Carla que llego tarde")).toEqual({ accion: "whatsapp", persona: "carla", texto: "llego tarde" });
  expect(parseTelefono("Envíale un SMS a Brian diciendo que voy en camino")).toEqual({ accion: "sms", persona: "brian", texto: "voy en camino" });
  expect(parseTelefono("Llama a mi mamá")).toEqual({ accion: "llamar", persona: "mi mama" });
  expect(parseTelefono("Llámale a Brian")).toEqual({ accion: "llamar", persona: "brian" });
  expect(parseTelefono("Llámame a las 8")).toBeNull(); // eso es un recordatorio, no una llamada
  expect(parseTelefono("Pausa la música")).toEqual({ accion: "musica", que: "pausa" });
  expect(parseTelefono("Siguiente canción")).toEqual({ accion: "musica", que: "siguiente" });
  expect(parseTelefono("¿Qué canción está sonando?")).toEqual({ accion: "musica", que: "que_suena" });
  expect(parseTelefono("Pon el tema para la reunión")).toBeNull(); // «tema» y «para» no son la música
  // K1 primero: un mensaje que habla de una alarma es un mensaje
  expect(parseTelefono("Respóndele que pongo la alarma a las 7")).toEqual({ accion: "responder", texto: "pongo la alarma a las 7" });
});

test("leer: quién y cuántos (el detalle en lista para la pantalla), y lo de una persona", () => {
  const t = formatearMensajes(MSGS);
  expect(t.split("\n")[0]).toBe("Tienes 4 mensajes: 1 de BCI, 1 de Mamá y 2 de Brian.");
  expect(t).toContain("- **Brian** · WhatsApp");
  expect(t).toContain("«Hijo, ¿vienes a almorzar?»"); // lo de otra persona, entre «»
  const b = formatearMensajes(MSGS.slice(0, 2), "brian");
  expect(b).toMatch(/^Brian te escribió por WhatsApp, a las \d\d:\d\d: «¿Llegas a la reunión\?»; a las \d\d:\d\d: «Avísame»\.$/);
  expect(formatearMensajes([], "carla")).toBe("No tengo mensajes de carla de las últimas 24 horas.");
  expect(formatearMensajes([], undefined, true)).toContain("Acceso a notificaciones");
});

test("responder: por su chat reciente, leyendo el texto exacto y a quién va; se aprueba con un «sí»", async () => {
  const { ws } = telefono();
  const plan = await planear(ws, { accion: "responder", persona: "brian", texto: "llego en 10" });
  expect(plan).toEqual({ tipo: "responder", chat: "Brian", app: "WhatsApp", texto: "llego en 10" });
  const q = preguntaPlan(plan)!;
  expect(q).toBe("¿Le respondo a Brian por WhatsApp: «llego en 10»?");
  const req = { tool: "telefono", title: "Responder un mensaje", detail: `${q}\n\n(Brian · WhatsApp)`, risk: "normal" as const, flags: [] };
  expect(claseAprobacion(req)).toBe("voz");
  expect(preguntaHablada(req, "voz")).toBe("¿Le respondo a Brian por WhatsApp: «llego en 10»? Dime sí o no.");
  // sin decir a quién: la conversación de la que se habló recién
  const plan2 = await planear(ws, { accion: "responder", texto: "sí" }, { chat: "Mamá", app: "WhatsApp", at: Date.now() });
  expect(plan2).toMatchObject({ tipo: "responder", chat: "Mamá" });
  expect(await planear(ws, { accion: "responder", texto: "sí" })).toEqual({ tipo: "preguntar", texto: "¿A quién le respondo?" });
});

test("a alguien que no te escribió: WhatsApp con el texto listo (lo envías tú, sin aprobación)", async () => {
  const { ws } = telefono();
  const plan = await planear(ws, { accion: "responder", persona: "pedro", texto: "llego tarde", canal: "auto" });
  expect(plan).toEqual({ tipo: "whatsapp", nombre: "Pedro", numero: "+56944444444", texto: "llego tarde" });
  expect(preguntaPlan(plan)).toBeNull();
});

test("llamar y SMS: el contacto resuelto; si hay dos, pregunta cuál (y no llama)", async () => {
  const { ws, pedidos } = telefono();
  // «mamá» calza exacto con «Mamá»: esa (no «Mamá trabajo»)
  expect(preguntaPlan(await planear(ws, { accion: "llamar", persona: "mamá" }))).toBe("¿Llamo a Mamá?");
  const amb = await planear(ws, { accion: "llamar", persona: "carla" });
  expect(amb.tipo).toBe("preguntar");
  expect((amb as any).texto.split("\n")[0]).toBe("¿Llamo a Carla Soto o a Carla Díaz?");
  expect((amb as any).texto).toContain("[Opción: Llama a Carla Díaz]");
  expect(pedidos.some((p) => p.accion === "llamar")).toBe(false);
  const b = await planear(ws, { accion: "llamar", persona: "brian" });
  expect(preguntaPlan(b)).toBe("¿Llamo a Brian?");
  const s = await planear(ws, { accion: "sms", persona: "brian", texto: "voy en camino" });
  expect(preguntaPlan(s)).toBe("¿Le mando a Brian un SMS: «voy en camino»?");
  expect((await planear(ws, { accion: "llamar", persona: "nadie" })).tipo).toBe("error");
});

test("la herramienta: leer es contenido externo; mandar usa EXACTAMENTE el plan aprobado", async () => {
  const { ws, pedidos } = telefono();
  const t = new TelefonoTool();
  const ctx = { axsMode: true, role: "ikaros", wsClient: ws, profileId: "x" };
  const leer = await t.execute({ accion: "mensajes" } as any, ctx);
  expect((leer.metadata as any).untrusted).toBe(true);
  const input = { accion: "responder", persona: "brian", texto: "llego en 10" } as any;
  const pre = await t.preflight(input, ctx);
  expect(pre.ok && pre.approval?.detail.split("\n")[0]).toBe("¿Le respondo a Brian por WhatsApp: «llego en 10»?");
  const r = await t.execute(input, ctx);
  expect(r.output).toBe("Listo, le respondí a Brian por WhatsApp.");
  expect(pedidos.at(-1)).toEqual({ accion: "responder", chat: "Brian", app: "WhatsApp", texto: "llego en 10" });
  // sin pasar por la aprobación (execute directo), algo que la necesitaba no se hace
  const r2 = await t.execute({ accion: "llamar", persona: "brian" } as any, ctx);
  expect(r2.output).toContain("pídemelo de nuevo");
  expect(pedidos.some((p) => p.accion === "llamar")).toBe(false);
});

test("la música: lo que se dice", () => {
  expect(respuestaMusica("que_suena", { ok: true, data: { cancion: "Tusa", artista: "Karol G", app: "Spotify", sonando: true } })).toBe("Suena «Tusa» de Karol G en Spotify.");
  expect(respuestaMusica("pausa", { ok: true, data: { cancion: "Tusa", artista: "Karol G" } })).toBe("Pausé «Tusa» de Karol G.");
  expect(respuestaMusica("pausa", { ok: false, code: "sin_musica" })).toBe("No está sonando nada.");
});
