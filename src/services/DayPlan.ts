// ============================================================
// Eris — «¿Qué recomienda Eris?»: el plan del día (Eris al timón, T0 · 2026-10-29)
//
// Pedido del usuario: «un botón "Qué recomienda Eris" con 3 caminos (estricto, óptimo y uno más permisivo) y un cajón para
// "otro", para que Eris decida y tome acción y tú solo la sigues… para cuando no te da tiempo de nada».
//
// Eris arma el día con lo que ya sabe de cada módulo y por CÓDIGO («la IA conecta, el código decide»):
//   - Comida: las comidas que quedan, con su parte de las kcal y la proteína del día según el camino, con lo que hay en casa
//     (lo que vence, primero) y sus restricciones (MealRecommender.recommendMeals con `slotTarget`). Con diabetes no se salta
//     ninguna; con enfermedad renal la proteína sigue con su tope.
//   - Entreno: el día de su rutina (Forge) ajustado por cómo durmió (sleepReadiness): con «liviano» nunca va pesado.
//   - Plata: un tope para hoy con lo que puede gastar por día (Finanzas). Nunca mueve plata sola.
//   - Casa: lo que vence pronto, primero.
//   - Sueño: la hora para acostarse y la del último café (las 2 semanas del reloj).
// Los 3 caminos siempre dentro de lo seguro: Estricto (exacto, sin gustos, la rutina completa, tope más bajo), Óptimo (la
// pauta de su cuerpo) y Flexible (un gusto con su contrapartida, entreno corto, tope algo mayor). «Otro» es una nota que se
// lee por código (comer afuera, sin plata, enfermo, dolor, sin tiempo, un evento en la noche).
// ============================================================

import { gatherMetabolicContext, analyze, type MetabolicContext, type Analysis } from "./MetabolicAnalysis.js";
import { autoPrefsDe } from "./AutoPrefs.js";
import { recommendMeals, loadFoodAffinity, FOODS, type Plate, type Moment } from "./MealRecommender.js";
import { pantryFrom, type HomePantry } from "./HomePantry.js";
import { loadTargets, type BodyGoal } from "./DailyTargets.js";
import { getProjection, intentFor } from "./TrainingIntent.js";
import { sleepReadiness, lastSleepFrom, hhmmOf, alertCurve, alertCurveText, isCaffeinated, type Readiness, type SleepInsights, type LastSleep, type AlertCurve } from "./SleepCore.js";
import { typicalTimeOf, slotIsPast, effectiveSlot, hourOf, MEAL_NAME, dayCtxFrom, nutritionDayKey, nutritionDayOf, isoDayKey, wakeHourFor } from "./MealSchedule.js";
import { dayEntries } from "./NutritionLog.js";
import { lastInventoryState } from "./InventoryBackup.js";
import { pulseSignal, afterPattern, despuesTxt, type PulseSignal, type AfterPattern } from "./MindSignals.js";

/** «rendimiento» (⚡ R0, 2026-10-29): el día exigente. No es de todos los días: no entra en MODES ni en el piloto automático. */
export type PlanMode = "estricto" | "optimo" | "flexible" | "rendimiento";
export const MODES: PlanMode[] = ["estricto", "optimo", "flexible"];
export const MODE_NAME: Record<PlanMode, string> = { estricto: "Estricto", optimo: "Óptimo", flexible: "Flexible", rendimiento: "Rendimiento" };

export interface PlanFood { id: string; name: string; grams: number; portionText: string; kcal: number; protein: number; carbs: number; fat: number; fiber: number }
export type PlanAction =
  | { type: "log_food"; slot: string; opciones: PlanFood[][]; alt: number }
  | { type: "load_routine"; deload: boolean; shorter: boolean }
  | { type: "walk"; minutes: number }
  | { type: "rest" }
  | { type: "set_cap"; clp: number }
  /** Eris administra (A2): abrir «Cuadrar» en Finanzas */
  | { type: "cuadrar" }
  | { type: "add_list"; items: string[] }
  /** Modo Rendimiento: lo que se hace en el momento (luz, café, siesta-café, un bloque de foco, pausa, respiración…) */
  | { type: "cue"; cue: Cue; minutes?: number }
  | { type: "info" };
export type Cue = "luz" | "cafe" | "siesta_cafe" | "siesta" | "bloque" | "ideas" | "pausa" | "respira" | "agua" | "seguridad";
export type PlanModule = "comida" | "entreno" | "plata" | "casa" | "sueno" | "mente";
export interface PlanStep { id: string; modulo: PlanModule; hora: number | null; titulo: string; detalle: string; accion: PlanAction; hecho?: boolean }

/** «Otro»: lo que se entiende de su nota */
export interface Ajustes {
  /** comidas que hace fuera de casa (no se arma menú: se orienta) */
  afuera?: string[];
  sinPlata?: boolean;
  enfermo?: boolean;
  /** la zona que le duele («rodilla») */
  dolor?: string;
  sinTiempo?: boolean;
  /** un evento con comida (cumpleaños, asado…): la cena va ahí */
  evento?: { que: string; hora: number | null };
  /** «hoy no entreno» (T3: lo entiende el modelo cuando el código no) */
  sinEntreno?: boolean;
  /** «voy a comer más / menos hoy»: kcal de más o de menos (acotado; nunca bajo lo seguro) */
  kcalExtra?: number;
}

/**
 * Las piezas de «cerebro» (sin el módulo todavía): cómo está y qué pide su día. Nada se juzga ni se muestra como puntaje;
 * solo ordena el día y se guarda como historia (`mind_checkins`) para el futuro módulo mental.
 *   detalle → pensamiento secuencial, mirada lineal (orden, detalle, paso a paso)
 *   ideas   → pensamiento lateral, mirada panorámica (ideas, estrategia, el mapa completo)
 */
export type TipoDia = "detalle" | "ideas" | "todo";
export interface Mente { estres?: number; foco?: number; tipo?: TipoDia }

export interface DayPlan {
  mode: PlanMode;
  /** YYYY-MM-DD (día de comida) */
  day: string;
  creado: string;
  kcal: number;
  proteinG: number | null;
  /** «2.350 kcal · Empuje · hasta $7.000 · a la cama 23:45» */
  resumen: string;
  pasos: PlanStep[];
  nota?: string;
  ajustes?: Ajustes;
  /** lo que la nota no alcanzó a ajustar (se dice) */
  notaSinLeer?: boolean;
  /** el plan de mañana armado la noche anterior (piloto automático): las comidas quedan; el entreno se confirma en la mañana */
  borrador?: boolean;
  /** lo armó el piloto automático (no lo eligió en el momento) */
  auto?: boolean;
  avisos: string[];
  /** lo que se aclara al final (lo de la nota que ya no aplica: «el almuerzo de hoy ya está anotado») */
  notas?: string[];
  /** Modo Rendimiento: su curva de alerta de hoy (ESTIMADA), el check-in y el tope de café */
  curva?: AlertCurve;
  mente?: Mente;
  tazas?: { max: number; llevas: number };
}

export interface DayPlanInput {
  now: Date;
  day: string;
  ctx: MetabolicContext;
  analysis: Analysis;
  targets: { kcal: number; proteinG: number | null; proteinMax: number | null; goal?: BodyGoal; maintenance?: number };
  affinity: Map<string, any>;
  pantry: HomePantry | null;
  /** las comidas que quedan hoy, en orden, con su hora (horas locales; > 24 = pasada la medianoche) */
  slots: Array<{ slot: string; hora: number }>;
  /** todas las del día (para repartir): las que quedan y las ya comidas */
  allSlots: string[];
  training: { rest: boolean; name: string | null; items: Array<{ name: string; text: string }>; doneSets: number } | null;
  intent: { answer: "si" | "no"; time?: string } | null;
  ready: Readiness | null;
  sleep: SleepInsights | null;
  finance: { libre: number | null; porDia: number | null; cuadre?: { nombre: string; diff: number } | null } | null;
  /** «Así manejo tu…» (A3): el tope de gasto del día y el entreno según el sueño se pueden apagar */
  prefs?: { topeDia: boolean; segunSueno: boolean };
  diabetic: boolean;
  renal: boolean;
  /** usa el Inventario (hay respaldo): lo que falta para el menú puede ir a su lista de compras */
  hasInventory?: boolean;
  // ── Modo Rendimiento ──
  /** la hora en que despertó hoy (o la de siempre) */
  wakeH?: number | null;
  /** lo de anoche y el sueño aunque tenga menos de 4 noches (la curva se arma igual, con lo que haya) */
  lastSleep?: LastSleep | null;
  sleepAny?: SleepInsights | null;
  /** siestas o segundo sueño de hoy, después de despertar (horas locales) */
  naps?: Array<{ start: number; end: number }>;
  /** condiciones, restricciones y notas (para el tope de café) */
  conds?: string[];
  condText?: string;
  /** tazas con cafeína anotadas hoy */
  cafeHoy?: number;
  /** días en Rendimiento en los últimos 7 (sin hoy) */
  usesRendimiento7d?: number;
  /** R2: su pulso en reposo de hoy contra su promedio de 4 semanas (señal de estrés o cansancio, no diagnóstico) */
  pulso?: PulseSignal | null;
  /** R2: lo que se repite después de sus días exigentes (sueño de esa noche, ánimo del día siguiente) */
  despues?: AfterPattern | null;
}

