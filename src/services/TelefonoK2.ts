// ============================================================
// Hestia Manos · K2 (2026-11-16): el calendario del teléfono.
//  - Leer: «¿qué tengo en el calendario mañana?», «¿tengo reuniones esta semana?»; los de HOY también entran en «¿qué tengo
//    hoy?» (DayAgendaTool) y en el saludo del día (voz/Saludo.ts).
//  - Agendar: «agéndame una reunión con Brian mañana a las 10» → «¿Agendo «Reunión con Brian» mañana a las 10:00? Dime sí o no.»
//  - Las fechas y horas las pone el CÓDIGO (fechaDicha + horaDicha): el modelo de 4B suma mal las horas (K0).
//  - Los títulos pueden venir de invitaciones de otras personas: se leen como contenido externo.
// ============================================================

import { horaDicha, plegarConMapa } from "./TelefonoParse.js";

const fold = (t: string) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;]+/g, " ").replace(/\s+/g, " ").trim();
const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DIAS_DICHOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export interface EventoTel { titulo: string; inicio: number; fin: number; todoElDia: boolean; lugar?: string }

const inicioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const masDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** «hoy», «mañana» (el día, no «de la mañana»), «pasado mañana», «el viernes», «el 20», «el 20 de diciembre» → el día (00:00) */
export function fechaDicha(texto: string, ahora = new Date()): Date | null {
  const t = fold(texto);
  const hoy = inicioDia(ahora);
  if (/\bpasado manana\b/.test(t)) return masDias(hoy, 2);
  if (/(?<!de la |en la |por la )\bmanana\b/.test(t)) return masDias(hoy, 1);
  if (/\bhoy\b|\besta (tarde|noche)\b/.test(t)) return hoy;
  const ds = /\b(el proximo |proximo |este |el )?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/.exec(t);
  if (ds) {
    let n = (DIAS.indexOf(ds[2]) - hoy.getDay() + 7) % 7;
    if (n === 0 && !/este/.test(ds[1] ?? "")) n = 7; // «el lunes» dicho un lunes: el de la semana que viene
    return masDias(hoy, n);
  }
  const dm = /\bel (\d{1,2})(?: de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))?\b/.exec(t);
  if (dm) {
    const dia = Number(dm[1]);
    if (dia < 1 || dia > 31) return null;
    let mes = dm[2] ? MESES.indexOf(dm[2]) : hoy.getMonth();
    let anio = hoy.getFullYear();
    let d = new Date(anio, mes, dia);
    if (d < hoy) { if (dm[2]) anio++; else mes++; d = new Date(anio, mes, dia); }
    return d.getDate() === dia ? d : null;
  }
  return null;
}

/** La hora de un evento: «a las 4» sin «de la mañana» es de la tarde (nadie agenda una reunión a las 4 AM) */
export function horaDeEvento(texto: string): { hora: number; minuto: number } | null {
  const h = horaDicha(texto);
  if (!h) return /\bal mediodia\b/.test(fold(texto)) ? { hora: 12, minuto: 0 } : null;
  const calificada = /\b(am|pm|de la manana|de la tarde|de la noche|de la madrugada)\b/.test(fold(texto));
  if (!calificada && h.hora >= 1 && h.hora <= 7) return { hora: h.hora + 12, minuto: h.minuto };
  return h;
}

/** Cuánto dura: «por 2 horas», «de 10 a 12», «por media hora»; si no, una hora */
export function duracionEvento(texto: string, inicioHora?: number): number {
  const t = fold(texto);
  if (/\bpor media hora\b/.test(t)) return 30;
  const p = /\bpor (\d+|una|dos|tres) horas?\b/.exec(t);
  if (p) { const h = ({ una: 1, dos: 2, tres: 3 } as Record<string, number>)[p[1]] ?? Number(p[1]); return h > 0 && h <= 12 ? h * 60 : 60; }
  // «de 10 a 12», «de 3 a 5» (de la tarde): el fin es la primera hora después del comienzo
  const r = /\bde (\d{1,2})(?::\d{2})? a (\d{1,2})(?::\d{2})?\b/.exec(t);
  if (r && inicioHora != null) {
    const fin = [Number(r[2]), Number(r[2]) + 12].find((f) => f > inicioHora && f - inicioHora <= 12);
    if (fin != null) return (fin - inicioHora) * 60;
  }
  return 60;
}

