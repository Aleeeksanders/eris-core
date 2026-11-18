// ============================================================
// Hestia · K5 (2026-11-17): con el teléfono BLOQUEADO, qué hace Hestia. Tres niveles, decididos por este código (no por el modelo):
//  - «seguro» (cualquiera que tenga el teléfono en la mano): alarma, temporizador, linterna, volumen, música, batería; la hora y
//    la fecha van aparte (Directas). Es lo de K3.
//  - «tu_voz»: la llamada se abrió diciendo «Hestia» y Hestia Manos reconoció TU voz (VozPropia.kt, comparada con tus
//    grabaciones en el teléfono). Además: tu día (agenda, entreno, remedios), anotar comida, agua y sueño, preguntarle cosas y
//    quién te escribió (solo nombres y cuántos). El modelo corre, pero solo con HERRAMIENTAS_TU_VOZ y sin las cifras de la plata.
//  - «desbloquear»: lo que llega a otras personas o a la plata, aunque sea tu voz: mandar mensajes o WhatsApp, leer lo que te
//    escribieron, llamar (decisión del usuario, 2026-11-17: «llamar déjalo desbloqueado»), agendar, abrir apps, Maps, manejar
//    apps, Finanzas, el PC y la bóveda de AXS. Por qué: la voz se puede imitar con una grabación y el reconocedor a veces se
//    equivoca; lo peor que pasa en «tu_voz» es que alguien oiga tu agenda. El cuento del tío por WhatsApp no pasa por acá.
// Reconocer tu voz vale para esa llamada: la siguiente necesita otro «Hestia».
// ============================================================
import { parseTelefono, SEGURAS_BLOQUEADO } from "../TelefonoParse.js";
import { groupsFor } from "../ToolRouter.js";

export type NivelBloqueado = "seguro" | "tu_voz" | "desbloquear";

/** Las herramientas que ve el modelo con el teléfono bloqueado y tu voz (sin Finanzas, el PC, la bóveda, el contexto completo) */
export const HERRAMIENTAS_TU_VOZ = [
  "telefono", "day_agenda", "nutrition_tracker", "sleep_log", "training_today", "training_plan", "supplement_tracker",
  "symptom_guide", "manage_user_profile", "personal_baseline", "web_search",
];

/** Lo del teléfono que vale con tu voz: lo seguro, quién te escribió (sin qué) y tu calendario */
export function opTuVoz(op: { accion?: unknown; persona?: unknown; codigos?: unknown } | null | undefined): boolean {
  if (!op) return false;
  const a = String(op.accion ?? "");
  if (SEGURAS_BLOQUEADO.has(a)) return true;
  if (a === "mensajes") return !String(op.persona ?? "").trim() && op.codigos !== true;
  return a === "calendario";
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** La plata dicha de cualquier forma (además del grupo de Finanzas del selector) */
const PLATA = /\b(plata|dinero|pesos|lucas?|luquitas?|palos?|gast\w*|pag(o|os|ar|ue|ué|aste|ue)\b|ahorr\w*|sueldo|alcanza|presupuesto|deudas?|saldos?|finanzas|tarjetas?|cuotas?|banco|transfer\w*|deposit\w*|cobr\w*|cuenta rut)\b/;
/** Grupos que nunca corren bloqueado (el teléfono sí, pero solo lo que dice opTuVoz) */
const NUNCA = ["finance", "axs", "system", "admin"] as const;

/** ¿Qué nivel pide este texto con el teléfono bloqueado? `tuVoz`: la llamada se abrió con tu voz reconocida. */
export function nivelBloqueado(texto: string, tuVoz: boolean): NivelBloqueado {
  const op = parseTelefono(texto) as Record<string, unknown> | null;
  if (op && SEGURAS_BLOQUEADO.has(String(op.accion))) return "seguro";
  if (!tuVoz) return "desbloquear";
  if (op) return opTuVoz(op) ? "tu_voz" : "desbloquear";
  const t = fold(texto);
  const g = groupsFor(texto);
  if (NUNCA.some((x) => g.has(x)) || PLATA.test(t)) return "desbloquear";
  // algo del teléfono que el atajo no reconoció («escríbele a…», «contesta eso»): mejor desbloqueado
  if (g.has("telefono")) return "desbloquear";
  return "tu_voz";
}

/** Lo que se le dice al modelo en ese turno (además de lo que hace el código) */
export const NOTA_TU_VOZ =
  "(Dato interno: el teléfono está bloqueado y reconocí la voz de Alex. Puedes ayudarle con su día, anotar comida, agua o sueño y " +
  "responder preguntas. No hables de plata ni leas mensajes de otros: para eso, que desbloquee el teléfono.)";

/** Lo que dice Hestia cuando algo espera a que desbloquees (el mismo texto de K3) */
export const PIDE_DESBLOQUEO = "Para eso desbloquea el teléfono; apenas lo hagas, sigo.";
