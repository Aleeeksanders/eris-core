// ============================================================
// Banco de frases del teléfono (2026-11-17, pedido del usuario: «un banco de pruebas para todas estas situaciones en el
// calendario, alarma, reloj, y todo lo que incorpora»). Cada orden dicha de varias formas, como se habla en Chile, y lo que el
// CÓDIGO tiene que entender (sin el modelo): la acción y sus datos, qué se puede con el teléfono bloqueado (sin y con tu voz), las
// respuestas directas (hora y fecha), los rangos del calendario y lo que se agenda. Y lo que NO es del teléfono.
// Lo del modelo real, por la llamada y con el teléfono falso, está en scripts/chat_eval (casos «voz-…»).
// Si una frase nueva falla en la vida real: agregarla acá primero.
// ============================================================
import { test, expect } from "bun:test";
import { parseTelefono } from "C:/Proyectos/eris/src/services/TelefonoParse.ts";
import { respuestaDirecta } from "C:/Proyectos/eris/src/services/voz/Directas.ts";
import { rangoDicho, planAgendar, formatearEventos } from "C:/Proyectos/eris/src/services/TelefonoK2.ts";
import { nivelBloqueado } from "C:/Proyectos/eris/src/services/voz/Bloqueado.ts";

const APPS = ["Spotify", "WhatsApp", "Instagram", "Cámara", "Mercado Libre", "YouTube", "Gmail", "Uber", "Netflix", "Calendar", "Reloj"];
/** martes 17 de noviembre de 2026, 10:30 */
const AHORA = new Date(2026, 10, 17, 10, 30);
type Nivel = "seguro" | "tu_voz" | "desbloquear";
/** [frase, lo que tiene que salir (los campos que importan), [bloqueado sin tu voz, con tu voz]] */
type Caso = [string, Record<string, unknown>, [Nivel, Nivel]?];

const SEGURO: [Nivel, Nivel] = ["seguro", "seguro"];
const DESBLOQ: [Nivel, Nivel] = ["desbloquear", "desbloquear"];
const CON_VOZ: [Nivel, Nivel] = ["desbloquear", "tu_voz"];

