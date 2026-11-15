// ============================================================
// Prueba de punta a punta de la medición de la beta (2026-11-11), contra el servidor de pruebas
//
//   HOME=…/erishome_v1 bun scripts/chat_eval/setup.ts        (perfil y tokens de prueba)
//   HOME=…/erishome_v1 ERIS_PORT=3100 bun src/server.ts       (en otra terminal)
//   HOME=…/erishome_v1 bun scripts/beta/beta_e2e.ts
//
// Simula lo que hace el teléfono (agua, una comida, buscar un alimento, un mensaje al chat) y revisa que el servidor lo
// cuente en ~/.eris/metricas sin guardar el perfil ni el contenido, que el informe llegue al panel y que apagar
// «Ayudar a mejorar Eris» borre lo contado. Funciona con o sin el modelo encendido (con el modelo, mide su trabajo).
// ============================================================

import { readFile, readdir } from "fs/promises";
import * as os from "os";
import { join } from "path";

const PORT = Number(process.env.ERIS_EVAL_PORT) || 3100;
const tokens = JSON.parse(await readFile(join(os.homedir(), "tokens.json"), "utf8"));
const dir = join(os.homedir(), ".eris", "metricas");
const events: any[] = [];
const ws = new WebSocket(`ws://localhost:${PORT}/ws?profile=ikaros`);
let conectado: any = null;
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  events.push(m);
  if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth_session", token: tokens.ikaros, caps: [] }));
  if (m.type === "connected") conectado = m;
};
for (let i = 0; i < 200 && !conectado; i++) await Bun.sleep(100);
if (!conectado) { console.log("❌ no conectó"); process.exit(1); }

const esperar = async (tipo: string, msg: any, ms = 60_000) => {
  events.length = 0;
  ws.send(JSON.stringify(msg));
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const e = events.find((x) => x.type === tipo); if (e) return e; await Bun.sleep(50); }
  return null;
};
let fallas = 0;
const ok = (cond: boolean, que: string) => { console.log(`${cond ? "✅" : "❌"} ${que}`); if (!cond) fallas++; };

ok(conectado.usoMedido === true, "al conectar, el servidor dice que la medición está encendida");

// Lo que haría el teléfono
await esperar("water_quick_logged", { type: "log_water_quick", ml: 250 });
// La lista del teléfono es { date, items } (NutritionScreen → update_health_snapshot); `date` en el formato del registro
// de comidas («Wed Nov 11 2026»)
const ahora = new Date(), hoyLocal = ahora.toDateString();
await esperar("health_snapshot_received", { type: "update_health_snapshot", snapshot: { hydration: 1.25, foodLog: { date: hoyLocal, items: [
  { t: ahora.toISOString(), meal: "Desayuno", name: "Marraqueta", grams: 100, kcal: 270 },
  { t: ahora.toISOString(), meal: "Desayuno", name: "Palta", grams: 50, kcal: 80 },
] } } });
await esperar("food_search_result", { type: "food_search", query: "manzana", requestId: "b1" }, 8000);
const resp = await esperar("stream_end", { type: "message", content: "anota 300 ml de agua", mode: "flash" }, 120_000)
  ?? events.find((e) => e.type === "error");
ok(!!resp, `el chat respondió (${resp?.type === "error" ? `«${String(resp.message).slice(0, 60)}»` : "ok"})`);

// El informe del panel (fuerza el guardado)
const inf = (await esperar("admin_beta_report", { type: "admin_beta_report" }))?.informe;
ok(!!inf, "el panel recibe el informe");
ok(inf && inf.equipo >= 1, "la cuenta del fundador (ikaros) cuenta como equipo, no como persona de la beta");

// Lo guardado: alias, sin el perfil ni el contenido
const archivos = (await readdir(dir)).filter((f) => f.endsWith(".json"));
const texto = (await Promise.all(archivos.map((f) => readFile(join(dir, f), "utf-8")))).join("\n");
ok(archivos.includes("perfiles.json") && archivos.some((f) => f.startsWith("uso-")), `archivos de la medición: ${archivos.join(", ")}`);
ok(!/ikaros"?\s*:/.test(texto.replace(/"rol":"ikaros"/g, "")) && !texto.includes("Marraqueta") && !texto.includes("manzana") && !texto.includes("anota 300"), "sin el id del perfil ni lo que se escribió o comió");
const uso = JSON.parse(await readFile(join(dir, archivos.find((f) => f.startsWith("uso-"))!), "utf-8"));
const hoy = Object.values(uso).map((fila: any) => fila[Object.keys(fila).sort().pop()!]).find((d: any) => d?.acciones > 0) as any;
ok(!!hoy && hoy.acciones >= 3, `acciones contadas: ${hoy?.acciones}`);
ok(!!hoy && hoy.reg?.comidas >= 2 && hoy.reg?.aguaMl >= 1250, `registros: ${JSON.stringify(hoy?.reg)}`);
ok(!!hoy && (hoy.mensajes >= 1 || resp?.type === "error"), `mensajes al chat: ${hoy?.mensajes} (por el modelo: ${hoy?.porModelo}; modelo ${Math.round((hoy?.modelo?.chat ?? 0) / 1000)} s)`);

// Apagar «Ayudar a mejorar Eris» borra lo contado; encender vuelve a contar
await esperar("preference_saved", { type: "save_preference", key: "metricas_uso", value: false });
await esperar("admin_beta_report", { type: "admin_beta_report" });
const despues = JSON.parse(await readFile(join(dir, archivos.find((f) => f.startsWith("uso-"))!), "utf-8"));
const perfiles = JSON.parse(await readFile(join(dir, "perfiles.json"), "utf-8"));
const aliasFuera = Object.entries(perfiles).find(([, p]: any) => p.fuera)?.[0];
ok(!!aliasFuera && !despues[aliasFuera], "apagado: sus días se borraron y queda marcado como fuera");
await esperar("preference_saved", { type: "save_preference", key: "metricas_uso", value: true });

ws.close();
console.log(fallas ? `\n${fallas} falla(s)` : "\nTodo en orden");
process.exit(fallas ? 1 : 0);
