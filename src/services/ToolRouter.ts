// ============================================================
// Eris — ToolRouter
//
// Ikaros tiene 26 herramientas. Mostrárselas TODAS al modelo en cada mensaje (~9 000 tokens de definiciones) hace que
// un 4B elija mal y obliga a usar un contexto enorme y lento. El selector decide, por código y según lo que pide el
// mensaje, qué GRUPOS de herramientas ve el modelo en ese turno. El motor además RECHAZA cualquier herramienta fuera
// del grupo elegido (un modelo que alucina una herramienta no puede ejecutarla).
//
// Es solo un filtro de visibilidad: no da permisos. Los permisos, la aprobación y la política de rutas siguen intactos.
// ============================================================

export type ToolGroup = "axs" | "system" | "admin" | "health" | "health_extra" | "finance" | "inventory" | "web";

export const TOOL_GROUP: Record<string, ToolGroup> = {
  axs_briefing: "axs", knowledge_search: "axs", vault_audit: "axs", vault_healer: "axs", vault_note: "axs",
  log_management: "axs", executive_report: "axs", crystallize: "axs",
  bash: "system", file_read: "system", file_write: "system", open: "system", system_info: "system",
  admin_overview: "admin",
  gluco_tracker: "health", nutrition_tracker: "health", carb_options: "health", metabolic_advisor: "health", manage_user_profile: "health", symptom_guide: "health", sleep_log: "health", lab_results: "health", training_today: "health",
  training_plan: "health_extra", personal_baseline: "health_extra", get_live_context: "health_extra",
  manage_user_context: "health_extra", personal_journal: "health_extra", insight_feedback: "health_extra",
  finance_tracker: "finance",
  inventory_tracker: "inventory",
  supplement_tracker: "health",
  day_agenda: "health",
  day_plan: "health",
  web_search: "web",
};

