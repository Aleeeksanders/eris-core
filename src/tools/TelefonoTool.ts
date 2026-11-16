// ============================================================
// Hestia Manos (K0, 2026-11-16): «telefono» — Hestia hace cosas en el TELÉFONO de Alex (no en el PC) a través de la app aparte
// Hestia Manos: abrir una app, alarma, temporizador, linterna, volumen, navegar con Maps, la batería. Solo para su cuenta (rol
// ikaros) en Modo AXS, y solo si Eris anunció que Hestia Manos está en el teléfono (caps «telefono_ops»).
//  - Lo frecuente lo entiende el CÓDIGO (TelefonoParse → preroute): al instante, sin el modelo.
//  - Lo que crea o abre algo (alarma, temporizador, una app, Maps) pide aprobación (en la llamada, basta un «sí»: AprobacionVoz).
//  - Linterna, volumen y batería van directo: no cambian nada que no se deshaga con un toque.
//  - `dangerous`: en un turno con contenido externo (web, archivos, y en K1 los mensajes de otros) no corre.
// ============================================================

import { z } from "zod";
import { Tool, type PreflightResult, type ToolExecutionResult } from "../Tool.js";
import { canTelefono, appsDelTelefono, requestTelefonoOp, type TelefonoOp, type TelefonoResult } from "../services/TelefonoBridge.js";
import { parseTelefono, duracionDicha, horaDicha } from "../services/TelefonoParse.js";

const ACCIONES = ["abrir_app", "alarma", "temporizador", "linterna", "volumen", "navegar", "bateria"] as const;

const Schema = z.object({
  accion: z.enum(ACCIONES).describe("Qué hacer en el teléfono"),
  nombre: z.string().optional().describe("abrir_app: el nombre de la app («Spotify», «WhatsApp»)"),
  hora: z.number().int().optional().describe("alarma: la hora (0-23)"),
  minuto: z.number().int().optional().describe("alarma: los minutos (0-59)"),
  mensaje: z.string().optional().describe("alarma o temporizador: para qué es (opcional)"),
  segundos: z.number().int().optional().describe("temporizador: la duración en segundos"),
  encender: z.boolean().optional().describe("linterna: true prende, false apaga"),
  cambio: z.enum(["subir", "bajar", "silencio", "maximo", "nivel"]).optional().describe("volumen: qué hacer"),
  nivel: z.number().int().optional().describe("volumen con cambio=nivel: de 0 a 100"),
  destino: z.string().optional().describe("navegar: a dónde (una dirección o un lugar)"),
});
type Input = z.infer<typeof Schema>;

