// ============================================================
// Eris — que la respuesta no afirme lo que no pasó ni cifras que no existen
//
// 2026-10-07, dos casos reales con el modelo de 4B:
//  1. "Solo déjalo para hoy" → "Contexto actualizado… temporal (no permanente)". No llamó a ninguna herramienta: no
//     cambió nada. (Ya existía la guardia para "✅ registrado" de comida y gastos; esta cubre cualquier "lo guardé /
//     actualicé / dejé / borré" cuando el usuario pidió guardar algo y ninguna herramienta escribió.)
//  2. "Cruza mi perfil" → "Saldo: 12.650 CLP · Gasto comida hoy: 1.808 CLP · Restante: 10.842". Ninguna de esas cifras
//     existía (1.808 eran sus kcal). Las cifras de dinero de una respuesta solo pueden salir de lo que el modelo tiene a
//     la vista (Finanzas, herramientas, lo que dijo el usuario); las demás se quitan y se muestran las reales.
// ============================================================

import { asksToLog, claimsLogged } from "./FoodParse.js";
import { parseSleepStatement } from "./SleepParse.js";
import { matchFoods } from "./MealRecommender.js";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ─── 1. "Lo guardé" sin haber guardado nada ──────────────────────────────────

const SAVE_VERB = /\b(anota\w*|anotes|apunta\w*|registra\w*|registres|ingresa\w*|ingreses|guarda\w*|guardes|actualiza\w*|actualices|deja(lo|la|los|las)?|dejes|cambia\w*|cambies|borra\w*|borres|elimina\w*|elimines|quita\w*|quites|agrega\w*|agregues|anade|anadir|crea|creame|creala|crealo|crees|crear|pon(lo|la|le|les)?|recuerda que|toma(lo|la)? como|corrige\w*)\b/;

/** ¿El usuario pidió guardar, cambiar o borrar algo? */
export function asksToSave(userText: unknown): boolean {
  if (typeof userText !== "string" || !userText.trim()) return false;
  if (asksToLog(userText) || parseSleepStatement(userText)) return true;
  return SAVE_VERB.test(fold(userText));
}

const SAVED_CLAIM = /\b(actualice|lo actualice|he actualizado|quedo (actualizad|guardad|registrad|anotad|cambiad)\w*|ya (esta|quedo|estan|quedaron) (guardad|registrad|actualizad|anotad|cambiad)\w*|contexto actualizado|perfil actualizado|lo deje|la deje|he dejado|deje (anotad|registrad|guardad)\w*|guarde|lo guarde|he guardado|lo cambie|ya lo cambie|borre|lo borre|lo elimine|he eliminado|he borrado|lo quite|registrado permanentemente|guardado permanentemente|(ya )?(esta|quedo|estan|quedaron) (en tu|en la|en el|en mi) (agenda|calendario)|(lo|la) (agende|programe)|ya (agende|programe)|actualice la alarma|cambie la alarma|puse la alarma|(alarma|evento|cita|reunion) (quedo|esta|ya esta) (puest|list|programad|cread|agendad|cambiad|actualizad)\w*|(ya )?(esta|quedo) (guardada |creada )?en (la|tu) boveda|nota (ya )?(esta|quedo) (cread|guardad|list)\w*)\b/;
const OFFER = /\b(si quieres|quieres que|puedo|podria|te gustaria|dime si|avisame|cuando quieras|prefieres)\b/;

const NEGATED = /\bno (alcance|quedo|quedaron|queda|se (guardo|registro|anoto|cambio)|lo (guarde|registre|anote|actualice|cambie)|pude|puedo|he (guardado|registrado|actualizado|anotado|cambiado)|tengo)\b/;

/** ¿La respuesta afirma que algo quedó guardado, cambiado o borrado? (no cuentan preguntas, ofrecimientos ni negaciones) */
export function claimsSaved(reply: unknown): boolean {
  if (typeof reply !== "string") return false;
  return reply.split(/(?<=[.!?\n])/).some((s) => {
    const t = fold(s).trim();
    if (!t || /\?\s*$/.test(t) || OFFER.test(t) || NEGATED.test(t)) return false;
    return SAVED_CLAIM.test(t) || claimsLogged(s);
  });
}

