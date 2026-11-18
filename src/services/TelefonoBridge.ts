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
    | "eventos" | "crear_evento" | "calendario" | "agendar"
    // K4: manejar apps (accesibilidad). «revisar_toque» = qué se tocaría (para la aprobación), sin tocar
    | "pantalla" | "revisar_toque" | "tocar" | "escribir" | "atras" | "inicio" | "desplazar"
    // L2 (Hestia como JARVIS): la llamada que está sonando, con los botones de su notificación
    | "contestar" | "rechazar"
    // L5: el «No molestar» de Android (por un rato: Hestia Manos lo quita sola al terminar, aunque no alcance al PC)
    | "no_molestar";
  nombre?: string; paquete?: string;
  hora?: number; minuto?: number; mensaje?: string;
  /** alarma: dijo «cámbiala» (Android no deja tocar la que ya tenía: se pone otra y se le avisa) */
  reemplaza?: boolean;
  segundos?: number;
  encender?: boolean;
  /** no_molestar: por cuántos minutos (sin esto, hasta que se quite) */
  minutos?: number;
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
  // K4: el botón (como lo dijo, o el exacto que se aprobó), la app aprobada, el campo (qué decía, o dónde escribir), hacia dónde
  etiqueta?: string; campo?: string; direccion?: "arriba" | "abajo";
  /** whatsapp: con la accesibilidad, Hestia toca enviar (ya aprobado con el texto exacto) */
  enviar?: boolean;
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
