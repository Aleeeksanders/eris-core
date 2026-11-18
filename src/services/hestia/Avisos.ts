// ============================================================
// Hestia como JARVIS · L2 (2026-11-17): avisos que hablan. Lo que pasa en el teléfono y Hestia te dice, por código:
//  - una llamada que entra: «Te llama Mamá» mientras suena (con audífonos); en la llamada con ella, «¿Contesto?»;
//  - un mensaje de tus contactos importantes (solo de quién, nunca el texto: eso lo pides tú, desbloqueado);
//  - un cargo del banco fuera de lo común: «¿lo reconoces?» (la plata solo con el teléfono desbloqueado: K5);
//  - la agenda: una reunión en 15 minutos y la hora de tus remedios o suplementos.
// Lo que llega del teléfono (hestia_evento) es entrada externa: se valida acá y nunca trae textos de mensajes.
// Todo pasa por el Altavoz (C3) y las Interrupciones (C5). Solo Hestia (Ikaros en Modo AXS).
// ============================================================
import { clavePersona } from "./Estado.js";
import type { AvisoAltavoz, PreguntaAviso } from "./Altavoz.js";
import { respuestaSiNo } from "../voz/AprobacionVoz.js";
import { esTitulo } from "../voz/Escaner.js";

export interface EventoLlamada {
  tipo: "llamada";
  estado: "sonando" | "en_curso" | "fin";
  /** el nombre como lo tienes en tus contactos (o el número, si no lo tienes guardado); null = privado */
  de: string | null;
  /** lo tienes guardado (el nombre no es un número) */
  conocido: boolean;
  /** «Teléfono», «WhatsApp»… */
  app: string;
  /** el teléfono la marcó como posible spam */
  spam: boolean;
  /** los últimos dígitos de un número que no tienes guardado */
  final4: string | null;
  /** la misma llamada (para saber cuándo terminó) */
  clave: string;
  t: number;
}
export interface EventoMensaje { tipo: "mensaje"; de: string; chat: string; grupo: boolean; app: string; t: number }
export interface EventoCargo {
  tipo: "cargo";
  /** la clave del aviso del banco */
  id: string;
  /** el movimiento en Finanzas (si se anotó) */
  txId: string | number | null;
  monto: number;
  comercio: string;
  /** por qué es raro («comercio nuevo», «mucho más de lo que sueles gastar ahí») */
  razon: string;
  /** quedó en «Por confirmar» (no se anotó solo) */
  porConfirmar: boolean;
  t: number;
}
export type EventoHestia = EventoLlamada | EventoMensaje | EventoCargo;

const txt = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");

/** Valida lo que manda el teléfono (es entrada externa). null = no sirve. */
export function eventoDe(x: any, ahora = Date.now()): EventoHestia | null {
  if (!x || typeof x !== "object") return null;
  const t = typeof x.t === "number" && Number.isFinite(x.t) && Math.abs(ahora - x.t) < 6 * 3_600_000 ? x.t : ahora;
  if (x.tipo === "llamada") {
    const estado = x.estado === "sonando" || x.estado === "en_curso" || x.estado === "fin" ? x.estado : null;
    if (!estado) return null;
    const de = txt(x.de, 40) || null;
    const final4 = typeof x.final4 === "string" && /^\d{3,4}$/.test(x.final4) ? x.final4 : null;
    return { tipo: "llamada", estado, de, conocido: x.conocido === true && !!de && !pareceNumero(de), app: txt(x.app, 30) || "Teléfono", spam: x.spam === true, final4, clave: txt(x.clave, 80) || `llamada-${t}`, t };
  }
  if (x.tipo === "mensaje") {
    const de = txt(x.de, 40), chat = txt(x.chat, 60) || de;
    if (!de && !chat) return null;
    return { tipo: "mensaje", de: de || chat, chat, grupo: x.grupo === true, app: txt(x.app, 30) || "Mensajes", t };
  }
  if (x.tipo === "cargo") {
    const monto = Number(x.monto), id = txt(x.id, 120);
    if (!id || !Number.isFinite(monto) || monto <= 0 || monto > 1e10) return null;
    const txId = typeof x.txId === "number" || (typeof x.txId === "string" && x.txId.length <= 60) ? x.txId : null;
    return { tipo: "cargo", id, txId, monto: Math.round(monto), comercio: txt(x.comercio, 50) || "un comercio", razon: txt(x.razon, 80), porConfirmar: x.porConfirmar === true, t };
  }
  return null;
}

