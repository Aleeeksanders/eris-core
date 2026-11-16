// ============================================================
// Hestia por voz — prueba de punta a punta (J1, 2026-11-16) contra el servidor AISLADO con el modelo real.
// Llama como lo haría el teléfono: voz_inicio → voz_turno (texto, como lo deja el reconocimiento del teléfono) → mide cuánto tarda
// el primer `voz_audio` y que lleguen en orden; corta a mitad de una respuesta larga (voz_cortar) y revisa que no llegue nada más
// de ese turno; cuelga. Nunca toca los datos reales: exige un HOME aislado (erishome).
//   1) bun scripts/chat_eval/setup.ts   2) ERIS_PORT=3100 bun src/server.ts   3) bun scripts/voz/voz_e2e.ts   (con el mismo HOME)
// ============================================================
import * as os from "os";
import { readFile } from "fs/promises";
if (!/erishome/i.test(os.homedir())) { console.log("Usa USERPROFILE temporal (erishome)"); process.exit(2); }
const PORT = Number(process.env.ERIS_EVAL_PORT) || 3100;
const tokens = JSON.parse(await readFile(`${os.homedir()}/tokens.json`, "utf8"));
for (let i = 0; i < 120; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

const ws = new WebSocket(`ws://localhost:${PORT}/ws?profile=ikaros`);
const eventos: any[] = [];
const esperas: Array<{ pred: (m: any) => boolean; res: (m: any) => void }> = [];
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth_session", token: tokens.ikaros }));
  const ev = { ...m, at: Date.now(), i: eventos.length };
  eventos.push(ev);
  for (const w of [...esperas]) if (w.pred(ev)) { esperas.splice(esperas.indexOf(w), 1); w.res(ev); }
};
const esperar = (pred: (m: any) => boolean, ms = 60_000) => new Promise<any>((res, rej) => {
  const ya = eventos.find(pred); if (ya) return res(ya);
  esperas.push({ pred, res }); setTimeout(() => rej(new Error("tiempo")), ms);
});
await esperar((m) => m.type === "connected");

// No en Modo AXS: se rechaza
ws.send(JSON.stringify({ type: "voz_inicio", axs: false }));
const rech = await esperar((m) => m.type === "voz_error");
console.log("sin Modo AXS →", rech.mensaje);

ws.send(JSON.stringify({ type: "voz_inicio", axs: true }));
await esperar((m) => m.type === "voz_lista");
await new Promise((r) => setTimeout(r, 2500)); // el precalentamiento

const TURNOS = ["Hola Hestia, ¿cómo va todo?", "¿Qué hora es?", "¿Cuánta agua llevo hoy?", "Dame una idea para cenar algo liviano.", "¿Y si mañana amanezco cansado, entreno igual?", "Gracias, eso es todo."];
const res: Array<{ q: string; ms: number | null; total: number; trozos: number; texto: string }> = [];
for (const q of TURNOS) {
  const desde = eventos.length;
  const t0 = Date.now();
  ws.send(JSON.stringify({ type: "voz_turno", texto: q }));
  const fin = await esperar((m) => (m.type === "voz_fin" || m.type === "voz_error") && m.i >= desde, 120_000);
  const mios = eventos.slice(desde);
  const audios = mios.filter((m) => m.type === "voz_audio");
  const seqOk = audios.every((a, i) => a.seq === i + 1);
  const contenido = audios.filter((a) => !a.muletilla);
  res.push({ q, ms: contenido.length ? contenido[0].at - t0 : null, total: Date.now() - t0, trozos: audios.length, texto: String(fin.texto ?? fin.mensaje ?? "") });
  const mul = audios.find((a) => a.muletilla);
  console.log(`${String(res.at(-1)!.ms).padStart(5)} ms al primer audio${mul ? ` (muletilla «${mul.texto}» a los ${mul.at - t0} ms)` : ""} · ${audios.length} trozos${seqOk ? "" : " ⚠ DESORDEN"} · ${q}\n        → ${res.at(-1)!.texto.replace(/\s+/g, " ").slice(0, 160)}`);
}

// Cortar a mitad
{
  const desde = eventos.length;
  ws.send(JSON.stringify({ type: "voz_turno", texto: "Cuéntame con harto detalle la historia de Chile desde la independencia hasta hoy." }));
  await esperar((m) => m.type === "voz_audio" && m.i >= desde, 120_000);
  const turno = eventos.slice(desde).find((m) => m.type === "voz_pensando")?.turno;
  ws.send(JSON.stringify({ type: "voz_cortar" }));
  await esperar((m) => m.type === "voz_cortado");
  const n = eventos.length;
  await new Promise((r) => setTimeout(r, 4000));
  const despues = eventos.slice(n).filter((m) => m.turno === turno);
  console.log(`cortar a mitad: ${despues.length === 0 ? "✅ no llegó nada más de ese turno" : `❌ llegaron ${despues.length} mensajes más`}`);
}
ws.send(JSON.stringify({ type: "voz_colgar" }));
await esperar((m) => m.type === "voz_colgada");
const ms = res.map((r) => r.ms ?? 99999).sort((a, b) => a - b);
console.log(`\nPRIMER AUDIO (servidor, sin el teléfono): p50 ${ms[Math.floor(ms.length / 2)]} ms · máx ${ms.at(-1)} ms`);
ws.close();
process.exit(0);