// ─── Utilidades ───────────────────────────────────────────────────────────────
const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const fmtK = (n: number) => Math.round(n).toLocaleString("es-CL");
const round500 = (n: number) => Math.max(0, Math.round(n / 500) * 500);
const corto = (name: string) => name.split(" (")[0].split(" / ")[0].trim();
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const SHARE: Record<string, number> = { desayuno: 0.25, colacion_am: 0.07, almuerzo: 0.33, colacion_pm: 0.1, once: 0.25, cena: 0.25 };
const EMOJI: Record<string, string> = { desayuno: "🌅", colacion_am: "🍎", almuerzo: "☀️", colacion_pm: "🍌", once: "🫖", cena: "🌙" };
/** lo que acompaña (no cuenta como repetir el plato) */
const SIDES = new Set(["lechuga", "tomate", "palta", "zanahoria", "pepino", "ensalada_mixta"]);
/** la familia de un alimento: el yogur natural, el griego y el descremado son «yogur» (para no repetir en el día) */
const fam = (id: string) => id.replace(/_(natural|griego|descremad\w*|entera?|cocid[oa]|blanco|integral|molde\w*|plancha|light)$/, "");
const SLOT_NAME = (s: string) => { const n = MEAL_NAME[s] ?? s; return n[0].toUpperCase() + n.slice(1); };

// ─── «Otro»: la nota, por código ──────────────────────────────────────────────
export function parseNota(nota: string | null | undefined): { ajustes: Ajustes; leida: boolean } {
  const t = fold(nota ?? "");
  const a: Ajustes = {};
  if (!t.trim()) return { ajustes: a, leida: false };
  const afuera = /\b(almuerz\w*|como|comere|comer|desayun\w*|ceno|cenare|cena|once|tomo once)\b[^.]{0,30}\b(afuera|fuera|en la calle|en el trabajo|en la pega|en la oficina|en un restaurant\w*|con (amigos|amigas|la familia|mi familia|la pega|el equipo|mi polola|mi pololo|mi pareja))\b/.exec(t);
  if (afuera) {
    const w = afuera[1];
    a.afuera = [/^desayun/.test(w) ? "desayuno" : /^(cen|cena)/.test(w) ? "cena" : /once/.test(w) ? "once" : "almuerzo"];
  }
  if (/\b(sin (plata|lucas|dinero|un peso|money)|no tengo (plata|lucas|dinero|un peso)|estoy pato|ando pato|corto de plata|apretad\w* (de plata|con la plata)|hasta que me paguen)\b/.test(t)) a.sinPlata = true;
  if (/\b(enferm\w*|resfri\w*|gripe|fiebre|me siento mal|covid|con tos|engripad\w*|vomit\w*|diarrea)\b/.test(t)) a.enfermo = true;
  const dolor = /\b(?:me duele|me molesta|lesion\w* en|me torci|me lesione|esguince en|tendinitis en)\s+(?:el |la |los |las |mi |mis )?(\w+)/.exec(t);
  if (dolor) a.dolor = dolor[1];
  else if (/\b(lesion\w*|esguince|tendinitis|desgarro)\b/.test(t)) a.dolor = "la zona lesionada";
  if (/\b(sin tiempo|no tengo tiempo|poco tiempo|apurad\w*|full pega|dia (pesado|largo|full|eterno)|a full)\b/.test(t)) a.sinTiempo = true;
  const ev = /\b(cumple\w*|carrete|fiesta|asado|matrimonio|salida|junta|cena (con|de) \w+|celebracion|aniversario)\b/.exec(t);
  if (ev) {
    const h = /\ba las (\d{1,2})(?::(\d{2}))?\b/.exec(t);
    const hora = h ? (Number(h[1]) < 12 ? Number(h[1]) + 12 : Number(h[1])) + (h[2] ? Number(h[2]) / 60 : 0) : /\b(noche|tarde)\b/.test(t) || !/\b(almuerzo|mediodia)\b/.test(t) ? 21 : 13.5;
    a.evento = { que: ev[1].replace(/^cumple\w*/, "cumpleaños"), hora };
  }
  return { ajustes: a, leida: Object.keys(a).length > 0 };
}

// ─── ⚡ Modo Rendimiento (R0, 2026-10-29): el día exigente ─────────────────────
//
// Pedido del usuario: «a pesar de que las condiciones no sean las óptimas, la persona necesita rendir al máximo ese día, es
// un día sacrificado… no buscará que descanse, sino que hackeará el sistema biológico basado en todo lo que conoce sobre ti».
// Por código y con respaldo: la curva de alerta estimada (sleepCore.alertCurve), luz al empezar, café antes del mejor rato
// (McLellan 2016), siesta-café en el bajón (Reyner & Horne 1997; Hayashi 2003), lo secuencial en el mejor rato y lo lateral
// fuera de él y caminando (Wieth & Zacks 2011; Oppezzo & Schwartz 2014), pausas cortas que mueven (Chang 2012), suspiro
// cíclico con estrés (Balban 2023), almuerzo moderado y la cama a su hora. Resguardos: café en tazas con tope (EFSA 2015:
// ~400 mg/día ≈ 4 tazas) y menos o nada según su condición; nunca pastillas ni energéticas con alcohol; no manejar con sueño.

/** «estoy estresado y tengo que concentrarme», «estrés 4, foco 2, detalle», «tengo que pensar la estrategia» */
export function parseMente(text: string | null | undefined): Mente | null {
  const t = fold(text ?? "");
  if (!t.trim()) return null;
  const m: Mente = {};
  const en = /\bestres\w*\s*(?:de |en |:|=)?\s*([1-5])\b/.exec(t);
  if (en) m.estres = Number(en[1]);
  else if (/\bestres\w* (alto|alta|a full|al maximo)\b|\b(muy estresad\w*|colapsad\w*|reventad\w*|al limite|en panico)\b/.test(t)) m.estres = 5;
  else if (/\b(estresad\w*|con estres|ansios\w*|con ansiedad|angustiad\w*|agobiad\w*|nervios\w*|tens[oa]|presionad\w*)\b/.test(t)) m.estres = 4;
  else if (/\bestres\w* (bajo|baja|poco)\b|\b(tranquil\w*|relajad\w*|sin estres|calmad\w*)\b/.test(t)) m.estres = 2;
  const fn = /\b(?:foco|concentracion)\s*(?:de |en |:|=)?\s*([1-5])\b/.exec(t);
  if (fn) m.foco = Number(fn[1]);
  else if (/\b(?:foco|concentracion) (bajo|baja|malo|mala|poco)\b|\b(no me puedo concentrar|no logro concentrarme|me cuesta concentrarme|dispers[oa]|desconcentrad\w*|en las nubes|no me da la cabeza|cabeza (en otra|frita|quemada)|niebla mental|embotad\w*)\b/.test(t)) m.foco = 2;
  else if (/\b(?:foco|concentracion) (alto|alta|bueno|buena)\b|\b(estoy (enfocad\w*|concentrad\w*)|con foco)\b/.test(t)) m.foco = 4;
  const ideas = /\b(ideas|idear|creativ\w*|estrategi\w*|lluvia de ideas|brainstorm\w*|disenar|diseno|planificar|pensar en grande|innovar|panorama|vision|lateral)\b/.test(t);
  const detalle = /\b(detalle\w*|ordenar|examen|prueba|estudiar|revisar|planilla\w*|contab\w*|programar|codigo|redactar|informe|papeleo|tramite\w*|concentrarme|enfocarme|numeros|cuadrar|secuencial)\b/.test(t);
  if (/\b(de todo|un poco de todo|mixto|reuniones)\b/.test(t) || (ideas && detalle)) m.tipo = "todo";
  else if (ideas) m.tipo = "ideas";
  else if (detalle) m.tipo = "detalle";
  return Object.keys(m).length ? m : null;
}

/** El tope de café de hoy, en tazas (~80–100 mg cada una): 4, menos con estrés alto o si ya van muchos días; 2 o 0 según su condición */
export function cafeTope(i: DayPlanInput, mente: Mente | null, conservador: boolean): { max: number; por: string | null; consulta: boolean } {
  const txt = fold([...(i.conds ?? []), i.condText ?? ""].join(" "));
  if (/\b(embarazo|embarazada|pregnan\w*)\b/.test(txt)) return { max: 0, por: "el embarazo", consulta: true };
  let max = 4, por: string | null = null, consulta = false;
  if (/\b(hypertension|hipertens\w*|heart_failure|insuficiencia cardiaca|arritmi\w*|taquicardi\w*|palpitacion\w*|fibrilacion)\b/.test(txt)) {
    max = 2; consulta = true;
    por = /arritmi|taquicardi|palpitacion|fibrilacion|heart_failure|insuficiencia/.test(txt) ? "tu corazón" : "la presión";
  } else if (/\b(anxiety|ansiedad|panico)\b/.test(txt)) { max = 2; por = "la ansiedad"; consulta = true; }
  else if (/\b(reflujo|gastritis|ulcera|lactancia|amamant\w*)\b/.test(txt)) { max = 2; por = /lactan|amamant/.test(txt) ? "la lactancia" : "el estómago"; consulta = /lactan|amamant/.test(txt); }
  if ((mente?.estres ?? 0) >= 4 && max > 1) { max -= 1; por = por ?? "el estrés"; }
  // R2: con el pulso en reposo alto (≥ +5 sobre su promedio), una taza menos: la cafeína lo acelera más
  if (i.pulso?.alto && max > 1) { max -= 1; por = por ?? "tu pulso en reposo alto"; }
  if (conservador && max > 1) max -= 1;
  return { max, por, consulta };
}

const RESPIRA = "Dos inhalaciones por la nariz (una larga y otra cortita para llenar) y una exhalación lenta por la boca, durante 5 min: baja la tensión sin darte sueño.";
const tazas = (n: number) => `${n} taza${n === 1 ? "" : "s"}`;

