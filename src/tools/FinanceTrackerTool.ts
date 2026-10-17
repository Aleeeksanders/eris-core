// ============================================================
// Eris — FinanceTrackerTool (finance_tracker)
//
// Anota en Finanzas (Hunter Wallet, en el teléfono) lo que el usuario cuenta por chat: gastos, préstamos, cobros,
// abonos, giros, transferencias, pagos de tarjeta y ahorro; también deshace el último registro y da el resumen de
// saldos. Las frases claras se reconocen por código (FinanceParse → preroute) y se responden sin pasar por el modelo;
// el teléfono aplica la operación y devuelve los saldos reales (FinanceBridge).
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { parseFinanceMessage, parseFinanceWhatIf, accountNamesFromContext, categoryFor, findAmounts, fold, type FinanceOp } from "../services/FinanceParse.js";
import { canFinance, requestFinanceOp } from "../services/FinanceBridge.js";
import { formatFinanceReply, financeToolOutput, formatWhatIfReply } from "../services/FinanceReply.js";
import { pullFinanceBackup } from "../services/FinanceBackup.js";
import { fromHwKeys, draft, aplicarProgramados, estado, hwResolve, simularCompra } from "../services/FinanceCore.js";
import { intentsIn } from "../services/Intent.js";

const CATS = ["vivienda", "alimentacion", "transporte", "salud", "entretenimiento", "deuda", "educacion", "hogar", "otros"] as const;
const ACTIONS = ["gasto", "prestamo", "cobro", "abono", "giro", "transferencia", "pago_tarjeta", "ahorro", "deshacer", "resumen", "simular"] as const;

const FinanceInputSchema = z.object({
  action: z.enum(ACTIONS).describe(
    "gasto = pagó/compró algo; prestamo = le prestó plata a alguien; cobro = alguien le devolvió lo prestado; abono = le entró plata a una cuenta " +
    "(sueldo, depósito); giro = sacó efectivo de una cuenta; transferencia = movió plata entre SUS cuentas; pago_tarjeta = pagó su tarjeta de crédito; " +
    "ahorro = apartó plata como ahorro; deshacer = borrar el último registro que hiciste por chat; resumen = cuánta plata tiene / cómo va el mes; " +
    "simular = '¿y si me compro X?', '¿me alcanza para…?': cómo quedaría su plata, SIN anotar nada."),
  monto: z.number().positive().optional().describe("Monto en PESOS chilenos: '5 lucas' = 5000, 'luca y media' = 1500, '1 palo' = 1000000."),
  descripcion: z.string().optional().describe("En qué fue (gasto) o para qué; corto: 'Almuerzo', 'Uber', 'Arriendo'."),
  categoria: z.enum(CATS).optional().describe("Categoría del gasto. Si no la sabes, omítela."),
  cuenta: z.string().optional().describe("Cuenta de donde SALE la plata (o a la que ENTRA en un abono), como la nombró el usuario: 'BCI', 'efectivo', 'tarjeta de crédito'. Si no la dijo, omítela."),
  hacia: z.string().optional().describe("Cuenta de destino en transferencia o la tarjeta en pago_tarjeta."),
  persona: z.string().optional().describe("A quién le prestó (prestamo) o quién le devolvió (cobro)."),
  fecha: z.string().optional().describe("YYYY-MM-DD si no fue hoy."),
  devolucion: z.string().optional().describe("YYYY-MM-DD, cuándo le devuelven un préstamo (si lo dijo)."),
  objeto: z.string().optional().describe("deshacer: qué tipo de registro borrar ('gasto', 'prestamo'…)."),
  cuotas: z.number().int().min(2).max(48).optional().describe("gasto: compra en cuotas con tarjeta de crédito (número de cuotas). Omítelo si fue al contado."),
});
type FinanceInput = z.infer<typeof FinanceInputSchema>;

/** Minutos que vale una respuesta a "¿con cuál cuenta fue?" como continuación de la operación pendiente. */
const PENDING_MINUTES = 10;
const PENDING_KEY = "finance_pending";

/**
 * ¿El mensaje pide SOLO esto? Palabras de comida o agua cuentan como descripción del gasto ("5 lucas en almuerzo"),
 * pero si además dice que comió o tomó algo, son dos pedidos y responde el modelo con ambas herramientas.
 */
