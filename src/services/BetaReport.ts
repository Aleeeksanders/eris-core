// ============================================================
// Eris — Informe de la beta (2026-11-11): de los conteos por día (services/BetaMetrics.ts) a lo que sirve para decidir.
//
//   · Cohortes por semana de alta: cuántos se activaron, cuántos vuelven al día 1, 7 y 30, y en la 2.ª y 5.ª semana.
//   · Cuántos días a la semana anotan comida, agua, sueño y entreno, y qué módulos usaron la primera semana.
//   · El chat: mensajes por persona, cuántos pasan por el modelo, por voz, tiempos de respuesta.
//   · El PC: segundos de modelo por día, hora punta, espera en cola, Whisper y Piper, y cuántas personas aguantaría.
//   · Quiénes pagan (los marca el administrador mientras no haya cobro en la app).
//   · Los parámetros del simulador del negocio (scripts/simulacion) con estos datos.
// Puro: no lee archivos. El equipo (rol ikaros o grupo «equipo») no entra en las cohortes pero sí en el uso del PC.
// ============================================================

import { SISTEMA, TRAMOS_S, type DiaUso, type PerfilUso } from "./BetaMetrics.js";

/** Activada: en sus primeras 48 horas anotó algo (comida, agua, sueño o entreno) e hizo al menos esto en la app. */
export const ACCIONES_ACTIVACION = 3;
/** Con menos personas que esto, el informe lo advierte: los porcentajes todavía cambian mucho con una persona más. */
export const MUESTRA_MINIMA = 20;

const DIA_MS = 86_400_000;
const aFecha = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const sumarDias = (d: string, n: number) => new Date(aFecha(d) + n * DIA_MS).toISOString().slice(0, 10);
const entre = (a: string, b: string) => Math.round((aFecha(b) - aFecha(a)) / DIA_MS);
const lunesDe = (d: string) => { const w = new Date(aFecha(d)).getUTCDay(); return sumarDias(d, -((w + 6) % 7)); };
const mediana = (xs: number[]) => { if (!xs.length) return null; const o = [...xs].sort((a, b) => a - b); const m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };
const pct = (n: number, d: number) => (d > 0 ? n / d : null);

export const diaActivo = (d?: DiaUso) => !!d && (d.acciones > 0 || d.mensajes > 0);
const anoto = (d?: DiaUso) => !!d && ((d.reg.comidas ?? 0) > 0 || (d.reg.aguaMl ?? 0) > 0 || (d.reg.sueno ?? 0) > 0 || (d.reg.entreno ?? 0) > 0);

export interface Retencion { n: number; vuelven: number; pct: number | null }
export interface FilaCohorte {
  semana: string;
  altas: number;
  activadas: number;
  d1: Retencion; d7: Retencion; d30: Retencion;
  /** Activos algún día de la 2.ª semana (días 7–13) y de la 5.ª (días 28–34): con pocas personas, más estable que un día exacto. */
  s2: Retencion; s5: Retencion;
}

