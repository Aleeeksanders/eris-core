// ============================================================
// Eris — Política de rutas y comandos
//
// Las herramientas de archivos y de terminal ya no tocan "cualquier cosa": aquí se decide qué está permitido.
// Esto es la segunda línea de defensa: la primera es que una persona apruebe cada acción en la app.
//
//   ESCRIBIR  solo dentro de: la bóveda AXS, Escritorio, Documentos, Descargas y la carpeta temporal
//             (ampliable en ~/.eris/policy.json → { "writeRoots": ["D:\\Trabajo"] }).
//   LEER      cualquier lugar, EXCEPTO lo protegido.
//   PROTEGIDO (ni leer ni escribir, aunque el usuario apruebe): ~/.eris (llave del servidor, cuentas, sesiones, perfiles,
//             roles, bitácora), archivos .env, llaves privadas/certificados, carpetas .ssh/.aws y los datos de navegadores.
//   CÓDIGO    el código de Eris (C:\Proyectos\eris y eris-mobile) tampoco se escribe desde el chat.
//
// Las rutas se resuelven con realpath (siguen enlaces simbólicos y uniones) para que un atajo no saque a nadie de su carpeta.
// ============================================================

import { existsSync, realpathSync, readFileSync } from "fs";
import * as os from "os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "path";

export interface PathPolicyConfig {
  writeRoots: string[];
  /** Carpetas que no se leen ni se escriben. */
  protectedRoots: string[];
  /** Carpetas que se pueden leer pero no escribir (el código de Eris). */
  readOnlyRoots: string[];
}

const WIN = process.platform === "win32";
const norm = (p: string) => (WIN ? p.toLowerCase() : p);

/** Nombres de archivo que jamás se leen ni escriben, estén donde estén. */
const PROTECTED_NAME = [
  /^\.env(\..*)?$/i,
  /^server_secret$/i,
  /^audit.*\.jsonl$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|pfx|p12|key|keystore|jks|kdbx)$/i,
  /^(login data|cookies|web data|key4\.db|logins\.json)$/i,
  /^local\.properties$/i,
];

/** Archivos que se pueden leer pero NO escribir: escribirlos deja una puerta trasera que corre sola (perfiles de shell, git, npm). */
const WRITE_PROTECTED_NAME = [
  /profile\.ps1$/i,
  /^\.(bashrc|bash_profile|zshrc|profile|gitconfig|npmrc|netrc)$/i,
  /^autoexec\.bat$/i,
];

/** Fragmentos de ruta (ya en minúsculas y con "/") que delatan datos de navegadores u otros secretos. */
const PROTECTED_FRAGMENTS = [
  "/appdata/local/google/chrome/user data",
  "/appdata/local/microsoft/edge/user data",
  "/appdata/roaming/mozilla/firefox",
  "/appdata/local/bravesoftware",
  "/.ssh/", "/.aws/", "/.gnupg/", "/.azure/",
  "/.config/gh/", "/.docker/config.json",
];

let cached: PathPolicyConfig | null = null;

function safeReal(p: string): string {
  try { return realpathSync.native(p); } catch { return p; }
}

/** Resuelve `p` a una ruta absoluta real, aunque el archivo aún no exista (se resuelve el ancestro existente más profundo). */
export function resolveReal(p: string): string {
  const abs = resolve(p);
  const missing: string[] = [];
  let cur = abs;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return abs;
    missing.unshift(basename(cur));
    cur = parent;
  }
  return join(safeReal(cur), ...missing);
}

export function defaultPolicy(): PathPolicyConfig {
  if (cached) return cached;
  const home = os.homedir();
  const vault = process.env.AXS_VAULT_PATH || "C:\\Proyectos\\AXS";
  const writeRoots = [
    vault,
    join(home, "Desktop"), join(home, "Documents"), join(home, "Downloads"),
    join(home, "OneDrive", "Desktop"), join(home, "OneDrive", "Documents"), join(home, "OneDrive", "Escritorio"), join(home, "OneDrive", "Documentos"),
    os.tmpdir(),
  ];
  try {
    const extra = JSON.parse(readFileSync(join(home, ".eris", "policy.json"), "utf-8"));
    if (Array.isArray(extra.writeRoots)) for (const r of extra.writeRoots) if (typeof r === "string" && isAbsolute(r)) writeRoots.push(r);
  } catch {}
  cached = {
    writeRoots: writeRoots.filter((r) => existsSync(r)).map(resolveReal),
    protectedRoots: [join(home, ".eris"), join(home, ".ssh"), join(home, ".aws")].map(resolveReal),
    readOnlyRoots: ["C:\\Proyectos\\eris", "C:\\Proyectos\\eris-mobile"].filter((r) => existsSync(r)).map(resolveReal),
  };
  return cached;
}