function pureFinance(message: unknown): boolean {
  if (typeof message !== "string" || !message.trim() || message.length > 200) return false;
  const t = fold(message);
  if (/\b(comi|comimos|desayune|almorce|cene|me tome|tome|bebi)\b/.test(t)) return false;
  for (const i of intentsIn(message)) if (!["finance", "food", "water"].includes(i)) return false;
  return true;
}

export class FinanceTrackerTool extends Tool<FinanceInput> {
  readonly name = "finance_tracker";
  readonly description =
    "Anota en Finanzas (la app Hunter Wallet del teléfono del usuario) lo que cuenta de su plata: gastos, préstamos que hizo, cobros, " +
    "abonos/sueldo, giros de efectivo, transferencias entre sus cuentas, pagos de tarjeta y ahorro; deshace el último registro; y da el " +
    "resumen de saldos ('¿cuánta plata tengo?'). USAR SIEMPRE que el usuario diga que gastó, pagó, compró, prestó, le devolvieron, sacó plata, " +
    "le llegó plata o ahorró. NUNCA digas que anotaste algo sin haber llamado a esta herramienta, y usa solo las cifras que devuelve.";
  readonly inputSchema = FinanceInputSchema;

  async preroute(userMessage: string, context?: any): Promise<Record<string, unknown> | null> {
    const memory = context?.memory;
    const text = (userMessage || "").trim();
    if (!text) return null;

    // Continuación: Eris preguntó "¿con cuál cuenta fue?" y el usuario responde "la BCI" (o toca el chip)
    if (memory) {
      const p: any = await memory.get(PENDING_KEY).catch(() => null);
      if (p && Date.now() - new Date(p.at).getTime() < PENDING_MINUTES * 60000) {
        const t = fold(text);
        if (/^(no|nada|cancela\w*|olvidalo|deja\w*|dejalo)\b/.test(t)) { await memory.set(PENDING_KEY, null).catch(() => {}); return null; }
        const short = text.length <= 60 && !/[?¿]/.test(text) && findAmounts(t).length === 0;
        const value = text.replace(/^(con |desde |de |en |a |al |fue con |fue en |la |el |mi )+/i, "").trim();
        const v = fold(value);
        // Solo si la respuesta ES una de las opciones o nombra una cuenta ("gracias" no completa nada)
        const matches = (p.opciones ?? []).some((o: string) => { const f = fold(o); return f.includes(v) || v.includes(f.split(/\s*·\s*/)[0]); }) ||
          (p.field !== "persona" && /\b(efectivo|cash|debito|credito|tarjeta|cuenta|bci|bice|santander|scotia\w*|estado|chile|edwards|falabella|cmr|ripley|itau|tenpo|mach|mercado ?pago|coopeuch)\b/.test(v));
        if (short && p.field && v.length >= 2 && matches) {
          await memory.set(PENDING_KEY, null).catch(() => {});
          return { ...p.op, [p.field]: value };
        }
      }
    }

    const ctx = memory ? await memory.get("financial_context_latest").catch(() => null) : null;
    const accountNames = accountNamesFromContext(ctx);
    // «¿y si me compro unas zapatillas de 60 lucas?»: se simula, no se anota
    const wi = parseFinanceWhatIf(text, { accountNames });
    if (wi) return { ...wi };
    const op = parseFinanceMessage(text, { accountNames });
    return op ? { ...op } : null;
  }

