// ============================================================
// Hestia por voz (J2, 2026-11-16): aprobar acciones en el PC durante una llamada.
// La aprobación sigue siendo de una PERSONA y por un canal aparte del modelo (la tarjeta de siempre llega igual al teléfono).
// Lo nuevo: en la llamada, lo SEGURO también se puede aprobar diciendo «sí» (lo que la persona dice lo interpreta este código, no
// el modelo, y solo mientras hay una aprobación pendiente). Lo riesgoso pide tocar la tarjeta; borrar o cualquier cosa que no se
// recupere, nunca por voz (decisión del plan J2).
// ============================================================

/** Lo que trae la tarjeta (igual a ApprovalRequest del QueryEngine) */
export interface PedidoAprobacion { tool: string; title: string; detail: string; risk: "normal" | "high"; flags: string[] }

/** voz = se aprueba diciendo «sí» · tarjeta = hay que tocarla · nunca_voz = destructivo: solo tocándola */
export type ClaseAprobacion = "voz" | "tarjeta" | "nunca_voz";

/** Señales (de PathPolicy y de cada herramienta) de algo que no se deshace */
const DESTRUCTIVO = /borra|formatea|apaga|reinicia el equipo|sobrescribe|historial de git|muchos archivos|detiene procesos|configuraci[oó]n del sistema/i;
/** Señales que sí se aprueban por voz: tocan la bóveda con copia previa */
const FLAGS_SEGUROS = new Set(["modifica otra nota", "modifica el Índice del Feed"]);
/** Herramientas que pueden aprobarse por voz (si además son de riesgo normal y sin otras señales) */
const VOZ_OK = new Set(["open", "vault_note", "crystallize", "file_write", "bash", "telefono"]);

