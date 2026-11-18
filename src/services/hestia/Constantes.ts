// ============================================================
// Hestia como JARVIS · L1 (2026-11-17): «Hestia, mis constantes» (IM2: la toxicidad medida cada día). Pocas cifras y su tendencia,
// todas por código y de lo que Eris ya calcula: el sueño (deuda de 2 semanas y regularidad: SleepCore), los músculos (Forge:
// forgeRecovery, puesto al día con la hora de ahora), el agua y la proteína a esta hora (WaterToday y lo comido), la plata del mes
// (solo Hestia; nunca con el teléfono bloqueado sin desbloquear) y los días entrenados en la semana.
// Corto para la voz (lo más importante primero) y el detalle en la pantalla.
// ============================================================
import { gatherMetabolicContext } from "../MetabolicAnalysis.js";
import { getProjection, type RecoveryContext } from "../TrainingIntent.js";
import { waterToday } from "../WaterToday.js";
import { moduloOn } from "../AutoPrefs.js";

const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** «mis constantes», «dame las constantes», «cómo están mis constantes», «signos vitales» */
export function pideConstantes(texto: string): boolean {
  const t = fold(texto).replace(/^\s*h?estia[\s,.:]*/, "");
  return /\b(mis|tus|dame( las)?|reporte de( las)?|estado de( las)?|como (estan|van|vienen)( las)?)\s+(mis\s+)?constantes\b/.test(t) || /^\s*constantes\s*[?!.]*$/.test(t)
    || /\bmis\s+signos\s+vitales\b/.test(t);
}

export interface DatosConstantes {
  trato?: string | null;
  sueno: { debtH: number; need: number; nights: number; regularity: string | null; trendMinPerDay: number | null; avgTotalH: number | null } | null;
  /** los músculos que vienen cargados (con la hora de ahora) y los que están por volver */
  musculos: { cargados: string[]; probables: string[] } | null;
  agua: { totalL: number; goalL: number; state: string | null; toCatchUp: number } | null;
  proteina: { comida: number; meta: number } | null;
  plata: { libre: number | null; porDia: number | null } | null;
  entrenosSemana: number | null;
}

const dec = (n: number) => (Math.round(n * 10) / 10).toLocaleString("es-CL");
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);
const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
/** «$128.500» → «128 mil» para decirlo (Hablar.ts ya lee las cifras; esto lo acorta) */
const milesDicho = (n: number) => (Math.abs(n) >= 10_000 ? `${Math.round(n / 1000).toLocaleString("es-CL")} mil pesos` : `${Math.round(n).toLocaleString("es-CL")} pesos`);

/** Los músculos de la proyección de Forge, puestos al día: «hace 30 h» cuando se calculó → ahora son más */
export function musculosAhora(rec: RecoveryContext | null | undefined, calculadoEn: string | null | undefined, ahora: Date): DatosConstantes["musculos"] {
  if (!rec?.musculos?.length) return null;
  const extra = calculadoEn && !Number.isNaN(Date.parse(calculadoEn)) ? Math.max(0, (ahora.getTime() - Date.parse(calculadoEn)) / 3_600_000) : 0;
  const cargados: string[] = [], probables: string[] = [];
  for (const m of rec.musculos) {
    if (!Array.isArray(m.range) || m.hoursAgo == null) continue;
    const h = m.hoursAgo + extra;
    if (h < m.range[0]) cargados.push(m.nombre.toLowerCase());
    else if (h < m.range[1]) probables.push(m.nombre.toLowerCase());
  }
  return { cargados: cargados.slice(0, 3), probables: probables.slice(0, 3) };
}

