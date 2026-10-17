// ============================================================
// Eris — iniciar, detener y reiniciar sus servicios desde la app (Sistema, Modo AXS)
//
// 2026-10-15, pedido del usuario: «que Hestia levante los servicios… desde el módulo Sistema en AXS, no desde la burbuja
// de chat; inicio, detener, reiniciar». Son botones: no pasan por el modelo, así que funcionan con el chat en pausa.
//   - Solo para Ikaros con Google (lo revisa el canal de administración en server.ts) y queda en la bitácora.
//   - Solo acciones fijas del script del runbook (scripts/servicios.ps1): nada de lo que llega se arma como comando.
//   - El servidor se puede REINICIAR (lo hace un proceso aparte, lanzado con WMI, porque reiniciarse a sí mismo lo mata), pero
//     no detener ni iniciar desde la app: detenido, la app ya no tendría con quién hablar.
// ============================================================

import { join } from "path";

export const SERVICE_KEYS = ["ollama", "whisper", "piper", "backend", "chat"] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];
export const SERVICE_VERBS = ["iniciar", "detener", "reiniciar"] as const;
export type ServiceVerb = (typeof SERVICE_VERBS)[number];

export const SERVICE_LABEL: Record<ServiceKey, string> = {
  ollama: "Modelo (Ollama)", whisper: "Dictado (Whisper)", piper: "Voz (Piper)", backend: "Servidor de Eris", chat: "Chat (modelo, dictado y voz)",
};
/** Puertos de cada uno (los mismos de servicios.ps1 y SystemStatus). "chat" son los tres primeros. */
export const SERVICE_PORTS: Record<Exclude<ServiceKey, "chat">, number> = { ollama: 11434, whisper: 8081, piper: 5001, backend: 3000 };

const SCRIPT = join(import.meta.dir, "..", "..", "scripts", "servicios.ps1");
const ROOT = join(import.meta.dir, "..", "..");
const VERB_LABEL: Record<ServiceVerb, string> = { iniciar: "Iniciando", detener: "Deteniendo", reiniciar: "Reiniciando" };

/** Valida el pedido de la app. `serverPort`: con un servidor de prueba (otro puerto) no se toca el servidor real. */
export function parseServiceRequest(service: unknown, action: unknown, serverPort: number): { service: ServiceKey; action: ServiceVerb } | { error: string } {
  if (!SERVICE_KEYS.includes(service as ServiceKey)) return { error: "Servicio desconocido." };
  if (!SERVICE_VERBS.includes(action as ServiceVerb)) return { error: "Acción desconocida." };
  const s = service as ServiceKey, a = action as ServiceVerb;
  if (s === "backend" && a !== "reiniciar") {
    return { error: a === "detener"
      ? "El servidor no se detiene desde la app: te quedarías sin conexión para volver a iniciarlo. Usa Reiniciar, o servicios.ps1 en el PC."
      : "El servidor ya está arriba: es con quien estás hablando." };
  }
  if (s === "backend" && serverPort !== SERVICE_PORTS.backend) return { error: "Este es un servidor de prueba: no reinicia el servidor real." };
  return { service: s, action: a };
}

/** ¿Algo escucha en ese puerto? */
async function portUp(port: number): Promise<boolean> {
  const { connect } = await import("node:net");
  return new Promise((resolve) => {
    const sock = connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(700, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/** Cómo quedó cada servicio que tocó la acción, en palabras. */
async function stateLine(service: ServiceKey, want: boolean): Promise<{ ok: boolean; text: string }> {
  const keys = service === "chat" ? (["ollama", "whisper", "piper"] as const) : [service as Exclude<ServiceKey, "chat">];
  const parts = await Promise.all(keys.map(async (k) => ({ k, up: await portUp(SERVICE_PORTS[k]) })));
  const ok = parts.every((p) => p.up === want);
  const text = parts.map((p) => `${SERVICE_LABEL[p.k]}: ${p.up ? "en línea" : "detenido"}${p.up === want ? " ✓" : " ✗"}`).join(" · ");
  return { ok, text };
}

let busy: string | null = null;
export const serviceBusy = () => busy;

export interface ServiceRunOptions {
  /** para las pruebas: cómo se corre el script (por defecto, PowerShell) */
  run?: (args: string[], timeoutMs: number) => Promise<{ code: number | null; out: string }>;
}

async function runPowershell(args: string[], timeoutMs: number): Promise<{ code: number | null; out: string }> {
  const proc = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => { try { proc.kill(); } catch {} }, timeoutMs);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, out: `${out}${err}` };
}

/**
 * Hace la acción y dice cómo quedó (midiendo los puertos, no confiando en el script). Una a la vez: con otra en curso
 * contesta que espere. Reiniciar el servidor se lanza aparte y vuelve de inmediato: la app se reconecta sola.
 */
export async function runServiceAction(service: ServiceKey, action: ServiceVerb, opts: ServiceRunOptions = {}): Promise<{ ok: boolean; message: string; restartingServer?: boolean }> {
  if (busy) return { ok: false, message: `Espera un poco: ya estoy con «${busy}».` };
  const run = opts.run ?? runPowershell;
  busy = `${VERB_LABEL[action].toLowerCase()} ${SERVICE_LABEL[service].toLowerCase()}`;
  try {
    if (service === "backend") {
      // Un proceso aparte (WMI), que no muere con este servidor: lo detiene y lo vuelve a crear
      const inner = `powershell -NoProfile -ExecutionPolicy Bypass -File "${SCRIPT}" reiniciar-backend`;
      const cmd = `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${inner.replace(/'/g, "''")}'; CurrentDirectory = '${ROOT.replace(/'/g, "''")}' }; exit $r.ReturnValue`;
      const r = await run(["-Command", cmd], 30_000);
      if (r.code !== 0) return { ok: false, message: "No pude lanzar el reinicio del servidor. Revisa el PC (servicios.ps1 reiniciar-backend)." };
      return { ok: true, restartingServer: true, message: "Reiniciando el servidor de Eris… la app se desconecta unos segundos y se reconecta sola." };
    }
    // Iniciar Whisper puede tardar hasta 90 s y el chat completo, los tres seguidos
    const r = await run(["-File", SCRIPT, action, service], service === "chat" ? 240_000 : 150_000);
    const st = await stateLine(service, action !== "detener");
    // Un servicio: "Dictado (Whisper): en línea ✓". El chat completo: cómo quedó cada uno de los tres
    const head = action === "reiniciar" ? "Reiniciado. " : "";
    if (st.ok) return { ok: true, message: `${head}${st.text}` };
    return { ok: false, message: `${st.text} — no quedó como debía (${r.code === null ? "se acabó el tiempo" : r.code === 0 ? "revisa el PC" : `código ${r.code}`}).` };
  } catch (e: any) {
    return { ok: false, message: `No pude ${action} ${SERVICE_LABEL[service].toLowerCase()}: ${String(e?.message ?? e).slice(0, 160)}` };
  } finally {
    busy = null;
  }
}