import { readFileSync } from "node:fs";
import { parseTrainingStatement } from "./TrainingIntent.js";
import { esAnalisisDia } from "./AnalisisDia.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Palabras (ya sin acentos) que activan cada grupo. Son generosas a propósito: pasarse solo agrega herramientas
// (que el modelo puede ignorar); quedarse corto deja al modelo sin la herramienta que necesita.
const RULES: Array<[ToolGroup, RegExp]> = [
  ["axs", /\b(axs|boveda|vault|obsidian|notas?|roadmap|briefing|proyectos?|lander|toji|forge|wallet|tsn|johnny|decision(es)?|cristaliz\w*|logs?|bitacora|inbox|pendientes?|backlog|huerfan\w*|enlaces?|sanar|repar\w*|reporte|auditor\w*|conocimiento|como va|estado de|resumen|segun mis notas|que dice|en que esta|crea (una )?nota|documenta\w*)\b/],
  ["system", /\b(comando|terminal|powershell|ejecut\w*|corre|script|archivos?|carpetas?|escritorio|documentos|descargas|abre|abrir|disco|ram|cpu|procesos?|servicios?|instal\w*|servidor|pc|equipo|ollama|puerto|red|ip|temperatura|espacio|escribe|lee|sistema|windows|reinicia\w*|apaga\w*|bun|node|git|whisper|piper|cloudflare\w*|tailscale)\b/],
  ["admin", /\b(usuarios?|perfiles?|registrad\w*|cuentas?|sesion(es)?|roles?|acceso|accesos|intentos?|seguridad|incidentes?|quien (entro|esta|se conecto)|conectad\w*|suspend\w*|bitacora de auditoria)\b/],
  ["health", /\b(calambres?|dolor(es)?|duele\w*|mare\w+|nausea\w*|vomit\w*|diarrea|fiebre|tos|resfri\w*|gripe|garganta|cabeza|espalda|estomago|acidez|migrana|sintomas?|enferm\w*|herida|corte|quemadura\w*|torcedura|esguince|insomnio|ansiedad|panico|estrenimiento|deshidrat\w*|hinchad\w*|lesion\w*|tobillo|rodilla|glucos\w*|glucemia|azucar|insulina|diabet\w*|comi|comida|comer|desayun\w*|almuerz\w*|cena|colacion|snack|hambre|agua|hidrat\w*|litros?|calorias?|kcal|proteinas?|carbo\w*|macros?|alimentos?|recetas?|dieta|keto|vegan\w*|alergi\w*|celiac\w*|lactosa|peso|medic\w*|pastillas?|remedios?|farmacos?|tratamiento|\w*gliptin\w*|\w*gliflozin\w*|metformin\w*|dosis|presion|hemoglobina|glicosilada|glucosilada|glicada|hba1c|a1c|examen(es)?|laboratorio|colesterol|ldl|hdl|trigliceridos|creatinina|sueno|dormi|duermo|dormir|durmiendo|desvel\w*|descans\w*|cansad\w*|energia|pasos|ejercicio|nutri\w*|hipo|hiper|cgm|libre|mi salud|cuanto (llevo|me falta)|que hago ahora|registra\w*|anota\w*|ingres\w*|onces?|tome once|merienda|merend\w*|almorc\w*|al ?mor[csz]e|cene|cenamos|comimos|porcion\w*|gramos)\b/],
  ["finance", /\b(gast\w*|pagu\w*|pague|compr\w*|lucas?|luquitas?|palos?|pesos|plata|dinero|efectivo|cajero|gir\w*|saque|transfer\w*|deposit\w*|abon\w*|prest\w*|devolvi\w*|me debe\w*|ahorr\w*|sueldo|finanzas|wallet|presupuesto|tarjeta|debito|credito|banco|saldos?|deudas?|cuenta rut|(me |nos )?queda\w* (este mes|del mes|a fin de mes|hasta (el |mi |que llegue el )?(sueldo|pago|fin de mes)))\b/],
  // El Inventario de la casa (2026-10-22). Sin «tengo» suelto: «tengo hambre» no es del inventario. «¿Cuánto me queda este
  // mes?» es de Finanzas (2026-10-23); «¿me queda leche?» sigue siendo del Inventario
  ["inventory", /\b(inventario|despensa|refri\w*|refrigerador|alacena|bodega|botiquin|stock|lista de (las )?compras?|que (me |nos )?falta(n)?|se (me |nos )?(acabo|acabaron|termino|terminaron|agoto|agotaron|vencio|vencieron)|no (me |nos )?queda\w*|me quedan?(?! (este mes|del mes|a fin de mes|hasta))|por vencer|vencimientos?|vencid[oa]s?|caduc\w*|bote|tire|repuse|use|ocupe|compre|compramos|traje)\b/],
  // Suplementos (fase I5): con las herramientas de salud
  ["health", /\b(suplement\w*|creatina|omega ?3|vitamina\w*|magnesio|zinc|hierro|b12|whey|cafeina|electrolitos|calcio|colageno|multivitaminic\w*)\b/],
  ["health_extra", /\b(entren\w*|rutina|plan de entrenamiento|mi plan|gimnasio|gym|forge|ejercicios?|pesas|records?|marcas?|fuerza|levant\w*|press|sentadillas?|peso muerto|dominadas?|diario personal|journal|animo|estres|recuerda que|no olvides|baseline|patron|como voy|como estoy|resumen de (mi )?salud|insights?|habitos?|tendencia|feedback|mis notas personales)\b/],
];

const OVERVIEW = /\b(analisis|analiza\w*|cruza\w*|cruce|cruces|cruzar|mi perfil|perfil general|en general|resumen general|como voy|mi dia|panorama|evaluame|evalua\w*|diagnostico)\b/;

// Sin señal clara: lo de uso diario (salud, Finanzas, AXS). Los comandos/archivos del PC y la administración NUNCA van por
// defecto: solo si el mensaje los pide con sus palabras (comando, terminal, archivo, usuarios…). Antes el defecto era
// AXS+sistema+admin, y "ingresa 1 empanada… como once" (que no calzaba con nada) dejó al modelo sin nutrition_tracker y con
// bash: intentó escribir la comida en un JSON del PC con un script (2026-10-03).
const DEFAULT_GROUPS: ToolGroup[] = ["health", "finance", "axs"];

