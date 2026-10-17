// ============================================================
// Eris — VaultSearch
//
// Búsqueda con ranking sobre las notas de la bóveda. Reemplaza el "primer texto que coincida, por orden alfabético"
// de antes: sin acentos ni mayúsculas, por palabras (no por frase exacta), con más peso al nombre y a los encabezados,
// y devuelve las MEJORES notas con la línea que mejor responde, no las primeras 15 líneas sueltas.
// ============================================================

import { fold, type Note, type VaultIndex } from "./VaultIndex.js";

export interface SearchHit { note: Note; score: number; line: number; snippet: string; matched: string[] }

const STOP = new Set([
  "el", "la", "los", "las", "de", "del", "que", "y", "en", "un", "una", "unos", "unas", "es", "por", "con", "para", "como", "se", "al", "lo",
  "mi", "mis", "su", "sus", "a", "o", "sobre", "cual", "cuales", "dime", "dame", "busca", "buscar", "buscame", "nota", "notas", "axs", "hay", "tengo", "algo",
]);

export function tokenize(query: string): string[] {
  const toks = fold(query).match(/[a-z0-9][a-z0-9.+_-]*/g) ?? [];
  return [...new Set(toks.map((t) => t.replace(/[.\-_+]+$/, "")).filter((t) => t.length >= 2 && !STOP.has(t)))];
}

const countOf = (hay: string, needle: string) => { let c = 0, i = -1; while ((i = hay.indexOf(needle, i + 1)) !== -1) c++; return c; };

export function searchVault(idx: VaultIndex, query: string, limit = 6): SearchHit[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const phrase = tokens.length > 1 ? tokens.join(" ") : "";
  const hits: SearchHit[] = [];

  for (const n of idx.notes.values()) {
    const name = fold(n.name);
    const path = fold(n.path);
    const heads = n.headings.map((h) => fold(h.text));
    const rawLines = n.raw.split("\n");
    const foldedLines = rawLines.map(fold);
    const body = foldedLines.join("\n");

    let score = 0;
    const matched: string[] = [];
    for (const t of tokens) {
      const inName = name.includes(t);
      const inPath = !inName && path.includes(t);
      const inHead = heads.filter((h) => h.includes(t)).length;
      const inBody = Math.min(countOf(body, t), 5);
      if (!inName && !inPath && !inHead && !inBody) continue;
      matched.push(t);
      score += (inName ? 10 : 0) + (inPath ? 3 : 0) + Math.min(inHead, 2) * 5 + inBody;
    }
    if (!matched.length) continue;
    const coverage = matched.length / tokens.length;
    if (tokens.length >= 2 && coverage < 0.5) continue;
    score *= coverage;
    if (phrase && name.includes(phrase)) score += 20;
    else if (phrase && body.includes(phrase)) score += 6;
    if (n.frontmatter?.status === "Histórico") score *= 0.5;
    if (n.area === "90-99 Archivo") score *= 0.6;

    // La línea que mejor responde: más palabras de la búsqueda, y de preferencia que no sea el frontmatter ni una línea vacía
    let bestLine = -1, bestN = 0;
    foldedLines.forEach((l, i) => {
      if (!l.trim() || /^---\s*$/.test(l) || /^(owner|tier|status):/.test(l)) return;
      const k = tokens.filter((t) => l.includes(t)).length;
      if (k > bestN) { bestN = k; bestLine = i; }
    });
    const snippet = bestLine >= 0 ? rawLines[bestLine].trim().replace(/\s+/g, " ").slice(0, 220) : "";
    hits.push({ note: n, score, line: bestLine + 1, snippet, matched });
  }
  return hits.sort((a, b) => b.score - a.score || a.note.path.localeCompare(b.note.path)).slice(0, limit);
}
