// ============================================================
// Hestia por voz (J1, 2026-11-16): el texto que escribe el modelo → lo que dice Piper.
//
// El modelo escribe las cifras en números (J0: cuando las escribía en palabras se equivocaba: 606 kcal salió «setenta y seis mil
// calorías»); acá se dicen bien, por código: «$45.196» → «cuarenta y cinco mil ciento noventa y seis pesos», «21:10» → «las nueve
// y diez de la noche», «2,8 L» → «dos coma ocho litros». También se quita lo que no se lee en voz alta (markdown, emojis, botones).
// ============================================================

const UNIDADES = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce",
  "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco",
  "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const DECENAS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function hasta999(n: number): string {
  if (n < 30) return UNIDADES[n];
  if (n < 100) { const d = Math.floor(n / 10), u = n % 10; return u ? `${DECENAS[d]} y ${UNIDADES[u]}` : DECENAS[d]; }
  if (n === 100) return "cien";
  const c = Math.floor(n / 100), r = n % 100;
  return r ? `${CENTENAS[c]} ${hasta999(r)}` : CENTENAS[c];
}

/** Un entero en palabras (hasta los miles de millones). `apocope`: «un»/«veintiún» delante de un sustantivo («un litro»). */
export function numeroEnPalabras(n: number, apocope = false): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `menos ${numeroEnPalabras(-n, apocope)}`;
  n = Math.floor(n);
  const partes: string[] = [];
  const milMillones = Math.floor(n / 1e9), millones = Math.floor((n % 1e9) / 1e6), miles = Math.floor((n % 1e6) / 1e3), resto = n % 1e3;
  if (milMillones) partes.push(milMillones === 1 ? "mil millones" : `${numeroEnPalabras(milMillones, true)} mil millones`);
  if (millones) partes.push(millones === 1 ? "un millón" : `${numeroEnPalabras(millones, true)} millones`);
  if (miles) partes.push(miles === 1 ? "mil" : `${hasta999(miles).replace(/uno$/, "ún").replace(/^ún$/, "un").replace(/veintiún$/, "veintiún")} mil`);
  if (resto || !partes.length) partes.push(hasta999(resto));
  let s = partes.join(" ");
  if (apocope) s = s.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");
  return s.replace(/\s+/g, " ").trim();
}

/** «45.196» o «45196» → 45196; «2,8» → 2.8 (en Chile el punto separa miles y la coma, decimales) */
function aNumero(s: string): number {
  const limpio = s.replace(/\./g, "").replace(",", ".");
  return Number(limpio);
}
function decimalEnPalabras(s: string, apocope = false): string {
  const [ent, dec] = s.replace(/\./g, "").split(",");
  const e = numeroEnPalabras(Number(ent), apocope && !dec);
  if (!dec) return e;
  // «2,5» → «dos coma cinco»; «1,05» → «uno coma cero cinco»
  const d = dec.length <= 2 && !dec.startsWith("0") ? numeroEnPalabras(Number(dec)) : dec.split("").map((x) => UNIDADES[Number(x)]).join(" ");
  return `${e} coma ${d}`;
}

/** «21:10» → «las nueve y diez de la noche»; «13:00» → «la una de la tarde»; «10:30» → «las diez y media de la mañana» */
export function horaEnPalabras(h: number, m: number): string {
  const momento = h < 6 ? "de la madrugada" : h < 12 ? "de la mañana" : h < 20 ? "de la tarde" : "de la noche";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const art = h12 === 1 ? "la" : "las";
  const hora = h12 === 1 ? "una" : numeroEnPalabras(h12);
  const min = m === 0 ? "" : m === 15 ? " y cuarto" : m === 30 ? " y media" : ` y ${numeroEnPalabras(m)}`;
  return `${art} ${hora}${min} ${momento}`;
}

