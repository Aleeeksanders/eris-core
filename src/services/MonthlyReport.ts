// ============================================================
// Eris — El informe del mes para tu control médico (fase 1: el cálculo, 2026-11-15)
//
// Es lo que paga Eris completo para la gente con condiciones crónicas: el mes resumido para llevárselo al doctor.
// Puro: recibe lo que guarda el servidor (historial diario, perfil médico, metas, suplementos y check-ins) y devuelve
// cifras y patrones calculados por código. Nunca diagnostica ni sugiere dosis: Eris cuida, no trata.
// Lo que no tiene datos no se inventa: va a `faltan`, dicho con claridad.
// ============================================================
import { CONDITION_LABELS, type DailyRollupEntry, type MedicalProfile } from "../memory.js";

export interface MetasInforme {
  kcal?: number | null;
  proteinG?: number | null;
  /** con enfermedad renal la proteína es un tope, no una meta */
  proteinIsCap?: boolean;
  waterL?: number | null;
  /** sin meta de agua (enfermedad renal o insuficiencia cardíaca): el límite lo define su especialista */
  waterOff?: boolean;
  waterNote?: string;
}

export interface SuplementoEstado {
  items?: Array<{ id: string; nombre: string; tomasDia?: number; activo?: boolean; creado?: string }>;
  /** día (YYYY-MM-DD) → id → tomas anotadas */
  log?: Record<string, Record<string, number>>;
}

export interface InformeEntrada {
  /** 'YYYY-MM': el mes calendario (si es el mes en curso, hasta ayer) */
  mes?: string;
  /** o un rango explícito (YYYY-MM-DD, ambos incluidos) */
  desde?: string;
  hasta?: string;
  /** YYYY-MM-DD local */
  hoy: string;
  rollup: DailyRollupEntry[];
  medical?: MedicalProfile | null;
  metas?: MetasInforme | null;
  suplementos?: SuplementoEstado | null;
  checkins?: Array<{ day?: string; estres?: number; foco?: number }> | null;
  pesoKg?: number | null;
}

export interface Informe {
  periodo: { desde: string; hasta: string; dias: number; diasConDatos: number; etiqueta: string };
  perfil: {
    condiciones: string[];
    remedios: Array<{ nombre: string; dosis?: string; horario?: string }>;
    examenes: Array<{ examen: string; valor: number; unidad: string; fecha?: string }>;
    restricciones: string[];
  };
  comida: null | { diasAnotados: number; kcalProm: number; kcalMeta?: number; protProm: number; protMeta?: number; protEsTope: boolean; carbProm?: number; grasaProm?: number; diasSobreTope?: number };
  agua: null | { dias: number; litrosProm: number; meta?: number; sinMeta: boolean; nota?: string; diasEnMeta?: number };
  sueno: null | { noches: number; horasProm: number; nocheProm?: number; nochesCortas: number; nochesLargas: number };
  movimiento: null | { diasConPasos: number; pasosProm?: number; diasBajo5000?: number; diasEntrenados: number; pulsoProm?: number; pulsoAntes?: number; pulsoDespues?: number };
  animo: null | { registros: number; promedio?: number; estresProm?: number; focoProm?: number; checkins: number };
  suplementos: null | Array<{ nombre: string; tomadas: number; programadas: number; pct: number }>;
  pesoKg?: number;
  paraConversar: string[];
  faltan: string[];
}

const LAB: Record<string, string> = {
  hba1c: "HbA1c", glucosa_ayunas: "Glucosa en ayunas", colesterol_total: "Colesterol total", ldl: "LDL", hdl: "HDL",
  trigliceridos: "Triglicéridos", creatinina: "Creatinina",
};
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const prom = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

function sumarDias(d: string, n: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return t.toISOString().slice(0, 10);
}
function diasEntre(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number); const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

/** El período: el mes pedido (si es el en curso, hasta ayer) o el rango explícito. */
export function periodoDe(e: Pick<InformeEntrada, "mes" | "desde" | "hasta" | "hoy">): { desde: string; hasta: string; etiqueta: string } | null {
  const ayer = sumarDias(e.hoy, -1);
  if (e.desde && e.hasta && DIA.test(e.desde) && DIA.test(e.hasta)) {
    const hasta = e.hasta > ayer ? ayer : e.hasta;
    if (hasta < e.desde) return null;
    const dm = (d: string) => `${Number(d.slice(8))} de ${MESES[Number(d.slice(5, 7)) - 1]}`;
    const etiqueta = e.desde.slice(0, 4) === hasta.slice(0, 4) ? `del ${dm(e.desde)} al ${dm(hasta)} de ${hasta.slice(0, 4)}` : `del ${dm(e.desde)} de ${e.desde.slice(0, 4)} al ${dm(hasta)} de ${hasta.slice(0, 4)}`;
    return { desde: e.desde, hasta, etiqueta };
  }
  const mes = e.mes && /^\d{4}-\d{2}$/.test(e.mes) ? e.mes : e.hoy.slice(0, 7);
  const [y, m] = mes.split("-").map(Number);
  const desde = `${mes}-01`;
  const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const hasta = fin > ayer ? ayer : fin;
  if (hasta < desde) return null;
  const etiqueta = `${MESES[m - 1]} de ${y}${hasta < fin ? ` (hasta el ${Number(hasta.slice(8))})` : ""}`;
  return { desde, hasta, etiqueta };
}

