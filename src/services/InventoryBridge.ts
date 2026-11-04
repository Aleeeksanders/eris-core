// ============================================================
// Eris — InventoryBridge (2026-10-22, fase I2)
//
// Inventario vive en el TELÉFONO. Para que Eris anote «compré 2 L de leche» desde el chat, el servidor le manda la
// operación a la app ({type:"inventory_op"}), la app la aplica con el núcleo (inventoryCore) y contesta con lo que de
// verdad quedó ({type:"inventory_op_result"}). Eris solo dice «anotado» cuando el teléfono lo confirmó. Igual que
// FinanceBridge.
// ============================================================

export interface InventoryResult {
  ok: boolean;
  /** no_encontrado | ambiguo | falta_area | falta_cantidad | sin_stock | nada_que_deshacer | invalido | timeout | sin_conexion | error */
  code?: string;
  msg?: string;
  opciones?: string[];
  data?: any;
}

const TIMEOUT_MS = 15_000;
const pending = new Map<string, { ws: any; resolve: (r: InventoryResult) => void; timer: ReturnType<typeof setTimeout> }>();

/** ¿Esta conexión es una app que sabe aplicar operaciones de Inventario? (la anuncia con caps: ["inventory_ops"]) */
export function canInventory(ws: any): boolean {
  return !!(ws?.data as any)?.canInventory;
}

export function requestInventoryOp(ws: any, op: Record<string, unknown>, timeoutMs = TIMEOUT_MS): Promise<InventoryResult> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, code: "timeout", msg: "Inventario no respondió a tiempo en el teléfono." });
    }, timeoutMs);
    pending.set(requestId, { ws, resolve, timer });
    try {
      ws.send(JSON.stringify({ type: "inventory_op", requestId, op }));
    } catch {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve({ ok: false, code: "sin_conexion", msg: "Se cortó la conexión con el teléfono." });
    }
  });
}

/** Respuesta del teléfono. Solo vale si llega por la MISMA conexión que recibió el pedido. */
export function resolveInventoryOp(ws: any, data: any): boolean {
  const id = String(data?.requestId ?? "");
  const p = pending.get(id);
  if (!p || p.ws !== ws) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  const r = data?.result;
  p.resolve(r && typeof r === "object" && typeof r.ok === "boolean" ? r : { ok: false, code: "error", msg: "El teléfono mandó una respuesta que no entendí." });
  return true;
}
