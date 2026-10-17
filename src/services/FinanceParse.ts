// ============================================================
// Eris — FinanceParse
//
// "Gasté 5 lucas en almuerzo con la BCI" → operación de Finanzas, por código. Igual que con la comida y el agua: un
// modelo de 4B a veces no llama a la herramienta y dice "✅ anotado" igual. Acá se reconoce SOLO lo inequívoco (un
// verbo claro en primera persona + un monto claro); ante la duda devuelve null y el mensaje sigue el camino de siempre.
//
// Montos a la chilena: "5 lucas" = 5.000, "luca y media" = 1.500, "un palo" = 1.000.000, "15 mil", "$4.990",
// "quince lucas", "2 gambas" = 200. Un número suelto menor a 100 NO es un monto ("gasté 5 en…" es ambiguo).
//
// La cuenta ("con la BCI", "en efectivo", "con la de crédito") viaja como PISTA de texto: la resuelve el teléfono,
// que es donde viven las cuentas de verdad (hunter-wallet.html → hwResolve).
// ============================================================

export type Categoria = "vivienda" | "alimentacion" | "transporte" | "salud" | "entretenimiento" | "deuda" | "educacion" | "hogar" | "otros";
export type FinanceAction =
  | "gasto" | "prestamo" | "cobro" | "abono" | "giro" | "transferencia" | "pago_tarjeta" | "ahorro" | "deshacer" | "resumen";

export interface FinanceOp {
  action: FinanceAction;
  /** pesos */
  monto?: number;
  descripcion?: string;
  categoria?: Categoria;
  /** pista de la cuenta de ORIGEN (o de destino en un abono): "bci", "efectivo", "tarjeta de credito"… */
  cuenta?: string;
  /** pista de la cuenta de DESTINO (transferencia, pago de tarjeta) */
  hacia?: string;
  /** a quién se le prestó / quién devolvió */
  persona?: string;
  /** YYYY-MM-DD (por defecto hoy) */
  fecha?: string;
  /** YYYY-MM-DD, cuándo devuelve un préstamo */
  devolucion?: string;
  /** deshacer: qué tipo de registro ("gasto", "prestamo"…) */
  objeto?: string;
  /** gasto en cuotas (tarjeta de crédito) */
  cuotas?: number;
}

/** Minúsculas sin acentos, con el MISMO largo que el original (los índices sirven para recortar el texto original). */
function foldAligned(s: string): string {
  let out = "";
  for (const ch of s) {
    const f = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    out += f.length === ch.length ? f : ch.length === 1 ? " " : " ".repeat(ch.length);
  }
  return out;
}
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ─── Números en palabras ───────────────────────────────────────────
const W: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300,
  trescientas: 300, cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600,
  seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};
const NUMW = Object.keys(W).sort((a, b) => b.length - a.length).join("|");
const WORDNUM = `(?:${NUMW})(?:\\s+(?:y\\s+)?(?:${NUMW}))*`;
const DIG = `\\d{1,3}(?:\\.\\d{3})+|\\d+(?:[.,]\\d+)?`;

function wordsToNumber(s: string): number {
  let n = 0;
  for (const w of s.split(/\s+/)) if (w in W) n += W[w];
  return n;
}
/** "1.500" → 1500 (miles con punto); "1,5" / "1.5" con unidad → 1.5 */
function toNum(raw: string, decimalOk: boolean): number {
  raw = raw.trim();
  if (/^[a-z]/.test(raw)) return wordsToNumber(raw);
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, ""));
  if (decimalOk) return Number(raw.replace(",", "."));
  return Number(raw.replace(/[.,]/g, ""));
}

