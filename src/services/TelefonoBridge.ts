// ============================================================
// Hestia Manos (K0, 2026-11-16): lo que Hestia hace en el TELÉFONO lo hace una app aparte («Hestia Manos», solo el teléfono de
// Alex). El servidor le manda la operación a Eris ({type:"telefono_op"}), Eris la reenvía a Hestia Manos y contesta con el
// resultado real ({type:"telefono_op_result"}). Mismo patrón que Finanzas (FinanceBridge.ts): solo vale la respuesta que llega
// por la MISMA conexión, y vence.
// ============================================================

export interface TelefonoOp {
  accion: "estado" | "apps" | "abrir_app" | "alarma" | "temporizador" | "linterna" | "volumen" | "navegar" | "bateria"
    // K1
    | "mensajes" | "responder" | "contactos" | "llamar" | "sms" | "whatsapp" | "musica"
    // K2: al teléfono van «eventos» y «crear_evento»; «calendario» y «agendar» son de la herramienta (las resuelve el servidor)
    | "eventos" | "crear_evento" | "calendario" | "agendar";
  nombre?: string; paquete?: string;
  hora?: number; minuto?: number; mensaje?: string;
  segundos?: number;
  encender?: boolean;
  cambio?: "subir" | "bajar" | "silencio" | "maximo" | "nivel"; nivel?: number;
  destino?: string;
  // K1: a quién (como lo dijo), en qué app, el texto exacto, el número ya resuelto, la conversación
  persona?: string; app?: string; horas?: number; codigos?: boolean;
  texto?: string; numero?: string; chat?: string;
  /** responder: «auto» = por su chat si te escribió hace poco; si no, WhatsApp */
  canal?: "auto";
  que?: "pausa" | "sigue" | "siguiente" | "anterior" | "que_suena";
  // K2: el rango (ms), el evento (título, comienzo y fin en ms) y, para la herramienta, cuándo como lo dijo
  desde?: number; hasta?: number;
  titulo?: string; inicio?: number; fin?: number; todoElDia?: boolean; lugar?: string;
  cuando?: string; duracionMin?: number;
}

export interface TelefonoResult {
  ok: boolean;
  /** sin_manos | no_autorizado | no_encontrada | ambigua | bloqueado | sin_reloj | sin_linterna | invalido | timeout | sin_conexion | error */
  code?: string;
  msg?: string;
  opciones?: string[];
  data?: any;
}

const TIMEOUT_MS = 15_000;
const pending = new Map<string, { ws: any; resolve: (r: TelefonoResult) => void; timer: ReturnType<typeof setTimeout> }>();

/** ¿Esta conexión tiene Hestia Manos en el teléfono? (Eris la anuncia con caps: ["telefono_ops"] solo si está instalada) */
export function canTelefono(ws: any): boolean {
  return !!(ws?.data as any)?.canTelefono;
}

/** Las apps del teléfono que se pueden abrir por su nombre (las manda Eris al conectar: «telefono_apps») */
export function appsDelTelefono(ws: any): string[] {
  const a = (ws?.data as any)?.telefonoApps;
  return Array.isArray(a) ? a : [];
}

export function requestTelefonoOp(ws: any, op: TelefonoOp, timeoutMs = TIMEOUT_MS): Promise<TelefonoResult> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, code: "timeout", msg: "El teléfono no respondió a tiempo." });
    }, timeoutMs);
    pending.set(requestId, { ws, resolve, timer });
    try {
      ws.send(JSON.stringify({ type: "telefono_op", requestId, op }));
    } catch {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve({ ok: false, code: "sin_conexion", msg: "Se cortó la conexión con el teléfono." });
    }
  });
}

/** Respuesta del teléfono. Solo vale si llega por la MISMA conexión que recibió el pedido. */
export function resolveTelefonoOp(ws: any, data: any): boolean {
  const id = String(data?.requestId ?? "");
  const p = pending.get(id);
  if (!p || p.ws !== ws) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  const r = data?.result;
  p.resolve(r && typeof r === "object" && typeof r.ok === "boolean" ? r : { ok: false, code: "error", msg: "El teléfono mandó una respuesta que no entendí." });
  return true;
}
