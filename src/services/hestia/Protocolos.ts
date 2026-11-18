// ============================================================
// Hestia como JARVIS · L5 (2026-11-18): los protocolos, escenas con nombre (IM1: «Jarvis, mute» y el taller por voz). Todo por
// código, sin el modelo: «Hestia, protocolo gimnasio» pone «No molestar», sigue tu música y arranca el entrenador; «protocolo
// dormir» pone la alarma según lo que necesitas dormir y tu agenda de mañana, «No molestar» hasta esa hora y el cierre del día;
// «protocolo foco» son 50 minutos sin interrupciones y un aviso al terminar; «salir» y «casa».
//  - Cada paso dice lo que DE VERDAD pasó en el teléfono (si Hestia Manos no pudo, lo dice).
//  - En un protocolo solo va lo que no llega a otras personas: llamar, mandar mensajes o tocar apps se piden aparte, siempre.
//  - «crea un protocolo lectura que ponga no molestar por una hora y baje el volumen»: Hestia repite los pasos y tú confirmas.
//  - Con el teléfono bloqueado (sin tu voz), solo lo seguro: alarma, «No molestar», música, el entrenador.
// Solo Hestia (Ikaros en Modo AXS): lo llama el servidor solo ahí.
// ============================================================
import { cambiarEstado, leerEstado, type EstadoHestia } from "./Estado.js";
import { MAX_PASOS, MAX_PROPIOS, OPS_PROTOCOLO, plegarNombre, type HablarProtocolo, type Paso, type Protocolo, type ProtocoloActivo } from "./ProtocoloTipos.js";
import { appDelTelefono, duracionDicha, parseTelefono, plegarConMapa, SEGURAS_BLOQUEADO } from "../TelefonoParse.js";
import type { TelefonoOp, TelefonoResult } from "../TelefonoBridge.js";
import type { EventoCal, SupAgenda } from "./Avisos.js";
import { respuestaSiNo } from "../voz/AprobacionVoz.js";

export type { Paso, Protocolo, ProtocoloActivo } from "./ProtocoloTipos.js";

// ─── Los que vienen hechos ──────────────────────────────────────────────────────
export const PROTOCOLOS_BASE: Protocolo[] = [
  { nombre: "gimnasio", titulo: "Gimnasio", alias: ["gimnasio", "gym", "gim", "yim", "entreno", "entrenar", "entrenamiento", "pesas"], hablar: "urgente", duracionMin: 150,
    pasos: [{ tipo: "no_molestar", encender: true, delProtocolo: true }, { tipo: "musica" }, { tipo: "entrenador" }] },
  { nombre: "dormir", titulo: "Dormir", alias: ["dormir", "sueno", "noche", "acostarme", "a dormir", "buenas noches"], hablar: "nada", duracionMin: null,
    pasos: [{ tipo: "alarma_sueno" }, { tipo: "no_molestar", encender: true, hastaAlarma: true }, { tipo: "cierre_dia" }] },
  { nombre: "foco", titulo: "Foco", alias: ["foco", "concentracion", "concentrarme", "estudio", "estudiar", "enfoque", "trabajo profundo"], hablar: "urgente", duracionMin: 50,
    pasos: [{ tipo: "no_molestar", encender: true, delProtocolo: true }] },
  { nombre: "salir", titulo: "Salir de casa", alias: ["salir", "salir de casa", "salida", "saliendo", "me voy"], hablar: "todo", duracionMin: null,
    pasos: [{ tipo: "salida" }, { tipo: "pc_mientras" }] },
  { nombre: "casa", titulo: "Casa", alias: ["casa", "llegada", "llegue", "en casa", "volvi"], hablar: "todo", duracionMin: null,
    pasos: [{ tipo: "bienvenida" }, { tipo: "fondo", quieto: false }] },
];
const BASE = new Map(PROTOCOLOS_BASE.map((p) => [p.nombre, p]));

/** Los de siempre (o tu versión, si cambiaste uno) y los tuyos */
export function listaProtocolos(e: Pick<EstadoHestia, "protocolos">): Protocolo[] {
  const propios = new Map(e.protocolos.map((p) => [p.nombre, p]));
  const out = PROTOCOLOS_BASE.map((b) => { const p = propios.get(b.nombre); return p ? { ...p, alias: [...new Set([...p.alias, ...b.alias])] } : b; });
  for (const p of e.protocolos) if (!BASE.has(p.nombre)) out.push(p);
  return out;
}

const PALABRAS_SUELTAS = /^(?:el|la|los|las|mi|de|del|al|protocolo|modo)\s+/;
/** «el gym», «modo foco», «Gimnasio» → el protocolo */
export function buscarProtocolo(dicho: string, lista: Protocolo[]): Protocolo | null {
  let q = plegarNombre(dicho);
  for (let i = 0; i < 3; i++) q = q.replace(PALABRAS_SUELTAS, "");
  if (!q) return null;
  return lista.find((p) => p.nombre === q || p.alias.includes(q))
    ?? (q.length >= 3 ? lista.find((p) => p.nombre.startsWith(q) || p.alias.some((a) => a.startsWith(q))) : undefined)
    ?? null;
}

/** El que está corriendo (si ya venció, ninguno) */
export function protocoloVigente(e: Pick<EstadoHestia, "protocolo">, ahora = new Date()): ProtocoloActivo | null {
  const p = e.protocolo;
  if (!p) return null;
  if (p.hasta && Date.parse(p.hasta) <= ahora.getTime()) return null;
  return p;
}

// ─── Cómo se dice cada cosa ─────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date | number) => { const x = new Date(d); return `${x.getHours()}:${pad(x.getMinutes())}`; };
const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const dec = (n: number) => (Math.round(n * 10) / 10).toLocaleString("es-CL");
const conTrato = (t?: string | null) => (t ? `, ${t}` : "");
/** 50 → «50 minutos»; 90 → «una hora y media»; 150 → «2 horas y media» */
export function minutosDichos(m: number): string {
  const r = Math.round(m);
  if (r < 60) return `${r} minuto${r === 1 ? "" : "s"}`;
  const h = Math.floor(r / 60), mm = r % 60;
  const hs = h === 1 ? "una hora" : `${h} horas`;
  if (!mm) return hs;
  if (mm === 30) return `${hs} y media`;
  return `${hs} y ${mm} minutos`;
}
/** 7,95 h → «8 horas»; 7,5 → «7 horas y media»; 6,75 → «6 horas y 45 minutos» (de a 5 minutos) */
export function horasDichas(h: number): string { return minutosDichos(Math.round((h * 60) / 5) * 5); }
const tituloDicho = (p: Pick<Protocolo, "titulo" | "propio" | "nombre">) => (BASE.has(p.nombre) ? p.titulo.toLowerCase() : p.titulo);

