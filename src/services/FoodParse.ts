// ============================================================
// Eris — FoodParse
//
// "Registra 1 ½ hallulla con 4 huevos revueltos para el desayuno" dependía de que el modelo de 4B llamara a la
// herramienta y calculara los gramos. A veces contestaba "Registraré tu desayuno…" y no guardaba nada. Igual que con
// el agua (WaterParse), acá se reconoce por código, pero SOLO cuando no hay ambigüedad:
//   - un verbo explícito de registro (registra, anota, agrega, guarda, apunta, suma),
//   - cada alimento con su cantidad ("4 huevos", "200 g de arroz", "una taza de arroz"),
//   - cada alimento encontrado en la base LOCAL (chilena o catálogo), con un peso por unidad conocido.
// Ante cualquier duda devuelve null y el mensaje sigue el camino de siempre (el modelo), así no se pierde ningún
// caso que antes se resolvía bien.
// ============================================================

import { normText, stemWord, phonWord, editDistance } from "./FoodText.js";
import { slotAt, fitsSlot, slotIsPast, typicalTimeOf, hhmm, hourOf, dayStartHour, MEAL_NAME, MEAL_ORDER, wakeHourFor, nutritionDayOf, type DayCtx } from "./MealSchedule.js";

export type MealType = "desayuno" | "colacion_am" | "almuerzo" | "once" | "cena" | "colacion_pm";
export interface FoodParse {
  action: "log_meal"; mealType: MealType; items: Array<{ name: string; grams: number }>;
  /** aviso si se asumió una porción ("una hallulla con palta": la palta sin cantidad) */
  assumed?: string;
  /** "ayer", "anoche"…: la comida NO es de hoy (la herramienta no la registra y explica dónde hacerlo) */
  otherDay?: string;
  /** nombres tomados con un error de tipeo: «chocapig» como Cereal azucarado (tipo Zucaritas / Chocapic) */
  corrected?: string[];
}

/** Lo que el reconocedor necesita de la base: el alimento local que corresponde a un nombre, con su porción. */
export interface LocalFoodHit {
  name: string;
  aliases?: string[];
  /** Descripción de la porción por defecto, p. ej. "1 unidad (70g)", "½ taza (50g)", "1 plato (180g)". */
  servingDescription: string;
  servingGrams: number;
}
export type LocalFoodLookup = (name: string) => Promise<LocalFoodHit[]>;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ─── Verbo y descartes ────────────────────────────────────────────
// "ingresa", "carga", "pon", "añade" también son pedidos de registro: sin ellos "ingresa 1 empanada como once" iba al modelo,
// que contestaba "✅ registrada" sin llamar a la herramienta y la guardia contra eso tampoco se activaba (2026-10-03)
const VERB = /\b(registra|registrame|registralo|registrala|anota|anotame|anotalo|agrega|agregame|agregale|guarda|guardame|apunta|apuntame|suma|sumame|ingresa|ingresame|ingresalo|ingresala|carga|cargame|cargalo|pon|ponme|ponle|anade|anademe|anadele)\b/;
// Contar lo que ya se comió TAMBIÉN es pedir que se anote: "oye, comí una empanada", "almorcé cazuela", "tomé once con…".
// Antes solo contaban los verbos de orden y todo lo demás iba al modelo, que a veces inventaba el "✅ registrado".
// El dictado a veces parte o cambia la palabra: "Al morse un plato de porotos…" era "almorcé" y no se reconocía (2026-10)
const EAT = /\b(comi|comimos|me comi|nos comimos|desayune|desayunamos|almorce|almorzamos|al ?mor[csz]e|cene|cenamos|merende|tome once|tomamos once|acabo de comer|acabamos de comer|me servi|estoy comiendo)\b/;
// Pedidos educados ("¿puedes ingresar…?", "quiero registrar…", "me anotas…"): son un "registra", aunque lleven signo de pregunta
const POLITE = /^(?:(?:oye|hola|eris|ya|bueno)[\s,]+)*(?:me\s+)?(?:puedes|podrias|podis|puedis|quiero|quisiera|necesito|me ayudas a|ayudame a)\s+(?:ingresar|registrar|anotar|agregar|apuntar|sumar|cargar|poner|anadir)(?:me|lo|la|le|las|los)?\b/;
const POLITE2 = /^(?:(?:oye|hola|eris|ya|bueno)[\s,]+)*me\s+(?:anotas|registras|ingresas|agregas|sumas|cargas|pones|apuntas)\b/;
/** "¿me puedes anotar 2 huevos?" → "registra 2 huevos?" (texto ya sin acentos y en minúsculas) */
const asRequest = (t: string) => t.replace(/^[¿¡\s]+/, "").replace(POLITE, "registra").replace(POLITE2, "registra");
// "no comí nada", "no he almorzado": no hay nada que anotar
const NEG_EAT = /\bno\s+(he\s+)?(comi|comido|desayune|desayunado|almorce|almorzado|cene|cenado|tome once)\b/;
// "ayer comí 2 empanadas", "anoche cené…": por chat solo se registra lo de HOY (el teléfono sincroniza solo el día actual).
// Antes se guardaba igual, con fecha de hoy, e inflaba el día.
const OTHER_DAY = /\b(ayer|anoche|antier|anteayer|antes de ayer|el otro dia|la semana pasada|el (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?: pasado)?)\b/;
/** Si el mensaje habla de una comida de otro día, cuál ("ayer", "anoche"…); si no, null. */
export function otherDayOf(message: unknown): string | null {
  if (typeof message !== "string") return null;
  // "lo mismo que ayer", "igual que anoche": habla de HOY, comparando
  const t = fold(message).replace(/\b(?:como|igual que|lo mismo que|lo mismo de|mismo que|lo de)\s+(?:ayer|anoche)\b/g, " ");
  const m = t.match(OTHER_DAY);
  return m ? m[1] : null;
}

/**
 * Alimentos que el modelo quiere registrar pero que el usuario NO nombró en su mensaje. Pasaba: "registra una hallulla
 * con palta" terminaba guardando hallulla + 4 huevos, copiados de un registro anterior de la conversación. Se compara por
 * sonido y raíz (plurales, "pan" ↔ "Pan de molde"); también cuentan los alias de la base ("pan francés" ↔ Marraqueta).
 * Si el mensaje no nombra alimentos ("registra mi almuerzo", lo describió antes) no se exige nada: devuelve [].
 */
export async function unmentionedItems(message: unknown, names: string[], lookup: LocalFoodLookup): Promise<string[]> {
  if (typeof message !== "string") return [];
  const FILLER = new Set(["registra", "registrame", "registralo", "registrala", "anota", "anotame", "anotalo", "agrega", "agregame",
    "agregale", "guarda", "guardame", "apunta", "apuntame", "suma", "sumame", "ingresa", "ingresame", "ingresalo", "ingresala",
    "carga", "cargame", "cargalo", "pon", "ponme", "ponle", "anade", "anademe", "anadele", "porfis", "como", "oye", "hola", "bueno",
    "acabo", "comer", "desayune", "almorce", "cene", "merende", "servi", "comiendo", "estoy", "nos", "ya", "desayuno", "almuerzo", "once", "onces", "cena", "colacion", "comida",
    "merienda", "snack", "porfa", "favor", "eris", "que", "comi", "comimos", "hoy", "ahora", "para", "por", "tambien", "unos", "unas",
    "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "medio", "media", "gramos", "taza", "tazas", "plato",
    "platos", "porcion", "unidad", "unidades", "cucharada", "cucharadas", "vaso", "vasos"].map(P));
  const said = new Set(wordsP(message).filter((w) => !FILLER.has(w) && !/^\d/.test(w)));
  if (!said.size) return [];
  const out: string[] = [];
  for (const n of names) {
    const own = wordsP(n).filter((w) => !PREP_P.has(w));
    if (own.some((w) => inSet(said, w))) continue;
    const hit = (await lookup(fold(n)))[0];
    const viaAlias = hit ? [hit.name, ...(hit.aliases ?? [])].some((a) => wordsP(a).some((w) => inSet(said, w) && !PREP_P.has(w))) : false;
    if (!viaAlias) out.push(n);
  }
  return out;
}

