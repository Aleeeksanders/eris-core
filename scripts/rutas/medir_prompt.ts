// De qué está hecho lo que se manda al modelo (revisión del contexto, 2026-11-05): instrucciones, resumen del día,
// historial, el mensaje y las definiciones de herramientas, en caracteres. Sin modelo (uno falso que solo mide).
//   bun scripts/rutas/medir_prompt.ts
import * as os from "os";
import { join } from "path";
import { mkdirSync } from "fs";
const HOME = join(os.tmpdir(), "eris_rutas_home");
mkdirSync(HOME, { recursive: true });
process.env.USERPROFILE = HOME; process.env.HOME = HOME; process.env.TZ = "America/Santiago";
console.log = ((orig) => (...a: any[]) => { if (!/^\[(Router|Seguridad)\]/.test(String(a[0]))) orig(...a); })(console.log);
// Como en el PC de Eris (RTX 3050 de 6 GB): el tope por memoria de video deja el contexto en 8192 (o pasa --sin-tope)
if (!process.argv.includes("--sin-tope")) (await import("../../src/services/llm/ContextPlanner.ts")).plannerFor("qwen3.5:4b", 30 * 60_000).markOffloaded(10240);

const { QueryEngine } = await import("../../src/QueryEngine.ts");
const { ToolRegistry } = await import("../../src/tools.ts");
const { createMessage } = await import("../../src/types/message.ts");
const { routeTools } = await import("../../src/services/ToolRouter.ts");
const { UnifiedFoodService } = await import("../../src/services/gluco/UnifiedFoodService.ts");
const { memoria } = await import("./arnes.ts");
const { loadSystemPrompt } = await import("../../src/context.ts");
const food = new UnifiedFoodService("");
// El mismo prompt del modo Eris que arma el servidor (data/system-prompt.md + el perfil)
const SYS = await loadSystemPrompt(join(import.meta.dir, "..", "..", "data", "system-prompt.md"), "Perfil: Alex, 30 años, diabetes tipo 2.", "eris");

const hist = (n: number) => Array.from({ length: n }, (_, i) => [
  createMessage("user", `Mensaje ${i}: hoy almorcé arroz con pollo y una ensalada, ¿cómo voy con la proteína y el agua?`),
  createMessage("assistant", `Vas bien: llevas 82 de 136 g de proteína y 1,4 L de agua de 2,8 L. Para la once, un yogur griego y un pan con huevo te dejan en ritmo. ${"Detalle ".repeat(30)}`),
]).flat();

for (const [msg, n] of [["Voy a hacer la cena", 0], ["Voy a hacer la cena", 8], ["¿Qué me conviene comer antes de entrenar?", 6], ["Cuéntame cómo voy con todo hoy", 10]] as const) {
  let medida: any = null;
  const model = { async generate(m: any[], defs: any[]) {
    const sys0 = m[0]?.content?.length ?? 0;
    const otrosSys = m.slice(1).filter((x) => x.role === "system").reduce((a, x) => a + x.content.length, 0);
    const conv = m.filter((x) => x.role !== "system").reduce((a, x) => a + x.content.length + (x.toolCalls ? JSON.stringify(x.toolCalls).length : 0), 0);
    const tools = defs?.length ? JSON.stringify(defs).length : 0;
    medida = { sys0, otrosSys, conv, tools, total: sys0 + otrosSys + conv + tools, nTools: defs?.length ?? 0 };
    return { content: "ok", toolCalls: [] };
  } } as any;
  const eng = new QueryEngine(model, new ToolRegistry(), SYS, { router: routeTools });
  const h = [...hist(n), createMessage("user", msg)];
  await eng.query(msg, h, {} as any, null, "flash", { memory: memoria(), role: "ikaros", foodService: food, axsMode: false } as any, msg);
  const t = (c: number, r: number) => Math.round(c / r);
  console.log(`«${msg}» con ${n} turnos previos → ${medida ? `instrucciones ${medida.sys0} · otros de sistema ${medida.otrosSys} · conversación ${medida.conv} · herramientas ${medida.tools} (${medida.nTools}) = ${medida.total} car ≈ ${t(medida.total, 3.6)}–${t(medida.total, 3.0)} tokens` : "no fue al modelo (atajo)"}`);
}
process.exit(0);