const hhmm = (h?: number, m?: number) => `${String(h ?? 0).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
/** 600 → «10 minutos»; 5400 → «1 hora y 30 minutos» */
export function duracionTexto(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60;
  const p: string[] = [];
  if (h) p.push(`${h} ${h === 1 ? "hora" : "horas"}`);
  if (m) p.push(`${m} ${m === 1 ? "minuto" : "minutos"}`);
  if (seg && !h) p.push(`${seg} ${seg === 1 ? "segundo" : "segundos"}`);
  return p.join(" y ") || "0 segundos";
}

/** La pregunta de la aprobación (la primera línea se dice en voz alta en la llamada: AprobacionVoz) */
export function preguntaTelefono(i: Input): string | null {
  switch (i.accion) {
    case "alarma": return `¿Pongo una alarma a las ${hhmm(i.hora, i.minuto)}${i.mensaje ? ` para ${i.mensaje}` : ""}?`;
    case "temporizador": return `¿Pongo un temporizador de ${duracionTexto(i.segundos ?? 0)}${i.mensaje ? ` para ${i.mensaje}` : ""}?`;
    case "abrir_app": return `¿Abro ${i.nombre ?? "esa app"} en tu teléfono?`;
    case "navegar": return `¿Te abro Maps rumbo a ${i.destino ?? "ese lugar"}?`;
    default: return null; // linterna, volumen, batería: directo
  }
}

/** Lo que se le dice después (por código: corto, con lo que respondió el teléfono) */
export function respuestaTelefono(i: Input, r: TelefonoResult): string {
  if (!r.ok) {
    switch (r.code) {
      case "sin_manos": return "Para eso necesito Hestia Manos instalada en tu teléfono.";
      case "ambigua": return `Hay varias apps así: ${(r.opciones ?? []).join(", ")}. ¿Cuál abro?`;
      case "no_encontrada": return r.msg ?? "No encontré esa app en tu teléfono.";
      case "bloqueado": return `${r.msg ?? "Android no me dejó."} Con la pantalla apagada necesito el permiso «Mostrar sobre otras apps» en Hestia Manos.`;
      case "timeout": return "El teléfono no respondió a tiempo. ¿Lo intento de nuevo?";
      default: return r.msg ?? "No pude hacerlo en el teléfono.";
    }
  }
  const d = r.data ?? {};
  switch (i.accion) {
    case "alarma": return `Listo: alarma a las ${hhmm(d.hora ?? i.hora, d.minuto ?? i.minuto)}${i.mensaje ? ` para ${i.mensaje}` : ""}.`;
    case "temporizador": return `Listo: temporizador de ${duracionTexto(d.segundos ?? i.segundos ?? 0)}.`;
    case "linterna": return (d.encendida ?? i.encender) === false ? "Linterna apagada." : "Linterna prendida.";
    case "volumen": return i.cambio === "silencio" ? "Listo, en silencio." : `Volumen al ${d.porcentaje ?? i.nivel ?? "?"} %.`;
    case "navegar": return `Te abrí Maps rumbo a ${d.destino ?? i.destino}.`;
    case "bateria": return `Tu teléfono tiene ${d.porcentaje ?? "?"} % de batería${d.cargando ? " y está cargando" : ""}.`;
    case "abrir_app": return `Abrí ${d.app ?? i.nombre}.`;
  }
  return "Listo.";
}

export class TelefonoTool extends Tool<Input> {
  readonly name = "telefono";
  readonly description =
    "Hace cosas en el TELÉFONO de Alex (no en su PC), con su app Hestia Manos: abrir una app del teléfono, poner una alarma o un " +
    "temporizador, prender o apagar la linterna, el volumen, navegar con Maps o ver la batería. Para el PC usa open o bash.";
  readonly inputSchema = Schema;
  readonly dangerous = true;
  readonly audited = true;

  /** Lo frecuente, por código (solo con Hestia Manos en el teléfono y en Modo AXS) */
  async preroute(userMessage: string, context?: any): Promise<Record<string, unknown> | null> {
    if (context?.axsMode !== true || context?.role !== "ikaros" || !canTelefono(context?.wsClient)) return null;
    return (parseTelefono(userMessage, appsDelTelefono(context?.wsClient)) as Record<string, unknown> | null) ?? null;
  }

  preflight(input: Input, context?: any): PreflightResult {
    if (input.accion === "alarma" && (input.hora == null || input.hora < 0 || input.hora > 23)) return { ok: false, reason: "Falta la hora de la alarma (0 a 23)." };
    // «En 15 minutos» es un temporizador: la hora calculada por el modelo sale mal (banco «voz»: 14:41 + 15 min → 15:55)
    const dicho = String(context?.userMessage ?? "");
    const dura = duracionDicha(dicho);
    if (input.accion === "alarma" && dura && /\ben\s+(\d+|un|una|media|medio|un cuarto)\b/i.test(dicho)) {
      return { ok: false, reason: `Pidió que suene EN un rato, no a una hora: usa accion «temporizador» con segundos=${dura}.` };
    }
    // La hora que él dijo manda (el modelo leyó «siete y cuarto» como 7:30)
    const h = input.accion === "alarma" ? horaDicha(dicho) : null;
    if (h && (h.hora % 12 !== (input.hora ?? -1) % 12 || h.minuto !== input.minuto)) {
      return { ok: false, reason: `La hora que dijo es ${hhmm(h.hora, h.minuto)}: usa hora=${h.hora} y minuto=${h.minuto}.` };
    }
    if (input.accion === "temporizador" && !(input.segundos && input.segundos > 0)) return { ok: false, reason: "Falta cuánto dura el temporizador." };
    const q = preguntaTelefono(input);
    if (!q) return { ok: true };
    const titulos: Record<string, string> = {
      alarma: "Poner una alarma en tu teléfono", temporizador: "Poner un temporizador en tu teléfono",
      abrir_app: "Abrir una app en tu teléfono", navegar: "Navegar con Maps en tu teléfono",
    };
    return { ok: true, approval: { title: titulos[input.accion] ?? "Hacer algo en tu teléfono", detail: `${q}\n\n(Hestia Manos · ${input.accion})`, risk: "normal", flags: [] } };
  }

  async execute(input: Input, context?: any): Promise<ToolExecutionResult> {
    const ws = context?.wsClient;
    if (context?.role !== "ikaros" || context?.axsMode !== true) return { output: "", error: "Esto es solo de Hestia, en el Modo AXS Executive." };
    if (!canTelefono(ws)) {
      const q = "Para eso necesito Hestia Manos instalada en tu teléfono (y abrir Eris con ella ya instalada).";
      return { output: q, metadata: { quickReply: q } };
    }
    const op: TelefonoOp = { ...input };
    const r = await requestTelefonoOp(ws, op);
    const q = respuestaTelefono(input, r);
    // (lo que no se pudo también va como respuesta lista: es la verdad de lo que pasó en el teléfono)
    return { output: q, metadata: { quickReply: q, telefonoOk: r.ok } };
  }
}