/** «+56 9 1234 5678», «912345678», «Privado» → no es un contacto guardado */
export const pareceNumero = (s: string) => (s.match(/\d/g) ?? []).length >= 5 || /^(privado|desconocido|unknown|private|no disponible|numero privado)$/i.test(s.trim());

// ─── La llamada que está sonando ahora (para «contesta», «recházala», «¿quién llama?») ───
type Entrante = { de: string | null; conocido: boolean; final4: string | null; app: string; clave: string; t: number };
let entrante: Entrante | null = null;
/** El teléfono avisó que entra, se contestó o terminó una llamada */
export function registrarLlamada(e: EventoLlamada): void {
  if (e.estado === "sonando") entrante = { de: e.de, conocido: e.conocido, final4: e.final4, app: e.app, clave: e.clave, t: e.t };
  else if (!entrante || entrante.clave === e.clave || e.estado === "en_curso") entrante = null;
}
/** La que está sonando (una llamada no suena más de un minuto: después, ya no cuenta) */
export function llamadaEntrante(ahora = Date.now()): Entrante | null {
  return entrante && ahora - entrante.t < 75_000 ? entrante : null;
}
/** Para las pruebas */
export function _olvidarLlamada(): void { entrante = null; }

// ─── Textos ───
const porApp = (app: string): string => {
  if (/whatsapp/i.test(app)) return " por WhatsApp";
  if (/telegram/i.test(app)) return " por Telegram";
  if (/instagram/i.test(app)) return " por Instagram";
  if (/messenger/i.test(app)) return " por Messenger";
  if (/^mensajes$/i.test(app)) return " por mensaje de texto";
  if (!app || /tel[eé]fono|phone|dialer|llamadas/i.test(app)) return "";
  return ` por ${app}`;
};
/** «Alesito, te…» / «Señor, le…» / «Te…» */
const vocativo = (trato: string | null | undefined, verbo: string) => {
  const usted = esTitulo(trato);
  const v = usted ? verbo.replace(/^te /, "le ") : verbo;
  return trato ? `${trato}, ${v}` : v.charAt(0).toUpperCase() + v.slice(1);
};
/** «Te llama Mamá», «un número que no tienes guardado, terminado en 5 6 7 8», «un número privado» */
export function quienLlama(e: Pick<EventoLlamada, "de" | "conocido" | "final4">, usted = false): string {
  if (e.de && e.conocido) return e.de;
  if (e.final4) return `un número que no ${usted ? "tiene" : "tienes"} guardado, terminado en ${e.final4.split("").join(" ")}`;
  return "un número privado";
}

/** «¿Quién llama?» → «Te llama Mamá por WhatsApp.» */
export function textoQuienLlama(e: Entrante, trato?: string | null): string {
  return `${vocativo(trato, "te llama")} ${quienLlama(e, esTitulo(trato))}${porApp(e.app)}.`;
}

/** «Te llama Mamá por WhatsApp.» (en la llamada con ella: «… ¿Contesto?») */
export function avisoLlamada(e: EventoLlamada, o: { trato?: string | null } = {}): AvisoAltavoz {
  const usted = esTitulo(o.trato);
  let texto = `${vocativo(o.trato, "te llama")} ${quienLlama(e, usted)}${porApp(e.app)}.`;
  if (e.spam) texto += " Ojo: el teléfono dice que puede ser spam.";
  return {
    clave: `llamada-${e.clave}`, tipo: "llamada", prioridad: "urgente", titulo: "Llamada", texto,
    // mientras suena: sin el calendario (no espera) y una sola vez por llamada
    soloVoz: true, sinReunion: true, repetirMin: 3,
    enLaLlamada: { texto: `${texto} ¿Contesto?`, pregunta: { tipo: "llamada", de: e.conocido ? e.de : null } },
  };
}

/** Si el que escribió (o el grupo) está entre tus importantes: a quién se nombra. null = no se avisa. */
export function coincide(nombre: string, importantes: string[]): string | null {
  const k = clavePersona(nombre);
  if (!k) return null;
  for (const imp of importantes) {
    const i = clavePersona(imp);
    if (i && (k === i || k.startsWith(`${i} `))) return imp;
  }
  return null;
}
export function importanteDe(e: EventoMensaje, importantes: string[]): { quien: string; porGrupo: boolean } | null {
  if (coincide(e.de, importantes)) return { quien: e.de, porGrupo: false };
  if (e.grupo && coincide(e.chat, importantes)) return { quien: e.chat, porGrupo: true };
  return null;
}