/** Lo que hace un paso, para repetírtelo («no molestar por 50 minutos») */
export function describirPaso(p: Paso, duracionMin: number | null = null): string {
  switch (p.tipo) {
    case "no_molestar":
      if (!p.encender) return "quitar el No molestar";
      if (p.hastaAlarma) return "No molestar hasta la alarma";
      { const m = p.delProtocolo ? duracionMin : p.minutos; return m ? `No molestar por ${minutosDichos(m)}` : "No molestar"; }
    case "musica": return "tu música";
    case "alarma_sueno": return "la alarma según lo que necesitas dormir y tu agenda de mañana";
    case "entrenador": return "el entrenador en el oído";
    case "cierre_dia": return "el cierre del día";
    case "agenda": return "tu día";
    case "salida": return "lo que viene mientras no estás";
    case "pc_mientras": return "preguntarte si avanzo con lo pendiente en el PC";
    case "bienvenida": return "la bienvenida";
    case "constantes": return "tus constantes";
    case "fondo": return p.quieto ? "dejar quieto lo de fondo del PC" : "retomar lo de fondo del PC";
    case "telefono": {
      const o = p.op;
      switch (o.accion) {
        case "alarma": return `alarma a las ${o.hora}:${pad(o.minuto ?? 0)}`;
        case "temporizador": return `temporizador de ${minutosDichos(Math.max(1, Math.round((o.segundos ?? 60) / 60)))}`;
        case "linterna": return o.encender === false ? "apagar la linterna" : "prender la linterna";
        case "volumen": return o.cambio === "silencio" ? "el teléfono en silencio" : o.cambio === "subir" ? "subir el volumen" : o.cambio === "bajar" ? "bajar el volumen" : o.cambio === "maximo" ? "el volumen al máximo" : `volumen al ${o.nivel} %`;
        case "musica": return o.que === "pausa" ? "pausar la música" : o.que === "siguiente" ? "pasar a la siguiente canción" : o.que === "anterior" ? "la canción anterior" : "seguir con la música";
        case "abrir_app": return `abrir ${o.nombre}`;
        case "navegar": return `Maps rumbo a ${o.destino}`;
        case "no_molestar": return o.encender === false ? "quitar el No molestar" : o.minutos ? `No molestar por ${minutosDichos(o.minutos)}` : "No molestar";
      }
    }
  }
  return "un paso";
}
export function describirProtocolo(p: Protocolo, duracionMin = p.duracionMin): string { return juntar(p.pasos.map((x) => describirPaso(x, duracionMin))); }

// ─── La alarma para dormir ──────────────────────────────────────────────────────
export interface Alarma { hora: number; minuto: number; ms: number; horasSueno: number; necesidad: number; motivo: "necesidad" | "agenda"; evento: { titulo: string; inicio: number } | null; extraPorDeuda: boolean }
export const LATENCIA_MIN = 15;
export const MARGEN_EVENTO_MIN = 60;

/**
 * Lo que necesitas dormir (Sueño: ~8 h si no hay datos) desde que te duermes (15 min después), y si mañana tienes algo temprano,
 * una hora antes de eso. Con deuda de sueño de 3 h o más (y sin nada temprano), media hora extra.
 */
export function calcularAlarma(ahora: Date, sueno: { need: number; debtH: number } | null, eventos: EventoCal[]): Alarma {
  const necesidad = Math.min(10, Math.max(6, sueno?.need && Number.isFinite(sueno.need) ? sueno.need : 8));
  const dormido = ahora.getTime() + LATENCIA_MIN * 60_000;
  const extraPorDeuda = !!sueno && sueno.debtH >= 3;
  const ideal = dormido + (necesidad + (extraPorDeuda ? 0.5 : 0)) * 3_600_000;
  const primero = eventos
    .filter((e) => e && !e.todoElDia && typeof e.inicio === "number" && e.inicio > dormido + 3 * 3_600_000 && e.inicio < ahora.getTime() + 20 * 3_600_000)
    .sort((a, b) => a.inicio - b.inicio)[0] ?? null;
  const limite = primero ? primero.inicio - MARGEN_EVENTO_MIN * 60_000 : Infinity;
  const crudo = Math.min(ideal, limite);
  const d = new Date(crudo);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 5));
  const porAgenda = limite < ideal;
  return {
    hora: d.getHours(), minuto: d.getMinutes(), ms: d.getTime(), horasSueno: Math.max(0, (d.getTime() - dormido) / 3_600_000), necesidad,
    motivo: porAgenda ? "agenda" : "necesidad", evento: primero ? { titulo: String(primero.titulo ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "algo", inicio: primero.inicio } : null,
    extraPorDeuda: extraPorDeuda && !porAgenda,
  };
}

export function textoAlarma(a: Alarma): string {
  const hora = `${a.hora}:${pad(a.minuto)}`;
  if (a.motivo === "agenda" && a.evento) {
    const corto = a.horasSueno < a.necesidad - 0.25;
    return `Alarma a las ${hora}: mañana a las ${hhmm(a.evento.inicio)} tienes «${a.evento.titulo}»${corto ? `, así que dormirías ${horasDichas(a.horasSueno)}, menos de tus ${horasDichas(a.necesidad)}` : ""}`;
  }
  return `Alarma a las ${hora}: tus ${horasDichas(a.necesidad)} de sueño${a.extraPorDeuda ? " y media hora más, por la deuda de sueño" : ""}`;
}

// ─── El cierre del día ──────────────────────────────────────────────────────────
export interface DatosCierre {
  kcal: { comida: number; meta: number } | null;
  proteina: { comida: number; meta: number } | null;
  agua: { totalL: number; goalL: number } | null;
  entrenoHoy: boolean | null;
}
/** Unos 20 segundos: la comida, el agua, si entrenaste y lo primero de mañana */
export function textoCierre(d: DatosCierre | null, manana: { titulo: string; inicio: number } | null, trato?: string | null): string {
  const partes: string[] = [];
  // (con el día vacío no se dice «comiste cero de 2.850»: se dice que no hay nada anotado)
  if (d?.kcal && d.kcal.meta > 0 && d.kcal.comida > 0) partes.push(`comiste ${Math.round(d.kcal.comida).toLocaleString("es-CL")} de ${Math.round(d.kcal.meta).toLocaleString("es-CL")} calorías${d.proteina && d.proteina.meta > 0 ? ` y ${Math.round(d.proteina.comida)} de ${Math.round(d.proteina.meta)} gramos de proteína` : ""}`);
  if (d?.agua && d.agua.goalL > 0 && d.agua.totalL > 0) partes.push(`agua, ${dec(d.agua.totalL)} de ${dec(d.agua.goalL)} litros`);
  let txt = partes.length ? `Cierre del día: ${partes.join("; ")}.` : "Cierre del día: hoy no tengo ni tu comida ni tu agua anotadas.";
  if (d?.entrenoHoy === true) txt += " Hoy entrenaste.";
  if (manana) txt += ` Mañana a las ${hhmm(manana.inicio)}, «${manana.titulo}».`;
  return `${txt} Que descanses${conTrato(trato)}.`;
}

// ─── Lo que viene al salir ──────────────────────────────────────────────────────
/** Las tomas con aviso entre ahora y `hasta` que aún no anotas (para «llévate la metformina») */
export function tomasMientras(sups: SupAgenda | null, ahora: Date, horas = 8): Array<{ nombre: string; hora: string }> {
  if (!sups || !Array.isArray(sups.items)) return [];
  const dia = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
  const desde = ahora.getHours() * 60 + ahora.getMinutes(), hasta = Math.min(24 * 60, desde + horas * 60);
  const out: Array<{ nombre: string; hora: string; m: number }> = [];
  for (const it of sups.items) {
    if (!it?.activo || !it.aviso || !Array.isArray(it.horas)) continue;
    [...it.horas].sort((a, b) => a - b).forEach((h, i) => {
      const m = Math.round(h * 60);
      if (m <= desde || m > hasta || (sups.log?.[dia]?.[it.id] ?? 0) > i) return;
      out.push({ nombre: String(it.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 40), hora: `${Math.floor(m / 60)}:${pad(m % 60)}`, m });
    });
  }
  return out.sort((a, b) => a.m - b.m).slice(0, 3).map(({ nombre, hora }) => ({ nombre, hora }));
}