// ─── Preguntas por el día ─────────────────────────────────────────
// "¿qué he comido hoy?", "¿cuántas calorías llevo?", "¿cuánta agua llevo?": antes pasaban por el modelo (~7-10 s) solo para
// que llamara a get_daily_log. Se reconocen por código y responden al instante. "cuánto llevo" a secas NO (puede ser plata).
const DAY_FOOD_Q = /\b(?:que (?:he comido|comi|llevo comido|he desayunado|he almorzado|cene|almorce|desayune)(?: hoy)?|cuant[oa]s? (?:calorias|kcal|proteinas?|carbos?|carbohidratos|grasas?) (?:llevo|he comido|he consumido|comi|voy|me (?:quedan|queda|faltan|falta))|(?:cuanto|como) (?:llevo|voy)(?: hoy)? (?:de|con) (?:las |la |los |el )?(?:calorias|kcal|comida|proteinas?|carbohidratos|dieta)|(?:muestrame |ver |dame )?(?:mi|el) (?:registro|log|resumen) (?:de (?:hoy|comida|comidas|nutricion|lo que comi)))\b/;
const DAY_WATER_Q = /\b(?:cuant[ao]s? (?:agua|litros|vasos)(?: de agua)? (?:llevo|he tomado|tome|voy|me (?:quedan?|faltan?))|(?:cuanto|como) (?:llevo|voy)(?: hoy)? (?:de|con) (?:el )?agua)\b/;
/** ¿Pregunta por lo comido o tomado hoy? "food" = el día completo, "water" = solo el agua. */
export function dayQueryOf(message: unknown): "food" | "water" | null {
  if (typeof message !== "string" || message.length > 120) return null;
  const t = fold(message).replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  if (OTHER_DAY.test(t) || /\b(gast\w*|plata|pesos|lucas?|finanzas)\b/.test(t)) return null;
  // «¿cuánta proteína me falta y qué tengo en la casa para completarla?» pide ideas: va al asesor, no solo al registro del día
  if (/\b(que tengo|que hay|en (la |mi )?casa|para (completar|llegar)|que (puedo |me )?com\w*|con que)\b/.test(t) && !/\bque (he comido|comi|llevo comido)\b/.test(t)) return null;
  if (DAY_WATER_Q.test(t)) return "water";
  if (DAY_FOOD_Q.test(t)) return "food";
  return null;
}

/** ¿El usuario PIDE registrar algo, o cuenta lo que comió? (no pregunta si se registró ni cuántas calorías tiene algo) */
export function asksToLog(message: unknown): boolean {
  if (typeof message !== "string") return false;
  if (dayQueryOf(message)) return false; // "qué comí hoy" pregunta, no cuenta
  const t = fold(message).trim().replace(/^[¿¡\s]+/, "");
  if (asRequest(t) !== t) return true; // "¿me puedes anotar…?" sí es un pedido
  if (/[?¿]/.test(message)) return false;
  return VERB.test(t) || (EAT.test(t) && !NOT_LOG.test(t) && !NEG_EAT.test(t));
}

/**
 * ¿La respuesta afirma que algo quedó registrado? ("✅ Cena registrada", "listo, lo anoté", "quedó guardado").
 * Solo cuentan oraciones afirmativas: "¿quieres que lo registre?" no es afirmar.
 */
export function claimsLogged(reply: unknown): boolean {
  if (typeof reply !== "string") return false;
  return reply.split(/(?<=[.!?\n])/).some((s) => !/\?\s*$/.test(s.trim()) &&
    /(✅.*\b(registrad|anotad|guardad)|\b(registrad[oa]s?|anotad[oa]s?|guardad[oa]s?)\b|\b(lo|la|los|las|te|ya) (registre|anote|guarde)\b)/.test(fold(s)));
}
// No es un registro: pregunta, deseo, intención futura, consejo
const NOT_LOG = /\b(cuant\w+|debo|deberia|puedo|conviene|recomiend\w+|necesito|tengo que|hay que|quiero|quisiera|voy a|vas a|me falta|si como|que tal si|mañana|manana)\b/;
// Otra cosa: borrar/corregir, u otra herramienta (diario, notas, entrenamiento, finanzas…)
const OTHER = /\b(borra\w*|elimina\w*|quita\w*|saca\w*|cambia\w*|corrige\w*|edita\w*|diario|nota|notas|recordatorio\w*|tarea\w*|rutina\w*|entren\w*|series?|repeticiones|gasto\w*|pago\w*|pague|compre|finanzas|presupuesto|glucos\w*|insulina|peso|pese|medicament\w*|pastilla\w*)\b/;
// Bebidas: el agua va por WaterParse; el alcohol, los ml y los batidos los ve el modelo. Café, té, jugo, gaseosa sí se anotan
// por código cuando la base los resuelve sin duda («un café» = café negro; «jugo» a secas empata y va al modelo): antes
// «un pan con palta y un café con leche» iba al modelo, que anotaba el pan y olvidaba el café (banco de pruebas 2026-10-16).
// La herramienta suma su volumen al agua del día (NutritionTool, drinkNotes).
const DRINK = /\b(agua|cerveza|vino|pisco|ron|whisky|batido|smoothie|ml|cc|litros?)\b/;
// Palabras que cambian el sentido de un alimento o una cantidad: mejor que lo vea el modelo
const DOUBT = /\b(sin|pero|no|casi|mitad de|algo de|un poco|poquito|harto|mucho|mucha|varios|varias|algunos|algunas|como|aprox\w*|masomenos|mas o menos)\b/;

// ─── Tipo de comida ───────────────────────────────────────────────
/** «colación de la mañana», «de media mañana», «colación AM», «colación mañanera», «a media mañana» */
const COLACION_AM = /\b(colacion (de )?(la )?(media )?manana|colacion am|colacion mananera|(de|a) media manana)\b/;
/** «colación de la tarde», «colación PM» */
const COLACION_PM = /\b(colacion (de )?(la )?tarde|colacion pm)\b/;
const MEAL_RX: Array<[RegExp, MealType | "colacion"]> = [
  [/\b(desayuno|desayune|desayunamos|desayunara)\b/, "desayuno"],
  [/\b(almuerzo|almorce|almorzamos|almorzara|al ?mor[csz]e)\b/, "almuerzo"],
  [/\b(onces?|tomamos once|tome once)\b/, "once"],
  [/\b(cena|cene|cenamos|ceno|cenara)\b/, "cena"],
  // «colación de la mañana» a las 17:00 es la de la mañana (antes la hora mandaba y quedaba como de la tarde; banco de chat
  // 2026-11-04). Van antes de la colación genérica.
  [COLACION_AM, "colacion_am"],
  [COLACION_PM, "colacion_pm"],
  [/\b(colacion|merienda|merende|snack|picoteo)\b/, "colacion"],
];

/** Tipo de comida por la hora (Chile; la tabla única de services/MealSchedule.ts). Solo cuando el mensaje no lo dice. */
export function mealByHour(d: Date = new Date(), wakeHour?: number): MealType {
  return slotAt(d, { wakeHour }) as MealType;
}

// ─── A qué hora se comió ──────────────────────────────────────────
// "a las 8", "a las 13:30", "a las ocho y media de la mañana", "8 pm", "hace una hora", "hace 20 minutos"
const HOUR_WORDS: Record<string, number> = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
const HOUR_TOKEN = "(\\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)";
const CLOCK_RX = new RegExp(`\\b(?:a las|a la(?!\\s+onces?\\b)|como a las|cerca de las|tipo las)\\s+${HOUR_TOKEN}(?:[:.](\\d{2})|\\s+y\\s+(media|cuarto))?(?:\\s*(am|pm|a\\.m\\.|p\\.m\\.|hrs?|horas)(?![a-z]))?(?:\\s+de la (manana|tarde|noche))?`);
const CLOCK_RX2 = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/;
const AGO_RX = /\bhace\s+(un|una|media|dos|tres|\d+(?:[.,]\d+)?)\s*(horas?|hrs?|minutos?|mins?|rato)\b/;
const CLOCK_STRIP = new RegExp(`${CLOCK_RX.source}|${CLOCK_RX2.source}|${AGO_RX.source}`, "g");

/** La hora que dice el mensaje ("a las 8", "hace una hora"), la última que ya pasó; null si no dice ninguna. */
export function clockTimeOf(message: string, now: Date = new Date()): Date | null {
  return clockParse(message, now, {}) as Date | null;
}

function clockParse(message: string, now: Date, opts: { anyTime?: boolean }): Date | Date[] | null {
  const t = fold(message);
  const ago = t.match(AGO_RX);
  if (ago && !/^rato/.test(ago[2])) {
    const n = ago[1] === "media" ? 0.5 : ago[1] === "un" || ago[1] === "una" ? 1 : ago[1] === "dos" ? 2 : ago[1] === "tres" ? 3 : parseFloat(ago[1].replace(",", "."));
    const mins = /^min/.test(ago[2]) ? n : n * 60;
    if (mins > 0 && mins <= 18 * 60) return new Date(now.getTime() - mins * 60000);
  }
  const m1 = t.match(CLOCK_RX);
  const m2 = m1 ? null : t.match(CLOCK_RX2);
  if (!m1 && !m2) return null;
  const hRaw = (m1 ?? m2)![1];
  let h = HOUR_WORDS[hRaw] ?? Number(hRaw);
  const min = m1 ? (m1[2] ? Number(m1[2]) : m1[3] === "media" ? 30 : m1[3] === "cuarto" ? 15 : 0) : m2![2] ? Number(m2![2]) : 0;
  if (!(h >= 0 && h <= 23) || min > 59) return null;
  const suf = m1 ? `${m1[4] ?? ""} ${m1[5] ?? ""}` : m2![3];
  const pm = /p\.?m|tarde|noche/.test(suf), am = /a\.?m|manana/.test(suf);
  const at = (hh: number) => { const d = new Date(now); d.setHours(hh, min, 0, 0); return d; };
  let cands: Date[];
  if (pm && h < 12) cands = [at(h + 12)];
  else if (am && h === 12) cands = [at(0)];
  else if (am || h >= 12) cands = [at(h)];
  else cands = [at(h), at(h + 12)]; // "a las 8": las 8:00 o las 20:00, la última que ya pasó
  if (opts.anyTime) return cands;
  const past = cands.filter((d) => d.getTime() <= now.getTime() + 5 * 60000);
  return past.length ? past[past.length - 1] : null;
}

