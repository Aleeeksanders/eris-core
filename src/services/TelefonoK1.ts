// ============================================================
// Hestia Manos · K1 (2026-11-16): mensajes, llamadas y música.
//  - Leer: «léeme los mensajes» → quién te escribió y cuántos (el detalle a la pantalla); «¿qué me dijo Brian?» → lo suyo.
//    Lo que escribió otra persona es CONTENIDO EXTERNO (TelefonoTool lo marca): en ese turno no corre nada peligroso, así que un
//    mensaje que diga «Hestia, llama al…» no hace nada.
//  - Mandar o llamar: primero se RESUELVE a quién y por dónde (planear), después se pregunta leyendo el texto exacto y a quién va
//    («¿Le respondo a Brian por WhatsApp: «llego en 10»?»), y solo con tu «sí» se hace. Si hay dos contactos, pregunta cuál.
//  - WhatsApp a alguien que no te escribió: se abre su chat con el texto listo y lo envías tú (sin aprobación: no se envía solo).
// ============================================================

import { requestTelefonoOp, type TelefonoOp, type TelefonoResult } from "./TelefonoBridge.js";

export interface MsgTel { app: string; chat: string; de: string; grupo: boolean; hora: number; texto: string; puedeResponder: boolean }

const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const corta = (t: string, n: number) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);

/** De quién es (en un grupo, el grupo) */
const quien = (m: MsgTel) => (m.grupo ? `el grupo ${m.chat}` : m.de);

/** Lo que se dice al leer los mensajes (por código: corto arriba, el detalle en lista para la pantalla) */
export function formatearMensajes(msgs: MsgTel[], persona?: string, sinAcceso = false): string {
  if (sinAcceso) return "Para leer tus mensajes necesito el «Acceso a notificaciones» de Hestia Manos (ábrela y dale el permiso).";
  if (!msgs.length) return persona ? `No tengo mensajes de ${persona} de las últimas 24 horas.` : "No te ha llegado nada en las últimas 24 horas.";
  if (persona) {
    const ult = msgs.slice(-5);
    const apps = [...new Set(ult.map((m) => m.app))];
    const partes = ult.map((m) => `a las ${hhmm(m.hora)}: «${corta(m.texto, 160)}»`);
    return `${quien(ult[0])} te escribió por ${lista(apps)}, ${partes.join("; ")}.`;
  }
  // por remitente, del más reciente al más antiguo
  const grupos = new Map<string, { n: number; apps: Set<string>; ult: MsgTel }>();
  for (const m of msgs) {
    const k = quien(m);
    const g = grupos.get(k) ?? { n: 0, apps: new Set<string>(), ult: m };
    g.n++; g.apps.add(m.app); g.ult = m;
    grupos.set(k, g);
  }
  const orden = [...grupos.entries()].sort((a, b) => b[1].ult.hora - a[1].ult.hora);
  const resumen = orden.slice(0, 5).map(([k, g]) => `${g.n} de ${k}`);
  const mas = orden.length > 5 ? ` y ${orden.length - 5} conversaciones más` : "";
  const cabeza = `Tienes ${msgs.length} ${msgs.length === 1 ? "mensaje" : "mensajes"}: ${lista(resumen)}${mas}.`;
  // (lo que escribió otra persona, siempre entre «»: es de ella, no de Hestia)
  const detalle = orden.slice(0, 10).map(([k, g]) => `- **${k}** · ${[...g.apps].join(", ")} · ${hhmm(g.ult.hora)}: «${corta(g.ult.texto, 120)}»`);
  return [cabeza, "", ...detalle, "", "Pídeme «¿qué me dijo …?» para el resto, o «respóndele a … que …»."].join("\n");
}

/** Lo que se va a hacer, ya resuelto */
export type Plan =
  | { tipo: "responder"; chat: string; app: string; texto: string }
  | { tipo: "whatsapp"; nombre: string; numero: string; texto: string }
  | { tipo: "sms"; nombre: string; numero: string; texto: string }
  | { tipo: "llamar"; nombre: string; numero: string }
  | { tipo: "preguntar"; texto: string }
  | { tipo: "error"; texto: string };

