// Hestia Manos · K3 (2026-11-16): la llamada abierta con el botón del asistente SOBRE LA PANTALLA DE BLOQUEO. Solo lo seguro y por
// código; nunca el modelo (tiene tu perfil y tu memoria: cualquiera con el teléfono en la mano lo escucharía).
import { test, expect } from "bun:test";
import { z } from "zod";
import { permitidoBloqueado, SEGURAS_BLOQUEADO } from "C:/Proyectos/eris/src/services/TelefonoParse.ts";
import { resolveTelefonoOp } from "C:/Proyectos/eris/src/services/TelefonoBridge.ts";
import { TelefonoTool } from "C:/Proyectos/eris/src/tools/TelefonoTool.ts";
import { QueryEngine } from "C:/Proyectos/eris/src/QueryEngine.ts";
import { ToolRegistry } from "C:/Proyectos/eris/src/tools.ts";
import { Tool } from "C:/Proyectos/eris/src/Tool.ts";
import { createMessage } from "C:/Proyectos/eris/src/types/message.ts";

test("bloqueado: pasa solo lo que no expone nada tuyo ni afecta a otros", () => {
  for (const t of ["Pon una alarma a las 7", "Temporizador de 10 minutos", "Prende la linterna", "Apaga la linterna", "Sube el volumen",
    "Pausa la música", "Siguiente canción", "¿Cuánta batería tengo?", "Avísame en 15 minutos"]) expect([t, permitidoBloqueado(t)]).toEqual([t, true]);
  for (const t of ["Léeme los mensajes", "¿Qué me dijo mi mamá?", "Llama a mi mamá", "Mándale un SMS a Brian que llego tarde",
    "Respóndele que pongo la alarma a las 7", "¿Qué tengo en el calendario mañana?", "Agéndame una reunión mañana a las 10",
    "Abre Spotify", "Llévame a la casa", "¿Cuánta plata tengo?", "¿Qué comí hoy?", "Hola", ""]) expect([t, permitidoBloqueado(t)]).toEqual([t, false]);
  expect([...SEGURAS_BLOQUEADO].sort()).toEqual(["alarma", "bateria", "linterna", "musica", "no_molestar", "temporizador", "volumen"]); // (L5: el No molestar, 2026-11-18)
});

/** Una herramienta cualquiera con atajo que calza con todo (como si fuera tu nutrición o tus finanzas) */
class Secreta extends Tool<Record<string, never>> {
  readonly name = "nutrition_tracker";
  readonly description = "x";
  readonly inputSchema = z.object({}) as any;
  corrio = 0;
  async preroute() { return {}; }
  async execute() { this.corrio++; return { output: "Hoy comiste 1.200 kcal.", metadata: { quickReply: "Hoy comiste 1.200 kcal." } }; }
}

function telefono() {
  const pedidos: any[] = [];
  const ws: any = { data: { canTelefono: true, telefonoApps: [] } };
  ws.send = (raw: string) => {
    const m = JSON.parse(raw);
    pedidos.push(m.op);
    setTimeout(() => resolveTelefonoOp(ws, { requestId: m.requestId, result: { ok: true, data: {} } }), 1);
  };
  return { ws, pedidos };
}

test("bloqueado: solo el atajo del teléfono, nunca el modelo ni otras herramientas", async () => {
  let modelo = 0;
  const model = { async generate() { modelo++; return { content: "Tu glucosa de hoy fue 180 y te escribió Pedro.", toolCalls: [] }; } } as any;
  const secreta = new Secreta();
  const eng = new QueryEngine(model, new ToolRegistry([secreta, new TelefonoTool()] as any), "SYS", {});
  const { ws, pedidos } = telefono();
  const SIN = "Para eso desbloquea el teléfono; apenas lo hagas, sigo.";
  const ctx: any = { role: "ikaros", axsMode: true, voz: true, wsClient: ws, profileId: "x", soloAtajos: { herramientas: ["telefono"], sinAtajo: SIN } };
  // la linterna va directo (sin aprobación): el atajo del teléfono, al instante
  const r = await eng.query("Prende la linterna", [createMessage("user", "Prende la linterna")], {} as any, null, "flash", ctx);
  expect(pedidos.map((p) => p.accion)).toEqual(["linterna"]);
  expect(r.quick).toBe(true);
  // lo que no es del teléfono: el texto fijo, sin el modelo y sin la otra herramienta (aunque su atajo calce)
  const r2 = await eng.query("¿Qué comí hoy?", [createMessage("user", "¿Qué comí hoy?")], {} as any, null, "flash", ctx);
  expect(r2.message.content).toBe(SIN);
  expect(modelo).toBe(0);
  expect(secreta.corrio).toBe(0);
  // desbloqueado (sin soloAtajos): todo vuelve a su camino normal
  await eng.query("¿Qué comí hoy?", [createMessage("user", "¿Qué comí hoy?")], {} as any, null, "flash", { ...ctx, soloAtajos: undefined });
  expect(secreta.corrio).toBe(1);
});