/** «Te escribió Mamá por WhatsApp.» — solo de quién (el texto, si lo pides y con el teléfono desbloqueado) */
export function avisoMensaje(e: EventoMensaje, imp: { quien: string; porGrupo: boolean }, o: { trato?: string | null } = {}): AvisoAltavoz {
  const correo = /gmail|correo|outlook|mail/i.test(e.app);
  const texto = imp.porGrupo
    ? `Hay mensajes nuevos en el grupo ${e.chat}${porApp(e.app)}.`
    : correo ? `${vocativo(o.trato, "te llegó")} un correo de ${e.de}.`
    : e.grupo ? `${e.de} escribió en el grupo ${e.chat}${porApp(e.app)}.`
    : `${vocativo(o.trato, "te escribió")} ${e.de}${porApp(e.app)}.`;
  return {
    clave: `mensaje-${clavePersona(imp.quien)}`, tipo: "mensaje", prioridad: "normal", titulo: "Mensaje", texto,
    // (si sigue escribiendo, no a cada mensaje: una vez cada 20 minutos por persona)
    soloVoz: true, repetirMin: 20, externo: true,
    enLaLlamada: { texto: `${texto} ¿Te lo leo?`, pregunta: { tipo: "mensaje", de: imp.porGrupo ? e.chat : e.de } },
  };
}

const clp = (n: number) => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

/**
 * «Ojo: un cargo de $89.990 en Falabella, más de lo que sueles gastar ahí. ¿Lo reconoces?» Con el teléfono bloqueado (o sin
 * saberlo), sin el monto ni el comercio en voz alta (K5). La notificación lleva «Sí, era yo» / «No, revisar».
 */
export function avisoCargo(e: EventoCargo, o: { trato?: string | null; bloqueado: boolean; bloqueadoLlamada?: boolean }): AvisoAltavoz & { escrito: string } {
  const razon = e.razon ? `, ${e.razon}` : "";
  const conMonto = `Ojo${o.trato ? `, ${o.trato}` : ""}: un cargo de ${clp(e.monto)} en ${e.comercio}${razon}. ¿Lo reconoces?`;
  const sinMonto = `Ojo${o.trato ? `, ${o.trato}` : ""}: hay un cargo en tu tarjeta que no es de lo común. ¿Lo reconoces? Desbloquea el teléfono para ver el monto.`;
  return {
    clave: `cargo-${e.id}`, tipo: "cargo", prioridad: "normal", titulo: "¿Reconoces este cargo?",
    texto: o.bloqueado ? sinMonto : conMonto,
    escrito: `${clp(e.monto)} en ${e.comercio}${e.razon ? ` · ${e.razon}` : ""}.${e.porConfirmar ? " Quedó en «Por confirmar»." : ""}`,
    repetirMin: 24 * 60, botones: "cargo", datos: { id: e.id, txId: e.txId, porConfirmar: e.porConfirmar },
    enLaLlamada: { texto: (o.bloqueadoLlamada ?? o.bloqueado) ? sinMonto : conMonto, pregunta: { tipo: "cargo", id: e.id, txId: e.txId } },
  };
}

// ─── La agenda: la reunión en 15 minutos y la hora del remedio ───
export interface EventoCal { titulo: string; inicio: number; fin: number; todoElDia: boolean }
export interface SupAgenda { items: Array<{ id: string; nombre: string; horas: number[]; aviso: boolean; activo: boolean }>; log: Record<string, Record<string, number>> }

const pad = (n: number) => String(n).padStart(2, "0");
const diaKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);

