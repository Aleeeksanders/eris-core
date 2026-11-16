// ============================================================
// Eris — un plato dicho en el chat → lo que se anota (2026-11-15)
//
// «Comí tallarines con salsa y carne molida, tenía pimentón» quedó anotado como 100 g de carne molida (250 kcal, 0 g de
// carbohidratos). El usuario: «ocurrirá mucho, si es que no va a ser el problema más común de nutrición… Eris debe ser capaz
// de resolver esto sí o sí, es la base de anotar en el chat». La gente no dice el nombre de la base: dice el plato como lo
// comió. Esto lo arma POR CÓDIGO, para cualquier plato, sin agregar nombres uno por uno:
//   1. el plato entero, si la base lo tiene («porotos con riendas»);
//   2. si no, el pedazo más largo que sí es un plato («tallarines con salsa» → Tallarines con salsa bolognesa) y lo que ese
//      plato ya trae no se suma dos veces (la carne de la bolognesa);
//   3. lo demás, cada cosa en la porción que tiene EN un plato según su papel: el acompañamiento (arroz, papas) como
//      acompañamiento, la proteína agregada, la salsa como salsa, lo que «tenía» (pimentón, cebolla) en porción chica;
//   4. sin cantidad dicha: un plato normal, y se dice. Con cantidad («300 g de…», «2 platos de…»): se reparte en proporción.
// Lo que no se encuentra no se inventa: se dice que no se sumó.
// ============================================================

import foods from "../data/chilean-foods.json";

/** Lo mínimo que hace falta de un alimento de la base */
export interface HitPlato { name: string; servingGrams: number; servingDescription: string; aliases?: string[]; /** tomado con un error de tipeo («curry» ~ «churros»): no sirve para los respaldos */ fuzzy?: boolean }
/** `papel`: el plato principal («lentejas» → el guiso) o un agregado («lentejas» → las lentejas cocidas), para desempatar */
export type ResolverPlato = (q: string, papel?: "base" | "agregado") => Promise<HitPlato | null>;

export type Rol = "plato" | "almidon" | "pan" | "proteina" | "huevo" | "salsa" | "grasa" | "verdura" | "palta" | "queso" | "fruta" | "bebida" | "otro";

/** Ajuste de los macros de un plato ya armado de la base (cazuela, pollo con arroz) según cómo es el plato de la persona */
export interface AjustePlato { carbs: number; protein: number; fat: number }
export interface PlatoArmado {
  items: Array<{ name: string; grams: number; ajuste?: AjustePlato }>;
  /** lo que se le dice a la persona (porción normal, lo que ya venía en el plato, lo estimado, lo que no se encontró) */
  notas: string[];
  /** lo que no se encontró en la base (no se anotó) */
  faltan: string[];
  /** ¿se anotó un plato normal porque no dijo cuánto? */
  porcionNormal: boolean;
}

