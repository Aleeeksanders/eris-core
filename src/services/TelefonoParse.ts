// ============================================================
// Hestia Manos (K0, 2026-11-16): las órdenes del teléfono que se entienden por CÓDIGO (al instante, sin el modelo de 4B):
// «pon una alarma a las 7», «despiértame a las 6 y media», «temporizador de 10 minutos», «prende la linterna», «sube el volumen»,
// «¿cuánta batería tengo?», «llévame a la casa de mi mamá», «abre Spotify». Si el mensaje habla del PC, no es del teléfono.
// ============================================================

import type { TelefonoOp } from "./TelefonoBridge.js";
import { parseAgendar, pideCalendario } from "./TelefonoK2.js";
import { parseManejo } from "./TelefonoK4.js";

const fold = (t: string) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;]+/g, " ").replace(/\s+/g, " ").trim();

/** Habla del computador: no es del teléfono */
const PC = /\b(pc|computador\w*|computadora|notebook|laptop|windows|escritorio de|en el equipo)\b/;
/** Dice explícitamente el teléfono */
const TEL = /\b(celu\w*|telefono|movil|en mi cel)\b/;

const NUM: Record<string, number> = { una: 1, uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  quince: 15, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50, media: 30, medio: 30 };
const numero = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : NUM[s] ?? null);

/** «a las 7», «a las 7:30», «a las 7 y media», «a las 8 y cuarto», «a la una de la tarde», «a las 19:00», «7 am» → {hora, minuto} */
export function horaDicha(texto: string): { hora: number; minuto: number } | null {
  const t = fold(texto);
  // («a eso de las siete y cuarto», «como a las 8», «tipo 7»: el modelo de 4B leyó «siete y cuarto» como 7:30; banco «voz»)
  // (2026-11-17, banco telefono_banco: «a las 7 menos cuarto» quedaba a las 7:00; «alarma 6:40», sin «a las», no se entendía)
  const m = /\b(?:a|para|como a|tipo|cerca de)\s+(?:eso de\s+)?(?:las?\s+)?(\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?:\s*[:.h]\s*(\d{2})|\s+y\s+(media|cuarto|\d{1,2})|\s+menos\s+(cuarto|\d{1,2}|cinco|diez|veinte|veinticinco))?\s*(am|pm|de la manana|de la tarde|de la noche|de la madrugada|hrs?|horas)?\b/.exec(t)
    ?? /\b(\d{1,2})(?:\s*[:.]\s*(\d{2}))?()()\s*(am|pm)\b/.exec(t)
    ?? /\b(\d{1,2})\s*:\s*(\d{2})()()()\b/.exec(t);
  if (!m) return null;
  let h = numero(m[1]);
  if (h == null || h > 23) return null;
  let min = m[2] ? Number(m[2]) : m[3] === "media" ? 30 : m[3] === "cuarto" ? 15 : m[3] ? Number(m[3]) : 0;
  if (m[4]) {
    // «las 7 menos cuarto» = 6:45; «las 8 menos 10» = 7:50
    const resta = m[4] === "cuarto" ? 15 : numero(m[4]);
    if (resta == null || resta <= 0 || resta >= 60) return null;
    h = (h + 23) % 24;
    min = 60 - resta;
  }
  if (min > 59) return null;
  const q = m[5] ?? "";
  if (/pm|tarde|noche/.test(q) && h < 12) h += 12;
  if (/am|manana|madrugada/.test(q) && h === 12) h = 0;
  return { hora: h, minuto: min };
}

/** «10 minutos», «una hora y media», «media hora», «30 segundos», «1 h 20 min» → segundos */
export function duracionDicha(texto: string): number | null {
  const t = fold(texto);
  if (/\bmedia hora\b/.test(t) && !/\by media\b/.test(t)) return 1800;
  if (/\b(un )?cuarto de hora\b/.test(t)) return 900;
  let total = 0;
  const re = /\b(\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta|cuarenta|cincuenta)\s*(horas?|hrs?|h|minutos?|mins?|m|segundos?|segs?|s)\b(\s+y\s+media)?/g;
  for (const m of t.matchAll(re)) {
    const n = numero(m[1]);
    if (n == null) continue;
    const u = m[2];
    const f = /^h/.test(u) ? 3600 : /^m/.test(u) ? 60 : 1;
    total += n * f + (m[3] ? f / 2 : 0);
  }
  return total > 0 ? Math.round(total) : null;
}

