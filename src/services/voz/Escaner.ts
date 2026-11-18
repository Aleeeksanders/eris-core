// ============================================================
// Hestia por voz (2026-11-17, pedido del usuario): «Hestia, escanea el código de barras» → «Claro, señor. ¿Qué desea escanear:
// comida, gastos o inventario?» → abre la cámara que corresponde en la app y cuelga la llamada:
//  - comida: el escáner de código de barras de Nutrición;
//  - gastos: la foto de la boleta de Finanzas;
//  - inventario: el escáner de código de barras del Inventario.
// Si lo dice de una («escanea la boleta», «escanea un producto para la despensa»), no se pregunta. Por código, sin el modelo.
// ============================================================

export type QueEscanear = "comida" | "gastos" | "inventario";

const fold = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;:]+/g, " ").replace(/\s+/g, " ").trim();

/** Pide escanear o sacarle una foto a algo (también como lo deja el reconocimiento: «encanea», «scanea») */
const PIDE = /\b(e?[sn]?canea\w*|escanear|escaner|scanner|lee(?:me)? el codigo|abre la camara|(?:sacale|saca|tomale|toma) (?:una )?foto (?:a|de) (?:la|una) boleta|(?:foto|camara) (?:de|para) (?:la|una) boleta)\b/;
/** No es un pedido (habla del escáner, o del PC) */
const NO = /\b(como (funciona|se usa)|que es|para que sirve|pc|computador)\b|\bno (escanees|abras)\b/;

const DE: Array<[RegExp, QueEscanear]> = [
  [/\b(inventario|despensa|alacena|refri\w*|bodega|botiquin|la casa|stock|para guardar)\b/, "inventario"],
  [/\b(gastos?|boletas?|compras?|finanzas|plata|cuenta|ticket|recibo|factura)\b/, "gastos"],
  [/\b(comida|alimentos?|lo que (me )?(como|comi|voy a comer)|(me )?voy a comer|me comi|nutricion|calorias|snack|colacion|desayuno|almuerzo|once|cena|un yogur\w*|una barra|galletas?)\b/, "comida"],
];

/** ¿De qué es? (comida, gastos o inventario), o null si no lo dijo */
export function queEscanear(texto: string): QueEscanear | null {
  const t = fold(texto);
  for (const [re, q] of DE) if (re.test(t)) return q;
  return null;
}

/** «escanea el código de barras» → {} (falta saber de qué); «escanea la boleta» → {que: "gastos"}; null si no pide escanear */
export function pideEscanear(texto: string): { que?: QueEscanear } | null {
  const t = fold(texto).replace(/^(?:(?:oye|ok|hey|ya|hola) )?(?:hestia|eris) /, "");
  if (!PIDE.test(t) || NO.test(t) || t.length > 140) return null;
  const que = queEscanear(t);
  return que ? { que } : {};
}

/** La respuesta a «¿qué desea escanear?»: solo la palabra (o casi); otra cosa es que cambió de tema */
export function respuestaEscaner(texto: string): QueEscanear | null {
  const t = fold(texto);
  if (t.split(" ").length > 8) return null;
  return queEscanear(t);
}

/**
 * Cómo le dice Hestia: el «Nombre o alias» del perfil («¿Cómo quieres que te llame Hestia?», displayName). 2026-11-17: «tiene
 * un apartado de cómo Eris o Hestia se refiere a uno en el perfil, que sea lo de ahí». null si no hay.
 */
export function tratoDe(perfil: unknown): string | null {
  const n = String((perfil as any)?.displayName ?? "").replace(/\s+/g, " ").trim();
  return n && n.length <= 30 ? n : null;
}
/** ¿Es un título («señor», «jefe»)? Entonces de usted, como en su frase; con un nombre, de tú */
const TITULO = /^(señor|señora|señorita|sr\.?|sra\.?|don|doña|jefe|jefa|patr[oó]n|patrona|sir|madame)(\s|$)/i;
/** ¿El trato es un título («señor», «jefe»)? Entonces va de usted («desea», «le vaya»); con un nombre, de tú */
export const esTitulo = (trato?: string | null): boolean => !!trato && TITULO.test(trato);
/** «Claro, señor. ¿Qué desea escanear…?» / «Claro, Alesito. ¿Qué quieres escanear…?» / sin alias: «Claro. ¿Qué quieres…?» */
export const preguntaEscaner = (trato?: string | null) =>
  !trato ? "Claro. ¿Qué quieres escanear: comida, gastos o inventario?"
    : `Claro, ${trato}. ¿Qué ${TITULO.test(trato) ? "desea" : "quieres"} escanear: comida, gastos o inventario?`;
export const PREGUNTA_ESCANER = preguntaEscaner("señor");
const NOMBRE: Record<QueEscanear, string> = { comida: "el escáner de comida", gastos: "la foto de la boleta", inventario: "el escáner del inventario" };
export const abriendoEscaner = (q: QueEscanear) => `Abriendo ${NOMBRE[q]}.`;
