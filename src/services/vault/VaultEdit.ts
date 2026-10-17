// ============================================================
// Eris — VaultEdit
//
// Ediciones pequeñas y seguras sobre notas existentes: agregar una viñeta al final de una sección y respaldar el
// archivo tal cual estaba ANTES de tocarlo. Respetan los saltos de línea (CRLF/LF) de cada nota.
// ============================================================

import { copyFile, mkdir } from "fs/promises";
import { dirname, join, relative } from "path";
import * as os from "os";

/** Aplica `fn` sobre el texto con "\n" y devuelve el resultado con los mismos saltos de línea que tenía el original. */
export function keepEol(raw: string, fn: (text: string) => string): string {
  const crlf = raw.includes("\r\n");
  const out = fn(crlf ? raw.replace(/\r\n/g, "\n") : raw);
  return crlf ? out.replace(/\n/g, "\r\n") : out;
}

/**
 * Agrega `bullet` al final de la sección cuyo encabezado coincide con `headingRe`. Devuelve null si no hay tal sección
 * (así el que llama decide qué hacer en vez de escribir en un lugar equivocado).
 */
export function addBulletToSection(text: string, headingRe: RegExp, bullet: string): string | null {
  const lines = text.split("\n");
  const h = lines.findIndex((l) => /^#{1,6}\s/.test(l) && headingRe.test(l));
  if (h < 0) return null;
  const level = lines[h].match(/^#+/)![0].length;
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  let last = h;
  for (let i = end - 1; i > h; i--) if (lines[i].trim()) { last = i; break; }
  lines.splice(last + 1, 0, bullet);
  return lines.join("\n");
}

/** Agrega el enlace en "## 🔗 Relacionados" (o cualquier sección "relacionad…"); si la nota no la tiene, la crea al final. */
export function addRelatedLink(text: string, bullet: string): string {
  const inSection = addBulletToSection(text, /relacionad/i, bullet);
  if (inSection !== null) return inSection;
  return text.replace(/\s*$/, "") + `\n\n## 🔗 Relacionados\n${bullet}\n`;
}

/** Copia exacta del archivo a ~/.eris/vault_backups/<carpeta>/<ruta relativa>. Si falla, el que llama NO debe modificar el original. */
export async function backupFile(vaultRoot: string, abs: string, stamp = new Date().toISOString().replace(/[:.]/g, "-")): Promise<string> {
  const dest = join(os.homedir(), ".eris", "vault_backups", stamp, relative(vaultRoot, abs));
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(abs, dest);
  return dest;
}