const fold = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const GEN = new Set(["de", "del", "la", "el", "los", "las", "con", "en", "al", "a", "un", "una", "y", "e", "mi", "su", "sus", "o"]);
const stem = (w: string) => (w.length > 4 && /[^aeiou]es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const palabras = (s: string) => fold(s).replace(/[^a-z0-9ñ ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !GEN.has(w)).map(stem);

// ─── El papel de cada alimento en un plato (por su categoría y grupo en la base) ───────────────────────────────
type Ficha = { category?: string; group?: string };
const FICHAS = new Map<string, Ficha>();
for (const f of foods as Array<{ name: string; aliases?: string[]; category?: string; group?: string }>) {
  const ficha = { category: f.category, group: f.group };
  for (const n of [f.name, ...(f.aliases ?? [])]) if (!FICHAS.has(fold(n))) FICHAS.set(fold(n), ficha);
}

export function rolDe(name: string): Rol {
  const n = fold(name);
  const f = FICHAS.get(n) ?? {};
  if (/^(papas? fritas|papas? (cocidas?|al horno|duquesas?|doradas?|salteadas?|rusticas?)|papa\b|pure|camote|choclo|arroz|fideo|tallarin|espaguet|pasta (cocida|integral|fresca)|quinoa|cuscus|polenta|mote\b|lentejas?|porotos?|garbanzos?)/.test(n) && f.category !== "platos") return "almidon";
  if (/^palta/.test(n)) return "palta";
  if (/^(huevo|huevos)\b/.test(n)) return "huevo";
  if (/^(queso|quesillo)/.test(n)) return "queso";
  if (f.group === "verdura") return "verdura";
  if (f.category === "platos" || f.category === "comida_rapida" || f.group === "plato_casero" || f.group === "comida_rapida") return "plato";
  if (f.group === "pan" || f.category === "panes") return "pan";
  if (["carne_roja", "proteina_magra", "pescado", "embutido"].includes(String(f.group)) || ["carnes", "pescados"].includes(String(f.category))) return "proteina";
  if (f.group === "huevo") return "huevo";
  if (f.group === "grasa") return "grasa";
  if (f.category === "aderezos") return "salsa";
  if (f.group === "cereal_refinado" || f.group === "cereal_integral" || f.group === "legumbre" || f.category === "cereales" || f.category === "legumbres") return "almidon";
  if (f.group === "lacteo") return /queso|quesillo/.test(n) ? "queso" : "otro";
  if (f.group === "fruta" || f.category === "frutas") return "fruta";
  if (f.category === "bebidas" || /^bebida|^jugo|^agua/.test(n)) return "bebida";
  if (/^(pollo|pechuga|carne|vacuno|cerdo|pescado|salmon|atun|merluza|reineta|jurel|longaniza|chorizo|vienesa|salchicha|jamon|pavo)/.test(n)) return "proteina";
  if (/^salsa|pomarola|ketchup|mayonesa|mostaza|pebre|aji\b/.test(n)) return "salsa";
  return "otro";
}

/** ¿Es una salsa para pasta (va en cantidad de plato, no de cucharada)? */
const SALSA_PASTA = /pomarola|salsa de tomates? para pasta|salsa para pasta|bechamel|salsa blanca|salsa bolo|pesto|salsa de tomate natural/;
const ES_PASTA = /tallar|fideo|espag|spagh|pasta\b|[ñn]oqui|lasa|raviol|canel/;

/**
 * Gramos de un agregado según su papel y el del plato base (sin cantidad dicha). `chico`: lo que el plato «tenía» (pimentón).
 * La porción de la base manda si es menor (una cucharada de mayo no se vuelve 20 g de golpe).
 */
function gramosAgregado(rol: Rol, hit: HitPlato, base: Rol, chico: boolean): number {
  const s = hit.servingGrams > 0 ? hit.servingGrams : 100;
  if (chico) return Math.min(30, s);
  const n = fold(hit.name);
  switch (rol) {
    case "almidon": return Math.min(s, 150); // acompañamiento
    case "pan": case "huevo": case "plato": case "fruta": case "bebida": return s; // por unidad / porción
    case "proteina": return base === "almidon" || base === "plato" ? Math.min(s, 80) : Math.min(s, 120);
    case "salsa": return SALSA_PASTA.test(n) ? Math.min(Math.max(s, 80), 100) : Math.min(s, 20);
    case "grasa": return Math.min(s, /aceite/.test(n) ? 5 : 15);
    case "verdura": return /ensalada/.test(n) ? Math.min(s, 120) : Math.min(s, 60);
    case "palta": return Math.min(s, 40);
    case "queso": return Math.min(s, 20);
    default: return Math.min(s, 50);
  }
}

// ─── Leer la frase ─────────────────────────────────────────────────────────────────────────────────────────────
/** Lo que el plato «tenía» / «llevaba» (va dentro, en porción chica): «…, tenía pimentón y cebolla» */
const DENTRO = /(?:,\s*|\s+)(?:que\s+)?(?:tenia|tenian|llevaba|llevaban|traia|traian|venia con|venian con|le puse|le eche|le agregue|le agregamos)\s+(.+)$/;
const MULT = (s: string): { s: string; k: number } => {
  const m = s.match(/^(?:un poco de|un poquito de|poquito de|algo de|poco|poca)\s+/);
  if (m) return { s: s.slice(m[0].length), k: 0.5 };
  const h = s.match(/^(?:harto|harta|hartos|hartas|mucho|mucha|muchos|muchas|doble(?: de)?)\s+/);
  if (h) return { s: s.slice(h[0].length), k: 1.5 };
  return { s, k: 1 };
};
const limpiar = (s: string) => s.replace(/^(?:de|del|el|la|los|las|un|una|unos|unas|su|sus)\s+/g, "").replace(/^(?:el|la|los|las)\s+/, "").replace(/[.;:!]+$/g, "").trim();

/**
 * «tallarines con salsa y carne molida, tenía pimentón» → cabeza «tallarines», agregados [salsa, carne molida],
 * dentro [pimentón]. Sin «con», «arroz y pollo» también es cabeza + agregado (es el mismo plato).
 */
export function partirPlato(frase: string): { cabeza: string; agregados: string[]; dentro: string[]; completo: string } {
  let t = fold(frase).replace(/\s+/g, " ").trim();
  const dentro: string[] = [];
  const d = t.match(DENTRO);
  if (d) { t = t.slice(0, d.index).trim(); dentro.push(...d[1].split(/\s*(?:,|\by\b|\be\b)\s*/).map(limpiar).filter(Boolean)); }
  t = t.replace(/[,.;]+$/, "").trim();
  const completo = t;
  const i = t.search(/\s(?:con|acompanad[oa] de|mas)\s/);
  const cabeza0 = i >= 0 ? t.slice(0, i) : t;
  const resto = i >= 0 ? t.slice(i).replace(/^\s(?:con|acompanad[oa] de|mas)\s/, "") : "";
  const cab = cabeza0.split(/\s*(?:,|\by\b|\+)\s*/).map(limpiar).filter(Boolean);
  const agregados = [...cab.slice(1), ...resto.split(/\s*(?:,|\by\b|\be\b|\bcon\b|\+|\bmas\b)\s*/).map(limpiar).filter(Boolean)];
  return { cabeza: cab[0] ?? "", agregados, dentro, completo };
}

/** ¿El plato base ya trae eso? (la carne en «Tallarines con salsa bolognesa», que tiene el alias «fideos con carne») */
function yaTrae(base: HitPlato, agregado: string): boolean {
  const w = new Set([base.name, ...(base.aliases ?? [])].flatMap(palabras));
  const a = palabras(agregado);
  // la primera palabra basta («carne molida» ↔ «fideos con carne»), salvo si es de las que no dicen qué es («salsa bolognesa»
  // no la trae un plato «con salsa de tomate»)
  return a.length > 0 && (a.every((x) => w.has(x)) || (w.has(a[0]) && !/^(salsa|crema|pure|jugo|ensalada|sopa)$/.test(a[0])));
}

/** Lo que se dice suelto se entiende por el plato: con una pasta, «salsa» es la de tomates y «carne», molida */
function enContexto(agregado: string, cabeza: string): string {
  const pasta = ES_PASTA.test(cabeza);
  if (pasta && /^salsa( de tomates?| roja)?$/.test(agregado)) return "salsa para pasta";
  // la bolognesa es salsa con carne: sobre una pasta que ya trae salsa, lo que falta es la carne
  if (pasta && /^(salsa )?(bolognesa|bolonesa|boloñesa|de carne)$/.test(agregado)) return "carne molida";
  if (pasta && /^(carne|carne de vacuno|vacuno)$/.test(agregado)) return "carne molida";
  if (pasta && /^queso( rallado)?$/.test(agregado)) return "queso parmesano rallado";
  if (/^ensalada$/.test(agregado)) return "ensalada surtida";
  if (/^arroz$/.test(agregado)) return "arroz blanco cocido";
  if (/^(papas|papa)$/.test(agregado)) return "papa cocida";
  // «un pan» en Chile es una marraqueta (o una hallulla), no pan de molde
  if (/^(pan|pancito|un pan)$/.test(agregado)) return "marraqueta";
  if (/^pure$/.test(agregado)) return "pure de papas";
  return agregado;
}

/**
 * Arma el plato. `gramos`: el total que dijo («300 g de…»); `porciones`: «2 platos de…». null = no se pudo ni siquiera con lo
 * principal (que decida el modelo o se pregunte).
 */
export async function armarPlato(frase: string, resolver: ResolverPlato, opts: { gramos?: number; porciones?: number; perfil?: PerfilPlato | null } = {}): Promise<PlatoArmado | null> {
  const { cabeza, agregados, dentro, completo } = partirPlato(frase);
  if (!cabeza) return null;
  const notas: string[] = [];
  const faltan: string[] = [];
  const usados = new Set<number>();

  // 1-2. El plato entero o el pedazo más largo que sea un plato de la base
  let base: HitPlato | null = await resolver(completo, "base");
  if (base) agregados.forEach((_, i) => usados.add(i));
  if (!base && agregados.length) {
    // de más largo a más corto: cabeza + los primeros k agregados, y cabeza + cada uno solo
    const pruebas: Array<{ q: string; usa: number[] }> = [];
    for (let k = agregados.length - 1; k >= 1; k--) pruebas.push({ q: `${cabeza} con ${agregados.slice(0, k).join(" y ")}`, usa: [...Array(k).keys()] });
    agregados.forEach((a, i) => { if (agregados.length > 1) pruebas.push({ q: `${cabeza} con ${a}`, usa: [i] }); });
    for (const p of pruebas) {
      const h = await resolver(p.q, "base");
      if (h && rolDe(h.name) === "plato") { base = h; p.usa.forEach((i) => usados.add(i)); break; }
    }
  }
  if (!base) base = await resolver(cabeza, "base");
  // Un plato que la base no tiene: lo principal sin la preparación, y se dice («pollo al curry» → pollo + la salsa si está;
  // «guiso de porotos verdes» → porotos verdes). Mejor eso, avisado, que no anotar nada.
  let sinPrep: string | null = null;
  if (!base) {
    const al = cabeza.match(/^(.+?)\s+(?:al|a la|a lo|en salsa de|en)\s+(.+)$/);
    const de = cabeza.match(/^(?:guiso|guisado|estofado|budin|pastel|sopa|crema|pure|salteado|revuelto|tortilla)\s+de\s+(.+)$/);
    const rell = cabeza.match(/^(.+?)\s+rellen[oa]s?$/);
    const q = al?.[1] ?? de?.[1] ?? rell?.[1];
    if (q) {
      base = await resolver(q, "base");
      if (base?.fuzzy) base = null;
      if (base) {
        sinPrep = cabeza;
        if (al?.[2] && !/^(jugo|horno|vapor|plancha|parrilla|olla|sarten|disco|pobre)$/.test(al[2])) agregados.unshift(`salsa ${al[2]}`);
      }
    }
  }
  // «quesadillas de pollo»: el plato (quesadilla) con lo de después como agregado
  if (!base) {
    const xy = cabeza.match(/^(.+?)\s+(?:de|con)\s+(.+)$/);
    const h = xy ? await resolver(xy[1], "base") : null;
    if (h && !h.fuzzy && ["plato", "pan"].includes(rolDe(h.name))) { base = h; agregados.unshift(xy![2]); }
  }
  if (!base) return null;
  const rolBase = rolDe(base.name);
  // Lo principal en su porción de plato: un almidón solo («arroz con huevo») como plato de fondo es ~200 g, no la taza de
  // acompañamiento (150 g). El usuario, 2026-11-15: «un plato rara vez son 100 gramos, normalmente son 300 g más o menos».
  const g0 = base.servingGrams > 0 ? base.servingGrams : 100;
  const items: Array<{ name: string; grams: number; dicho: boolean }> = [{ name: base.name, grams: rolBase === "almidon" ? Math.max(g0, 200) : g0, dicho: true }];

  // 3. Los agregados que el plato no trae, cada uno en su porción de acompañamiento
  const yaVenia: string[] = [];
  for (const [i, a0] of agregados.entries()) {
    if (usados.has(i)) continue;
    const { s: a, k } = MULT(a0);
    if (yaTrae(base, a)) { yaVenia.push(a); continue; }
    const q = enContexto(a, cabeza);
    let h = (await resolver(q, "agregado")) ?? (q !== a ? await resolver(a, "agregado") : null);
    // «ensalada de tomate» que no está como tal: el tomate, en porción de ensalada
    const ens = !h ? a.match(/^ensalada\s+de\s+(.+)$/) : null;
    if (ens) h = await resolver(ens[1], "agregado");
    // «salsa curry» / «salsa pesto» (de «pollo al curry»): sin esa salsa en la base, no se suma ni se reclama
    if (!h && /^salsa\s/.test(a) && sinPrep) { h = await resolver(a.replace(/^salsa\s+/, ""), "agregado"); if (!h || h.fuzzy) continue; }
    if (!h) { faltan.push(a); continue; }
    if (items.some((x) => x.name === h!.name)) continue;
    const g0 = ens ? Math.min(h.servingGrams > 0 ? h.servingGrams : 120, 120) : gramosAgregado(rolDe(h.name), h, rolBase, false);
    items.push({ name: h.name, grams: Math.round(g0 * k), dicho: true });
  }
  // Lo que «tenía», en porción chica (si el plato no lo trae ya)
  const chicos: string[] = [];
  for (const a0 of dentro) {
    const { s: a } = MULT(a0);
    if (yaTrae(base, a)) continue;
    const h = await resolver(enContexto(a, cabeza), "agregado");
    if (!h) { faltan.push(a); continue; }
    if (items.some((x) => x.name === h.name)) continue;
    const g = gramosAgregado(rolDe(h.name), h, rolBase, true);
    items.push({ name: h.name, grams: g, dicho: false });
    chicos.push(`${h.name.split(/\s*[/(]/)[0].toLowerCase()} (~${g} g)`);
  }

  // 3b. Cómo es SU plato («más arroz que carne» o al revés): el reparto cambia, la cantidad total la decide lo de abajo
  let ajusteBase: AjustePlato | undefined;
  const perfil = opts.perfil;
  if (perfil === "carbo" || perfil === "proteina") {
    const k = REPARTO[perfil];
    items.forEach((x, i) => {
      const rol = rolDe(x.name);
      if (i === 0 && rol === "plato") { ajusteBase = AJUSTE_PLATO[perfil]; return; }
      x.grams = Math.max(1, Math.round(x.grams * (k[rol] ?? 1)));
    });
    if (items.length > 1 || ajusteBase) notas.push(`Lo armé como tu plato de siempre (${TEXTO_PERFIL[perfil]}).`);
  }

  // 4. La cantidad: lo que dijo (en proporción) o un plato normal
  const total = items.reduce((s, x) => s + x.grams, 0);
  let porcionNormal = false;
  if (opts.gramos && opts.gramos > 0 && total > 0) {
    const f = opts.gramos / total;
    for (const x of items) x.grams = Math.max(1, Math.round(x.grams * f));
  } else if (opts.porciones && opts.porciones > 0 && opts.porciones !== 1) {
    for (const x of items) x.grams = Math.round(x.grams * opts.porciones);
  } else if (!opts.porciones) porcionNormal = true;

  const enTotal = items.reduce((s, x) => s + x.grams, 0);
  const corto = (n: string) => n.split(/\s*[/(]/)[0].trim();
  if (sinPrep) notas.push(`No tengo «${sinPrep}» en mi base: lo anoté como ${corto(base.name).toLowerCase()}${items.length > 1 ? " con lo demás" : ""}, lo más parecido.`);
  if (porcionNormal) {
    // 1 unidad (empanada, completo) o un plato; en plural sin número («empanadas»), se anota una y se pregunta
    const unidad = /^1\s+(unidad|trozo|presa|pieza|rebanada|lamina|pote|vaso|taza|bolsa|lata|choclo|mediana|pechuga|filete)/.test(fold(base.servingDescription));
    const plural = unidad && /s$/.test(cabeza.split(" ")[0]) && !/^(porotos|garbanzos|tallarines|fideos|ñoquis|noquis|ravioles|canelones|papas|lentejas|espaguetis)$/.test(cabeza.split(" ")[0]);
    notas.push(plural
      ? `No dijiste cuántas: anoté 1 (${corto(base.name)}, ${items[0].grams} g). Si fueron más, dime cuántas y lo corrijo.`
      : `No dijiste cuánto: anoté ${unidad ? "una porción" : "un plato normal"} (~${enTotal} g en total). Si fue más o menos, dímelo y lo corrijo.`);
  }
  if (yaVenia.length) notas.push(`${yaVenia.join(" y ")} ya ${yaVenia.length > 1 ? "van" : "va"} en ${base.name.split(/\s*\(/)[0].toLowerCase()}: no lo sumé dos veces.`);
  if (chicos.length) notas.push(`Sumé lo que dijiste que llevaba: ${chicos.join(" y ")}, estimado.`);
  if (faltan.length) notas.push(`No encontré ${faltan.map((x) => `«${x}»`).join(" ni ")}: no ${faltan.length > 1 ? "los" : "lo"} sumé; dime qué era y lo agrego.`);
  return { items: items.map(({ name, grams }, i) => ({ name, grams, ...(i === 0 && ajusteBase ? { ajuste: ajusteBase } : {}) })), notas, faltan, porcionNormal };
}

// ─── Tu plato (2026-11-15) ─────────────────────────────────────────────────────────────────────────────────────
// El usuario: «las divisiones suelen ser porciones que varían bastante: en las casas de bajos recursos la cantidad de
// carbohidratos suele ser mucho mayor… y la prote muy acotada, y viceversa». Una receta promedio no lo sabe: se le pregunta
// una vez a la persona cómo es su plato, se corrige con un toque y se aprende. Sin suponer nada de nadie por su plata.

export type PerfilPlato = "carbo" | "mitad" | "proteina";
export const TEXTO_PERFIL: Record<PerfilPlato, string> = { carbo: "más arroz, fideos o papas que carne", mitad: "mitad y mitad", proteina: "más carne o proteína que arroz" };
/** Cuánto cambia cada parte según su papel (en un plato armado por partes) */
const REPARTO: Record<"carbo" | "proteina", Partial<Record<Rol, number>>> = {
  // (la verdura no cambia: lo que el plato «tenía» se dijo y se estima igual)
  carbo: { almidon: 1.4, pan: 1.2, proteina: 0.6 },
  proteina: { almidon: 0.7, pan: 0.8, proteina: 1.5 },
};
/** Un plato que viene armado de la base (cazuela, pollo con arroz): más carbohidratos y menos proteína, o al revés */
export const AJUSTE_PLATO: Record<"carbo" | "proteina", AjustePlato> = {
  carbo: { carbs: 1.3, protein: 0.65, fat: 0.9 },
  proteina: { carbs: 0.7, protein: 1.4, fat: 1.1 },
};

/**
 * La respuesta a «¿cómo suele ser tu plato?» o una corrección («fue más fideos», «fue más carne»). `correccion`: habla de la
 * comida recién anotada («fue…»); si no, dice cómo es su plato en general. null = no es eso.
 */
export function leerRespuestaPlato(message: unknown): { tipo: PerfilPlato; correccion: boolean } | null {
  if (typeof message !== "string" || message.length > 120) return null;
  const t = fold(message).replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t || /\?/.test(message) && !/^(fue|era|es)\b/.test(t)) return null;
  const correccion = /^(fue|era|estuvo|tenia|habia|le eche|le pusimos|hoy fue|ese fue|ese plato fue)\b/.test(t) || /\b(ese|este) plato\b/.test(t);
  const carbo = /\b(mas|harto|hartos|harta|mucho|mucha|muchos|puro|pura|casi todo)\s+(de\s+)?(arroz|fideos?|tallarines|papas?|pure|pan|carbohidratos?|carbos?|acompanamiento)\b|\b(poca|poco|nada de|casi nada de|un poquito de)\s+(carne|proteina|pollo|pescado)\b|\bmas arroz\b/.test(t);
  const prote = /\b(mas|harta|harto|mucha|mucho|pura|puro|casi todo)\s+(de\s+)?(carne|proteina|pollo|pescado|huevo)\b|\b(poco|poca|poquito de|nada de|casi nada de)\s+(arroz|fideos?|tallarines|papas?|pure|carbohidratos?|carbos?)\b/.test(t);
  const mitad = /\b(mitad y mitad|mitad mitad|parejo|equilibrado|igual de los dos|lo mismo de cada uno|normal)\b/.test(t);
  // «más arroz que carne» y «más carne que arroz»: manda lo que va primero
  const pa = t.search(/\bmas\s+(arroz|fideos?|tallarines|papas?|pure|pan|carbohidratos?)\b/), pc = t.search(/\bmas\s+(carne|proteina|pollo|pescado)\b/);
  let tipo: PerfilPlato | null = null;
  if (pa >= 0 && pc >= 0) tipo = pa < pc ? "carbo" : "proteina";
  else if (carbo && !prote) tipo = "carbo";
  else if (prote && !carbo) tipo = "proteina";
  else if (mitad && !carbo && !prote) tipo = "mitad";
  if (!tipo) return null;
  // Tiene que hablar del plato (no «quiero más carne» ni «compré harto arroz»)
  if (/\b(quiero|quisiera|compre|comprar|deberia|debo|puedo|receta)\b/.test(t)) return null;
  return { tipo, correccion };
}

/** Los botones para la pregunta (una sola vez) y para corregir el plato recién anotado */
export function botonesPerfil(): string {
  return "[Opción: 🍚🍚🍗 Más arroz, fideos o papas que carne] [Opción: 🍚🍗 Mitad y mitad] [Opción: 🍚🍗🍗 Más carne que arroz]";
}
export function botonesCorreccion(perfil: PerfilPlato | null | undefined): string {
  const b: string[] = [];
  if (perfil !== "carbo") b.push("[Opción: Fue más arroz o fideos que carne]");
  if (perfil && perfil !== "mitad") b.push("[Opción: Fue mitad y mitad]");
  if (perfil !== "proteina") b.push("[Opción: Fue más carne]");
  return b.join(" ");
}

/** ¿Parece un plato con varias cosas? («X con Y», «X y Y», «X, Y», «X, tenía Y») */
export const esCompuesto = (s: string) => /\s(con|y|e|mas|acompanad[oa] de)\s|,|\+|\b(tenia|llevaba|traia)\b/.test(fold(s));