/** Solo para pruebas. */
export function _setPolicyForTests(p: PathPolicyConfig | null) { cached = p; }

const inside = (root: string, p: string) => {
  const r = norm(root).replace(/[\\/]+$/, "");
  const x = norm(p);
  return x === r || x.startsWith(r + sep) || x.startsWith(r + "/");
};

export type PathCheck = { ok: true; resolved: string } | { ok: false; reason: string };

export function checkPath(raw: string, mode: "read" | "write", policy: PathPolicyConfig = defaultPolicy()): PathCheck {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "Ruta vacía." };
  if (raw.includes("\0")) return { ok: false, reason: "Ruta inválida." };
  const t = raw.trim();
  // UNC / rutas de dispositivo: sirven para filtrar credenciales o datos por la red
  if (/^\\\\/.test(t) || /^\/\//.test(t)) return { ok: false, reason: "No se permiten rutas de red ni de dispositivo (\\\\…)." };
  // Flujos alternativos de NTFS (archivo.txt:oculto) y nombres reservados de dispositivo
  if (WIN) {
    const rest = /^[a-z]:/i.test(t) ? t.slice(2) : t; // tras la letra de unidad no debe haber más ":"
    if (rest.includes(":")) return { ok: false, reason: "Ruta inválida (flujo alternativo de datos)." };
    if (/(^|[\\/])(con|prn|aux|nul|com\d|lpt\d)(\.|[\\/]|$)/i.test(t)) return { ok: false, reason: "Nombre de dispositivo reservado." };
  }

  const resolved = resolveReal(t);
  const flat = norm(resolved).replace(/\\/g, "/");

  const name = basename(resolved);
  if (PROTECTED_NAME.some((r) => r.test(name))) return { ok: false, reason: `"${name}" es un archivo protegido (secretos/llaves).` };
  if (PROTECTED_FRAGMENTS.some((f) => flat.includes(f))) return { ok: false, reason: "Esa carpeta contiene credenciales y está protegida." };
  if (policy.protectedRoots.some((r) => inside(r, resolved))) return { ok: false, reason: "Esa carpeta es interna de Eris (llaves, cuentas, perfiles) y está protegida." };

  if (mode === "write") {
    if (WRITE_PROTECTED_NAME.some((r) => r.test(name)) || flat.includes("/.git/hooks/")) {
      return { ok: false, reason: `"${name}" corre solo al abrir una terminal o un repositorio: no se escribe desde el chat.` };
    }
    if (policy.readOnlyRoots.some((r) => inside(r, resolved))) return { ok: false, reason: "El código de Eris no se modifica desde el chat." };
    if (!policy.writeRoots.some((r) => inside(r, resolved))) {
      return { ok: false, reason: "Solo se puede escribir en la bóveda AXS, Escritorio, Documentos, Descargas o la carpeta temporal." };
    }
  }
  return { ok: true, resolved };
}

// ─── Comandos de terminal ───────────────────────────────────────────────────

export interface CommandCheck {
  ok: boolean;
  reason?: string;
  risk: "normal" | "high";
  flags: string[];
}