/** Los pasos del día exigente (mente, café, luz, pausas, sueño) con su curva estimada */
function rendimientoPasos(i: DayPlanInput, mente: Mente | null): { pasos: PlanStep[]; curva: AlertCurve; tazas: { max: number; llevas: number }; notas: string[] } {
  const ins = i.sleep ?? i.sleepAny ?? null;
  const wake = i.wakeH ?? ins?.usualWakeH ?? 7.5;
  const c = alertCurve(ins, i.lastSleep ?? null, wake, { naps: i.naps ?? [] });
  // La cama y el último café, en la misma escala que la curva (pasada la medianoche = más de 24)
  let bed = ins ? ins.bedtime.from : c.bed - 0.5, cafeHasta = ins ? ins.caffeineUntil : c.bed - 6;
  while (bed <= wake + 8) { bed += 24; cafeHasta += 24; }
  let nowH = i.now.getHours() + i.now.getMinutes() / 60;
  if (nowH < wake - 2 && nowH + 24 - wake < 22) nowH += 24;
  const q = (h: number) => Math.round(h * 4) / 4;
  const ahora = q(nowH);
  const desde = (h: number) => q(Math.max(h, ahora));
  const cue = (k: Cue, minutes?: number): PlanAction => ({ type: "cue", cue: k, ...(minutes ? { minutes } : {}) });
  const uses = i.usesRendimiento7d ?? 0;
  const conservador = uses >= 3;
  const tope = cafeTope(i, mente, conservador);
  const llevas = i.cafeHoy ?? 0;
  let quedan = Math.max(0, tope.max - llevas);
  const tipo: TipoDia = mente?.tipo ?? "todo";
  // Tenso: lo dijo en el check-in, o no lo dijo y su pulso en reposo viene alto (R2: la señal del cuerpo)
  const pulsoAlto = !!i.pulso?.alto;
  const estresAlto = (mente?.estres ?? 0) >= 4 || (pulsoAlto && mente?.estres == null), focoBajo = mente?.foco != null && mente.foco <= 2;
  const pasos: PlanStep[] = [];
  const notas: string[] = [];
  const cafes: number[] = [];

  // Luz: al empezar el día (la luz de la mañana despierta y además ordena el reloj para dormir esta noche)
  if (nowH < wake + 4) pasos.push({ id: "mente-luz", modulo: "mente", hora: desde(wake + 0.25), titulo: "☀️ Luz de día, 10 min",
    detalle: "Afuera o junto a la ventana, apenas puedas: la luz despierta más rápido que el café y te ayuda a dormir esta noche. Donde trabajes, la luz más fuerte que tengas.", accion: cue("luz", 10) });

  // Café 1: ~30 min antes del mejor rato (hace efecto a los 20–45 min)
  const c1 = q(Math.max(wake + 0.75, c.foco[0] - 0.5));
  if (quedan > 0 && c1 >= nowH - 0.5 && c1 <= cafeHasta) {
    cafes.push(c1); quedan--;
    pasos.push({ id: "mente-cafe1", modulo: "mente", hora: desde(c1), titulo: "☕ Café (1 taza)",
      detalle: `Unos 30 min antes de tu mejor rato: hace efecto a los 20–45 min. Hoy, hasta ${tazas(tope.max)}${llevas ? ` (llevas ${llevas})` : ""}.`, accion: cue("cafe") });
  }

  // El mejor rato: lo secuencial (detalle, orden, mirada lineal); con «ideas», lo que pide cabeza fría (decidir, ordenar)
  if (nowH < c.foco[1] - 0.25) {
    const h = desde(c.foco[0]);
    if (estresAlto) pasos.push({ id: "mente-respira1", modulo: "mente", hora: q(Math.max(ahora, h - 0.25)), titulo: "🫁 Suspiro cíclico, 5 min", detalle: RESPIRA, accion: cue("respira", 5) });
    const como = focoBajo ? "En tandas de 25 min con 5 de pausa (cuesta menos arrancar)" : "Unos 90 min";
    pasos.push({ id: "mente-bloque1", modulo: "mente", hora: h, titulo: tipo === "ideas" ? "🎯 Tu mejor rato: decidir y ordenar" : "🎯 Tu mejor rato: lo de detalle",
      detalle: tipo === "ideas"
        ? `Lo que pide cabeza fría: decidir, ordenar, escribir lo que vas a presentar. ${como}, una sola tarea y el teléfono lejos.`
        : `Lo que pide orden y detalle, paso a paso, y lo más difícil primero. ${como}, una sola tarea, sin notificaciones y el teléfono lejos.`,
      accion: cue("bloque", focoBajo ? 25 : 90) });
  }

  // El bajón: siesta-café (el café justo antes de dormir 15–20 min: despierta cuando hace efecto), si cabe antes del último café
  // y no tan tarde que quite la noche; si no, siesta sola o 10 min afuera
  const [b0, b1] = c.bajon;
  const siestaOk = b0 <= bed - 7 && (!conservador || b0 <= 15);
  const trasAlmuerzo = i.diabetic ? " Antes, 10 min caminando después de almorzar: con poco sueño el azúcar sube más." : "";
  // el bajón es después de almorzar: si el almuerzo cae en él, la siesta va media hora después
  const alm = i.slots.find((s) => s.slot === "almuerzo")?.hora;
  if (nowH < b1 - 0.25) {
    const h = desde(alm != null && alm >= b0 - 1.5 && alm < b1 ? Math.max(b0, alm + 0.5) : b0);
    if (siestaOk && quedan > 0 && h <= cafeHasta) {
      cafes.push(h); quedan--;
      pasos.push({ id: "mente-bajon", modulo: "mente", hora: h, titulo: "☕😴 Siesta-café, 20 min",
        detalle: "Un café rápido y enseguida 15–20 min acostado o con la cabeza apoyada, con alarma: despiertas justo cuando la cafeína hace efecto. Si no puedes acostarte, 10 min con los ojos cerrados igual sirven." + trasAlmuerzo,
        accion: cue("siesta_cafe", 20) });
    } else if (siestaOk) {
      pasos.push({ id: "mente-bajon", modulo: "mente", hora: h, titulo: "😴 Siesta de 15–20 min",
        detalle: "Con alarma: más larga deja pesado y quita sueño en la noche. Si no puedes acostarte, 10 min con los ojos cerrados." + trasAlmuerzo, accion: cue("siesta", 20) });
    } else {
      pasos.push({ id: "mente-bajon", modulo: "mente", hora: h, titulo: "🚶 Tu bajón: 10 min afuera",
        detalle: "Caminar con luz de día y un vaso de agua fría: lo que mejor saca del bajón." + trasAlmuerzo, accion: cue("pausa", 10) });
    }
  }

  // Lo lateral (ideas, estrategia, mirada panorámica) rinde fuera del mejor rato, y caminando
  if (tipo === "ideas" && nowH < b1 + 1) pasos.push({ id: "mente-ideas", modulo: "mente", hora: desde(b1), titulo: "💡 Ideas caminando, 30–45 min",
    detalle: "Lo de ideas y estrategia sale mejor fuera de tu mejor rato y caminando: sal con el problema en la cabeza y anota lo que salga, sin juzgarlo todavía.", accion: cue("ideas", 40) });
  const sa = c.segundoAire;
  // Si entrena en el segundo aire, el bloque va después del entreno (o antes, si después ya no queda); si no cabe, el
  // entreno es lo del segundo aire
  const tH = i.training && !i.training.rest && i.training.items.length > 0 && i.training.doneSets === 0 && i.intent?.answer === "si" ? trainHour(i) : null;
  let h2: number | null = sa ? desde(sa[0]) : null;
  if (sa && h2 != null && tH != null && h2 < tH + 1 && h2 + 1 > tH) {
    h2 = tH + 1 <= sa[1] - 0.5 ? q(tH + 1) : tH - 1 >= Math.max(nowH, sa[0] - 0.75) ? q(tH - 1) : tH + 1 <= c.bed - 2.5 ? q(tH + 1) : null;
  }
  if (sa && h2 != null && nowH < sa[1] - 0.25) {
    const h = h2;
    if (estresAlto) pasos.push({ id: "mente-respira2", modulo: "mente", hora: q(Math.max(ahora, h - 0.25)), titulo: "🫁 Suspiro cíclico, 5 min", detalle: RESPIRA, accion: cue("respira", 5) });
    pasos.push({ id: "mente-bloque2", modulo: "mente", hora: h,
      titulo: tipo === "detalle" ? "🎯 Segundo aire: otro bloque de detalle" : tipo === "ideas" ? "🔭 Segundo aire: el panorama completo" : "💡 Segundo aire: ideas y estrategia",
      detalle: tipo === "detalle" ? "Unos 60 min para lo que quedó de detalle; lo más mecánico, al final."
        : tipo === "ideas" ? "Junta lo que salió y mira el mapa completo antes que el detalle. Termina con los 3 próximos pasos escritos."
        : "Unos 60 min para lo que pide ideas: estrategia, planear, ver el panorama completo. Mejor de pie o caminando; anota lo que salga.",
      accion: cue(tipo === "detalle" ? "bloque" : "ideas", 60) });
  } else if (!sa && tipo !== "ideas" && nowH < b1 + 1.5) {
    pasos.push({ id: "mente-bloque2", modulo: "mente", hora: desde(b1 + 0.25), titulo: "🎯 Después del bajón: un bloque más",
      detalle: "Unos 60 min. Lo de ideas, de pie o caminando; lo mecánico, sentado.", accion: cue("bloque", 60) });
  }

  // Último café: antes del segundo aire y nunca después de su hora límite (protege la noche)
  const ult = q(Math.min(cafeHasta, (sa ? sa[0] : b1 + 0.25) - 0.5));
  if (quedan > 0 && ult >= nowH - 0.25 && (!cafes.length || ult - cafes[cafes.length - 1] >= 2)) {
    quedan--;
    pasos.push({ id: "mente-cafe2", modulo: "mente", hora: desde(ult), titulo: `☕ Último café (hasta las ${hhmmOf(cafeHasta)})`,
      detalle: "Después de esa hora te quita sueño esta noche, aunque no lo sientas.", accion: cue("cafe") });
  }

  // Todo el día
  pasos.push({ id: "mente-pausas", modulo: "mente", hora: null, titulo: "🚶 Cada 60–90 min: pausa y agua",
    detalle: "5 min caminando o mirando lejos por la ventana (la cabeza descansa y vuelves con más foco) y un vaso de agua. La pausa, sin pantallas.", accion: cue("pausa", 5) });
  if (!estresAlto) pasos.push({ id: "mente-respira", modulo: "mente", hora: null, titulo: "🫁 Si te tensas: suspiro cíclico", detalle: RESPIRA, accion: cue("respira", 5) });
  if (c.nivel !== "bueno") pasos.push({ id: "mente-seguridad", modulo: "mente", hora: null, titulo: "🚗 Si se te cierran los ojos, no manejes",
    detalle: "Para y duerme 15 min. Nada de energéticas con alcohol ni pastillas para mantenerte despierto.", accion: cue("seguridad") });
  if (tope.max === 0) pasos.push({ id: "mente-sincafe", modulo: "mente", hora: null, titulo: "☕ Hoy sin café",
    detalle: `Por ${tope.por}, mejor rendir sin cafeína: la luz, el agua fría y moverte hacen el trabajo. Si tienes dudas, consúltalo con tu médico o matrona.`, accion: { type: "info" } });
  else if (tope.consulta) notas.push(`Café: hasta ${tazas(tope.max)} por ${tope.por}. Si te da palpitaciones, nervios o te sube la presión, para y consúltalo con tu médico.`);

  // La noche: a la cama al inicio de su ventana; mañana, a recuperar
  pasos.push({ id: "sueno", modulo: "sueno", hora: q(bed), titulo: `😴 A la cama a las ${hhmmOf(bed)}`,
    detalle: `Café hasta las ${hhmmOf(cafeHasta)}. Hoy rendiste: esta noche se recupera, y mañana te sugiero Óptimo.`, accion: { type: "info" } });

  if (pulsoAlto) {
    // lo que de verdad cambió por el pulso (con el tope ya en 1 o sin café, no hay «un café menos»)
    const menosCafe = tope.max < cafeTope({ ...i, pulso: null }, mente, conservador).max;
    const hoy = [menosCafe ? "un café menos" : "", estresAlto ? "respiración antes de lo importante" : ""].filter(Boolean).join(" y ");
    notas.push(`Tu pulso en reposo viene más alto que tu promedio (${i.pulso!.hoy} vs ${i.pulso!.base}): puede ser estrés, cansancio o algo que empieza.${hoy ? ` Hoy, ${hoy}.` : ""} Si te sientes decaído o con fiebre, mejor Óptimo y descansar.`);
  }
  const despues = despuesTxt(i.despues ?? null);
  if (despues) notas.push(`${despues}${/dormiste más/.test(despues) ? " Esta noche, deja ese espacio para dormir." : /dormiste menos/.test(despues) ? " Esta noche, a la cama a la hora aunque quede algo pendiente." : ""}`);
  if (conservador) notas.push(`Es el ${uses + 1}.º día exigente de la semana: lo armé más suave (menos café${c.bajon[0] > 15 ? " y sin siesta-café tan tarde" : ""}). El cuerpo pasa la cuenta: mañana, Óptimo.`);
  else if (uses === 2) notas.push("Esta semana ya van 3 días exigentes: mañana toca recuperar (Óptimo).");
  if (!mente) notas.push("Si me cuentas cómo estás (estrés y foco, del 1 al 5) y qué pide tu día (detalle, ideas o de todo), lo afino.");
  return { pasos, curva: c, tazas: { max: tope.max, llevas }, notas };
}

