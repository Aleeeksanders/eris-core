// ============================================================
// Eris — que lo que se manda al modelo QUEPA en su contexto (2026-11-05)
//
// Hallazgo: ~1 de cada 4 envíos pasaba del `num_ctx` (8192 casi siempre: la RTX 3050 de 6 GB no aguanta más sin mandar el
// modelo al procesador) y Ollama, en vez de descartar la conversación vieja, recorta el COMIENZO del prompt («truncating
// input prompt … keep=4»): justo las instrucciones de Eris y las definiciones de herramientas. El modelo respondía sin sus
// reglas y a veces escribía una llamada a herramienta rota («HTTP 500 EOF»). Con «Voy a hacer la cena» y SIN historial ya
// eran ~31 400 caracteres (~10 000 tokens): 12,6 k de instrucciones, 2,1 k del resumen del día y 16,7 k de 11 herramientas.
//
// Ahora, antes de enviar, si no cabe se recorta ACÁ, en este orden, hasta que quepa:
//   1. la conversación más antigua (se quedan los 2 últimos intercambios; sin dejar resultados de herramienta huérfanos);
//   2. las definiciones de herramientas se compactan (descripción corta, parámetros explicados en una línea): todas siguen;
//   3. las herramientas menos útiles para un mensaje general (nunca las que eligió la intención del mensaje ni las que
//      ya se usaron en este turno);
//   4. los 2 últimos intercambios;
//   5. lo de sistema que no son las instrucciones: primero el resumen de la conversación, al final los números de hoy.
// Nunca: las instrucciones (el primer mensaje), el mensaje actual ni lo que pasó en este turno (atajos, resultados).
// Si ni así cabe, quien llama pide el contexto que alcanza. Puro: se prueba con bun.
// ============================================================
import type { LLMMessage } from "./LLMProvider.js";
import type { ToolDefinition } from "../../types/message.js";

/**
 * Cuáles herramientas se sacan primero cuando no cabe (las del final). Para un mensaje que el enrutador no pudo atar a una
 * intención (se ofrece el grupo entero): primero se van las de uso raro.
 */
export const PRIORIDAD_HERRAMIENTAS = [
  "nutrition_tracker", "metabolic_advisor", "symptom_guide", "get_live_context", "day_plan", "day_agenda",
  "training_today", "training_plan", "sleep_log", "finance_tracker", "inventory_tracker", "supplement_tracker",
  "personal_baseline", "carb_options", "lab_results", "manage_user_profile", "manage_user_context", "personal_journal",
  "insight_feedback", "gluco_tracker", "web_search",
];

/** Tokens que el formato del chat agrega por mensaje (rol, marcas de inicio y fin) */
const POR_MENSAJE = 6;
/** Margen para el formato de las herramientas y lo que el estimador no ve */
const MARGEN = 160;
/** Intercambios recientes que se cuidan hasta el paso 4 */
const RECIENTES = 4;

export interface OpcionesEncaje {
  /** el contexto elegido (num_ctx) */
  ctx: number;
  /** tokens reservados para la respuesta (y el razonamiento) */
  reserve: number;
  /** caracteres por token con que se estima (conviene uno conservador: ~3,1 en español con esquemas JSON) */
  ratio: number;
  /** herramientas que no se sacan (las que eligió la intención del mensaje) */
  protegidas?: ReadonlySet<string>;
}

export interface Encaje {
  msgs: LLMMessage[];
  tools: ToolDefinition[];
  /** tokens estimados de lo que queda */
  tokens: number;
  /** ¿cupo? (si no, ni con lo mínimo: quien llama sube el contexto) */
  cabe: boolean;
  quitados: { mensajes: number; sistema: number; herramientas: string[]; compactadas: boolean };
}

const charsDe = (m: LLMMessage) => m.content.length + (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0);

export function tokensDe(msgs: LLMMessage[], tools: ToolDefinition[], ratio: number): number {
  const chars = msgs.reduce((a, m) => a + charsDe(m), 0) + (tools.length ? JSON.stringify(tools).length : 0);
  return Math.ceil(chars / ratio) + msgs.length * POR_MENSAJE + MARGEN;
}