/** «seiscientos seis» → «seiscientas seis», «veintiún» → «veintiuna» (calorías, horas son femeninas) */
function femenino(s: string): string {
  return s.replace(/ientos\b/g, "ientas").replace(/\bveintiún\b/g, "veintiuna").replace(/\bun\b/g, "una").replace(/\buno\b$/, "una");
}
const FEMENINAS = new Set(["caloría", "calorías", "hora", "horas"]);
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const UNIDAD_DICHA: Array<[RegExp, string, string]> = [
  // [unidad, singular, plural]
  [/^kcal$/i, "caloría", "calorías"], [/^cal$/i, "caloría", "calorías"], [/^kg$/i, "kilo", "kilos"], [/^g$|^gr$|^grs$/i, "gramo", "gramos"],
  [/^mg$/i, "miligramo", "miligramos"], [/^ml$|^cc$/i, "mililitro", "mililitros"], [/^l$|^lt$|^lts$/i, "litro", "litros"],
  [/^km$/i, "kilómetro", "kilómetros"], [/^m$/i, "metro", "metros"], [/^min$/i, "minuto", "minutos"], [/^h$|^hrs?$/i, "hora", "horas"],
  [/^%$/, "por ciento", "por ciento"], [/^°c$|^º c$|^°$/i, "grado", "grados"], [/^bpm$|^lpm$/i, "latido por minuto", "latidos por minuto"],
  // (el estado de los sistemas, L0: «2,7 GB» se decía «dos, siete GB»)
  [/^gb$/i, "giga", "gigas"], [/^mb$/i, "mega", "megas"], [/^w$/i, "watt", "watts"],
];
/** Siglas y abreviaturas que Piper lee mal */
const SIGLAS: Array<[RegExp, string]> = [
  [/\bAXS\b/g, "a equis ese"], [/\bPC\b/g, "pe ce"], [/\bCPU\b/g, "ce pe u"], [/\bRAM\b/g, "ram"], [/\bOK\b/gi, "okey"], [/\betc\.?/gi, "etcétera"], [/\baprox\.?/gi, "aproximadamente"],
  [/\bN[°º]\s?/g, "número "], [/\bUF\b/g, "u efe"], [/\bRIR\b/g, "erre i erre"], [/\bRPE\b/g, "erre pe e"], [/\bIVA\b/g, "iva"], [/\bHbA1c\b/gi, "hemoglobina glicosilada"], [/\bvs\.?\b/gi, "contra"],
];

