// ============================================================
// Eris — InventoryTrackerTool (inventory_tracker) · 2026-10-22, fase I2
//
// Lleva el Inventario de la casa por chat: lo que compró, usó, se acabó o se botó; lo que tiene («¿tengo arroz?»,
// «¿qué tengo en la despensa?»), lo que se vence y la lista de compras. Las frases claras se reconocen por código
// (InventoryParse → preroute) y se responden sin pasar por el modelo. Lo que cambia algo lo aplica el TELÉFONO (donde
// vive el Inventario) y vuelve lo que de verdad quedó (InventoryBridge). Las consultas, sin el teléfono conectado, se
// responden con el último respaldo del PC (avisando de cuándo es).
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { parseInventoryMessage, itemsDe, areaDe, type InventoryOp } from "../services/InventoryParse.js";
import { canInventory, requestInventoryOp, type InventoryResult } from "../services/InventoryBridge.js";
import { formatInventoryReply, inventoryToolOutput } from "../services/InventoryReply.js";
import { lastInventoryState } from "../services/InventoryBackup.js";
import { applyOp, fold, parseCantidad, areaPara, encontrar, AREAS, OP_ACTIONS, UNIDADES } from "../services/InventoryCore.js";
import { intentsIn } from "../services/Intent.js";

const InventorySchema = z.object({
  action: z.enum(OP_ACTIONS).describe(
    "compra = compró o trajo algo a la casa; consumo = usó una parte (NO comer: eso es nutrition_tracker); se_acabo = se le terminó algo; " +
    "quedan = contó cuánto le queda; botar = lo botó (vencido o malo); consultar = '¿tengo X?', '¿cuánto X me queda?'; en_area = '¿qué tengo en la despensa?'; " +
    "lista = la lista de compras / qué le falta; agregar_lista = anotar algo para comprar; por_vencer = qué se vence; resumen = su inventario; deshacer = borrar lo último anotado por chat."),
  producto: z.string().optional().describe("Qué cosa, como la nombró: 'leche', 'shampoo', 'arroz'."),
  cantidad: z.number().nonnegative().optional().describe("Cuánto (en la unidad de abajo). Omítelo si no lo dijo."),
  unidad: z.enum(UNIDADES as unknown as [string, ...string[]]).optional().describe("u (unidades), paquete, g, kg, ml o L."),
  area: z.enum(AREAS.map((a) => a.id) as unknown as [string, ...string[]]).optional().describe("alimentos (frescos/refrigerados), despensa, bano, limpieza, botiquin, ropa, objetos, mascotas."),
  items: z.array(z.object({ producto: z.string(), cantidad: z.number().optional(), unidad: z.string().optional() })).optional().describe("Varias cosas a la vez (compró leche, pan y huevos)."),
  motivo: z.string().optional().describe("botar: vencido o malo."),
  dias: z.number().int().positive().optional().describe("por_vencer: cuántos días hacia adelante (7 por defecto)."),
});
type InventoryInput = z.infer<typeof InventorySchema>;

