// ============================================================
// Hestia como JARVIS · L0 (2026-11-17): cómo está el equipo, medido (nada lo estima un modelo). Además de lo de SystemStatus
// (CPU, RAM, disco, servicios):
//  - la tarjeta de video: uso, memoria, temperatura y consumo (`nvidia-smi`, ~50 ms);
//  - el modelo cargado en Ollama, su tamaño y cuánto está en la tarjeta (/api/ps);
//  - la batería del notebook y si está enchufado (WMI; ~1 s: se guarda 2 min);
//  - los procesos que más RAM usan (solo para el panel; se guarda 30 s).
// Todo con tiempo máximo: si algo no responde, ese dato queda en null y lo demás sigue.
// ============================================================
import { execFile } from "node:child_process";
import * as os from "node:os";
import { statfs } from "node:fs/promises";

export interface Gpu { nombre: string; usoPct: number; vramUsadaGb: number; vramTotalGb: number; tempC: number; potenciaW: number | null }
export interface ModeloCargado { nombre: string; tamanoGb: number; enGpuGb: number; vence: string | null }
export interface Bateria { pct: number; enchufado: boolean }
export interface Proceso { nombre: string; ramMb: number }
export interface Medicion {
  t: string;
  cpuPct: number;
  ramLibreGb: number;
  ramTotalGb: number;
  discoLibreGb: number | null;
  discoTotalGb: number | null;
  gpu: Gpu | null;
  modelo: ModeloCargado | null;
  bateria: Bateria | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

function correr(cmd: string, args: string[], ms: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: ms, windowsHide: true, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? null : String(out)));
    } catch { resolve(null); }
  });
}
const powershell = (script: string, ms = 5000) => correr("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], ms);

/** Uso de CPU entre dos lecturas (en Windows no hay loadavg) */
export async function cpuPct(ms = 300): Promise<number> {
  const snap = () => os.cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
  const a = snap();
  await new Promise((r) => setTimeout(r, ms));
  const b = snap();
  let idle = 0, total = 0;
  b.forEach((x, i) => { idle += x.idle - a[i].idle; total += x.total - a[i].total; });
  return total > 0 ? Math.round((1 - idle / total) * 100) : 0;
}

/** «NVIDIA GeForce RTX 3050 6GB Laptop GPU, 40, 1395, 6144, 53, 12.34» → Gpu */
export function leerNvidiaSmi(salida: string | null): Gpu | null {
  const l = salida?.split(/\r?\n/).find((x) => x.trim());
  if (!l) return null;
  const p = l.split(",").map((x) => x.trim());
  if (p.length < 5) return null;
  const n = (s: string) => { const v = Number(s); return Number.isFinite(v) ? v : null; };
  const uso = n(p[1]), usada = n(p[2]), total = n(p[3]), temp = n(p[4]);
  if (uso == null || usada == null || total == null || temp == null) return null;
  return { nombre: p[0], usoPct: uso, vramUsadaGb: r2(usada / 1024), vramTotalGb: r2(total / 1024), tempC: temp, potenciaW: p[5] != null ? n(p[5]) : null };
}

export async function gpu(): Promise<Gpu | null> {
  const s = await correr("nvidia-smi", ["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw", "--format=csv,noheader,nounits"], 3000);
  return leerNvidiaSmi(s);
}

/** Lo que dice Ollama de lo que tiene cargado */
export function leerOllamaPs(j: any): ModeloCargado | null {
  const m = Array.isArray(j?.models) ? j.models[0] : null;
  if (!m) return null;
  return { nombre: String(m.name ?? m.model ?? "?"), tamanoGb: r2((Number(m.size) || 0) / 1e9), enGpuGb: r2((Number(m.size_vram) || 0) / 1e9), vence: typeof m.expires_at === "string" ? m.expires_at : null };
}

export async function modeloCargado(): Promise<ModeloCargado | null | undefined> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    const r = await fetch("http://127.0.0.1:11434/api/ps", { signal: ac.signal });
    clearTimeout(t);
    return leerOllamaPs(await r.json());
  } catch { return undefined; } // undefined = Ollama no respondió (≠ null: respondió y no hay nada cargado)
}