// ─── Lo de afuera (el servidor lo arma; las pruebas, con datos inventados) ───────
export interface DepsProtocolo {
  /** Hestia Manos (por la conexión del teléfono); null sin ella */
  telefono: ((op: TelefonoOp, ms?: number) => Promise<TelefonoResult>) | null;
  /** las apps del teléfono (para abrir tu app de música) */
  apps: string[];
  /** L3: empezar el entreno; solo en la llamada (null en el chat) */
  entrenador?: (() => Promise<string>) | null;
  sueno(): Promise<{ need: number; debtH: number } | null>;
  cierre(): Promise<DatosCierre | null>;
  agenda(): Promise<string | null>;
  bienvenida(): Promise<string | null>;
  constantes(): Promise<string | null>;
  sups(): Promise<SupAgenda | null>;
  /** cuántos trabajos de fondo (no vigías) esperan */
  trabajosPendientes(): Promise<number>;
  /** se puso una alarma (para «cámbiala a las 8» después) */
  alarmaPuesta?(): void;
}
export interface CtxProtocolo {
  profileId: string;
  trato?: string | null;
  ahora?: Date;
  /** teléfono bloqueado sin tu voz: solo lo seguro */
  bloqueado?: boolean;
  /** quién lo pide: la voz y el chat pueden crear o borrar; el panel solo activa y termina */
  por: "voz" | "chat" | "panel";
  deps: DepsProtocolo;
}
export interface RespuestaProtocolo { texto: string; externo?: boolean; activo?: ProtocoloActivo | null }

/** Los pasos que se hacen con el teléfono bloqueado (sin tu voz): nada que muestre lo tuyo */
const SEGUROS_BLOQUEADO = new Set(["no_molestar", "musica", "alarma_sueno", "entrenador", "fondo"]);
const pasoBloqueadoOk = (p: Paso) => SEGUROS_BLOQUEADO.has(p.tipo) || (p.tipo === "telefono" && (SEGURAS_BLOQUEADO.has(p.op.accion) || p.op.accion === "no_molestar"));

const APPS_MUSICA = ["spotify", "youtube music", "yt music", "deezer", "apple music", "amazon music", "soundcloud", "tidal", "musica"];

/** Lo que pasó en el teléfono, en corto (cada paso dice la verdad) */
function fraseTel(op: TelefonoOp, r: TelefonoResult, ahora = new Date()): string {
  const d = r.data ?? {};
  switch (op.accion) {
    case "alarma": return `alarma a las ${op.hora}:${pad(op.minuto ?? 0)}`;
    case "temporizador": return `temporizador de ${minutosDichos(Math.max(1, Math.round((op.segundos ?? 60) / 60)))}`;
    case "linterna": return op.encender === false ? "linterna apagada" : "linterna prendida";
    case "volumen": return op.cambio === "silencio" ? "el teléfono en silencio" : `volumen al ${d.porcentaje ?? op.nivel ?? "?"} %`;
    case "musica": return op.que === "pausa" ? "música en pausa" : op.que === "siguiente" ? "la siguiente canción" : "la música sonando";
    case "abrir_app": return `abrí ${d.app ?? op.nombre}`;
    case "navegar": return `Maps rumbo a ${d.destino ?? op.destino}`;
    case "no_molestar": return op.encender === false ? "quité el No molestar" : op.minutos ? `No molestar hasta las ${hhmm(ahora.getTime() + op.minutos * 60_000)}` : "No molestar puesto";
  }
  return "listo";
}
function falloTel(que: string, r: TelefonoResult | null): string {
  if (!r) return `${que}: sin el teléfono no pude`;
  switch (r.code) {
    case "sin_manos": return `${que}: necesito Hestia Manos en el teléfono`;
    case "desconocida": return `${que}: necesito la versión nueva de Hestia Manos`;
    case "sin_acceso": return `${que}: ${r.msg ?? "a Hestia Manos le falta un acceso"}`;
    case "timeout": return `${que}: el teléfono no respondió`;
    case "bloqueado": return `${que}: Android no me dejó (con la pantalla apagada, Hestia Manos necesita «Mostrar sobre otras apps»)`;
    default: return `${que}: ${String(r.msg ?? "no pude").replace(/\.$/, "")}`;
  }
}
const queEsOp = (op: TelefonoOp) => (op.accion === "no_molestar" ? "el No molestar" : op.accion === "alarma" ? "la alarma" : op.accion === "musica" ? "la música" : op.accion === "abrir_app" ? `abrir ${op.nombre}` : describirPaso({ tipo: "telefono", op }));