export interface InformeBeta {
  hoy: string;
  personas: number;
  /** Personas del equipo que no entran en las cohortes. */
  equipo: number;
  fuera: number;
  muestraChica: boolean;
  cohortes: FilaCohorte[];
  total: Omit<FilaCohorte, "semana">;
  /** Mediana entre quienes estuvieron activos en las últimas 4 semanas: días por semana con ese registro. */
  diasPorSemana: { comida: number | null; agua: number | null; sueno: number | null; entreno: number | null; activos: number | null; personas: number };
  /** Qué parte de la cohorte usó cada cosa en su primera semana. */
  primeraSemana: Record<"chat" | "voz" | "comida" | "agua" | "sueno" | "entreno" | "finanzas" | "inventario" | "suplementos" | "plan", number | null>;
  /** Últimas 4 semanas, solo la cohorte. */
  chat: {
    mensajes: number; diasPersona: number; diasActivos: number;
    mensajesPorDia: number | null; mensajesPorDiaActivo: number | null;
    porModelo: number | null; voz: number | null;
    segundosModeloPorRespuesta: number | null;
    respuestaP50s: number | null; respuestaP90s: number | null;
  };
  /** Últimos 14 días, todos (cohorte, equipo y el servidor). */
  pc: {
    dias: number;
    modeloSegundosDia: number | null;
    /** Parte del trabajo del día que cae en la hora más cargada. */
    horaPunta: number | null; horaPuntaEs: number | null;
    esperaPromedioS: number | null;
    whisperSegundosDia: number | null; piperSegundosDia: number | null;
    personasActivasDia: number | null;
    /** Cuántas personas como estas aguantaría un PC sin pasar de la mitad de su uso en la hora punta. */
    personasPorPc: number | null;
  };
  pagan: { pagados: number; elegibles35: number; pagados35: number; conversion35: number | null };
  /** Para el simulador del negocio (scripts/simulacion/modelo.js), con los mismos nombres. null = sin datos aún. */
  simulador: { mensajesDia: number | null; fraccionModelo: number | null; segundosModelo: number | null; horaPunta: number | null; conversion: number | null; activosMes1: number | null };
}

function retencion(personas: Array<{ alta: string; dias: Record<string, DiaUso> }>, hoy: string, desde: number, hasta: number): Retencion {
  let n = 0, vuelven = 0;
  for (const p of personas) {
    if (entre(p.alta, hoy) < hasta) continue; // todavía no le llega ese día
    n++;
    for (let k = desde; k <= hasta; k++) if (diaActivo(p.dias[sumarDias(p.alta, k)])) { vuelven++; break; }
  }
  return { n, vuelven, pct: pct(vuelven, n) };
}

function fila(personas: Array<{ alta: string; dias: Record<string, DiaUso> }>, hoy: string): Omit<FilaCohorte, "semana"> {
  let activadas = 0;
  for (const p of personas) {
    const d0 = p.dias[p.alta], d1 = p.dias[sumarDias(p.alta, 1)];
    const acciones = (d0?.acciones ?? 0) + (d1?.acciones ?? 0);
    if ((anoto(d0) || anoto(d1)) && acciones >= ACCIONES_ACTIVACION) activadas++;
  }
  return {
    altas: personas.length, activadas,
    d1: retencion(personas, hoy, 1, 1), d7: retencion(personas, hoy, 7, 7), d30: retencion(personas, hoy, 30, 30),
    s2: retencion(personas, hoy, 7, 13), s5: retencion(personas, hoy, 28, 34),
  };
}

/** Percentil de un histograma por tramos (devuelve el borde superior del tramo, en segundos). */
function percentilTramos(tramos: Record<string, number>, q: number): number | null {
  const orden = [...TRAMOS_S.map(String), "mas"];
  const total = orden.reduce((s, t) => s + (tramos[t] ?? 0), 0);
  if (!total) return null;
  let acc = 0;
  for (const t of orden) {
    acc += tramos[t] ?? 0;
    if (acc >= q * total) return t === "mas" ? TRAMOS_S[TRAMOS_S.length - 1] * 2 : +t;
  }
  return null;
}

