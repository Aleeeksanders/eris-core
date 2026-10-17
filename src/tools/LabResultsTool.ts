// ============================================================
// Eris — LabResultsTool (lab_results)
//
// Exámenes que el usuario cuenta (HbA1c, glucosa en ayunas, colesterol…) quedan en su perfil con fecha. Antes no había
// dónde ponerlos: el 2026-10-07 el usuario contó que su HbA1c bajó de 12,2 % a 5,2 % y Eris lo trató como "glucosa",
// le advirtió hipoglucemia y calculó mal la baja. Eris cuida, no trata: guarda el dato y explica cómo leerlo con
// referencias generales; la meta y las decisiones son de su médico.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import type { LabResult, LabTest } from "../memory.js";
import { parseHba1c, eAG } from "../services/LabParse.js";

const TESTS = ["hba1c", "glucosa_ayunas", "colesterol_total", "ldl", "hdl", "trigliceridos", "creatinina"] as const;
const INFO: Record<LabTest, { label: string; unit: string; range: [number, number] }> = {
  hba1c: { label: "HbA1c (hemoglobina glicosilada)", unit: "%", range: [3, 20] },
  glucosa_ayunas: { label: "Glucosa en ayunas", unit: "mg/dL", range: [40, 600] },
  colesterol_total: { label: "Colesterol total", unit: "mg/dL", range: [50, 500] },
  ldl: { label: "Colesterol LDL", unit: "mg/dL", range: [20, 400] },
  hdl: { label: "Colesterol HDL", unit: "mg/dL", range: [10, 150] },
  trigliceridos: { label: "Triglicéridos", unit: "mg/dL", range: [20, 2000] },
  creatinina: { label: "Creatinina", unit: "mg/dL", range: [0.1, 20] },
};

const Item = z.object({
  test: z.enum(TESTS).describe("Qué examen. '12 % de glucosa en sangre' es HbA1c (la glucosa del momento nunca va en %)."),
  value: z.number().describe("El valor tal como lo dijo (5.2, 126…)"),
  date: z.string().optional().describe("Fecha del examen YYYY-MM-DD (o YYYY-MM). Si no la dijo, omítela; no la inventes."),
  note: z.string().optional(),
});
const Schema = z.object({
  action: z.enum(["add", "list", "delete"]).default("add"),
  results: z.array(Item).optional().describe("Para add: CADA valor con su fecha (ej. HbA1c 12.2 del 2025-11-01 y 5.2 del 2026-09-14)"),
  test: z.enum(TESTS).optional().describe("Para delete"),
  date: z.string().optional().describe("Para delete: la fecha del examen a borrar"),
});
type Input = z.infer<typeof Schema>;

const human = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : d && /^\d{4}-\d{2}$/.test(d) ? `${d.slice(5)}-${d.slice(0, 4)}` : "sin fecha");
const num = (v: number) => String(v).replace(".", ",");

/** Cómo leer una HbA1c, con referencias generales (no un diagnóstico). */
export function hba1cReading(v: number): string {
  return `HbA1c ${num(v)} % = promedio de glucosa de los últimos ~3 meses (≈ ${eAG(v)} mg/dL). Referencias generales: bajo 5,7 % es el rango ` +
    `de una persona sin diabetes; 5,7–6,4 % prediabetes; 6,5 % o más, diabetes. Con diabetes, la meta habitual es bajo 7 % y la ` +
    `define su médico. NO indica la glucosa del momento ni sirve para hablar de hipoglucemia.`;
}

/** Líneas cortas de los exámenes (más reciente primero) para el contexto de Eris. */
export function labsSummary(labs: LabResult[] | undefined): string {
  if (!labs?.length) return "";
  const byTest = new Map<string, LabResult[]>();
  for (const l of labs) byTest.set(l.test, [...(byTest.get(l.test) ?? []), l]);
  const parts: string[] = [];
  for (const [test, list] of byTest) {
    const sorted = [...list].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    const info = INFO[test as LabTest];
    const [last, ...prev] = sorted;
    parts.push(`${info?.label ?? test}: ${num(last.value)} ${last.unit} (${human(last.date)})${prev.length ? `; antes ${prev.slice(0, 2).map((p) => `${num(p.value)} ${p.unit} (${human(p.date)})`).join(", ")}` : ""}`);
  }
  return parts.join(" · ");
}

export class LabResultsTool extends Tool<Input> {
  readonly name = "lab_results";
  readonly description =
    "Guarda en el perfil los resultados de exámenes que el usuario cuenta: HbA1c / hemoglobina glicosilada (en %), glucosa en ayunas, " +
    "colesterol, LDL, HDL, triglicéridos, creatinina. Registra CADA valor con su fecha (si la dijo). Un '% de glucosa en sangre' " +
    "es HbA1c. 'list' muestra lo guardado; 'delete' borra uno. Eris explica cómo leerlos con referencias generales; la meta la define su médico.";
  readonly inputSchema = Schema;

