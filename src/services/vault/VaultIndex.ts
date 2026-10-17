// ============================================================
// Eris — VaultIndex
//
// Lee la bóveda AXS UNA vez y arma un modelo estructurado: notas, frontmatter, encabezados, enlaces (ya resueltos),
// etiquetas, tareas y quién enlaza a quién. Sobre esto trabajan el linter, el briefing y la búsqueda: son funciones
// deterministas de código, el modelo de lenguaje solo redacta lo que ellas devuelven.
//
// Convenciones de la bóveda (C:\Proyectos\AXS\CLAUDE.md) que este módulo entiende:
//   · enlaces con ruta completa desde la raíz: [[20-29 R&D (The Forge)/Toji.md|Toji]]
//   · una nota de la RAÍZ (p. ej. 2026-07-25.md) se enlaza solo por su nombre y eso es válido
//   · los bloques de código no cuentan como contenido (los ejemplos de CLAUDE.md no son enlaces reales)
// ============================================================

import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";

export type LinkKind = "full" | "root" | "short" | "partial" | "ambiguous" | "broken";

export interface NoteLink {
  /** Texto entre [[ ]] tal cual */
  raw: string;
  /** Destino sin #encabezado ni alias */
  target: string;
  alias?: string;
  line: number;
  inTable: boolean;
  embed: boolean;
  /** Ruta relativa (con .md) de lo que resuelve, o null si está roto */
  resolved: string | null;
  kind: LinkKind;
}

export interface NoteTask { done: boolean; text: string; line: number; heading: string }

export interface Note {
  /** Ruta relativa a la raíz, con "/" y con .md */
  path: string;
  /** Nombre sin .md */
  name: string;
  /** Carpeta de primer nivel ("" para la raíz) */
  area: string;
  size: number;
  mtimeMs: number;
  frontmatter: Record<string, string> | null;
  headings: Array<{ level: number; text: string; line: number }>;
  links: NoteLink[];
  tags: string[];
  tasks: NoteTask[];
  /** Cuerpo sin frontmatter y sin bloques de código (mismas líneas que el archivo original) */
  body: string;
  /** Texto completo original (para búsquedas y detección de codificación rota) */
  raw: string;
  words: number;
}

const SKIP_DIRS = new Set([".git", ".obsidian", "node_modules", ".trash"]);

/** Minúsculas y sin acentos: para comparar nombres y buscar. */
export const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Reemplaza por espacios los bloques de código (``` y `inline`) conservando saltos de línea, para no leer ejemplos como contenido. */
export function maskCode(text: string): string {
  let fence: string | null = null;
  return text
    .split("\n")
    .map((line) => {
      const m = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
        return " ".repeat(line.length);
      }
      if (m) { fence = m[1]; return " ".repeat(line.length); }
      return line.replace(/`[^`]*`/g, (s) => " ".repeat(s.length));
    })
    .join("\n");
}