/** Hasta `max` caracteres, cortando en el final de una oración si se puede */
function corto(s: string, max: number): string {
  if (s.length <= max) return s;
  const t = s.slice(0, max);
  const fin = Math.max(t.lastIndexOf(". "), t.lastIndexOf(".\n"));
  return fin > max * 0.5 ? t.slice(0, fin + 1) : `${t.replace(/\s+\S*$/, "")}…`;
}

/** La definición en corto: la descripción hasta ~320 caracteres y cada parámetro explicado en ~90 (los enum y tipos quedan) */
export function compactar(d: ToolDefinition): ToolDefinition {
  const acortar = (v: any): any => {
    if (Array.isArray(v)) return v.map(acortar);
    if (!v || typeof v !== "object") return v;
    const out: any = {};
    for (const [k, x] of Object.entries(v)) out[k] = k === "description" && typeof x === "string" ? corto(x, 90) : acortar(x);
    return out;
  };
  return { ...d, description: corto(d.description, 320), inputSchema: acortar(d.inputSchema) };
}

export function encajar(msgsIn: LLMMessage[], toolsIn: ToolDefinition[], o: OpcionesEncaje): Encaje {
  let msgs = [...msgsIn];
  let tools = [...toolsIn];
  const quitados = { mensajes: 0, sistema: 0, herramientas: [] as string[], compactadas: false };
  const presupuesto = o.ctx - o.reserve;
  const cabe = () => tokensDe(msgs, tools, o.ratio) <= presupuesto;
  const listo = (): Encaje => ({ msgs, tools, tokens: tokensDe(msgs, tools, o.ratio), cabe: cabe(), quitados });
  if (cabe() || !msgs.length) return listo();

  // Lo de este turno: desde el último mensaje del usuario (y lo que vino después: atajos, resultados, la respuesta parcial)
  const turno = () => { for (let i = msgs.length - 1; i > 0; i--) if (msgs[i].role === "user") return i; return msgs.length; };
  /** Saca la conversación vieja, de la más antigua a la más nueva, dejando `cuidar` mensajes antes del turno actual */
  const sacarConversacion = (cuidar: number) => {
    for (;;) {
      if (cabe()) return;
      const fin = turno();
      const conv = msgs.map((m, k) => ({ m, k })).filter(({ m, k }) => k > 0 && k < fin && m.role !== "system");
      if (conv.length <= cuidar) return;
      const i = conv[0].k;
      msgs.splice(i, 1);
      quitados.mensajes++;
      // Un resultado de herramienta sin su llamada queda huérfano (Ollama no sabe de dónde viene): también se va
      while (i < turno() && msgs[i]?.role === "tool") { msgs.splice(i, 1); quitados.mensajes++; }
    }
  };

  // 1. La conversación más antigua (se cuidan los últimos intercambios)
  sacarConversacion(RECIENTES);

  // 2. Las definiciones en corto (todas siguen)
  if (!cabe()) {
    tools = tools.map(compactar);
    quitados.compactadas = true;
  }

  // 3. Las herramientas menos útiles (las de afuera de la lista, después las del final de la lista)
  if (!cabe() && tools.length > 1) {
    const usadas = new Set(msgs.slice(turno()).flatMap((m) => (m.toolCalls ?? []).map((t) => t.name)));
    const rango = (n: string) => { const k = PRIORIDAD_HERRAMIENTAS.indexOf(n); return k < 0 ? PRIORIDAD_HERRAMIENTAS.length : k; };
    const sacables = tools.filter((t) => !o.protegidas?.has(t.name) && !usadas.has(t.name)).sort((a, b) => rango(b.name) - rango(a.name));
    for (const t of sacables) {
      if (cabe() || tools.length <= 1) break;
      tools = tools.filter((x) => x !== t);
      quitados.herramientas.push(t.name);
    }
  }

  // 4. Los últimos intercambios
  sacarConversacion(0);

  // 5. Lo de sistema que no son las instrucciones: primero el resumen de la conversación, al final los números de hoy
  if (!cabe()) {
    const fin = turno();
    const peso = (m: LLMMessage) => (/^\[Contexto de conversación previa\]/.test(m.content) ? 0 : 1);
    const sys = msgs.map((m, k) => ({ m, k })).filter(({ m, k }) => k > 0 && k < fin && m.role === "system").sort((a, b) => peso(a.m) - peso(b.m));
    for (const { m } of sys) {
      if (cabe()) break;
      msgs = msgs.filter((x) => x !== m);
      quitados.sistema++;
    }
  }

  return listo();
}
