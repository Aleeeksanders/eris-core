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

export type ToolGroup = "axs" | "system" | "admin" | "health" | "health_extra" | "finance" | "web";

export const TOOL_GROUP: Record<string, ToolGroup> = {
  axs_briefing: "axs", knowledge_search: "axs", vault_audit: "axs", vault_healer: "axs", vault_note: "axs",
  log_management: "axs", executive_report: "axs", crystallize: "axs",
  bash: "system", file_read: "system", file_write: "system", open: "system", system_info: "system",
  admin_overview: "admin",
  gluco_tracker: "health", nutrition_tracker: "health", carb_options: "health", metabolic_advisor: "health", manage_user_profile: "health", symptom_guide: "health", sleep_log: "health", lab_results: "health",
  training_plan: "health_extra", personal_baseline: "health_extra", get_live_context: "health_extra",
  manage_user_context: "health_extra", personal_journal: "health_extra", insight_feedback: "health_extra",
  finance_tracker: "finance",
  web_search: "web",
};

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Palabras (ya sin acentos) que activan cada grupo. Son generosas a propósito: pasarse solo agrega herramientas
// (que el modelo puede ignorar); quedarse corto deja al modelo sin la herramienta que necesita.
const RULES: Array<[ToolGroup, RegExp]> = [
  ["axs", /\b(axs|boveda|vault|obsidian|notas?|roadmap|briefing|proyectos?|lander|toji|forge|wallet|tsn|johnny|decision(es)?|cristaliz\w*|logs?|bitacora|inbox|pendientes?|backlog|huerfan\w*|enlaces?|sanar|repar\w*|reporte|auditor\w*|conocimiento|como va|estado de|resumen|segun mis notas|que dice|en que esta|crea (una )?nota|documenta\w*)\b/],
  ["system", /\b(comando|terminal|powershell|ejecut\w*|corre|script|archivos?|carpetas?|escritorio|documentos|descargas|abre|abrir|disco|ram|cpu|procesos?|servicios?|instal\w*|servidor|pc|equipo|ollama|puerto|red|ip|temperatura|espacio|escribe|lee|sistema|windows|reinicia\w*|apaga\w*|bun|node|git|whisper|piper|cloudflare\w*|tailscale)\b/],
  ["admin", /\b(usuarios?|perfiles?|registrad\w*|cuentas?|sesion(es)?|roles?|acceso|accesos|intentos?|seguridad|incidentes?|quien (entro|esta|se conecto)|conectad\w*|suspend\w*|bitacora de auditoria)\b/],
  ["health", /\b(calambres?|dolor(es)?|duele\w*|mare\w+|nausea\w*|vomit\w*|diarrea|fiebre|tos|resfri\w*|gripe|garganta|cabeza|espalda|estomago|acidez|migrana|sintomas?|enferm\w*|herida|corte|quemadura\w*|torcedura|esguince|insomnio|ansiedad|panico|estrenimiento|deshidrat\w*|hinchad\w*|lesion\w*|tobillo|rodilla|glucos\w*|glucemia|azucar|insulina|diabet\w*|comi|comida|comer|desayun\w*|almuerz\w*|cena|colacion|snack|hambre|agua|hidrat\w*|litros?|calorias?|kcal|proteinas?|carbo\w*|macros?|alimentos?|recetas?|dieta|keto|vegan\w*|alergi\w*|celiac\w*|lactosa|peso|medic\w*|pastillas?|remedios?|farmacos?|tratamiento|\w*gliptin\w*|\w*gliflozin\w*|metformin\w*|dosis|presion|hemoglobina|glicosilada|glucosilada|glicada|hba1c|a1c|examen(es)?|laboratorio|colesterol|ldl|hdl|trigliceridos|creatinina|sueno|dormi|descans\w*|cansad\w*|energia|pasos|ejercicio|nutri\w*|hipo|hiper|cgm|libre|mi salud|cuanto (llevo|me falta)|que hago ahora|registra\w*|anota\w*|ingres\w*|onces?|tome once|merienda|merend\w*|almorc\w*|al ?mor[csz]e|cene|cenamos|comimos|porcion\w*|gramos)\b/],
  ["finance", /\b(gast\w*|pagu\w*|pague|compr\w*|lucas?|luquitas?|palos?|pesos|plata|dinero|efectivo|cajero|gir\w*|saque|transfer\w*|deposit\w*|abon\w*|prest\w*|devolvi\w*|me debe\w*|ahorr\w*|sueldo|finanzas|wallet|presupuesto|tarjeta|debito|credito|banco|saldos?|deudas?|cuenta rut)\b/],
  ["health_extra", /\b(entren\w*|rutina|plan de entrenamiento|mi plan|gimnasio|gym|forge|diario personal|journal|animo|estres|recuerda que|no olvides|baseline|patron|como voy|como estoy|resumen de (mi )?salud|insights?|habitos?|tendencia|feedback|mis notas personales)\b/],
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

/** ¿Qué grupos pide este mensaje? (vacío si no reconoce ninguno) */
export function groupsFor(message: string): Set<ToolGroup> {
  const t = fold(message);
  const out = new Set<ToolGroup>();
  for (const [g, re] of RULES) if (re.test(t)) out.add(g);
  if (mentionsFood(t)) out.add("health");
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
export type Intent = "registrar_comida" | "sueno" | "sintoma" | "ideas_comida" | "panorama";
const INTENT_TOOLS: Record<Intent, string[]> = {
  registrar_comida: ["nutrition_tracker", "web_search"],
  sueno: ["sleep_log", "get_live_context"],
  sintoma: ["symptom_guide", "manage_user_profile", "web_search"],
  ideas_comida: ["metabolic_advisor", "carb_options", "nutrition_tracker", "web_search"],
  // «analiza mis métricas de hoy», «evalúame», «panorama»: antes las 16 herramientas (~42 000 caracteres de prompt)
  panorama: ["metabolic_advisor", "get_live_context", "personal_baseline", "finance_tracker", "web_search"],
};
const PREGUNTA = /[?¿]|\b(cuant\w+|cual(es)?|por que|deberia|conviene|como (voy|estoy|me fue|quedo)|que tal|resumen)\b/;
const LOG_VERB = /\b(registr\w*|anot\w*|ingres\w*|agreg\w*|apunt\w*)\b/;
const ATE = /\b(me comi|comi|comimos|almorce|almorzamos|al ?mor[csz]e|desayune|desayunamos|cene|cenamos|tome once|tomamos once|meren\w*|me tome|acabo de comer|estoy comiendo)\b/;
const SLEEP = /\b(dormi|me dormi|desperte|me desperte|siesta|me acoste|trasnoch\w*)\b/;
const SYMPTOM = /\b(calambres?|dolor(es)?|duele\w*|mare\w+|nausea\w*|vomit\w*|diarrea|fiebre|tos|resfri\w*|gripe|migrana|sintomas?|herida|quemadura\w*|torcedura|esguince|hinchad\w*|lesion\w*|me siento mal|me corte|me queme|me torci|acidez)\b/;
const PLATA = /\b(gast\w*|pag\w*|compr\w*|lucas?|plata|dinero|sueldo|deudas?|saldos?|tarjeta|presupuesto|ahorr\w*|entren\w*|rutina|gym)\b/;
const NOT_FOOD_LOG = /\b(diario|journal|notas?|recordatorio\w*|recuerda\w*|peso|pese|medida\w*|medicament\w*|pastillas?|remedios?|examen\w*|laboratorio|hba1c|glucos\w*|glicemia|presion|entren\w*|rutina|series?)\b/;
const FOODISH = /\b(comida|desayuno|almuerzo|onces?|cena|colacion|snack|merienda|porcion\w*|gramos|agua|cafe|te|jugo|bebida|coca|leche|yogurt?|fruta)\b/;
const FOOD_IDEAS = /\b(propon\w*|ideas?|opciones|sugier\w*|sugerencias?|recomienda\w*|que (puedo )?(como|comer|ceno|almuerzo|desayuno|cocino|preparo)|que me (como|preparo|recomiendas)|antes de entrenar|post ?entreno|pre ?entreno)\b/;

/** Lo único que pide el mensaje, si es una sola cosa reconocible; si no, undefined (se usan los grupos). */
export function intentOf(message: string, groups: Set<ToolGroup>): Intent | undefined {
  const t = fold(message);
  // Un análisis general sin otro pedido concreto (anotar, un síntoma, plata, entrenamiento, AXS…)
  if (OVERVIEW.test(t) && !groups.has("axs") && !groups.has("system") && !groups.has("admin") && !LOG_VERB.test(t) && !SYMPTOM.test(t)
    && !PLATA.test(t) && !/[0-9]/.test(t)) return "panorama";
  // Varias cosas a la vez (comida y plata, entrenamiento, AXS…): los grupos de siempre
  if ([...groups].some((g) => g !== "health" && g !== "web" && !(g === "health_extra" && /\b(entren\w*|gym|gimnasio)\b/.test(t) && FOOD_IDEAS.test(t)))) return undefined;
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

export function routeTools(message: string, previousUserMessages: string[], available: string[]): Routing {
  let groups = groupsFor(message);
  let reason: Routing["reason"] = "mensaje";
  const webOnly = (r: Routing["reason"]): Routing => ({ groups: ["web"], tools: new Set(available.filter((n) => TOOL_GROUP[n] === "web")), reason: r });
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
  }
  if (!groups.size) {
    for (const prev of [...previousUserMessages].reverse().slice(0, 2)) {
      const g = groupsFor(prev);
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