/** Días distintos entrenados desde el lunes (los últimos días de Forge) */
export function entrenosDeLaSemana(dias: Array<{ day: string }> | null | undefined, ahora: Date): number | null {
  if (!Array.isArray(dias)) return null;
  const lunes = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - ((ahora.getDay() + 6) % 7));
  const desde = `${lunes.getFullYear()}-${String(lunes.getMonth() + 1).padStart(2, "0")}-${String(lunes.getDate()).padStart(2, "0")}`;
  return new Set(dias.map((d) => d?.day).filter((d): d is string => typeof d === "string" && d >= desde)).size;
}

/** Lo dicho (corto, lo más importante primero) y el detalle para la pantalla */
export function armarConstantes(d: DatosConstantes): { voz: string; detalle: string } {
  const voz: string[] = [`Tus constantes${d.trato ? `, ${d.trato}` : ""}.`];
  const det: string[] = ["**Tus constantes**"];
  const s = d.sueno;
  if (s && s.nights >= 3) {
    const deuda = s.debtH >= 1 ? `debes ${dec(s.debtH)} horas de sueño en dos semanas` : "sin deuda de sueño";
    const reg = s.regularity ? `, ${s.regularity}` : "";
    const tend = s.trendMinPerDay != null && Math.abs(s.trendMinPerDay) >= 10
      ? `; te duermes cada día ${Math.round(Math.abs(s.trendMinPerDay))} minutos más ${s.trendMinPerDay > 0 ? "tarde" : "temprano"}` : "";
    voz.push(`Sueño: ${deuda}${reg}${tend}.`);
    det.push(`😴 Sueño: ${s.debtH >= 1 ? `deuda de ${dec(s.debtH)} h en 14 días` : "sin deuda"} (necesitas ~${dec(s.need)} h${s.avgTotalH != null ? `, promedio ${dec(s.avgTotalH)} h` : ""})${s.regularity ? ` · ${s.regularity}` : ""}${tend ? ` · ${tend.slice(2)}` : ""}.`);
  } else det.push("😴 Sueño: faltan noches anotadas (al menos 3) para calcularlo.");
  const m = d.musculos;
  if (m) {
    const txt = m.cargados.length ? `${lista(m.cargados)} ${m.cargados.length > 1 ? "vienen" : "viene"} recién ${m.cargados.length > 1 ? "cargados" : "cargado"}${m.probables.length ? `; ${lista(m.probables)}, casi ${m.probables.length > 1 ? "listos" : "listo"}` : ""}`
      : m.probables.length ? `${lista(m.probables)}, casi ${m.probables.length > 1 ? "listos" : "listo"}; lo demás, listo` : "todo recuperado";
    voz.push(`Músculos: ${txt}.`);
    det.push(`🏋️ Músculos: ${txt} (estimación de Forge).`);
  }
  if (d.entrenosSemana != null) {
    voz.push(d.entrenosSemana === 0 ? "Esta semana aún no entrenas." : `Esta semana entrenaste ${d.entrenosSemana === 1 ? "1 día" : `${d.entrenosSemana} días`}.`);
    det.push(`📅 Entrenos esta semana: ${d.entrenosSemana}.`);
  }
  const a = d.agua;
  if (a) {
    const como = a.state === "cumplida" ? "meta cumplida" : (a.state === "algo_atras" || a.state === "atras") && a.toCatchUp > 0 ? "algo atrás" : "al día";
    voz.push(`Agua: ${dec(a.totalL)} de ${dec(a.goalL)} litros, ${como}.`);
    det.push(`💧 Agua: ${dec(a.totalL)} de ${dec(a.goalL)} L (${como} a esta hora).`);
  }
  const p = d.proteina;
  if (p && p.meta > 0) {
    voz.push(`Proteína: ${Math.round(p.comida)} de ${Math.round(p.meta)} gramos.`);
    det.push(`🥩 Proteína: ${Math.round(p.comida)} de ${Math.round(p.meta)} g.`);
  }
  const pl = d.plata;
  if (pl && pl.libre != null) {
    voz.push(pl.libre > 0 ? `Plata: te quedan ${milesDicho(pl.libre)} libres este mes${pl.porDia != null && pl.porDia > 0 ? `, unos ${milesDicho(pl.porDia)} por día` : ""}.`
      : "Plata: este mes ya no queda libre; lo que venga, mejor que sea lo necesario.");
    det.push(`💸 Libre este mes: ${clp(pl.libre)}${pl.porDia != null && pl.porDia > 0 ? ` (${clp(pl.porDia)} por día)` : ""}.`);
  }
  if (voz.length === 1) voz.push("Todavía no tengo datos para medirlas: con el sueño, la comida y Forge al día, te las doy.");
  return { voz: voz.join(" "), detalle: det.join("\n") };
}