export function armarInforme(d: { perfiles: Record<string, PerfilUso>; dias: Record<string, Record<string, DiaUso>> }, hoy: string): InformeBeta {
  const cohorte: Array<{ alias: string; alta: string; p: PerfilUso; dias: Record<string, DiaUso> }> = [];
  let equipo = 0, fuera = 0;
  for (const [alias, p] of Object.entries(d.perfiles)) {
    if (alias === SISTEMA) continue;
    if (p.fuera) { fuera++; continue; }
    if (p.rol === "ikaros" || p.grupo === "equipo") { equipo++; continue; }
    if (p.alta > hoy) continue;
    cohorte.push({ alias, alta: p.alta, p, dias: d.dias[alias] ?? {} });
  }

  // ─── Cohortes por semana de alta ───
  const porSemana = new Map<string, typeof cohorte>();
  for (const c of cohorte) { const s = lunesDe(c.alta); (porSemana.get(s) ?? porSemana.set(s, []).get(s)!).push(c); }
  const cohortes = [...porSemana.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, ps]) => ({ semana, ...fila(ps, hoy) }));

  // ─── Últimas 4 semanas: días con registro y chat ───
  const desde28 = sumarDias(hoy, -27);
  const diasPorSemana = { comida: [] as number[], agua: [] as number[], sueno: [] as number[], entreno: [] as number[], activos: [] as number[] };
  let mensajes = 0, porModelo = 0, voz = 0, diasPersona = 0, diasActivos = 0, modeloChatMs = 0;
  const tramos: Record<string, number> = {};
  for (const c of cohorte) {
    const inicio = c.alta > desde28 ? c.alta : desde28;
    const n = entre(inicio, hoy) + 1;
    let activos = 0, comida = 0, agua = 0, sueno = 0, entreno = 0;
    for (let k = 0; k < n; k++) {
      const dia = c.dias[sumarDias(inicio, k)];
      diasPersona++;
      if (!dia) continue;
      if (diaActivo(dia)) { activos++; diasActivos++; }
      if ((dia.reg.comidas ?? 0) > 0) comida++;
      if ((dia.reg.aguaMl ?? 0) > 0) agua++;
      if ((dia.reg.sueno ?? 0) > 0) sueno++;
      if ((dia.reg.entreno ?? 0) > 0) entreno++;
      mensajes += dia.mensajes; porModelo += dia.porModelo; voz += dia.voz; modeloChatMs += dia.modelo.chat;
      for (const [t, v] of Object.entries(dia.tramos)) tramos[t] = (tramos[t] ?? 0) + v;
    }
    if (activos > 0 && n >= 1) {
      const semanas = Math.max(1, n / 7);
      diasPorSemana.comida.push(comida / semanas); diasPorSemana.agua.push(agua / semanas);
      diasPorSemana.sueno.push(sueno / semanas); diasPorSemana.entreno.push(entreno / semanas);
      diasPorSemana.activos.push(activos / semanas);
    }
  }
  const redondo = (x: number | null, dec = 1) => (x == null ? null : Math.round(x * 10 ** dec) / 10 ** dec);

  // ─── Primera semana: qué usaron ───
  const usaron = { chat: 0, voz: 0, comida: 0, agua: 0, sueno: 0, entreno: 0, finanzas: 0, inventario: 0, suplementos: 0, plan: 0 };
  let conSemana = 0;
  for (const c of cohorte) {
    if (entre(c.alta, hoy) < 6) continue;
    conSemana++;
    const u = new Set<keyof typeof usaron>();
    for (let k = 0; k < 7; k++) {
      const dia = c.dias[sumarDias(c.alta, k)];
      if (!dia) continue;
      if (dia.mensajes > 0) u.add("chat");
      if (dia.voz > 0) u.add("voz");
      if ((dia.reg.comidas ?? 0) > 0) u.add("comida");
      if ((dia.reg.aguaMl ?? 0) > 0) u.add("agua");
      if ((dia.reg.sueno ?? 0) > 0) u.add("sueno");
      if ((dia.reg.entreno ?? 0) > 0 || (dia.reg.forge ?? 0) > 0) u.add("entreno");
      if ((dia.reg.finanzas ?? 0) > 0) u.add("finanzas");
      if ((dia.reg.inventario ?? 0) > 0) u.add("inventario");
      if ((dia.reg.suplementos ?? 0) > 0) u.add("suplementos");
      if ((dia.reg.plan ?? 0) > 0) u.add("plan");
    }
    for (const k of u) usaron[k]++;
  }
  const primeraSemana = Object.fromEntries(Object.entries(usaron).map(([k, v]) => [k, redondo(pct(v, conSemana), 3)])) as InformeBeta["primeraSemana"];

  // ─── El PC: últimos 14 días, todos ───
  const desde14 = sumarDias(hoy, -13);
  let pcMs = 0, esperaMs = 0, llamadas = 0, whisperMs = 0, piperMs = 0, personasDia = 0;
  const horas: number[] = Array(24).fill(0);
  const diasConDatos = new Set<string>();
  for (const [alias, fila14] of Object.entries(d.dias)) {
    if (d.perfiles[alias]?.fuera) continue;
    for (const [dia, du] of Object.entries(fila14)) {
      if (dia < desde14 || dia > hoy) continue;
      const ms = du.modelo.chat + du.modelo.voz + du.modelo.lateral;
      if (ms > 0 || diaActivo(du)) diasConDatos.add(dia);
      pcMs += ms; esperaMs += du.esperaMs; llamadas += du.llamadas; whisperMs += du.whisperMs; piperMs += du.piperMs;
      for (const [h, v] of Object.entries(du.horas)) horas[+h] += v;
      if (alias !== SISTEMA && diaActivo(du)) personasDia++;
    }
  }
  const nDias = diasConDatos.size;
  const totalHoras = horas.reduce((a, b) => a + b, 0);
  const max = Math.max(...horas);
  const horaPunta = totalHoras > 0 ? max / totalHoras : null;
  const segundosDiaPorPersona = personasDia > 0 ? pcMs / 1000 / personasDia : null;
  // Mismo criterio que el simulador: en la hora punta no pasar de la mitad del PC (1.800 s de 3.600)
  const personasPorPc = segundosDiaPorPersona && horaPunta ? Math.floor(1800 / (segundosDiaPorPersona * horaPunta)) : null;

  // ─── Quiénes pagan ───
  const pagados = cohorte.filter((c) => c.p.grupo === "pagado");
  const elegibles35 = cohorte.filter((c) => entre(c.alta, hoy) >= 35);
  const pagados35 = elegibles35.filter((c) => c.p.grupo === "pagado" && c.p.pagoDesde && entre(c.alta, c.p.pagoDesde) <= 35);

  const total = fila(cohorte, hoy);
  const chat = {
    mensajes, diasPersona, diasActivos,
    mensajesPorDia: redondo(pct(mensajes, diasPersona), 2), mensajesPorDiaActivo: redondo(pct(mensajes, diasActivos), 2),
    porModelo: redondo(pct(porModelo, mensajes), 3), voz: redondo(pct(voz, mensajes), 3),
    segundosModeloPorRespuesta: porModelo > 0 ? redondo(modeloChatMs / 1000 / porModelo, 1) : null,
    respuestaP50s: percentilTramos(tramos, 0.5), respuestaP90s: percentilTramos(tramos, 0.9),
  };
  return {
    hoy, personas: cohorte.length, equipo, fuera, muestraChica: cohorte.length < MUESTRA_MINIMA,
    cohortes, total,
    diasPorSemana: {
      comida: redondo(mediana(diasPorSemana.comida)), agua: redondo(mediana(diasPorSemana.agua)),
      sueno: redondo(mediana(diasPorSemana.sueno)), entreno: redondo(mediana(diasPorSemana.entreno)),
      activos: redondo(mediana(diasPorSemana.activos)), personas: diasPorSemana.activos.length,
    },
    primeraSemana, chat,
    pc: {
      dias: nDias,
      modeloSegundosDia: nDias ? redondo(pcMs / 1000 / nDias, 0) : null,
      horaPunta: redondo(horaPunta, 3), horaPuntaEs: totalHoras > 0 ? horas.indexOf(max) : null,
      esperaPromedioS: llamadas ? redondo(esperaMs / 1000 / llamadas, 1) : null,
      whisperSegundosDia: nDias ? redondo(whisperMs / 1000 / nDias, 0) : null,
      piperSegundosDia: nDias ? redondo(piperMs / 1000 / nDias, 0) : null,
      personasActivasDia: nDias ? redondo(personasDia / nDias, 1) : null,
      personasPorPc,
    },
    pagan: { pagados: pagados.length, elegibles35: elegibles35.length, pagados35: pagados35.length, conversion35: redondo(pct(pagados35.length, elegibles35.length), 3) },
    simulador: {
      mensajesDia: chat.mensajesPorDia, fraccionModelo: chat.porModelo, segundosModelo: chat.segundosModeloPorRespuesta,
      horaPunta: redondo(horaPunta, 3), conversion: redondo(pct(pagados35.length, elegibles35.length), 3), activosMes1: redondo(total.s5.pct, 3),
    },
  };
}