/** Comandos que solo miran (cada tramo de la tubería empieza con uno de estos) */
const SOLO_MIRA = /^(get-[a-z]+|select-object|select|where-object|where|\?|sort-object|sort|measure-object|measure|format-table|format-list|format-wide|ft|fl|fw|group-object|group|out-string|convertto-json|convertto-csv|test-path|resolve-path|split-path|join-path|dir|ls|gci|gps|ps|gc|cat|type|hostname|whoami|ipconfig|systeminfo|tasklist|nvidia-smi|select-string|sls|findstr)$/i;
/** Lo que, aunque empiece mirando, podría cambiar algo: llamadas a métodos (.Delete()), .NET (::), asignaciones, redirecciones… */
const PUEDE_CAMBIAR = /[;&`>]|\$\(|::|\w\s*\(|(^|[^-!=<>])=(?!=)|\b(invoke|start|set|new|remove|stop|restart|add|clear|copy|move|rename|out-file|export|import)-/i;

/** El comando de la tarjeta de `bash` (sin la línea «(en la carpeta …)») */
export function comandoDe(detail: string): string {
  return String(detail ?? "").split(/\n\n\(en la carpeta /)[0].trim();
}

/** ¿Este comando de PowerShell solo mira? (conservador: ante la duda, no) */
export function soloMira(cmd: string): boolean {
  const c = String(cmd ?? "").trim();
  if (!c || c.length > 300 || /\r|\n/.test(c) || PUEDE_CAMBIAR.test(c)) return false;
  return c.split("|").every((tramo) => SOLO_MIRA.test(tramo.trim().split(/\s+/)[0] ?? ""));
}

/** «Start-Process https://…» sin nada más: es abrir una página en el navegador (lo mismo que la herramienta open) */
const ABRE_URL = /^(?:start-process|start)\s+(?:-filepath\s+)?["']?(https?:\/\/[^\s"'`;&|<>]+)["']?\s*$/i;
export const urlDeComando = (cmd: string): string | null => ABRE_URL.exec(String(cmd ?? "").trim())?.[1] ?? null;

export function claseAprobacion(req: PedidoAprobacion): ClaseAprobacion {
  const flags = req.flags ?? [];
  if (req.tool === "bash" && urlDeComando(comandoDe(req.detail))) return "voz";
  if (flags.some((f) => DESTRUCTIVO.test(f)) || /sobrescrib|borrar|eliminar/i.test(req.title)) return "nunca_voz";
  if (req.risk === "high") return "tarjeta";
  if (flags.some((f) => !FLAGS_SEGUROS.has(f))) return "tarjeta";
  if (!VOZ_OK.has(req.tool)) return "tarjeta";
  if (req.tool === "bash" && !soloMira(comandoDe(req.detail))) return "tarjeta";
  return "voz";
}

const sinExtension = (nombre: string) => nombre.replace(/\.[a-z0-9]{1,5}$/i, "");
const base = (ruta: string) => String(ruta ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
/** «https://www.youtube.com/watch…» → «youtube» (dicho en voz, el «.com» sobra) */
function sitio(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const partes = h.split(".");
    return (partes.length > 2 && partes.at(-2)!.length <= 3 ? partes.at(-3)! : partes.at(-2) ?? h) || h;
  } catch { return "esa página"; }
}
/** La primera señal, sin paréntesis ni dos puntos: «usa la red (descarga o envía datos)» → «usa la red» */
const senal = (flags: string[]) => (flags[0] ?? "").split(/[(:]/)[0].trim();

/** Qué hace, como pregunta corta, para decirla en voz alta */
function accion(req: PedidoAprobacion): string {
  const d = String(req.detail ?? "");
  switch (req.tool) {
    case "open":
      if (/enlace/i.test(req.title)) return `¿Abro ${sitio(d.trim())} en el navegador?`;
      if (/archivo/i.test(req.title)) return `¿Abro el archivo ${sinExtension(base(d.trim()))}?`;
      return `¿Abro ${sinExtension(base(d.trim())) || "esa aplicación"}?`;
    case "vault_note": {
      const nota = sinExtension(base((d.match(/^Nueva nota: (.+)$/m)?.[1] ?? "").trim()));
      return nota ? `¿Creo la nota «${nota}» en la bóveda?` : "¿Creo esa nota en la bóveda?";
    }
    case "crystallize": return "¿Guardo esa decisión en la bóveda?";
    case "file_write": return `¿Creo el archivo ${sinExtension(base(d.split("\n")[0])) || "ese archivo"}?`;
    // Hestia Manos (K0): la primera línea del detalle ya es la pregunta («¿Pongo una alarma a las 07:00?»)
    case "telefono": {
      const q = d.split("\n")[0].trim();
      return /\?$/.test(q) ? q : "¿Lo hago en tu teléfono?";
    }
    case "bash": {
      const url = urlDeComando(comandoDe(d));
      return url ? `¿Abro ${sitio(url)} en el navegador?` : "¿Lo reviso en tu PC? Solo mira, no cambia nada.";
    }
    default: return "¿Lo hago?";
  }
}

/** Lo que dice Hestia al pedir la aprobación en la llamada */
export function preguntaHablada(req: PedidoAprobacion, clase: ClaseAprobacion): string {
  if (clase === "voz") return `${accion(req)} Dime sí o no.`;
  const s = senal(req.flags ?? []);
  if (clase === "nunca_voz") return `Eso ${s || "no se puede deshacer"}, así que no lo apruebo por voz. Si quieres hacerlo, toca Aprobar en la pantalla.`;
  return `${s ? `Eso ${s}` : req.tool === "bash" ? "Ese comando puede cambiar cosas en tu PC" : "Eso es delicado"}, así que lo apruebas tocando la pantalla.`;
}

const normalizar = (t: string) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** Cualquier negación gana (lo seguro ante la duda es no hacerlo) */
// («para», «espera», «todavía», «aún» solo al comienzo: «sí, dale para adelante» no es un no)
const NIEGA = /\b(no|nop|nope|cancela\w*|cancelar|dejalo|dejala|dejemoslo|olvidalo|olvidate|detente|rechaza\w*|rechazo|nunca|ni hablar)\b|^(para|espera|todavia|aun)\b/;
const AFIRMA = /^(si+|sip|dale|hazlo|hagalo|ya|ok|oka|okey|okay|confirmo|confirmado|apruebo|aprobado|adelante|claro|de una|sale|bueno|obvio|perfecto|correcto|exacto|listo|anda|porfa|por favor)\b/;
const HAZLO = /^(abre|abrela|abrelo|crea|creala|crealo|guarda|guardala|guardalo|corre|correlo|ejecuta|ejecutalo|haz|hazlo|revisa|revisalo|mira)( (lo|la|eso|nomas|no mas|po|porfa|por favor))?$/;

/**
 * ¿Lo que dijo es un sí o un no a la pregunta pendiente? null = otra cosa (cambió de tema, o no se entendió).
 * Un sí tiene que ser corto y sin «pero» («sí, pero en Firefox» no es un sí a lo que está en la tarjeta).
 */
export function respuestaSiNo(texto: string): "si" | "no" | null {
  const n = normalizar(texto);
  if (!n) return null;
  const palabras = n.split(" ").length;
  if (NIEGA.test(n)) return palabras <= 8 ? "no" : null;
  if (/\bpero\b/.test(n) || palabras > 6) return null;
  if (AFIRMA.test(n) || HAZLO.test(n)) return "si";
  return null;
}