/** Las horas posibles que dice el mensaje, sin exigir que ya hayan pasado hoy («ayer a las 8»: las 8:00 o las 20:00). */
export function clockCandidatesOf(message: string, now: Date = new Date()): Date[] | null {
  const r = clockParse(message, now, { anyTime: true });
  return Array.isArray(r) ? r : r ? [r] : null;
}

/** El tipo de comida que NOMBRA el mensaje ("desayuné", "para el almuerzo"), sin contar horas ("a las once"). */
export function mentionedMeal(message: string, now: Date = new Date()): MealType | null {
  const t = fold(message).replace(CLOCK_STRIP, " ");
  for (const [re, meal] of MEAL_RX) {
    if (re.test(t)) return meal === "colacion" ? (now.getHours() < 15 ? "colacion_am" : "colacion_pm") : meal;
  }
  return null;
}

/** Todas las comidas que nombra el mensaje, en el orden en que aparecen ("3 empanadas para la cena y una para la once"). */
export function mentionedMeals(message: string, now: Date = new Date()): MealType[] {
  const t = fold(message).replace(CLOCK_STRIP, " ");
  const found: Array<[number, MealType]> = [];
  // «colación de la mañana» ya la nombró la regla específica: la genérica no la cuenta otra vez por la hora
  const nombradas = new Set<number>();
  for (const [re, meal] of MEAL_RX) {
    const g = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(t))) {
      if (meal === "colacion" && nombradas.has(m.index)) continue;
      if (re === COLACION_AM || re === COLACION_PM) nombradas.add(m.index);
      found.push([m.index, meal === "colacion" ? (now.getHours() < 15 ? "colacion_am" : "colacion_pm") : meal]);
    }
  }
  return [...new Set(found.sort((a, b) => a[0] - b[0]).map((f) => f[1]))];
}

/** Tipo de comida mencionado en el mensaje, o por la hora. */
export function mealTypeOf(message: string, now: Date = new Date()): MealType {
  return mentionedMeal(message, now) ?? mealByHour(now);
}

const delName = (s: string) => (s === "desayuno" || s === "almuerzo" ? `del ${MEAL_NAME[s]}` : `de la ${MEAL_NAME[s] ?? s}`);

/**
 * Cuándo se comió y qué comida fue. La hora de la COMIDA manda, no la hora en que se anota (pedido del usuario, 2026-10-10:
 * "el desayuno no es desayuno a las 12 pm, sería una colación mañanera"):
 * - "a las 8…" / "hace una hora…": esa hora, y la comida que corresponde a esa hora.
 * - Nombra una comida que calza con la hora: esa, ahora.
 * - Nombra una comida que ya pasó ("desayuné…" a las 12): se anotó después → esa comida, a su hora (aproximada).
 *   Con "recién / acabo de / estoy…" es ahora → cuenta la comida de esta hora (y se dice).
 * - No nombra ninguna: la de esta hora (lo que propuso el modelo, solo si calza).
 */
export function mealTimingOf(message: string, opts: { now?: Date; wakeHour?: number; dayCtx?: DayCtx; modelMeal?: string } = {}): { mealType: MealType; at: Date; approx: boolean; note?: string } {
  const now = opts.now ?? new Date();
  // El horario de esta persona: su despertar de hoy o el habitual (quien trasnocha tiene el día corrido)
  const wake = opts.wakeHour ?? (opts.dayCtx ? wakeHourFor(opts.dayCtx, now) : undefined);
  // Si nombra varias ("3 empanadas para la cena y una para la once"), el modelo anota cada una por separado: vale la que él
  // eligió si está entre las nombradas. Antes ganaba siempre la primera de la lista y las dos quedaron en la once (2026-10-11).
  const all = mentionedMeals(message, now);
  const said = all.length > 1 && opts.modelMeal && (all as string[]).includes(opts.modelMeal) ? (opts.modelMeal as MealType) : all[0] ?? null;
  const clock = clockTimeOf(message, now);
  if (clock) {
    const meal = (said && fitsSlot(said, clock, wake) ? said : slotAt(clock, { wakeHour: wake })) as MealType;
    return { mealType: meal, at: clock, approx: false, ...(said && meal !== said ? { note: `A las ${hhmm(clock)} lo cuento como ${MEAL_NAME[meal]}.` } : {}) };
  }
  if (!said) {
    const m = opts.modelMeal;
    const ok = !!m && (MEAL_ORDER as readonly string[]).includes(m) && fitsSlot(m, now, wake);
    return { mealType: (ok ? m : slotAt(now, { wakeHour: wake })) as MealType, at: now, approx: false };
  }
  if (fitsSlot(said, now, wake)) return { mealType: said, at: now, approx: false };
  const justNow = /\b(recien|acabo de|acabamos de|estoy|estamos|ahora|ahorita|en este momento)\b/.test(fold(message));
  if (!justNow && slotIsPast(said, now, wake)) {
    const at = typicalTimeOf(said, nutritionDayOf(now, opts.dayCtx ?? {}), { wakeHour: wake, notAfter: now });
    return { mealType: said, at, approx: true, note: `Lo dejé a la hora ${delName(said)}, ~${hhmm(at)}.` };
  }
  // Nombra una comida que aún no llega («anótame 3 empanadas para la cena» a las 11): se respeta. Pedido del usuario
  // (2026-10-16): «ahí es error del usuario, no del sistema». Queda a la hora típica de esa comida hoy, aunque sea más tarde.
  if (!justNow) {
    const at = typicalTimeOf(said, nutritionDayOf(now, opts.dayCtx ?? {}), { wakeHour: wake });
    return { mealType: said, at, approx: true, note: `La dejé en ${theMeal(said)} de hoy, ~${hhmm(at)}.` };
  }
  const slot = slotAt(now, { wakeHour: wake }) as MealType;
  return { mealType: slot, at: now, approx: false, note: `A esta hora (${hhmm(now)}) lo cuento como ${MEAL_NAME[slot]}, no como ${MEAL_NAME[said]}.` };
}

/** «el desayuno», «la cena», «la colación de media mañana» */
export const theMeal = (s: string) => `${s === "desayuno" || s === "almuerzo" ? "el" : "la"} ${MEAL_NAME[s] ?? s}`;

/**
 * «ayer», «anoche», «anteayer»: cuántos días atrás. Por chat se anota hasta anteayer (pedido del usuario, 2026-10-16: «si dice
 * que ayer comió, ahí sí, y se agrega a la cena de ayer»). «Anoche» sin otra comida es la cena. Lo más antiguo («el lunes
 * pasado», «la semana pasada») sigue yendo a la app, donde se elige el día.
 */
export function pastDayOf(wordOrMessage: unknown): { offset: number; word: string; impliedMeal?: MealType } | null {
  const w = typeof wordOrMessage === "string" && /^(ayer|anoche|antier|anteayer|antes de ayer)$/.test(wordOrMessage) ? wordOrMessage : otherDayOf(wordOrMessage);
  if (w === "ayer") return { offset: 1, word: "ayer" };
  if (w === "anoche") return { offset: 1, word: "anoche", impliedMeal: "cena" };
  if (w === "antier" || w === "anteayer" || w === "antes de ayer") return { offset: 2, word: "anteayer" };
  return null;
}

/**
 * Cuándo fue una comida de un día anterior: la comida nombrada (o la que implica «anoche», o la de la hora dicha: «ayer a
 * las 9»), a su hora típica ese día. null si no se sabe cuál comida fue (hay que preguntarlo).
 */
export function pastMealTimingOf(message: string, past: { offset: number; impliedMeal?: MealType }, opts: { now?: Date; dayCtx?: DayCtx; fixedMeal?: MealType } = {}): { mealType: MealType; at: Date; day: Date } | null {
  const now = opts.now ?? new Date();
  const day = nutritionDayOf(now, opts.dayCtx ?? {});
  day.setDate(day.getDate() - past.offset);
  const usual = opts.dayCtx?.usualWake ?? undefined;
  const named = opts.fixedMeal ?? mentionedMeals(message, now)[0] ?? past.impliedMeal ?? null;
  const cands = clockCandidatesOf(message, now);
  if (cands) {
    const onDay = cands.map((c) => {
      const at = new Date(day);
      at.setHours(c.getHours(), c.getMinutes(), 0, 0);
      // la madrugada de ese día de comida (antes de su hora de partida) es del día calendario siguiente
      if (hourOf(at) < dayStartHour(usual)) at.setDate(at.getDate() + 1);
      return at;
    });
    // «ayer a las 8 cené» → las 20:00. Sin comida y con dos horas posibles, se pregunta la comida.
    const pick = named ? onDay.find((a) => fitsSlot(named, a, usual)) : onDay.length === 1 ? onDay[0] : undefined;
    if (pick) return { mealType: (named ?? slotAt(pick, { wakeHour: usual })) as MealType, at: pick, day };
    if (!named) return null;
  }
  const meal = named;
  if (!meal) return null;
  return { mealType: meal, at: typicalTimeOf(meal, day, { wakeHour: usual }), day };
}