function parseFrontmatter(text: string): { fm: Record<string, string> | null; fmLines: number } {
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(\n|$)/);
  if (!m) return { fm: null, fmLines: 0 };
  const fm: Record<string, string> = {};
  let lastKey = "";
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) { lastKey = kv[1]; fm[lastKey] = kv[2].trim().replace(/^["']|["']$/g, ""); }
    else if (lastKey && /^\s*-\s+/.test(line)) fm[lastKey] = (fm[lastKey] ? fm[lastKey] + ", " : "") + line.replace(/^\s*-\s+/, "").trim();
  }
  return { fm, fmLines: m[0].split("\n").length - (m[2] === "\n" ? 1 : 0) };
}

async function walk(dir: string, root: string, out: Array<{ rel: string; abs: string }>) {
  let names: string[] = [];
  try { names = await readdir(dir); } catch { return; }
  for (const n of names) {
    if (SKIP_DIRS.has(n)) continue;
    const abs = join(dir, n);
    let st;
    try { st = await stat(abs); } catch { continue; }
    if (st.isDirectory()) await walk(abs, root, out);
    else out.push({ rel: abs.slice(root.length).split("\\").join("/").replace(/^\/+/, ""), abs });
  }
}

export class VaultIndex {
  notes = new Map<string, Note>();
  /** Todas las rutas del vault (también no-.md: imágenes, PDF) en minúsculas → ruta real */
  private filesLower = new Map<string, string>();
  private byName = new Map<string, string[]>();
  incoming = new Map<string, Set<string>>();

  constructor(public root: string) {}

  static async build(root: string): Promise<VaultIndex> {
    const idx = new VaultIndex(root.replace(/[\\/]+$/, ""));
    const files: Array<{ rel: string; abs: string }> = [];
    await walk(idx.root, idx.root, files);
    for (const f of files) idx.filesLower.set(f.rel.toLowerCase(), f.rel);

    const parsed: Note[] = [];
    for (const f of files) {
      if (!f.rel.toLowerCase().endsWith(".md")) continue;
      let text = "", st;
      try { text = await readFile(f.abs, "utf-8"); st = await stat(f.abs); } catch { continue; }
      parsed.push(idx.parseNote(f.rel, text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"), st.size, st.mtimeMs));
    }
    for (const n of parsed) {
      idx.notes.set(n.path, n);
      const k = fold(n.name);
      idx.byName.set(k, [...(idx.byName.get(k) ?? []), n.path]);
    }
    for (const n of parsed) for (const l of n.links) {
      const link = idx.resolve(l.target, l.embed);
      l.resolved = link.resolved; l.kind = link.kind;
      if (l.resolved && l.resolved !== n.path) {
        if (!idx.incoming.has(l.resolved)) idx.incoming.set(l.resolved, new Set());
        idx.incoming.get(l.resolved)!.add(n.path);
      }
    }
    return idx;
  }

  private parseNote(rel: string, text: string, size: number, mtimeMs: number): Note {
    const { fm, fmLines } = parseFrontmatter(text);
    const rawLines = text.split("\n");
    const masked = maskCode(text).split("\n");
    for (let i = 0; i < fmLines; i++) masked[i] = ""; // el frontmatter no es cuerpo
    const body = masked.join("\n");

    const links: NoteLink[] = [];
    const headings: Note["headings"] = [];
    const tasks: NoteTask[] = [];
    const tags = new Set<string>();
    let heading = "";

    masked.forEach((line, i) => {
      // La estructura se detecta sobre el texto sin código, pero el TEXTO que se guarda es el original (conserva `código`)
      const h = /^(#{1,6})\s+\S/.test(line) ? rawLines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/) : null;
      if (h) { heading = h[2]; headings.push({ level: h[1].length, text: h[2], line: i + 1 }); }
      const t = /^\s*[-*+]\s+\[( |x|X)\]\s+\S/.test(line) ? rawLines[i].match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*\S)\s*$/) : null;
      if (t) tasks.push({ done: t[1] !== " ", text: t[2], line: i + 1, heading });
      for (const g of line.matchAll(/(?:^|\s)#(AXS\/[\p{L}\p{N}_\/-]+)/gu)) tags.add(g[1]);
      const inTable = /^\s*\|/.test(line);
      for (const m of line.matchAll(/(!?)\[\[([^\]\n]+?)\]\]/g)) {
        const inner = m[2];
        const parts = inner.split(/\\?\|/);
        const alias = parts.length > 1 ? parts.slice(1).join("|").trim() : undefined;
        const target = parts[0].replace(/[#^].*$/, "").replace(/\\$/, "").trim();
        if (!target) continue; // [[#Encabezado]]: enlace dentro de la misma nota
        links.push({ raw: inner, target, alias, line: i + 1, inTable, embed: m[1] === "!", resolved: null, kind: "broken" });
      }
    });

    const name = rel.split("/").pop()!.replace(/\.md$/i, "");
    const words = body.split(/\s+/).filter(Boolean).length;
    return {
      path: rel, name, area: rel.includes("/") ? rel.split("/")[0] : "",
      size, mtimeMs, frontmatter: fm, headings, links, tags: [...tags], tasks, body, raw: text, words,
    };
  }

  /** Cómo resuelve Obsidian un [[destino]], y de qué forma está escrito. */
  resolve(target: string, embed = false): { resolved: string | null; kind: LinkKind } {
    const t = target.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    const tl = t.toLowerCase();
    const exact = this.filesLower.get(tl) ?? this.filesLower.get(tl + ".md");
    if (exact) return { resolved: exact, kind: exact.includes("/") ? "full" : "root" };

    if (t.includes("/")) {
      const suf = "/" + tl.replace(/\.md$/, "");
      const hits = [...this.filesLower.entries()].filter(([k]) => k.replace(/\.md$/, "").endsWith(suf)).map(([, v]) => v);
      if (hits.length === 1) return { resolved: hits[0], kind: "partial" };
      if (hits.length > 1) return { resolved: hits[0], kind: "ambiguous" };
      return { resolved: null, kind: "broken" };
    }

    const names = this.byName.get(fold(t.replace(/\.md$/i, ""))) ?? [];
    if (names.length === 1) return { resolved: names[0], kind: "short" };
    if (names.length > 1) return { resolved: names[0], kind: "ambiguous" };
    // adjuntos por nombre (![[imagen.png]])
    const att = [...this.filesLower.entries()].filter(([k]) => k.endsWith("/" + tl) || k === tl).map(([, v]) => v);
    if (att.length >= 1) return { resolved: att[0], kind: embed ? "full" : "short" };
    return { resolved: null, kind: "broken" };
  }

  /** Busca notas por nombre (sin acentos): exacto > empieza por > contiene > todas las palabras. */
  find(query: string, limit = 5): Note[] {
    const q = fold(query).replace(/\.md$/, "").trim();
    if (!q) return [];
    const words = q.split(/\s+/).filter((w) => w.length > 1);
    const scored: Array<{ n: Note; s: number }> = [];
    for (const n of this.notes.values()) {
      const name = fold(n.name);
      let s = 0;
      if (name === q) s = 100;
      else if (name.startsWith(q)) s = 80;
      else if (name.includes(q)) s = 60;
      else if (words.length && words.every((w) => name.includes(w) || fold(n.path).includes(w))) s = 40;
      if (s) scored.push({ n, s: s - Math.min(n.path.split("/").length, 5) });
    }
    return scored.sort((a, b) => b.s - a.s || a.n.path.localeCompare(b.n.path)).slice(0, limit).map((x) => x.n);
  }

  /** Enlace wiki con ruta completa, listo para pegar: [[ruta/Nota.md|Nota]]. */
  wikilink(path: string, alias?: string): string {
    const name = path.split("/").pop()!.replace(/\.md$/i, "");
    return path.includes("/") ? `[[${path}|${alias ?? name}]]` : `[[${name}${alias ? "|" + alias : ""}]]`;
  }
}