/** Activa un protocolo: hace cada paso y dice lo que de verdad pasó */
export async function activar(p: Protocolo, c: CtxProtocolo, duracionMin: number | null = null): Promise<RespuestaProtocolo> {
  const ahora = c.ahora ?? new Date();
  const dur = duracionMin ?? p.duracionMin;
  const d = c.deps;
  const hechos: string[] = [], fallos: string[] = [], bloques: string[] = [];
  const saltados: string[] = [];
  let pregunta: string | null = null, externo = false;
  let alarmaMs: number | null = null, dnd = false, dndHasta: number | null = null, manana: { titulo: string; inicio: number } | null = null;
  const tel = async (op: TelefonoOp, ms?: number): Promise<TelefonoResult | null> => (d.telefono ? await d.telefono(op, ms).catch(() => null) : null);

  // (si había otro corriendo con «No molestar» y este no lo pone, se quita: no queda puesto de un protocolo que ya no está)
  const e0 = await leerEstado();
  const antes = protocoloVigente(e0, ahora);
  const quedaActivo = dur != null || p.pasos.some((x) => (x.tipo === "no_molestar" && x.encender) || x.tipo === "alarma_sueno");
  const poneDnd = p.pasos.some((x) => (x.tipo === "no_molestar" && x.encender) || (x.tipo === "telefono" && x.op.accion === "no_molestar" && x.op.encender !== false));
  if (quedaActivo && antes && antes.nombre !== p.nombre && antes.dnd && !poneDnd) {
    const r = await tel({ accion: "no_molestar", encender: false });
    if (r?.ok) hechos.push(`quité el No molestar de ${antes.titulo.toLowerCase()}`);
  }

  for (const paso of p.pasos) {
    if (c.bloqueado && !pasoBloqueadoOk(paso)) { saltados.push(describirPaso(paso, dur)); continue; }
    switch (paso.tipo) {
      case "telefono": {
        const r = await tel(paso.op);
        if (r?.ok) { hechos.push(fraseTel(paso.op, r, ahora)); if (paso.op.accion === "alarma") d.alarmaPuesta?.(); if (paso.op.accion === "no_molestar" && paso.op.encender !== false) { dnd = true; dndHasta = paso.op.minutos ? ahora.getTime() + paso.op.minutos * 60_000 : null; } }
        else fallos.push(falloTel(queEsOp(paso.op), r));
        break;
      }
      case "no_molestar": {
        if (!paso.encender) { const r = await tel({ accion: "no_molestar", encender: false }); if (r?.ok) hechos.push("quité el No molestar"); else fallos.push(falloTel("el No molestar", r)); break; }
        const min = paso.hastaAlarma ? (alarmaMs ? Math.max(1, Math.round((alarmaMs - ahora.getTime()) / 60_000)) : 8 * 60) : paso.delProtocolo ? dur : paso.minutos ?? null;
        const op: TelefonoOp = { accion: "no_molestar", encender: true, ...(min ? { minutos: min } : {}) };
        const r = await tel(op);
        if (r?.ok) { dnd = true; dndHasta = min ? ahora.getTime() + min * 60_000 : null; hechos.push(paso.hastaAlarma && alarmaMs ? "No molestar hasta esa hora" : min ? `No molestar hasta las ${hhmm(ahora.getTime() + min * 60_000)}` : "No molestar puesto"); }
        else fallos.push(falloTel("El No molestar", r));
        break;
      }
      case "musica": {
        const r = await tel({ accion: "musica", que: "sigue" });
        if (r?.ok) { const cancion = String(r.data?.cancion ?? "").trim(); hechos.push(cancion ? `la música sonando («${cancion.slice(0, 50)}»)` : "la música sonando"); externo ||= !!cancion; break; }
        if (r?.code === "sin_musica") {
          const app = APPS_MUSICA.map((n) => appDelTelefono(n, d.apps)).find(Boolean) ?? null;
          if (app) {
            const a = await tel({ accion: "abrir_app", nombre: app });
            if (a?.ok) { hechos.push(`abrí ${a.data?.app ?? app} (no había nada en pausa: dale play)`); break; }
            fallos.push(falloTel(`Abrir ${app}`, a));
          } else hechos.push("no había música en pausa");
          break;
        }
        fallos.push(falloTel("La música", r));
        break;
      }
      case "alarma_sueno": {
        const ev = await tel({ accion: "eventos", desde: ahora.getTime(), hasta: ahora.getTime() + 20 * 3_600_000 }, 5000);
        const eventos = (ev?.ok && Array.isArray(ev.data?.eventos) ? ev.data.eventos : []) as EventoCal[];
        const a = calcularAlarma(ahora, await d.sueno().catch(() => null), eventos);
        manana = a.evento && a.evento.inicio - ahora.getTime() < 20 * 3_600_000 ? a.evento : null;
        externo ||= !!a.evento;
        const r = await tel({ accion: "alarma", hora: a.hora, minuto: a.minuto, mensaje: "Dormir (Hestia)" });
        if (r?.ok) { alarmaMs = a.ms; hechos.push(textoAlarma(a)); d.alarmaPuesta?.(); }
        else fallos.push(falloTel(`La alarma (iba a las ${a.hora}:${pad(a.minuto)})`, r));
        break;
      }
      case "entrenador": {
        if (d.entrenador) { const t = await d.entrenador().catch(() => null); if (t) bloques.push(t); }
        else bloques.push("El entrenador va en la llamada: ábrela y dime «vamos a entrenar».");
        break;
      }
      case "cierre_dia": {
        // (lo primero de mañana: si la alarma ya lo trajo, ese; si no, se pregunta al calendario)
        if (!manana) {
          const ev = await tel({ accion: "eventos", desde: ahora.getTime() + 3 * 3_600_000, hasta: ahora.getTime() + 20 * 3_600_000 }, 5000);
          const evs = (ev?.ok && Array.isArray(ev.data?.eventos) ? ev.data.eventos : []) as EventoCal[];
          const f = evs.filter((x) => x && !x.todoElDia && typeof x.inicio === "number").sort((a, b) => a.inicio - b.inicio)[0];
          if (f) { manana = { titulo: String(f.titulo ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "algo", inicio: f.inicio }; externo = true; }
        }
        bloques.push(textoCierre(await d.cierre().catch(() => null), manana, null));
        break;
      }
      case "agenda": { const t = await d.agenda().catch(() => null); if (t) { bloques.push(t); externo = true; } break; }
      case "bienvenida": { const t = await d.bienvenida().catch(() => null); if (t) bloques.push(t); break; }
      case "constantes": { const t = await d.constantes().catch(() => null); if (t) bloques.push(t); break; }
      case "salida": {
        const partes: string[] = [];
        const ev = await tel({ accion: "eventos", desde: ahora.getTime(), hasta: ahora.getTime() + 8 * 3_600_000 }, 5000);
        const evs = ((ev?.ok && Array.isArray(ev.data?.eventos) ? ev.data.eventos : []) as EventoCal[]).filter((x) => x && !x.todoElDia && x.inicio > ahora.getTime()).sort((a, b) => a.inicio - b.inicio);
        if (evs[0]) { partes.push(`a las ${hhmm(evs[0].inicio)} tienes «${String(evs[0].titulo ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || "algo"}»`); externo = true; }
        const tomas = tomasMientras(await d.sups().catch(() => null), ahora);
        if (tomas.length) partes.push(`llévate ${juntar(tomas.map((t) => `${t.nombre} (a las ${t.hora})`))}`);
        const b = await tel({ accion: "bateria" }, 4000);
        const pct = Number(b?.data?.porcentaje);
        if (b?.ok && Number.isFinite(pct) && pct < 40 && !b.data?.cargando) partes.push(`el teléfono está al ${Math.round(pct)} %: llévate el cargador`);
        bloques.push(partes.length ? `${cap(partes.join("; "))}.` : "No tienes nada en las próximas horas.");
        break;
      }
      case "pc_mientras": {
        const n = await d.trabajosPendientes().catch(() => 0);
        if (n > 0) { pregunta = `En el PC tengo ${n === 1 ? "un trabajo pendiente" : `${n} trabajos pendientes`}: ¿lo avanzo mientras no estás, o lo dejo quieto?`; PEND.set(c.profileId, { tipo: "pc", at: Date.now() }); }
        break;
      }
      case "fondo": {
        const e = await leerEstado();
        if (paso.quieto) { if (!e.fondoQuieto) { await cambiarEstado((x) => { x.fondoQuieto = `lo pediste (protocolo ${tituloDicho(p)})`; }); hechos.push("dejé quieto lo de fondo en el PC"); } }
        else if (e.fondoQuieto) { await cambiarEstado((x) => { x.fondoQuieto = null; }); hechos.push("retomo lo pendiente en el PC"); }
        break;
      }
    }
  }

  // ¿queda corriendo? (con tiempo, con «No molestar» o hasta la alarma)
  let activo: ProtocoloActivo | null = null;
  if (quedaActivo && (dnd || dur != null || alarmaMs)) {
    const hasta = alarmaMs ?? (dur != null ? ahora.getTime() + dur * 60_000 : dndHasta);
    activo = { nombre: p.nombre, titulo: p.titulo, desde: ahora.toISOString(), hasta: hasta ? new Date(hasta).toISOString() : null, hablar: p.hablar, dnd, aviso: dur != null && !alarmaMs };
    await cambiarEstado((x) => { x.protocolo = activo; });
  } else if (quedaActivo && antes && antes.nombre !== p.nombre) await cambiarEstado((x) => { x.protocolo = null; });

  const partes = [`Protocolo ${tituloDicho(p)}${conTrato(c.trato)}.`];
  if (hechos.length) partes.push(`${cap(juntar(hechos))}.`);
  if (fallos.length) partes.push(`${fallos.map(cap).join(". ")}.`);
  partes.push(...bloques);
  if (saltados.length) partes.push(`Con el teléfono bloqueado no hice ${juntar(saltados)}: eso, al desbloquear.`);
  if (pregunta) partes.push(pregunta);
  if (!hechos.length && !fallos.length && !bloques.length && !pregunta) partes.push(saltados.length ? "" : "No había nada que hacer.");
  return { texto: partes.filter(Boolean).join(" ").replace(/\.\./g, "."), externo, activo };
}

/** Termina el que está corriendo (quita el «No molestar» si lo puso él) */
export async function terminar(c: CtxProtocolo, nombre: string | null = null, motivo: "pedido" | "vencio" = "pedido"): Promise<RespuestaProtocolo> {
  const ahora = c.ahora ?? new Date();
  const e = await leerEstado();
  const act = motivo === "vencio" ? e.protocolo : protocoloVigente(e, ahora);
  if (!act) return { texto: "No hay ningún protocolo activo." };
  if (nombre) {
    const p = buscarProtocolo(nombre, listaProtocolos(e));
    if (p && p.nombre !== act.nombre) return { texto: `El que está activo es ${act.titulo.toLowerCase()}, no ${tituloDicho(p)}. Si quieres terminarlo, dime «termina el protocolo».` };
  }
  let dnd = "";
  if (act.dnd && c.deps.telefono) {
    const r = await c.deps.telefono({ accion: "no_molestar", encender: false }).catch(() => null);
    dnd = r?.ok ? "quité el No molestar" : motivo === "vencio" ? "" : `el No molestar no pude quitarlo (${r?.msg ?? "sin el teléfono"}): quítalo tú`;
  }
  await cambiarEstado((x) => { if (x.protocolo?.nombre === act.nombre && x.protocolo.desde === act.desde) x.protocolo = null; });
  const min = Math.max(1, Math.round((ahora.getTime() - Date.parse(act.desde)) / 60_000));
  const t = act.titulo.toLowerCase();
  if (motivo === "vencio") {
    const texto = act.nombre === "foco" ? `Terminó tu bloque de foco: ${minutosDichos(min)}${dnd ? `. ${cap(dnd)}` : ""}.` : `Terminó el protocolo ${t}${dnd ? `: ${dnd}` : ""}.`;
    return { texto, activo: null };
  }
  return { texto: `Listo, terminé el protocolo ${t}${act.nombre === "foco" ? ` (${minutosDichos(min)} de foco)` : ""}${dnd ? `: ${dnd}` : ""}.`, activo: null };
}

/** El que venció (para el reloj del servidor: aviso y «No molestar» fuera), o null */
export async function vencido(ahora = new Date()): Promise<ProtocoloActivo | null> {
  const p = (await leerEstado()).protocolo;
  return p && p.hasta && Date.parse(p.hasta) <= ahora.getTime() ? p : null;
}

// ─── Crear los tuyos ────────────────────────────────────────────────────────────
const fold = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.;«»"“”]+/g, " ").replace(/\s+/g, " ").trim();
/** Lo dicho en subjuntivo o infinitivo, a la orden que ya entiende el teléfono («que ponga» → «pon», «que me despierte» → «despiértame») */
const VERBOS: Array<[RegExp, string]> = [
  // (lo que llega a otros también se entiende, para decir que no va: «que le mande un WhatsApp a mamá…»)
  [/^(?:que )?le (?:mande|mandes|mandar|envie|envies|enviar|escriba|escribas|escribir)\b/, "mandale"], [/^(?:que )?le (?:diga|digas|decir|avise|avises|avisar)\b/, "dile"],
  [/^(?:que )?(?:llame|llames|llamar)\b/, "llama"],
  [/^(?:que )?me despiert[ae]s?\b/, "despiertame"], [/^(?:que )?me avis[ae]s?\b/, "avisame"], [/^(?:que )?me (?:lleve|lleves)\b/, "llevame"],
  [/^(?:que )?(?:me )?(?:diga|digas|decir)\b/, "dime"],
  [/^(?:que )?(?:ponga|pongas|poner|ponme|me ponga)\b/, "pon"], [/^(?:que )?(?:baje|bajes|bajar)\b/, "baja"], [/^(?:que )?(?:suba|subas|subir)\b/, "sube"],
  [/^(?:que )?(?:abra|abras|abrir)\b/, "abre"], [/^(?:que )?(?:active|actives|activar)\b/, "activa"], [/^(?:que )?(?:prenda|prendas|prender|encienda|encender)\b/, "prende"],
  [/^(?:que )?(?:apague|apagues|apagar)\b/, "apaga"], [/^(?:que )?(?:silencie|silencies|silenciar)\b/, "silencia"], [/^(?:que )?(?:deje|dejes|dejar)\b/, "deja"],
  [/^(?:que )?(?:empiece|empieces|empezar|inicie|iniciar|arranque|arrancar|comience|comenzar)\b/, "empieza"], [/^(?:que )?(?:quite|quites|quitar|saque|sacar)\b/, "quita"],
  [/^(?:que )?(?:siga|sigas|seguir|continue|continuar)\b/, "sigue"], [/^(?:que )?(?:pause|pausar|pare|parar)\b/, "pausa"],
];
const A_OTROS = new Set(["llamar", "sms", "whatsapp", "responder", "mensajes", "contactos", "tocar", "escribir", "revisar_toque", "pantalla", "atras", "inicio", "desplazar", "agendar", "calendario", "crear_evento", "eventos", "contestar", "rechazar"]);

/** «no molestar por una hora y baja el volumen» → los pasos (lo que no entendió o no va en un protocolo, aparte) */
export function pasosDe(texto: string, apps: string[] = []): { pasos: Paso[]; noEntendi: string[]; aOtros: string[] } {
  const t = fold(texto).replace(/^[:,\s]+/, "").replace(/^(?:y |para )?que /, "");
  // (no se corta «una hora y media» ni «las 7 y cuarto»)
  const trozos = t.split(/\s*(?:[,:]|\b(?:y )?(?:luego|despues|ademas|tambien)\b|\by\b(?!\s+(?:media|cuarto|\d{1,2}\b)))\s*/).map((x) => x.trim()).filter((x) => x.length >= 2);
  const pasos: Paso[] = [], noEntendi: string[] = [], aOtros: string[] = [];
  for (const crudo of trozos) {
    let c = crudo.replace(/^(?:que|y que|para que)\s+/, "").replace(/^(?:tambien|ademas)\s+/, "").replace(/^(?:hestia|eris)\s+/, "");
    for (const [re, v] of VERBOS) if (re.test(c)) { c = c.replace(re, v); break; }
    c = c.replace(/\s+(?:por favor|porfa)$/, "").trim();
    if (!c) continue;
    let p: Paso | null = null;
    if (/\bno molestar\b/.test(c)) {
      const off = /\b(quita\w*|saca\w*|desactiva\w*|apaga\w*|sin)\b/.test(c);
      const s = off ? null : duracionDicha(c);
      p = { tipo: "no_molestar", encender: !off, ...(s ? { minutos: Math.max(1, Math.round(s / 60)) } : {}) };
    } else if (/\b(entrenador|entreno|entrenamiento|rutina|forge)\b/.test(c)) p = { tipo: "entrenador" };
    else if (/\b(cierre|resumen|balance) del dia\b/.test(c)) p = { tipo: "cierre_dia" };
    else if (/\bconstantes\b/.test(c)) p = { tipo: "constantes" };
    else if (/\balarma\b.*\b(dormir|sueno|necesito|necesite)\b/.test(c)) p = { tipo: "alarma_sueno" };
    else if (/\b(mi agenda|mi dia|la agenda|que tengo|lo que tengo)\b/.test(c)) p = { tipo: "agenda" };
    else if (/\bbienvenida\b/.test(c)) p = { tipo: "bienvenida" };
    else if (/\b(lo de fondo|trabajos de fondo|los trabajos|lo pendiente)\b/.test(c)) p = { tipo: "fondo", quieto: /\b(pausa\w*|deten\w*|para\w*|quiet\w*|deja\w*|espera\w*)\b/.test(c) && !/\b(sigue|retoma|avanza|continua)\w*\b/.test(c) };
    else if (/^(?:pon|sigue|dale|empieza)(?: con)? (?:mi |la |tu |algo de )?musica$|^(?:mi |la )?musica$/.test(c)) p = { tipo: "musica" };
    if (!p) {
      const op = parseTelefono(c, apps);
      if (op && A_OTROS.has(op.accion)) { aOtros.push(crudo); continue; }
      // (y aunque no se entienda entero: si habla de mensajes o llamadas, no va)
      if (!op && /\b(whatsapp|wsp|wasap|sms|mensajes?|mensajito|correos?|mails?|llama(?:r|le|la)?|marca(?:le)?|escribe(?:le)?|dile|avisale|mandale|enviale)\b/.test(c)) { aOtros.push(crudo); continue; }
      if (op && OPS_PROTOCOLO.has(op.accion) && !(op.accion === "musica" && op.que === "que_suena")) {
        const { reemplaza: _r, ...limpio } = op as any;
        p = { tipo: "telefono", op: limpio };
      }
    }
    if (p) pasos.push(p); else noEntendi.push(crudo);
  }
  return { pasos: pasos.slice(0, MAX_PASOS), noEntendi, aOtros };
}

/** «crea un protocolo lectura que …» → el nombre (si lo dijo) y lo demás */
export function nombreYPasos(resto: string): { nombre: string | null; pasos: string } {
  const r = fold(resto).replace(/^[\s:,]+/, "");
  if (/^(?:que|para que) (?!se llame)/.test(r)) return { nombre: null, pasos: r };
  const m = /^(?:(?:que se llame|que se llama|llamado|llamada|de nombre|con el nombre(?: de)?|nombre|para(?: el| la)?)\s+)?([a-z0-9ñ]+(?: [a-z0-9ñ]+){0,2}?)\s*(?:[:,]\s*|\s+(?:y )?(?:que|para que|con|donde)\s+|$)(.*)$/.exec(r);
  if (!m) return { nombre: null, pasos: r };
  const nombre = m[1].trim();
  // (si el «nombre» ya es una orden, no había nombre: «crea un protocolo no molestar por una hora»)
  if (/\b(no molestar|pon|baja|sube|abre|alarma|volumen|musica|linterna)\b/.test(nombre)) return { nombre: null, pasos: r };
  return { nombre, pasos: m[2] ?? "" };
}

const RESERVADOS = new Set(["protocolo", "protocolos", "modo", "nuevo", "otro", "un", "una"]);

/** El protocolo nuevo, listo para confirmar */
export function armarPropio(nombre: string, pasos: Paso[], ahora = new Date()): Protocolo {
  const n = plegarNombre(nombre);
  const base = BASE.get(n);
  const dnds = pasos.map((p) => (p.tipo === "no_molestar" && p.encender ? p.minutos ?? 0 : p.tipo === "telefono" && p.op.accion === "no_molestar" && p.op.encender !== false ? p.op.minutos ?? 0 : 0));
  const dur = Math.max(0, ...dnds) || null;
  return {
    nombre: n, titulo: base?.titulo ?? cap(nombre.trim().slice(0, 40)), alias: base ? [...base.alias] : [n], pasos,
    hablar: base?.hablar ?? (dnds.some((x) => x > 0) || pasos.some((p) => p.tipo === "no_molestar" && p.encender) ? "urgente" : "todo"),
    duracionMin: base && !pasos.some((p) => p.tipo === "no_molestar" && p.delProtocolo) ? dur ?? base.duracionMin : dur ?? base?.duracionMin ?? null,
    propio: true, creado: ahora.toISOString(),
  };
}

export async function guardarPropio(p: Protocolo): Promise<void> {
  await cambiarEstado((e) => { e.protocolos = [...e.protocolos.filter((x) => x.nombre !== p.nombre), { ...p, propio: true }].slice(-MAX_PROPIOS); });
}
/** Borra el tuyo (o tu versión de uno de los que vienen: vuelve el de siempre). El nombre como estaba, o null */
export async function borrarPropio(nombre: string): Promise<string | null> {
  const e = await leerEstado();
  const p = buscarProtocolo(nombre, e.protocolos);
  if (!p) return null;
  await cambiarEstado((x) => { x.protocolos = x.protocolos.filter((y) => y.nombre !== p.nombre); if (x.protocolo?.nombre === p.nombre && !BASE.has(p.nombre)) x.protocolo = null; });
  return p.titulo;
}

// ─── Lo que se dice ─────────────────────────────────────────────────────────────
type Pedido =
  | { que: "activar"; nombre: string; minutos: number | null; modo: boolean }
  | { que: "sugerir"; nombre: string }
  | { que: "terminar"; nombre: string | null; explicito: boolean }
  | { que: "estado" } | { que: "listar" } | { que: "describir"; nombre: string }
  | { que: "crear"; resto: string } | { que: "borrar"; nombre: string } | { que: "restaurar"; nombre: string };

const limpiar = (texto: string) => fold(texto).replace(/[,]+/g, " ").replace(/\s+/g, " ").trim().replace(/^(?:(?:oye|ok|okey|hey|ya|hola) )?(?:hestia|eris) /, "").replace(/ (?:hestia|eris)$/, "").replace(/ (?:por favor|porfa)$/, "");
const ACTIVA = "(?:activa|activame|activar|inicia|iniciame|iniciar|arranca|arrancame|empieza|empezar|comienza|ejecuta|corre|lanza|pon|ponme|entra en|entrar en|vamos con|dale con|dale al|dale a|quiero el|quiero)";

/** ¿Habla de un protocolo? (y qué). null = no es esto. */
export function entender(texto: string): Pedido | null {
  const t = limpiar(texto);
  if (!t || t.length > 300) return null;
  let m = /^(?:(?:puedes|podrias|quiero) )?(?:crea|creame|crear|haz|hazme|arma|armame|agrega|agregame|programa|programame|configura|configurame|anade|nuevo)(?:r)? (?:un |una |el |otro )?(?:nuevo )?protocolo\b(.*)$/.exec(t);
  if (m) return { que: "crear", resto: m[1] };
  if (/^nuevo protocolo\b/.test(t)) return { que: "crear", resto: t.replace(/^nuevo protocolo/, "") };
  m = /^(?:borra|borrame|elimina|eliminame|quita|saca)(?:r)? (?:el |mi )?protocolo (.{2,40})$/.exec(t);
  if (m) return { que: "borrar", nombre: m[1] };
  m = /^(?:restaura|restablece|resetea|reinicia|vuelve a dejar|deja)(?:r)? (?:el )?protocolo (.{2,40}?)(?: como (?:venia|estaba|era|antes)| de antes| original)?$/.exec(t);
  if (m) return { que: "restaurar", nombre: m[1] };
  if (/^(?:que|cuales) protocolos (?:tengo|hay|tienes|existen|me sabes)\b|^(?:mis|los) protocolos$|^lista(?:me)? (?:de )?(?:los |mis )?protocolos$|^protocolos$/.test(t)) return { que: "listar" };
  m = /^(?:que|como) (?:hace|es|funciona|incluye|tiene|trae) (?:el |mi )?(?:protocolo|modo) (.{2,40})$|^(?:explicame|cuentame|dime) (?:que hace |como es )?(?:el |mi )?protocolo (.{2,40})$/.exec(t);
  if (m) return { que: "describir", nombre: (m[1] ?? m[2]).trim() };
  if (/^(?:que|cual) (?:protocolo|modo) (?:esta|tengo|hay|tienes) (?:activo|puesto|corriendo|encendido)|^(?:estoy|sigo|estamos) en (?:algun |el )?(?:protocolo|modo)\b|^(?:cuanto|cuanto tiempo) (?:le )?(?:queda|falta)(?: al| del| de| para que termine el| para terminar el)? (?:protocolo|modo|foco|bloque)\b|^(?:cuanto|cuanto tiempo) (?:me )?queda de foco$/.test(t)) return { que: "estado" };
  m = /^(?:termina|terminar|terminalo|finaliza|cierra|apaga|desactiva|quita|deten|para|corta|sal(?:ir|te)? de|salgamos de|fin de|fin del)(?:r)? (?:el |la |al |del )?(?:protocolo|modo)(?: (.{2,40}))?$/.exec(t);
  if (m) return { que: "terminar", nombre: m[1]?.trim() || null, explicito: true };
  // (sin decir «protocolo»: solo si es justo el que está corriendo; si no, sigue lo de siempre: «terminé el entreno» es de Forge)
  m = /^(?:ya )?(?:termine|acabe|listo con|se acabo|termina|terminemos|corta|para)(?: con)? (?:el |la |mi )?(foco|gimnasio|gym|gim|entreno|estudio|bloque de foco)$/.exec(t)
    ?? /^fin del? (foco|gimnasio|gym)$/.exec(t);
  if (m) return { que: "terminar", nombre: m[1].replace(/^bloque de /, ""), explicito: false };
  m = new RegExp(`^(?:${ACTIVA} )?(?:el |la |al |mi )?(protocolo|modo) (.{2,60})$`).exec(t);
  if (m) {
    const resto = m[2];
    const dm = /^(.+?) (?:por|durante|de) (.+)$/.exec(resto);
    const s = dm ? duracionDicha(dm[2]) : null;
    return { que: "activar", nombre: (s ? dm![1] : resto).trim(), minutos: s ? Math.max(1, Math.round(s / 60)) : null, modo: m[1] === "modo" };
  }
  // lo natural: se pregunta antes («¿Activo el protocolo dormir?»)
  if (/^(?:ya )?(?:me voy a (?:dormir|acostar)|voy a dormir|me voy a la cama|hora de dormir|a dormir|me acuesto)(?: ya)?$/.test(t)) return { que: "sugerir", nombre: "dormir" };
  if (/^(?:me voy al|voy al|voy camino al|llegue al|estoy en el|ando en el) (?:gym|gimnasio|gim)$/.test(t)) return { que: "sugerir", nombre: "gimnasio" };
  if (/^(?:voy saliendo|ya salgo|me voy de la casa|salgo de la casa|voy a salir)(?: de la casa)?$/.test(t)) return { que: "sugerir", nombre: "salir" };
  if (/^(?:voy a|necesito|quiero) (?:concentrarme|estudiar|enfocarme)(?: un rato)?$/.test(t)) return { que: "sugerir", nombre: "foco" };
  return null;
}

// ─── Lo que espera tu respuesta (por cuenta; 2 minutos) ──────────────────────────
type Pend = { tipo: "activar"; nombre: string; at: number } | { tipo: "crear"; p: Protocolo; at: number } | { tipo: "nombre"; pasos: Paso[]; at: number } | { tipo: "pc"; at: number };
const PEND = new Map<string, Pend>();
const PEND_MS = 2 * 60_000;
export function _olvidarProtocolos(): void { PEND.clear(); }
/** ¿Espera la respuesta a algo de un protocolo? (para que el resto no la tome) */
export function esperaProtocolo(profileId: string): boolean { const p = PEND.get(profileId); return !!p && Date.now() - p.at < PEND_MS; }

const AVANZA = /^(?:si|sip|dale|avanza\w*|sigue|siguelo|continua|hazlo|aprovecha|avanzalo|que siga|adelante|ok|ya)\b/;
const QUIETO = /\b(quieto|dejalo|deja(?:lo)? quieto|no|para|pausa\w*|espera|nada|detenlo|mejor no)\b/;

/** Lo pidió en el chat o en la llamada: si es de protocolos, lo hace y dice qué; si no, null */
export async function comandoProtocolo(texto: string, c: CtxProtocolo): Promise<RespuestaProtocolo | null> {
  const ahora = c.ahora ?? new Date();
  const e = await leerEstado();
  const lista = listaProtocolos(e);
  const pend = PEND.get(c.profileId);
  if (pend) {
    PEND.delete(c.profileId);
    if (Date.now() - pend.at < PEND_MS) {
      const t = limpiar(texto);
      if (pend.tipo === "pc") {
        if (QUIETO.test(t) && !AVANZA.test(t.replace(/^no /, "x "))) {
          await cambiarEstado((x) => { x.fondoQuieto = "saliste de casa (lo pediste)"; });
          return { texto: "Listo: lo dejo quieto hasta que vuelvas." };
        }
        if (AVANZA.test(t)) return { texto: `Listo, sigo con eso${conTrato(c.trato)}. Te aviso al terminar.` };
      } else {
        const sn = respuestaSiNo(texto);
        if (pend.tipo === "activar") {
          if (sn === "si") { const p = buscarProtocolo(pend.nombre, lista); if (p) return await activar(p, c); }
          if (sn === "no") return { texto: "Ok." };
        }
        if (pend.tipo === "crear") {
          if (sn === "si") {
            if (c.bloqueado) return { texto: "Para guardar protocolos, desbloquea el teléfono." };
            await guardarPropio(pend.p);
            return { texto: `Guardado: el protocolo ${pend.p.titulo}. Cuando quieras, dime «protocolo ${pend.p.titulo.toLowerCase()}».` };
          }
          if (sn === "no") return { texto: "Ok, no lo guardo." };
        }
        if (pend.tipo === "nombre" && !sn && t && t.split(" ").length <= 3 && !entender(texto)) {
          const nombre = t.replace(/^(?:se llama|llamalo|ponle|que se llame|el nombre es) /, "");
          if (!RESERVADOS.has(plegarNombre(nombre))) return confirmarNuevo(nombre, pend.pasos, c, lista, [], []);
        }
        if (pend.tipo === "nombre" && sn === "no") return { texto: "Ok, lo dejo." };
      }
    }
  }
  const q = entender(texto);
  if (!q) return null;
  switch (q.que) {
    case "listar": {
      const act = protocoloVigente(e, ahora);
      return { texto: `Tus protocolos: ${juntar(lista.map((p) => tituloDicho(p)))}.${act ? ` Ahora está activo ${act.titulo.toLowerCase()}${act.hasta ? `, hasta las ${hhmm(Date.parse(act.hasta))}` : ""}.` : ""} Para crear otro, dime por ejemplo «crea un protocolo lectura que ponga no molestar por una hora».` };
    }
    case "describir": {
      const p = buscarProtocolo(q.nombre, lista);
      if (!p) return { texto: `No tengo un protocolo «${q.nombre}». Tengo ${juntar(lista.map((x) => tituloDicho(x)))}.` };
      return { texto: `El protocolo ${tituloDicho(p)} hace esto: ${describirProtocolo(p)}.${p.propio && BASE.has(p.nombre) ? " Es tu versión; para volver al de siempre, dime «restaura el protocolo " + p.nombre + "»." : ""}` };
    }
    case "estado": {
      const act = protocoloVigente(e, ahora);
      if (!act) return { texto: "No hay ningún protocolo activo." };
      const quedan = act.hasta ? Math.max(1, Math.round((Date.parse(act.hasta) - ahora.getTime()) / 60_000)) : null;
      return { texto: `Está activo ${act.titulo.toLowerCase()}${act.hasta ? `, hasta las ${hhmm(Date.parse(act.hasta))} (quedan ${minutosDichos(quedan!)})` : ""}.` };
    }
    case "terminar": {
      if (!q.explicito) {
        const act = protocoloVigente(e, ahora);
        const p = q.nombre ? buscarProtocolo(q.nombre, lista) : null;
        if (!act || !p || p.nombre !== act.nombre) return null;
      }
      return await terminar(c, q.nombre);
    }
    case "borrar": {
      if (c.por === "panel") return null;
      if (c.bloqueado) return { texto: "Para borrar protocolos, desbloquea el teléfono." };
      const t = await borrarPropio(q.nombre);
      if (t) return { texto: BASE.has(plegarNombre(t)) ? `Listo: borré tu versión; el protocolo ${t.toLowerCase()} vuelve a ser el de siempre.` : `Listo, borré el protocolo ${t}.` };
      return { texto: buscarProtocolo(q.nombre, lista) ? "Ese viene hecho y no se borra; si no lo quieres, no lo uses (o crea tu versión con el mismo nombre)." : `No tengo un protocolo «${q.nombre}».` };
    }
    case "restaurar": {
      if (c.bloqueado) return { texto: "Para cambiar protocolos, desbloquea el teléfono." };
      const b = buscarProtocolo(q.nombre, PROTOCOLOS_BASE);
      if (!b) return { texto: `«${q.nombre}» no es de los que vienen hechos.` };
      if (!e.protocolos.some((x) => x.nombre === b.nombre)) return { texto: `El protocolo ${b.titulo.toLowerCase()} ya es el de siempre.` };
      await borrarPropio(b.nombre);
      return { texto: `Listo: el protocolo ${b.titulo.toLowerCase()} vuelve a ser el de siempre (${describirProtocolo(b)}).` };
    }
    case "crear": {
      if (c.bloqueado) return { texto: "Para crear protocolos, desbloquea el teléfono." };
      const { nombre, pasos: textoPasos } = nombreYPasos(q.resto);
      const r = pasosDe(textoPasos, c.deps.apps);
      if (!r.pasos.length) {
        const otros = r.aOtros.length ? " Mandar mensajes o llamar no lo meto en un protocolo: eso siempre te lo pregunto aparte." : "";
        return { texto: `¿Qué tiene que hacer?${otros} Dime, por ejemplo: «crea un protocolo lectura que ponga no molestar por una hora y baje el volumen».` };
      }
      if (!nombre || RESERVADOS.has(plegarNombre(nombre))) {
        PEND.set(c.profileId, { tipo: "nombre", pasos: r.pasos, at: Date.now() });
        return { texto: `Haría esto: ${juntar(r.pasos.map((x) => describirPaso(x)))}. ¿Cómo lo llamo?` };
      }
      return confirmarNuevo(nombre, r.pasos, c, lista, r.noEntendi.map((x) => delOriginal(texto, x)), r.aOtros);
    }
    case "sugerir": {
      const p = buscarProtocolo(q.nombre, lista);
      if (!p) return null;
      const act = protocoloVigente(e, ahora);
      if (act?.nombre === p.nombre) return null; // (ya está: lo dicho sigue a lo de siempre)
      PEND.set(c.profileId, { tipo: "activar", nombre: p.nombre, at: Date.now() });
      return { texto: `¿Activo el protocolo ${tituloDicho(p)}? (${describirProtocolo(p)})` };
    }
    case "activar": {
      const p = buscarProtocolo(q.nombre, lista);
      if (!p) {
        if (q.modo) return null; // «modo silencio», «modo avión»: no es de esto
        return { texto: `No tengo un protocolo «${q.nombre}». Tengo ${juntar(lista.map((x) => tituloDicho(x)))}; para crear uno, dime «crea un protocolo ${q.nombre} que…».` };
      }
      return await activar(p, c, q.minutos);
    }
  }
  return null;
}

/** El trozo como lo dijo (con sus tildes y mayúsculas), para repetírselo; si no se encuentra, tal cual */
function delOriginal(original: string, trozo: string): string {
  const m = plegarConMapa(original);
  const i = m.t.indexOf(trozo);
  if (i < 0 || !trozo) return trozo;
  const fin = m.pos[i + trozo.length - 1];
  return fin == null ? trozo : original.slice(m.pos[i], fin + 1);
}

function confirmarNuevo(nombre: string, pasos: Paso[], c: CtxProtocolo, lista: Protocolo[], noEntendi: string[], aOtros: string[]): RespuestaProtocolo {
  const p = armarPropio(nombre, pasos);
  const yaEra = lista.find((x) => x.nombre === p.nombre);
  PEND.set(c.profileId, { tipo: "crear", p, at: Date.now() });
  const extra = [
    noEntendi.length ? `No entendí «${noEntendi.slice(0, 2).join("», «")}», así que eso no va.` : "",
    aOtros.length ? "Mandar mensajes o llamar no lo meto en un protocolo: eso siempre te lo pregunto aparte." : "",
    yaEra ? (BASE.has(p.nombre) ? `Reemplaza al que viene hecho (para volver a él: «restaura el protocolo ${p.nombre}»).` : "Reemplaza al que ya tenías con ese nombre.") : "",
  ].filter(Boolean).join(" ");
  return { texto: `El protocolo ${p.titulo} haría esto: ${describirProtocolo(p)}.${extra ? ` ${extra}` : ""} ¿Lo guardo?` };
}

/** Para el panel: cada uno con sus pasos dichos */
export function resumenProtocolos(e: EstadoHestia, ahora = new Date()): { lista: Array<{ nombre: string; titulo: string; pasos: string[]; propio: boolean; base: boolean; hablar: HablarProtocolo; duracionMin: number | null }>; activo: ProtocoloActivo | null } {
  return {
    lista: listaProtocolos(e).map((p) => ({ nombre: p.nombre, titulo: p.titulo, pasos: p.pasos.map((x) => describirPaso(x, p.duracionMin)), propio: !!p.propio, base: BASE.has(p.nombre), hablar: p.hablar, duracionMin: p.duracionMin })),
    activo: protocoloVigente(e, ahora),
  };
}

/**
 * Al llegar a casa (L1, la bienvenida): si al salir lo dejaste quieto, lo de fondo sigue; y si cambiaste el protocolo «casa»,
 * sus pasos del teléfono. Lo que hizo, para sumarlo a la bienvenida (o null).
 */
export async function alLlegar(c: CtxProtocolo): Promise<string | null> {
  const e = await leerEstado();
  const hechos: string[] = [];
  if (e.fondoQuieto) { await cambiarEstado((x) => { x.fondoQuieto = null; }); hechos.push("retomo lo pendiente en el PC"); }
  const casa = e.protocolos.find((p) => p.nombre === "casa");
  if (casa && c.deps.telefono) {
    for (const paso of casa.pasos) {
      const op: TelefonoOp | null = paso.tipo === "telefono" ? paso.op : paso.tipo === "no_molestar" ? { accion: "no_molestar", encender: paso.encender, ...(paso.minutos ? { minutos: paso.minutos } : {}) } : paso.tipo === "musica" ? { accion: "musica", que: "sigue" } : null;
      if (!op) continue;
      const r = await c.deps.telefono(op).catch(() => null);
      if (r?.ok) hechos.push(fraseTel(op, r));
    }
  }
  return hechos.length ? `${cap(juntar(hechos))}.` : null;
}