const BANCO: Record<string, Caso[]> = {
  "alarma (reloj)": [
    ["pon una alarma a las 7", { accion: "alarma", hora: 7, minuto: 0 }, SEGURO],
    ["despiértame a las 6 y media", { accion: "alarma", hora: 6, minuto: 30 }, SEGURO],
    // (2026-11-17, su llamada real) cambiarla: Android no deja tocar la que ya tenía → otra, y se le avisa (reemplaza)
    ["Modifique la alarma de mañana a las 6:45.", { accion: "alarma", hora: 6, minuto: 45, reemplaza: true }, SEGURO],
    ["cambia la alarma a las 6:45", { accion: "alarma", hora: 6, minuto: 45, reemplaza: true }],
    ["adelanta la alarma a las 6 y media", { accion: "alarma", hora: 6, minuto: 30, reemplaza: true }],
    ["ponme una alarma para mañana a las 7:15", { accion: "alarma", hora: 7, minuto: 15, mensaje: undefined }, SEGURO],
    ["alarma a las 8 de la mañana", { accion: "alarma", hora: 8, minuto: 0 }],
    ["pon una alarma a las 10 de la noche", { accion: "alarma", hora: 22, minuto: 0 }],
    ["pon el despertador a las 7", { accion: "alarma", hora: 7, minuto: 0 }],
    ["despiértame a las siete", { accion: "alarma", hora: 7, minuto: 0 }],
    ["alarma a las 5:45", { accion: "alarma", hora: 5, minuto: 45 }],
    ["ponme una alarma a las 3 de la tarde", { accion: "alarma", hora: 15, minuto: 0 }],
    ["alarma para las 12 del día", { accion: "alarma", hora: 12, minuto: 0 }],
    ["alarma a las 7 para ir al gimnasio", { accion: "alarma", hora: 7, minuto: 0, mensaje: "ir al gimnasio" }],
    ["pon una alarma a las seis y cuarto", { accion: "alarma", hora: 6, minuto: 15 }],
    ["despiértame a las 7 menos cuarto", { accion: "alarma", hora: 6, minuto: 45 }],
    ["pon una alarma a las 8 menos 10", { accion: "alarma", hora: 7, minuto: 50 }],
    ["ponme alarma 6:40", { accion: "alarma", hora: 6, minuto: 40 }],
    ["Hestia, pon una alarma a las 9", { accion: "alarma", hora: 9, minuto: 0 }, SEGURO],
    ["oye Hestia, despiértame a las 6", { accion: "alarma", hora: 6, minuto: 0 }],
  ],
  "temporizador (reloj)": [
    ["pon un temporizador de 10 minutos", { accion: "temporizador", segundos: 600 }, SEGURO],
    ["temporizador de 1 hora", { accion: "temporizador", segundos: 3600 }],
    ["avísame en 20 minutos", { accion: "temporizador", segundos: 1200 }],
    ["timer de 30 segundos", { accion: "temporizador", segundos: 30 }],
    ["pon un temporizador de media hora", { accion: "temporizador", segundos: 1800 }],
    ["temporizador de 5 minutos para la pasta", { accion: "temporizador", segundos: 300, mensaje: "la pasta" }],
    ["avísame en 15 minutos que saque el pan", { accion: "temporizador", segundos: 900, mensaje: "saque el pan" }],
    ["pon una alarma en 10 minutos", { accion: "temporizador", segundos: 600 }, SEGURO],
    ["temporizador de una hora y media", { accion: "temporizador", segundos: 5400 }],
    ["cuenta 3 minutos", { accion: "temporizador", segundos: 180 }],
    ["temporizador de un minuto", { accion: "temporizador", segundos: 60 }],
    ["pon un timer de 45 segundos", { accion: "temporizador", segundos: 45 }],
    ["avísame en una hora", { accion: "temporizador", segundos: 3600 }],
  ],
  linterna: [
    ["prende la linterna", { accion: "linterna", encender: true }, SEGURO],
    ["enciende la linterna", { accion: "linterna", encender: true }],
    // (2026-11-18, banco «voz»: el modelo decía «te la prendo» sin prenderla)
    ["¿Me ayudas con la linterna? Está muy oscuro acá", { accion: "linterna", encender: true }],
    ["apaga la linterna", { accion: "linterna", encender: false }, SEGURO],
    ["linterna", { accion: "linterna", encender: true }],
    ["prende la luz del celular", { accion: "linterna", encender: true }],
    ["apaga la luz del teléfono", { accion: "linterna", encender: false }],
    ["Hestia, linterna", { accion: "linterna", encender: true }, SEGURO],
  ],
  // L5 (2026-11-18): el «No molestar» de Android (Hestia Manos 0.10.0); seguro también bloqueado
  no_molestar: [
    ["pon no molestar", { accion: "no_molestar", encender: true, minutos: undefined }, SEGURO],
    ["Hestia, activa el no molestar por una hora", { accion: "no_molestar", encender: true, minutos: 60 }, SEGURO],
    ["no molestar por 45 minutos", { accion: "no_molestar", encender: true, minutos: 45 }],
    ["pon el modo no molestar hasta en media hora", { accion: "no_molestar", encender: true, minutos: 30 }],
    ["quita el no molestar", { accion: "no_molestar", encender: false }, SEGURO],
    ["desactiva el no molestar", { accion: "no_molestar", encender: false }],
    ["sácame el no molestar", { accion: "no_molestar", encender: false }],
  ],
  volumen: [
    ["sube el volumen", { accion: "volumen", cambio: "subir" }, SEGURO],
    ["baja el volumen", { accion: "volumen", cambio: "bajar" }],
    ["volumen al 50", { accion: "volumen", cambio: "nivel", nivel: 50 }],
    ["pon el volumen al máximo", { accion: "volumen", cambio: "maximo" }],
    ["silencia el teléfono", { accion: "volumen", cambio: "silencio" }],
    ["pon el celular en silencio", { accion: "volumen", cambio: "silencio" }, SEGURO],
    ["volumen a la mitad", { accion: "volumen", cambio: "nivel", nivel: 50 }],
    ["sube el volumen al 80", { accion: "volumen", cambio: "nivel", nivel: 80 }],
    ["baja un poco el volumen", { accion: "volumen", cambio: "bajar" }],
    ["quita el silencio", { accion: "volumen", cambio: "nivel", nivel: 50 }, SEGURO],
  ],
  musica: [
    ["pausa la música", { accion: "musica", que: "pausa" }, SEGURO],
    ["pon pausa", { accion: "musica", que: "pausa" }, SEGURO],
    ["siguiente canción", { accion: "musica", que: "siguiente" }],
    ["sigue la música", { accion: "musica", que: "sigue" }],
    ["¿qué canción es esta?", { accion: "musica", que: "que_suena" }],
    ["¿qué está sonando?", { accion: "musica", que: "que_suena" }, SEGURO],
    ["canción anterior", { accion: "musica", que: "anterior" }],
    ["reanuda la música", { accion: "musica", que: "sigue" }],
    ["pasa a la siguiente", { accion: "musica", que: "siguiente" }],
    ["para la música", { accion: "musica", que: "pausa" }],
    ["dale play", { accion: "musica", que: "sigue" }],
  ],
  bateria: [
    ["¿cuánta batería tengo?", { accion: "bateria" }, SEGURO],
    ["¿cómo está la batería?", { accion: "bateria" }],
    ["batería del celular", { accion: "bateria" }],
    ["¿cuánta batería le queda al teléfono?", { accion: "bateria" }],
    ["¿se está cargando el celular?", { accion: "bateria" }, SEGURO],
  ],
  "navegar (Maps)": [
    ["llévame a la casa", { accion: "navegar", destino: "la casa" }, DESBLOQ],
    ["¿cómo llego a la Costanera Center?", { accion: "navegar", destino: "la costanera center" }],
    ["navega a Plaza de Armas", { accion: "navegar", destino: "plaza de armas" }],
    ["llévame al aeropuerto", { accion: "navegar", destino: "aeropuerto" }],
    ["abre Maps hacia el estadio nacional", { accion: "navegar", destino: "el estadio nacional" }],
    ["¿cómo llego al trabajo?", { accion: "navegar", destino: "trabajo" }],
  ],
  "abrir una app": [
    ["abre Spotify", { accion: "abrir_app", nombre: "Spotify" }, DESBLOQ],
    ["abre WhatsApp", { accion: "abrir_app", nombre: "WhatsApp" }],
    ["abre la cámara", { accion: "abrir_app", nombre: "Cámara" }],
    ["abre Instagram en el celular", { accion: "abrir_app", nombre: "Instagram" }],
    ["abre YouTube", { accion: "abrir_app", nombre: "YouTube" }],
    ["abre Uber", { accion: "abrir_app", nombre: "Uber" }],
    // (2026-11-17, su llamada real: en su Pixel el calendario se llama «Calendar»)
    ["Abre el calendario.", { accion: "abrir_app", nombre: "Calendar" }],
    ["abre la agenda", { accion: "abrir_app", nombre: "Calendar" }],
    ["abre el reloj", { accion: "abrir_app", nombre: "Reloj" }],
  ],
  "leer mensajes": [
    ["léeme los mensajes", { accion: "mensajes" }, CON_VOZ],
    ["¿quién me escribió?", { accion: "mensajes" }, CON_VOZ],
    ["¿tengo mensajes nuevos?", { accion: "mensajes" }],
    ["¿qué mensajes tengo?", { accion: "mensajes" }, CON_VOZ],
    ["¿alguien me escribió?", { accion: "mensajes" }],
    ["léeme los WhatsApp", { accion: "mensajes", app: "whatsapp" }],
    ["¿qué me dijo Brian?", { accion: "mensajes", persona: "brian" }, DESBLOQ],
    ["¿me escribió mi mamá?", { accion: "mensajes", persona: "mi mama" }, DESBLOQ],
    ["¿qué dice el último mensaje de Pedro?", { accion: "mensajes", persona: "pedro" }, DESBLOQ],
    ["léeme los códigos de verificación", { accion: "mensajes", codigos: true }, DESBLOQ],
  ],
  "responder y mandar": [
    ["respóndele que voy en camino", { accion: "responder", texto: "voy en camino" }, DESBLOQ],
    ["respóndele a Brian que sí llego", { accion: "responder", persona: "brian", texto: "sí llego" }],
    ["contéstale que ok", { accion: "responder", texto: "ok" }],
    ["respóndele a mi mamá que voy el domingo", { accion: "responder", persona: "mi mama", texto: "voy el domingo" }],
    // sin decir por dónde: por su chat si te escribió hace poco; si no, WhatsApp (canal «auto»)
    ["dile a Brian que llego en 10", { accion: "responder", persona: "brian", texto: "llego en 10", canal: "auto" }, DESBLOQ],
    ["mándale a mi mamá que ya llegué", { accion: "responder", persona: "mi mama", texto: "ya llegué", canal: "auto" }],
    ["escríbele a Pedro que mañana no puedo", { accion: "responder", persona: "pedro", texto: "mañana no puedo", canal: "auto" }],
    ["mándale un WhatsApp a Brian que llego en 10", { accion: "whatsapp", persona: "brian", texto: "llego en 10" }, DESBLOQ],
    ["escríbele por WhatsApp a Carla que mañana no puedo", { accion: "whatsapp", persona: "carla", texto: "mañana no puedo" }],
    ["manda un wsp a mi mamá que ya voy", { accion: "whatsapp", persona: "mi mama", texto: "ya voy" }],
    ["mándale un SMS a mi mamá que ya llegué", { accion: "sms", persona: "mi mama", texto: "ya llegué" }, DESBLOQ],
    ["manda un mensaje de texto a Brian que voy", { accion: "sms", persona: "brian", texto: "voy" }],
    ["envíale un sms a Pedro que llego tarde", { accion: "sms", persona: "pedro", texto: "llego tarde" }],
  ],
  llamar: [
    ["llama a mi mamá", { accion: "llamar", persona: "mi mama" }, DESBLOQ],
    ["llámame a Brian", { accion: "llamar", persona: "brian" }],
    ["marca a Pedro", { accion: "llamar", persona: "pedro" }],
    ["llama al 912345678", { accion: "llamar", persona: "912345678" }],
    ["llama a Carla", { accion: "llamar", persona: "carla" }],
    ["Hestia, llama a mi mamá", { accion: "llamar", persona: "mi mama" }, DESBLOQ],
  ],
  "leer el calendario": [
    ["Hestia, dime que eventos tengo en el calendario para esta semana", { accion: "calendario", rango: "esta semana" }, CON_VOZ],
    ["¿Qué eventos tengo esta semana?", { accion: "calendario", rango: "esta semana" }],
    ["Hestia, ¿tengo algo el viernes?", { accion: "calendario", rango: "el viernes 20" }, CON_VOZ],
    ["¿tengo algo que hacer mañana?", { accion: "calendario", rango: "mañana" }],
    ["léeme mi agenda de la semana", { accion: "calendario", rango: "esta semana" }, CON_VOZ],
    ["¿Qué reuniones tengo mañana?", { accion: "calendario", rango: "mañana" }],
    ["¿qué hay en mi calendario el lunes?", { accion: "calendario", rango: "el lunes 23" }],
    ["¿tengo reuniones hoy?", { accion: "calendario", rango: "hoy" }],
    ["¿tengo alguna reunión hoy?", { accion: "calendario", rango: "hoy" }],
    ["¿cuándo es mi próxima reunión?", { accion: "calendario", rango: "en las próximas dos semanas", primero: true }, CON_VOZ],
    ["¿qué tengo en el calendario la próxima semana?", { accion: "calendario", rango: "la próxima semana" }],
    ["¿tengo algo este fin de semana?", { accion: "calendario", rango: "este fin de semana" }],
    ["¿qué tengo el próximo fin de semana?", { accion: "calendario", rango: "el próximo fin de semana" }],
    ["¿qué citas tengo el jueves?", { accion: "calendario", rango: "pasado mañana" }],
    ["¿qué tengo mañana en el calendario?", { accion: "calendario", rango: "mañana" }],
    ["¿qué tengo mañana?", { accion: "calendario", rango: "mañana" }, CON_VOZ],
    ["¿qué tengo el viernes?", { accion: "calendario", rango: "el viernes 20" }],
  ],
  "agendar": [
    ["agéndame una reunión con Brian mañana a las 10", { accion: "agendar", titulo: "Reunión con Brian", inicio: [18, 10, 0] }, DESBLOQ],
    ["anota en el calendario dentista el viernes a las 4", { accion: "agendar", titulo: "Dentista", inicio: [20, 16, 0] }],
    ["crea un evento partido el sábado a las 6", { accion: "agendar", titulo: "Partido", inicio: [21, 18, 0] }],
    ["agenda una cita con el doctor el lunes a las 9 y media", { accion: "agendar", titulo: "Cita con el doctor", inicio: [23, 9, 30] }],
    ["agéndame gimnasio mañana a las 7 de la tarde", { accion: "agendar", titulo: "Gimnasio", inicio: [18, 19, 0] }],
    // sin hora: lo pregunta
    ["pon en mi calendario almuerzo con mamá el domingo", { accion: "agendar", titulo: "Almuerzo con mamá", pregunta: /A qué hora/ }],
    // (2026-11-17, su llamada real) «agregues un evento» es agendar, no leer el calendario; sin nombre, lo pregunta
    ["Necesito que agregues un evento el 27 de este mes.", { accion: "agendar", titulo: "", pregunta: /Cómo se llama lo que agendo el viernes 27/ }],
    ["agrega un evento el 27 a las 13:00", { accion: "agendar", titulo: "", pregunta: /Cómo se llama/ }],
    ["crea una cita con el dentista el viernes a las 10", { accion: "agendar", titulo: "Con el dentista", inicio: [20, 10, 0] }],
    ["pon en mi agenda la fiesta el 27 a la una", { accion: "agendar", titulo: "Fiesta", inicio: [27, 13, 0] }],
  ],
  "manejar apps (K4)": [
    ["¿qué dice la pantalla?", { accion: "pantalla" }, DESBLOQ],
    ["léeme la pantalla", { accion: "pantalla" }],
    ["¿qué estoy viendo?", { accion: "pantalla" }],
    ["toca Enviar", { accion: "tocar", etiqueta: "Enviar" }, DESBLOQ],
    ["aprieta Siguiente", { accion: "tocar", etiqueta: "Siguiente" }],
    ["dale a Aceptar", { accion: "tocar", etiqueta: "Aceptar" }],
    ["escribe pan integral en el buscador", { accion: "escribir", texto: "pan integral" }, DESBLOQ],
    ["atrás", { accion: "atras" }],
    ["ve al inicio", { accion: "inicio" }],
    ["baja la pantalla", { accion: "desplazar", direccion: "abajo" }],
  ],
};