// ─── Cantidades ───────────────────────────────────────────────────
const NUM_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  medio: 0.5, media: 0.5,
};
const QTY = "(?:\\d+(?:[.,]\\d+)?(?:\\s*(?:y\\s*)?(?:½|1/2|medio|media))?|\\d+/\\d+|½|¼|¾|un par de|un cuarto de|(?:un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)(?:\\s+y\\s+(?:medio|media))?|medio|media)";

function parseQty(q: string): number | null {
  const s = q.trim();
  if (s === "un par de") return 2;
  if (s === "un cuarto de") return 0.25;
  if (s === "½") return 0.5;
  if (s === "¼") return 0.25;
  if (s === "¾") return 0.75;
  let m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  m = s.match(/^(\d+(?:[.,]\d+)?)(?:\s*(?:y\s*)?(½|1\/2|medio|media))?$/);
  if (m) return parseFloat(m[1].replace(",", ".")) + (m[2] ? 0.5 : 0);
  m = s.match(/^(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)(?:\s+y\s+(?:medio|media))?$/);
  if (m) return NUM_WORDS[m[1]] + (/y\s+(medio|media)$/.test(s) ? 0.5 : 0);
  if (s in NUM_WORDS) return NUM_WORDS[s];
  return null;
}

// Unidades que el usuario puede decir. Gramos y kilos se usan tal cual; el resto tiene que coincidir con la porción de la base.
const UNIT = "(?:gramos?|grs?|g|kilos?|kg|tazas?|cucharadas?|cucharaditas?|vasos?|platos?|porcion(?:es)?|rebanadas?|tajadas?|laminas?|lonchas?|latas?|potes?|presas?|filetes?|unidades?|punados?|trozos?)";
const SING: Record<string, string> = {
  gramo: "g", gramos: "g", gr: "g", grs: "g", g: "g", kilo: "kg", kilos: "kg", kg: "kg",
  unidades: "unidad", porciones: "porcion", punados: "punado",
};
const unitKey = (u: string) => { const f = fold(u); return SING[f] ?? f.replace(/s$/, ""); };

// Porciones de la base que se cuentan "por pieza": con un número a secas ("4 huevos", "2 marraquetas") se multiplica.
// Tazas, cucharadas, vasos o puñados no: "2 arroz" no dice cuánto arroz es. Los PLATOS sí se cuentan: "una cazuela",
// "un lomo a lo pobre" es un plato de eso (antes iban al modelo).
const NOT_COUNTABLE = new Set(["taza", "cucharada", "cucharadita", "vaso", "punado", "g", "ml"]);
const CUP_DRINK = /\b(cafe|te|jugo|nectar|leche|mate|infusion|chocolate caliente|milo)\b/;