/** Lo que el modelo escribe → lo que se dice en voz alta. Vacío si no queda nada que decir. */
export function paraHablar(texto: string): string {
  let t = String(texto ?? "");
  // lo que no se lee: botones, bloques de código, enlaces, markdown, emojis, notas internas
  t = t.replace(/\[Opción:[^\]]*\]/g, " ").replace(/\[(Para ti|Guía médica|Cómo presentarlo)[^\]]*\]/g, " ");
  t = t.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/https?:\/\/\S+/g, "el enlace");
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, "").replace(/^\s*>\s?/gm, "");
  t = t.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/gm, ""); // viñetas: cada una queda como su propia frase (ver abajo)
  t = t.replace(/\*\*|__|\*|_(?=\S)|(?<=\S)_/g, "");
  t = t.replace(/\p{Extended_Pictographic}|️|‍/gu, "");
  // un modelo con letra y número junto («Galaxy S24», «Pixel 9a» no): la letra aparte, si no se leía «Sveinticuatro» (L4)
  t = t.replace(/\b([A-ZÁÉÍÓÚÑ]{1,3})(\d{1,4})\b/g, "$1 $2");
  // tablas (J2): sin la fila de títulos ni la de guiones; cada fila, «Lunes, 2.100»
  {
    const ls = t.split("\n");
    const sep = (l: string | undefined) => !!l && /^\s*\|?\s*:?-{3,}/.test(l) && l.includes("-");
    t = ls.filter((l, i) => !sep(l) && !(/^\s*\|/.test(l) && sep(ls[i + 1])))
      .map((l) => (/^\s*\|/.test(l) ? l.split("|").map((c) => c.trim()).filter(Boolean).join(", ") : l)).join("\n");
  }
  // una hora al comienzo de la línea («13:00 Almuerzo», como en la agenda) → «a la una de la tarde, Almuerzo»
  t = t.replace(/^(\s*)([01]?\d|2[0-3]):([0-5]\d)\s+(?=[^\s\d])/gm, "$1a las $2:$3, ");
  // cada línea es una frase (listas, tablas)
  t = t.split(/\n+/).map((l) => l.replace(/\|/g, ", ").trim()).filter(Boolean).map((l) => (/[.!?…:;,]$/.test(l) ? l : `${l}.`)).join(" ");
  // series y rangos (J2): «4x6-8» → «4 series de 6 a 8»; «6-8 reps» → «6 a 8 repeticiones»
  t = t.replace(/(\d+)\s?[x×]\s?(\d+)\s?[-–]\s?(\d+)(\s*reps?\b)?/gi, "$1 series de $2 a $3 repeticiones")
    .replace(/\breps?\b/gi, "repeticiones");
  // plurales de plantilla y archivos de la bóveda (J2, el briefing: «5 tarea(s) inmediata(s) en MEMORY.md»)
  t = t.replace(/(\p{L})\((e?s)\)/gu, "$1$2").replace(/\b([\p{L}\d_-]+)\.md\b/gu, "$1");
  // «Fondos / Dips» → «Fondos o Dips» (una barra entre espacios; «16/11» es una fecha y va abajo)
  t = t.replace(/\s\/\s/g, " o ");
  // siglas y símbolos sueltos («+7 g · ~$190», «½ lata»)
  for (const [re, dicho] of SIGLAS) t = t.replace(re, dicho);
  t = t.replace(/½/g, " media ").replace(/¼/g, " un cuarto de ").replace(/¾/g, " tres cuartos de ")
    .replace(/\+\s?(?=\$?\d)/g, "más ").replace(/[~≈]\s?(?=\$?\d)/g, "unos ").replace(/\s[·•|]\s/g, ", ").replace(/\s*(?:→|=>|->)\s*/g, ", ")
    .replace(/(\d)\s?[x×]\s?(\d)/g, "$1 por $2");
  // plata: «$45.196» / «$ 12.990» / «$3,5 millones»
  t = t.replace(/\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(\s*(?:mil\b|millones\b|millón\b))?/g, (_, ent: string, dec: string | undefined, escala: string | undefined) => {
    const num = dec ? decimalEnPalabras(`${ent},${dec}`, true) : numeroEnPalabras(aNumero(ent), true);
    return escala ? `${num}${escala} de pesos` : `${num} ${aNumero(ent) === 1 && !dec ? "peso" : "pesos"}`;
  });
  // horas: «a las 21:10», «10:00 hrs»
  t = t.replace(/\b(?:(a\s+)?(?:las|la)\s+)?([01]?\d|2[0-3]):([0-5]\d)(?:\s*(?:hrs?|horas)\b\.?)?/gi, (_, a: string | undefined, h: string, m: string) =>
    `${a ? "a " : ""}${horaEnPalabras(Number(h), Number(m))}`);
  // cifra + unidad: «2,8 L», «606 kcal», «15%», «120 g»
  t = t.replace(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s?(kcal|cal|kg|gb|mb|grs?|g|mg|ml|cc|lts?|l|km|min|hrs?|h|bpm|lpm|%|°c|º c|°|w)(?![a-záéíóúñ])/gi, (_, ent: string, dec: string | undefined, u: string) => {
    const par = UNIDAD_DICHA.find(([re]) => re.test(u));
    const n = aNumero(dec ? `${ent},${dec}` : ent);
    const num = dec ? decimalEnPalabras(`${ent},${dec}`) : numeroEnPalabras(n, true);
    if (!par) return `${num} ${u}`;
    const palabra = n === 1 && !dec ? par[1] : par[2];
    return `${FEMENINAS.has(palabra) && !dec ? femenino(num) : num} ${palabra}`;
  });
  // fechas: «15/11» y «el 18-11» → «quince de noviembre» (J2; antes «quince del once»)
  const fecha = (todo: string, d: string, m: string) => (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31
    ? `${numeroEnPalabras(Number(d))} de ${MESES[Number(m) - 1]}` : todo);
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g, (todo, d: string, m: string) => fecha(todo, d, m));
  t = t.replace(/\b(el|del|al|hasta el|desde el)\s+(\d{1,2})-(\d{1,2})(?:-\d{2,4})?\b/gi, (todo, p: string, d: string, m: string) => {
    const f = fecha("", d, m);
    return f ? `${p} ${f}` : todo;
  });
  // un rango que quede («entre 6-8», «2–3 vasos») → «6 a 8»
  t = t.replace(/(\d)\s?[-–]\s?(?=\d)/g, "$1 a ");
  // cifra + palabra («201 calorías», «21 días», «1 vez»): concuerda con ella (femenino, «un»/«una»). Nunca desde la mitad de un
  // decimal: en «4,2 litros» el «2» es la parte decimal (antes salía «cuatro, dos litros»; L1, 2026-11-17)
  t = t.replace(/(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+)\s+([a-záéíóúñ]+)/gi, (todo, ent: string, w: string) => {
    if (/^(de|del|y|o|a|en|con|por|para|que|al)$/i.test(w)) return todo;
    const fem = /^(calor[ií]as?|horas?|veces|vez|semanas?|personas?|porci[oó]n(es)?|tazas?|cucharadas?|series?|repetici[oó]n(es)?|unidad(es)?|latas?|comidas?|botellas?|piezas?|rebanadas?|presas?|marraquetas?|hallullas?|empanadas?|naranjas?|manzanas?|cosas?|tareas?|reuni[oó]n(es)?|noches?|cuotas?|lucas?)$/i.test(w);
    const num = numeroEnPalabras(aNumero(ent), true);
    return `${fem ? femenino(num) : num} ${w}`;
  });
  // lo que quede: «1.500», «2,5», «3»
  t = t.replace(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?/g, (_, ent: string, dec: string | undefined) => (dec ? decimalEnPalabras(`${ent},${dec}`) : numeroEnPalabras(aNumero(ent))));
  // unidades sin cifra (el título de una columna, «las kcal de hoy»)
  t = t.replace(/\bkcal\b/gi, "calorías");
  return t.replace(/\s+([,.;:!?])/g, "$1").replace(/([,;:])(?=\S)/g, "$1 ").replace(/\s{2,}/g, " ").replace(/^[\s,.;:]+/, "").trim();
}
