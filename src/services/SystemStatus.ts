// ============================================================
// Eris — SystemStatus: cómo está el PC que corre Eris (para el modo empresa de la app)
//
// CPU, RAM, disco, tiempo encendido y si cada servicio de Eris responde (servidor, modelo, dictado, voz). Medido en el
// momento con el módulo `os` y conexiones de prueba a cada puerto: nada lo estima un modelo.
// ============================================================

import * as os from "node:os";
import { connect } from "node:net";
import { statfs } from "node:fs/promises";

/** `key`: el nombre con que la app pide iniciarlo, detenerlo o reiniciarlo (services/ServiceControl.ts). */
export interface ServiceState { key: string; name: string; port: number; up: boolean }
export interface SystemStatusData {
  host: string;
  cpuPct: number;
  cpuModel: string;
  cores: number;
  ramUsedGb: number;
  ramTotalGb: number;
  disk: { freeGb: number; totalGb: number } | null;
  uptimeH: number;
  serverUptimeH: number;
  services: ServiceState[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Uso de CPU entre dos lecturas (`os.loadavg` no existe en Windows). */
async function cpuPercent(ms = 300): Promise<number> {
  const snap = () => os.cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
  const a = snap();
  await new Promise((r) => setTimeout(r, ms));
  const b = snap();
  let idle = 0, total = 0;
  b.forEach((x, i) => { idle += x.idle - a[i].idle; total += x.total - a[i].total; });
  return total > 0 ? Math.round((1 - idle / total) * 100) : 0;
}

/** ¿Algo escucha en ese puerto del PC? */
function portUp(port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

export async function systemStatus(serverPort: number): Promise<SystemStatusData> {
  const SERVICES: Array<[string, string, number]> = [
    ["backend", "Servidor de Eris", serverPort], ["ollama", "Modelo (Ollama)", 11434], ["whisper", "Dictado (Whisper)", 8081], ["piper", "Voz (Piper)", 5001],
  ];
  const [cpuPct, services, disk] = await Promise.all([
    cpuPercent(),
    Promise.all(SERVICES.map(async ([key, name, port]) => ({ key, name, port, up: await portUp(port) }))),
    statfs(process.platform === "win32" ? (process.env.SystemDrive || "C:") + "\\" : "/")
      .then((s) => ({ freeGb: round1((s.bavail * s.bsize) / 1e9), totalGb: round1((s.blocks * s.bsize) / 1e9) }))
      .catch(() => null),
  ]);
  const cpus = os.cpus();
  return {
    host: os.hostname(),
    cpuPct,
    cpuModel: cpus[0]?.model?.trim() ?? "",
    cores: cpus.length,
    ramUsedGb: round1((os.totalmem() - os.freemem()) / 1e9),
    ramTotalGb: round1(os.totalmem() / 1e9),
    disk,
    uptimeH: round1(os.uptime() / 3600),
    serverUptimeH: round1(process.uptime() / 3600),
    services,
  };
}