/** La hora y la fecha: por código, al instante (Directas) */
const DIRECTAS: Array<[string, RegExp]> = [
  ["¿qué hora es?", /^Son las 10:30\.$/],
  ["Hestia, ¿qué hora es?", /^Son las 10:30\.$/],
  ["dime la hora", /^Son las 10:30\.$/],
  ["¿qué día es hoy?", /^Hoy es martes 17 de noviembre\.$/],
  ["¿a cuánto estamos?", /^Hoy es martes 17 de noviembre\.$/],
  ["¿qué fecha es hoy?", /^Hoy es martes 17 de noviembre\.$/],
  ["¿en qué día estamos?", /^Hoy es martes 17 de noviembre\.$/],
];

/** Lo que NO es del teléfono (ni una respuesta directa) */
const NUNCA = [
  // L1 (2026-11-17): la personalidad y «mis constantes» los contesta Hestia por código, no el teléfono («cuelga» = la llamada con ella)
  "Hestia, eso es todo", "¿Estás ahí?", "Gracias Hestia", "Cuelga la llamada", "Hestia, mis constantes", "¿Me escuchas?", "chao",
  // L2: la llamada que suena y los importantes los contesta Hestia por código (Avisos.ts), no el teléfono
  "contesta", "contéstala", "recházala", "¿quién me llama?", "Hestia, avísame cuando me escriba Mamá", "deja de avisarme de Pedro",
  "¿de quién me avisas?", "sí, era yo", "no lo reconozco",
  // L5: los protocolos los contesta Hestia por código (Protocolos.ts), aunque digan «no molestar» o «alarma»
  "Hestia, protocolo gimnasio", "modo foco por 25 minutos", "termina el protocolo", "¿qué protocolos tengo?", "me voy a dormir",
  "crea un protocolo lectura que ponga no molestar por una hora y baje el volumen", "¿qué hace el protocolo dormir?", "borra el protocolo lectura",
  "¿qué toca hoy?", "¿qué me toca entrenar?", "¿Qué me toca entrenar el viernes?", "¿cómo dormí?", "pon una nota en la bóveda",
  "abre el archivo del escritorio", "abre Spotify en el PC", "llama la atención que no haya llegado", "¿qué tengo hoy?",
  "tengo algo de hambre", "sube de peso esta semana", "baja la grasa", "dime algo bonito", "¿cuál es la capital de Francia?",
  "pon música en el PC", "silencio por favor, estoy pensando", "¿cuánto gasté hoy?", "¿cómo vengo esta semana?",
  "dime el entreno de mañana", "¿qué tengo que comer mañana?", "¿qué tengo que hacer para bajar de peso?", "me tomé la pastilla a las 8", "cuéntame algo de Hestia", "la batería del auto está mala",
];