/** «… para ir al gym» → «ir al gym» (el nombre de la alarma o del temporizador) */
function para(t: string): string | undefined {
  // (no es el nombre: «para las 7», «para la una», «para mañana», «para el lunes»; sí: «para la pasta», «para ir al gym»)
  const m = /\bpara\s+(?!las?\s+(?:\d|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b|el (?:celu|telefono)\b|(?:manana|hoy|pasado|esta|este|el (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b)(.{3,40})$/.exec(t);
  return m ? m[1].trim() : undefined;
}

const plano = (s: string) => fold(s).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
/** Cómo se le dice a las apps más usadas */
// (2026-11-17, su llamada real: «abre el calendario» no abría nada: en su Pixel la app se llama «Calendar». Las de Google se
// llaman en inglés o en español según el teléfono: se prueban los dos nombres)
const ALIAS: Record<string, string | string[]> = { wsp: "whatsapp", wasap: "whatsapp", guasap: "whatsapp", whats: "whatsapp", mapas: "maps", "google maps": "maps",
  galeria: ["fotos", "photos", "galeria"], insta: "instagram", yt: "youtube", correo: "gmail", ajustes: "ajustes", configuracion: "ajustes",
  calendario: ["calendar", "calendario", "google calendar"], agenda: ["calendar", "calendario"], "el calendario": ["calendar", "calendario"],
  reloj: ["reloj", "clock"], camara: ["camara", "camera"], fotos: ["fotos", "photos"], mensajes: ["mensajes", "messages"],
  contactos: ["contactos", "contacts"], telefono: ["telefono", "phone"], archivos: ["archivos", "files"], calculadora: ["calculadora", "calculator"],
  grabadora: ["grabadora", "recorder"], notas: ["keep", "notas", "keep notes"], tareas: ["tasks", "tareas"] };

/** ¿El nombre dicho es una de sus apps? (la etiqueta tal cual, o el comienzo) */
export function appDelTelefono(nombre: string, apps: string[]): string | null {
  const q0 = plano(nombre).replace(/^(la app( de)?|la aplicacion( de(l)?)?|app( de)?|el|la)\s+/, "");
  const qs = ([] as string[]).concat(ALIAS[q0] ?? q0);
  const lista = apps.map((a) => ({ a, p: plano(a) }));
  for (const q of qs) if (q) { const x = lista.find((y) => y.p === q); if (x) return x.a; }
  for (const q of qs) if (q && q.length >= 3) { const x = lista.find((y) => y.p.startsWith(q)); if (x) return x.a; }
  return null;
}

/**
 * El texto plegado (sin tildes, minúsculas, sin signos, espacios simples) y, para cada letra, su posición en el original: así el
 * mensaje que dicta («respóndele que llego en 10, Brian») se saca del ORIGINAL, con sus mayúsculas y tildes.
 */
export function plegarConMapa(original: string): { t: string; pos: number[] } {
  let t = ""; const pos: number[] = [];
  let espacio = true;
  for (let i = 0; i < original.length; i++) {
    const base = original[i].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const c = /[¿?¡!.,;\s]/.test(base) ? " " : base;
    if (c === " ") { if (!espacio) { t += " "; pos.push(i); espacio = true; } continue; }
    for (const ch of c) { t += ch; pos.push(i); }
    espacio = false;
  }
  if (t.endsWith(" ")) { t = t.slice(0, -1); pos.pop(); }
  return { t, pos };
}
/** Desde la posición `desde` del texto plegado, el tramo del original (sin el signo final) */
const tramo = (original: string, m: { pos: number[] }, desde: number) => original.slice(m.pos[desde] ?? original.length).trim().replace(/[\s.!?¿¡]+$/, "");

/** Cómo se nombra cada app de mensajes al pedir «léeme los de WhatsApp» */
const APP_DICHA: Array<[RegExp, string]> = [[/whatsapp|wsp|wasap/, "whatsapp"], [/telegram/, "telegram"], [/gmail|correos?|mails?/, "gmail"],
  [/instagram|insta/, "instagram"], [/messenger/, "messenger"], [/mensajes? de texto|sms/, "mensajes"]];
const appDe = (t: string) => APP_DICHA.find(([re]) => re.test(t))?.[1];

/** K1: mensajes, llamadas y música. null = no es de esto. */
function parseMensajes(original: string, t: string): TelefonoOp | null {
  // Música (las sesiones de medios: Spotify, YouTube Music…)
  // (la música se nombra: «pon el tema para la reunión» no es pausar)
  // (sin nombrarla: «pon pausa», «¿qué está sonando?», «pasa a la siguiente»: banco telefono_banco, 2026-11-17)
  if (/^(pon(le|me)? pausa|pausa(la)?|play|dale play|pon(le)? play)$/.test(t)) return { accion: "musica", que: /pausa/.test(t) ? "pausa" : "sigue" };
  if (/^(que (esta sonando|suena|estoy escuchando)|que suena ahora)$/.test(t)) return { accion: "musica", que: "que_suena" };
  if (/^((pasa|salta|cambia)\w* a la siguiente|siguiente|la que sigue)$/.test(t)) return { accion: "musica", que: "siguiente" };
  if (/\b(musica|cancion|spotify|reproduccion)\b/.test(t)) {
    if (/\bque (cancion|musica) (es|suena|esta sonando|estoy escuchando)\b|\bcomo se llama (esta|la) cancion\b/.test(t)) return { accion: "musica", que: "que_suena" };
    if (/\b(siguiente|proxima|otra) cancion\b|\b(salta|pasa|cambia)\w* (la |esta )?cancion\b/.test(t)) return { accion: "musica", que: "siguiente" };
    if (/\bcancion anterior\b|\bla cancion de antes\b/.test(t)) return { accion: "musica", que: "anterior" };
    if (/\b(pausa\w*|pon(le|me)? pausa|deten\w*|para|parala|apaga)( a)? (la |el )?(musica|cancion|spotify|reproduccion)\b|^pausa$/.test(t)) return { accion: "musica", que: "pausa" };
    if (/\b(sigue|continua|reanuda|dale play|pon(le)? play|play)( (con )?(la |el )?(musica|cancion|spotify))?\b/.test(t)) return { accion: "musica", que: "sigue" };
  }
  const m = plegarConMapa(original);
  // Responder a quien te escribió: «respóndele (a Brian) que llego en 10», «contéstale que sí»
  let r = /^(?:oye )?(?:respondele|contestale|responde|contesta)(?: a ([a-z0-9 ]+?))? (?:diciendo que|que|diciendo|con) /.exec(m.t);
  if (r) {
    const texto = tramo(original, m, r[0].length);
    if (texto) return { accion: "responder", ...(r[1] ? { persona: r[1].trim() } : {}), texto };
  }
  // Un WhatsApp o un SMS a alguien: «mándale un WhatsApp a Carla que llego tarde», «envíale un SMS a Brian diciendo que voy»
  r = /^(?:oye )?(?:mandale|enviale|manda|envia|escribele) (?:un |una )?(whatsapp|wsp|wasap|sms|mensaje de texto|mensajito|mensaje|nota de voz)(?: por whatsapp)? a ([a-z0-9 ]+?) (?:diciendo que|que|diciendo|con el texto) /.exec(m.t);
  if (r) {
    const texto = tramo(original, m, r[0].length);
    if (!texto) return null;
    const canal = /whatsapp|wsp|wasap/.test(r[1]) || /por whatsapp/.test(r[0]) ? "whatsapp" : /sms|texto/.test(r[1]) ? "sms" : null;
    return canal ? { accion: canal, persona: r[2].trim(), texto } : { accion: "responder", persona: r[2].trim(), texto, canal: "auto" };
  }
  // Por WhatsApp o SMS dicho después: «escríbele por WhatsApp a Carla que mañana no puedo» (banco telefono_banco, 2026-11-17)
  r = /^(?:oye )?(?:escribele|mandale|enviale|manda|envia|escribe)(?: un mensaje)? por (whatsapp|wsp|wasap|sms|mensaje de texto) a ([a-z0-9 ]+?) (?:diciendo que|que|diciendo) /.exec(m.t);
  if (r) {
    const texto = tramo(original, m, r[0].length);
    if (texto) return { accion: /sms|texto/.test(r[1]) ? "sms" : "whatsapp", persona: r[2].trim(), texto };
  }
  // «dile a Brian que llego en 10», «escríbele a mi mamá que voy», «mándale a mi mamá que ya llegué»: por su chat, si te escribió
  // hace poco; si no, WhatsApp
  r = /^(?:oye )?(?:dile|digale|escribele|avisale|mandale|enviale|cuentale) a ([a-z0-9 ]+?) que /.exec(m.t);
  if (r) {
    const texto = tramo(original, m, r[0].length);
    if (texto) return { accion: "responder", persona: r[1].trim(), texto, canal: "auto" };
  }
  // Llamar: «llama a mi mamá», «llámale a Brian», «márcale a la Carla» (no «llámame a las 8», que es un recordatorio, ni «llama la
  // atención que…»)
  r = /^(?:oye )?(?:llama|llamale|llamame|marca|marcale|marcame)(?: a)? (?!(?:a )?las? (?:\d|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b|la atencion\b)([a-z0-9 ]{2,40})$/.exec(m.t);
  if (r && !/^(el|al) (pc|computador)/.test(r[1])) return { accion: "llamar", persona: r[1].replace(/^(a|al|la|el) /, "").trim() };
  // Leer: «léeme los mensajes», «¿quién me escribió?», «¿tengo mensajes nuevos de WhatsApp?», «¿qué me dijo Brian?»
  const dijo = /\bque (?:me )?(?:dijo|escribio|mando|puso|respondio|contesto) (?:el |la )?([a-z0-9 ]{2,40})$/.exec(t)
    // («¿me escribió mi mamá?», «¿qué dice el último mensaje de Pedro?»: banco telefono_banco, 2026-11-17)
    ?? /^(?:y )?me (?:escribio|hablo|mando (?:un |algo |algun )?(?:mensaje|whatsapp|wsp)?) ?(?:el |la )?([a-z0-9 ]{2,40})$/.exec(t)
    ?? /\bque dice (?:el |su )?(?:ultimo )?(?:mensaje|whatsapp|wsp|correo) de (?:el |la )?([a-z0-9 ]{2,40})$/.exec(t);
  if (dijo && !/\b(medico|doctor|eris|hestia|alguien|nadie)\b/.test(dijo[1])) return { accion: "mensajes", persona: dijo[1].trim() };
  const lee = /\b(leeme|lee|dime|revisa|muestrame)\b.*\b(mensajes?|whatsapps?|wsps?|correos?|mails?|notificaciones|chats?|codigos?)\b|\b(quien|alguien) me (escribio|hablo|mando)\b|\b(tengo|hay|llegaron|me llego|me llegaron)\b.*\b(mensajes?|whatsapps?|correos?|notificaciones)\b|^(mensajes|mis mensajes)$|\bque (mensajes|whatsapps?|correos?|notificaciones) (tengo|hay|me llegaron)\b/.test(t);
  if (lee) {
    const de = /\b(?:mensajes?|whatsapps?|correos?|mails?|chats?) de (?!whatsapp|telegram|gmail|instagram|messenger|correo|texto|hoy|ayer|esta)(?:el |la )?([a-z0-9 ]{2,40})$/.exec(t);
    const app = appDe(t);
    return { accion: "mensajes", ...(de ? { persona: de[1].trim() } : {}), ...(app ? { app } : {}), ...(/\bcodigos?\b/.test(t) ? { codigos: true } : {}) };
  }
  return null;
}

/** La orden del teléfono dicha, o null si no es una (o habla del PC). `apps`: las del teléfono, para «abre X». */
export function parseTelefono(texto: string, apps: string[] = []): TelefonoOp | null {
  // «Hestia, llama a mi mamá», «oye Hestia, linterna»: el nombre al comienzo no es parte de la orden (con él, varias no se
  // entendían: banco telefono_banco, 2026-11-17)
  texto = String(texto ?? "").replace(/^\s*(?:(?:oye|ok|okey|hey|ya|hola)[\s,]+)?(?:hestia|eris)\b[\s,:.!]*/i, "");
  const t = fold(texto);
  if (!t || t.length > 300 || PC.test(t)) return null;
  // L5: lo de los protocolos lo contesta Hestia por código (Protocolos.ts): «crea un protocolo que ponga no molestar» no es poner
  // el No molestar ahora
  if (/\bprotocolos?\b/.test(t)) return null;
  // K1 primero: «respóndele que pongo la alarma a las 7» es un mensaje, no una alarma
  const k1 = parseMensajes(texto, t);
  if (k1) return k1;
  // K2: agendar («agéndame una reunión con Brian mañana a las 10») y leer el calendario
  const ag = parseAgendar(texto);
  if (ag) return { accion: "agendar", titulo: ag.titulo, cuando: ag.cuando };
  if (pideCalendario(texto)) return { accion: "calendario", cuando: texto };
  if (t.length > 160) return null;

  // Alarma
  if (/\b(alarma|despiertame|despertador)\b/.test(t) && !/\b(apaga|quita|borra|elimina|cancela|desactiva)\w*\b/.test(t)) {
    const h = horaDicha(t);
    // (2026-11-17, su llamada real: «Modifique la alarma de mañana a las 6:45» no se entendía y el modelo dijo «ya la actualicé»)
    const cambia = /\b(modifi(?:c|qu)\w*|cambi\w*|muev\w*|ajust\w*|adelant\w*|atras\w*|corre(?:la)?|corri(?:g|j)\w*)\b/.test(t);
    if (h && (cambia || /\b(pon\w*|crea\w*|programa\w*|configura\w*|agenda\w*|activa\w*|deja\w*|dej(as|es|ame)|hazme|puedes|podrias|despiertame|necesito|quiero)\b|\balarma (a|para|de manana a) la/.test(t))) {
      const mensaje = para(t);
      return { accion: "alarma", hora: h.hora, minuto: h.minuto, ...(mensaje ? { mensaje } : {}), ...(cambia ? { reemplaza: true } : {}) };
    }
  }
  // Temporizador
  // (y «que suene / avísame / recuérdame EN 15 minutos»: un temporizador; la hora no la calcula el modelo de 4B, que se equivoca:
  // banco «voz», 14:41 + 15 min → «alarma a las 15:55»)
  // («pon una alarma en 10 minutos», «cuenta 3 minutos»: banco telefono_banco, 2026-11-17)
  if (/\b(temporizador|timer|cronometro|cuenta regresiva)\b|\b(avisame|me avises?|avisa|suene|sonar|recuerdame|me recuerdes?|alarma)\s+en\b|^cuenta\s/.test(t)) {
    const s = duracionDicha(t);
    if (s) {
      // el nombre: «para la pasta», o lo que va después de la duración («avísame en 15 minutos que saque el pan»)
      const mensaje = para(t) ?? /\b(?:minutos?|segundos?|horas?|media hora)\s+(?:que|pa que|para que)\s+(.{3,40})$/.exec(t)?.[1]?.trim();
      return { accion: "temporizador", segundos: s, ...(mensaje ? { mensaje } : {}) };
    }
  }
  // Linterna («prende la luz del celular» también)
  if (/\blinterna\b|\bluz del (celu\w*|telefono|movil)\b/.test(t)) {
    if (/\b(apaga\w*|desactiva\w*|quita\w*|saca\w*)\b/.test(t)) return { accion: "linterna", encender: false };
    // (banco «voz», 2026-11-18: «¿me ayudas con la linterna? está muy oscuro» → el modelo dijo «te la prendo» sin prenderla)
    if (/\b(prende\w*|enciende\w*|activa\w*|pon\w*|necesito|dame|ayuda\w*|oscur\w*|no veo)\b|^linterna$/.test(t)) return { accion: "linterna", encender: true };
  }
  // L5: el «No molestar» de Android («pon no molestar por una hora», «quita el no molestar»). Va antes que el volumen: «silencio»
  // sigue siendo el volumen; «no molestar» es otra cosa (las notificaciones y llamadas no suenan, las alarmas sí)
  if (/\bno molestar\b/.test(t) && !/\b(que es|como funciona|para que sirve)\b/.test(t)) {
    const off = /\b(quita|saca|desactiva|apaga|sin)\w*\b/.test(t);
    const s = off ? null : duracionDicha(t);
    return { accion: "no_molestar", encender: !off, ...(s ? { minutos: Math.max(1, Math.round(s / 60)) } : {}) };
  }
  // Volumen
  // («pon el celular en silencio», «quita el silencio», «volumen a la mitad», «baja un poco el volumen»: banco telefono_banco)
  if (/\b(volumen|sonido)\b|\bsilencia\w*\b|\bmutea\w*\b|\bsilencio\b/.test(t)) {
    const n = /\bvolumen\s+(?:al|a|en)\s+(\d{1,3})\s*(?:%|por ciento)?/.exec(t);
    if (n && Number(n[1]) <= 100) return { accion: "volumen", cambio: "nivel", nivel: Number(n[1]) };
    if (/\bvolumen\s+(al|a)\s+(maximo|tope|full)\b|\btodo el volumen\b/.test(t)) return { accion: "volumen", cambio: "maximo" };
    if (/\bvolumen\s+(al|a|en)\s+(la )?mitad\b|\bvolumen (al|a) 50\b/.test(t)) return { accion: "volumen", cambio: "nivel", nivel: 50 };
    if (/\b(quita\w*|saca\w*|desactiva\w*) (el |del )?(silencio|modo silencio)\b/.test(t)) return { accion: "volumen", cambio: "nivel", nivel: 50 };
    if (/\b(silencia\w*|mutea\w*|sin sonido|volumen (a|en) cero)\b|\b(pon\w*|deja\w*|activa\w*)\b.*\b(en|modo) silencio\b|^modo silencio$/.test(t)) return { accion: "volumen", cambio: "silencio" };
    if (/\b(sube\w*|mas)\s+(un poco\s+|un poquito\s+)?(el\s+)?(volumen|sonido)\b|\bsubele\b/.test(t)) return { accion: "volumen", cambio: "subir" };
    if (/\b(baja\w*|menos)\s+(un poco\s+|un poquito\s+)?(el\s+)?(volumen|sonido)\b|\bbajale\b/.test(t)) return { accion: "volumen", cambio: "bajar" };
  }
  // Batería («batería del celular», «¿se está cargando el celular?»)
  if (/\bbateria\b/.test(t) && /\b(cuant[ao]|como|que|nivel|tengo|queda|porcentaje)\b|^(la )?bateria( (del|de mi) (celu\w*|telefono|movil))?$/.test(t) && !/\b(compr|cambi|reemplaz)\w*\b/.test(t)) return { accion: "bateria" };
  if (/^(se )?esta cargando( el (celu\w*|telefono|movil))?$/.test(t)) return { accion: "bateria" };
  // Navegar (Maps): «abre Maps hacia el estadio», «llévame a la casa»
  const nav = /\b(?:llevame|navega(?:r)?|guiame|como llego|ruta|indicaciones)\s+(?:a|al|hasta|hacia|para)\s+(.{2,80})$/.exec(t)
    ?? /^(?:abre(?:me)?|pon(?:me)?|usa)\s+(?:google\s+)?maps\s+(?:hacia|a|al|hasta|para|rumbo a|con destino a)\s+(.{2,80})$/.exec(t);
  if (nav) {
    const destino = nav[1].replace(/\b(por favor|porfa|en (el )?(auto|maps))\b/g, "").trim();
    if (destino) return { accion: "navegar", destino };
  }
  // Abrir una app del teléfono (si no, «abre X» sigue siendo del PC)
  const ab = /^(?:oye\s+)?(?:abre(?:me)?|abrir|lanza|inicia|entra a|entra en)\s+(.+?)(?:\s+(?:en (?:el|mi)\s+)?(?:celu\w*|telefono|movil))?$/.exec(t);
  if (ab) {
    const app = appDelTelefono(ab[1], apps);
    if (app) return { accion: "abrir_app", nombre: app };
    if (TEL.test(t)) return { accion: "abrir_app", nombre: ab[1].trim() };
  }
  // K4: manejar la app de adelante (leer la pantalla, tocar, escribir, atrás, inicio, desplazar)
  return parseManejo(texto, t);
}

/**
 * K3 (2026-11-16): con el teléfono BLOQUEADO (la llamada se abrió con el botón del asistente sobre la pantalla de bloqueo) Hestia
 * hace solo lo que no expone nada tuyo ni afecta a otros: alarma, temporizador, linterna, volumen, música y batería (la hora y la
 * fecha van aparte, por código). Mensajes, llamadas, el calendario, abrir apps (Android pide desbloquear igual) y todo lo demás
 * espera a que desbloquees: cualquiera que tenga el teléfono en la mano podría decir «léeme los mensajes». Lo decide este código,
 * no el modelo.
 */
export const SEGURAS_BLOQUEADO = new Set(["alarma", "temporizador", "linterna", "volumen", "musica", "bateria", "no_molestar"]);

/** ¿Esto se puede hacer con el teléfono bloqueado? */
export function permitidoBloqueado(texto: string): boolean {
  const op = parseTelefono(texto);
  return !!op && SEGURAS_BLOQUEADO.has(String(op.accion));
}