/** Junta los datos (todo del perfil; nada del modelo). `sinPlata`: teléfono bloqueado (K5) */
export async function datosConstantes(memory: any, o: { trato?: string | null; sinPlata?: boolean; ahora?: Date } = {}): Promise<DatosConstantes> {
  const ahora = o.ahora ?? new Date();
  const [ctx, proj, w] = await Promise.all([
    gatherMetabolicContext(memory, { now: ahora }).catch(() => null),
    getProjection(memory).catch(() => null),
    waterToday(memory, ahora).catch(() => null),
  ]);
  const si: any = ctx?.sleepInsights ?? null;
  const fin: any = !o.sinPlata && (await moduloOn(memory, "finanzas").catch(() => false)) ? await memory.get("financial_summary_latest").catch(() => null) : null;
  const finAt = fin?.at ? Date.parse(fin.at) : NaN;
  const finVigente = fin && Number.isFinite(finAt) && ahora.getTime() - finAt < 3 * 86_400_000; // (de hace más de 3 días ya no es «este mes» confiable)
  return {
    trato: o.trato ?? null,
    sueno: si && typeof si.debtH === "number" ? { debtH: si.debtH, need: si.need, nights: si.nights ?? 0, regularity: si.regularity ?? null, trendMinPerDay: si.trendMinPerDay ?? null, avgTotalH: si.avgTotalH ?? null } : null,
    musculos: musculosAhora(proj?.recovery, proj?.at, ahora),
    agua: w && w.goalL != null ? { totalL: w.totalL, goalL: w.goalL, state: w.pace?.state ?? null, toCatchUp: w.pace?.toCatchUp ?? 0 } : null,
    proteina: ctx?.goals?.protein ? { comida: ctx.eaten.protein, meta: ctx.goals.protein } : null,
    plata: finVigente ? { libre: typeof fin.libre === "number" ? fin.libre : null, porDia: typeof fin.porDia === "number" ? fin.porDia : null } : null,
    entrenosSemana: entrenosDeLaSemana(proj?.recent, ahora),
  };
}

/** L5: lo del cierre del día («protocolo dormir»): la comida contra la meta, el agua y si entrenaste hoy (Forge). Nada del modelo. */
export async function datosCierre(memory: any, ahora = new Date()): Promise<{ kcal: { comida: number; meta: number } | null; proteina: { comida: number; meta: number } | null; agua: { totalL: number; goalL: number } | null; entrenoHoy: boolean | null }> {
  const [ctx, proj, w] = await Promise.all([
    gatherMetabolicContext(memory, { now: ahora }).catch(() => null),
    getProjection(memory).catch(() => null),
    waterToday(memory, ahora).catch(() => null),
  ]);
  const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
  const dias = (proj as any)?.recent;
  return {
    kcal: ctx?.goals?.kcal ? { comida: ctx.eaten.kcal, meta: ctx.goals.kcal } : null,
    proteina: ctx?.goals?.protein ? { comida: ctx.eaten.protein, meta: ctx.goals.protein } : null,
    agua: w && w.goalL != null ? { totalL: w.totalL, goalL: w.goalL } : null,
    entrenoHoy: Array.isArray(dias) ? dias.some((d: any) => d?.day === hoy) : null,
  };
}