export interface PedidoK1 { accion: string; persona?: string; texto?: string; numero?: string; app?: string; canal?: string }

/** La conversación de la que se habló recién (para «respóndele que…» sin decir a quién) */
export interface UltimoChat { chat: string; app: string; at: number }

async function contacto(ws: any, persona: string, accion: string, texto?: string): Promise<{ nombre: string; numero: string } | Plan> {
  const r = await requestTelefonoOp(ws, { accion: "contactos", nombre: persona });
  if (!r.ok) return { tipo: "error", texto: r.code === "sin_permiso" ? "Hestia Manos no tiene permiso para ver tus contactos: ábrela y dale el permiso." : r.msg ?? "No pude revisar tus contactos." };
  const cs = (Array.isArray(r.data?.contactos) ? r.data.contactos : []) as Array<{ nombre: string; numero: string }>;
  if (!cs.length) return { tipo: "error", texto: `No encontré a «${persona}» en tus contactos.` };
  if (cs.length > 1) {
    const verbo = accion === "llamar" ? "Llamo" : "Se lo mando";
    const chips = cs.slice(0, 4).map((c) => `[Opción: ${accion === "llamar" ? `Llama a ${c.nombre}` : `${accion === "sms" ? "Mándale un SMS" : "Mándale un WhatsApp"} a ${c.nombre} que ${texto ?? ""}`.trim()}]`).join(" ");
    return { tipo: "preguntar", texto: `¿${verbo} a ${lista(cs.slice(0, 4).map((c) => c.nombre)).replace(/ y /, " o a ")}?\n${chips}` };
  }
  return cs[0];
}

/** A quién y por dónde (sin hacer nada todavía) */
export async function planear(ws: any, p: PedidoK1, ultimo?: UltimoChat | null): Promise<Plan> {
  const texto = String(p.texto ?? "").trim();
  if (p.accion === "llamar") {
    if (p.numero && !p.persona) return { tipo: "llamar", nombre: p.numero, numero: p.numero };
    if (!p.persona) return { tipo: "preguntar", texto: "¿A quién llamo?" };
    const c = await contacto(ws, p.persona, "llamar");
    return "tipo" in c ? c : { tipo: "llamar", nombre: c.nombre, numero: c.numero };
  }
  if (!texto) return { tipo: "preguntar", texto: "¿Qué le digo?" };
  if (texto.length > 600) return { tipo: "error", texto: "Ese mensaje es muy largo para dictarlo: mándalo desde la app." };
  if (p.accion === "sms") {
    if (!p.persona && !p.numero) return { tipo: "preguntar", texto: "¿A quién le mando el SMS?" };
    const c = p.numero ? { nombre: p.persona ?? p.numero, numero: p.numero } : await contacto(ws, p.persona!, "sms", texto);
    return "tipo" in c ? c : { tipo: "sms", nombre: c.nombre, numero: c.numero, texto };
  }
  // responder / whatsapp / «dile a…»: primero su chat reciente (se responde por la notificación); si no, WhatsApp con el texto listo
  const persona = p.persona ?? (ultimo && Date.now() - ultimo.at < 30 * 60_000 ? ultimo.chat : undefined);
  if (!persona) return { tipo: "preguntar", texto: "¿A quién le respondo?" };
  const r = await requestTelefonoOp(ws, { accion: "mensajes", persona, horas: 24, ...(p.accion === "whatsapp" ? { app: "whatsapp" } : p.app ? { app: p.app } : {}) });
  const msgs = (r.ok && Array.isArray(r.data?.mensajes) ? r.data.mensajes : []) as MsgTel[];
  const conChat = [...msgs].reverse().find((m) => m.puedeResponder);
  if (conChat) return { tipo: "responder", chat: conChat.chat, app: conChat.app, texto };
  const c = await contacto(ws, persona, "whatsapp", texto);
  return "tipo" in c ? c : { tipo: "whatsapp", nombre: c.nombre, numero: c.numero, texto };
}