/**
 * Palabras de comida sacadas de las propias bases de alimentos (nombres y alias): "empanada", "sopaipilla", "completo",
 * "marraqueta"… Así cualquier alimento conocido activa las herramientas de salud, aunque el mensaje no diga "comí".
 */
const NO_FOOD = new Set(["cocido", "cocida", "cocidos", "cocidas", "natural", "fresco", "fresca", "plancha", "horno", "entero", "entera",
  "blanco", "blanca", "integral", "light", "chilena", "chileno", "casero", "casera", "sabor", "verde", "verdes", "grande", "mediano",
  "porcion", "unidad", "sobre", "preparado", "preparada", "molida", "frito", "frita", "asado", "asada", "tipo", "drenado", "conserva",
  "suplemento", "rallado", "laminado", "fiambre", "local", "salsa", "salsas", "pasadas", "parmesana"]);
const FOOD_WORDS: Set<string> = (() => {
  const out = new Set<string>();
  const add = (s: unknown) => { for (const w of fold(String(s ?? "")).split(/[^a-zñ]+/)) if (w.length >= 5 && !NO_FOOD.has(w)) out.add(w); };
  try {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
    const cl = JSON.parse(readFileSync(path.join(dir, "chilean-foods.json"), "utf-8"));
    for (const f of cl) { add(f.name); (f.aliases ?? []).forEach(add); }
    const cat = JSON.parse(readFileSync(path.join(dir, "food_catalog.json"), "utf-8"));
    for (const f of cat.items ?? []) { add(f.name); (f.aliases ?? []).forEach(add); }
  } catch { /* sin bases: quedan las reglas fijas */ }
  return out;
})();
const mentionsFood = (t: string) => t.split(/[^a-zñ]+/).some((w) => w.length >= 5 && (FOOD_WORDS.has(w) || FOOD_WORDS.has(w.replace(/(es|s)$/, ""))));

const INV_WORD = /\b(inventario|despensa|refri\w*|refrigerador|alacena|bodega|botiquin|stock|lista de (las )?compras?|se (me |nos )?(acabo|acabaron|termino|terminaron|agoto|agotaron|vencio|vencieron)|por vencer|vencid[oa]s?|compre|compramos|traje|bote|tire|repuse)\b/;
const MEDIDA = /\b(calorias?|kcal|proteinas?|carbo\w*|grasas?|azucar(es)?|fibra|agua|litros?|vasos?|pasos|horas?|minutos?|dias?|semanas?|series|repeticiones)\b/;
/** ¿Qué grupos pide este mensaje? (vacío si no reconoce ninguno) */
export function groupsFor(message: string): Set<ToolGroup> {
  const t = fold(message);
  const out = new Set<ToolGroup>();
  for (const [g, re] of RULES) if (re.test(t)) out.add(g);
  if (mentionsFood(t)) out.add("health");
  // «¿Cuántas calorías me quedan?», «¿cuánta agua me falta?», «¿cuánto me queda?»: «me queda» sin una cosa de la casa no es del
  // Inventario (revisión 2026-11-04, C1: solo veía inventory_tracker y contestaba «no tienes calorías en tu inventario»)
  if (out.has("inventory") && !INV_WORD.test(t) && (MEDIDA.test(t) || /\bcuant[oa]s?\s+(me|nos)\s+queda\w*[?\s]*$/.test(t))) out.delete("inventory");
  // "Cruza mi perfil y dame el análisis", "¿cómo voy?", "panorama general": cruza salud y plata. Antes "perfil" solo
  // activaba administración (oculta en modo Eris) y el modelo quedaba sin herramientas, inventando cifras (2026-10-07).
  // …salvo una pregunta de explicación («¿por qué la hora de mi día es distinta…?»): cargaba las 16 herramientas (2026-10-16)
  if (OVERVIEW.test(t) && !/^[¿¡\s]*(eris,?\s+)?(por que|que es|que significa|como funciona|como se calcula)\b/.test(t)) { out.add("health"); out.add("health_extra"); out.add("finance"); }
  // health_extra sin health no tiene sentido (las herramientas extra complementan a las básicas)
  if (out.has("health_extra")) out.add("health");
  return out;
}