// ─── El plan ──────────────────────────────────────────────────────────────────

/** Las kcal del día según el camino (siempre dentro de lo seguro) */
export function dayKcal(i: DayPlanInput, mode: PlanMode): { kcal: number; gusto: number } {
  const base = i.targets.kcal;
  if (mode === "estricto") {
    // Un poco más exigente solo si el objetivo es bajar (nunca más de 150 kcal ni con diabetes: no cambiar lo que su tratamiento espera)
    const cut = (i.targets.goal === "perder" || i.targets.goal === "recomp") && !i.diabetic ? Math.min(150, Math.round(base * 0.05)) : 0;
    return { kcal: Math.max(Math.round(base * 0.9), base - cut), gusto: 0 };
  }
  if (mode === "flexible") return { kcal: base, gusto: 200 };
  return { kcal: base, gusto: 0 };
}

/** Las comidas que entran en el plan según el camino: las 3 de siempre, y las colaciones si hacen falta */
export function planSlots(i: DayPlanInput, mode: PlanMode): Array<{ slot: string; hora: number }> {
  const has = (s: string) => i.slots.some((x) => x.slot === s);
  const h = (s: string) => i.slots.find((x) => x.slot === s)?.hora;
  return i.slots.filter((x) => {
    // la de media mañana: solo con diabetes, y no si el desayuno todavía no se hace (desayuno tarde)
    if (x.slot === "colacion_am") return i.diabetic && !has("desayuno");
    if (x.slot === "colacion_pm") {
      if (mode !== "estricto" || i.diabetic) return true;
      const al = h("almuerzo"), din = h("once") ?? h("cena");
      return al != null && din != null && din - al >= 5;
    }
    // la once y la cena: una de las dos (la que use), salvo que tenga las dos en su día
    if (x.slot === "once" && has("cena") && !i.allSlots.includes("once")) return false;
    return true;
  });
}

function momentFor(slot: string, hora: number, train: number | null): { moment: Moment; minutes?: number } {
  if (slot.startsWith("colacion")) {
    if (train != null && train - hora >= 0.5 && train - hora <= 1.5) return { moment: "pre_entreno", minutes: Math.round((train - hora) * 60) };
    return { moment: "colacion" };
  }
  if (train != null && hora - train >= 0.75 && hora - train <= 3) return { moment: "post_entreno" };
  if (train != null && train - hora >= 1 && train - hora <= 2.5) return { moment: "pre_entreno", minutes: Math.round((train - hora) * 60) };
  return { moment: "comida" };
}

const FIBER = new Map(FOODS.map((f) => [f.id, f.fiber / Math.max(1, f.grams)]));
const toFoods = (p: Plate): PlanFood[] => p.components.map((c) => ({ id: c.id, name: c.name, grams: c.grams, portionText: c.portionText, kcal: c.kcal, protein: c.protein, carbs: c.carbs, fat: c.fat,
  fiber: Math.round((FIBER.get(c.id) ?? 0) * c.grams * 10) / 10 }));
export const plateText = (foods: PlanFood[]) => {
  const k = foods.reduce((a, f) => a + f.kcal, 0), p = Math.round(foods.reduce((a, f) => a + f.protein, 0));
  return `${foods.map((f) => `${corto(f.name)} (${f.portionText})`).join(" + ")} · ~${fmtK(k)} kcal${p >= 5 ? `, ${p} g de proteína` : ""}`;
};
const trainHour = (i: DayPlanInput) => { const t = i.intent?.time?.split(":").map(Number); return t && Number.isFinite(t[0]) ? t[0] + (t[1] || 0) / 60 : null; };