// Acciones de solo lectura (todo lo demás que corra bien cuenta como "guardó algo")
const READ_ACTION = /^(get|list|view|read|search|today|summary|resumen|status|history|stats|current|query|show|check|day|week|daily|weekly|report|analy\w*|preview|options|explain|need_photo|link_check)/i;
const READ_TOOLS = new Set(["web_search", "get_live_context", "metabolic_advisor", "symptom_guide", "carb_options", "personal_baseline",
  "knowledge_search", "axs_briefing", "vault_audit", "system_info", "file_read", "admin_overview", "executive_report"]);

/** ¿Esta llamada (que salió bien) escribió algo? */
export function isWriteCall(tool: string, input: unknown, metadata?: any): boolean {
  if (metadata?.notLogged) return false;
  if (READ_TOOLS.has(tool)) return false;
  const action = (input as any)?.action;
  if (typeof action === "string") return !READ_ACTION.test(action);
  return true;
}

// ─── Cifras a la chilena ──────────────────────────────────────────────────────

/**
 * El modelo a veces escribe cifras en formato inglés ("1,808 kcal", "$12,650", "1.3L", "5.2%"). Se corrigen solo los casos
 * sin ambigüedad: miles con coma seguidos de una unidad que nunca lleva decimales así (kcal, pesos, pasos, g, mg, ml) o
 * precedidos de "$", y decimales con punto (1-2 cifras) seguidos de L, kg, h o %. Nada dentro de bloques de código.
 */
export function chileanNumbers(text: string): string {
  return text.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => {
    if (i % 2 === 1) return part; // código: tal cual
    return part
      .replace(/(\$\s?)(\d{1,3}(?:,\d{3})+)\b/g, (_m, cur: string, n: string) => cur + n.replace(/,/g, "."))
      .replace(/\b(\d{1,3}(?:,\d{3})+)(\s?(?:kcal|clp|CLP|pesos|pasos|g|mg|ml)\b)/g, (_m, n: string, unit: string) => n.replace(/,/g, ".") + unit)
      .replace(/\b(\d+)\.(\d{1,2})\s?(L|litros?|kg|g|mg|h|horas?|%)(?![\w])/g, (_m, a: string, b: string, u: string) => `${a},${b} ${u}`);
  }).join("");
}

// ─── 2. Cifras de dinero inventadas ───────────────────────────────────────────

// "$12.650", "$ 850.000", "12,650 CLP", "~10.842 pesos", "5 lucas", "$5 mil"
// «$408k», «$1,2M», «2 palos» (banco brígida 2026-11-05: el modelo abreviaba cifras reales y la guardia las borraba)
const MONEY_RE = /(?:\$\s?~?\s?(\d{1,3}(?:[.,\s]\d{3})+|\d+(?:[.,]\d{1,2})?)(\s?(?:(?:millones?|mil|lucas?|luquitas?|palos?)\b|[km](?![\wáéíóúñÁÉÍÓÚÑ])))?)|(?:~?\b(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d{1,2})?)\s?(clp|pesos|lucas?|luquitas?|mil pesos|millones de pesos|palos)\b)/gi;

function toAmount(num: string, unit?: string): number | null {
  const n = num.replace(/\s/g, "");
  let v: number;
  if (/^\d{1,3}([.,]\d{3})+$/.test(n)) v = Number(n.replace(/[.,]/g, ""));
  else v = Number(n.replace(",", "."));
  if (!Number.isFinite(v)) return null;
  if (unit && /mil|luca|luquita/i.test(unit) && !/mil pesos|millon/i.test(unit) && v < 10000) v *= 1000;
  if (unit && /mil pesos/i.test(unit) && v < 10000) v *= 1000;
  if (unit && /^\s?k$/i.test(unit) && v < 10000) v *= 1000;
  if (unit && /^\s?(m|millones?( de pesos)?|palos?)$/i.test(unit) && v < 10000) v *= 1_000_000;
  return Math.round(v);
}