export interface Routing {
  groups: ToolGroup[]; tools: Set<string>; reason: "mensaje" | "conversación" | "por defecto"; intent?: Intent;
  /** Herramientas que el modelo recién ve si una herramienta dice que no encontró algo (ver QueryEngine) */
  deferred?: string[];
}

// ─── Intención clara → solo su herramienta ─────────────────────────
// Con los grupos, «registra un completo italiano sin mayo» le mostraba al modelo 7-15 herramientas (~25 000 caracteres de
// definiciones): junto al sistema el prompt pasaba los 8192 tokens del contexto, se recortaba y el 4B tardaba 30-90 s y a
// veces llamaba otra herramienta (banco de pruebas 2026-10-16). Si el mensaje SOLO hace una cosa reconocible, el modelo ve
// solo lo que sirve para eso (+ la búsqueda web para un plato que no esté en las bases).
export type Intent = "registrar_comida" | "sueno" | "sintoma" | "ideas_comida" | "panorama" | "entreno_hoy" | "inventario" | "suplementos" | "analisis_dia" | "seguimiento";
const INTENT_TOOLS: Record<Intent, string[]> = {
  registrar_comida: ["nutrition_tracker", "web_search"],
  sueno: ["sleep_log", "get_live_context"],
  // «hoy entreno pierna a las 7», «hoy descanso» (Forge 2.0): se anota por código; el plan, si pide qué entrenar
  entreno_hoy: ["training_today", "training_plan"],
  sintoma: ["symptom_guide", "manage_user_profile", "web_search"],
  ideas_comida: ["metabolic_advisor", "carb_options", "nutrition_tracker", "web_search"],
  // «analiza mis métricas de hoy», «evalúame», «panorama»: antes las 16 herramientas (~42 000 caracteres de prompt)
  panorama: ["metabolic_advisor", "get_live_context", "personal_baseline", "finance_tracker", "web_search"],
  // «Analiza mi día», «¿qué variable está fuera de mi patrón?» (R1): lo calcula personal_baseline; el modelo solo redacta
  analisis_dia: ["personal_baseline", "get_live_context"],
  // «¿qué tengo en el refri?», «se me acabó el detergente y el cloro»: solo el Inventario
  inventario: ["inventory_tracker"],
  // «¿qué dice la evidencia de la creatina?», «me tomé el magnesio»: la ficha y «Mis suplementos» (la web, si no hay ficha)
  suplementos: ["supplement_tracker", "web_search"],
  // Las herramientas del turno anterior (ver `seguimiento`): se arman en cada caso
  seguimiento: [],
};
const SUPLE = /\b(suplement\w*|creatina|omega ?3|vitamina\w*|magnesio|zinc|hierro|b12|cafeina|electrolitos|calcio|colageno|multivitaminic\w*)\b/;
const SUPLE_G = new RegExp(SUPLE.source, "g");
const PREGUNTA = /[?¿]|\b(cuant\w+|cual(es)?|por que|deberia|conviene|como (voy|estoy|me fue|quedo)|que tal|resumen)\b/;
// «Añade una ensalada… al almuerzo» (revisión 2026-11-04, C3, chat real) no era un pedido de anotar: iba al grupo de salud
// completo, el modelo eligió Suplementos y se cortó por tiempo
const LOG_VERB = /\b(registr\w*|anot\w*|ingres\w*|agreg\w*|apunt\w*|anad\w*|pon|ponle|ponme|ponlo|ponla|suma|sumale|sumame|sumalo|carga|cargale|cargame|cargalo|mete|metele|meteme)\b/;
const ATE = /\b(me comi|comi|comimos|almorce|almorzamos|al ?mor[csz]e|desayune|desayunamos|cene|cenamos|tome once|tomamos once|meren\w*|me tome|acabo de comer|estoy comiendo)\b/;
export const SLEEP_ROUTINE = /\brutina\w* (para|de|antes de) (dormir|dormirme|acostarme|sueno|la noche|noche|descansar mejor)\b|\brutina nocturna\b/;
const SLEEP = /\b(dormi|me dormi|desperte|me desperte|siesta|me acoste|trasnoch\w*|duermo|desvel\w*)\b/;
const SYMPTOM = /\b(calambres?|dolor(es)?|duele\w*|mare\w+|nausea\w*|vomit\w*|diarrea|fiebre|tos|resfri\w*|gripe|migrana|sintomas?|herida|quemadura\w*|torcedura|esguince|hinchad\w*|lesion\w*|me siento mal|me corte|me queme|me torci|acidez)\b/;
const PLATA = /\b(gast\w*|pag\w*|compr\w*|lucas?|plata|dinero|sueldo|deudas?|saldos?|tarjeta|presupuesto|ahorr\w*|entren\w*|rutina|gym)\b/;
const NOT_FOOD_LOG = /\b(diario|journal|notas?|recordatorio\w*|recuerda\w*|peso|pese|medida\w*|medicament\w*|pastillas?|remedios?|examen\w*|laboratorio|hba1c|glucos\w*|glicemia|presion|entren\w*|rutina|series?)\b/;
const FOODISH = /\b(comida|desayuno|almuerzo|onces?|cena|colacion|snack|merienda|porcion\w*|gramos|agua|cafe|te|jugo|bebida|coca|leche|yogurt?|fruta)\b/;
const FOOD_IDEAS = /\b(propon\w*|ideas?|opciones|sugier\w*|sugerencias?|recomienda\w*|que (puedo )?(como|comer|ceno|almuerzo|desayuno|cocino|preparo)|que me (como|preparo|recomiendas)|antes de entrenar|post ?entreno|pre ?entreno)\b/;