/** `forced`: lo que el modelo entendió de la nota cuando el código no pudo (T3); manda sobre `parseNota` */
export function buildDayPlan(i: DayPlanInput, mode: PlanMode, nota?: string | null, forced?: Ajustes | null, menteIn?: Mente | null): DayPlan {
  const parsed = parseNota(nota);
  const ajustes: Ajustes = forced && Object.keys(forced).length ? { ...parsed.ajustes, ...forced } : parsed.ajustes;
  // Modo Rendimiento: el check-in (de la app o de lo que contó)
  const mente = mode === "rendimiento" ? (menteIn ?? parseMente(nota)) : null;
  const leida = parsed.leida || !!(forced && Object.keys(forced).length) || !!(mente && nota && parseMente(nota));
  const pasos: PlanStep[] = [];
  const avisos: string[] = [];
  const dk = dayKcal(i, mode);
  // «voy a comer más / menos»: hasta +500 o −300, y nunca bajo el 90 % de su meta
  const extra = ajustes.kcalExtra ? Math.max(-300, Math.min(500, Math.round(ajustes.kcalExtra))) : 0;
  const kcalDia = Math.max(Math.round(i.targets.kcal * 0.9), dk.kcal + extra), gusto = dk.gusto;
  const train = trainHour(i);

  // ── Comida: lo que falta del día repartido entre las comidas que quedan
  const eaten = i.ctx.eaten;
  const gustoK = gusto && !ajustes.enfermo ? gusto : 0;
  const restK = Math.max(0, kcalDia - eaten.kcal);
  const protTotal = i.renal ? null : mode === "estricto" && i.targets.proteinMax ? Math.min(i.targets.proteinMax, Math.round((i.targets.proteinG ?? 0) * 1.1)) : i.targets.proteinG;
  const restP = protTotal != null ? Math.max(0, protTotal - eaten.protein) : null;
  const slots = planSlots(i, mode);
  // Rendimiento: almuerzo moderado (uno grande agranda el bajón) y una colación con proteína para la tarde
  const SH: Record<string, number> = mode === "rendimiento" ? { ...SHARE, almuerzo: 0.28, colacion_pm: 0.15 } : SHARE;
  const shareSum = slots.reduce((a, s) => a + (SH[s.slot] ?? 0.2), 0) || 1;
  // Sin plata: solo con lo que hay en casa; si no hay nada, lo más económico
  const tier: 1 | 2 | 3 = ajustes.sinPlata ? 1 : (i.ctx.budget?.tier ?? 2);
  const used = new Set<string>();
  let afueraK = 0; // lo que le toca a lo que come afuera o en el evento (no se arma plato)
  for (const s of slots) {
    const share = (SH[s.slot] ?? 0.2) / shareSum;
    const k = Math.round(restK * share), p = restP != null ? Math.round(restP * share) : null;
    const id = `comida-${s.slot}`;
    const titulo = `${EMOJI[s.slot] ?? "🍽️"} ${SLOT_NAME(s.slot)}`;
    // El evento va en la comida de su hora: de noche la cena (o la once); al mediodía el almuerzo («asado al mediodía»)
    const evHora = ajustes.evento ? ajustes.evento.hora ?? 21 : null;
    const enEvento = evHora != null && ((evHora >= 18 && (s.slot === "cena" || s.slot === "once")) || (evHora >= 11 && evHora < 17 && s.slot === "almuerzo"));
    if (ajustes.afuera?.includes(s.slot) || enEvento) {
      const ev = ajustes.evento && !ajustes.afuera?.includes(s.slot) ? ajustes.evento : null;
      afueraK += k;
      pasos.push({ id, modulo: "comida", hora: ev?.hora ?? s.hora, titulo: ev ? `🎉 ${ev.que[0].toUpperCase()}${ev.que.slice(1)}` : `${titulo} afuera`,
        detalle: `Te tocan ~${fmtK(k)} kcal: ${ev ? "parte por la proteína y la verdura, y lo dulce al final" : "elige proteína con verdura, y poco frito"}${mode === "estricto" ? "; agua o bebida sin azúcar" : ""}.${ev && mode !== "estricto" ? " Disfrútalo: es parte del plan." : ""}`,
        accion: { type: "info" } });
      continue;
    }
    if (k < 80) continue; // ya cubrió el día
    const m = momentFor(s.slot, s.hora, train);
    const home = i.pantry && i.pantry.frags.length ? i.pantry : null;
    const rec = recommendMeals({
      ctx: i.ctx, analysis: i.analysis, moment: m.moment, minutesToWorkout: m.minutes, affinity: i.affinity, limit: 3,
      slotTarget: { kcal: k, protein: p }, noCook: !!ajustes.sinTiempo, preferProtein: (mode === "estricto" && p != null && p >= 30) || (mode === "rendimiento" && s.slot === "colacion_pm"),
      breakfast: s.slot === "desayuno" || s.slot === "once",
      ...(home ? { pantry: home.frags, prefer: home.pronto, fromInventory: "inventario" } : { tierCap: tier }),
    });
    // Que no se repita lo mismo en dos comidas del día
    const repite = (pl: Plate) => pl.components.filter((c) => used.has(fam(c.id))).length;
    const all = rec.plates.map((pl, k) => ({ pl, k })).sort((a, b) => repite(a.pl) - repite(b.pl) || a.k - b.k).map((x) => toFoods(x.pl));
    if (!all.length) {
      pasos.push({ id, modulo: "comida", hora: s.hora, titulo, detalle: `~${fmtK(k)} kcal${p ? ` con ~${p} g de proteína` : ""}: con lo que tengo de tu casa no alcanzo a armar un plato; cuéntame qué tienes.`, accion: { type: "info" } });
      continue;
    }
    for (const f of all[0]) if (!SIDES.has(f.id)) used.add(fam(f.id));
    for (const w of rec.plates[0]?.warnings ?? []) if (!avisos.includes(w)) avisos.push(w);
    pasos.push({ id, modulo: "comida", hora: s.hora, titulo, detalle: plateText(all[0]), accion: { type: "log_food", slot: s.slot, opciones: all, alt: 0 } });
  }
  // Si con los platos el día queda corto (con diabetes los carbohidratos por comida tienen tope), algo para completarlo
  const planK = eaten.kcal + pasos.reduce((a, p) => a + (p.accion.type === "log_food" ? p.accion.opciones[0].reduce((x, y) => x + y.kcal, 0) : 0), 0);
  const falta = kcalDia - planK - afueraK;
  if (falta >= 300 && pasos.some((p) => p.accion.type === "log_food")) {
    const libre = ["colacion_pm", "colacion_am"].find((sl) => !pasos.some((p) => p.id === `comida-${sl}`)) ?? "colacion_pm";
    const home = i.pantry && i.pantry.frags.length ? i.pantry : null;
    // ¿Cuándo? En el hueco más largo entre comidas; si cae cerca del entreno, es lo de antes de entrenar (1 h 15 antes)
    const horas = pasos.filter((p) => p.modulo === "comida" && p.hora != null).map((p) => p.hora!).sort((a, b) => a - b);
    let hueco: number | null = null, mayor = 0;
    for (let k = 1; k < horas.length; k++) if (horas[k] - horas[k - 1] > mayor) { mayor = horas[k] - horas[k - 1]; hueco = Math.round(((horas[k] + horas[k - 1]) / 2) * 4) / 4; }
    if (mayor < 3) hueco = null;
    // (en Flexible, con mal sueño o sin tiempo, el entreno es una caminata: no hace falta comer antes)
    const caminata = mode === "flexible" && ((i.ready?.level ?? "normal") !== "normal" || !!ajustes.sinTiempo);
    const trains = !!i.training && !i.training.rest && i.training.items.length > 0 && i.training.doneSets === 0 && i.intent?.answer !== "no" && !ajustes.enfermo && !caminata;
    const pre = trains && train != null && hueco != null && Math.abs(hueco - train) <= 1.5 && !horas.some((h) => train - h >= 0.75 && train - h < 2);
    // si no es lo de antes de entrenar, tampoco justo encima del entreno
    const hora = pre ? Math.round((train! - 1.25) * 4) / 4 : train != null && hueco != null && Math.abs(hueco - train) < 1 ? null : hueco;
    const rec = recommendMeals({ ctx: i.ctx, analysis: i.analysis, moment: pre ? "pre_entreno" : "colacion", ...(pre ? { minutesToWorkout: 75 } : {}),
      affinity: i.affinity, limit: 3, slotTarget: { kcal: Math.min(falta, pre ? 350 : 450) },
      ...(home ? { pantry: home.frags, prefer: home.pronto } : { tierCap: tier }) });
    const ops = rec.plates.map(toFoods).sort((a, b) => a.filter((f) => used.has(fam(f.id))).length - b.filter((f) => used.has(fam(f.id))).length);
    if (ops.length) pasos.push({ id: "comida-extra", modulo: "comida", hora, titulo: pre ? "⚡ Antes de entrenar" : "➕ Para completar tu día", detalle: plateText(ops[0]), accion: { type: "log_food", slot: libre, opciones: ops, alt: 0 } });
  }
  // Sin comidas que armar (ya comió todo o ya llegó a su meta): se dice, no se calla
  const notas: string[] = [];
  if (!pasos.some((p) => p.modulo === "comida")) {
    const llegó = eaten.kcal >= kcalDia * 0.9;
    pasos.push({ id: "comida-dia", modulo: "comida", hora: null, titulo: "🍽️ Comida",
      detalle: llegó ? `Ya llegaste a tu meta de hoy (${fmtK(eaten.kcal)} de ${fmtK(kcalDia)} kcal). Si te da hambre, algo liviano: fruta o un yogur.`
        : `Tus comidas de hoy ya están anotadas; te quedan ~${fmtK(Math.max(0, kcalDia - eaten.kcal))} kcal para lo que te acomode, con proteína primero.`,
      accion: { type: "info" } });
  }
  for (const sl of ajustes.afuera ?? []) if (!slots.some((x) => x.slot === sl)) notas.push(`${SLOT_NAME(sl)}: ${/^(almuerzo|desayuno)$/.test(sl) ? "el" : "la"} de hoy ya está anotad${/^(almuerzo|desayuno)$/.test(sl) ? "o" : "a"}, así que no lo cambié.`);
  if (gustoK) {
    const contra = i.targets.goal === "perder" || i.targets.goal === "recomp";
    pasos.push({ id: "gusto", modulo: "comida", hora: null, titulo: "🍫 Un gusto",
      detalle: `~${gustoK} kcal de lo que quieras (2 cuadritos de chocolate, un helado chico, una galleta)${contra ? "; la contrapartida: 15 min de caminata" : ""}. Sin culpa: está en el plan.`,
      accion: { type: "info" } });
  }

  // ── Entreno
  // «Así manejo tu entreno»: apagado el ajuste según el sueño, la rutina va tal cual
  const lvl = i.prefs?.segunSueno === false ? "normal" : (i.ready?.level ?? "normal");
  const zona = ajustes.dolor ? ` Nada que cargue ${/^la /.test(ajustes.dolor) ? ajustes.dolor : `la ${ajustes.dolor}`}; si duele al apoyar o se hincha, cuéntame «me duele…» y lo vemos.` : "";
  const tr = i.training;
  if (ajustes.enfermo) {
    pasos.push({ id: "entreno", modulo: "entreno", hora: null, titulo: "🛌 Hoy descanso", detalle: "Enfermo, el cuerpo se recupera descansando: agua, comida simple y a dormir temprano. Si tienes fiebre alta o no mejoras, consulta.", accion: { type: "rest" } });
  } else if (ajustes.sinEntreno) {
    pasos.push({ id: "entreno", modulo: "entreno", hora: null, titulo: "🛌 Hoy sin entreno", detalle: "Lo pediste: hoy descansas. Si te sobran ganas, una caminata suave.", accion: { type: "rest" } });
  } else if (i.intent?.answer === "no") {
    pasos.push({ id: "entreno", modulo: "entreno", hora: null, titulo: "🛌 Descanso", detalle: "Dijiste que hoy descansas: el descanso también suma.", accion: { type: "rest" } });
  } else if (tr && tr.doneSets > 0) {
    pasos.push({ id: "entreno", modulo: "entreno", hora: null, titulo: "✅ Ya entrenaste", detalle: `Llevas ${tr.doneSets} series hoy. Lo que sigue es recuperar: proteína y dormir bien.`, accion: { type: "info" } });
  } else if (tr && !tr.rest && tr.items.length) {
    const nombre = (tr.name ?? "Tu rutina").replace(/^\s*d[ií]a\s*\w+\s*[:—–-]\s*/i, "");
    const ej = tr.items.slice(0, 3).map((x) => corto(x.name)).join(", ");
    const sueno = lvl !== "normal" && i.ready ? ` ${i.ready.why} ${i.ready.tip}` : "";
    if (mode === "rendimiento") {
      // Entrenar despierta; con poco sueño, corto y sin cargas pesadas (sube el riesgo de lesión)
      const liv = lvl === "liviano", suave = lvl === "suave" || (lvl === "normal" && !!i.pulso?.alto);
      pasos.push({ id: "entreno", modulo: "entreno", hora: train, titulo: `🏋️ ${nombre}${liv ? " (liviana, 25–30 min)" : suave ? " (versión corta)" : ""}`,
        detalle: `${ej}${tr.items.length > 3 ? "…" : "."} ${liv ? "Moderado y corto: te sube la alerta para la tarde. Sin cargas pesadas ni récords: con poco sueño sube el riesgo de lesión."
          : suave ? `Una serie menos y 2 repeticiones en reserva: que te active, no que te vacíe.${lvl === "normal" ? " Tu pulso en reposo viene alto." : ""}` : "Entrenar te despierta: mejor antes de tu bajón o en el segundo aire, no justo antes de dormir."}${zona}`,
        accion: { type: "load_routine", deload: liv, shorter: liv || suave } });
    } else if (mode === "flexible" && (lvl !== "normal" || ajustes.sinTiempo)) {
      const porque = lvl !== "normal" && i.ready ? ` ${i.ready.why}` : ajustes.sinTiempo ? " Corta, para el tiempo que tienes." : "";
      pasos.push({ id: "entreno", modulo: "entreno", hora: train, titulo: `🚶 Caminata de ${ajustes.sinTiempo ? 20 : 30} min`, detalle: `Hoy, en vez de ${nombre}, una caminata a paso rápido.${porque}${zona}`, accion: { type: "walk", minutes: ajustes.sinTiempo ? 20 : 30 } });
    } else {
      const shorter = mode === "flexible" || !!ajustes.sinTiempo;
      pasos.push({ id: "entreno", modulo: "entreno", hora: train, titulo: `🏋️ ${nombre}${shorter ? " (versión corta)" : ""}`,
        detalle: `${ej}${tr.items.length > 3 ? "…" : "."}${shorter ? " Una serie menos por ejercicio." : mode === "estricto" && lvl === "normal" ? " Completa, como dice tu rutina." : ""}${sueno}${zona}`,
        accion: { type: "load_routine", deload: lvl === "liviano", shorter } });
    }
  } else {
    const walk = mode === "estricto" ? 30 : (mode === "optimo" || mode === "rendimiento") && !tr ? 20 : 0;
    pasos.push(walk
      ? { id: "entreno", modulo: "entreno", hora: train, titulo: `🚶 Caminata de ${walk} min`, detalle: `${tr?.rest ? "Día de descanso en tu rutina: descanso activo." : "Moverse un rato también cuenta."}${zona}`, accion: { type: "walk", minutes: walk } }
      : { id: "entreno", modulo: "entreno", hora: null, titulo: "🛌 Descanso", detalle: tr?.rest ? "Día de descanso en tu rutina." : "Hoy sin entreno.", accion: { type: "rest" } });
  }

  // ── Plata: un tope para hoy (nunca se mueve plata sola); apagado en «Así manejo tu plata», no se pone
  const f = i.finance;
  if (i.prefs?.topeDia === false) { /* sin tope del día */ }
  else if (f && f.porDia != null && f.porDia > 0 && f.libre != null && f.porDia >= f.libre * 0.5) {
    // A uno o dos días del sueldo «por día» es casi toda la plata libre: un tope así no sirve de guía
    pasos.push({ id: "plata", modulo: "plata", hora: null, titulo: "💸 Hoy, solo lo necesario", detalle: "Te pagan pronto: lo que queda libre (" + clp(f.libre) + ") mejor que llegue entero.", accion: { type: "info" } });
  } else if (f && f.porDia != null && f.porDia > 0) {
    const extra = mode === "flexible" && f.libre != null && f.libre > f.porDia * 3 ? Math.min(5000, f.libre * 0.03) : 0;
    const factor = ajustes.sinPlata ? 0.5 : mode === "estricto" ? 0.7 : 1;
    const cap = round500(f.porDia * factor + extra);
    pasos.push({ id: "plata", modulo: "plata", hora: null, titulo: `💸 Hoy, hasta ${clp(cap)}`,
      detalle: mode === "estricto" || ajustes.sinPlata ? "Solo lo esencial; nada de compras grandes." : extra ? "Incluye un gusto chico." : "Lo que puedes gastar por día hasta tu próximo ingreso.",
      accion: { type: "set_cap", clp: cap } });
  } else if (f && f.libre != null && f.libre <= 0) {
    pasos.push({ id: "plata", modulo: "plata", hora: null, titulo: "💸 Hoy, solo lo esencial", detalle: "No queda plata libre hasta tu próximo ingreso.", accion: { type: "info" } });
  }

  // ── Plata (A2): lo anotado y el banco no calzan → cuadrar es corto y deja la plata clara
  if (f?.cuadre) pasos.push({ id: "plata-cuadre", modulo: "plata", hora: null, titulo: `⚖ Cuadra tu ${f.cuadre.nombre} (2 min)`,
    detalle: `Lo anotado y tu banco no calzan por ${clp(Math.abs(f.cuadre.diff))}: te muestro por qué y lo arreglas con un toque.`, accion: { type: "cuadrar" } });

  // ── Casa: lo que vence pronto, primero
  if (i.pantry?.prontoNombres.length) {
    const enMenu = pasos.some((p) => p.accion.type === "log_food" && p.accion.opciones[0].some((x) => i.pantry!.pronto.has(x.id)));
    pasos.push({ id: "casa", modulo: "casa", hora: null, titulo: "🏠 Usa primero", detalle: `${i.pantry.prontoNombres.slice(0, 3).join(", ")} (vence pronto)${enMenu ? ": ya está en tu menú" : ""}.`, accion: { type: "info" } });
  }

  // ── Casa: si el menú no salió de la despensa (no hay o casi no hay nada), lo que falta a la lista de compras
  if (i.hasInventory && !(i.pantry && i.pantry.frags.length)) {
    const faltan = [...new Set(pasos.flatMap((p) => (p.accion.type === "log_food" ? p.accion.opciones[0].map((f) => corto(f.name)) : [])))].slice(0, 8);
    if (faltan.length) pasos.push({ id: "casa-compras", modulo: "casa", hora: null, titulo: "🛒 Para tu menú te falta", detalle: `${faltan.join(", ")}.`, accion: { type: "add_list", items: faltan } });
  }

  // ── Sueño
  const sl = i.sleep;
  if (sl && mode !== "rendimiento") {
    const unaHora = hhmmOf(sl.bedtime.from) === hhmmOf(sl.bedtime.to);
    const cama = mode === "estricto" || (mode === "optimo" && unaHora) ? `a la cama a las ${hhmmOf(sl.bedtime.from)}` : mode === "optimo" ? `a la cama entre las ${hhmmOf(sl.bedtime.from)} y las ${hhmmOf(sl.bedtime.to)}` : `a la cama a más tardar a las ${hhmmOf(sl.bedtime.to + 0.5)}`;
    pasos.push({ id: "sueno", modulo: "sueno", hora: sl.bedtime.from, titulo: `😴 ${cama[0].toUpperCase()}${cama.slice(1)}`, detalle: `Café hasta las ${hhmmOf(sl.caffeineUntil)}.${ajustes.enfermo ? " Hoy, todo lo que puedas dormir." : ""}`, accion: { type: "info" } });
  }

  // ── Rendimiento: la mente (luz, café, bloques, bajón, pausas) y la noche
  const rend = mode === "rendimiento" ? rendimientoPasos(i, mente) : null;
  if (rend) { pasos.push(...rend.pasos); notas.push(...rend.notas); }

  // Orden: lo de todo el día arriba, después la línea de tiempo
  pasos.sort((a, b) => (a.hora == null ? -1 : a.hora) - (b.hora == null ? -1 : b.hora));
  const kcalPlan = Math.round(eaten.kcal + pasos.filter((p) => p.accion.type === "log_food").reduce((a, p) => a + (p.accion as any).opciones[0].reduce((x: number, y: PlanFood) => x + y.kcal, 0), 0) + gustoK);
  const plan: DayPlan = {
    mode, day: i.day, creado: i.now.toISOString(), kcal: Math.round(kcalDia + gustoK), proteinG: protTotal,
    resumen: "", pasos, avisos, ...(notas.length ? { notas } : {}), ...(rend ? { curva: rend.curva, tazas: rend.tazas, ...(mente ? { mente } : {}) } : {}), ...(nota ? { nota } : {}), ...(leida ? { ajustes } : {}), ...(nota && !leida ? { notaSinLeer: true } : {}),
  };
  plan.resumen = resumenDe(plan, kcalPlan);
  return plan;
}