/** Lo que toca decir ahora (se llama cada minuto; lo ya dicho lo filtra el Altavoz por la clave) */
export function avisosAgenda(o: { ahora: Date; eventos: EventoCal[]; sups: SupAgenda | null; trato?: string | null }): AvisoAltavoz[] {
  const out: AvisoAltavoz[] = [];
  const t = o.ahora.getTime();
  for (const ev of o.eventos) {
    if (!ev || ev.todoElDia || typeof ev.inicio !== "number") continue;
    const min = (ev.inicio - t) / 60_000;
    if (!(min > 8 && min <= 15.5)) continue;
    const titulo = txt(ev.titulo, 60) || "un evento";
    out.push({
      clave: `reunion-${ev.inicio}-${clavePersona(titulo).slice(0, 30)}`, tipo: "reunion", prioridad: "normal", titulo: `En ${Math.round(min)} minutos`,
      texto: `${o.trato ? `${o.trato}, en` : "En"} ${Math.round(min)} minutos empieza «${titulo}».`,
      soloVoz: true, externo: true, repetirMin: 24 * 60,
    });
  }
  // los remedios y suplementos con aviso, a su hora (hasta 5 minutos después) y solo si esa toma no está anotada
  const S = o.sups;
  if (S && Array.isArray(S.items)) {
    const dia = diaKey(o.ahora);
    const ahoraMin = o.ahora.getHours() * 60 + o.ahora.getMinutes();
    const porHora = new Map<number, string[]>();
    for (const it of S.items) {
      if (!it?.activo || !it.aviso || !Array.isArray(it.horas)) continue;
      const horas = [...it.horas].sort((a, b) => a - b);
      horas.forEach((h, i) => {
        const slot = Math.round(h * 60);
        if (ahoraMin < slot || ahoraMin >= slot + 5) return;
        if ((S.log?.[dia]?.[it.id] ?? 0) > i) return;
        porHora.set(slot, [...(porHora.get(slot) ?? []), txt(it.nombre, 40)]);
      });
    }
    for (const [slot, nombres] of porHora) {
      out.push({
        clave: `remedio-${dia}-${slot}`, tipo: "remedio", prioridad: "normal", titulo: "Hora de tus remedios",
        texto: `${o.trato ? `${o.trato}, hora` : "Hora"} de tomar ${juntar(nombres)}.`, soloVoz: true, repetirMin: 24 * 60,
      });
    }
  }
  return out;
}

// ─── Lo que respondes por voz ───
const fold = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,;:…«»"]+/g, " ").replace(/\s+/g, " ").trim()
  .replace(/^(?:(?:oye|ok|okey|hey|ya|bueno|hola) )?h?estia /, "").replace(/ h?estia$/, "").replace(/ (?:por favor|porfa|po)$/, "").trim();

const CONTESTA = /^(contesta(la|le)?|contestala|atiende(la|le)?|responde(la)?|acepta(la)?|pasamela|pasala|dale contesta|si contesta(la)?)( la llamada)?$/;
const RECHAZA = /^(rechaza(la)?|cuelga(la|le)?|corta(la)?|cortala|ignora(la)?|mandala al buzon|no quiero contestar|no (la )?contestes|no contesto)( la llamada)?$/;
const QUIEN = /^(quien (me )?(llama|esta llamando)|quien es|de quien es la llamada|quien me esta llamando)$/;

/** Lo que dices sobre la llamada que está sonando (sin pregunta pendiente): contestarla, rechazarla o «¿quién llama?» */
export function comandoLlamada(texto: string): "contestar" | "rechazar" | "quien" | null {
  const t = fold(texto);
  if (CONTESTA.test(t)) return "contestar";
  if (RECHAZA.test(t)) return "rechazar";
  if (QUIEN.test(t)) return "quien";
  return null;
}

export type RespuestaPregunta =
  | { accion: "contestar"; decir: string }
  | { accion: "rechazar"; decir: string }
  | { accion: "dejar"; decir: string }
  | { accion: "cargo"; era: boolean; decir: string }
  /** «¿Te lo leo?» «Sí» → lo mismo que «lee los mensajes de Pedro» (con sus reglas: desbloqueado) */
  | { accion: "leer"; texto: string };

