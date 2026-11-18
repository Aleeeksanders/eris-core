// ============================================================
// Hestia como JARVIS · C1 (L1, 2026-11-17): la puerta, de punta a punta, contra el servidor del banco (HOME aislado, puerto 3100).
// Una cuenta de Eris («ana») manda los sensores de un teléfono que vuelve a casa y pide el panel de Hestia: no le llega NADA
// (ni hestia_decir, ni hestia_aviso, ni admin_hestia_estado), y a Ikaros tampoco le llega nada por culpa de ella.
//   USERPROFILE/HOME = el HOME del banco · bun scripts/chat_eval/hestia_puerta_e2e.ts
// ============================================================
import * as os from "os";
import { readFile } from "fs/promises";
if (!/erishome/i.test(os.homedir())) { console.log("Usa USERPROFILE temporal (erishome)"); process.exit(2); }
const PORT = Number(process.env.ERIS_EVAL_PORT) || 3100;
const tokens = JSON.parse(await readFile(`${os.homedir()}/tokens.json`, "utf8"));

async function conectar(perfil: "ikaros" | "ana") {
  const recibidos: any[] = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?profile=${perfil}`);
  let listo = false;
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    recibidos.push(m);
    if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth_session", token: tokens[perfil], caps: ["approvals", "telefono_ops"] }));
    if (m.type === "connected") listo = true;
  };
  for (let i = 0; i < 100 && !listo; i++) await new Promise((r) => setTimeout(r, 100));
  if (!listo) { console.log(`❌ ${perfil} no conectó`); process.exit(1); }
  return { ws, recibidos };
}

const ikaros = await conectar("ikaros");
const ana = await conectar("ana");
const antes = ikaros.recibidos.length;
// ana: «salgo» y «vuelvo» con audífonos, y pide el panel de Hestia (y cambiar lo que dice en voz alta)
for (const enCasa of [false, true]) { ana.ws.send(JSON.stringify({ type: "hestia_sensor", sensores: { audifonos: true, enCasa, t: Date.now() } })); await new Promise((r) => setTimeout(r, 400)); }
ana.ws.send(JSON.stringify({ type: "admin_hestia_estado" }));
ana.ws.send(JSON.stringify({ type: "admin_hestia_hablar", hablar: { bienvenida: false } }));
// L2: una llamada que entra, un mensaje y un cargo raro desde la cuenta de Eris; y cambiar los importantes
for (const evento of [
  { tipo: "llamada", estado: "sonando", de: "Mamá", conocido: true, app: "Teléfono", clave: "ana1" },
  { tipo: "mensaje", de: "Pedro", chat: "Pedro", grupo: false, app: "WhatsApp" },
  { tipo: "cargo", id: "ana|c1", txId: 1, monto: 89990, comercio: "Falabella", razon: "un comercio nuevo" },
]) { ana.ws.send(JSON.stringify({ type: "hestia_evento", evento: { ...evento, t: Date.now() } })); await new Promise((r) => setTimeout(r, 300)); }
ana.ws.send(JSON.stringify({ type: "admin_hestia_importantes", importantes: ["Intruso"] }));
await new Promise((r) => setTimeout(r, 8000));

const HESTIA = /^(hestia_|admin_hestia)/;
const aAna = ana.recibidos.filter((m) => HESTIA.test(String(m.type)));
const aIkaros = ikaros.recibidos.slice(antes).filter((m) => HESTIA.test(String(m.type)));
const fallas: string[] = [];
if (aAna.length) fallas.push(`a «ana» le llegó: ${aAna.map((m) => m.type).join(", ")}`);
if (aIkaros.length) fallas.push(`a Ikaros le llegó por culpa de ana: ${aIkaros.map((m) => m.type).join(", ")}`);
// y lo que intentó cambiar no cambió: Ikaros pide el panel y la bienvenida sigue en voz alta
ikaros.ws.send(JSON.stringify({ type: "admin_hestia_estado" }));
await new Promise((r) => setTimeout(r, 2500));
const est = ikaros.recibidos.filter((m) => m.type === "admin_hestia_estado").at(-1);
if (est && est.estado?.hablar?.bienvenida === false) fallas.push("ana apagó la bienvenida de Hestia");
if (est && (est.estado?.importantes ?? []).includes("Intruso")) fallas.push("ana cambió los contactos importantes de Hestia");
console.log(fallas.length ? `❌ puerta: ${fallas.join(" | ")}` : `✅ puerta: a una cuenta de Eris no le llegó nada de Hestia${est ? " (y el panel de Ikaros sigue igual)" : " (el panel pide el inicio con Google: sin respuesta en el banco)"}`);
process.exit(fallas.length ? 1 : 0);