export function armarInformeMes(e: InformeEntrada): Informe | null {
  const p = periodoDe(e);
  if (!p) return null;
  const enRango = (d?: string) => !!d && DIA.test(d) && d >= p.desde && d <= p.hasta;
  const dias = (e.rollup ?? []).filter((r) => enRango(r?.date)).sort((a, b) => a.date.localeCompare(b.date));
  const med = e.medical ?? null;
  const conds = new Set((med?.conditions ?? []).map((c) => c.id));
  const metas = e.metas ?? {};
  const paraConversar: string[] = [];
  const faltan: string[] = [];

  // ── Perfil
  const perfil: Informe["perfil"] = {
    condiciones: (med?.conditions ?? []).map((c) => (c.id === "other" && c.notes ? c.notes : CONDITION_LABELS[c.id] ?? c.id)),
    remedios: (med?.medications ?? []).filter((m) => m.active !== false).map((m) => ({ nombre: m.name, dosis: m.dose || undefined, horario: m.schedule || undefined })),
    examenes: [],
    restricciones: [...(med?.dietaryRestrictions ?? [])],
  };
  // El último de cada examen
  const ultimo = new Map<string, NonNullable<MedicalProfile["labs"]>[number]>();
  for (const l of med?.labs ?? []) {
    if (!l || !num(l.value)) continue;
    const prev = ultimo.get(l.test);
    if (!prev || (l.date ?? "") > (prev.date ?? "")) ultimo.set(l.test, l);
  }
  perfil.examenes = [...ultimo.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).map((l) => ({ examen: LAB[l.test] ?? l.test, valor: l.value, unidad: l.unit, fecha: l.date }));

  // ── Comida
  const anotados = dias.filter((d) => num(d.calories) && d.calories! > 0);
  let comida: Informe["comida"] = null;
  if (anotados.length) {
    const kcalProm = Math.round(prom(anotados.map((d) => d.calories!)));
    const prots = anotados.filter((d) => num(d.proteinG)).map((d) => d.proteinG!);
    const carbs = anotados.filter((d) => num(d.carbsG)).map((d) => d.carbsG!);
    const grasas = anotados.filter((d) => num(d.fatG)).map((d) => d.fatG!);
    const kcalMeta = num(metas.kcal) && metas.kcal! > 0 ? Math.round(metas.kcal!) : undefined;
    const protMeta = num(metas.proteinG) && metas.proteinG! > 0 ? Math.round(metas.proteinG!) : undefined;
    const protEsTope = !!metas.proteinIsCap;
    comida = {
      diasAnotados: anotados.length, kcalProm, kcalMeta, protProm: Math.round(prom(prots)), protMeta, protEsTope,
      carbProm: carbs.length ? Math.round(prom(carbs)) : undefined, grasaProm: grasas.length ? Math.round(prom(grasas)) : undefined,
    };
    // Sin comparar día a día con la meta de energía: cambia cada día (entreno, descanso, actividad) y el historial no guarda
    // la de cada día; compararlo con la de hoy diría cosas falsas. Va solo como referencia («tu meta actual»).
    if (protEsTope && protMeta) {
      comida.diasSobreTope = anotados.filter((d) => num(d.proteinG) && d.proteinG! > protMeta).length;
      if (comida.diasSobreTope > 0) paraConversar.push(`En ${comida.diasSobreTope} de ${anotados.length} días la proteína pasó tu tope de ${protMeta} g.`);
    }
  } else faltan.push("Comida: no hay días anotados con calorías en este período.");

  // ── Agua
  const conAgua = dias.filter((d) => num(d.hydrationL) && d.hydrationL! > 0);
  let agua: Informe["agua"] = null;
  if (conAgua.length) {
    const litrosProm = r1(prom(conAgua.map((d) => d.hydrationL!)));
    const sinMeta = !!metas.waterOff || conds.has("ckd") || conds.has("heart_failure");
    const meta = !sinMeta && num(metas.waterL) && metas.waterL! > 0 ? r1(metas.waterL!) : undefined;
    agua = { dias: conAgua.length, litrosProm, meta, sinMeta, nota: metas.waterNote || undefined };
    if (sinMeta) {
      paraConversar.push(`Tomaste en promedio ${fmt(litrosProm, Number.isInteger(litrosProm) ? 0 : 1)} L al día (${conAgua.length} ${conAgua.length === 1 ? "día" : "días"} con registro). Tu límite lo define tu especialista: muéstrale esta cifra.`);
    } else if (meta) {
      agua.diasEnMeta = conAgua.filter((d) => d.hydrationL! >= meta * 0.9).length;
      if (conAgua.length >= 7 && agua.diasEnMeta / conAgua.length < 0.5) paraConversar.push(`Llegaste a tu meta actual de agua (${fmt(meta, Number.isInteger(meta) ? 0 : 1)} L) ${agua.diasEnMeta} de ${conAgua.length} días.`);
    }
  } else faltan.push("Agua: no hay días con agua anotada en este período.");

  // ── Sueño (16 h o más en un día no es creíble: dos días sumados)
  const noches = dias.filter((d) => num(d.sleepHours) && d.sleepHours! > 0 && d.sleepHours! < 16);
  let sueno: Informe["sueno"] = null;
  if (noches.length) {
    const nocheH = noches.filter((d) => num(d.sleepNightHours) && d.sleepNightHours! > 0).map((d) => d.sleepNightHours!);
    sueno = {
      noches: noches.length, horasProm: r1(prom(noches.map((d) => d.sleepHours!))), nocheProm: nocheH.length ? r1(prom(nocheH)) : undefined,
      nochesCortas: noches.filter((d) => (num(d.sleepNightHours) ? d.sleepNightHours! : d.sleepHours!) < 6).length,
      nochesLargas: noches.filter((d) => d.sleepHours! >= 10).length,
    };
    if (noches.length >= 7 && sueno.nochesCortas >= 3) paraConversar.push(`${sueno.nochesCortas} de ${noches.length} noches dormiste menos de 6 horas.`);
  } else faltan.push("Sueño: no hay noches registradas en este período.");

  // ── Movimiento y pulso
  const conPasos = dias.filter((d) => num(d.steps) && d.steps! > 0);
  const conPulso = dias.filter((d) => num(d.restingHR) && d.restingHR! > 25 && d.restingHR! < 150);
  const entrenados = dias.filter((d) => d.trained === true).length;
  let movimiento: Informe["movimiento"] = null;
  if (conPasos.length || conPulso.length || entrenados) {
    movimiento = { diasConPasos: conPasos.length, diasEntrenados: entrenados };
    if (conPasos.length) {
      movimiento.pasosProm = Math.round(prom(conPasos.map((d) => d.steps!)));
      movimiento.diasBajo5000 = conPasos.filter((d) => d.steps! < 5000).length;
      if (conPasos.length >= 7 && movimiento.pasosProm < 5000) paraConversar.push(`Caminaste en promedio ${fmt(movimiento.pasosProm)} pasos al día.`);
    }
    if (conPulso.length) {
      movimiento.pulsoProm = Math.round(prom(conPulso.map((d) => d.restingHR!)));
      if (conPulso.length >= 8) {
        const mitad = Math.floor(conPulso.length / 2);
        const a = Math.round(prom(conPulso.slice(0, mitad).map((d) => d.restingHR!)));
        const b = Math.round(prom(conPulso.slice(mitad).map((d) => d.restingHR!)));
        movimiento.pulsoAntes = a; movimiento.pulsoDespues = b;
        if (Math.abs(b - a) >= 5) paraConversar.push(`Tu pulso en reposo ${b > a ? "subió" : "bajó"} de ${a} a ${b} latidos por minuto entre la primera y la segunda mitad del período.`);
      }
    }
  } else faltan.push("Movimiento: no hay pasos, pulso ni entrenos registrados en este período.");

  // ── Ánimo
  const conAnimo = dias.filter((d) => num(d.moodScore) && d.moodScore! >= 1 && d.moodScore! <= 5);
  const checks = (e.checkins ?? []).filter((c) => enRango(c?.day));
  let animo: Informe["animo"] = null;
  if (conAnimo.length || checks.length) {
    const est = checks.filter((c) => num(c.estres)).map((c) => c.estres!);
    const foc = checks.filter((c) => num(c.foco)).map((c) => c.foco!);
    animo = {
      registros: conAnimo.length, promedio: conAnimo.length ? r1(prom(conAnimo.map((d) => d.moodScore!))) : undefined, checkins: checks.length,
      estresProm: est.length ? r1(prom(est)) : undefined, focoProm: foc.length ? r1(prom(foc)) : undefined,
    };
    if (conAnimo.length >= 5 && animo.promedio! <= 2.5) paraConversar.push(`Tu ánimo promedio fue ${fmt(animo.promedio!, Number.isInteger(animo.promedio!) ? 0 : 1)} de 5 (${conAnimo.length} registros): puede servir conversarlo.`);
  }

  // ── Suplementos (las tomas anotadas, frente a las que tocaban desde que lo agregaste)
  let suplementos: Informe["suplementos"] = null;
  const items = (e.suplementos?.items ?? []).filter((it) => it && it.activo !== false && num(it.tomasDia) && it.tomasDia! > 0);
  if (items.length) {
    suplementos = items.map((it) => {
      const inicio = it.creado && DIA.test(it.creado.slice(0, 10)) && it.creado.slice(0, 10) > p.desde ? it.creado.slice(0, 10) : p.desde;
      const programadas = inicio > p.hasta ? 0 : diasEntre(inicio, p.hasta) * it.tomasDia!;
      let tomadas = 0;
      for (const [dia, porId] of Object.entries(e.suplementos?.log ?? {})) if (enRango(dia) && dia >= inicio) tomadas += num(porId?.[it.id]) ? porId[it.id] : 0;
      tomadas = Math.min(tomadas, programadas);
      return { nombre: it.nombre, tomadas, programadas, pct: programadas ? Math.round((tomadas / programadas) * 100) : 0 };
    }).filter((s) => s.programadas > 0);
    for (const s of suplementos) if (s.programadas >= 7 && s.pct < 70) paraConversar.push(`${s.nombre}: anotaste ${s.tomadas} de ${s.programadas} tomas (${s.pct} %).`);
    if (!suplementos.length) suplementos = null;
  }

  // ── Lo que el informe no puede mostrar todavía (dicho, no inventado)
  if (perfil.remedios.length) faltan.push("Remedios: las tomas se anotan en el teléfono y todavía no llegan a este informe.");
  if (conds.has("diabetes_t1") || conds.has("diabetes_t2") || conds.has("prediabetes")) faltan.push("Glucosa: el módulo está apagado hasta tener el visto bueno de salud.");
  if (conds.has("hypertension")) faltan.push("Presión arterial: Eris todavía no la registra.");

  const diasConDatos = dias.filter((d) => Object.keys(d).some((k) => !["date", "updatedAt", "plata", "ahorroAcum", "savingsRate", "disponible"].includes(k))).length;
  return {
    periodo: { desde: p.desde, hasta: p.hasta, dias: diasEntre(p.desde, p.hasta), diasConDatos, etiqueta: p.etiqueta },
    perfil, comida, agua, sueno, movimiento, animo, suplementos,
    pesoKg: num(e.pesoKg) && e.pesoKg! > 0 ? r1(e.pesoKg!) : undefined,
    paraConversar, faltan,
  };
}