for (const [grupo, casos] of Object.entries(BANCO)) {
  test(`banco del teléfono · ${grupo}`, () => {
    for (const [frase, esp, niveles] of casos) {
      const op: any = parseTelefono(frase, APPS);
      const real: Record<string, unknown> = { ...(op ?? { accion: null }) };
      const quiere: Record<string, unknown> = { ...esp };
      if ("rango" in esp || "primero" in esp) {
        const r = rangoDicho(String(op?.cuando ?? ""), AHORA);
        real.rango = r.etiqueta; real.primero = r.primero === true;
        if (!("primero" in esp)) quiere.primero = false;
      }
      if ("inicio" in esp || "pregunta" in esp) {
        const p: any = planAgendar(op ?? {}, AHORA);
        if (p.tipo === "agendar") { const d = new Date(p.inicio); real.inicio = [d.getDate(), d.getHours(), d.getMinutes()]; }
        if ("pregunta" in esp) { expect([frase, p.tipo]).toEqual([frase, "preguntar"]); expect(p.texto).toMatch(esp.pregunta as RegExp); delete quiere.pregunta; }
      }
      // solo los campos que importan; un campo esperado como undefined tiene que NO venir
      const comparar = Object.fromEntries(Object.keys(quiere).map((k) => [k, real[k]]));
      expect([frase, comparar]).toEqual([frase, quiere]);
      if (niveles) expect([frase, nivelBloqueado(frase, false), nivelBloqueado(frase, true)]).toEqual([frase, ...niveles]);
    }
  });
}

