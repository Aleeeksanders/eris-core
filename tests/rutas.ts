// Arnés de enrutamiento (revisión V1): ¿qué herramienta se queda con cada frase? Todas las herramientas reales, en su orden,
// con una memoria falsa (nada toca disco) y un modelo falso que anota qué herramientas le ofrecieron.
process.env.TZ = "America/Santiago";
import { QueryEngine } from "C:/Proyectos/eris/src/QueryEngine.ts";
import { ToolRegistry } from "C:/Proyectos/eris/src/tools.ts";
import { createMessage } from "C:/Proyectos/eris/src/types/message.ts";
import { routeTools } from "C:/Proyectos/eris/src/services/ToolRouter.ts";
import { UnifiedFoodService } from "C:/Proyectos/eris/src/services/gluco/UnifiedFoodService.ts";
import * as INV from "C:/Proyectos/eris/src/services/InventoryCore.ts";

export const food = new UnifiedFoodService("");

export function inventarioEjemplo() {
  let id = 1;
  const ctx = { now: new Date(), newId: () => id++ };
  const S = INV.draft(INV.emptyState());
  INV.agregar(S, { nombre: "Arroz", cantidad: 2, unidad: "kg" }, ctx);
  INV.agregar(S, { nombre: "Shampoo", cantidad: 1 }, ctx);
  INV.agregar(S, { nombre: "Leche", cantidad: 2, unidad: "L" }, ctx);
  return S;
}

export function memoria(seed: Record<string, any> = {}) {
  const m = new Map<string, any>(Object.entries(seed));
  return {
    _m: m,
    get: async (k: string) => (m.has(k) ? m.get(k) : null),
    set: async (k: string, v: any) => { m.set(k, v); },
    getProfile: async () => ({ name: "Alex", displayName: "Alex", medical: { conditions: [] } }),
    getDailyRollupLog: async () => [],
    getConversation: () => [],
    listProjects: () => [],
  } as any;
}

export interface Ruta { tool: string; via: "atajo" | "modelo" | "nada"; ofrecidas: string[]; texto?: string }

/** hist: turnos previos [rol, texto] (el último del asistente es «lastAssistantMessage»). */
export async function quien(msg: string, opts: { hist?: Array<["user" | "assistant", string]>; mem?: any; role?: string; axs?: boolean } = {}): Promise<Ruta> {
  let ofrecidas: string[] = [];
  let modelo = 0;
  const model = { async generate(_m: any, defs: any[]) { modelo++; ofrecidas = (defs ?? []).map((d: any) => d.name); return { content: "respuesta del modelo", toolCalls: [] }; } } as any;
  const reg = new ToolRegistry();
  const eng = new QueryEngine(model, reg, "SYS", { router: routeTools });
  const corrio: string[] = [];
  const hist = (opts.hist ?? []).map(([r, t]) => createMessage(r, t));
  hist.push(createMessage("user", msg));
  const mem = opts.mem ?? memoria();
  const res: any = await eng.query(msg, hist, { onToolCall: (tc: any) => corrio.push(tc.name) } as any, null, "flash",
    { memory: mem, role: opts.role ?? "ikaros", foodService: food, axsMode: opts.axs ?? false } as any, msg);
  const pre = corrio.find((n) => n) && corrio[0];
  const texto = String(res?.message?.content ?? "");
  if (pre) return { tool: pre, via: "atajo", ofrecidas, texto };
  return { tool: modelo ? "modelo" : "nada", via: modelo ? "modelo" : "nada", ofrecidas, texto };
}