/** ¿Contestaste lo que Hestia preguntó? null = otra cosa (cambió de tema: la pregunta se descarta) */
export function responderPregunta(texto: string, p: Pick<PreguntaAviso, "tipo"> & Partial<PreguntaAviso> & { de?: string | null }): RespuestaPregunta | null {
  const t = fold(texto);
  const sn = respuestaSiNo(texto);
  if (p.tipo === "llamada") {
    if (RECHAZA.test(t) || /\b(rechaza\w*|cuelga\w*|corta\w*|buzon)\b/.test(t)) return { accion: "rechazar", decir: "Listo, la rechacé." };
    if (CONTESTA.test(t) || sn === "si") return { accion: "contestar", decir: "Te la paso." };
    if (sn === "no" || /^(despues|luego|ahora no|deja(la)? sonar)$/.test(t)) return { accion: "dejar", decir: "Ok, la dejo sonar." };
    return null;
  }
  if (p.tipo === "cargo") {
    if (/\b(no lo reconozco|no fui yo|no era yo|no es mio|no es mia|no lo hice)\b/.test(t)) return { accion: "cargo", era: false, decir: CARGO_NO };
    if (/\b(era yo|fui yo|lo hice yo|lo reconozco|es mio|es mia|si era|si fui)\b/.test(t) || sn === "si") return { accion: "cargo", era: true, decir: "Perfecto, queda así." };
    if (sn === "no") return { accion: "cargo", era: false, decir: CARGO_NO };
    return null;
  }
  if (p.tipo === "mensaje") {
    const de = String(p.de ?? "").trim();
    if (de && (sn === "si" || /^(leelo|leemelo|leela|leemela|que dice|que me dijo|que escribio)$/.test(t))) return { accion: "leer", texto: `lee los mensajes de ${de}` };
    if (sn === "no") return { accion: "dejar", decir: "Ok, después." };
    return null;
  }
  return null;
}
const CARGO_NO = "Entonces revísalo con calma: te dejé la notificación con el movimiento. Si no lo reconoces, llama a tu banco para bloquear la tarjeta; eso lo haces tú.";

// ─── «Avísame cuando me escriba Pedro» ───
const AGREGA = [
  /^(?:avisame|dime|cuentame)(?: siempre)? (?:cuando|si) (?:me )?(?:escriba|escribe|escriban|mande|manda|hable|habla)(?: (?:un mensaje|algo|un whatsapp|por whatsapp))? (.{2,40})$/,
  /^(?:avisame|dime) (?:de |cuando lleguen )?(?:los )?mensajes de (.{2,40})$/,
  /^(?:agrega|anade|pon|marca|deja) a (.{2,40}) (?:como|en|entre) (?:importante|importantes|mis contactos importantes|contactos importantes|mis importantes)$/,
];
const QUITA = [
  /^(?:deja de avisarme|ya no me avises|no me avises mas|no me avises) (?:de|cuando (?:me )?escriba) (.{2,40})$/,
  /^(?:saca|quita|borra|elimina) a (.{2,40}) de (?:los |mis )?(?:importantes|contactos importantes)$/,
];
const LISTA = /^(?:de quien(?:es)? me avisas|quienes son (?:mis )?(?:contactos )?importantes|cuales son (?:mis )?contactos importantes|(?:mis )?contactos importantes|de quien me avisas cuando me escriben)$/;

/** El nombre tal como lo dijo (con sus tildes y mayúsculas), buscando en el texto original las palabras plegadas */
export function nombreOriginal(original: string, plegado: string): string {
  const palabras = String(original ?? "").split(/\s+/).map((w) => ({ w: w.replace(/^[¿¡«"']+|[?!.,;:»"']+$/g, ""), k: fold(w) })).filter((x) => x.w);
  const quiero = plegado.split(" ").filter(Boolean);
  for (let i = 0; i + quiero.length <= palabras.length; i++) {
    if (quiero.every((q, j) => palabras[i + j].k === q)) {
      const n = palabras.slice(i, i + quiero.length).map((x) => x.w).join(" ");
      return n.charAt(0).toUpperCase() + n.slice(1);
    }
  }
  return plegado.charAt(0).toUpperCase() + plegado.slice(1);
}

const limpiarNombre = (n: string) => n.replace(/^(?:a |mi |la |el )/, "").replace(/ (?:por whatsapp|por mensaje|en whatsapp)$/, "").trim();

/** «avísame cuando me escriba Pedro» → {agregar: "Pedro"}; «deja de avisarme de Pedro» → {quitar}; «¿de quién me avisas?» → {lista} */
export function pideImportantes(texto: string): { agregar: string } | { quitar: string } | { lista: true } | null {
  const t = fold(texto);
  if (t.length > 90) return null;
  if (LISTA.test(t)) return { lista: true };
  for (const re of AGREGA) { const m = re.exec(t); if (m) { const n = limpiarNombre(m[1]); if (n.length >= 2) return { agregar: nombreOriginal(texto, n) }; } }
  for (const re of QUITA) { const m = re.exec(t); if (m) { const n = limpiarNombre(m[1]); if (n.length >= 2) return { quitar: nombreOriginal(texto, n) }; } }
  return null;
}