/** «2.350 kcal · Empuje · hasta $7.000 · a la cama 23:45» */
export function resumenDe(p: DayPlan, kcalPlan?: number): string {
  // Revisión I3: de noche mostraba el foco de la mañana («foco 11:45–13:15» a las 19:00): si ya pasó, el segundo aire
  const d = new Date(p.creado), ahoraH = Number.isNaN(d.getTime()) ? null : d.getHours() + d.getMinutes() / 60;
  const pasoFoco = p.curva != null && ahoraH != null && p.curva.foco[1] <= 24 && ahoraH >= p.curva.foco[1];
  const sa = p.curva?.segundoAire;
  const foco = !p.curva ? "" : !pasoFoco ? `foco ${hhmmOf(p.curva.foco[0])}–${hhmmOf(p.curva.foco[1])}`
    : sa && ahoraH! < sa[1] ? `segundo aire ${hhmmOf(sa[0])}–${hhmmOf(sa[1])}` : "tu mejor rato de hoy ya pasó";
  const bits = p.mode === "rendimiento" && p.curva
    // «hasta 4 cafés» a las 19:00 (pasada la hora límite del café) no servía: si el plan ya no trae café, se dice
    ? [foco, p.tazas ? (!p.tazas.max ? "sin café" : !p.pasos.some((x) => /^mente-cafe/.test(x.id) || /Siesta-café/.test(x.titulo)) ? "sin más café hoy" : `hasta ${p.tazas.max} café${p.tazas.max === 1 ? "" : "s"}`) : ""].filter(Boolean)
    : [`${fmtK(p.kcal)} kcal${p.pasos.some((x) => x.id === "gusto") ? " con un gusto" : ""}`];
  const e = p.pasos.find((x) => x.modulo === "entreno");
  if (e) bits.push(e.titulo.replace(/^\S+\s/, ""));
  const pl = p.mode === "rendimiento" ? null : p.pasos.find((x) => x.modulo === "plata");
  if (pl) bits.push(pl.titulo.replace(/^\S+\s/, "").replace(/^Hoy, /, ""));
  const s = p.pasos.find((x) => x.modulo === "sueno");
  if (s) bits.push(s.titulo.replace(/^\S+\s/, "").replace(/^A la cama a más tardar a las /, "cama hasta las ").replace(/^A la cama a las /, "cama ").replace(/^A la cama entre las (\S+) y las (\S+)/, "cama $1–$2"));
  void kcalPlan;
  return bits.join(" · ");
}

