// ============================================================
// Eris — VaultBriefing
//
// El "estado de AXS" calculado en código: qué hay, qué se movió, qué está pendiente, qué falla. Todo sale de la bóveda;
// nada lo inventa un modelo. El modelo solo comenta las 2-3 cosas más importantes y el bloque exacto se muestra aparte.
// ============================================================

import type { Note, NoteTask, VaultIndex } from "./VaultIndex.js";
import { lintVault, summarize, issueLabel, type Issue } from "./VaultLint.js";

const DAY = 86_400_000;
export const daysAgo = (ms: number, now = Date.now()) => Math.max(0, Math.floor((now - ms) / DAY));
export const agoText = (days: number) => (days === 0 ? "hoy" : days === 1 ? "ayer" : days < 45 ? `hace ${days} días` : days < 550 ? `hace ${Math.round(days / 30)} meses` : `hace ${(days / 365).toFixed(1)} años`);
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const link = (idx: VaultIndex, p: string, alias?: string) => idx.wikilink(p, alias);

/** Tareas del calendario de rituales (Diario/Semanal/Mensual…) de una nota de cadencia: se cuentan aparte del backlog real. */
const CADENCE = /diario|semanal|mensual|trimestral|anual|ritual/i;

export function openTasks(idx: VaultIndex): { backlog: Array<NoteTask & { path: string }>; rituals: Array<{ path: string; heading: string; open: number }> } {
  const backlog: Array<NoteTask & { path: string }> = [];
  const rit = new Map<string, { path: string; heading: string; open: number }>();
  for (const n of idx.notes.values()) {
    if (n.area === "90-99 Archivo") continue;
    const isCadenceNote = n.tags.includes("AXS/Roadmap");
    for (const t of n.tasks) {
      if (t.done) continue;
      if (isCadenceNote && CADENCE.test(t.heading)) {
        const k = `${n.path}#${t.heading}`;
        const cur = rit.get(k) ?? { path: n.path, heading: t.heading, open: 0 };
        cur.open++; rit.set(k, cur);
      } else backlog.push({ ...t, path: n.path });
    }
  }
  return { backlog, rituals: [...rit.values()] };
}

/** Viñetas de la sección "Tareas Pendientes / Roadmap Inmediato" de MEMORY.md (lo que Alex marcó como lo próximo). */
export function immediateRoadmap(idx: VaultIndex): string[] {
  const m = idx.notes.get("MEMORY.md");
  if (!m) return [];
  const out: string[] = [];
  let on = false;
  for (const line of m.raw.split("\n")) {
    if (/^#{1,6}\s/.test(line)) { on = /tareas pendientes|roadmap inmediato/i.test(line); continue; }
    if (on && /^\s*[-*+]\s+\S/.test(line)) out.push(line.replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/, "").replace(/\*\*/g, "").trim());
  }
  return out;
}

export function feedState(idx: VaultIndex, now = Date.now()) {
  const dated = (re: RegExp, filter: (n: Note) => boolean) => {
    let best: { n: Note; date: string; ms: number } | null = null;
    for (const n of idx.notes.values()) {
      if (!filter(n)) continue;
      const m = n.name.match(re);
      if (!m) continue;
      const ms = Date.parse(m[1] + "T12:00:00");
      if (!isNaN(ms) && (!best || ms > best.ms)) best = { n, date: m[1], ms };
    }
    return best && { ...best, days: daysAgo(best.ms, now) };
  };
  return {
    log: dated(/^log-(\d{4}-\d{2}-\d{2})$/, (n) => n.path.startsWith("50-59 Intelligence Feed/52 Logs/")),
    decision: dated(/^decision-(\d{4}-\d{2}-\d{2})-/, (n) => n.path.startsWith("50-59 Intelligence Feed/53 Decisions/")),
    daily: dated(/^(\d{4}-\d{2}-\d{2})$/, () => true),
  };
}