/** «hoy», «mañana», «el viernes 20» */
export function etiquetaDia(d: Date, ahora = new Date()): string {
  const hoy = inicioDia(ahora);
  const n = Math.round((inicioDia(d).getTime() - hoy.getTime()) / 86_400_000);
  if (n === 0) return "hoy";
  if (n === 1) return "mañana";
  if (n === 2) return "pasado mañana";
  return `el ${DIAS_DICHOS[d.getDay()]} ${d.getDate()}${d.getMonth() !== hoy.getMonth() ? ` de ${MESES[d.getMonth()]}` : ""}`;
}

/** El rango que pregunta: hoy (por defecto), mañana, un día, esta semana / la próxima */
export function rangoDicho(texto: string, ahora = new Date()): { desde: Date; hasta: Date; etiqueta: string; semana: boolean; primero?: boolean } {
  const t = fold(texto);
  const hoy = inicioDia(ahora);
  // (2026-11-17, banco telefono_banco) «¿cuándo es mi próxima reunión?»: lo primero que viene, en dos semanas
  if (/\bproxim[oa]s? (reunion|evento|cita|compromiso)\b/.test(t)) {
    return { desde: hoy, hasta: masDias(hoy, 15), etiqueta: "en las próximas dos semanas", semana: true, primero: true };
  }
  // «¿tengo algo este fin de semana?»: sábado y domingo (un domingo, desde hoy); «el próximo fin de semana», el siguiente
  if (/\bfin de semana\b/.test(t)) {
    const dow = hoy.getDay();
    let sab = dow === 6 ? hoy : dow === 0 ? masDias(hoy, -1) : masDias(hoy, 6 - dow);
    const prox = /\b(proximo|que viene|otro|siguiente)\b/.test(t);
    if (prox) sab = masDias(sab, 7);
    return { desde: sab < hoy ? hoy : sab, hasta: masDias(sab, 2), etiqueta: prox ? "el próximo fin de semana" : "este fin de semana", semana: true };
  }
  if (/\b(esta|la) semana\b|\bsemana que viene\b|\bproxima semana\b|\bproximos dias\b/.test(t)) {
    const prox = /\b(que viene|proxima)\b/.test(t);
    const desde = prox ? masDias(hoy, 7 - hoy.getDay() + 1) : hoy;
    return { desde, hasta: masDias(desde, 7), etiqueta: prox ? "la próxima semana" : "esta semana", semana: true };
  }
  const d = fechaDicha(texto, ahora) ?? hoy;
  return { desde: d, hasta: masDias(d, 1), etiqueta: etiquetaDia(d, ahora), semana: false };
}

