// ============================================================
// Hestia por voz (J3, 2026-11-16): al colgar, el resumen de la llamada queda en la memoria de Hestia. Lo arma el CÓDIGO con lo que
// pasó de verdad (lo que preguntó, las herramientas que corrieron, lo aprobado o rechazado y lo último que dijo Hestia), sin el
// modelo: un resumen redactado por un modelo de 4B puede inventar acuerdos que nunca se hicieron.
// Se usa en la llamada siguiente («lo que hablamos ayer») y en el chat de Hestia (Modo AXS).
// ============================================================

export interface EventoLlamada {
  tipo: "herramienta" | "aprobacion";
  nombre: string;
  /** aprobación: approved / denied / timeout… y qué era («Abrir un enlace en el navegador · youtube») */
  decision?: string;
  que?: string;
}

export interface LlamadaGuardada { at: string; fin: string; resumen: string }

export const CLAVE_LLAMADAS = "voz_llamadas";
const MAX_GUARDADAS = 10;

/** Las herramientas, como las nombra él */
const NOMBRE: Record<string, string> = {
  day_agenda: "tu agenda", axs_briefing: "el briefing de AXS", knowledge_search: "la bóveda", vault_audit: "la bóveda", vault_note: "una nota de la bóveda",
  crystallize: "una decisión en la bóveda", nutrition_tracker: "comida y agua", finance_tracker: "Finanzas", sleep_log: "tu sueño",
  training_plan: "Forge", training_today: "Forge", inventory_tracker: "la casa (Inventario)", supplement_tracker: "tus suplementos",
  bash: "un comando en tu PC", open: "abrir algo en tu PC", file_write: "un archivo en tu PC", file_read: "un archivo de tu PC", day_plan: "el plan del día",
  web_search: "una búsqueda web", symptom_guide: "la guía de síntomas", metabolic_advisor: "qué comer",
};

const corta = (t: string, n: number) => { const s = String(t ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** El resumen (null si no se habló nada) */
export function resumenLlamada(o: { inicio: Date; fin: Date; history: Array<{ role: string; content: string }>; eventos: EventoLlamada[] }): string | null {
  const dichos = o.history.filter((m) => m.role === "user").map((m) => m.content.trim()).filter(Boolean);
  if (!dichos.length) return null;
  const dia = o.inicio.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });
  const L: string[] = [`Llamada del ${dia}, de ${hhmm(o.inicio)} a ${hhmm(o.fin)}.`];
  L.push(`Preguntó: ${dichos.slice(-6).map((d) => `«${corta(d, 70)}»`).join("; ")}.`);
  const usadas = [...new Set(o.eventos.filter((e) => e.tipo === "herramienta").map((e) => NOMBRE[e.nombre] ?? e.nombre))];
  if (usadas.length) L.push(`Revisé o usé: ${usadas.join(", ")}.`);
  const aprob = o.eventos.filter((e) => e.tipo === "aprobacion");
  const si = aprob.filter((e) => e.decision === "approved").map((e) => e.que ?? e.nombre);
  const no = aprob.filter((e) => e.decision !== "approved").map((e) => e.que ?? e.nombre);
  if (si.length) L.push(`Aprobó: ${si.map((x) => corta(x, 70)).join("; ")}.`);
  if (no.length) L.push(`No se hizo (rechazado o sin respuesta): ${no.map((x) => corta(x, 70)).join("; ")}.`);
  const ultima = [...o.history].reverse().find((m) => m.role === "assistant" && m.content.trim());
  if (ultima) L.push(`Lo último que le dije: «${corta(ultima.content.split(/(?<=[.!?])\s/)[0], 140)}»`);
  return L.join("\n");
}

/** Agrega una llamada a las guardadas (las últimas 10) */
export function guardarLlamada(previas: unknown, nueva: LlamadaGuardada): LlamadaGuardada[] {
  const lista = Array.isArray(previas) ? previas.filter((x): x is LlamadaGuardada => !!x && typeof (x as any).resumen === "string") : [];
  return [...lista, nueva].slice(-MAX_GUARDADAS);
}

/** La llamada anterior, si fue hace poco (para el contexto de la siguiente o del chat). null si no hay o es vieja. */
export function llamadaReciente(previas: unknown, ahora: Date, horas = 48): LlamadaGuardada | null {
  const lista = Array.isArray(previas) ? previas as LlamadaGuardada[] : [];
  const u = lista.at(-1);
  if (!u?.resumen || !u.fin) return null;
  return ahora.getTime() - new Date(u.fin).getTime() <= horas * 3_600_000 ? u : null;
}