test("banco del teléfono · la hora y la fecha, al instante", () => {
  for (const [frase, re] of DIRECTAS) expect([frase, respuestaDirecta(frase, AHORA)]).toEqual([frase, expect.stringMatching(re)]);
});

test("banco del teléfono · lo que no es del teléfono", () => {
  for (const frase of NUNCA) {
    expect([frase, parseTelefono(frase, APPS)]).toEqual([frase, null]);
    expect([frase, respuestaDirecta(frase, AHORA)]).toEqual([frase, null]);
  }
});

test("banco del teléfono · lo que responde el calendario", () => {
  const ev = (d: number, h: number, titulo: string, durH = 1) => ({ titulo, inicio: new Date(2026, 10, d, h).getTime(), fin: new Date(2026, 10, d, h + durH).getTime(), todoElDia: false });
  const evs = [ev(17, 9, "Ya pasó"), ev(19, 10, "Reunión con Brian"), ev(21, 18, "Partido")];
  expect(formatearEventos(evs, "en las próximas dos semanas", true, AHORA, true)).toBe("Lo próximo en tu calendario es pasado mañana, a las 10:00, «Reunión con Brian».");
  expect(formatearEventos([], "este fin de semana", true, AHORA)).toBe("No tienes nada en el calendario este fin de semana.");
  expect(formatearEventos([ev(21, 18, "Partido")], "este fin de semana", true, AHORA)).toContain("«Partido»");
  // el fin de semana: sábado y domingo (un domingo, desde hoy)
  const fs = rangoDicho("¿tengo algo este fin de semana?", AHORA);
  expect([fs.desde.getDate(), fs.hasta.getDate()]).toEqual([21, 23]);
  const domingo = rangoDicho("¿tengo algo este fin de semana?", new Date(2026, 10, 22, 11, 0));
  expect([domingo.desde.getDate(), domingo.hasta.getDate()]).toEqual([22, 23]);
});

test("banco del teléfono · una orden del teléfono no se anota como comida («pon pausa» ≠ pasas)", async () => {
  const { NutritionTool } = await import("C:/Proyectos/eris/src/tools/NutritionTool.ts");
  const t = new NutritionTool();
  for (const f of ["Pon pausa", "pausa la música", "sube el volumen", "temporizador de 5 minutos para la pasta", "pon una alarma a las 7"]) {
    const r = await t.preroute(f, { foodService: { search: async () => [] }, memory: { get: async () => null } } as any).catch(() => "error");
    expect([f, r]).toEqual([f, null]);
  }
});