/** Montos de dinero que aparecen en un texto. */
export function moneyIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const v = m[1] !== undefined ? toAmount(m[1], m[2]) : toAmount(m[3], m[4]);
    if (v !== null) out.push(v);
  }
  return out;
}

/** Números sueltos (≥ 100) de lo que escribió el usuario: "gasté 5000 en almuerzo" también es un monto suyo. */
function plainNumbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\b\d{1,3}(?:[.,]\d{3})+\b|\b\d{3,}\b/g)) {
    const v = toAmount(m[0]);
    if (v !== null && v >= 100) out.push(v);
  }
  return out;
}

/** Líneas de Finanzas con cifras reales (del contexto de Finanzas que manda la app). */
export function financeFactLines(texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    for (const line of t.split("\n")) {
      const l = line.trim();
      if (/^[-·•]\s*(Gastos [a-záéíóú]+ \d{4}|Su plata|Para gastar hasta|Plata a mano|Sueldo esperado|Ingresos extra)\b[^\n]*\$/i.test(l) && !out.includes(l)) out.push(l);
    }
  }
  return out.slice(0, 5);
}

/**
 * Quita de la respuesta las líneas con montos que no salen de `grounded` (ni de sumar/restar dos de ellos) y, si quitó
 * algo, agrega las cifras reales de Finanzas o dice que no las tiene. `userTexts` cuenta también números sin "$".
 */
export function groundMoney(reply: string, grounded: string[], userTexts: string[] = []): { text: string; removed: string[] } {
  const found = moneyIn(reply);
  if (!found.length) return { text: reply, removed: [] };
  const base = new Set<number>([0]);
  for (const t of grounded) for (const v of moneyIn(t)) base.add(v);
  for (const t of userTexts) { for (const v of moneyIn(t)) base.add(v); for (const v of plainNumbersIn(t)) base.add(v); }
  const vals = [...base];
  const ok = (v: number) => {
    if (base.has(v)) return true;
    for (const a of vals) {
      if (Math.abs(a - v) <= Math.max(1, a * 0.005)) return true; // redondeo
      for (const b of vals) if (a + b === v || Math.abs(a - b) === v) return true; // suma o diferencia de dos reales
    }
    return false;
  };
  const removed: string[] = [];
  const kept = reply.split("\n").filter((line) => {
    const bad = moneyIn(line).some((v) => !ok(v));
    if (bad) removed.push(line);
    return !bad;
  });
  if (!removed.length) return { text: reply, removed };
  const facts = financeFactLines(grounded);
  const note = facts.length
    ? `💰 **Finanzas (cifras reales de tu app):**\n${facts.join("\n")}`
    : "💰 No tengo cifras de Finanzas para eso y no las voy a inventar: abre Finanzas o cuéntame tus movimientos y los anoto.";
  return { text: `${kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n\n${note}`, removed };
}


// ─── Razonamiento a la vista y repeticiones ─────────────────────
// 2026-10-10, "¿puedo ir a entrenar?": la respuesta fue el razonamiento del modelo ("El usuario está preguntando sobre su
// estado… Dado que tengo acceso a los datos reales de hoy, puedo analizar: …") y terminó en "¡¡¡¡¡¡¡¡¡¡¡…" hasta el tope.

const META_START = /^(?:el usuario|la usuaria|el user)\s+(?:esta|me|pide|pregunta|quiere|dice|necesita|solicita|busca|consulta|menciona|tiene|acaba|indica|comenta)\b|^(?:ok(?:ay)?|bien|vale|bueno)?[,.]?\s*(?:voy a|debo|tengo que|necesito)\s+(?:analizar|revisar|responder|considerar|pensar|evaluar)\b|^dado que tengo acceso\b/;

