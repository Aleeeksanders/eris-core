// ============================================================
// Eris — ForgeBridge (Hestia como JARVIS · L3, 2026-11-17)
//
// Forge vive en el TELÉFONO (forgeStore). Para que Hestia sea el entrenador en el oído, el servidor le pide a la app lo que
// necesita ({type:"forge_op"}): qué serie sigue, anotar «hice 8 con 62,5», cortar o alargar el descanso, borrar la última,
// terminar. La app lo aplica con el mismo núcleo de Entrenar (services/forge/forgeVoz.ts) y contesta lo que de verdad quedó
// ({type:"forge_op_result"}). Igual que FinanceBridge: Hestia solo dice «anotada» cuando el teléfono lo confirmó.
// ============================================================

export type ForgeOp =
  | { accion: "sesion" }
  | { accion: "serie"; reps: number; kg?: number | null; rir?: number | null; neg?: number | null; ejercicio?: string | null }
  | { accion: "descanso"; que: "cortar" | "mas" | "menos" | "estado"; segundos?: number }
  | { accion: "borrar_ultima" }
  | { accion: "terminar" };

export interface ForgeResult { ok: boolean; code?: string; msg?: string; data?: any }

const TIMEOUT_MS = 8_000;
const pending = new Map<string, { ws: any; resolve: (r: ForgeResult) => void; timer: ReturnType<typeof setTimeout> }>();

/** ¿Esta conexión es una app que sabe aplicar operaciones de Forge? (la anuncia con caps: ["forge_ops"]) */
export function canForge(ws: any): boolean {
  return !!(ws?.data as any)?.canForge;
}

export function requestForgeOp(ws: any, op: ForgeOp, timeoutMs = TIMEOUT_MS): Promise<ForgeResult> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, code: "timeout", msg: "Forge no respondió a tiempo en el teléfono." });
    }, timeoutMs);
    pending.set(requestId, { ws, resolve, timer });
    try {
      ws.send(JSON.stringify({ type: "forge_op", requestId, op }));
    } catch {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve({ ok: false, code: "sin_conexion", msg: "Se cortó la conexión con el teléfono." });
    }
  });
}

/** Respuesta del teléfono. Solo vale si llega por la MISMA conexión que recibió el pedido. */
export function resolveForgeOp(ws: any, data: any): boolean {
  const id = String(data?.requestId ?? "");
  const p = pending.get(id);
  if (!p || p.ws !== ws) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  const r = data?.result;
  p.resolve(r && typeof r === "object" && typeof r.ok === "boolean" ? r : { ok: false, code: "error", msg: "El teléfono mandó una respuesta que no entendí." });
  return true;
}