/** Lo único que pide el mensaje, si es una sola cosa reconocible; si no, undefined (se usan los grupos). */
export function intentOf(message: string, groups: Set<ToolGroup>): Intent | undefined {
  const t = fold(message);
  if (esAnalisisDia(message)) return "analisis_dia";
  // «Rutina para dormir», «rutina de sueño» (revisión 2026-11-04, C2): es del sueño, no una rutina de Forge
  if (SLEEP_ROUTINE.test(t) && !/\b(gym|gimnasio|pesas|entren\w*|ejercicio)\b/.test(t)) return "sueno";
  // El entreno de hoy (y solo eso): metas según el día
  if (parseTrainingStatement(message) && !LOG_VERB.test(t) && !ATE.test(t) && !/\b(gast|pag|compr)\w*/.test(t)) return "entreno_hoy";
  // Un análisis general sin otro pedido concreto (anotar, un síntoma, plata, entrenamiento, AXS…)
  if (OVERVIEW.test(t) && !groups.has("axs") && !groups.has("system") && !groups.has("admin") && !LOG_VERB.test(t) && !SYMPTOM.test(t)
    && !PLATA.test(t) && !/[0-9]/.test(t)) return "panorama";
  // Solo el Inventario (sin comer, sin plata, sin anotar una comida): «¿qué tengo en la despensa?», «se acabó el cloro»
  if (groups.has("inventory") && !ATE.test(t) && !groups.has("finance") && !groups.has("axs") && !groups.has("system") && !groups.has("admin")
    && !SYMPTOM.test(t) && !FOOD_IDEAS.test(t) && !(LOG_VERB.test(t) && !/\b(inventario|lista)\b/.test(t))) return "inventario";
  // Solo suplementos (sin comida de por medio, sin plata, sin síntomas): la ficha o «Mis suplementos»
  if (SUPLE.test(t) && !SYMPTOM.test(t) && !FOOD_IDEAS.test(t) && !groups.has("finance") && !groups.has("axs") && !groups.has("system")
    && !groups.has("admin") && !groups.has("inventory") && !mentionsFood(t.replace(SUPLE_G, " "))) return "suplementos";
  // Varias cosas a la vez (comida y plata, entrenamiento, AXS…): los grupos de siempre. El Inventario no cuenta como otra
  // cosa (las palabras de compras y despensa aparecen al pedir ideas de comida)
  if ([...groups].some((g) => g !== "health" && g !== "web" && g !== "inventory" && !(g === "health_extra" && /\b(entren\w*|gym|gimnasio)\b/.test(t) && FOOD_IDEAS.test(t)))) return undefined;
  const sym = SYMPTOM.test(t), sleep = SLEEP.test(t), ideas = FOOD_IDEAS.test(t);
  // «quiero anotar maní confitado, ¿me ayudas?»: la pregunta es de cortesía, el pedido es anotar
  // «¿me anotas 2 marraquetas?» también es un pedido (no «¿anoté las marraquetas?», que pregunta por lo hecho)
  const pideComoPregunta = /^[¿\s]*(?:eris,?\s+)?(?:me\s+)?(?:puedes\s+|podrias\s+)?(?:anot|registr|agreg|ingres|apunt)(?:as|es|ar|arme|ame|alo|ala)\b/.test(t);
  const sinCortesia = (pideComoPregunta ? t.replace(/[¿?]/g, " ") : t)
    .replace(/[¿?]?\s*\b(me ayudas|me puedes ayudar|me podrias ayudar|puedes|podrias|me lo (anotas|registras)|porfa\w*|por favor)\b\s*\?/g, " ");
  const log = (LOG_VERB.test(t) || ATE.test(t)) && !PREGUNTA.test(sinCortesia);
  if (sym) return log || sleep || ideas ? undefined : "sintoma";
  if (sleep) return log && !/\b(dormi|siesta)\b/.test(t) ? undefined : (PREGUNTA.test(t) ? undefined : "sueno");
  if (ideas) return log ? undefined : "ideas_comida";
  // «anota en mi diario…», «anota mi peso», «registra mi examen»: otra herramienta. Solo si se trata de comida o bebida.
  if (log && !NOT_FOOD_LOG.test(t) && (ATE.test(t) || mentionsFood(t) || FOODISH.test(t))) return "registrar_comida";
  return undefined;
}

