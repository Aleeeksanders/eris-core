// ============================================================
// Eris — AxsDashboard: el modo empresarial de la app, con datos
//
// El "Modo empresa" de la app (pestañas Panel, Proyectos, Pendientes, Sistema) muestra el estado de AXS calculado en
// código desde la bóveda, igual que el briefing del chat (VaultBriefing): nada lo inventa un modelo. Solo lo pide un
// perfil Ikaros con Google (bloque admin_ del servidor): la bóveda es de la empresa, no de cada usuario.
// ============================================================

import type { VaultIndex } from "./VaultIndex.js";
import { openTasks, immediateRoadmap, feedState, inboxItems, daysAgo, agoText } from "./VaultBriefing.js";
import { lintVault, summarize, issueLabel } from "./VaultLint.js";

/** Nombre corto de cada área de la bóveda (carpetas Johnny.Decimal). */
const AREA_LABEL: Array<[RegExp, string]> = [
  [/^00-09/, "Gobernanza"], [/^10-19/, "Visión estratégica"], [/^20-29/, "I+D · productos"], [/^30-39/, "Negocio"],
  [/^40-49/, "Estándares"], [/^50-59/, "Inteligencia"], [/^90-99/, "Archivo"],
];
export const areaLabel = (area: string) => (area ? AREA_LABEL.find(([re]) => re.test(area))?.[1] ?? area : "Raíz");

export interface AxsProject {
  path: string; name: string; area: string; areaLabel: string;
  status: string; tier: string; openTasks: number; tasks: number; ago: string; mtimeMs: number; tags: string[];
}

export interface AxsDashboardData {
  generatedAt: string;
  vault: { notes: number; lastActivity: string; areas: Array<{ area: string; label: string; notes: number }> };
  health: { light: string; errors: number; warns: number; top: Array<{ label: string; path: string }> };
  /** lo que merece atención, ya priorizado (mismo criterio que el briefing del chat) */
  attention: string[];
  pending: {
    backlog: number; rituals: number;
    /** "Tareas Pendientes / Roadmap Inmediato" de MEMORY.md */
    immediate: string[];
    byNote: Array<{ path: string; name: string; tasks: string[] }>;
  };
  feed: { log: string | null; logStale: boolean; daily: string | null; decision: string | null; inbox: number | null };
  recent: Array<{ path: string; name: string; ago: string }>;
  projects: AxsProject[];
}

const STATUS_ORDER: Record<string, number> = { Activo: 0, Planificado: 1, Concepto: 2, Histórico: 3 };

export function buildAxsDashboard(idx: VaultIndex, now = Date.now()): AxsDashboardData {
  const issues = lintVault(idx);
  const s = summarize(issues);
  const notes = [...idx.notes.values()];
  const real = notes.filter((n) => n.size > 0 && n.path !== "CLAUDE.md" && n.path !== "MEMORY.md");
  const lastMs = real.length ? Math.max(...real.map((n) => n.mtimeMs)) : now;

  const areas = new Map<string, number>();
  for (const n of notes) areas.set(n.area, (areas.get(n.area) ?? 0) + 1);

  const t = openTasks(idx);
  const immediate = immediateRoadmap(idx);
  const rituals = t.rituals.reduce((a, r) => a + r.open, 0);
  const byNoteMap = new Map<string, string[]>();
  for (const x of t.backlog) byNoteMap.set(x.path, [...(byNoteMap.get(x.path) ?? []), x.text.slice(0, 160)]);

  const f = feedState(idx, now);
  const inbox = inboxItems(idx);
  const attention: string[] = [];
  if (s.errors) attention.push(`${s.errors} error(es) en la bóveda`);
  if (f.log && f.log.days > 7) attention.push(`el log del sistema lleva ${agoText(f.log.days).replace("hace ", "")} sin actualizarse`);
  if (inbox) attention.push(`${inbox} elemento(s) en el Inbox`);
  if (immediate.length) attention.push(`${immediate.length} tarea(s) inmediata(s) en MEMORY.md`);
  if (s.warns) attention.push(`${s.warns} aviso(s) de salud de la bóveda`);

  const projects: AxsProject[] = notes
    .filter((n) => n.path !== "CLAUDE.md" && n.path !== "MEMORY.md")
    .map((n) => ({
      path: n.path, name: n.name, area: n.area, areaLabel: areaLabel(n.area),
      status: n.frontmatter?.status ?? "sin status", tier: n.frontmatter?.tier ?? "",
      openTasks: n.tasks.filter((x) => !x.done).length, tasks: n.tasks.length,
      ago: agoText(daysAgo(n.mtimeMs, now)), mtimeMs: n.mtimeMs, tags: n.tags.slice(0, 4),
    }))
    .sort((a, b) => Number(!a.area) - Number(!b.area) || a.area.localeCompare(b.area) || (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.name.localeCompare(b.name));

  return {
    generatedAt: new Date(now).toISOString(),
    vault: {
      notes: idx.notes.size, lastActivity: agoText(daysAgo(lastMs, now)),
      areas: [...areas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([area, n]) => ({ area, label: areaLabel(area), notes: n })),
    },
    health: {
      light: s.light, errors: s.errors, warns: s.warns,
      top: issues.filter((i) => i.severity !== "info").slice(0, 5).map((i) => ({ label: issueLabel(i.code), path: i.path })),
    },
    attention,
    pending: {
      backlog: t.backlog.length, rituals, immediate,
      byNote: [...byNoteMap.entries()].map(([path, tasks]) => ({ path, name: path.split("/").pop()!.replace(/\.md$/, ""), tasks: tasks.slice(0, 12) })),
    },
    feed: {
      log: f.log ? `${f.log.date} (${agoText(f.log.days)})` : null, logStale: !!f.log && f.log.days > 7,
      daily: f.daily ? `${f.daily.date} (${agoText(f.daily.days)})` : null,
      decision: f.decision ? `${f.decision.date} (${agoText(f.decision.days)})` : null,
      inbox,
    },
    recent: real.filter((n) => n.area !== "90-99 Archivo").sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 6)
      .map((n) => ({ path: n.path, name: n.name, ago: agoText(daysAgo(n.mtimeMs, now)) })),
    projects,
  };
}