/** El informe en texto, para la terminal (scripts/beta/informe.ts). */
export function informeEnTexto(r: InformeBeta): string {
  const p = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)} %`);
  const ret = (x: Retencion) => (x.n ? `${p(x.pct)} (${x.vuelven}/${x.n})` : "—");
  const n = (x: number | null, u = "") => (x == null ? "—" : `${String(x).replace(".", ",")}${u}`);
  const l: string[] = [];
  l.push(`Beta de Eris · ${r.hoy}`);
  l.push(`${r.personas} personas en la beta · ${r.equipo} del equipo (no cuentan) · ${r.fuera} sin medición`);
  if (r.muestraChica) l.push(`Ojo: con menos de ${MUESTRA_MINIMA} personas, cada porcentaje cambia mucho con una persona más.`);
  l.push("");
  l.push("Semana de alta | Altas | Activadas | Día 1 | Día 7 | Día 30 | Semana 2 | Semana 5");
  for (const c of [...r.cohortes, { semana: "Total", ...r.total }]) {
    l.push(`${c.semana} | ${c.altas} | ${c.activadas} (${p(pct(c.activadas, c.altas))}) | ${ret(c.d1)} | ${ret(c.d7)} | ${ret(c.d30)} | ${ret(c.s2)} | ${ret(c.s5)}`);
  }
  l.push("");
  const dps = r.diasPorSemana;
  l.push(`Días por semana (mediana de ${dps.personas}): activos ${n(dps.activos)} · comida ${n(dps.comida)} · agua ${n(dps.agua)} · sueño ${n(dps.sueno)} · entreno ${n(dps.entreno)}`);
  const ps = r.primeraSemana;
  l.push(`Primera semana usaron: chat ${p(ps.chat)} · voz ${p(ps.voz)} · comida ${p(ps.comida)} · agua ${p(ps.agua)} · sueño ${p(ps.sueno)} · entreno ${p(ps.entreno)} · Finanzas ${p(ps.finanzas)} · Inventario ${p(ps.inventario)} · suplementos ${p(ps.suplementos)} · plan ${p(ps.plan)}`);
  const c = r.chat;
  l.push(`Chat (4 semanas): ${c.mensajes} mensajes · ${n(c.mensajesPorDia)} por persona al día (${n(c.mensajesPorDiaActivo)} los días que usa la app) · por el modelo ${p(c.porModelo)} · por voz ${p(c.voz)} · ${n(c.segundosModeloPorRespuesta, " s")} de modelo por respuesta · respuesta en ${n(c.respuestaP50s, " s")} (mediana), ${n(c.respuestaP90s, " s")} (9 de 10)`);
  const pc = r.pc;
  l.push(`PC (${pc.dias} días): ${n(pc.modeloSegundosDia, " s")} de modelo al día · hora punta ${p(pc.horaPunta)}${pc.horaPuntaEs != null ? ` (a las ${pc.horaPuntaEs}:00)` : ""} · espera en cola ${n(pc.esperaPromedioS, " s")} · Whisper ${n(pc.whisperSegundosDia, " s")}/día · Piper ${n(pc.piperSegundosDia, " s")}/día · ${n(pc.personasActivasDia)} personas activas al día · un PC aguantaría ~${n(pc.personasPorPc)} personas así`);
  l.push(`Pagan: ${r.pagan.pagados} · a los 35 días: ${r.pagan.pagados35} de ${r.pagan.elegibles35} (${p(r.pagan.conversion35)})`);
  l.push("");
  l.push(`Para el simulador: ${JSON.stringify(r.simulador)}`);
  return l.join("\n");
}