/**
 * Elige las herramientas visibles para este turno.
 *  1) lo que pide el mensaje actual
 *  2) si no reconoce nada (p. ej. «sí, dale»), lo que pidieron los últimos mensajes del usuario (sigue el hilo)
 *  3) si tampoco, el conjunto por defecto: salud + Finanzas + AXS (sistema y administración solo si se piden)
 * `web_search` siempre está (es minúscula). Solo entran herramientas que existan en `available`.
 */
/**
 * Pregunta de cultura general («¿qué es…?», «diferencia entre…», «¿cuánto es 54 más 27?», «¿por qué…?») que no nombra comida,
 * salud ni plata: no necesita herramientas. Con el conjunto por defecto (10 herramientas) el modelo de 4B llamaba una al azar
 * (el asesor de comida para «imán de neodimio vs ferrita»: banco de pruebas, 2026-10-16) y el prompt engordaba.
 */
const GENERAL_Q = /^(?:[¿¡\s]*)(?:eris,?\s+)?(?:que es|que son|que significa|cuale?s? (?:es|son)|que ingredientes|como (?:es|son) (?:el|la|los|las)|sabes (?:que|cual|como|si)|me explicas|diferencia entre|diferencias entre|en que se diferencia|cuanto es|cuanto son|cuantos? (?:son|hay|mide|pesa)|por que|como funciona|como se (?:hace|dice|calcula|escribe)|explica\w*|quien (?:es|fue|invento|creo)|cuando (?:fue|es|nacio)|donde (?:queda|esta)|calcula|cuanto da|traduce|define)\b/;
export const isGeneralQuestion = (message: string) => GENERAL_Q.test(fold(message));
/** Saludo o charla corta («hola Eris uwu», «¿cómo estás?», «gracias», «buenas noches»): sin herramientas. NO incluye «sí» ni
 *  «dale» (confirman algo pendiente y deben seguir el hilo de la conversación). */