/** Lo que se dice de los eventos (por código; los títulos entre «»: pueden ser de invitaciones de otras personas) */
export function formatearEventos(evs: EventoTel[], etiqueta: string, semana: boolean, ahora = new Date(), primero = false): string {
  const uno = (e: EventoTel) => (e.todoElDia ? `«${e.titulo}» (todo el día)` : `a las ${hhmm(e.inicio)}, «${e.titulo}»`);
  if (primero) {
    // lo que viene (lo que ya terminó no cuenta)
    const prox = evs.filter((e) => (e.todoElDia ? e.inicio >= inicioDia(ahora).getTime() : e.fin > ahora.getTime())).sort((a, b) => a.inicio - b.inicio)[0];
    return prox ? `Lo próximo en tu calendario es ${etiquetaDia(new Date(prox.inicio), ahora)}, ${uno(prox)}.` : `No tienes nada en el calendario ${etiqueta}.`;
  }
  if (!evs.length) return `No tienes nada en el calendario ${etiqueta}.`;
  if (!semana) {
    const cab = etiqueta === "hoy" ? "Hoy" : etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1);
    return `${cab} tienes ${evs.length === 1 ? "una cosa" : `${evs.length} cosas`} en el calendario: ${evs.slice(0, 8).map(uno).join("; ")}.`;
  }
  const porDia = new Map<string, EventoTel[]>();
  for (const e of evs) { const k = etiquetaDia(new Date(e.inicio), ahora); porDia.set(k, [...(porDia.get(k) ?? []), e]); }
  const lineas = [...porDia.entries()].map(([d, es]) => `- **${d.charAt(0).toUpperCase() + d.slice(1)}:** ${es.map(uno).join("; ")}`);
  return [`${etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1)} tienes ${evs.length} ${evs.length === 1 ? "evento" : "eventos"} en el calendario.`, "", ...lineas].join("\n");
}

