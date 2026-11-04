// ============================================================
// Eris — SupplementBridge (2026-10-23, fase I5)
//
// «Mis suplementos» vive en el TELÉFONO. Para que Eris anote «me tomé la creatina» desde el chat, el servidor le manda la
// operación a la app ({type:"supplement_op"}), la app la aplica con el núcleo (supplementCore) y contesta con lo que de
// verdad quedó ({type:"supplement_op_result"}). Eris solo dice «anotado» cuando el teléfono lo confirmó. Igual que InventoryBridge.
// ============================================================

export interface SupplementResult {
  ok: boolean;
  /** no_encontrado | vacio | nada_que_deshacer | timeout | sin_conexion | error */
  code?: string;
  msg?: string;
  opciones?: string[];
  id?: string;
}

const TIMEOUT_MS = 15_000;
const pending = new Map<string, { ws: any; resolve: (r: SupplementResult) => void; timer: ReturnType<typeof setTimeout> }>();

/** ¿Esta conexión es una app que sabe aplicar operaciones de Suplementos? (la anuncia con caps: ["supplement_ops"]) */
export function canSupplement(ws: any): boolean {
  return !!(ws?.data as any)?.canSupplement;
}

export function requestSupplementOp(ws: any, op: Record<string, unknown>, timeoutMs = TIMEOUT_MS): Promise<SupplementResult> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, code: "timeout", msg: "Suplementos no respondió a tiempo en el teléfono." });
    }, timeoutMs);
    pending.set(requestId, { ws, resolve, timer });
    try {
      ws.send(JSON.stringify({ type: "supplement_op", requestId, op }));
    } catch {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve({ ok: false, code: "sin_conexion", msg: "Se cortó la conexión con el teléfono." });
    }
  });
}

/** Respuesta del teléfono. Solo vale si llega por la MISMA conexión que recibió el pedido. */
export function resolveSupplementOp(ws: any, data: any): boolean {
  const id = String(data?.requestId ?? "");
  const p = pending.get(id);
  if (!p || p.ws !== ws) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  const r = data?.result;
  p.resolve(r && typeof r === "object" && typeof r.ok === "boolean" ? r : { ok: false, code: "error", msg: "El teléfono mandó una respuesta que no entendí." });
  return true;
}