const PENDING_KEY = "inventory_pending";
const PENDING_MINUTES = 10;
const WRITES = new Set(["compra", "consumo", "se_acabo", "quedan", "botar", "agregar_lista", "deshacer"]);
const READS = new Set(["consultar", "en_area", "lista", "por_vencer", "resumen"]);
const hhmm = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : `${d.getDate()}-${d.getMonth() + 1} a las ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };

/**
 * «¿Tengo X?» es del Inventario solo si X es una cosa de la casa: algo que ya tiene anotado, algo que se reconoce por su
 * nombre (shampoo, arroz, pilas) o un alimento de las bases, o si el mensaje nombra el inventario. Si no, decide el modelo
 * (revisión 2026-11-04, C1: «¿tengo fuerza?» respondía «no tienes fuerza en tu inventario»).
 */
async function esDeLaCasa(producto: string, message: string, memory: any, foodService: any): Promise<boolean> {
  if (/\b(inventario|despensa|stock|refri\w*|alacena|botiquin|bano|en (la )?casa)\b/.test(fold(message))) return true;
  if (areaPara(producto)) return true;
  const last = memory ? await lastInventoryState(memory).catch(() => null) : null;
  if (last) { const e = encontrar(last.state, producto); if (e.item || e.empatados?.length) return true; }
  const w = fold(producto).split(" ")[0] ?? "";
  if (w.length >= 3 && foodService?.searchLocal) {
    try {
      const hits: Array<{ name: string; aliases?: string[] }> = foodService.searchLocal(producto, 5) ?? [];
      const raiz = w.replace(/(es|s)$/, "");
      if (hits.some((h) => [h.name, ...(h.aliases ?? [])].some((n) => fold(n).split(/[^a-zñ]+/).some((x) => x.startsWith(raiz))))) return true;
    } catch { /* sin la base: no se adivina */ }
  }
  return false;
}

/** ¿El mensaje pide SOLO esto? (si mezcla otra cosa, responde el modelo con todas las herramientas) */
function pureInventory(message: unknown): boolean {
  if (typeof message !== "string" || !message.trim() || message.length > 220) return false;
  for (const i of intentsIn(message)) if (!["inventory", "finance", "food", "water", "advisor", "supplement"].includes(i)) return false;
  return !/\b(me comi|comi|almorce|desayune|cene|me tome|tome)\b/.test(fold(message));
}

export class InventoryTrackerTool extends Tool<InventoryInput> {
  readonly name = "inventory_tracker";
  readonly description =
    "El Inventario de la casa del usuario (vive en su teléfono): lo que compró, usó, se le acabó o botó; lo que tiene ('¿tengo arroz?', " +
    "'¿qué tengo en la despensa?'), lo que se vence y la lista de compras. USAR cuando hable de lo que tiene en casa, de compras para reponer o de " +
    "lo que se acabó. NO para comidas (nutrition_tracker) ni para plata (finance_tracker). Nunca digas que anotaste algo sin esta herramienta; " +
    "usa solo las cantidades que devuelve.";
  readonly inputSchema = InventorySchema;

  async preroute(userMessage: string, context?: any): Promise<Record<string, unknown> | null> {
    const memory = context?.memory;
    const text = (userMessage || "").trim();
    if (!text) return null;
    // Continuación: Eris preguntó «¿en qué área?», «¿cuál?» o «¿cuánto?» y el usuario responde corto
    if (memory) {
      const p: any = await memory.get(PENDING_KEY).catch(() => null);
      if (p && Date.now() - new Date(p.at).getTime() < PENDING_MINUTES * 60000 && text.length <= 50 && !/[?¿]/.test(text)) {
        const t = fold(text);
        if (/^(no|nada|cancela\w*|olvidalo|deja\w*)\b/.test(t)) { await memory.set(PENDING_KEY, null).catch(() => {}); return null; }
        if (p.field === "area") { const a = areaDe(t); if (a) { await memory.set(PENDING_KEY, null).catch(() => {}); return { ...p.op, area: a }; } }
        if (p.field === "producto") {
          const hit = (p.opciones ?? []).find((o: string) => fold(o) === t || fold(o).includes(t));
          if (hit) { await memory.set(PENDING_KEY, null).catch(() => {}); return { ...p.op, producto: hit }; }
        }
        if (p.field === "cantidad") {
          const c = parseCantidad(t);
          if (c) { await memory.set(PENDING_KEY, null).catch(() => {}); return { ...p.op, cantidad: c.cant, unidad: c.unidad }; }
        }
      }
    }
    const op = parseInventoryMessage(text);
    if (op?.action === "consultar" && op.producto && !(await esDeLaCasa(op.producto, text, memory, context?.foodService))) return null;
    return op ? { ...op } : null;
  }

  async execute(input: InventoryInput, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    const ws = context?.wsClient;
    const quick = pureInventory(context?.userMessage);
    const op: InventoryOp = { ...(input as any) };
    // Lo que el modelo mande como items sueltos sin cantidad: igual que el código
    if (op.items) op.items = op.items.map((x: any) => (x.cantidad == null && x.producto ? itemsDe(x.producto)[0] ?? x : x));
    const ops: Array<Record<string, unknown>> = op.items?.length
      ? op.items.map((x) => ({ action: op.action, ...x, ...(op.area ? { area: op.area } : {}), ...(op.motivo ? { motivo: op.motivo } : {}) }))
      : [{ ...op }];

    let results: InventoryResult[];
    let respaldo: string | undefined;
    if (ws && canInventory(ws)) {
      results = [];
      for (const o of ops) results.push(await requestInventoryOp(ws, o));
    } else if (READS.has(op.action) && memory) {
      // Sin el teléfono: las consultas, con el último respaldo del PC (no se escribe nada)
      const last = await lastInventoryState(memory).catch(() => null);
      if (!last) {
        const reply = "Tu Inventario vive en el teléfono y todavía no tengo un respaldo en el PC: ábrelo una vez en la app (con conexión) y te respondo.";
        return { output: `SIN DATOS de Inventario. ${reply}`, metadata: { quickReply: quick ? reply : undefined } };
      }
      let S = last.state, id = -1;
      results = ops.map((o) => { const r = applyOp(S, o, { now: new Date(), newId: () => id-- }); S = r.state; return r.result; });
      respaldo = hhmm(last.at);
    } else {
      const reply = "Eso lo anoto en tu Inventario, que vive en tu teléfono: pídemelo desde la app de Eris (actualizada) y queda al tiro.";
      return { output: `NO se anotó: esta conexión no es la app del teléfono.\n${reply}`, metadata: { quickReply: quick ? reply : undefined, inventoryOk: false } };
    }

    const reply = formatInventoryReply(op, results, { respaldo });
    // Si falta un dato (área, cuál de varios, cuánto), la próxima respuesta corta completa esta misma operación
    const r0 = results[0];
    if (memory && ops.length === 1) {
      const field = !r0?.ok && (r0?.data?.campo || (r0?.code === "falta_cantidad" ? "cantidad" : null));
      if (field) await memory.set(PENDING_KEY, { op: ops[0], field, opciones: r0.opciones ?? [], at: new Date().toISOString() }).catch(() => {});
      else if (r0?.ok) await memory.set(PENDING_KEY, null).catch(() => {});
    }
    // «No tengo X en tu inventario» por una frase que quizás no era de inventario («usé la bici»): que conteste el modelo
    const dudoso = results.length === 1 && r0?.code === "no_encontrado" && WRITES.has(op.action) && !/\b(inventario|despensa|stock|refri|botiquin)\b/.test(fold(context?.userMessage ?? ""));
    return {
      output: inventoryToolOutput(op, results, reply),
      metadata: { quickReply: quick && !dudoso ? reply : undefined, inventoryOk: results.some((r) => r.ok) },
    };
  }
}