interface Span { start: number; end: number }
export interface Amount extends Span { value: number }

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DATE_RX = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MESES.join("|")}|setiembre)(?:\\s+(?:de(?:l)?\\s+)?(\\d{4}))?\\b|\\b\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?\\b`, "g");

/** Montos de dinero en el texto ya plegado. Las fechas ("5 de octubre de 2026") se enmascaran antes. */
export function findAmounts(t: string): Amount[] {
  const masked = t.replace(DATE_RX, (m) => " ".repeat(m.length));
  const out: Amount[] = [];
  const taken = (s: number, e: number) => out.some((a) => s < a.end && e > a.start);
  const add = (s: number, e: number, v: number) => { if (v > 0 && !taken(s, e)) out.push({ start: s, end: e, value: Math.round(v) }); };
  const run = (re: RegExp, f: (m: RegExpMatchArray) => number | null) => {
    for (const m of masked.matchAll(re)) { const v = f(m); if (v != null) add(m.index!, m.index! + m[0].length, v); }
  };
  // media luca / medio palo
  run(/\bmedia\s+luca\b/g, () => 500);
  run(/\bmedio\s+palo\b/g, () => 500_000);
  // lucas (+ "y media")
  run(new RegExp(`\\b(${DIG}|${WORDNUM})\\s*(?:lucas?|luquitas?|k)\\b(\\s+y\\s+media)?`, "g"), (m) => toNum(m[1], true) * 1000 + (m[2] ? 500 : 0));
  // palos / millones (+ "y medio")
  run(new RegExp(`\\b(${DIG}|${WORDNUM})\\s*(?:palos?|millones|millon|mm)\\b(\\s+y\\s+medio)?`, "g"), (m) => toNum(m[1], true) * 1_000_000 + (m[2] ? 500_000 : 0));
  // "luca y media" / "palo y medio" sin número delante (con número ya lo tomaron las reglas de arriba)
  run(/\bluca\s+y\s+media\b/g, () => 1500);
  run(/\bpalo\s+y\s+medio\b/g, () => 1_500_000);
  // "15 mil", "quince mil quinientos"
  run(new RegExp(`\\b(${DIG}|${WORDNUM})\\s+mil\\b(?:\\s+(\\d{1,3}(?!\\d)|${WORDNUM}))?(?:\\s+pesos)?`, "g"), (m) => toNum(m[1], true) * 1000 + (m[2] ? toNum(m[2], false) : 0));
  run(/\bmil\s+pesos\b/g, () => 1000);
  // gambas (100) y quinas (500)
  run(new RegExp(`\\b(${DIG}|${WORDNUM})\\s*gambas?\\b`, "g"), (m) => toNum(m[1], false) * 100);
  run(new RegExp(`\\b(${DIG}|${WORDNUM})\\s*quinas?\\b`, "g"), (m) => toNum(m[1], false) * 500);
  // $4.990 / 4990 pesos
  run(new RegExp(`\\$\\s?(${DIG})`, "g"), (m) => toNum(m[1], false));
  run(new RegExp(`\\b(${DIG}|${WORDNUM})\\s+pesos\\b`, "g"), (m) => toNum(m[1], false));
  // número suelto con separador de miles: 12.500
  run(/\b\d{1,3}(?:\.\d{3})+\b/g, (m) => toNum(m[0], false));
  // número suelto ≥ 100 que no sea otra unidad (gramos, ml, pasos, minutos…)
  run(/\b(\d{3,7})\b(?!\s*(?:g|gr|grs|gramos?|kg|ml|cc|l|lt|litros?|kcal|cal|calorias|km|m|metros|min|minutos|pasos|horas|hrs|%|mg|mmol|mg\/dl))/g,
    (m) => Number(m[1]));
  return out.sort((a, b) => a.start - b.start);
}

// ─── Categorías de Hunter Wallet ───────────────────────────────────
const CAT_RX: Array<[Categoria, RegExp]> = [
  // Hogar/aseo (Finanzas 2.0): va primero porque "detergente en el Líder" es aseo, no comida
  ["hogar", /\b(aseo|detergentes?|lavalozas?|cloro|confort|papel higienico|toallas? de papel|toallitas|servilletas|limpia\w*|escobas?|traperos?|esponjas?|suavizante|lavaplatos|bolsas de basura|desinfectante|lysoform|quix|shampoo|acondicionador|jabon\w*|pasta de dientes|cepillo de dientes|desodorante|panales|ampolletas?|pilas)\b/],
  ["alimentacion", /\b(almuerz\w*|comida|desayun\w*|cena|onces?|colacion|super|supermercado|lider|jumbo|unimarc|tottus|santa isabel|acuenta|feria|verduler\w*|carniceri\w*|panaderi\w*|pan|cafe|cafecito|completos?|sushi|pizzas?|hamburguesas?|mcdonald\w*|burger|kfc|delivery|rappi|pedidos ?ya|uber ?eats|restaurant\w*|picada|empanadas?|mercader\w*|abarrotes|snacks?|frutas?|verduras?|carne|pollo|minimarket|almacen)\b/],
  ["transporte", /\b(uber|didi|cabify|taxi|colectivo|micro|metro|bip|pasajes?|bus|buses|bencina|bencinera|servicentro|gasolinera|nafta|combustible|copec|shell|petrobras|estacionamiento|peajes?|tag|autopista|tren|avion|vuelos?|scooter|mecanico|neumaticos?|revision tecnica|permiso de circulacion)\b/],
  ["vivienda", /\b(arriendo|dividendo|luz|gas|internet|wifi|cable|gastos? comunes|contribuciones|enel|aguas andinas|metrogas|abastible|lipigas|vtr|mudanza|ferreteria|sodimac|easy|muebles?|cuenta del agua|cuenta de la luz|cuenta del gas)\b/],
  ["salud", /\b(farmacia|remedios?|medicamentos?|pastillas?|doctor|doctora|medico|consulta|dentista|examen(es)?|isapre|fonasa|clinica|hospital|cruz verde|salcobrand|ahumada|psicolog\w*|terapia|lentes|optica|insulina|kinesiolog\w*|vacuna)\b/],
  ["entretenimiento", /\b(netflix|spotify|disney|hbo|prime video|youtube premium|cine|juegos?|steam|playstation|ps5|xbox|nintendo|carrete|copete|copas|chelas?|bar|pub|concierto|entradas?|salida|pichanga|panorama|streaming|suscripcion)\b/],
  ["deuda", /\b(cuota|cuotas|credito de consumo|prestamo|deuda|intereses?|avance|repactacion|dicom)\b/],
  ["educacion", /\b(curso|cursos|libros?|universidad|matricula|arancel|colegiatura|udemy|platzi|coursera|clases?|diplomado|certificacion|ingles|preu)\b/],
];
export function categoryFor(text: string): Categoria | undefined {
  const t = fold(text);
  for (const [c, re] of CAT_RX) if (re.test(t)) return c;
  return undefined;
}

// ─── Cuentas ──────────────────────────────────────────────────────
const BANK = "bci|bice|santander|scotia\\w*|banco estado|bancoestado|banco de chile|banco chile|edwards|falabella|cmr|ripley|itau|security|banco internacional|consorcio|coopeuch|mercado ?pago|tenpo|mach|cuenta ?rut|prex|tapp|fpay|global ?66|abcdin|hites|la polar|lider bci|cencosud|estado";
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Hint extends Span { text: string; prep: string }
const SRC_PREPS = new Set(["con", "desde", "de", "del", "en", "por"]);
const DST_PREPS = new Set(["a", "al", "hacia", "para"]);

/** Pistas de cuenta en el texto plegado. `extra` = nombres de cuentas propias ya plegados ("coopeuch", "cuenta corriente"…). */
export function findAccountHints(t: string, extra: string[] = []): Hint[] {
  const out: Hint[] = [];
  const own = extra.filter((x) => x.length >= 3).map(escapeRx).join("|");
  const bank = own ? `${own}|${BANK}` : BANK;
  const cash = /\b(con|en|al|de|desde|del|a)\s+(?:el\s+|mi\s+)?(efectivo|cash|billetes?|sencillo)\b|\b(al contado)\b/g;
  for (const m of t.matchAll(cash)) out.push({ start: m.index!, end: m.index! + m[0].length, text: "efectivo", prep: m[1] || "con" });
  const acct = new RegExp(
    `\\b(con|desde|de|del|en|por|a|al|hacia|para)\\s+(?:la\\s+|el\\s+|mi\\s+|mis\\s+)?(` +
      // primero los nombres ("cuenta rut" es un nombre, no "cuenta" + algo)
      `(?:${bank})(?:\\s+(?:debito|credito))?` +
      `|(?:tarjeta|cuenta|tc)(?:\\s+(?:de\\s+)?(?:credito|debito|corriente|vista))?(?:\\s+(?:del?\\s+|de la\\s+)?(?:${bank}))?` +
      `|debito|credito|redcompra)\\b`, "g");
  for (const m of t.matchAll(acct)) {
    const s = m.index!, e = s + m[0].length;
    if (out.some((h) => s < h.end && e > h.start)) continue;
    // "de cuenta" suelto ("estado de cuenta") o "de credito" en "cuota del credito" no son cuentas
    if ((m[1] === "de" || m[1] === "del") && /^(cuenta|credito|debito)$/.test(m[2])) continue;
    out.push({ start: s, end: e, text: m[2], prep: m[1] });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ─── Fechas ───────────────────────────────────────────────────────
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

/** Fecha futura ("mañana", "el viernes", "el 5", "el 5 de octubre", "fin de mes", "en 3 días", "la próxima semana"). */
export function parseFutureDate(t: string, now: Date): string | undefined {
  let m: RegExpMatchArray | null;
  if (/\bpasado manana\b/.test(t)) return iso(addDays(now, 2));
  if (/\bmanana\b/.test(t)) return iso(addDays(now, 1));
  if (/\bfin de mes\b/.test(t)) return iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  if (/\b(la )?(proxima|otra) semana\b/.test(t)) return iso(addDays(now, 7));
  if ((m = t.match(/\ben (\d{1,2}|una?|dos|tres|cuatro|cinco|seis|siete|diez|quince) (dias?|semanas?)\b/))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : W[m[1]] ?? 0;
    return iso(addDays(now, n * (m[2].startsWith("semana") ? 7 : 1)));
  }
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MESES.join("|")})\\b`)))) {
    const day = Number(m[1]), mon = MESES.indexOf(m[2]);
    let d = new Date(now.getFullYear(), mon, day);
    if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d = new Date(now.getFullYear() + 1, mon, day);
    return iso(d);
  }
  if ((m = t.match(/\bel (lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/))) {
    const target = DIAS.indexOf(m[1]);
    let diff = (target - now.getDay() + 7) % 7; if (diff === 0) diff = 7;
    return iso(addDays(now, diff));
  }
  if ((m = t.match(/\b(?:el|hasta el|para el) (\d{1,2})\b(?!\s*(?:lucas?|mil|pesos|palos?|%))/))) {
    const day = Number(m[1]);
    if (day < 1 || day > 31) return undefined;
    let d = new Date(now.getFullYear(), now.getMonth(), day);
    if (day <= now.getDate()) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
    return iso(d);
  }
  return undefined;
}