/** ¿Pide leer el calendario? → lo que dijo (para el rango) */
/** Un día o un rango dicho («el viernes», «mañana», «esta semana», «el fin de semana») */
const DIA_DICHO = /\b(manana|pasado manana|(el|este|esta|para el|para este|para esta|proximo|proxima) (domingo|lunes|martes|miercoles|jueves|viernes|sabado|semana|fin de semana|\d{1,2})|(esta|la|la proxima|la otra) semana|fin de semana|domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/;

export function pideCalendario(texto: string): boolean {
  const t = fold(texto);
  if (CREAR.test(sinCortesia(t))) return false;
  // («reuniones?» pedía «reunione»: «¿cuándo es mi próxima reunión?» no se entendía; banco telefono_banco, 2026-11-17)
  if (/\b(calendario|agendad[oa]s?|reunion(es)?|eventos?|citas?|compromisos?)\b/.test(t)
    && /\b(que|tengo|hay|cuales|cuando|mis|leeme|dime|revisa|algo|proxim[oa])\b/.test(t)) return true;
  // (2026-11-17) «¿tengo algo el viernes?», «¿tengo algo que hacer mañana?», «léeme mi agenda de la semana»
  if (/\btengo algo\b/.test(t) && DIA_DICHO.test(t)) return true;
  // «¿qué tengo mañana?», «¿qué tengo el próximo fin de semana?» (solo eso: «¿qué tengo que comer mañana?» no; y «¿qué tengo hoy?»
  // es el día completo: day_agenda)
  if (/^(?:y )?que (?:tengo|hay) (?:para |agendado (?:para )?|planeado (?:para )?)?(?:el |este |esta |la |para el )?(?:proxim[oa] )?(?:manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|fin de semana|semana|semana que viene|\d{1,2})$/.test(t)) return true;
  return /\b(mi|la) agenda\b/.test(t) && DIA_DICHO.test(t) && /\b(que|leeme|dime|revisa|como|hay|tengo|cuentame)\b/.test(t);
}

/**
 * Lo que va antes de la orden (2026-11-17, su llamada real: «Necesito que agregues un evento el 27 de este mes» se entendía como
 * LEER el calendario y el modelo terminó diciendo «ya está en tu agenda» sin haberlo agendado).
 */
const CORTESIA = /^(?:(?:oye|hestia|ya|ok|okey|bueno|porfa|por favor|necesito que|quiero que|puedes|podrias|me puedes|me podrias|ayudame a)\s+)*/;
const CREAR = /^(?:agendame|agenda(?:me)?|agendar|agendemos|anota(?:me)? en (?:el|mi) (?:calendario|agenda)|pon(?:me)? en (?:el|mi) (?:calendario|agenda)|(?:crea(?:me|s|r)?|crees|agreg(?:a|ar|ame|ues|uemos)|anad(?:e|ir|as|eme)|pon(?:me|gas|er)?|anot(?:a|ar|ame|es))\s+(?:en (?:el|mi) (?:calendario|agenda)\s+)?(?:un evento|una cita|una reunion)(?:\s+en (?:el|mi) (?:calendario|agenda))?(?: de| para| que se llama| que se llame| llamad[oa])?|programa(?:me)? (?=una? (?:reunion|cita|llamada)))\s*(?:una?\s+)?/;
/** «Necesito que agregues un evento…» → «agregues un evento…» (para CREAR) */
const sinCortesia = (t: string) => t.slice(CORTESIA.exec(t)?.[0].length ?? 0);
/** Dónde termina el título: el primer marcador de día u hora */
const CORTE_TITULO = /\s(?:para (?:hoy|manana|el|este|pasado)\b|el (?:proximo )?(?:domingo|lunes|martes|miercoles|jueves|viernes|sabado|\d)|este (?:domingo|lunes|martes|miercoles|jueves|viernes|sabado)|proximo (?:domingo|lunes|martes|miercoles|jueves|viernes|sabado)|(?:domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b|hoy\b|(?<!de la )manana\b|pasado manana\b|a las? \d|a las? (?:una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b|al mediodia|por (?:\d|una|dos|media)|de \d{1,2} a \d)/;

export type PlanAgendar =
  | { tipo: "agendar"; titulo: string; inicio: number; fin: number; todoElDia: boolean; lugar?: string; etiqueta: string }
  | { tipo: "preguntar"; texto: string };

/** Cuándo y qué, resuelto por código (las horas no las calcula el modelo) */
export function planAgendar(p: { titulo?: string; cuando?: string; duracionMin?: number; lugar?: string }, ahora = new Date()): PlanAgendar {
  const titulo = String(p.titulo ?? "").trim().slice(0, 120);
  const cuando = String(p.cuando ?? "");
  if (!titulo) {
    const d0 = fechaDicha(cuando, ahora);
    return { tipo: "preguntar", texto: d0 ? `¿Cómo se llama lo que agendo ${etiquetaDia(d0, ahora)}, y a qué hora?` : "¿Qué agendo? Dime el nombre del evento y cuándo." };
  }
  const dia = fechaDicha(cuando, ahora);
  const todoElDia = /\btodo el dia\b/.test(fold(cuando));
  const h = todoElDia ? null : horaDeEvento(cuando);
  if (!dia && !h) return { tipo: "preguntar", texto: `¿Para cuándo agendo «${titulo}»? Por ejemplo, «mañana a las 10».` };
  if (!h && !todoElDia) return { tipo: "preguntar", texto: `¿A qué hora agendo «${titulo}» ${etiquetaDia(dia!, ahora)}? (o dime «todo el día»)` };
  let d = dia ?? inicioDia(ahora);
  if (todoElDia) return { tipo: "agendar", titulo, inicio: Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()), fin: Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + 1), todoElDia: true, ...(p.lugar ? { lugar: p.lugar } : {}), etiqueta: etiquetaDia(d, ahora) };
  let inicio = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h!.hora, h!.minuto).getTime();
  if (inicio < ahora.getTime() - 60_000) {
    if (dia) return { tipo: "preguntar", texto: `Esa hora ya pasó: ¿para cuándo agendo «${titulo}»?` };
    d = masDias(d, 1); // «a las 9» dicho a las 10 de la noche: mañana
    inicio = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h!.hora, h!.minuto).getTime();
  }
  const dur = p.duracionMin && p.duracionMin > 0 && p.duracionMin <= 720 ? p.duracionMin : duracionEvento(cuando, h!.hora);
  return { tipo: "agendar", titulo, inicio, fin: inicio + dur * 60_000, todoElDia: false, ...(p.lugar ? { lugar: p.lugar } : {}), etiqueta: etiquetaDia(d, ahora) };
}