let bateriaCache: { at: number; v: Bateria | null } | null = null;
/** WMI: «85;2» → 85 %, enchufado (BatteryStatus 2 = con corriente). Sin batería (PC de escritorio): null */
export function leerBateria(s: string | null): Bateria | null {
  const m = /(\d{1,3})\s*;\s*(\d+)/.exec(s ?? "");
  if (!m) return null;
  const est = Number(m[2]);
  return { pct: Math.min(100, Number(m[1])), enchufado: est === 2 || est === 6 || est === 7 || est === 8 || est === 9 };
}
export async function bateria(maxEdadMs = 120_000): Promise<Bateria | null> {
  if (bateriaCache && Date.now() - bateriaCache.at < maxEdadMs) return bateriaCache.v;
  const s = await powershell("$b = Get-CimInstance Win32_Battery | Select-Object -First 1; if ($b) { \"$($b.EstimatedChargeRemaining);$($b.BatteryStatus)\" }", 6000);
  const v = leerBateria(s);
  bateriaCache = { at: Date.now(), v };
  return v;
}

let procCache: { at: number; v: Proceso[] } | null = null;
/** Los que más RAM usan (agrupados por nombre: Chrome tiene muchos) */
export async function procesos(n = 6): Promise<Proceso[]> {
  if (procCache && Date.now() - procCache.at < 30_000) return procCache.v;
  const s = await powershell("Get-Process | Group-Object ProcessName | ForEach-Object { \"$($_.Name);$([int](($_.Group | Measure-Object WorkingSet64 -Sum).Sum / 1MB))\" }", 8000);
  const v = (s ?? "").split(/\r?\n/).map((l) => { const [nombre, mb] = l.trim().split(";"); return { nombre, ramMb: Number(mb) }; })
    .filter((p) => p.nombre && Number.isFinite(p.ramMb)).sort((a, b) => b.ramMb - a.ramMb).slice(0, n);
  procCache = { at: Date.now(), v };
  return v;
}

/**
 * L4 (vigías del PC): cada proceso (sin .exe, en minúsculas) → segundos de CPU usados en total. Sirve para saber si está vivo y si
 * está trabajando (la diferencia entre dos lecturas). ~0,5 s; solo con un vigía activo.
 */
export async function cpuPorProceso(): Promise<Record<string, number>> {
  const s = await powershell("Get-Process | Group-Object ProcessName | ForEach-Object { \"$($_.Name);$([int](($_.Group | Measure-Object CPU -Sum).Sum))\" }", 8000);
  const out: Record<string, number> = {};
  for (const l of (s ?? "").split(/\r?\n/)) { const [n, c] = l.trim().split(";"); if (n) out[n.toLowerCase().replace(/\.exe$/, "")] = Number(c) || 0; }
  return out;
}

/** Una medición completa (lo del vigía; sin procesos) */
export async function medir(): Promise<Medicion> {
  const [cpu, g, mod, disco, bat] = await Promise.all([
    cpuPct(),
    gpu(),
    modeloCargado(),
    statfs(process.platform === "win32" ? (process.env.SystemDrive || "C:") + "\\" : "/").then((s) => ({ libre: (s.bavail * s.bsize) / 1e9, total: (s.blocks * s.bsize) / 1e9 })).catch(() => null),
    bateria(),
  ]);
  return {
    t: new Date().toISOString(),
    cpuPct: cpu,
    ramLibreGb: r1(os.freemem() / 1e9),
    ramTotalGb: r1(os.totalmem() / 1e9),
    discoLibreGb: disco ? r1(disco.libre) : null,
    discoTotalGb: disco ? r1(disco.total) : null,
    gpu: g,
    modelo: mod ?? null,
    bateria: bat,
  };
}