  /** "Mi HbA1c bajó de 12,2 % a 5,2 %": se guarda por código y el modelo responde con el dato ya guardado. */
  async preroute(message: string): Promise<Record<string, unknown> | null> {
    const found = parseHba1c(message);
    return found ? { action: "add", results: found } : null;
  }

  async execute(input: Input, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    if (!memory) return { output: "", error: "No hay memoria activa en este contexto." };
    const profile = (await memory.getProfile?.().catch(() => null)) || { displayName: "" };
    const labs: LabResult[] = Array.isArray(profile.medical?.labs) ? [...profile.medical.labs] : [];

    if (input.action === "list") {
      return { output: labs.length ? labsSummary(labs) : "No hay exámenes guardados en el perfil." };
    }

    const save = async (next: LabResult[], what: string) => {
      const medical = profile.medical ?? { conditions: [], medications: [], thresholds: { glucoseLow: 70, glucoseHigh: 180, glucoseUrgentLow: 55, glucoseUrgentHigh: 250 } };
      const updated = { ...profile, medical: { ...medical, labs: next } };
      await memory.saveProfile(updated);
      try {
        const log: any[] = (await memory.get("profile_change_log").catch(() => null)) || [];
        log.push({ at: new Date().toISOString(), changed: ["medical.labs"], before: { labs: profile.medical?.labs ?? [] }, note: what });
        await memory.set("profile_change_log", log.slice(-30));
      } catch {}
      try { context?.wsClient?.send?.(JSON.stringify({ type: "profile_updated", profile: updated })); } catch {}
    };

    if (input.action === "delete") {
      const next = labs.filter((l) => !(l.test === input.test && (!input.date || l.date === input.date)));
      if (next.length === labs.length) return { output: "No encontré ese examen en el perfil." };
      await save(next, "borrado de examen");
      return { output: `Listo, borré ${INFO[input.test as LabTest]?.label ?? "ese examen"}${input.date ? ` del ${human(input.date)}` : ""}.` };
    }

    const items = input.results ?? [];
    if (!items.length) return { output: "", error: "Faltan los resultados: pregúntale el valor (y la fecha del examen, si la sabe)." };
    const added: LabResult[] = [];
    const rejected: string[] = [];
    for (const it of items) {
      const info = INFO[it.test];
      if (!(it.value >= info.range[0] && it.value <= info.range[1])) { rejected.push(`${info.label} ${it.value} (fuera de rango)`); continue; }
      const date = it.date && /^\d{4}-\d{2}(-\d{2})?$/.test(it.date) ? it.date : undefined;
      const entry: LabResult = { test: it.test, value: it.value, unit: info.unit, ...(date ? { date } : {}), ...(it.note ? { note: it.note } : {}), addedAt: new Date().toISOString() };
      // El mismo examen de la misma fecha se reemplaza (no se duplica si lo vuelve a contar)
      const i = labs.findIndex((l) => l.test === entry.test && (l.date ?? "") === (entry.date ?? "") && (entry.date || l.value === entry.value));
      if (i >= 0) labs[i] = entry; else labs.push(entry);
      added.push(entry);
    }
    if (!added.length) return { output: "", error: `No guardé nada: ${rejected.join("; ")}.` };
    await save(labs, "exámenes agregados");
    const list = added.map((a) => `${INFO[a.test].label} ${num(a.value)} ${a.unit} (${human(a.date)})`).join(" y ");
    const a1c = added.filter((a) => a.test === "hba1c").sort((x, y) => String(y.date ?? "").localeCompare(String(x.date ?? "")))[0];
    const trend = added.filter((a) => a.test === "hba1c" && a.date).length === 2
      ? (() => { const [o, n] = added.filter((a) => a.test === "hba1c").sort((x, y) => String(x.date).localeCompare(String(y.date))); const diff = Math.round((n.value - o.value) * 10) / 10; return ` Cambio: ${diff > 0 ? "+" : ""}${num(diff)} puntos (de ${num(o.value)} % a ${num(n.value)} %).`; })()
      : "";
    return {
      output: `Guardado en tu perfil: ${list}.${trend}${rejected.length ? ` (No guardé: ${rejected.join("; ")}.)` : ""}` +
        (a1c ? `\n[Cómo leerlo] ${hba1cReading(a1c.value)}` : "") +
        "\n[Para ti] Confírmale en una frase qué guardaste y, si viene al caso, cómo leerlo. No hables de hipoglucemia por una HbA1c.",
    };
  }
}