/** La pregunta de la aprobación (la primera línea se dice en la llamada) */
export function preguntaAgendar(plan: PlanAgendar): string | null {
  if (plan.tipo !== "agendar") return null;
  if (plan.todoElDia) return `¿Agendo «${plan.titulo}» ${plan.etiqueta}, todo el día?`;
  const dur = Math.round((plan.fin - plan.inicio) / 60_000);
  return `¿Agendo «${plan.titulo}» ${plan.etiqueta} a las ${hhmm(plan.inicio)}${dur !== 60 ? `, por ${dur >= 120 && dur % 60 === 0 ? `${dur / 60} horas` : `${dur} minutos`}` : ""}?`;
}

/** Lo que se dice después */
export function respuestaAgendar(plan: PlanAgendar, ok: boolean, code?: string, msg?: string): string {
  if (plan.tipo !== "agendar") return plan.texto;
  if (!ok) return code === "sin_permiso" ? "Hestia Manos no tiene permiso para tu calendario: ábrela y dale el permiso." : msg ?? "No pude agendarlo.";
  return plan.todoElDia ? `Listo: «${plan.titulo}» quedó ${plan.etiqueta} en tu calendario, todo el día.`
    : `Listo: «${plan.titulo}» quedó ${plan.etiqueta} a las ${hhmm(plan.inicio)} en tu calendario, con aviso 10 minutos antes.`;
}

/** «agéndame una reunión con Brian mañana a las 10» → { titulo: «Reunión con Brian», cuando: «mañana a las 10» } */
export function parseAgendar(original: string): { titulo: string; cuando: string } | null {
  const m = plegarConMapa(original);
  if (/\b(alarma|temporizador|despertador)\b/.test(m.t)) return null;
  const pre = CORTESIA.exec(m.t)?.[0].length ?? 0;
  const r = CREAR.exec(m.t.slice(pre));
  if (!r) return null;
  const ini = pre + r[0].length;
  const resto = m.t.slice(ini);
  const c = CORTE_TITULO.exec(` ${resto}`);
  const finTitulo = ini + (c ? Math.max(0, c.index - 1) : resto.length);
  const desde = m.pos[ini] ?? original.length;
  const hasta = finTitulo < m.pos.length ? m.pos[finTitulo] : original.length;
  let titulo = original.slice(desde, c ? hasta : original.length).trim().replace(/[\s.!?¿¡,;]+$/, "")
    .replace(/^(?:el|la|los|las|mi|mis)\s+(?=\S)/i, ""); // «agenda el dentista» → «Dentista»
  titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  const cuando = c ? original.slice(hasta).trim() : "";
  // (sin nombre, «agrega un evento el 27»: se pregunta, no se agenda un «Evento»)
  return { titulo: /^(?:evento|un evento|algo)$/i.test(titulo) ? "" : titulo, cuando };
}

/**
 * Lo que respondes después de que Hestia preguntó para agendar («¿A qué hora?», «¿Cómo se llama?»): lo completa el CÓDIGO.
 * Antes lo contestaba el modelo, que dijo «ya está en tu agenda» sin agendar nada (su llamada real, 2026-11-17). null = no es
 * una respuesta a eso (cambió de tema o dijo que no).
 */
export function completarAgendar(p: { titulo: string; cuando: string }, texto: string): { accion: "agendar"; titulo: string; cuando: string } | null {
  const t = fold(texto);
  if (!t || /[?¿]\s*$/.test(String(texto).trim()) || t.split(" ").length > 16) return null;
  if (/^(no|nada|cancela\w*|olvida\w*|dejalo|dejala|mejor no|despues|ahora no)\b/.test(t)) return null;
  if (!p.titulo) {
    // la respuesta trae el nombre (y a lo mejor el cuándo): «Fiesta de disfraces a la una de la tarde»
    const a = parseAgendar(`agenda ${String(texto).trim()}`);
    if (!a?.titulo) return null;
    return { accion: "agendar", titulo: a.titulo, cuando: [p.cuando, a.cuando].filter(Boolean).join(" ") };
  }
  return { accion: "agendar", titulo: p.titulo, cuando: [p.cuando, String(texto).trim()].filter(Boolean).join(" ") };
}