const SALUDO = /^[¡¿\s]*(hola\w*|holi\w*|buenas?|buen(os)? dias?|buenas (tardes|noches)|como (estas|te va|andas|amaneciste)|que tal|gracias|muchas gracias|chao|adios|nos vemos|te quiero|jaja\w*|xd|(recien|acabo de) (desperte|despertar\w*|me desperte|me levante|levantarme))\b[^0-9]{0,40}$/;
export const isSmallTalk = (message: string) => { const t = fold(message).trim(); return t.length <= 60 && SALUDO.test(t); };

/**
 * Una pregunta que no toca ningún tema de la persona («Para hacer básquet, ¿qué zapatillas debo usar?»): ni salud, ni plata,
 * ni nada suyo (mi, me, tengo, llevo…). Antes caía al conjunto por defecto (10 herramientas y sus números del día) y Eris
 * terminó hablando de sus kcal, su plata y una «glucosa estable» inventada (chat real, 2026-10-16).
 */
const PERSONAL = /\b(mi|mis|me|mio|mia|tengo|tenia|llevo|llevas|he|hice|hago|comi|tome|dormi|gaste|estoy|voy|ando)\b/;
export const isGeneralAsk = (message: string) => { const t = fold(message); return /[?¿]/.test(t) && !PERSONAL.test(t) && !groupsFor(message).size; };

/**
 * Una confirmación sin objeto («dale, registra», «sí, guárdalo», «anótalo porfa»): lo que hay que registrar está en el hilo.
 * 2026-10-18 (chat real): después de proponer una rutina, «Dale, registra» activó solo las herramientas de comida (por
 * «registra») y el modelo anotó un completo italiano inventado.
 */
const BARE_CONFIRM = /^(?:(?:si|sip|dale|ya|ok|okey|oka|bueno|perfecto|listo|claro|obvio|de una|ya po|porfa\w*|por favor)[\s,.!]*)*(?:registr\w*|anot\w*|guard\w*|agreg\w*|ingres\w*|apunt\w*|hazlo|dale)[\s,.!]*(?:porfa\w*|por favor|eso|nomas|no mas|po|entonces)?[\s.!]*$/;
export const isBareConfirm = (message: string) => { const t = fold(message).trim(); return t.length <= 40 && BARE_CONFIRM.test(t); };

/** Lo que se sabe del turno anterior: las herramientas que respondieron (Message.trace.tools) */
export interface RouteHint { prevTools?: string[] }

/** Herramientas que no marcan un tema (no se sigue el hilo por ellas) */
const SIN_HILO = new Set(["web_search", "insight_feedback", "personal_journal", "manage_user_context", "manage_user_profile"]);

/**
 * Seguir el hilo (2026-11-05, chat real «¿Qué tan fuerte estoy?»): después de una respuesta con datos de un módulo, la
 * pregunta siguiente sin tema propio («¿Crees que soy fuerte?», «¿y para alguien que no entrena?», «¿eso es mucho?») se
 * mandaba con 19 herramientas, no cabía, se recortaba justo la del tema y Eris terminó en «no tengo datos de fuerza».
 * Ahora sigue con las herramientas del turno anterior (protegidas al recortar), si el mensaje no pide otra cosa.
 */
function seguimiento(message: string, groups: Set<ToolGroup>, available: string[], hint?: RouteHint): Routing | null {
  const prev = (hint?.prevTools ?? []).filter((n) => available.includes(n) && n in TOOL_GROUP && !SIN_HILO.has(n));
  if (!prev.length) return null;
  const t = fold(message).trim();
  if (t.length > 220 || isSmallTalk(message)) return null;
  const prevGroups = new Set(prev.map((n) => TOOL_GROUP[n]));
  if (groups.size && ![...groups].some((g) => prevGroups.has(g) || (g === "health" && prevGroups.has("health_extra")) || (g === "health_extra" && prevGroups.has("health")))) return null;
  // Solo las del tema: con get_live_context, «¿y eso es harto?» después de la plata terminó hablando de sus kcal (banco 2026-11-05)
  return { groups: [...prevGroups], tools: new Set(prev), reason: "conversación", intent: "seguimiento" };
}