  async execute(input: FinanceInput, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    const ws = context?.wsClient;
    // (una respuesta corta como "la BCI" a "¿con cuál fue?" también es pura)
    const quick = pureFinance(context?.userMessage);
    if (input.action === "simular") return this.simulate(input, memory, quick);
    const op: FinanceOp = { ...input, action: input.action };
    if (op.monto) op.monto = Math.round(op.monto);
    if (op.action === "gasto" && !op.categoria) op.categoria = (op.descripcion && categoryFor(op.descripcion)) || "otros";

    // Datos mínimos: si faltan, que el modelo los pregunte (sin respuesta rápida)
    const needsMonto = ["gasto", "prestamo", "abono", "giro", "transferencia", "ahorro"].includes(op.action);
    // "Me llegó el sueldo" sin monto: el teléfono usa el sueldo que el usuario configuró (si no lo configuró, lo pide)
    const sueldoSinMonto = op.action === "abono" && /sueldo|quincena|anticipo/i.test(op.descripcion ?? "");
    if (needsMonto && !op.monto && !sueldoSinMonto) return { output: "Falta el monto (en pesos). Pregúntale al usuario cuánto fue; NO digas que lo anotaste." };
    if ((op.action === "prestamo" || op.action === "cobro") && !op.persona) return { output: "Falta a quién (persona). Pregúntaselo; NO digas que lo anotaste." };
    if (op.action === "transferencia" && (!op.cuenta || !op.hacia)) return { output: "Falta de qué cuenta a qué cuenta. Pregúntaselo; NO digas que lo anotaste." };

    if (!ws || !canFinance(ws)) {
      const reply = "Eso lo anoto en Finanzas, que vive en tu teléfono: pídemelo desde la app de Eris (actualizada) y queda al tiro.";
      return { output: `NO se anotó: esta conexión no es la app del teléfono.\n${reply}`, metadata: { quickReply: quick ? reply : undefined, financeOk: false } };
    }

    const r = await requestFinanceOp(ws, op);
    const reply = formatFinanceReply(op, r);

    // Si falta elegir una cuenta o un préstamo, la próxima respuesta corta del usuario completa esta misma operación
    if (memory) {
      const field = !r.ok && r.data?.campo;
      if (field && r.opciones?.length) await memory.set(PENDING_KEY, { op, field, opciones: r.opciones, at: new Date().toISOString() }).catch(() => {});
      else if (r.ok) await memory.set(PENDING_KEY, null).catch(() => {});
    }

    return {
      output: financeToolOutput(op, r, reply),
      metadata: { quickReply: quick ? reply : undefined, financeOk: r.ok },
    };
  }

  /**
   * «¿Y si me compro…?»: el mismo núcleo de la app (FinanceCore) sobre el último respaldo de Finanzas que mandó el
   * teléfono, así responde aunque el teléfono no esté conectado. No escribe nada (ni en el respaldo ni en el teléfono).
   */
  private async simulate(input: FinanceInput, memory: any, quick: boolean): Promise<ToolExecutionResult> {
    const monto = Math.round(input.monto ?? 0);
    if (!(monto > 0)) return { output: "Falta el monto de lo que piensa comprar. Pregúntaselo; NO inventes cifras." };
    const dump = memory ? await pullFinanceBackup(memory).catch(() => null) : null;
    if (!dump) {
      const reply = "Para simularlo necesito tu Finanzas: abre Finanzas en la app (con conexión) una vez y te respondo con tus números.";
      return { output: `SIN DATOS de Finanzas en el PC: no hay respaldo. ${reply}`, metadata: { quickReply: quick ? reply : undefined } };
    }
    const now = new Date();
    // Lo que haría el teléfono al abrir Finanzas: los fijos cuyo día ya llegó cuentan (copia de trabajo, no se guarda)
    const S = draft(fromHwKeys(dump.keys));
    let nid = -1;
    aplicarProgramados(S, { now, newId: () => nid-- });
    if (!S.tx.length && !S.cuentas.length && !S.prog.length) {
      const reply = "Todavía no tienes Finanzas configurado: ábrelo en la app, pon tu sueldo y cuentas, y te digo cómo quedarías.";
      return { output: `Finanzas vacío. ${reply}`, metadata: { quickReply: quick ? reply : undefined } };
    }
    const categoria = input.categoria ?? (input.descripcion ? categoryFor(input.descripcion) : undefined) ?? "otros";
    const cuotas = input.cuotas && input.cuotas > 1 ? input.cuotas : undefined;
    const hint = input.cuenta ? hwResolve(estado(S), input.cuenta, cuotas ? "credito" : null) : null;
    const sim = simularCompra(S, { monto, cat: categoria, cuotas, cuenta: hint?.ref ?? null, desc: input.descripcion }, now);
    if (!sim) return { output: "No pude simularlo (monto inválido)." };
    const reply = formatWhatIfReply({ descripcion: input.descripcion, monto: sim.monto, cuotas: sim.cuotas, veredicto: sim.veredicto, hasta: sim.hasta, lineas: sim.lineas, at: dump.at }, now);
    return {
      output: `SIMULACIÓN (NO se anotó nada). Usa SOLO estas cifras:
${reply}`,
      metadata: { quickReply: quick ? reply : undefined, financeOk: true },
    };
  }
}