/** Números como en Chile: coma decimal y punto de miles. */
export function fmt(n: number, dec = 0): string {
  const [ent, frac] = Math.abs(n).toFixed(dec).split(".");
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "-" : ""}${miles}${frac ? `,${frac}` : ""}`;
}

/** Con un decimal, pero sin «,0» cuando es entero (78 kg, 7,5 h). */
const f1 = (n: number) => fmt(n, Number.isInteger(Math.round(n * 10) / 10) ? 0 : 1);
/** «1 día», «2 días». */
const pl = (n: number, uno: string, varios: string) => `${fmt(n)} ${n === 1 ? uno : varios}`;

const fecha = (d?: string) => (d && DIA.test(d) ? `${Number(d.slice(8))} de ${MESES[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}` : d ?? "sin fecha");

/** El informe en texto (para el chat y como base del PDF). */
export function informeEnTexto(inf: Informe, nombre?: string): string {
  const L: string[] = [];
  L.push(`📋 **Informe para tu control médico${nombre ? ` · ${nombre}` : ""}**`);
  L.push(`${inf.periodo.etiqueta[0].toUpperCase()}${inf.periodo.etiqueta.slice(1)} · ${inf.periodo.diasConDatos} de ${pl(inf.periodo.dias, "día", "días")} con datos`);
  const pf = inf.perfil;
  if (pf.condiciones.length || pf.remedios.length || pf.examenes.length) {
    L.push("", "**Tu perfil**");
    if (pf.condiciones.length) L.push(`- Condiciones: ${pf.condiciones.join(", ")}`);
    for (const r of pf.remedios) L.push(`- ${r.nombre}${r.dosis ? `, ${r.dosis}` : ""}${r.horario ? ` (${r.horario})` : ""}`);
    for (const x of pf.examenes) L.push(`- ${x.examen}: ${fmt(x.valor, x.valor % 1 ? 1 : 0)} ${x.unidad} (${fecha(x.fecha)})`);
    if (pf.restricciones.length) L.push(`- Restricciones de comida: ${pf.restricciones.join(", ").replace(/_/g, " ")}`);
  }
  if (inf.comida) {
    const c = inf.comida;
    L.push("", "**Comida**", `- ${pl(c.diasAnotados, "día anotado", "días anotados")}`);
    L.push(`- Energía: ${fmt(c.kcalProm)} kcal al día${c.kcalMeta ? ` (tu meta actual: ${fmt(c.kcalMeta)})` : ""}`);
    L.push(`- Proteína: ${fmt(c.protProm)} g al día${c.protMeta ? ` (tu ${c.protEsTope ? "tope" : "meta actual"}: ${fmt(c.protMeta)} g)` : ""}`);
    if (c.carbProm != null || c.grasaProm != null) L.push(`- Carbohidratos: ${c.carbProm != null ? `${fmt(c.carbProm)} g` : "sin dato"} · Grasas: ${c.grasaProm != null ? `${fmt(c.grasaProm)} g` : "sin dato"} (promedio al día)`);
  }
  if (inf.agua) {
    const a = inf.agua;
    L.push("", "**Agua**", `- ${f1(a.litrosProm)} L al día en promedio (${pl(a.dias, "día", "días")} con registro)`);
    if (a.sinMeta) L.push(`- Sin meta de agua: ${a.nota ?? "tu límite lo define tu especialista"}`);
    else if (a.meta) L.push(`- Llegaste a tu meta actual (${f1(a.meta)} L) ${a.diasEnMeta ?? 0} de ${pl(a.dias, "día", "días")}`);
  }
  if (inf.sueno) {
    const s = inf.sueno;
    L.push("", "**Sueño**", `- ${f1(s.horasProm)} h al día en promedio${s.nocheProm != null ? `; de noche, ${f1(s.nocheProm)} h` : ""} (${pl(s.noches, "día", "días")})`);
    L.push(`- Noches de menos de 6 horas: ${s.nochesCortas}`);
  }
  if (inf.movimiento) {
    const m = inf.movimiento;
    L.push("", "**Movimiento**");
    if (m.pasosProm != null) L.push(`- ${fmt(m.pasosProm)} pasos al día en promedio (${pl(m.diasConPasos, "día", "días")}); ${pl(m.diasBajo5000 ?? 0, "día", "días")} bajo 5.000`);
    L.push(`- Días con entreno: ${m.diasEntrenados}`);
    if (m.pulsoProm != null) L.push(`- Pulso en reposo: ${m.pulsoProm} latidos por minuto en promedio${m.pulsoAntes != null ? ` (de ${m.pulsoAntes} a ${m.pulsoDespues})` : ""}`);
  }
  if (inf.animo) {
    const a = inf.animo;
    L.push("", "**Ánimo**");
    if (a.promedio != null) L.push(`- ${f1(a.promedio)} de 5 en promedio (${pl(a.registros, "registro", "registros")})`);
    if (a.checkins) L.push(`- ${a.checkins} check-in${a.checkins > 1 ? "s" : ""}${a.estresProm != null ? `: estrés ${f1(a.estresProm)}` : ""}${a.focoProm != null ? `, foco ${f1(a.focoProm)}` : ""}`);
  }
  if (inf.suplementos?.length) {
    L.push("", "**Suplementos**");
    for (const s of inf.suplementos) L.push(`- ${s.nombre}: ${s.tomadas} de ${s.programadas} tomas anotadas (${s.pct} %)`);
  }
  if (inf.pesoKg != null) L.push("", "**Peso**", `- ${f1(inf.pesoKg)} kg (el último registrado)`);
  if (inf.paraConversar.length) {
    L.push("", "**Para conversar con tu médico**");
    for (const x of inf.paraConversar) L.push(`- ${x}`);
  }
  if (inf.faltan.length) {
    L.push("", "**Lo que este informe no muestra**");
    for (const x of inf.faltan) L.push(`- ${x}`);
  }
  L.push("", "_Resume lo que anotaste y lo que midió tu reloj. No es un diagnóstico: las decisiones las tomas con tu médico._");
  return L.join("\n");
}