export function routeTools(message: string, previousUserMessages: string[], available: string[], hint?: RouteHint): Routing {
  let groups = groupsFor(message);
  let reason: Routing["reason"] = "mensaje";
  if (isBareConfirm(message)) {
    // Las herramientas del tema de los últimos mensajes (más las del propio mensaje): sin «intención» de un solo tema
    for (const prev of [...previousUserMessages].reverse().slice(0, 2)) for (const g of groupsFor(prev)) groups.add(g);
    if (groups.has("health_extra")) groups.add("health");
    groups.add("web");
    const tools = new Set(available.filter((n) => n in TOOL_GROUP && groups.has(TOOL_GROUP[n])));
    for (const n of available) if (!(n in TOOL_GROUP)) tools.add(n);
    return { groups: [...groups], tools, reason: "conversación" };
  }
  const webOnly = (r: Routing["reason"]): Routing => ({ groups: ["web"], tools: new Set(available.filter((n) => TOOL_GROUP[n] === "web")), reason: r });
  const hilo = seguimiento(message, groups, available, hint);
  if (!groups.size && hilo) return hilo;
  // solo la búsqueda web (para datos actuales); el resto lo sabe el modelo
  if (!groups.size && (isGeneralQuestion(message) || isSmallTalk(message) || isGeneralAsk(message))) return webOnly("mensaje");
  if (groups.size) {
    const intent = intentOf(message, groups);
    if (intent) {
      const tools = new Set(available.filter((n) => INTENT_TOOLS[intent].includes(n)));
      // Al anotar comida, la búsqueda web queda guardada hasta que nutrition_tracker diga que no encontró el alimento: el 4B
      // buscaba «yogurt» en internet antes de intentar anotarlo (30 s, banco de pruebas 2026-10-16)
      if (intent === "registrar_comida" && tools.has("web_search")) {
        tools.delete("web_search");
        return { groups: [...groups, "web"], tools, reason: "mensaje", intent, deferred: ["web_search"] };
      }
      if (tools.size) return { groups: [...groups, "web"], tools, reason: "mensaje", intent };
    }
    // Un tema que no se reconoce como un pedido concreto, el mismo del turno anterior: sus herramientas, no el grupo entero
    if (hilo) return hilo;
  }
  if (!groups.size) {
    for (const prev of [...previousUserMessages].reverse().slice(0, 2)) {
      const g = groupsFor(prev);
      // La respuesta a un pedido de comida («Estoy en el trabajo, así que no puedo cocinar» después de «recomiéndame un
      // almuerzo») sigue con las herramientas de ese pedido, no con las 9 de salud: el prompt llenaba los 8192 tokens (2026-10-21)
      if (g.size && intentOf(prev, g) === "ideas_comida") {
        const tools = new Set(available.filter((n) => INTENT_TOOLS.ideas_comida.includes(n)));
        if (tools.size) return { groups: [...g, "web"], tools, reason: "conversación", intent: "ideas_comida" };
      }
      if (g.size) { groups = g; reason = "conversación"; break; }
      // «Sí porfa» después de una pregunta general: sigue siendo general (solo la búsqueda web)
      if (isGeneralQuestion(prev) || isGeneralAsk(prev)) return webOnly("conversación");
    }
  }
  if (!groups.size) { groups = new Set(DEFAULT_GROUPS); reason = "por defecto"; }
  groups.add("web");
  const tools = new Set(available.filter((n) => n in TOOL_GROUP && groups.has(TOOL_GROUP[n])));
  // Herramientas nuevas que aún no están en el mapa: se ofrecen siempre (mejor una de más que una de menos)
  for (const n of available) if (!(n in TOOL_GROUP)) tools.add(n);
  return { groups: [...groups], tools, reason };
}