/** Lo que jamás se ejecuta: comandos que esconden lo que hacen (la persona no podría revisarlos antes de aprobar) o tocan secretos. */
const BLOCKED_COMMAND: Array<[RegExp, string]> = [
  [/(^|\s)-e(c|n|nc|nco|ncod|ncode|ncoded|ncodedc|ncodedco|ncodedcom|ncodedcomm|ncodedcomma|ncodedcomman|ncodedcommand)?\s+[A-Za-z0-9+\/=]{12,}/i, "Comando codificado (-EncodedCommand): no se puede revisar antes de aprobar."],
  [/frombase64string|\[convert\]::frombase64/i, "Contenido en base64 ejecutable: no se puede revisar antes de aprobar."],
  [/\b(invoke-expression|iex)\b/i, "Invoke-Expression ejecuta texto armado al vuelo: no se puede revisar antes de aprobar."],
  [/\.eris\b|server_secret|accounts\.json|sessions\.json|audit\.jsonl|roles\.json/i, "El comando toca archivos internos de Eris (llaves, cuentas, sesiones)."],
  [/(^|[\s"'\\/])\.env\b/i, "El comando toca un archivo .env (secretos)."],
  [/\.ssh\b|\.aws\b|id_rsa|id_ed25519|user data[\\/].*(login data|cookies)/i, "El comando toca credenciales (SSH, nube o navegador)."],
  [/get-credential|convertfrom-securestring|mimikatz|sekurlsa|lsass/i, "El comando busca credenciales."],
  [/\bcmdkey\b|vaultcmd/i, "El comando lee el almacén de credenciales de Windows."],
];

/** Señales de riesgo alto (se puede aprobar, pero la tarjeta lo destaca). */
const RISK_FLAGS: Array<[RegExp, string]> = [
  [/\b(remove-item|rm|del|erase|rmdir|rd)\b/i, "borra archivos"],
  [/\b(format-volume|clear-disk|diskpart|format\s+[a-z]:)/i, "formatea discos"],
  [/\b(stop-process|taskkill|kill|stop-service|sc(\.exe)?\s+(stop|delete)|restart-service)\b/i, "detiene procesos o servicios"],
  [/\b(invoke-webrequest|iwr|invoke-restmethod|irm|curl|wget|start-bitstransfer|net\s+use|ftp|scp|ssh)\b/i, "usa la red (descarga o envía datos)"],
  [/\b(start-process|invoke-item|ii|start)\b/i, "abre o lanza programas"],
  [/\b(set-executionpolicy|reg(\.exe)?\s+(add|delete|import)|set-itemproperty|new-itemproperty|netsh|schtasks|new-service|net\s+(user|localgroup)|icacls|takeown|set-mppreference|add-mppreference)\b/i, "cambia la configuración del sistema"],
  [/\b(shutdown|restart-computer|stop-computer)\b/i, "apaga o reinicia el equipo"],
  [/\b(set-content|add-content|out-file|new-item|copy-item|move-item|rename-item|tee-object)\b|(?<![-\d>])>>?(?!&)\s*\S/i, "escribe o mueve archivos"],
  [/\bgit\s+(push|reset\s+--hard|clean|checkout\s+--|rebase)\b/i, "cambia el historial de git"],
  [/[;&|]{1,2}\s*(remove-item|rm|del)\b|`|\$\(/i, "encadena o compone comandos"],
];

export function checkCommand(cmd: string, cwd?: string): CommandCheck {
  const text = String(cmd ?? "");
  if (!text.trim()) return { ok: false, reason: "Comando vacío.", risk: "normal", flags: [] };
  if (text.length > 4000) return { ok: false, reason: "Comando demasiado largo para revisarlo (máx. 4000 caracteres).", risk: "high", flags: [] };
  // Sin caracteres de control (ocultan texto en la tarjeta de aprobación)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(text)) {
    return { ok: false, reason: "El comando trae caracteres invisibles o de control.", risk: "high", flags: [] };
  }
  for (const [re, why] of BLOCKED_COMMAND) if (re.test(text)) return { ok: false, reason: why, risk: "high", flags: [] };
  if (cwd) {
    const c = checkPath(cwd, "read");
    if (!c.ok) return { ok: false, reason: `Directorio de trabajo no permitido: ${c.reason}`, risk: "high", flags: [] };
  }
  const flags = RISK_FLAGS.filter(([re]) => re.test(text)).map(([, f]) => f);
  return { ok: true, risk: flags.length ? "high" : "normal", flags };
}

/** Variables de entorno que NO se le pasan a los procesos hijos (PIN de administración, llaves, tokens). */
export function cleanEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (/(pin|secret|token|password|passwd|api[_-]?key|private|credential|client_secret)/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

const EXEC_EXT = /\.(exe|bat|cmd|com|ps1|psm1|vbs|vbe|js|jse|wsf|msi|msc|scr|lnk|hta|reg|jar|cpl|dll)$/i;

/** ¿Es un ejecutable / script? (abrirlo equivale a correr código) */
export function isExecutableTarget(target: string): boolean {
  return EXEC_EXT.test(target.trim().replace(/["']/g, ""));
}