/** Lo que el resumen no dice y distingue un camino de otro (revisión I3) */
function rasgos(p: DayPlan): Map<string, string> {
  const r = new Map<string, string>();
  if (p.proteinG != null) r.set("prot", `${fmtK(p.proteinG)} g de proteína`);
  for (const x of p.pasos) if (x.modulo === "comida" && /^comida-/.test(x.id) && x.id !== "comida-dia" && x.id !== "comida-extra") r.set(x.id, x.id.replace(/^comida-/, ""));
  const e = p.pasos.find((x) => x.modulo === "entreno");
  if (e && /Completa, como dice tu rutina/.test(e.detalle)) r.set("completa", "la rutina completa");
  if (p.pasos.some((x) => x.modulo === "comida" && /bebida sin azúcar/.test(x.detalle))) r.set("bebidas", "bebidas sin azúcar");
  return r;
}

/** Lo que tiene `a` y no `b`, en palabras («con la colación de la tarde», «110 g de proteína»…) */
function diferencias(a: DayPlan, b: DayPlan): string[] {
  const A = rasgos(a), B = rasgos(b), out: string[] = [];
  for (const [k, v] of A) {
    if (B.get(k) === v) continue;
    out.push(/^comida-/.test(k) ? `con ${(MEAL_NAME[v] ?? v).toLowerCase()}` : v);
  }
  for (const [k, v] of B) if (/^comida-/.test(k) && !A.has(k)) out.push(`sin ${(MEAL_NAME[v] ?? v).toLowerCase()}`);
  return out;
}

/**
 * Los resúmenes de los caminos, sin dos iguales (revisión I3, 2026-11-04: Estricto y Óptimo salían idénticos —«2.448
 * kcal · Piernas y core · cama 23:45»— porque con diabetes las calorías no se recortan y lo que sí cambiaba no estaba en
 * el resumen). Si dos dan lo mismo, se agrega lo que los distingue; si de verdad dan lo mismo, se dice y por qué.
 */
export function resumenesDe(i: DayPlanInput, planes: DayPlan[]): string[] {
  return planes.map((p) => {
    const iguales = planes.filter((q) => q !== p && q.resumen === p.resumen);
    if (!iguales.length) return p.resumen;
    const dif = [...new Set(iguales.flatMap((q) => diferencias(p, q)))];
    if (dif.length) return `${p.resumen} · ${dif.join(" · ")}`;
    // Lo mismo de verdad: Estricto lo dice (el recomendado, Óptimo, queda tal cual)
    if (p.mode !== "estricto") return p.resumen;
    const porque = i.diabetic ? "con diabetes no te recorto calorías" : i.targets.goal !== "perder" && i.targets.goal !== "recomp" ? "tu objetivo no es bajar de peso" : "";
    return `${p.resumen} · hoy da lo mismo que ${MODE_NAME[iguales[0].mode]}${porque ? ` (${porque})` : ""}`;
  });
}

// ─── Texto (chat) ─────────────────────────────────────────────────────────────

/** ¿Destacar el Modo Rendimiento? Cuando durmió poco o parte el día cansado */
export function rendimientoDestacado(i: DayPlanInput, p?: DayPlan | null): boolean {
  return (!!i.ready && i.ready.level !== "normal") || p?.curva?.nivel === "bajo";
}

/** Los 3 caminos de hoy (y el día exigente, si lo tiene), con su resumen, y los botones para elegir */
export function previewText(i: DayPlanInput, o: { rendimiento?: boolean } = {}): string {
  const lines = ["🧭 Así se vería tu día (elige uno y lo armo; tú solo lo sigues):"];
  const planes = MODES.map((m) => buildDayPlan(i, m)), res = resumenesDe(i, planes);
  planes.forEach((p, k) => lines.push(`• **${MODE_NAME[p.mode]}**: ${res[k]}`));
  const r = o.rendimiento ? buildDayPlan(i, "rendimiento") : null;
  if (r) lines.push(`• **⚡ Rendimiento** (día exigente): ${r.resumen}`);
  if (r && rendimientoDestacado(i, r)) lines.push("", "Dormiste poco: si igual tienes que rendir hoy, ⚡ Rendimiento.");
  lines.push("", "[Opción: Estricto]", "[Opción: Óptimo]", "[Opción: Flexible]", ...(r ? ["[Opción: Rendimiento]"] : []), "[Opción: Otro]");
  return lines.join("\n");
}

const hhmmPaso = (h: number | null) => (h == null ? "" : `${hhmmOf(h)} `);
const TODO_DIA: Record<string, string> = {
  "mente-pausas": "cada 60–90 min, 5 min de pausa (caminar o mirar lejos) y un vaso de agua",
  "mente-respira": "si te tensas, suspiro cíclico (2 inhalaciones por la nariz y una exhalación larga, 5 min)",
  "mente-seguridad": "si se te cierran los ojos, no manejes: para y duerme 15 min; nada de energéticas con alcohol ni pastillas",
};

/** El plan como lo dice Eris (por código) */
export function planText(p: DayPlan): string {
  const lines = [`${p.mode === "rendimiento" ? "⚡" : "🧭"} Tu día en modo **${MODE_NAME[p.mode]}**${p.ajustes || p.mente ? " (con lo que me contaste)" : ""}:`];
  if (p.curva) lines.push(`📈 Tu curva de hoy (estimada: todavía no la ajusto a ti): ${alertCurveText(p.curva)}.`);
  // Rendimiento: lo de todo el día, en una línea (en el chat el día exigente es largo)
  const todoDia = p.mode === "rendimiento" ? p.pasos.filter((s) => s.modulo === "mente" && s.hora == null) : [];
  if (todoDia.length) lines.push(`📋 Todo el día: ${todoDia.map((s) => TODO_DIA[s.id] ?? `${s.titulo.replace(/^\S+\s/, "").toLowerCase()}: ${s.detalle}`).join(" · ")}`.replace(/([^.])$/, "$1."));
  for (const s of p.pasos) if (!todoDia.includes(s)) lines.push(`${s.titulo.replace(/^(\S+)\s/, `$1 ${hhmmPaso(s.modulo === "sueno" ? null : s.hora)}`)} — ${s.detalle}`);
  if (p.avisos.length) lines.push(`⚠ ${p.avisos.slice(0, 2).join(" ")}`);
  for (const n of p.notas ?? []) lines.push(`(${n})`);
  if (p.notaSinLeer) lines.push(`(Anoté tu nota «${p.nota}», pero todavía no sé ajustar el plan a eso: lo armé en ${MODE_NAME[p.mode]}.)`);
  const comida = p.pasos.some((s) => s.accion.type === "log_food");
  lines.push(comida ? "Cuando comas, dime «comí lo del plan» o pide «otra opción para el almuerzo». Puedes cambiar de camino cuando quieras." : "Puedes cambiar de camino cuando quieras.");
  return lines.join("\n");
}