/** "½ taza (50g)" → { qty: 0.5, unit: "taza" }. */
function servingUnit(desc: string): { qty: number; unit: string } | null {
  const t = fold(desc).replace(/\(.*$/, "").trim();
  const m = t.match(new RegExp(`^(${QTY})\\s+([a-z]+)`));
  if (!m) return /^\d+\s*g$/.test(t) ? { qty: Number(t.replace(/\D/g, "")), unit: "g" } : null;
  const qty = parseQty(m[1]);
  return qty ? { qty, unit: unitKey(m[2]) } : null;
}

// ─── Nombres ──────────────────────────────────────────────────────
const GENERIC = new Set(["de", "del", "la", "el", "los", "las", "con", "en", "al", "a", "un", "una", "mi", "mis"]);
// Preparación: no cambia qué alimento es para buscarlo en la base
const PREP = new Set(["revuelto", "revueltos", "revuelta", "revueltas", "frito", "fritos", "frita", "fritas", "cocido", "cocidos",
  "cocida", "cocidas", "duro", "duros", "hervido", "hervidos", "hervida", "hervidas", "asado", "asados", "asada", "asadas",
  "plancha", "vapor", "tostado", "tostados", "tostada", "tostadas", "grande", "grandes", "chico", "chicos", "chica", "chicas",
  "mediano", "medianos", "mediana", "medianas", "casero", "casera", "caseros", "caseras"]);
// Palabras de la base que no distinguen un alimento de otro ("Huevo entero" es simplemente "huevo")
const NEUTRAL = ["entero", "entera", "blanco", "blanca", "natural", "comun", "normal", "chileno", "chilena"];
const stem = (w: string) => (w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
// Todo se compara en la forma estándar de FoodText (la misma de todos los buscadores): sin tildes ni símbolos, en singular
// y por cómo suena: "Huevos revueltos" → "uebo", "rebuelto"
const P = (w: string) => phonWord(stemWord(normText(w)));
const GENERIC_P = new Set([...GENERIC].map(P));
const PREP_P = new Set([...PREP].map(P));
const NEUTRAL_P = new Set(NEUTRAL.map(P));
const wordsP = (s: string) => normText(s).split(" ").filter((w) => w.length > 2).map((w) => phonWord(stemWord(w))).filter((w) => !GENERIC_P.has(w));
/**
 * ¿La palabra está entre estas? 2 = igual (o suena igual), 1 = con un error de tipeo ("chokapig" ~ "chokapik": 1 letra, 2 si
 * es larga; las cortas tienen que empezar igual), 0 = no.
 */
function inSet(have: Iterable<string>, k: string): 0 | 1 | 2 {
  let typo = false;
  const max = k.length >= 7 ? 2 : k.length >= 4 ? 1 : 0;
  for (const w of have) {
    if (w === k) return 2;
    if (!typo && max && (k.length >= 5 || w[0] === k[0]) && Math.abs(w.length - k.length) <= max && editDistance(k, w, max) <= max) typo = true;
  }
  return typo ? 1 : 0;
}

/**
 * Qué tan bien calza un alimento de la base con lo que se dijo. Todas las palabras que importan (sin preparación) tienen
 * que estar en su nombre o en un alias; se premia calzar también la preparación ("huevo duro") y se castiga cada palabra
 * de más que el usuario no dijo ("clara"). null = no calza.
 */
function score(said: string, hit: LocalFoodHit): { s: number; fuzzy: boolean } | null {
  const all = wordsP(said);
  const key = all.filter((w) => !PREP_P.has(w));
  if (!key.length) return null;
  let best: { s: number; fuzzy: boolean } | null = null;
  // "Palta / Aguacate", "Plátano / Banana": la barra separa sinónimos, cada lado es un nombre por sí solo (si no, la
  // palabra del otro lado cuenta como "de más" y "palta" empataba con "Pan con palta")
  const names = hit.name.split(/\s+\/\s+/).map((n) => [true, n] as const);
  for (const [isName, n] of [...names, ...(hit.aliases ?? []).map((a) => [false, a] as const)]) {
    const words = wordsP(n);
    const have = new Set(words);
    const m = key.map((k) => inSet(have, k));
    if (m.some((x) => x === 0)) continue;
    // Lo neutro vale solo en el nombre principal ("Huevo entero" = huevo). En un alias sí distingue: "queso blanco" es
    // quesillo, no cualquier queso. Una palabra tomada con error de tipeo vale menos que una igual: lo exacto siempre gana.
    const s = all.reduce((acc, w) => acc + [0, 7, 10][inSet(have, w)], 0)
      - words.filter((w) => !inSet(all, w) && !(isName && NEUTRAL_P.has(w))).length;
    if (best === null || s > best.s) best = { s, fuzzy: m.some((x) => x === 1) };
  }
  return best;
}

/** Variantes de búsqueda: tal cual, sin preparación, en singular. */
function searchVariants(name: string): string[] {
  const words = fold(name).split(" ").filter(Boolean);
  const core = words.filter((w) => !PREP.has(w));
  const singular = core.map((w) => (GENERIC.has(w) ? w : stem(w)));
  return [...new Set([words.join(" "), core.join(" "), singular.join(" ")].filter(Boolean))];
}

/** El alimento de la base para un nombre, solo si hay UNO claramente mejor ("pan" solo empata marraqueta, hallulla…: null). */
async function resolveLocal(name: string, lookup: LocalFoodLookup): Promise<(LocalFoodHit & { fuzzy?: boolean }) | null> {
  // Se juntan los candidatos de TODAS las variantes y gana el mejor: antes mandaba la primera variante con resultados,
  // y con la base ampliada "huevos" (plural) empataba "Huevo frito" con "Huevos revueltos" sin llegar a "huevo", donde
  // "Huevo duro" calza perfecto.
  const best = new Map<string, { h: LocalFoodHit; s: number; fuzzy: boolean }>();
  for (const v of searchVariants(name)) {
    for (const h of await lookup(v)) {
      const r = score(name, h);
      if (r !== null && (best.get(h.name)?.s ?? -Infinity) < r.s) best.set(h.name, { h, ...r });
    }
  }
  const scored = [...best.values()].sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[1].s === scored[0].s) return null;
  return { ...scored[0].h, fuzzy: scored[0].fuzzy };
}

const GLUED_UNIT = /(\d)(g|gr|grs|kg|ml|cc)\b/g;

// ─── Un alimento: "<cantidad> [<unidad> [de]] <nombre>" ────────────
const ITEM_RX = new RegExp(`^(${QTY})\\s+(?:(${UNIT})\\s+(?:de\\s+)?)?(.+)$`);

interface RawItem { qty: number; unit: string | null; name: string }
function parseItem(chunk: string): RawItem | null {
  const m = chunk.trim().match(ITEM_RX);
  if (!m) return null;
  const qty = parseQty(m[1]);
  const unit = m[2] ? unitKey(m[2]) : null;
  const name = m[3].replace(/^(de|del)\s+/, "").trim();
  // Tope por unidades (nadie registra 80 huevos); los gramos se acotan después, al calcular el peso
  if (!qty || qty <= 0 || (unit !== "g" && qty > 50) || !name || /\d/.test(name)) return null;
  return { qty, unit, name };
}

function gramsFor(item: RawItem, hit: LocalFoodHit): number | null {
  if (item.unit === "g") return item.qty;
  if (item.unit === "kg") return item.qty * 1000;
  // "2 porciones de lechuga": una porción es la porción de la base, sea en tazas, presas o gramos (antes solo si la base
  // contaba por unidad o plato, y "2 porciones de lechuga" mandaba todo el mensaje al modelo)
  if (item.unit === "porcion" && hit.servingGrams > 0) return item.qty * hit.servingGrams;
  const s = servingUnit(hit.servingDescription);
  if (!s || !(hit.servingGrams > 0)) return null;
  const perUnit = hit.servingGrams / s.qty;
  if (item.unit === null) {
    // «un café», «un té», «un jugo de naranja»: las bebidas se cuentan por taza o vaso («un arroz» sigue sin contarse)
    if ((s.unit === "taza" || s.unit === "vaso") && CUP_DRINK.test(fold(hit.name))) return item.qty * perUnit;
    if (NOT_COUNTABLE.has(s.unit)) return null;
    return item.qty * perUnit;
  }
  // La unidad dicha tiene que ser la de la porción de la base ("una taza de arroz" con "1 taza (150g)").
  // "unidad"/"porción" valen para cualquier porción que se cuente por pieza.
  if (item.unit === s.unit) return item.qty * perUnit;
  if ((item.unit === "unidad" || item.unit === "porcion") && !NOT_COUNTABLE.has(s.unit)) return item.qty * perUnit;
  if (item.unit === "porcion" && (s.unit === "plato" || s.unit === "porcion")) return item.qty * perUnit;
  return null;
}

/**
 * Reconoce un pedido explícito de registrar comida. Devuelve los alimentos con sus gramos y el tipo de comida, o null
 * si hay cualquier duda (el mensaje va entonces al modelo).
 */
export async function parseFoodMessage(message: unknown, lookup: LocalFoodLookup, now: Date = new Date()): Promise<FoodParse | null> {
  if (typeof message !== "string") return null;
  if (message.length > 220) return null;
  // La hora ("a las 8", "hace una hora") dice CUÁNDO se comió (mealTimingOf), no es parte de los alimentos
  // "50g de papa" → "50 g de papa" (pegado no calzaba con "<cantidad> <unidad>" y el mensaje se iba al modelo)
  const base = fold(message).replace(CLOCK_STRIP, " ").replace(/(\d)[.,](\d)/g, "$1.$2").replace(GLUED_UNIT, "$1 $2").replace(/[¡!;:]/g, " ").replace(/\s+/g, " ").trim().replace(/^[¿\s]+/, "");
  // "¿me puedes anotar 2 huevos?" es un pedido; cualquier otra pregunta ("¿cuántas calorías tiene…?") no
  const req = asRequest(base);
  if (req === base && /[?¿]/.test(message)) return null;
  let t = req.replace(/[?¿]/g, " ").replace(/\s+/g, " ").trim();
  // "como once" / "como almuerzo" dice en qué comida va, no es una duda ("como 200 g" sí lo es)
  const sinComida = t.replace(/\bcomo\s+(?:el\s+|la\s+|mi\s+)?(?=(?:desayuno|almuerzo|onces?|cena|colacion|merienda|snack)\b)/g, "");
  // «colación de la mañana» no es «mañana» (otro día): para NOT_LOG se mira sin el nombre de la colación
  const sinColacion = fold(t).replace(new RegExp(COLACION_AM.source, "g"), " colacion ").replace(new RegExp(COLACION_PM.source, "g"), " colacion ");
  if (!(VERB.test(t) || EAT.test(t)) || NOT_LOG.test(sinColacion) || OTHER.test(t) || DRINK.test(t) || DOUBT.test(sinComida)) return null;
  // "una y media", "2 y medio" → número, antes de separar alimentos por "y"
  t = t.replace(/\b(\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+y\s+(medio|media)\b/g,
    (_, n: string) => String((/^\d+$/.test(n) ? Number(n) : NUM_WORDS[n]) + 0.5));

  const mealType = mealTypeOf(message, now);
  const otherDay = otherDayOf(message);

  // Se quitan el verbo, el tipo de comida y el relleno ("que me comí", "mi", "por favor", "Eris")
  t = t
    .replace(new RegExp(OTHER_DAY.source, "g"), " ")
    .replace(/\b(por favor|porfa|porfis|eris|oye|hola|bueno)\b/g, " ")
    .replace(VERB, " ")
    .replace(/\b(que|lo que)?\s*(me\s+|nos\s+)?(comi|comimos|desayune|desayunamos|almorce|almorzamos|cene|cenamos|merende|tome once|tomamos once|acabo de comer|acabamos de comer|servi|estoy comiendo)\b/g, " ")
    .replace(new RegExp(COLACION_AM.source, "g"), " colacion ").replace(new RegExp(COLACION_PM.source, "g"), " colacion ")
    .replace(/\b(en|a|al|para|de|como|por|mi|el|la)?\s*(el|la|mi)?\s*(desayuno|almuerzo|onces?|cena|colacion|merienda|snack|picoteo)\b/g, " ")
    .replace(/\b(hoy|ahora|recien|esto|lo siguiente|tambien|ya)\b/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.]+|[\s,.]+$/g, "")
    // "tomé once con 1 hallulla", "almorcé de todo: …": el conector que queda al principio sobra
    .replace(/^(con|de)\s+/, "")
    .trim();
  if (!t) return null;

  // Sin cantidades («añade lechuga, repollo y choclo al almuerzo»): si PIDIÓ anotar (no si solo contó que comió), la porción
  // típica de cada uno, avisando para que corrija (revisión 2026-11-04, C3: el mensaje se iba al modelo y terminó en Suplementos)
  const parsed = (await parseItemsText(t, lookup)) ?? (VERB.test(req) ? await parseItemsText(t, lookup, true) : null);
  if (!parsed) return null;
  const { items, assumedNames, corrected } = parsed;
  const assumed = assumedNames.length
    ? `Asumí una porción normal de ${assumedNames.join(" y ")}; si fue otra cantidad, dímelo y lo corrijo.`
    : undefined;
  return { action: "log_meal", mealType, items, ...(assumed ? { assumed } : {}), ...(otherDay ? { otherDay } : {}), ...(corrected.length ? { corrected } : {}) };
}

/**
 * Los alimentos de un texto ya limpio ("1 ½ hallulla con 4 huevos, 200 g de arroz"): cada uno con su cantidad y encontrado
 * en la base local con un peso conocido; null ante cualquier duda. `defaultPortion`: el alimento principal puede venir sin
 * cantidad ("y si como completo") y se toma la porción normal (para simular; para registrar se exige la cantidad).
 */
// ─── Varias comidas en un mensaje ─────────────────────────────────
// «Anótame 3 empanadas de queso para la cena y una para la once», «en el desayuno 2 huevos y en el almuerzo arroz con pollo».
// Antes iba al modelo, que debía llamar la herramienta una vez por comida: se enredaba (gramos que faltaban, búsquedas en
// internet) y tardaba hasta 98 s (banco de pruebas 2026-10-16). Por código: se corta el mensaje por comida y cada tramo se lee
// igual que un registro normal; un tramo que dice solo la cantidad («y una para la once») hereda el alimento del anterior.

export interface MultiMealParse {
  action: "log_meal";
  /** `said`: lo de esa comida como frase propia («anota 1 empanada de queso para la once»), para leer cantidades y la hora solo de ese tramo */
  multi: Array<{ mealType: MealType; items: Array<{ name: string; grams: number }>; said: string; corrected?: string[] }>;
}

const MEAL_MENTION = /\b(?:(?:en|a|al|para|de|como|por)\s+)?(?:(?:el|la|mi|las)\s+)?(desayun[oe]|almuerzo|almorce|onces?|cena|cene|colacion|merienda|snack)\b/g;
const SOLO_CANTIDAD = /^(\d+(?:\.\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media|medio)$/;
export const MEAL_SAID: Record<MealType, string> = {
  desayuno: "para el desayuno", colacion_am: "de colación", almuerzo: "para el almuerzo", once: "para la once", cena: "para la cena", colacion_pm: "de colación",
};
function mealOfWord(w: string, now: Date): MealType {
  if (w.startsWith("desayun")) return "desayuno";
  if (w.startsWith("almor") || w === "almuerzo") return "almuerzo";
  if (w.startsWith("once")) return "once";
  if (w.startsWith("cen")) return "cena";
  return now.getHours() < 15 ? "colacion_am" : "colacion_pm";
}

export async function parseMultiMealMessage(message: unknown, lookup: LocalFoodLookup, now: Date = new Date()): Promise<MultiMealParse | null> {
  if (typeof message !== "string" || message.length > 300) return null;
  if (mentionedMeals(message, now).length < 2) return null;
  const base = fold(message).replace(CLOCK_STRIP, " ").replace(/(\d)[.,](\d)/g, "$1.$2").replace(GLUED_UNIT, "$1 $2")
    .replace(/[¡!;:?¿]/g, " ").replace(/\s+/g, " ").trim();
  if (!(VERB.test(base) || EAT.test(base)) || NOT_LOG.test(base) || OTHER.test(base) || (OTHER_DAY.test(base) && !pastDayOf(message))) return null;
  const marks = [...base.matchAll(MEAL_MENTION)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, meal: mealOfWord(m[1], now) }));
  if (marks.length < 2) return null;
  const limpiar = (s: string) => s.replace(new RegExp(OTHER_DAY.source, "g"), " ").replace(VERB, " ").replace(EAT, " ")
    .replace(/\b(por favor|porfa|porfis|eris|oye|hola|bueno|hoy|ahora|recien|tambien|ya|y|e|que|me)\b/g, " ")
    .replace(/[,.]/g, " ").replace(/\s+/g, " ").trim();
  // ¿Los alimentos van antes de cada comida («3 empanadas para la cena…») o después («en el desayuno 2 huevos…»)?
  const antes = limpiar(base.slice(0, marks[0].start)).length > 0;
  const tramos = marks.map((m, i) => ({
    meal: m.meal,
    text: limpiar(antes ? base.slice(i === 0 ? 0 : marks[i - 1].end, m.start) : base.slice(m.end, i + 1 < marks.length ? marks[i + 1].start : base.length)),
  }));
  const multi: MultiMealParse["multi"] = [];
  let anterior = "";
  for (const t of tramos) {
    // «sin», «más o menos», «harto»…: cambian el sentido o la cantidad; mejor que lo vea el modelo
    if (!t.text || DOUBT.test(t.text)) return null;
    // «y una para la once»: solo la cantidad → el alimento del tramo anterior
    const text = SOLO_CANTIDAD.test(t.text) && anterior ? `${t.text} ${anterior}` : t.text;
    const parsed = await parseItemsText(text, lookup);
    if (!parsed || !parsed.items.length) return null;
    // El alimento de este tramo sin su cantidad, para el siguiente («3 empanadas de queso» → «empanadas de queso»)
    anterior = text.replace(/^(\d+(?:\.\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+/, "");
    const prev = multi.find((x) => x.mealType === t.meal);
    if (prev) { prev.items.push(...parsed.items); prev.said += ` y ${text}`; prev.corrected = [...(prev.corrected ?? []), ...parsed.corrected]; }
    else multi.push({ mealType: t.meal, items: parsed.items, said: `anota ${text} ${MEAL_SAID[t.meal]}`, ...(parsed.corrected.length ? { corrected: parsed.corrected } : {}) });
  }
  return multi.length >= 2 ? { action: "log_meal", multi } : null;
}

async function parseItemsText(t: string, lookup: LocalFoodLookup, defaultPortion = false):
  Promise<{ items: FoodParse["items"]; assumedNames: string[]; corrected: string[]; chunks: string[] } | null> {
  // Alimentos separados por coma, "y", "+", "más"; "con" se prueba después (puede ser parte del nombre: "arroz con leche")
  const chunks = t.split(/\s*(?:,|\+|\by\b|\bmas\b)\s*/).map((c) => c.trim()).filter(Boolean);
  if (!chunks.length || chunks.length > 8) return null;

  const items: FoodParse["items"] = [];
  const assumedNames: string[] = [];
  const corrected: string[] = [];
  for (const chunk of chunks) {
    const whole = parseItem(chunk);
    const bare = !whole && defaultPortion ? chunk.replace(/^(?:el|la|los|las|un poco de|algo de)\s+/, "").trim() : "";
    const wholeHit = whole ? await resolveLocal(whole.name, lookup) : bare ? await resolveLocal(bare, lookup) : null;
    const parts: Array<[RawItem | null, LocalFoodHit]> = [];
    if (wholeHit) {
      parts.push([whole, wholeHit]);
      if (wholeHit.fuzzy) corrected.push(`«${whole?.name ?? bare}» como ${wholeHit.name}`);
    }
    else {
      const sub = chunk.split(/\s+con\s+/);
      if (sub.length < 2) return null;
      for (const [i, s] of sub.entries()) {
        const it = parseItem(s);
        // Lo que va después de "con" sin cantidad es un acompañamiento ("una hallulla con palta"): se toma la porción
        // normal de la base y se avisa. El alimento principal sí necesita cantidad (salvo al simular).
        if (!it && i === 0 && !defaultPortion) return null;
        const said = it ? it.name : s.replace(/^(de|del|un poco de)\s+/, "").replace(/^(?:el|la|los|las)\s+/, "").trim();
        const hit = await resolveLocal(said, lookup);
        if (!hit) return null;
        parts.push([it, hit]);
        if (hit.fuzzy) corrected.push(`«${said}» como ${hit.name}`);
      }
    }
    for (const [it, hit] of parts) {
      const g = it ? gramsFor(it, hit) : hit.servingGrams;
      if (!g || g < 1 || g > 3000) return null;
      if (!it) assumedNames.push(`${hit.name.split(" / ")[0].toLowerCase()} (${hit.servingDescription})`);
      items.push({ name: hit.name, grams: Math.round(g) });
    }
  }
  if (!items.length) return null;
  return { items, assumedNames, corrected, chunks };
}

// ─── «¿Y si me como…?» ────────────────────────────────────────────
// Simular antes de comer (services/WhatIfFood.ts, 2026-10-15): la misma lectura de alimentos que al registrar, pero con una
// pregunta hipotética. Nada se anota. Si no queda claro qué alimento es, null y lo ve el modelo.

export interface WhatIfParse {
  action: "simulate";
  /** la comida que nombró ("en la once"); sin ella, la de la hora */
  mealType?: MealType;
  items: Array<{ name: string; grams: number }>;
  /** cómo lo dijo ("un completo"), para nombrarlo igual en la respuesta */
  said?: string;
  assumed?: string;
  corrected?: string[];
}

const WHATIF_RX = new RegExp("^(?:(?:oye|hola|eris|ya|bueno|pero|entonces|y)[\\s,]+)*(?:" + [
  "(?:y\\s+)?(?:que\\s+(?:pasa|pasaria|tal)\\s+)?si\\s+(?:me\\s+|nos\\s+)?(?:como|comiera|comemos|tomo|tomara|almuerzo|almorzara|ceno|cenara|desayuno|desayunara|meriendo|picoteo)",
  "(?:me\\s+)?(?:puedo|podria)\\s+(?:comer|comerme|tomar|tomarme)",
  "(?:me\\s+)?(?:conviene|convendria)\\s+(?:comer|comerme|tomar|tomarme)",
  "(?:es\\s+|seria\\s+)?(?:buena|mala)\\s+idea\\s+(?:comer|comerme|tomar|tomarme)",
  "(?:como|cuanto)\\s+me\\s+(?:afecta|afectaria)(?:\\s+(?:comer|comerme|tomar|tomarme))?",
  "simula(?:r|me)?(?:\\s+que\\s+(?:me\\s+)?(?:como|tomo))?",
  "(?:me\\s+)?voy\\s+a\\s+(?:comer|comerme|tomar|tomarme)",
  "(?:estoy\\s+)?pensando\\s+en\\s+(?:comer|comerme|tomar|tomarme)",
  // Antojos (fase I7): «tengo antojo de una pizza», «me tinca un completo», «quiero comerme un kuchen»
  "(?:tengo|me\\s+dio|me\\s+da|ando\\s+con)\\s+(?:un\\s+)?antojo\\s+de",
  "se\\s+me\\s+antoj(?:a|o|an|aron)",
  "me\\s+tincan?",
  "(?:quiero|quisiera)\\s+(?:comer|comerme|tomar|tomarme)",
  "me\\s+muero\\s+(?:de\\s+ganas\\s+de\\s+(?:comer|comerme)|por)",
  "me\\s+(?:comeria|tomaria)",
].join("|") + ")\\b");
// La pregunta que suele ir al final ("…, ¿cómo quedo?", "¿qué pasa con mi día?") no es parte del alimento
const WHATIF_TAIL = /[\s,]*(?:(?:como|que tal|cuanto|en que)\s+(?:quedo|quedaria|me\s+(?:afecta|afectaria|va|iria|sube|subiria|baja|bajaria|queda)|queda(?:ria)?\s+(?:mi|el)\s+dia|va\s+mi\s+dia)|que\s+pasa(?:ria)?(?:\s+con\s+mi\s+dia)?|se\s+puede|esta\s+bien|me\s+conviene)\b.*$/;
// Accentos y eñes: para recuperar del mensaje original cómo lo escribió ("un plátano", no "un platano")
const ACC: Record<string, string> = { a: "[aáàÁ]", e: "[eéèÉ]", i: "[iíìÍ]", o: "[oóòÓ]", u: "[uúüùÚ]", n: "[nñÑ]" };
function originalSpan(message: string, folded: string): string {
  const src = folded.split("").map((ch) => ACC[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
  try { return message.match(new RegExp(src, "i"))?.[0]?.toLowerCase() ?? folded; } catch { return folded; }
}

/** «¿y si me como un completo?», «¿puedo comerme 2 empanadas en la once?»: qué piensa comer, sin anotarlo. */
export async function parseWhatIfMessage(message: unknown, lookup: LocalFoodLookup, now: Date = new Date()): Promise<WhatIfParse | null> {
  if (typeof message !== "string" || message.length > 220) return null;
  const base = fold(message).replace(CLOCK_STRIP, " ").replace(/(\d)[.,](\d)/g, "$1.$2").replace(GLUED_UNIT, "$1 $2")
    .replace(/[¡!;:¿?]/g, " ").replace(/\s+/g, " ").trim();
  const m = base.match(WHATIF_RX);
  if (!m) return null;
  let t = base.slice(m[0].length).replace(WHATIF_TAIL, "").trim();
  // El agua no se simula como comida ("voy a tomar agua"): va por el registro de agua
  if (OTHER_DAY.test(t) || OTHER.test(t) || /\bagua\b/.test(t)) return null;
  const sinComida = t.replace(/\b(?:en|a|al|para|de|como|por)?\s*(?:el\s+|la\s+|mi\s+)?(?:desayuno|almuerzo|onces?|cena|colacion|merienda|snack|picoteo)\b/g, " ");
  if (DOUBT.test(sinComida)) return null;
  // Una bebida se simula como alimento: 1 ml ≈ 1 g
  t = t.replace(/\b(\d+(?:\.\d+)?)\s*(?:ml|cc)\b/g, "$1 g")
    .replace(/\b(\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+y\s+(medio|media)\b/g,
      (_, n: string) => String((/^\d+$/.test(n) ? Number(n) : NUM_WORDS[n]) + 0.5))
    .replace(/\b(?:en|a|al|para|de|como|por|mi|el|la)?\s*(?:el|la|mi)?\s*(?:desayuno|almuerzo|onces?|cena|colacion|merienda|snack|picoteo)\b/g, " ")
    .replace(/\b(?:hoy|ahora|ahorita|mas tarde|despues|luego|por favor|porfa|eris)\b/g, " ")
    .replace(/\s+/g, " ").replace(/^[\s,.]+|[\s,.]+$/g, "").replace(/^(?:con|de)\s+/, "").trim();
  if (!t) return null;
  // «Quiero comer algo», «se me antoja algo dulce»: no es un alimento (por sonido, «algo» calzaba con «algas»: cochayuyo)
  if (/^algo\b/.test(t)) return null;
  const parsed = await parseItemsText(t, lookup, true);
  if (!parsed) return null;
  const meal = mentionedMeal(message, now);
  // Cómo lo dijo, para nombrarlo igual ("un completo y una coca-cola"); con "con" un trozo trae dos alimentos y va entero
  const spans = parsed.chunks.map((c) => originalSpan(message, c));
  const said = spans.length === 1 ? spans[0] : `${spans.slice(0, -1).join(", ")} y ${spans[spans.length - 1]}`;
  const assumed = parsed.assumedNames.length ? `Tomé una porción normal de ${parsed.assumedNames.join(" y ")}.` : undefined;
  return { action: "simulate", ...(meal ? { mealType: meal } : {}), items: parsed.items, ...(said ? { said } : {}),
    ...(assumed ? { assumed } : {}), ...(parsed.corrected.length ? { corrected: parsed.corrected } : {}) };
}

// ─── Gramos según lo que dijo la persona ──────────────────────────
const MEAL_PHRASE = /\b(en|a|al|para|de|como|por|mi|el|la)?\s*(el|la|mi)?\s*(desayuno|almuerzo|onces?|cena|colacion|merienda|snack|picoteo)\b/g;
const SAID_RX = new RegExp(`^(${QTY})(?:\\s+(${UNIT})(?:\\s+de)?)?(?:\\s+(.+))?$`);

/**
 * Los gramos de un alimento según lo que dijo la persona para ESA comida: "3 empanadas para la cena y una para la once" →
 * en la cena 3 unidades de la porción de la base, en la once 1. Cuando el mensaje no pasa por parseFoodMessage (varias
 * comidas, frases raras), el modelo ponía gramos a ojo: 150 g por 3 empanadas, cuando cada una son 130 g (2026-10-11).
 * Solo cuenta una cantidad junto al nombre del alimento (o sola, "una", en la frase de esa comida si es lo único que anota).
 * null si no lo dice claro: se queda lo que puso el modelo.
 */
export function saidGramsFor(
  message: unknown,
  opts: { meal: string; names: string[]; servingDescription: string; servingGrams: number; onlyItem: boolean; now?: Date },
): number | null {
  if (typeof message !== "string" || message.length > 400) return null;
  const now = opts.now ?? new Date();
  const t = fold(message).replace(CLOCK_STRIP, " ").replace(/(\d)[.,](\d)/g, "$1.$2").replace(GLUED_UNIT, "$1 $2").replace(/[¡!?¿:]/g, " ")
    .replace(/\b(\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+y\s+(medio|media)\b/g,
      (_, n: string) => String((/^\d+$/.test(n) ? Number(n) : NUM_WORDS[n]) + 0.5));
  const sameMeal = (m: MealType | null) => !!m && (m === opts.meal || (m.startsWith("colacion") && opts.meal.startsWith("colacion")));
  const clauses = t.split(/\s*(?:[,;+.]|\by\b|\bmas\b)\s*/).map((c) => c.trim()).filter(Boolean)
    .map((c) => ({ c, meal: mentionedMeals(c, now)[0] ?? null }));
  // Primero las frases de esta comida; después las que no nombran ninguna. Nunca las de otra comida.
  const cands = [...clauses.filter((x) => sameMeal(x.meal)), ...clauses.filter((x) => !x.meal)];
  const itemWords = new Set(opts.names.flatMap((n) => wordsP(n)));
  const hit = { name: "", servingDescription: opts.servingDescription, servingGrams: opts.servingGrams };
  for (const { c, meal } of cands) {
    const clean = c.replace(MEAL_PHRASE, " ").replace(VERB, " ")
      .replace(/\b(que|lo que)?\s*(me\s+|nos\s+)?(comi|comimos|desayune|desayunamos|almorce|almorzamos|cene|cenamos|merende|tome once|tomamos once|acabo de comer|servi|estoy comiendo)\b/g, " ")
      .replace(/\b(hoy|ahora|recien|tambien|ya|otra|otras|otro|otros)\b/g, " ").replace(/\s+/g, " ").trim().replace(/^(con|de)\s+/, "");
    for (const part of [clean, ...clean.split(/\s+con\s+/)]) {
      const m = part.trim().match(SAID_RX);
      if (!m) continue;
      const qty = parseQty(m[1]);
      if (!qty || qty <= 0) continue;
      const unit = m[2] ? unitKey(m[2]) : null;
      const name = (m[3] ?? "").replace(/^(de|del)\s+/, "").trim();
      if (name) {
        if (/\d/.test(name)) continue;
        const key = wordsP(name).filter((w) => !PREP_P.has(w));
        if (!key.length || key.some((k) => !inSet(itemWords, k))) continue;
      } else if (!(opts.onlyItem && sameMeal(meal))) continue;
      if (unit !== "g" && unit !== "kg" && qty > 50) continue;
      const g = gramsFor({ qty, unit, name }, hit);
      if (g && g >= 1 && g <= 3000) return Math.round(g);
    }
  }
  return null;
}

// ─── Borrar por chat ──────────────────────────────────────────────
// "borra la empanada", "saca las sopaipillas de mi registro", "me equivoqué, borra lo último". Antes dependía de que el
// modelo llamara a delete_entry; ahora, si es claro, se resuelve por código. Igual que al registrar: ante la duda, null.

/** Marca de "lo último que se registró" (la herramienta borra la comida más reciente de hoy). */
export const LAST_ENTRY = "__ultimo__";
export interface DeleteParse { action: "delete_entry"; searchQuery: string }

/**
 * «Son 250g, no 150g» justo después de anotar UN alimento: la misma comida y el mismo alimento, con la cantidad corregida.
 * 2026-10-18 (chat real): sin esto lo resolvía el modelo, que borró la carne mongoliana y anotó «pechuga de pollo a la
 * plancha (150 g)». Solo con un alimento en la última confirmación (con varios no se sabe cuál) y con la unidad dicha.
 */
/**
 * «Te faltó la carne molida, unos 150 g», «también un vaso de jugo» justo después de anotar una comida: va a ESA comida.
 * Devuelve la frase para anotarlo («anota la carne molida, unos 150 g para el almuerzo») y la comida. 2026-10-21 (banco de
 * pruebas): sin verbo de registro iba al modelo con 9 herramientas, el prompt llenaba los 8192 tokens y se cortaba.
 */
export function addToLastMeal(message: unknown, lastAssistant: unknown): { text: string; mealType: MealType } | null {
  const head = String(lastAssistant ?? "").match(/✅\s*\*\*[^*]*?(Desayuno|Colaci[oó]n AM|Almuerzo|Once|Cena|Colaci[oó]n PM)[^*]*?registrad[oa]\*\*/i);
  if (!head) return null;
  const raw = String(message ?? "").trim();
  if (raw.length > 120 || raw.includes("?")) return null;
  const m = raw.match(/^(?:oye,?\s+)?(?:te |se te )?(?:falt[oó]|faltaron|olvidaste|se te (?:olvid[oó]|pas[oó])|tambi[eé]n|adem[aá]s|y tambi[eé]n|agrega(?:le)?|s[uú]male)\s*:?\s+(.+)$/i);
  if (!m) return null;
  const mealType = MEAL_OF_LABEL.find(([re]) => re.test(head[1]))?.[1];
  if (!mealType) return null;
  let what = m[1].replace(/[.!]+$/, "").trim();
  // «la carne molida, unos 150 g» → «150 g de carne molida» (con la cantidad al final no lo entiende parseFoodMessage)
  const tail = what.match(/^(?:el |la |los |las |un |una )?(.+?),?\s+(?:unos?|unas?|como|aprox(?:imadamente)?|cerca de)?\s*(\d+(?:[.,]\d+)?)\s*(g|gr|grs|gramos|ml|cc)$/i);
  if (tail) what = `${tail[2]} ${tail[3]} de ${tail[1]}`;
  return { text: `anota ${what} ${MEAL_SAID[mealType]}`, mealType };
}

export interface AmountFix { name: string; grams: number; from: number; unit: "g" | "ml"; mealType: MealType }
const MEAL_OF_LABEL: Array<[RegExp, MealType]> = [[/desayuno/i, "desayuno"], [/colaci[oó]n am/i, "colacion_am"], [/almuerzo/i, "almuerzo"], [/once/i, "once"], [/cena/i, "cena"], [/colaci[oó]n pm/i, "colacion_pm"]];
export function parseAmountFix(message: unknown, lastAssistant: unknown): AmountFix | null {
  const last = String(lastAssistant ?? "");
  const head = last.match(/✅\s*\*\*[^*]*?(Desayuno|Colaci[oó]n AM|Almuerzo|Once|Cena|Colaci[oó]n PM)[^*]*?registrad[oa]\*\*/i);
  const items = [...last.matchAll(/^•\s+\*\*(.+?)\*\*\s+\((\d+(?:[.,]\d+)?)\s*(g|ml)\)/gm)];
  if (!head || items.length !== 1) return null;
  const t = fold(String(message ?? "")).replace(/\s+/g, " ").trim();
  if (t.length > 80 || t.includes("?")) return null;
  const U = "(?:g|gr|grs|gramos|ml|cc)";
  const n = (s: string) => Number(s.replace(",", "."));
  // «son 250 g», «eran 250g, no 150», «fueron 250 gramos», «en realidad son 250 g», «250 g no 150 g», «no 150 sino 250 g»
  const m = t.match(new RegExp(`^(?:no,?\\s*)?(?:en realidad\\s+)?(?:son|eran|era|fueron|fue|es)\\s+(\\d+(?:[.,]\\d+)?)\\s*${U}\\b`))
    ?? t.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*${U}\\s*,?\\s*no\\b`))
    ?? t.match(new RegExp(`^no\\s+(?:\\d+(?:[.,]\\d+)?)\\s*${U}?\\s*(?:,\\s*)?sino\\s+(\\d+(?:[.,]\\d+)?)\\s*${U}?\\b`));
  if (!m) return null;
  const grams = n(m[1]);
  const from = n(items[0][2]);
  if (!(grams > 0 && grams <= 3000) || grams === from) return null;
  const mealType = MEAL_OF_LABEL.find(([re]) => re.test(head[1]))?.[1];
  return mealType ? { name: items[0][1], grams, from, unit: items[0][3] === "ml" ? "ml" : "g", mealType } : null;
}

const DEL_VERB = /^(?:(?:oye|eris|ya|no|chuta|uy|ups|perdon|bueno|me equivoque|te equivocaste|esta malo|quedo mal)[\s,]+)*(?:por favor\s+|porfa\s+)?(?:borra|borrame|borralo|borrala|borralos|borralas|elimina|eliminame|eliminalo|eliminala|quita|quitame|quitalo|quitala|saca|sacame|sacalo|sacala|deshaz|deshace|anula|anulalo|anulala)\b\s*/;
const LAST_RX = /^(?:(?:lo|el|la)\s+)?(?:ultimo|ultima)(?:\s+(?:registro|comida|que (?:te )?(?:dije|anote|registre|comi)|que (?:anotaste|registraste)))?$|^(?:eso|esto|ese registro|esa comida|lo que (?:anotaste|registraste|anote|registre))$/;
// Borrar otra cosa (un gasto, una nota, agua…): no es de la comida
const DEL_OTHER = /\b(gastos?|pagos?|compras?|transferencias?|abonos?|notas?|tareas?|recordatorios?|agua|vasos?|litros?|ml|rutinas?|series?|ejercicios?|entreno|glucosa|insulina|dosis|chat|conversacion|mensajes?|archivos?|eventos?|citas?|alarmas?|cuentas?|tarjetas?|metas?)\b/;
const DEL_CONTEXT = /\b(de mi registro|del registro|de mis comidas|del log|de lo que comi|de lo de hoy|de hoy|de nutricion)\b/;

/**
 * ¿La respuesta anterior de Eris fue registrar comida? ("✅ ☕ Once registrada … kcal"). "Borra eso" solo se resuelve por
 * código en ese caso: después de un gasto o una nota, "eso" es otra cosa.
 */
export function wasFoodLogReply(reply: unknown): boolean {
  if (typeof reply !== "string") return false;
  const t = fold(reply);
  return /\b(registrad[oa]|anotad[oa])\b/.test(t) && /\bkcal\b/.test(t);
}

/** ¿El nombre de un alimento registrado calza con lo que se pidió borrar? ("sopaipillas" ↔ "Sopaipilla", sin acentos) */
export function foodNameMatches(itemName: string, query: string): boolean {
  const a = fold(itemName), q = fold(query).trim();
  if (!q) return false;
  if (a.includes(q)) return true;
  const key = wordsP(q).filter((w) => !PREP_P.has(w));
  if (!key.length) return false;
  const have = new Set(wordsP(itemName));
  return key.every((k) => inSet(have, k));
}

/** Reconoce un pedido claro de borrar comida del registro de hoy. */
export async function parseDeleteMessage(message: unknown, lookup: LocalFoodLookup, lastAssistant?: unknown): Promise<DeleteParse | null> {
  if (typeof message !== "string" || message.length > 160 || /[?¿]/.test(message)) return null;
  const t = fold(message).replace(/[¡!.;:]/g, " ").replace(/\s+/g, " ").trim();
  const m = t.match(DEL_VERB);
  if (!m) return null;
  let rest = t.slice(m[0].length).trim();
  if (DEL_OTHER.test(rest) || OTHER_DAY.test(rest)) return null;
  const explicit = DEL_CONTEXT.test(rest);
  rest = rest
    .replace(new RegExp(DEL_CONTEXT.source, "g"), " ")
    .replace(/\b(por favor|porfa|porfis|eris)\b/g, " ")
    .replace(/\b(del|de la|de las|en el|en la)\s+(desayuno|almuerzo|onces?|cena|colacion|merienda)\b/g, " ")
    .replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").trim();
  if (LAST_RX.test(rest)) return wasFoodLogReply(lastAssistant) ? { action: "delete_entry", searchQuery: LAST_ENTRY } : null;
  const name = rest.replace(/^(?:el|la|los|las|un|una|unos|unas|mi|mis)\s+/, "").replace(/^\d+\s+/, "").trim();
  if (!name || name.split(" ").length > 4 || /\d/.test(name)) return null;
  // Sin "de mi registro", el nombre tiene que ser un alimento conocido ("borra la empanada" sí; "borra eso del PC" no)
  if (!explicit) {
    let known = false;
    for (const v of searchVariants(name)) {
      if ((await lookup(v)).some((h) => score(name, h) !== null)) { known = true; break; }
    }
    if (!known) return null;
  }
  return { action: "delete_entry", searchQuery: name };
}
