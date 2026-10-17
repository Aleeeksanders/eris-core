// ============================================================
// Eris — VaultLint
//
// Revisa la bóveda AXS contra las reglas escritas en C:\Proyectos\AXS\CLAUDE.md. Es determinista: mismo vault, mismo
// resultado. Severidades:
//   error  algo roto (enlace que no lleva a ningún lado, nombre duplicado)
//   warn   se rompe una regla de la bóveda (enlace corto, sin frontmatter, huérfana…)
//   info   deuda conocida y ya documentada (tier "Por clasificar", tags sueltos legados, nombres legados)
// ============================================================

import { fold, type Note, type VaultIndex } from "./VaultIndex.js";

export type Severity = "error" | "warn" | "info";
export type IssueCode =
  | "broken_link" | "ambiguous_link" | "short_link" | "partial_path" | "table_alias"
  | "orphan" | "empty_note" | "frontmatter_missing" | "frontmatter_invalid" | "tier_legacy"
  | "duplicate_name" | "naming" | "naming_legacy" | "tag_unknown" | "tag_legacy" | "feed_unindexed" | "mojibake";

export interface Issue { code: IssueCode; severity: Severity; path: string; line?: number; message: string; fix?: string }

const TIERS = ["Directivo", "Técnico", "Operativo", "Estratégico"];
const STATUSES = ["Activo", "Concepto", "Planificado", "Histórico"];
/** Áreas de etiqueta #AXS/<Área> (CLAUDE.md → "Tags — vocabulario controlado") */
const TAG_AREAS = ["Producto", "Core", "Salud", "Finanzas", "Comercial", "Marketing", "Administración", "TI", "Infraestructura", "Seguridad", "Hardware", "TSN", "Dashboard", "Roadmap"];
/** Singletons fragmentados que CLAUDE.md declara pendientes de consolidar (no se propagan, pero no son un error nuevo) */
const TAG_LEGACY = ["ID", "Hub", "Daily", "Mente", "Doctrina", "Logica", "Red"];
const NAME_LEGACY = ["TSN_v0.5.0_preprint", "Annual_2026_Report"];

/** Archivos de agente: no son notas del vault. */
const AGENT_FILES = new Set(["CLAUDE.md", "MEMORY.md"]);
const FEED = "50-59 Intelligence Feed";
const FEED_INDEX = `${FEED}/50 - Índice del Feed.md`;

const isDaily = (n: Note) => /^\d{4}-\d{2}-\d{2}$/.test(n.name);
const isFeedDoc = (n: Note) => /^50-59 Intelligence Feed\/5[123] /.test(n.path);
/** Notas cuyo frontmatter no sigue el esquema owner/tier/status (logs, decisiones, reportes, diarios, archivo, archivos de agente) */
const frontmatterExempt = (n: Note) => AGENT_FILES.has(n.path) || isDaily(n) || isFeedDoc(n) || n.area === "90-99 Archivo";