export function inboxItems(idx: VaultIndex): number | null {
  const n = [...idx.notes.values()].find((x) => x.name.toLowerCase() === "inbox");
  if (!n) return null;
  return n.body.split("\n").filter((l) => /^\s*([-*+]|\d+\.)\s+\S/.test(l) || /^\s*!?\[\[/.test(l)).length;
}

/**
 * `text` es el informe completo (incluye texto de las notas: tareas, párrafos) y se muestra al usuario tal cual.
 * `facts` son solo cifras y estados calculados, sin texto libre de las notas: es lo ÚNICO que lee el modelo.
 * Así el modelo puede comentar sin que el contenido de una nota sea nunca una instrucción para él.
 */
export interface Briefing { text: string; issues: Issue[]; facts: string[]; /** frase corta ya redactada para responder sin el modelo */ quick: string }

/** Estado general de AXS. */
export function buildBriefing(idx: VaultIndex, now = Date.now(), issues = lintVault(idx)): Briefing {
  const s = summarize(issues);
  const L: string[] = [`# 🧭 Briefing AXS — ${new Date(now).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`];

  // Bóveda
  const areas = new Map<string, number>();
  for (const n of idx.notes.values()) { const a = n.area || "raíz"; areas.set(a, (areas.get(a) ?? 0) + 1); }
  // "Actividad" ignora archivos de agente y notas vacías (un «Sin título» creado sin querer no es movimiento)
  const real = [...idx.notes.values()].filter((n) => n.size > 0 && n.path !== "CLAUDE.md" && n.path !== "MEMORY.md");
  const lastMs = Math.max(...real.map((n) => n.mtimeMs));
  L.push("", `**Bóveda:** ${idx.notes.size} notas · última modificación ${agoText(daysAgo(lastMs, now))}`);
  L.push([...areas.entries()].sort().map(([a, c]) => `${a.split(" ")[0]} ${c}`).join(" · "));

  // Salud
  L.push("", `**Salud:** ${s.light} ${s.errors} error(es) · ${s.warns} aviso(s)`);
  for (const i of issues.filter((x) => x.severity !== "info").slice(0, 4)) L.push(`- ${issueLabel(i.code)}: \`${i.path}\`${i.line ? `:${i.line}` : ""}`);
  if (s.errors + s.warns > 4) L.push(`- … y ${s.errors + s.warns - 4} más (pídeme el detalle con la auditoría de la bóveda)`);

  // Actividad
  const recent = real.filter((n) => n.area !== "90-99 Archivo").sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 5);
  L.push("", "**Último movimiento:**");
  for (const n of recent) L.push(`- ${ymd(n.mtimeMs)} (${agoText(daysAgo(n.mtimeMs, now))}) · ${link(idx, n.path, n.name)}`);

  // Pendientes
  const t = openTasks(idx);
  const next = immediateRoadmap(idx);
  L.push("", `**Pendientes:** ${t.backlog.length} tarea(s) abiertas en notas${t.rituals.length ? ` · ${t.rituals.reduce((a, r) => a + r.open, 0)} ritual(es) de cadencia sin marcar` : ""}`);
  if (next.length) { L.push("Lo inmediato (MEMORY.md):"); for (const x of next.slice(0, 4)) L.push(`- ${x}`); }
  if (t.backlog.length) L.push("Backlog en notas:");
  for (const x of t.backlog.slice(0, 4)) L.push(`- [ ] ${x.text.slice(0, 110)} — \`${x.path.split("/").pop()}\``);
  if (t.backlog.length > 4) L.push(`- … y ${t.backlog.length - 4} más (pídeme los pendientes)`);

  // Registro
  const f = feedState(idx, now);
  L.push("", "**Registro:**");
  L.push(`- Último log del sistema: ${f.log ? `${f.log.date} (${agoText(f.log.days)})${f.log.days > 7 ? " ⚠ sin log hace más de una semana" : ""}` : "ninguno"}`);
  L.push(`- Última nota diaria: ${f.daily ? `${f.daily.date} (${agoText(f.daily.days)})` : "ninguna"}`);
  L.push(`- Última decisión cristalizada: ${f.decision ? `${f.decision.date} (${agoText(f.decision.days)})` : "ninguna"}`);
  const inbox = inboxItems(idx);
  if (inbox !== null) L.push(`- Inbox: ${inbox === 0 ? "vacío ✅" : `${inbox} elemento(s) por procesar`}`);

  // Hechos para el modelo (sin texto libre de las notas) y qué merece atención, ya priorizado por código
  const facts = [
    `Bóveda: ${idx.notes.size} notas; última modificación ${agoText(daysAgo(lastMs, now))}.`,
    `Salud: ${s.light} ${s.errors} error(es), ${s.warns} aviso(s)${s.errors + s.warns ? ` (${[...new Set(issues.filter((x) => x.severity !== "info").map((x) => issueLabel(x.code)))].join(", ")})` : ""}.`,
    `Pendientes: ${t.backlog.length} abiertas en notas, ${next.length} inmediatas en MEMORY.md, ${t.rituals.reduce((a, r) => a + r.open, 0)} rituales de cadencia sin marcar.`,
    `Último log del sistema: ${f.log ? agoText(f.log.days) : "ninguno"}. Última nota diaria: ${f.daily ? agoText(f.daily.days) : "ninguna"}. Última decisión: ${f.decision ? agoText(f.decision.days) : "ninguna"}.`,
    `Inbox: ${inbox === null ? "no existe" : inbox === 0 ? "vacío" : `${inbox} por procesar`}.`,
  ];
  const attention: string[] = [];
  if (s.errors) attention.push(`${s.errors} error(es) en la bóveda`);
  if (f.log && f.log.days > 7) attention.push(`el log del sistema lleva ${agoText(f.log.days).replace("hace ", "")} sin actualizarse`);
  if (inbox) attention.push(`${inbox} elemento(s) en el Inbox`);
  if (next.length) attention.push(`${next.length} tarea(s) inmediata(s) en MEMORY.md`);
  if (s.warns) attention.push(`${s.warns} aviso(s) de salud`);
  facts.push(attention.length ? `Merece atención: ${attention.join("; ")}.` : "Merece atención: nada urgente.");

  const quick = (attention.length ? `Esto es lo que merece atención en AXS: ${attention.join("; ")}.` : "Todo en orden por ahora: nada urgente en AXS.") +
    " Abajo tienes el detalle; dime si quieres que profundice en los pendientes, la salud de la bóveda o algún proyecto.";
  return { text: L.join("\n"), issues, facts, quick };
}

/** Todos los pendientes, agrupados por nota. `facts` = solo cifras (lo que lee el modelo). */
export function buildPending(idx: VaultIndex): { text: string; facts: string[]; quick: string } {
  const t = openTasks(idx);
  const next = immediateRoadmap(idx);
  const notes = new Set(t.backlog.map((x) => x.path)).size;
  const facts = [
    `Pendientes: ${t.backlog.length} tareas abiertas en ${notes} nota(s), ${next.length} inmediatas en MEMORY.md, ${t.rituals.reduce((a, r) => a + r.open, 0)} rituales de cadencia sin marcar (se repiten).`,
  ];
  const L = ["# 📋 Pendientes de AXS"];
  if (next.length) { L.push("", "**Lo inmediato** (MEMORY.md → Tareas Pendientes):"); for (const x of next) L.push(`- ${x}`); }
  const byNote = new Map<string, Array<NoteTask & { path: string }>>();
  for (const x of t.backlog) byNote.set(x.path, [...(byNote.get(x.path) ?? []), x]);
  L.push("", `**Backlog en notas** (${t.backlog.length}):`);
  if (!t.backlog.length) L.push("- Ninguno abierto ✅");
  for (const [p, xs] of byNote) {
    L.push(`${link(idx, p, p.split("/").pop()!.replace(/\.md$/, ""))}`);
    for (const x of xs.slice(0, 8)) L.push(`- [ ] ${x.text.slice(0, 140)}`);
    if (xs.length > 8) L.push(`- … y ${xs.length - 8} más`);
  }
  if (t.rituals.length) {
    L.push("", "**Rituales de cadencia** (se repiten; solo se cuentan):");
    for (const r of t.rituals) L.push(`- ${r.heading}: ${r.open} sin marcar (${link(idx, r.path, r.path.split("/").pop()!.replace(/\.md$/, ""))})`);
  }
  const rit = t.rituals.reduce((a, r) => a + r.open, 0);
  const quick = `Tienes ${t.backlog.length} tarea(s) abierta(s) en ${notes} nota(s)${next.length ? ` y ${next.length} inmediata(s) en MEMORY.md` : ""}${rit ? `, más ${rit} ritual(es) de cadencia sin marcar` : ""}. Abajo está el detalle.`;
  return { text: L.join("\n"), facts, quick };
}

/** Ficha de un proyecto/nota: quién es, en qué estado está, qué le falta y con qué se conecta. */
export function buildProject(idx: VaultIndex, query: string, now = Date.now(), issues = lintVault(idx)): { text: string; facts: string[]; quick: string; found: Note | null; alternatives: Note[] } {
  const cands = idx.find(query, 4);
  if (!cands.length) return { text: `No encontré ninguna nota que se llame «${query}».`, facts: ["No existe ninguna nota con ese nombre."], quick: `No encontré ninguna nota que se llame «${query}».`, found: null, alternatives: [] };
  const n = cands[0];
  const fm = n.frontmatter ?? {};
  const L = [`# 📁 ${n.name}`, `${link(idx, n.path)}`];
  L.push("", `**Estado:** ${fm.status ?? "sin status"} · **Nivel:** ${fm.tier ?? "sin tier"} · **Modificada:** ${ymd(n.mtimeMs)} (${agoText(daysAgo(n.mtimeMs, now))}) · ${n.words} palabras`);
  if (n.tags.length) L.push(`**Tags:** ${n.tags.map((t) => "#" + t).join(" ")}`);

  const h1 = n.headings.find((h) => h.level === 1);
  const lines = n.body.split("\n");
  const start = h1 ? h1.line : 0;
  const para = lines.slice(start).find((l) => l.trim() && !/^#|^\s*[>|]|^\s*[-*]\s|^\s*!?\[\[|^\s*#AXS/.test(l));
  if (para) L.push("", `> ${para.trim().replace(/\*\*/g, "").slice(0, 260)}`);

  const h2 = n.headings.filter((h) => h.level === 2).slice(0, 8);
  if (h2.length) L.push("", `**Secciones:** ${h2.map((h) => h.text.replace(/^[^\p{L}\p{N}]+/u, "")).join(" · ")}`);

  const open = n.tasks.filter((t) => !t.done);
  if (n.tasks.length) {
    L.push("", `**Tareas:** ${open.length} abiertas de ${n.tasks.length}`);
    for (const t of open.slice(0, 5)) L.push(`- [ ] ${t.text.slice(0, 110)}`);
  }

  const inc = [...(idx.incoming.get(n.path) ?? [])];
  const out = [...new Set(n.links.filter((l) => l.resolved && l.resolved !== n.path && !l.embed).map((l) => l.resolved!))];
  L.push("", `**Conexiones:** ${inc.length} entrante(s) · ${out.length} saliente(s)`);
  if (inc.length) L.push(`- Entran desde: ${inc.slice(0, 5).map((p) => link(idx, p)).join(" · ")}${inc.length > 5 ? " …" : ""}`);
  if (out.length) L.push(`- Salen hacia: ${out.slice(0, 6).map((p) => link(idx, p)).join(" · ")}${out.length > 6 ? " …" : ""}`);

  const mine = issues.filter((i) => i.path === n.path && i.severity !== "info");
  L.push("", mine.length ? `**Salud de la nota:** 🟡 ${mine.map((i) => i.message).slice(0, 3).join(" · ")}` : "**Salud de la nota:** 🟢 sin observaciones");
  const facts = [
    `Nota: ${n.name} (${n.path.split("/")[0]}). Estado ${fm.status ?? "sin status"}, nivel ${fm.tier ?? "sin tier"}, modificada ${agoText(daysAgo(n.mtimeMs, now))}, ${n.words} palabras.`,
    `Tareas: ${open.length} abiertas de ${n.tasks.length}. Conexiones: ${inc.length} entrantes, ${out.length} salientes.`,
    mine.length ? `Salud de la nota: ${mine.length} observación(es).` : "Salud de la nota: sin observaciones.",
  ];
  if (cands.length > 1) facts.push(`Otras notas con nombre parecido: ${cands.slice(1).map((c) => c.name).join(", ")}.`);
  const quick = `${n.name}: ${fm.status ?? "sin status"}, nivel ${fm.tier ?? "sin tier"}; ${open.length} tarea(s) abierta(s) y ${inc.length} conexión(es) entrantes${mine.length ? `; la nota tiene ${mine.length} observación(es) de salud` : ""}. Abajo tienes la ficha completa.`;
  return { text: L.join("\n"), facts, quick, found: n, alternatives: cands.slice(1) };
}
