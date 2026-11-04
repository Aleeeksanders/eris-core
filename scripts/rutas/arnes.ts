// ============================================================
// Arnés de enrutamiento (revisión exhaustiva, 2026-11-04): ¿qué herramienta se queda con cada frase?
// Todas las herramientas reales, en su orden, con una memoria falsa (nada toca disco) y un modelo falso que anota qué
// herramientas le ofrecieron. Sin Ollama: corre en segundos. Lo usa scripts/rutas/rutas_check.ts.
// ============================================================
import { QueryEngine } from "../../src/QueryEngine.ts";
import { ToolRegistry } from "../../src/tools.ts";
import { createMessage } from "../../src/types/message.ts";
import { routeTools } from "../../src/services/ToolRouter.ts";
import { UnifiedFoodService } from "../../src/services/gluco/UnifiedFoodService.ts";

export const food = new UnifiedFoodService("");

/** Memoria en RAM con lo que se le siembre (claves como las de memory.ts: «pref_auto_prefs», «day_plan_pending»…) */
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
  const eng = new QueryEngine(model, new ToolRegistry(), "SYS", { router: routeTools });
  const corrio: string[] = [];
  const hist = (opts.hist ?? []).map(([r, t]) => createMessage(r, t));
  hist.push(createMessage("user", msg));
  const res: any = await eng.query(msg, hist, { onToolCall: (tc: any) => corrio.push(tc.name) } as any, null, "flash",
    { memory: opts.mem ?? memoria(), role: opts.role ?? "ikaros", foodService: food, axsMode: opts.axs ?? false } as any, msg);
  const texto = String(res?.message?.content ?? "");
  if (corrio[0]) return { tool: corrio[0], via: "atajo", ofrecidas, texto };
  return { tool: modelo ? "modelo" : "nada", via: modelo ? "modelo" : "nada", ofrecidas, texto };
}
