// (2026-11-17) Lo que falló en su llamada real, por código:
//  - «Necesito que agregues un evento el 27 de este mes» → «¿Cómo se llama…?» → «Fiesta de disfraces casas Nati» → «¿A qué hora…?» →
//    «A las una de la tarde»: cada respuesta la completa el código (antes el modelo decía «ya está en tu agenda» sin agendar nada);
//  - «¿segura? revisa» después de agendar mira el calendario de verdad; «abre la aplicación» abre la del teléfono (no el Explorador);
//  - «Modifique la alarma…» y después «la quiero cambiar a las 6:45» ponen la alarma y avisan que la anterior sigue en el Reloj;
//  - la guardia: «ya está en tu agenda» / «ya actualicé la alarma» sin herramienta es mentira, aunque lo pidiera en otro turno.
import { test, expect, beforeEach } from "bun:test";
import { TelefonoTool, _olvidarTelefono, respuestaTelefono } from "C:/Proyectos/eris/src/tools/TelefonoTool.ts";
import { completarAgendar } from "C:/Proyectos/eris/src/services/TelefonoK2.ts";
import { claimsSaved } from "C:/Proyectos/eris/src/services/ReplyGuards.ts";
import { resolveTelefonoOp } from "C:/Proyectos/eris/src/services/TelefonoBridge.ts";

beforeEach(() => _olvidarTelefono());

const ctx = (msg: string) => ({ axsMode: true, role: "ikaros", profileId: "alex", userMessage: msg,
  wsClient: { data: { canTelefono: true, telefonoApps: ["Calendar", "Reloj", "Spotify", "WhatsApp"] }, readyState: 1, send() {} } });
const tool = new TelefonoTool();
const pre = (m: string) => tool.preroute(m, ctx(m));

test("agendar en varios turnos: el código completa el nombre y la hora (nunca el modelo)", async () => {
  const a = await pre("Necesito que agregues un evento el 27 de este mes.");
  expect(a).toMatchObject({ accion: "agendar", titulo: "" });
  const r1 = await tool.execute(a as any, ctx(""));
  expect(r1.output).toMatch(/Cómo se llama lo que agendo el viernes 27/);
  const b = await pre("Fiesta de disfraces casas Nati");
  expect(b).toMatchObject({ accion: "agendar", titulo: "Fiesta de disfraces casas Nati", cuando: "el 27 de este mes." });
  const r2 = await tool.execute(b as any, ctx(""));
  expect(r2.output).toMatch(/A qué hora agendo «Fiesta de disfraces casas Nati» el viernes 27/);
  const c = await pre("A las una de la tarde.");
  expect(c).toMatchObject({ accion: "agendar", titulo: "Fiesta de disfraces casas Nati" });
  // (y lo que se va a preguntar para aprobar: con la hora de verdad)
  const pf = await tool.preflight(c as any, ctx("A las una de la tarde."));
  expect(pf.approval?.detail).toMatch(/¿Agendo «Fiesta de disfraces casas Nati» el viernes 27 a las 13:00\?/);
  // «¿segura? revisa» mira el calendario de ese día; «abre la aplicación» abre el calendario del TELÉFONO
  expect(await pre("Segura revisa.")).toMatchObject({ accion: "calendario" });
  expect(await pre("Abre la aplicación.")).toEqual({ accion: "abrir_app", nombre: "Calendar" });
});

test("la pregunta pendiente se suelta si cambias de tema, dices que no o preguntas otra cosa", async () => {
  expect(completarAgendar({ titulo: "X", cuando: "" }, "¿qué hora es?")).toBeNull();
  expect(completarAgendar({ titulo: "X", cuando: "" }, "no, déjalo")).toBeNull();
  const a = await pre("agrega un evento mañana");
  await tool.execute(a as any, ctx(""));
  // otra orden del teléfono gana (y la pregunta se olvida)
  expect(await pre("prende la linterna")).toMatchObject({ accion: "linterna" });
  expect(await pre("Reunión con Pedro")).toBeNull();
});

test("la alarma: «modifique…» y después «la quiero cambiar a las 6:45» (sin decir alarma); la anterior sigue en el Reloj y se dice", async () => {
  const a = await pre("Modifique la alarma de mañana a las 6:45.");
  expect(a).toMatchObject({ accion: "alarma", hora: 6, minuto: 45, reemplaza: true });
  expect(respuestaTelefono(a as any, { ok: true, data: { hora: 6, minuto: 45 } })).toMatch(/^Listo: alarma a las 0?6:45\. Ojo: la que ya tenías sigue en el Reloj/);
  // (el teléfono falso contesta al tiro: así queda anotado que se habló de la alarma)
  const ws: any = { data: { canTelefono: true, telefonoApps: [] }, readyState: 1, send: (m: string) => { const d = JSON.parse(m); setTimeout(() => resolveTelefonoOp(ws, { requestId: d.requestId, result: { ok: true, data: { hora: 7, minuto: 0 } } }), 5); } };
  await tool.execute({ accion: "alarma", hora: 7, minuto: 0 } as any, { ...ctx(""), wsClient: ws });
  expect(await pre("Entonces yo la quiero cambiar a las 6:45.")).toMatchObject({ accion: "alarma", hora: 6, minuto: 45, reemplaza: true });
  // sin haber hablado de alarmas, no
  _olvidarTelefono();
  expect(await pre("Entonces yo la quiero cambiar a las 6:45.")).toBeNull();
});

test("la guardia: decir que quedó en la agenda o que cambió la alarma, sin herramienta, cuenta como «dijo que lo guardó»", () => {
  expect(claimsSaved("Alesito, la fiesta de las casas Nati el 27 a la una de la tarde ya está en tu agenda.")).toBe(true);
  expect(claimsSaved("Claro, Alesito, ya actualicé la alarma de mañana a las 6:45.")).toBe(true);
  expect(claimsSaved("¿Quieres que lo agende en tu calendario?")).toBe(false);
  expect(claimsSaved("No quedó en tu agenda: dime la hora y lo agendo.")).toBe(false);
});
