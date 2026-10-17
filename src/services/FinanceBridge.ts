// ============================================================
// Eris — FinanceBridge
//
// Finanzas (hunter-wallet.html) guarda todo en el TELÉFONO, dentro de su WebView. Para que Eris anote un gasto desde el
// chat, el servidor le manda la operación a la app ({type:"finance_op"}), la app la aplica en Finanzas —abierta o, si
// no, en segundo plano— y contesta con el resultado real ({type:"finance_op_result"}). Así Eris solo dice "anotado"
// cuando el teléfono confirmó que quedó anotado, con los saldos de verdad.
// ============================================================

import type { FinanceOp } from "./FinanceParse.js";

export interface FinanceAccountView { nombre: string; tipo: "efectivo" | "debito" | "credito"; saldo: number; cupo?: number }
export interface FinanceResult {
  ok: boolean;
  /** por qué no se pudo: sin_fondos | cuenta_no_encontrada | cuenta_ambigua | falta_cuenta | sin_prestamo | prestamo_ambiguo |
   *  sin_deuda | nada_que_deshacer | invalido | timeout | sin_conexion | error */
  code?: string;
  msg?: string;
  /** qué elegir cuando falta un dato (cuentas, préstamos) */
  opciones?: string[];
  data?: any;
}

const TIMEOUT_MS = 15_000;
const pending = new Map<string, { ws: any; resolve: (r: FinanceResult) => void; timer: ReturnType<typeof setTimeout> }>();

/** ¿Esta conexión es una app que sabe aplicar operaciones de Finanzas? (la anuncia con caps: ["finance_ops"]) */
export function canFinance(ws: any): boolean {
  return !!(ws?.data as any)?.canFinance;
}

export function requestFinanceOp(ws: any, op: FinanceOp, timeoutMs = TIMEOUT_MS): Promise<FinanceResult> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, code: "timeout", msg: "Finanzas no respondió a tiempo en el teléfono." });
    }, timeoutMs);
    pending.set(requestId, { ws, resolve, timer });
    try {
      ws.send(JSON.stringify({ type: "finance_op", requestId, op }));
    } catch {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve({ ok: false, code: "sin_conexion", msg: "Se cortó la conexión con el teléfono." });
    }
  });
}

/** Respuesta del teléfono. Solo vale si llega por la MISMA conexión que recibió el pedido. */
export function resolveFinanceOp(ws: any, data: any): boolean {
  const id = String(data?.requestId ?? "");
  const p = pending.get(id);
  if (!p || p.ws !== ws) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  const r = data?.result;
  p.resolve(r && typeof r === "object" && typeof r.ok === "boolean" ? r : { ok: false, code: "error", msg: "El teléfono mandó una respuesta que no entendí." });
  return true;
}