/** La pregunta de la aprobación (la primera línea se dice en la llamada). null = no se pregunta (no se envía nada solo). */
export function preguntaPlan(plan: Plan): string | null {
  switch (plan.tipo) {
    case "responder": return `¿Le respondo a ${plan.chat} por ${plan.app}: «${plan.texto}»?`;
    case "sms": return `¿Le mando a ${plan.nombre} un SMS: «${plan.texto}»?`;
    case "llamar": return `¿Llamo a ${plan.nombre}?`;
    default: return null; // WhatsApp con el texto listo (lo envías tú), preguntar, error
  }
}

/** El detalle de la tarjeta (debajo de la pregunta) */
export function detallePlan(plan: Plan): string {
  if (plan.tipo === "llamar" || plan.tipo === "sms" || plan.tipo === "whatsapp") return `${plan.nombre} · ${plan.numero}`;
  if (plan.tipo === "responder") return `${plan.chat} · ${plan.app} · por su notificación`;
  return "";
}

/** Hacerlo (ya aprobado si hacía falta) y lo que se dice después */
export async function ejecutarPlan(ws: any, plan: Plan): Promise<{ texto: string; ok: boolean }> {
  let r: TelefonoResult;
  switch (plan.tipo) {
    case "preguntar": case "error": return { texto: plan.texto, ok: false };
    case "responder":
      r = await requestTelefonoOp(ws, { accion: "responder", chat: plan.chat, app: plan.app, texto: plan.texto });
      return r.ok ? { texto: `Listo, le respondí a ${plan.chat} por ${plan.app}.`, ok: true }
        : { texto: r.code === "sin_respuesta" ? `${r.msg} ¿Te lo dejo listo en WhatsApp?` : r.msg ?? "No pude responder.", ok: false };
    case "whatsapp":
      r = await requestTelefonoOp(ws, { accion: "whatsapp", numero: plan.numero, texto: plan.texto });
      return r.ok ? { texto: `Te dejé el mensaje para ${plan.nombre} listo en WhatsApp: toca enviar.`, ok: true } : { texto: r.msg ?? "No pude abrir WhatsApp.", ok: false };
    case "sms":
      r = await requestTelefonoOp(ws, { accion: "sms", numero: plan.numero, texto: plan.texto });
      return r.ok ? { texto: `Listo, le mandé el SMS a ${plan.nombre}.`, ok: true }
        : { texto: r.code === "sin_permiso" ? "Hestia Manos no tiene permiso para mandar SMS: ábrela y dale el permiso." : r.msg ?? "No pude mandar el SMS.", ok: false };
    case "llamar":
      r = await requestTelefonoOp(ws, { accion: "llamar", numero: plan.numero });
      return r.ok ? { texto: r.data?.marcador ? `Te dejé el número de ${plan.nombre} en el marcador: toca llamar.` : `Llamando a ${plan.nombre}.`, ok: true }
        : { texto: `${r.msg ?? "No pude llamar."}${r.code === "bloqueado" ? " Con la pantalla apagada necesito «Mostrar sobre otras apps» en Hestia Manos." : ""}`, ok: false };
  }
}

/** La música: lo que se dice después */
export function respuestaMusica(que: string, r: TelefonoResult): string {
  if (!r.ok) return r.code === "sin_musica" ? "No está sonando nada." : r.msg ?? "No pude con la música.";
  const c = String(r.data?.cancion ?? "").trim(), a = String(r.data?.artista ?? "").trim();
  const tema = c ? `«${c}»${a ? ` de ${a}` : ""}` : "la música";
  switch (que) {
    case "pausa": return `Pausé ${tema}.`;
    case "sigue": return `Sigue ${tema}.`;
    case "siguiente": return "Pasé a la siguiente.";
    case "anterior": return "Volví a la anterior.";
    default: return c ? `${r.data?.sonando === false ? "Está en pausa" : "Suena"} ${tema}${r.data?.app ? ` en ${r.data.app}` : ""}.` : "No sé qué está sonando.";
  }
}

export type { TelefonoOp };