export function lintVault(idx: VaultIndex): Issue[] {
  const out: Issue[] = [];
  const add = (i: Issue) => out.push(i);
  const notes = [...idx.notes.values()];

  // Nombres únicos en todo el vault
  const byName = new Map<string, Note[]>();
  for (const n of notes) byName.set(fold(n.name), [...(byName.get(fold(n.name)) ?? []), n]);
  for (const group of byName.values()) {
    if (group.length > 1) for (const n of group) {
      add({ code: "duplicate_name", severity: "error", path: n.path, message: `Nombre repetido en ${group.length} notas (${group.map((g) => g.path).filter((p) => p !== n.path).join(", ")}).`, fix: "Los nombres deben ser únicos en todo el vault: renombra una y reescribe sus enlaces entrantes." });
    }
  }

  // Índice del feed: a qué documentos enlaza
  const indexNote = idx.notes.get(FEED_INDEX);
  const indexed = new Set((indexNote?.links ?? []).map((l) => l.resolved).filter(Boolean) as string[]);

  for (const n of notes) {
    const agent = AGENT_FILES.has(n.path);

    // ── Vacía ──
    if (n.size === 0 || (n.body.trim() === "" && !n.frontmatter)) {
      add({ code: "empty_note", severity: "warn", path: n.path, message: "Nota vacía.", fix: "Bórrala o escribe su contenido." });
    }

    // ── Enlaces ──
    if (n.path !== "CLAUDE.md") {
      for (const l of n.links) {
        if (l.kind === "broken") {
          add({ code: "broken_link", severity: "error", path: n.path, line: l.line, message: `Enlace roto: [[${l.raw}]]`, fix: "Corrige la ruta o crea la nota destino." });
        } else if (l.kind === "ambiguous") {
          add({ code: "ambiguous_link", severity: "warn", path: n.path, line: l.line, message: `Enlace ambiguo (hay varias notas con ese nombre): [[${l.raw}]]`, fix: "Usa la ruta completa desde la raíz." });
        } else if (l.kind === "partial") {
          add({ code: "partial_path", severity: "warn", path: n.path, line: l.line, message: `Ruta parcial: [[${l.raw}]] → ${l.resolved}`, fix: `Escribe [[${l.resolved}|alias]].` });
        } else if (l.kind === "short" && !l.embed) {
          add({ code: "short_link", severity: "warn", path: n.path, line: l.line, message: `Enlace sin ruta completa: [[${l.raw}]] → ${l.resolved}`, fix: `Escribe [[${l.resolved}|${l.alias ?? l.target}]].` });
        }
        if (l.inTable && l.alias !== undefined && !l.embed) {
          add({ code: "table_alias", severity: "warn", path: n.path, line: l.line, message: `Enlace con alias dentro de una tabla: [[${l.raw}]] (el | parte la celda)`, fix: "Usa una lista, o el enlace sin alias dentro de la celda." });
        }
      }
    }

    // ── Huérfana ──
    // (una nota vacía ya se reporta como vacía: no se repite como huérfana)
    if (!agent && n.size > 0 && !(idx.incoming.get(n.path)?.size)) {
      add({ code: "orphan", severity: "warn", path: n.path, message: "Ninguna nota enlaza a esta.", fix: "Enlázala desde su nota-hub (o desde el Índice del Feed si es log/decisión/reporte)." });
    }

    // ── Frontmatter ──
    if (!frontmatterExempt(n) && n.size > 0) {
      const fm = n.frontmatter;
      if (!fm) {
        add({ code: "frontmatter_missing", severity: "warn", path: n.path, message: "Sin frontmatter (owner, tier, status).", fix: "Agrega el bloque --- owner / tier / status ---." });
      } else {
        const missing = ["owner", "tier", "status"].filter((k) => !fm[k]);
        if (missing.length) add({ code: "frontmatter_missing", severity: "warn", path: n.path, message: `Frontmatter sin: ${missing.join(", ")}.`, fix: "Completa los campos obligatorios." });
        if (fm.tier === "Por clasificar") add({ code: "tier_legacy", severity: "info", path: n.path, message: "tier: Por clasificar (deuda conocida).", fix: `Elige uno de: ${TIERS.join(" | ")}.` });
        else if (fm.tier && !TIERS.includes(fm.tier)) add({ code: "frontmatter_invalid", severity: "warn", path: n.path, message: `tier inválido: "${fm.tier}".`, fix: `Usa: ${TIERS.join(" | ")}.` });
        if (fm.status && !STATUSES.includes(fm.status)) add({ code: "frontmatter_invalid", severity: "warn", path: n.path, message: `status inválido: "${fm.status}".`, fix: `Usa: ${STATUSES.join(" | ")}.` });
      }
    }

    // ── Nomenclatura ──
    if (!agent && !isDaily(n)) {
      const nm = n.name;
      const okPattern = /^log-\d{4}-\d{2}-\d{2}$/.test(nm) || /^decision-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(nm);
      if (NAME_LEGACY.includes(nm)) add({ code: "naming_legacy", severity: "info", path: n.path, message: `Nombre con snake_case legado: ${nm}.` });
      else if (/^decision-\d{4}-\d{2}-\d{2}-\d{10,}$/.test(nm)) add({ code: "naming", severity: "warn", path: n.path, message: "Decisión con timestamp Unix en el nombre (patrón que CLAUDE.md pide no repetir).", fix: "Usa decision-YYYY-MM-DD-<slug-descriptivo>." });
      else if (!okPattern && (nm.includes("_") || /^[a-z0-9]+(-[a-z0-9]+)+$/.test(nm))) add({ code: "naming", severity: "warn", path: n.path, message: `Nombre en snake_case/kebab-case: ${nm}.`, fix: "Notas: «Título en Español Con Espacios»." });
    }

    // ── Tags ──
    for (const t of n.tags) {
      const area = t.split("/")[1];
      if (TAG_AREAS.includes(area)) continue;
      if (TAG_LEGACY.includes(area)) add({ code: "tag_legacy", severity: "info", path: n.path, message: `Tag suelto legado: #${t}.`, fix: "Consolidar en un área del vocabulario controlado." });
      else add({ code: "tag_unknown", severity: "warn", path: n.path, message: `Tag fuera del vocabulario: #${t}.`, fix: `Reutiliza: ${TAG_AREAS.map((a) => "#AXS/" + a).join(" ")}.` });
    }

    // ── Feed sin índice ──
    if (isFeedDoc(n) && n.path !== FEED_INDEX && indexNote && !indexed.has(n.path)) {
      add({ code: "feed_unindexed", severity: "warn", path: n.path, message: "No aparece en el Índice del Feed.", fix: `Agrégala a [[${FEED_INDEX}|50 - Índice del Feed]].` });
    }

    // ── Codificación rota (Ã©, â€™…) ──
    if (/Ã[\u0080-\u00BF]|â€[\u0080-\u00BF\u2018-\u201F\u2122]/.test(n.raw)) {
      add({ code: "mojibake", severity: "warn", path: n.path, message: "Texto con doble codificación (aparece «Ã©», «â€™»…).", fix: "Reconvertir el archivo a UTF-8 (ver validate.ps1)." });
    }
  }

  const rank = { error: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.code.localeCompare(b.code) || a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
}

export interface LintSummary {
  errors: number; warns: number; infos: number;
  /** 🟢 sin errores ni avisos · 🟡 solo avisos · 🔴 hay errores */
  light: "🟢" | "🟡" | "🔴";
  byCode: Record<string, number>;
}

export function summarize(issues: Issue[]): LintSummary {
  const byCode: Record<string, number> = {};
  for (const i of issues) byCode[i.code] = (byCode[i.code] ?? 0) + 1;
  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.filter((i) => i.severity === "warn").length;
  return { errors, warns, infos: issues.filter((i) => i.severity === "info").length, light: errors ? "🔴" : warns ? "🟡" : "🟢", byCode };
}

const LABEL: Record<IssueCode, string> = {
  broken_link: "Enlaces rotos", ambiguous_link: "Enlaces ambiguos", short_link: "Enlaces sin ruta completa", partial_path: "Rutas parciales",
  table_alias: "Alias dentro de tablas", orphan: "Notas huérfanas", empty_note: "Notas vacías", frontmatter_missing: "Frontmatter incompleto",
  frontmatter_invalid: "Frontmatter inválido", tier_legacy: "tier «Por clasificar» (deuda conocida)", duplicate_name: "Nombres repetidos",
  naming: "Nomenclatura", naming_legacy: "Nombres legados", tag_unknown: "Tags fuera del vocabulario", tag_legacy: "Tags sueltos legados (deuda conocida)",
  feed_unindexed: "Feed sin índice", mojibake: "Codificación rota",
};
export const issueLabel = (c: IssueCode) => LABEL[c];

/** Informe en markdown: por tipo, con ejemplos exactos y cómo arreglarlos. `perCode` = cuántos ejemplos por tipo. */
export function formatLint(issues: Issue[], opts: { perCode?: number; includeInfo?: boolean } = {}): string {
  const perCode = opts.perCode ?? 4;
  const s = summarize(issues);
  const lines = [
    `Estado: ${s.light} ${s.errors} error(es) · ${s.warns} aviso(s)${opts.includeInfo === false ? "" : ` · ${s.infos} deuda(s) conocida(s)`}`,
  ];
  const codes = [...new Set(issues.map((i) => i.code))].filter((c) => opts.includeInfo !== false || issues.find((i) => i.code === c)!.severity !== "info");
  if (!codes.length) lines.push("", "Sin hallazgos.");
  for (const c of codes) {
    const group = issues.filter((i) => i.code === c);
    const sev = group[0].severity === "error" ? "🔴" : group[0].severity === "warn" ? "🟡" : "⚪";
    lines.push("", `${sev} **${LABEL[c]}** (${group.length})`);
    for (const i of group.slice(0, perCode)) lines.push(`- \`${i.path}\`${i.line ? `:${i.line}` : ""} — ${i.message}`);
    if (group.length > perCode) lines.push(`- … y ${group.length - perCode} más`);
    if (group[0].fix) lines.push(`  ↳ ${group[0].fix}`);
  }
  return lines.join("\n");
}
