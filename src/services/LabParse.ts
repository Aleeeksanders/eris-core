// ============================================================
// Eris — reconocer resultados de HbA1c en lo que cuenta el usuario
//
// 2026-10-07: "bajé de los 12.2% de glucosa en sangre del debut el 1 de noviembre del 2025 a 5.2%". Eso es la hemoglobina
// glicosilada (HbA1c, promedio de ~3 meses): la glucosa del momento nunca se mide en %. El modelo lo trató como "glucosa"
// y advirtió hipoglucemia por un 5,2 %. Acá se reconoce por código y se guarda como examen con su fecha (lab_results).
// ============================================================

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12,
};
const CONTEXT = /\b(hba1c|a1c|hemoglobina (glicosilada|glucosilada|glicada)|glicosilada|glucosilada|glicada|glucosa en (la )?sangre|glicemia|glucemia|glucosa)\b/;

export interface ParsedLab { test: "hba1c"; value: number; date?: string }

const pad = (n: number) => String(n).padStart(2, "0");

/** Fechas "14 de septiembre", "1 de noviembre del 2025" (sin año: la última vez que pasó esa fecha). */
export function datesIn(t: string, now = new Date()): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b(\\d{1,2}) de (${Object.keys(MONTHS).join("|")})(?:\\s+(?:de|del)\\s+(\\d{4}))?`, "g");
  for (const m of t.matchAll(re)) {
    const d = Number(m[1]), mo = MONTHS[m[2]];
    let y = m[3] ? Number(m[3]) : now.getFullYear();
    if (!m[3] && new Date(y, mo - 1, d).getTime() > now.getTime()) y -= 1;
    if (d >= 1 && d <= 31) out.push(`${y}-${pad(mo)}-${pad(d)}`);
  }
  return out;
}

/**
 * Valores de HbA1c (en %) del mensaje, con su fecha cuando se puede saber sin adivinar:
 * - un valor: la fecha, si hay una sola;
 * - dos valores ("bajé de X a Y"): el primero es el más antiguo; con dos fechas, se emparejan por orden cronológico;
 *   con una, va al más reciente.
 * Más de dos valores o algo raro: null (que lo resuelva el modelo con la herramienta).
 */
export function parseHba1c(message: unknown, now = new Date()): ParsedLab[] | null {
  if (typeof message !== "string" || message.length > 800) return null;
  const t = fold(message);
  if (!CONTEXT.test(t)) return null;
  const values = [...t.matchAll(/(\d{1,2}(?:[.,]\d{1,2})?)\s?%/g)].map((m) => Number(m[1].replace(",", "."))).filter((v) => v >= 3 && v <= 20);
  if (!values.length || values.length > 2) return null;
  // "glucosa" sola solo cuenta como HbA1c si el número viene en % (la glucosa del momento va en mg/dL)
  if (/\bmg\s?\/?\s?dl\b/.test(t)) return null;
  const dates = datesIn(t, now).sort();
  if (values.length === 1) return [{ test: "hba1c", value: values[0], ...(dates.length === 1 ? { date: dates[0] } : {}) }];
  if (dates.length === 2) return [{ test: "hba1c", value: values[0], date: dates[0] }, { test: "hba1c", value: values[1], date: dates[1] }];
  if (dates.length === 1) return [{ test: "hba1c", value: values[0] }, { test: "hba1c", value: values[1], date: dates[0] }];
  return [{ test: "hba1c", value: values[0] }, { test: "hba1c", value: values[1] }];
}

/** Glucosa promedio estimada (mg/dL) de una HbA1c: 28,7 × A1c − 46,7 (fórmula ADAG). */
export const eAG = (a1c: number) => Math.round(28.7 * a1c - 46.7);