// ─── Intención ────────────────────────────────────────────────────
const NOT_LOG = /\b(cuant\w+|debo|deberia|puedo|podria|conviene|recomiend\w+|necesito|tengo que|hay que|quiero|quisiera|voy a|vas a|pienso|planeo|si gasto|si compro|seria|cuesta|vale|valen|precio)\b/;
const NEG = /\bno\s+(le\s+)?(gaste|pague|compre|preste|saque|ahorre|deposite)\b/;
const V_GASTO = /\b(gaste|gastamos|pague|pagamos|compre|compramos|me (?:salio|salieron|costo|costaron|cobraron)|invite|se me fueron|(?:re)?cargue(?=.*\b(?:bip|celular|telefono|fono|minutos|prepago|entel|movistar|wom|claro)\b))\b/;
const V_LOG = /\b(anota|anotame|anotalo|registra|registrame|apunta|apuntame|agrega|agregame|suma|sumale|ingresa|ingresame|ingresalo|carga|cargame)\b/;
const MONEY_WORD = /\b(lucas?|luquitas?|palos?|pesos|mil|gambas?|quinas?|gasto)\b|\$/;
const V_PREST = /\b(le )?(preste|prestamos)\b/;
const V_COBRO_DEV = /\bme (?:la |lo |las |los )?(devolvio|devolvieron)\b|\b(devolvio|pago) lo que (?:le|me) (?:preste|debia)\b/;
const V_COBRO_PAGO = /\bme (?:la |lo )?pago\b/;
const INCOME_WORD = /\b(sueldo|pega|trabajo|honorarios|boleta|cliente|finiquito|bono|aguinaldo|freelance|pension|beca|venta|vendi)\b/;
const V_GIRO = /\b(saque|sacamos|gire|giramos|retire)\b/;
const V_PAGO_TC = /\b(pague|pagamos|abone)\s+(?:la\s+|mi\s+|el\s+)?(?:(?:total|cuota|deuda|saldo)\s+de\s+(?:la\s+|mi\s+))?(tarjeta|tc|cmr|visa|mastercard|estado de cuenta)\b/;
const V_TRANSF = /\b(transferi|traspase|pase|movi|mande)\b/;
const V_ABONO = /\b(me (?:llego|llegaron|depositaron|pagaron|transfirieron|abonaron|cayo|cayeron|entro|entraron)|recibi|deposite|abone|ingrese)\b/;
const SUELDO_RX = /\b(sueldo|quincena|anticipo)\b/;
const QUINCENA_RX = /\b(quincena|anticipo)\b/;
const V_AHORRO = /\b(ahorre|ahorramos|guarde|separe|aparte)\b/;
const V_UNDO = /\b(borra\w*|elimina\w*|deshace\w*|deshaz|anula\w*|quita\w*)\s+(?:el\s+|ese\s+|lo\s+|mi\s+)?(?:ultimo\s+)?(gasto|prestamo|giro|abono|movimiento|ahorro|transferencia|pago)\b(?:\s+(?:de|del|de la|en)\s+([a-zñ ]{2,30}))?/;
const V_RESUMEN = /\b(cuanta plata (?:tengo|me queda)|cuanto (?:dinero|plata) (?:tengo|me queda)|cuanto me queda (?:de plata|en la|en el|este mes)|cuanto tengo en (?:la|el|mi)|mi saldo|mis saldos|saldo de (?:la|el|mi)|como estoy de plata|como voy (?:con la plata|con las finanzas|este mes con la plata)|cuanto (?:he |llevo )?gastad[oa]|cuanto gaste este mes)\b/;