/** «Otra opción para el almuerzo»: la siguiente alternativa de esa comida */
export function swapMeal(p: DayPlan, slot: string): { plan: DayPlan; paso: PlanStep } | null {
  const paso = p.pasos.find((s) => s.accion.type === "log_food" && s.accion.slot === slot);
  if (!paso || paso.accion.type !== "log_food" || paso.accion.opciones.length < 2) return null;
  const alt = (paso.accion.alt + 1) % paso.accion.opciones.length;
  const nuevo: PlanStep = { ...paso, detalle: plateText(paso.accion.opciones[alt]), accion: { ...paso.accion, alt } };
  return { plan: { ...p, pasos: p.pasos.map((s) => (s.id === paso.id ? nuevo : s)) }, paso: nuevo };
}

// ─── Junta lo que sabe de cada módulo ─────────────────────────────────────────

/** Lo que el teléfono sabe que ya comió hoy (lo anotado a mano puede no haber llegado todavía al servidor) */
export interface PhoneAte { slots?: string[]; kcal?: number; protein?: number }

export async function gatherDayPlanInput(memory: any, now: Date = new Date(), phone?: PhoneAte | null): Promise<DayPlanInput> {
  const safeGet = async (k: string): Promise<any> => { try { return await memory.get(k); } catch { return null; } };
  const ctx = await gatherMetabolicContext(memory, { now });
  if (phone) {
    if (typeof phone.kcal === "number" && phone.kcal > ctx.eaten.kcal) ctx.eaten = { ...ctx.eaten, kcal: phone.kcal };
    if (typeof phone.protein === "number" && phone.protein > ctx.eaten.protein) ctx.eaten = { ...ctx.eaten, protein: phone.protein };
  }
  const analysis = analyze(ctx);
  const t: any = await loadTargets(memory).catch(() => null);
  const snap: any = await safeGet("health_snapshot_latest");
  const dayCtx = dayCtxFrom(snap);
  const wakeHour = wakeHourFor(dayCtx, now);
  const dayDate = nutritionDayOf(now, dayCtx);
  // Lo que ya comió hoy (por comida) y si usa la once o la cena (los últimos 10 días)
  const log = dayEntries((await safeGet(`nutrition_log_${nutritionDayKey(now, dayCtx)}`)) || [], snap?.foodLog, nutritionDayKey(now, dayCtx), await safeGet(`nutrition_deleted_${nutritionDayKey(now, dayCtx)}`)).entries;
  const eatenSlots = new Set<string>();
  for (const e of log) { const at = new Date(e.timestamp); if (e.mealType && !Number.isNaN(at.getTime())) eatenSlots.add(effectiveSlot(e.mealType, at, { wakeHour })); }
  for (const s of phone?.slots ?? []) if (typeof s === "string" && s.length < 20) eatenSlots.add(s);
  let once = 0, cena = 0;
  for (let k = 1; k <= 10; k++) {
    const d = new Date(dayDate); d.setDate(d.getDate() - k);
    const past: any[] = (await safeGet(`nutrition_log_${d.toDateString()}`)) || [];
    if (past.some((e) => e?.mealType === "once")) once++;
    if (past.some((e) => e?.mealType === "cena")) cena++;
  }
  const dinners = once >= 3 && cena >= 3 ? ["once", "cena"] : once >= 3 && once > cena ? ["once"] : ["cena"];
  const allSlots = ["desayuno", "colacion_am", "almuerzo", "colacion_pm", ...dinners];
  const slots = allSlots
    .filter((s) => !eatenSlots.has(s) && !(s === "once" && eatenSlots.has("cena")) && !(s === "cena" && eatenSlots.has("once") && dinners.length === 1) && !slotIsPast(s, now, wakeHour))
    .map((s) => {
      const at = typicalTimeOf(s, dayDate, { wakeHour });
      let h = hourOf(at); if (at.getDate() !== dayDate.getDate()) h += 24;
      // una comida que todavía está a tiempo pero cuya hora típica ya pasó (el desayuno a las 11): desde ahora
      const ahora = Math.ceil(hourOf(now) * 4) / 4 + (now.getDate() !== dayDate.getDate() ? 24 : 0);
      return { slot: s, hora: Math.max(Math.round(h * 4) / 4, ahora) };
    });
  const proj = await getProjection(memory).catch(() => null);
  const intent: any = await intentFor(memory).catch(() => null);
  const fresh = snap?.lastUpdated && now.getTime() - Date.parse(snap.lastUpdated) < 20 * 3600_000;
  const ins: SleepInsights | null = fresh && snap?.sleepInsights && typeof snap.sleepInsights.need === "number" ? snap.sleepInsights : null;
  const ap = autoPrefsDe(await safeGet("pref_auto_prefs"));
  // Finanzas apagado en Perfil (A2): sin tope de gasto ni cuadre en el plan
  const finS: any = !ap.modulos || ap.modulos.includes("finanzas") ? await safeGet("financial_summary_latest") : null;
  const finAt = finS?.at ? new Date(finS.at) : null;
  const finance = finAt && finAt.getMonth() === now.getMonth() && now.getTime() - finAt.getTime() < 3 * 86_400_000
    ? { libre: typeof finS.libre === "number" ? finS.libre : null, porDia: typeof finS.porDia === "number" ? finS.porDia : null,
      // A2: la primera cuenta que no calza con el banco (solo números: nombre de la cuenta y la diferencia)
      cuadre: (() => { const c = Array.isArray(finS.cuadre?.cuentas) ? finS.cuadre.cuentas.find((x: any) => x?.estado === "no_calza" && typeof x.diff === "number") : null; return c ? { nombre: String(c.nombre), diff: c.diff } : null; })() } : null;
  const conds: string[] = (ctx.medical?.conditions ?? []).map((c: any) => String(c?.id ?? c));
  const tday = isoDayKey(dayDate);
  const inv = await lastInventoryState(memory).catch(() => null);
  // Modo Rendimiento: las siestas de hoy (después de despertar), las tazas con cafeína ya anotadas y cuántos días exigentes van
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const hrsOf = (iso: string) => { const d = new Date(iso); return hourOf(d) + Math.round((dayOf(d) - dayOf(dayDate)) / 86_400_000) * 24; };
  const wokeAt = snap?.dayWakeTime ? Date.parse(snap.dayWakeTime) : NaN;
  const naps = fresh && Array.isArray(snap?.sleep?.episodes)
    ? snap.sleep.episodes.filter((e: any) => e?.kind !== "noche" && typeof e?.start === "string" && typeof e?.end === "string" && Date.parse(e.start) > wokeAt)
      .map((e: any) => ({ start: hrsOf(e.start), end: hrsOf(e.end) })) : [];
  const cafeHoy = log.reduce((a, e) => a + (e.items ?? []).filter((x: any) => typeof x?.name === "string" && isCaffeinated(x.name)).length, 0);
  const planLog: Array<{ day: string; mode: string }> = (await safeGet("day_plan_log")) || [];
  const hace7 = isoDayKey(new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate() - 7));
  const usesRendimiento7d = planLog.filter((x) => x?.mode === "rendimiento" && x.day > hace7 && x.day < tday).length;
  // R2: el pulso en reposo de hoy (el reloj) contra su promedio, y lo que se repite después de sus días exigentes
  const rollup: any[] = typeof memory?.getDailyRollupLog === "function" ? await memory.getDailyRollupLog(60).catch(() => []) : ((await safeGet("daily_rollup_log")) || []);
  const restHoy = fresh && isoDayKey(nutritionDayOf(new Date(snap.lastUpdated), dayCtx)) === tday && Number(snap?.heartRate?.resting) > 0 ? Number(snap.heartRate.resting) : null;
  const pulso = pulseSignal(Array.isArray(rollup) ? rollup : [], tday, restHoy);
  const despues = afterPattern(planLog, Array.isArray(rollup) ? rollup : [], tday);
  const med: any = ctx.medical ?? {};
  const condText = [...(med.conditions ?? []).map((c: any) => c?.notes ?? ""), ...(med.dietaryRestrictions ?? []), med.allergies ?? ""].join(" ");
  return {
    now, day: tday, ctx, analysis,
    targets: { kcal: t?.kcal ?? ctx.goals.kcal, proteinG: t?.proteinIsCap ? null : (t?.proteinG ?? ctx.goals.protein ?? null),
      proteinMax: t?.proteinRange ? t.proteinRange[1] : null, goal: t?.goal, maintenance: t?.kcalMaintenance },
    affinity: await loadFoodAffinity(memory).catch(() => new Map()),
    pantry: inv ? pantryFrom(inv.state, inv.at, now) : null,
    slots, allSlots,
    training: proj?.today && proj.today.day === tday ? proj.today : null,
    intent: intent ? { answer: intent.answer, time: intent.time } : null,
    ready: fresh ? sleepReadiness(ins, lastSleepFrom(snap?.sleep)) : null,
    sleep: ins && ins.nights >= 4 ? ins : null,
    finance,
    prefs: { topeDia: ap.topeDia, segunSueno: ap.segunSueno },
    diabetic: conds.some((c) => /diabet/.test(c)),
    renal: !!t?.proteinIsCap || conds.includes("ckd"),
    hasInventory: !!inv,
    wakeH: wakeHour ?? null,
    lastSleep: fresh ? lastSleepFrom(snap?.sleep) : null,
    sleepAny: ins,
    naps, conds, condText, cafeHoy, usesRendimiento7d, pulso, despues,
  };
}