/** ¿La respuesta empieza con el razonamiento interno del modelo en vez de hablarle a la persona? */
export function looksLikeReasoning(reply: unknown): boolean {
  if (typeof reply !== "string") return false;
  return META_START.test(fold(reply).trim().replace(/^[#*_>\s]+/, ""));
}

/** Saca los párrafos iniciales que son razonamiento ("El usuario está preguntando…", "Dado que tengo acceso…"). */
export function stripReasoning(reply: string): string {
  const paras = reply.split(/\n{2,}/);
  while (paras.length > 1 && META_START.test(fold(paras[0]).trim().replace(/^[#*_>\s]+/, ""))) paras.shift();
  return paras.join("\n\n").trim();
}

/** Corta una repetición sin fin ("¡¡¡¡¡¡…", la misma palabra 8 veces seguidas) y lo que viene después. */
export function cutDegenerate(reply: string): { text: string; cut: boolean } {
  const m = reply.match(/([!¡?¿.,;:*~#])\1{9,}|\b(\p{L}{1,12})\b(?:[\s,]+\2\b){7,}/u);
  if (!m || m.index === undefined) return { text: reply, cut: false };
  let text = reply.slice(0, m.index);
  // Se cierra en el último fin de línea u oración (lo que quedaba a medias no sirve)
  const lastBreak = Math.max(text.lastIndexOf("\n"), text.lastIndexOf(". "));
  if (lastBreak > text.length * 0.4) text = text.slice(0, lastBreak + 1);
  return { text: text.trimEnd(), cut: true };
}


// ─── Glucosa inventada y tono alarmista ─────────────────────────
// 2026-10-11, "¿por qué la hora de mi día es distinta a la hora actual?": con el módulo de glucosa apagado y sin ninguna
// medición, la respuesta dijo "Estás con una glucosa de 248 mg/dL (deducida de tu baja energía…)" y armó un diagnóstico
// ("descompensación", "hipoglucemia relativa", "alerta roja", "desnutrición") porque comió poco 33 minutos después de
// despertar. Eris cuida, no trata: un valor de glucosa solo puede salir de una medición real.

const GLUCO_NUM = /(\d{2,3}(?:[.,]\d)?)\s*mg\s*\/?\s*d\s*l\b/gi;
const GLUCO_NEAR = /\bglucosa\b[^.\n]{0,30}?\b(\d{2,3})\b(?!\s*(?:%|g\b|gr|kcal|min|h\b|hrs?|horas|d[ií]as))/gi;
const GLUCO_CLAIM = /\b(?:hiper|hipo)gluc[eé]mi\w*|\bdescompensaci\w*/i;
// «con esa glucosa estable», «tu glucosa está bien» sin ninguna medición (2026-10-16, con el módulo de glucosa apagado)
const GLUCO_STATE = /\b(?:tu|su|esa|esta|la|una)\s+glucosa\s+(?:(?:est[aá]|se\s+ve|sigue|va|anda)\s+)?(?:muy\s+)?(?:estable|alta|baja|normal|controlada|bien|elevada|perfecta|ok|en\s+rango)\b/i;
const ALARM = /\b(?:alerta roja|punto cr[ií]tico|desastre\w*|colaps\w*|inaceptable|peligros[oa]s?|desnutrici[oó]n|est[aá] gritando|quemando m[uú]sculo|emergencia)\b/i;

/** Valores de glucosa (mg/dL, o un número junto a "glucosa") que aparecen en un texto. */
export function glucoseValuesIn(text: string): number[] {
  const out: number[] = [];
  for (const re of [GLUCO_NUM, GLUCO_NEAR]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) { const v = parseFloat(m[1].replace(",", ".")); if (v >= 20 && v <= 700) out.push(v); }
  }
  return out;
}

/**
 * ¿La respuesta habla de la glucosa de la persona sin respaldo? Un valor que no está en los datos (contexto, herramientas)
 * ni en lo que dijo la persona, o "hiper/hipoglucemia"/"descompensación" cuando no hay ninguna medición a la vista.
 */
export function inventedGlucose(reply: string, grounded: string[], userTexts: string[]): boolean {
  const known = new Set<number>();
  // Los umbrales del perfil ("Umbrales glucosa: bajo <70 · alto >180 … mg/dL") no son una medición
  const data = grounded.map((t) => t.replace(/Umbrales glucosa:[^\n|]*?mg\/dL/gi, ""));
  for (const t of [...data, ...userTexts]) for (const v of glucoseValuesIn(t)) known.add(Math.round(v));
  if (glucoseValuesIn(reply).some((v) => !known.has(Math.round(v)))) return true;
  if (!known.size && GLUCO_STATE.test(reply) && !userTexts.some((t) => /gluc/i.test(t))) return true;
  return !known.size && GLUCO_CLAIM.test(reply) && !userTexts.some((t) => GLUCO_CLAIM.test(t));
}

/** ¿Tono de alarma ("alerta roja", "desastre", "peligroso", "desnutrición"…)? */
export function alarmist(reply: string): boolean {
  return ALARM.test(reply);
}

/** Saca las oraciones con glucosa sin respaldo y lo dice. */
export function stripGlucose(reply: string): string {
  const parts = reply.split(/(?<=[.!?])\s+|\n/);
  const kept = parts.filter((s) => !glucoseValuesIn(s).length && !GLUCO_CLAIM.test(s) && !GLUCO_STATE.test(s));
  return `${kept.join(" ").replace(/\s{2,}/g, " ").trim()}\n\n(No tengo mediciones de tu glucosa, así que no la voy a suponer.)`;
}

// ─── 4. Cifras de nutrición con la coma corrida ───────────────────────────────
// 2026-10-12: «te faltan 1.220 g de proteína y 2.460 kcal». Los datos decían 14 de 136 g (faltaban ~122): el modelo corrió la
// coma. Si una cifra de proteína o kcal no está en los datos, pero sí 10 o 100 veces menor o mayor (o la diferencia entre dos
// cifras de la misma línea, que es lo que «te falta»), se cambia por la real. Nada más se toca: una cifra sin relación queda.

const NUTRI_NUM = /(\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?)\s?(g de prote[ií]nas?|kcal)\b/gi;
const parseCl = (s: string): number => /^\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, "")) : Number(s.replace(",", "."));
const numsIn = (t: string): number[] => (t.match(/\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?/g) ?? []).map(parseCl).filter((v) => Number.isFinite(v));
const fmtCl = (n: number): string => Math.round(n).toLocaleString("es-CL");

/** Corrige cifras de proteína y kcal con la coma corrida (1.220 g cuando los datos dicen 122). */
export function fixNutrientSlips(reply: string, grounded: string[], userTexts: string[]): { text: string; fixed: string[] } {
  const all = new Set<number>();
  const prot = new Set<number>();
  const kcal = new Set<number>();
  for (const t of [...grounded, ...userTexts]) {
    for (const v of numsIn(t)) all.add(v);
    for (const line of t.split(/\n|\||·/)) {
      const f = fold(line);
      if (/prote/.test(f)) numsIn(line).forEach((v) => prot.add(v));
      if (/kcal|calori/.test(f)) numsIn(line).forEach((v) => kcal.add(v));
    }
  }
  const withDiffs = (s: Set<number>) => {
    const out = new Set(all);
    const a = [...s];
    for (const x of a) for (const y of a) if (x > y) out.add(Math.round((x - y) * 10) / 10);
    return [...out];
  };
  const cand = { prot: withDiffs(prot), kcal: withDiffs(kcal) };
  const near = (list: number[], v: number) => list.find((x) => x > 0 && Math.abs(x - v) <= Math.max(1, v * 0.01));
  const fixed: string[] = [];
  const text = reply.replace(NUTRI_NUM, (m: string, num: string, unit: string) => {
    const v = parseCl(num);
    const list = /kcal/i.test(unit) ? cand.kcal : cand.prot;
    if (!Number.isFinite(v) || near(list, v) !== undefined) return m;
    for (const r of [v / 10, v / 100, v * 10]) {
      const hit = near(list, r);
      if (hit !== undefined) { fixed.push(`${num} → ${fmtCl(hit)}`); return m.replace(num, fmtCl(hit)); }
    }
    return m;
  });
  return { text, fixed };
}

// ─── 5. Lo que un alimento no tiene ───────────────────────────────────────────
// 2026-10-12: «la grasa de la manzana puede ralentizar la digestión». La manzana casi no tiene grasa (0,1 g por 100 g). Si la
// respuesta le atribuye a un alimento del catálogo un nutriente que casi no tiene (menos de 1 g por 100 g), se quita esa parte.
// No cuenta cuando lo dice como algo bajo («la manzana casi no tiene grasa», «la poca proteína de la fruta»).

const NUTRIENT_KEY: Array<[RegExp, "fat" | "protein" | "carbs" | "sugar" | "fiber"]> = [
  [/^grasas?$/, "fat"], [/^proteinas?$/, "protein"], [/^(carbohidratos?|carbos?)$/, "carbs"], [/^azucar(es)?$/, "sugar"], [/^fibra$/, "fiber"],
];
const NUTRIENT_CLAIM = /\b(grasas?|proteinas?|carbohidratos?|carbos?|azucar(?:es)?|fibra)\s+(?:de la|de las|de los|del|de)\s+([a-zñ]+(?:\s+[a-zñ]+){0,2})/g;
// Dicho como algo bajo, junto al nutriente ("poca grasa", "casi no tiene grasa", "la grasa es mínima"). "Un poco la digestión" no cuenta.
const NUTRIENT_WORD = "(?:grasas?|proteinas?|carbohidratos?|carbos?|azucar(?:es)?|fibra)";
const LOW_WORDS = new RegExp(
  `\\b(?:poc[oa]s?|baj[oa]s? en|casi no (?:tiene|trae|aporta)|casi nada de|nada de|sin|no tiene|no aporta|no trae|escas[oa]s? (?:de )?|minim[oa]s?|muy poc[oa]s?)\\s+(?:\\w+\\s+)?${NUTRIENT_WORD}\\b` +
  `|\\b${NUTRIENT_WORD}\\s+(?:es|son|sea|queda)\\s+(?:muy\\s+)?(?:baj|minim|poc|escas|insignificante)`);

function falseClaimIn(clause: string): string | null {
  const t = fold(clause);
  if (LOW_WORDS.test(t)) return null;
  NUTRIENT_CLAIM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUTRIENT_CLAIM.exec(t))) {
    const key = NUTRIENT_KEY.find(([re]) => re.test(m![1]))?.[1];
    if (!key) continue;
    const foods = matchFoods(m[2]);
    if (!foods.length) continue;
    // Solo si TODOS los alimentos que calzan casi no tienen ese nutriente (no se adivina cuál quiso decir)
    const per100 = foods.map((f) => (Number((f as any)[key]) || 0) / (f.grams || 100) * 100);
    if (per100.every((v) => v < 1)) return `${m[1]} de ${foods[0].name}`;
  }
  return null;
}

/** Quita lo que le atribuye a un alimento un nutriente que casi no tiene. */
export function stripFalseNutrientClaims(reply: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const sentences = reply.split(/(?<=[.!?])(\s+)/);
  const out = sentences.map((s) => {
    if (!s.trim()) return s;
    // Primero se intenta quitar solo la parte con «aunque / pero / sin embargo»; si el error está al principio, va toda la oración
    const parts = s.split(/,\s*(?=(?:aunque|pero|sin embargo|si bien)\b)/i);
    const kept: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const bad = falseClaimIn(parts[i]);
      if (bad) { removed.push(bad); if (i === 0) return ""; continue; }
      kept.push(parts[i]);
    }
    const joined = kept.join(", ");
    return kept.length < parts.length ? joined.replace(/[\s,;:]*$/, "") + "." : s;
  });
  return { text: out.join("").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim(), removed };
}

// ─── 6. «¿Te lo registro?» cuando ya pidió registrar ─────────────────────────
const OFFER_LOG = /\b(?:(?:te )?(?:lo|la|los|las) (?:registro|anoto|guardo|agrego)\b[^.\n]*\?|(?:quieres|deseas|te gustaria) que (?:te )?(?:lo|la|los|las) (?:registre|anote|guarde|agregue))/;
/** ¿La respuesta ofrece registrar en vez de registrar? («¿Te lo registro como almuerzo?») */
export function offersToLog(reply: unknown): boolean {
  return typeof reply === "string" && OFFER_LOG.test(fold(reply));
}