const FILLER = /\b(eris|oye|porfa|porfis|por favor|anota|anotame|anotalo|registra|registrame|apunta|apuntame|agrega|agregame|suma|sumale|ingresa|ingresame|ingresalo|carga|cargame|un gasto de|gasto de|que|hoy|ayer|anteayer|antes de ayer|recien|recién|ya|como|aprox\w*|mas o menos)\b/g;
const LEADING = /^(?:y|en|de|del|por|para|el|la|los|las|un|una|unos|unas|al|a|mi|me|se|le)\b\s*/;

function cleanDesc(original: string, cut: Span[]): string {
  const chars = original.split("");
  for (const c of cut) for (let i = c.start; i < c.end && i < chars.length; i++) chars[i] = " ";
  let s = chars.join("");
  // quitar muletillas conservando las mayúsculas originales
  const f = foldAligned(s);
  const marks: Span[] = [];
  for (const m of f.matchAll(FILLER)) marks.push({ start: m.index!, end: m.index! + m[0].length });
  const ch2 = s.split("");
  for (const c of marks) for (let i = c.start; i < c.end; i++) ch2[i] = " ";
  s = ch2.join("").replace(/[.,;:!¡]+/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(new RegExp(LEADING.source, "i"), "").replace(/\s+(?:y|en|de|del|por|para|con|a|al|el|la)$/i, "").trim();
    if (s === before) break;
  }
  if (s.length < 2) return "";
  s = s.slice(0, 40).trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function personaAfter(original: string, t: string, from: number): { persona?: string; span?: Span } {
  const re = /\b(?:a|al|a la)\s+((?:mi\s+|la\s+|el\s+)?[a-zñ]+(?:\s+[a-zñ]+)?)/g;
  re.lastIndex = from;
  const m = re.exec(t);
  if (!m) return {};
  const STOP = /^(y|para|por|con|de|desde|que|hasta|me|el|la|lo|le|mi|devuelve|devolver|pagar|cuenta|tarjeta)$/;
  const words: string[] = [];
  let pos = m.index! + m[0].indexOf(m[1]);
  const startPersona = pos;
  for (const w of m[1].split(/\s+/)) {
    if (words.length && STOP.test(w)) break;
    words.push(w);
    pos += w.length + 1;
  }
  let raw = original.slice(startPersona, startPersona + words.join(" ").length).trim();
  raw = raw.replace(/^(la|el)\s+/i, "");
  if (!raw || STOP.test(fold(raw))) return {};
  return { persona: raw.charAt(0).toUpperCase() + raw.slice(1), span: { start: m.index!, end: startPersona + words.join(" ").length } };
}

export interface ParseOptions { now?: Date; accountNames?: string[] }

/**
 * La operación de Finanzas que pide el mensaje, o null si no es inequívoco.
 * `accountNames`: nombres de las cuentas del usuario (de su último resumen de Finanzas) para reconocer "con la Coopeuch".
 */
export function parseFinanceMessage(message: unknown, opts: ParseOptions = {}): FinanceOp | null {
  if (typeof message !== "string") return null;
  const original = message.normalize("NFC");
  if (!original.trim() || original.length > 220) return null;
  const now = opts.now ?? new Date();
  const t = foldAligned(original);
  const extra = (opts.accountNames ?? []).flatMap((n) => fold(n).split(/\s*·\s*/)).map((x) => x.trim()).filter(Boolean);

  // Consultas de saldo: se aceptan con signo de pregunta
  if (V_RESUMEN.test(t)) return { action: "resumen" };
  if (/[?¿]/.test(t)) return null;
  if (NEG.test(t)) return null;

  const undo = t.match(V_UNDO);
  if (undo) return { action: "deshacer", objeto: undo[2], ...(undo[3] ? { descripcion: undo[3].trim() } : {}) };

  if (NOT_LOG.test(t)) return null;

  const amounts = findAmounts(t);
  const distinct = [...new Set(amounts.map((a) => a.value))];
  const hints = findAccountHints(t, extra);
  const src = hints.find((h) => SRC_PREPS.has(h.prep));
  const dst = hints.find((h) => DST_PREPS.has(h.prep));
  const ayer = /\b(anteayer|antes de ayer)\b/.test(t) ? iso(addDays(now, -2)) : /\bayer\b/.test(t) ? iso(addDays(now, -1)) : undefined;
  const one = distinct.length === 1 ? amounts[0] : null;
  const withDate = (op: FinanceOp): FinanceOp => (ayer ? { ...op, fecha: ayer } : op);

  // ── Préstamo: "le presté 10 lucas a Juan, me lo devuelve el viernes"
  const vp = t.match(V_PREST);
  if (vp) {
    if (!one) return null;
    const { persona, span } = personaAfter(original, t, vp.index! + vp[0].length);
    if (!persona) return null;
    const dev = t.match(/\b(?:me (?:lo |la |los )?(?:devuelve|devuelven|paga|pagan)|hasta|para)\b(.*)$/);
    const devolucion = dev ? parseFutureDate(dev[0], now) : undefined;
    const para = t.slice((span?.end ?? 0)).match(/\bpara (?:el |la |un |una )?([a-zñ ]{3,30}?)(?:\s*(?:,|$|\bme\b|\by\b|\bcon\b|\bdesde\b))/);
    const desc = para && !/\b(el|la)?\s*(lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d+|fin de mes|manana)\b/.test(para[1]) ? para[1].trim() : undefined;
    return withDate({
      action: "prestamo", monto: one.value, persona,
      ...(desc ? { descripcion: desc } : {}),
      ...(src ? { cuenta: src.text } : {}),
      ...(devolucion ? { devolucion } : {}),
    });
  }

  // ── Cobro: "Juan me devolvió las 10 lucas", "me pagó el Pedro"
  const vcDev = t.match(V_COBRO_DEV);
  const vcPago = !vcDev && !INCOME_WORD.test(t) ? t.match(V_COBRO_PAGO) : null;
  const vc = vcDev ?? vcPago;
  if (vc) {
    const before = original.slice(0, vc.index!).trim().split(/\s+/).filter(Boolean);
    const STOPB = /^(ya|hoy|ayer|eris|oye|y|el|la|recien|al|fin|por|me)$/i;
    let persona = "";
    for (let i = before.length - 1; i >= 0 && i >= before.length - 2; i--) {
      const w = before[i].replace(/[,.:;!]/g, "");
      if (!w || STOPB.test(fold(w))) { if (persona) break; continue; }
      persona = persona ? `${w} ${persona}` : w;
    }
    if (!persona) {
      const after = t.slice(vc.index! + vc[0].length).match(/^\s*(?:el|la)\s+([a-zñ]+)/);
      if (after) { const s = vc.index! + vc[0].length + after[0].indexOf(after[1]); persona = original.slice(s, s + after[1].length); }
    }
    if (!persona) return null;
    // "me devolvió 5 de las 10 lucas" → devolución parcial de 5.000
    const parcial = t.match(new RegExp(`\\b(${DIG}|${WORDNUM}) de (?:las|los) (?:${DIG}|${WORDNUM})\\s*(lucas?|mil|palos?)\\b`));
    const monto = parcial ? toNum(parcial[1], true) * (parcial[2].startsWith("palo") ? 1_000_000 : 1000) : distinct.length === 1 ? amounts[0].value : undefined;
    if (!parcial && distinct.length > 1) return null;
    return { action: "cobro", persona: persona.charAt(0).toUpperCase() + persona.slice(1), ...(monto ? { monto } : {}) };
  }

  // ── Pago de tarjeta: "pagué la tarjeta Falabella, 100 lucas, desde la BCI" (sin monto solo si dice "el total")
  const vt = t.match(V_PAGO_TC);
  if (vt && (one || /\b(total|toda|completa|entera)\b/.test(t)) && distinct.length <= 1) {
    const tcStart = vt.index! + vt[0].lastIndexOf(vt[2]);
    const rest = t.slice(tcStart).match(new RegExp(`^(tarjeta|tc|cmr|visa|mastercard|estado de cuenta)(?:\\s+(?:de\\s+(?:credito\\s+)?)?(?:de\\s+la\\s+|del\\s+|de\\s+)?(${BANK}${extra.length ? "|" + extra.map(escapeRx).join("|") : ""}))?`));
    const tarjeta = rest ? (rest[2] ? `tarjeta ${rest[2]}` : rest[1] === "cmr" ? "cmr" : "tarjeta de credito") : "tarjeta de credito";
    const tcEnd = tcStart + (rest?.[0].length ?? 0);
    const source = hints.find((h) => SRC_PREPS.has(h.prep) && (h.end <= vt.index! || h.start >= tcEnd));
    return withDate({ action: "pago_tarjeta", ...(one ? { monto: one.value } : {}), hacia: tarjeta, ...(source ? { cuenta: source.text } : {}) });
  }

  // ── "Me llegó el sueldo" / "me pagaron la quincena" SIN monto: el teléfono usa el sueldo configurado y su cuenta
  if (!amounts.length && V_ABONO.test(t) && SUELDO_RX.test(t)) {
    const hint = dst ?? src;
    return withDate({ action: "abono", ...(hint ? { cuenta: hint.text } : {}), descripcion: QUINCENA_RX.test(t) ? "Quincena" : "Sueldo" });
  }

  if (!one) return null;
  // "2 cafés a 3 lucas cada uno": el total no es el monto que aparece
  if (/\bcada (?:un[oa]|vez)\b|\bc\/u\b/.test(t)) return null;

  // ── Giro: "saqué 20 lucas del cajero de la BCI" ("saqué entradas por 30 lucas" NO es giro: el monto debe seguir al verbo)
  const vgiro = t.match(V_GIRO);
  if (vgiro) {
    const pegado = one.start - (vgiro.index! + vgiro[0].length) <= 1;
    if (/\b(cajero|efectivo|cash|billetes?)\b/.test(t) || (pegado && src && src.text !== "efectivo")) {
      return withDate({ action: "giro", monto: one.value, ...(src && src.text !== "efectivo" ? { cuenta: src.text } : {}) });
    }
    if (pegado) return withDate({ action: "giro", monto: one.value });
    return null;
  }

  // ── Transferencia entre cuentas propias: exige origen y destino reconocibles
  if (V_TRANSF.test(t)) {
    if (src && dst) return withDate({ action: "transferencia", monto: one.value, cuenta: src.text, hacia: dst.text });
    // "transferí 10 lucas a Juan": ¿préstamo, pago, regalo? que pregunte el modelo. ("pasé al super…" sigue abajo)
    if (/\b(transferi|traspase|movi|mande)\b/.test(t)) return null;
  }

  // ── Abono / ingreso a una cuenta: "me llegó el sueldo, 1.2 palos a la BCI"
  if (V_ABONO.test(t)) {
    const hint = dst ?? src;
    // La descripción le dice al teléfono si es un INGRESO (sueldo, extra, pasivo) o solo plata que entra (devolución)
    const desc = /\bsueldo\b/.test(t) ? "Sueldo" : QUINCENA_RX.test(t) ? "Quincena"
      : /\bbono\b/.test(t) ? "Bono" : /\baguinaldo\b/.test(t) ? "Aguinaldo" : /\b(honorarios?|boleta)\b/.test(t) ? "Honorarios"
      : /\bdividendos?\b/.test(t) ? "Dividendos" : /\bintereses?\b/.test(t) ? "Intereses" : /\barriendo\b/.test(t) ? "Arriendo"
      : /\bdevolucion\b/.test(t) ? "Devolución" : undefined;
    return withDate({ action: "abono", monto: one.value, ...(hint ? { cuenta: hint.text } : {}), ...(desc ? { descripcion: desc } : {}) });
  }

  // ── Ahorro: "ahorré 50 lucas para el viaje"
  const va = t.match(V_AHORRO);
  if (va) {
    const para = t.match(/\bpara (?:el |la |un |una |mi )?([a-zñ ]{3,30})$/);
    return withDate({ action: "ahorro", monto: one.value, ...(para ? { descripcion: para[1].trim().replace(/^./, (c) => c.toUpperCase()) } : {}) });
  }

  // ── Gasto: verbo de gasto, o "anota/registra" + palabra de dinero
  const vg = t.match(V_GASTO);
  const vl = !vg && V_LOG.test(t) && MONEY_WORD.test(t) ? t.match(V_LOG) : null;
  const verb = vg ?? vl;
  if (!verb) return null;
  // Comer y gastar en el mismo mensaje ("comí un completo de 3 lucas"): que lo resuelva el modelo con ambas herramientas
  if (/\b(comi|comimos|desayune|almorce|cene|me tome|tome)\b/.test(t)) return null;

  const cut: Span[] = [{ start: verb.index!, end: verb.index! + verb[0].length }];
  // "a 30 lucas" / "por 30 lucas": el conector antes del monto también sale
  const pre = t.slice(0, one.start).match(/\b(a|por|en|de)\s*$/);
  cut.push({ start: pre ? one.start - pre[0].length : one.start, end: one.end });
  for (const h of hints) cut.push(h);
  // "en 3 cuotas" (con tarjeta de crédito): el teléfono lo anota como compra en cuotas; no es parte de la descripción
  // ni de la categoría ("cuotas" sonaría a deuda)
  const cq = t.match(new RegExp(`\\ben (\\d{1,2}|${WORDNUM}) cuotas\\b`));
  const cuotas = cq ? toNum(cq[1], false) : undefined;
  if (cq) cut.push({ start: cq.index!, end: cq.index! + cq[0].length });
  // "…15 lucas en verduras, pagué con…": lo que viene justo después del monto es la mejor descripción
  const after = t.slice(one.end).match(/^\s+(?:en|de)\s+(?:(?:el|la|los|las|un|una|unos|unas|mi)\s+)?([a-zñ]+(?:\s+(?!y\b|con\b|por\b|desde\b|en\b|pague\b|que\b)[a-zñ]+){0,3}?)(?=\s*(?:[,.;!]|$|\b(?:con|por|desde|y|en efectivo|pague|que)\b))/);
  const desc = after && after[1].length >= 3 && !hints.some((h) => h.start <= one.end + after[0].length && h.end > one.end)
    ? (() => { const s = one.end + after[0].lastIndexOf(after[1]); const raw = original.slice(s, s + after[1].length); return raw.charAt(0).toUpperCase() + raw.slice(1); })()
    : cleanDesc(original, cut);
  const categoria = (desc && categoryFor(desc)) || categoryFor(t.split("").map((c, i) => (cut.slice(1).some((h) => i >= h.start && i < h.end) ? " " : c)).join("")) || "otros";
  return withDate({
    action: "gasto", monto: one.value,
    descripcion: desc || "Gasto",
    categoria,
    ...(cuotas && cuotas >= 2 && cuotas <= 48 ? { cuotas } : {}),
    ...(src ? { cuenta: src.text } : dst && /\b(tarjeta|debito|credito|efectivo)\b/.test(dst.text) ? { cuenta: dst.text } : {}),
  });
}

/** Nombres de cuentas que aparecen en el resumen de Finanzas que manda el teléfono ("  · BCI · Cuenta corriente (débito): $…"). */
export function accountNamesFromContext(ctx: unknown): string[] {
  if (typeof ctx !== "string") return [];
  return [...ctx.matchAll(/^\s*·\s+(.+?)\s+\((?:débito|tarjeta de crédito|cuenta de ahorro)\):/gm)].map((m) => m[1]);
}

// ─── «¿Y si me compro…?» ──────────────────────────────────────────
// Simular antes de comprar (FinanceCore.simularCompra, 2026-10-15): cómo quedaría su plata, SIN anotar nada. Necesita un
// monto claro (uno solo); si no, lo ve el modelo. Antes "si compro" caía en NOT_LOG y el modelo contestaba a ojo.

export interface FinanceWhatIf { action: "simular"; monto: number; descripcion?: string; categoria?: Categoria; cuotas?: number; cuenta?: string }

const WHATIF_FIN = new RegExp("\\b(?:" + [
  "(?:que\\s+(?:pasa|pasaria|tal)\\s+)?si\\s+(?:me\\s+)?(?:compro|comprara|comprase|gasto|gastara|pago|pagara|pido|pidiera|saco|sacara|doy|diera)(?:\\s+(?:en|por))?",
  "(?:me\\s+)?(?:puedo|podria)\\s+(?:comprar|comprarme|gastar|gastarme|pagar|darme|pedir)",
  "(?:me\\s+)?(?:conviene|convendria)\\s+(?:comprar|comprarme|gastar|pagar)",
  "(?:es\\s+|seria\\s+)?(?:buena|mala)\\s+idea\\s+(?:comprar|comprarme|gastar|pagar)",
  "(?:me\\s+)?(?:alcanza|alcanzaria|da|daria)\\s+(?:la\\s+plata\\s+|el\\s+presupuesto\\s+)?para",
  "simula(?:r|me)?(?:\\s+(?:un\\s+gasto|una\\s+compra|que\\s+(?:me\\s+)?(?:compro|gasto)))?(?:\\s+de)?",
  "(?:estoy\\s+)?pensando\\s+en\\s+(?:comprar|comprarme|gastar)",
].join("|") + ")\\b");
// Lo que suele ir al final ("…, ¿cómo quedo?", "¿me alcanza?") no es parte de lo que piensa comprar
const WHATIF_FIN_TAIL = /[\s,]*(?:(?:como|cuanto|en que)\s+(?:quedo|quedaria|me\s+(?:queda|quedaria|afecta|afectaria))|que\s+pasa(?:ria)?|me\s+(?:alcanza|alcanzaria|conviene|convendria)|se\s+puede|esta\s+bien|lo\s+hago|vale\s+la\s+pena)\b.*$/;

/** «¿y si me compro unas zapatillas de 60 lucas?», «¿puedo gastar 20 lucas en un carrete?», «¿me alcanza para un celular de 300 lucas en 6 cuotas?» */
export function parseFinanceWhatIf(message: unknown, opts: ParseOptions = {}): FinanceWhatIf | null {
  if (typeof message !== "string") return null;
  const original = message.normalize("NFC");
  if (!original.trim() || original.length > 220) return null;
  const t = foldAligned(original).replace(/[¡!¿?;:]/g, " ");
  const m = t.match(WHATIF_FIN);
  if (!m) return null;
  // Un monto, uno solo ("2 cuotas de 30 lucas" o "60 o 80 lucas" lo ve el modelo)
  const cq = t.match(new RegExp(`\\ben (\\d{1,2}|${WORDNUM}) cuotas\\b`));
  const cuotas = cq ? toNum(cq[1], false) : undefined;
  const amounts = findAmounts(t).filter((a) => !cq || a.end <= cq.index! || a.start >= cq.index! + cq[0].length);
  const distinct = [...new Set(amounts.map((a) => a.value))];
  if (distinct.length !== 1) return null;
  const one = amounts[0];
  // "entre 20 y 30 lucas", "de 20 o 30 lucas": un rango, no un monto
  if (/\b\d+\s+(?:o|a|y|u)\s+$/.test(t.slice(0, one.start))) return null;
  const extra = (opts.accountNames ?? []).flatMap((n) => fold(n).split(/\s*·\s*/)).map((x) => x.trim()).filter(Boolean);
  const hints = findAccountHints(t, extra);
  const src = hints.find((h) => SRC_PREPS.has(h.prep));
  // Lo que piensa comprar: lo que sigue a la pregunta, sin el monto, las cuotas, la cuenta ni la cola
  const start = m.index! + m[0].length;
  const chars = original.split("");
  const blank = (s: number, e: number) => { for (let i = s; i < e && i < chars.length; i++) chars[i] = " "; };
  const pre = t.slice(0, one.start).match(/\b(?:a|por|en|de)\s*$/);
  blank(pre ? one.start - pre[0].length : one.start, one.end);
  if (cq) blank(cq.index!, cq.index! + cq[0].length);
  for (const h of hints) blank(h.start, h.end);
  const tailAt = t.slice(start).search(WHATIF_FIN_TAIL);
  const end = tailAt >= 0 ? start + tailAt : t.length;
  let desc = chars.join("").slice(start, end).replace(/[¡!¿?;:.,]+/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const before = desc;
    desc = desc.replace(/^(?:en|de|del|por|para|con|a|al|el|la|los|las|un|una|unos|unas|mi|mis|me|hoy|ahora)\b\s*/i, "").replace(/\s+(?:y|en|de|del|por|para|con|a|al|el|la)$/i, "").trim();
    if (desc === before) break;
  }
  desc = desc.slice(0, 40).trim();
  const descripcion = desc.length >= 2 ? desc.charAt(0).toUpperCase() + desc.slice(1) : undefined;
  // (sin el monto, las cuotas ni la cuenta: "cuotas" sonaría a deuda)
  const categoria = (descripcion && categoryFor(descripcion)) || categoryFor(chars.join("").slice(start, end)) || undefined;
  return {
    action: "simular", monto: one.value,
    ...(descripcion ? { descripcion } : {}),
    ...(categoria ? { categoria } : {}),
    ...(cuotas && cuotas >= 2 && cuotas <= 48 ? { cuotas } : {}),
    ...(src ? { cuenta: src.text } : {}),
  };
}
