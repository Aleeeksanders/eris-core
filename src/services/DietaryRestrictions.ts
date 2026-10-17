// ============================================================
// Eris — Restricciones alimentarias (celiaquía, lactosa, alergias, dieta)
//
// REGLA CENTRAL: fail-closed. Un alimento solo se puede recomendar si para
// CADA restricción del usuario su estado está VERIFICADO (verifiedFor) y no
// está presente (allergens). Sin dato → se excluye. Nunca al revés: recomendar
// algo "porque no sé si tiene gluten" es exactamente el error que no se puede
// cometer con un celíaco o un alérgico.
//
// Además de alérgenos, se manejan DIETAS y creencias con el mismo mecanismo (etiquetas verificadas):
//   vegetariano · vegano · pescetariano · keto · bajo en carbohidratos · sin cerdo · sin alcohol · embarazo
// (sin cerdo/alcohol/gelatina/hígado/pescado alto en mercurio/crudo o ahumado son "etiquetas" como el gluten:
//  presentes o verificadas ausentes; sin dato → se excluye.)
//
// Las restricciones se deducen de 3 fuentes que se suman:
//   1. condiciones (celiac → sin gluten estricto)
//   2. texto libre de alergias (palabras clave; lo que no se entiende se AVISA)
//   3. medical.dietaryRestrictions[] (chips estructurados del Perfil)
// ============================================================

import type { MedicalProfile } from "../memory.js";

/** Los 13 alérgenos que Eris rastrea (los de declaración obligatoria en Chile/UE, menos moluscos que van en `mariscos`). */
export type AllergenTag =
  | "gluten" | "lactosa" | "huevo" | "soya" | "frutos_secos" | "mani" | "pescado" | "mariscos"
  | "sesamo" | "mostaza" | "apio" | "sulfitos" | "lupino"
  // No son alérgenos sino cosas que mucha gente evita (religión, embarazo, ética); mismo trato fail-closed:
  | "cerdo" | "alcohol" | "gelatina" | "alto_mercurio" | "higado" | "crudo_ahumado";

/** Lo mínimo que necesita saber un alimento para poder chequearlo (catálogo y carb_options lo cumplen). */
export interface FoodSafety {
  allergens?: string[];   // presentes en la preparación
  traces?: string[];      // "puede contener trazas de" — cuentan solo en restricciones estrictas
  verifiedFor?: string[]; // etiquetas cuyo estado está CONFIRMADO (presente o ausente)
  meat?: boolean;         // carne o pescado (no apto para vegetarianos)
  animal?: boolean;       // cualquier derivado animal (no apto para veganos)
  lactoseG?: number;      // gramos de lactosa por porción (los quesos maduros casi no tienen)
  landMeat?: boolean;     // carne de animales terrestres (pollo, vacuno, cerdo…); el pescado y los mariscos NO cuentan → pescetarianos
  netCarbs100?: number;   // carbohidratos netos (carbos − fibra) por 100 g — para keto / bajo en carbos
  netCarbsPortion?: number; // ídem por porción habitual (los frutos secos o la palta son keto aunque por 100 g parezcan altos)
  name?: string;          // para restricciones que se notan en QUÉ es el alimento (alcohol), no en un ingrediente escondido
  ingredients?: string;
}

/**
 * ¿Puede llevar alcohol, por lo que es? Tragos, vinos, licores, postres o salsas con licor/vino, terremoto, cola de mono…
 * El alcohol no se esconde como el gluten en una harina: si ni el nombre ni los ingredientes lo sugieren, no hay nada
 * que "confirmar". Antes cada empanada o sopaipilla salía con "no puedo confirmar que esté libre de alcohol".
 */
const ALCOHOL_RX = /\b(alcohol\w*|etanol|vinos?|vinagre de vino|cervezas?|chelas?|schop|pisco\w*|ron|licor\w*|whisky|vodka|tequila|brandy|conac|cognac|ginebra|gin|aguardiente|champan\w*|champana|espumante|sidra|sangria|terremoto|cola de mono|ponche|chicha|tiramisu|borrach\w*|jerez|oporto|vermut|fernet|mojito|pina colada|coctel\w*|cocktail|tragos?|kahlua|amaretto|baileys|cabernet|carmenere|merlot|sauvignon|chardonnay|kombucha|zabaione|chirimoya alegre|bombones? con licor)\b/;
export function puedeTenerAlcohol(text: string): boolean {
  return ALCOHOL_RX.test(String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/vinagre de vino/g, ""));
}

// Límites de carbohidratos netos. Un alimento pasa si cumple por 100 g O por porción habitual.
export const KETO_MAX_NET_100 = 8;      // g netos / 100 g
export const KETO_MAX_NET_PORTION = 5;  // g netos / porción
export const LOWCARB_MAX_NET_100 = 15;
export const LOWCARB_MAX_NET_PORTION = 10;
const PORTION_RULE_MAX_100 = 25;

/** Por debajo de esto una persona con INTOLERANCIA (no alergia) a la lactosa suele tolerarlo (quesos maduros, mantequilla). */
const LACTOSE_TOLERABLE_G = 1;

export type CautionKind = "carbs" | "sodium" | "potassium" | "protein" | "fodmap" | "sat_fat" | "diet";

export interface Caution {
  kind: CautionKind;
  text: string; // por qué, en lenguaje simple
}

export interface Restrictions {
  /** Etiquetas de alérgeno que hay que evitar. strict = alergia/celiaquía: las trazas también cuentan. */
  excluded: Map<AllergenTag, { strict: boolean; why: string }>;
  vegetarian: boolean;
  vegan: boolean;
  /** Come pescado y mariscos pero no carne de animales terrestres. */
  pescetarian: boolean;
  /** Dieta cetogénica: solo alimentos muy bajos en carbohidratos netos. */
  keto: boolean;
  /** Bajo en carbohidratos (menos estricto que keto). */
  lowCarb: boolean;
  /** Cuidados por condición: no excluyen alimentos, cambian el orden y las advertencias. */
  cautions: Caution[];
  /** Fragmentos del texto libre de alergias que NO se pudieron interpretar — se avisan, no se ignoran. */
  unparsed: string[];
  /** Etiquetas legibles: "sin gluten (celiaquía)". */
  labels: string[];
  celiac: boolean;
}

export const RESTRICTION_IDS = [
  "sin_gluten", "sin_lactosa", "sin_frutos_secos", "sin_mani", "sin_mariscos", "sin_pescado", "sin_huevo", "sin_soya",
  "sin_sesamo", "sin_mostaza", "sin_apio", "sin_sulfitos", "sin_lupino",
  "sin_cerdo", "sin_alcohol", "embarazo",
  "vegetariano", "vegano", "pescetariano", "keto", "bajo_carbos",
] as const;

const CHIP_TO_TAG: Record<string, { tag: AllergenTag; strict: boolean; label: string }> = {
  sin_gluten:       { tag: "gluten",       strict: true,  label: "sin gluten" },
  sin_lactosa:      { tag: "lactosa",      strict: false, label: "sin lactosa" },
  sin_frutos_secos: { tag: "frutos_secos", strict: true,  label: "sin frutos secos" },
  sin_mani:         { tag: "mani",         strict: true,  label: "sin maní" },
  sin_mariscos:     { tag: "mariscos",     strict: true,  label: "sin mariscos" },
  sin_pescado:      { tag: "pescado",      strict: true,  label: "sin pescado" },
  sin_huevo:        { tag: "huevo",        strict: true,  label: "sin huevo" },
  sin_soya:         { tag: "soya",         strict: true,  label: "sin soya" },
  sin_sesamo:       { tag: "sesamo",       strict: true,  label: "sin sésamo" },
  sin_mostaza:      { tag: "mostaza",      strict: true,  label: "sin mostaza" },
  sin_apio:         { tag: "apio",         strict: true,  label: "sin apio" },
  sin_sulfitos:     { tag: "sulfitos",     strict: true,  label: "sin sulfitos" },
  sin_lupino:       { tag: "lupino",       strict: true,  label: "sin lupino" },
  sin_cerdo:        { tag: "cerdo",        strict: true,  label: "sin cerdo" },
  sin_alcohol:      { tag: "alcohol",      strict: true,  label: "sin alcohol" },
};

/** Embarazo: se evita lo que las guías de seguridad alimentaria desaconsejan (orientativo; lo confirma su matrona/obstetra). */
const PREGNANCY_TAGS: Array<{ tag: AllergenTag; why: string }> = [
  { tag: "alcohol", why: "alcohol" },
  { tag: "alto_mercurio", why: "pescados altos en mercurio" },
  { tag: "higado", why: "hígado (exceso de vitamina A)" },
  { tag: "crudo_ahumado", why: "pescado crudo o ahumado" },
];

const MED_NAME_TO_TYPE: Array<[RegExp, string]> = [
  [/gliflozin|jardiance|forxiga|farxiga|invokana/i, "sglt2"],
  [/metformina|glucophage/i, "metformin"],
  // Sin esto "Vildagliptina" no se reconocía y Eris improvisaba que "mejora la sensibilidad a la insulina" (2026-10-07)
  [/gliptin|galvus|januvia|trajenta|onglyza/i, "dpp4"],
  [/glp|semaglutid|liraglutid|ozempic|victoza|wegovy|saxenda|mounjaro|tirzepatid/i, "glp1"],
  [/insulina/i, "insulin_rapid"],
];

/** Tipos de medicamento activos. La app no puede guardar el `type`, así que también se infiere del nombre. */
export function medicationTypes(medical: MedicalProfile | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const m of medical?.medications ?? []) {
    if (!m.active) continue;
    if (m.type && m.type !== "other") out.add(m.type);
    for (const [re, t] of MED_NAME_TO_TYPE) if (re.test(m.name || "")) out.add(t);
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Palabras clave del texto libre → etiqueta. El orden no importa; un fragmento puede activar varias.
const KEYWORDS: Array<{ tag: AllergenTag; re: RegExp }> = [
  { tag: "gluten",       re: /gluten|trigo|celiac|celiaqu|cebada|centeno/ },
  { tag: "lactosa",      re: /lactosa|leche|lacteo|caseina|queso|yogur|yogurt/ },
  { tag: "huevo",        re: /huevo/ },
  { tag: "soya",         re: /soya|soja/ },
  { tag: "frutos_secos", re: /nuez|nueces|almendra|avellana|pistacho|castana|maranon|frutos? secos?|nueces/ },
  { tag: "mani",         re: /\bmani\b|cacahuate|cacahuete/ },
  { tag: "pescado",      re: /pescado|salmon|atun|merluza|reineta/ },
  { tag: "mariscos",     re: /marisco|camaron|langosta|cangrejo|almeja|choro|ostra|ostion|crustaceo|molusco|calamar|pulpo|jaiba|macha|centolla|erizo/ },
  { tag: "sesamo",       re: /sesamo|ajonjoli|tahini|tahina/ },
  { tag: "mostaza",      re: /mostaza/ },
  { tag: "apio",         re: /\bapio\b|celeri/ },
  { tag: "sulfitos",     re: /sulfito|sulfuroso|metabisulfito/ },
  { tag: "lupino",       re: /lupino|altramuz|chocho/ },
  { tag: "cerdo",        re: /cerdo|chancho|puerco/ },
  { tag: "alcohol",      re: /alcohol/ },
];

/** "no tengo ninguna" y similares: no son una alergia. */
const NONE_RE = /^(ninguna?s?|no( tengo)?|sin alergias?|n\/a|-|ninguna conocida)$/;

export function parseAllergyText(text: string | undefined): { hits: Array<{ tag: AllergenTag; strict: boolean; from: string }>; unparsed: string[] } {
  const hits: Array<{ tag: AllergenTag; strict: boolean; from: string }> = [];
  const unparsed: string[] = [];
  if (!text || !text.trim()) return { hits, unparsed };

  const fragments = norm(text).split(/[,;\n]|\by\b|\be\b|\//).map((f) => f.trim()).filter(Boolean);
  for (const frag of fragments) {
    if (NONE_RE.test(frag)) continue;
    let matched = false;
    for (const { tag, re } of KEYWORDS) {
      if (re.test(frag)) {
        matched = true;
        // Intolerancia a la lactosa (sin la palabra "alergia") no es estricta; todo lo demás sí, por seguridad.
        const strict = !(tag === "lactosa" && !/alergi|caseina/.test(frag));
        hits.push({ tag, strict, from: frag });
      }
    }
    if (!matched) unparsed.push(frag);
  }
  return { hits, unparsed };
}

const hasCondition = (m: MedicalProfile | null | undefined, id: string) => !!m?.conditions?.some((c: any) => c.id === id);

export function deriveRestrictions(medical: MedicalProfile | null | undefined): Restrictions {
  const excluded = new Map<AllergenTag, { strict: boolean; why: string }>();
  const labels: string[] = [];
  const cautions: Caution[] = [];
  let vegetarian = false;
  let vegan = false;
  let pescetarian = false;
  let keto = false;
  let lowCarb = false;

  const exclude = (tag: AllergenTag, strict: boolean, why: string, label: string) => {
    const prev = excluded.get(tag);
    // Si ya había una fuente, se queda la más estricta.
    if (!prev || (strict && !prev.strict)) excluded.set(tag, { strict: strict || !!prev?.strict, why });
    if (!labels.includes(label)) labels.push(label);
  };

  // 1) Condiciones
  const celiac = hasCondition(medical, "celiac");
  if (celiac) exclude("gluten", true, "celiaquía", "sin gluten (celiaquía)");

  if (hasCondition(medical, "diabetes_t1") || hasCondition(medical, "diabetes_t2") || hasCondition(medical, "prediabetes")) {
    cautions.push({ kind: "carbs", text: "diabetes/prediabetes: porciones de carbohidratos moderadas y de índice glucémico bajo o medio" });
  }
  if (hasCondition(medical, "hypertension")) {
    cautions.push({ kind: "sodium", text: "hipertensión: evitar alimentos muy salados (embutidos, aderezos, comida frita)" });
  }
  if (hasCondition(medical, "ckd")) {
    cautions.push({ kind: "potassium", text: "enfermedad renal: cuidado con potasio, sodio y exceso de proteína — el nefrólogo define los límites" });
    cautions.push({ kind: "protein", text: "enfermedad renal: no empujar la proteína alta sin indicación médica" });
    cautions.push({ kind: "sodium", text: "enfermedad renal: evitar alimentos muy salados" });
  }
  if (hasCondition(medical, "ibs")) {
    cautions.push({ kind: "fodmap", text: "colon irritable: pueden caer mal legumbres, cebolla, ajo, lácteos y algunas frutas" });
  }
  if (hasCondition(medical, "dyslipidemia")) {
    cautions.push({ kind: "sat_fat", text: "dislipidemia: preferir grasas de aceite de oliva, pescado y frutos secos sobre fritos y embutidos" });
  }

  // 2) Texto libre de alergias
  const parsed = parseAllergyText(medical?.allergies);
  for (const h of parsed.hits) {
    exclude(h.tag, h.strict, `alergia/intolerancia declarada ("${h.from}")`, `sin ${h.tag.replace("_", " ")}`);
  }

  // 2b) La dieta escrita a mano en el campo de alergias ("soy vegano", "vegetariana"): cuenta igual que el chip del
  // Perfil (2026-10-14: con "soy vegano" escrito así, el aviso de la cena sugería pollo). Ante la duda, se respeta.
  const DIET_TEXT: Array<[RegExp, string]> = [[/\bvegan(o|a|os|as)?\b/, "vegano"], [/\bvegetarian(o|a|os|as)\b/, "vegetariano"], [/\bpescetarian(o|a|os|as)\b/, "pescetariano"]];
  const dietFromText = new Set<string>();
  const unparsed = parsed.unparsed.filter((frag) => {
    let hit = false;
    for (const [re, id] of DIET_TEXT) if (re.test(frag)) { dietFromText.add(id); hit = true; }
    return !hit;
  });

  // 3) Chips estructurados (y la dieta escrita a mano)
  for (const id of new Set([...(medical?.dietaryRestrictions ?? []), ...dietFromText])) {
    const chip = CHIP_TO_TAG[id];
    if (chip) exclude(chip.tag, chip.strict, "restricción del perfil", chip.label);
    else if (id === "vegetariano") { vegetarian = true; labels.push("vegetariano"); }
    else if (id === "vegano") { vegetarian = true; vegan = true; labels.push("vegano"); }
    else if (id === "pescetariano") { pescetarian = true; labels.push("pescetariano"); }
    else if (id === "keto") { keto = true; labels.push("keto"); }
    else if (id === "bajo_carbos") { lowCarb = true; labels.push("bajo en carbohidratos"); }
    else if (id === "embarazo") {
      for (const p of PREGNANCY_TAGS) exclude(p.tag, true, "embarazo", `embarazo: sin ${p.why}`);
      cautions.push({ kind: "diet", text: "embarazo: cocina bien carnes y huevos, evita quesos sin pasteurizar y embutidos crudos; confirma todo con tu matrona u obstetra" });
    }
  }
  // Pescetariano y vegetariano se contradicen: manda el más estricto.
  if (vegetarian) pescetarian = false;
  if (keto) lowCarb = false;

  // Cuidados de las dietas (no excluyen alimentos; se dicen al recomendar)
  const meds = medicationTypes(medical);
  if (vegan) cautions.push({ kind: "diet", text: "vegano: la vitamina B12 no existe en alimentos vegetales, hay que suplementarla; cuida también hierro, zinc, calcio y omega-3 (confírmalo con tu médico)" });
  else if (vegetarian) cautions.push({ kind: "diet", text: "vegetariano: cuida el hierro, el zinc y la vitamina B12 (sobre todo si evitas huevos y lácteos)" });
  if (keto || lowCarb) {
    const risky = hasCondition(medical, "diabetes_t1") || meds.has("sglt2") || [...meds].some((t) => t.startsWith("insulin"));
    if (keto && risky) cautions.push({ kind: "diet", text: "IMPORTANTE: keto junto con insulina, un inhibidor SGLT2 o diabetes tipo 1 puede provocar cetoacidosis; hazlo solo con supervisión de tu médico" });
    else if (keto || hasCondition(medical, "diabetes_t2")) cautions.push({ kind: "diet", text: "keto/bajo en carbohidratos: si tomas medicamentos para la diabetes o la presión, tu médico puede tener que ajustarlos" });
    if (hasCondition(medical, "ckd")) cautions.push({ kind: "diet", text: "enfermedad renal: keto y las dietas altas en proteína deben aprobarlas tu nefrólogo" });
    if (keto) cautions.push({ kind: "diet", text: "keto: toma agua y cuida sodio, potasio y magnesio; las primeras semanas es normal sentir cansancio" });
  }

  return { excluded, vegetarian, vegan, pescetarian, keto, lowCarb, cautions, unparsed, labels, celiac };
}

export interface AllowedResult {
  ok: boolean;
  /** Por qué se descartó — sirve para decirle al usuario "excluí X porque…". */
  reason?: string;
  /** true = sabemos que NO cumple (contiene / lleva carne / muchos carbos); false = solo no se pudo confirmar. */
  definite?: boolean;
}

const TAG_LABEL: Record<string, string> = {
  frutos_secos: "frutos secos", sesamo: "sésamo", alto_mercurio: "pescado alto en mercurio", higado: "hígado",
  crudo_ahumado: "pescado crudo o ahumado", cerdo: "cerdo", alcohol: "alcohol", gelatina: "gelatina",
};

/**
 * Todas las razones por las que NO se puede dar por bueno este alimento (fail-closed), no solo la primera.
 * Antes `isAllowed` cortaba en la primera restricción que fallaba: con varias restricciones activas (ej.
 * "sin mariscos, sin mostaza, sin alcohol") un producto sin `verifiedFor` para ninguna solo avisaba de la
 * primera, dando a entender —sin querer— que las otras dos sí estaban confirmadas.
 */
function allChecks(food: FoodSafety, r: Restrictions): AllowedResult[] {
  const out: AllowedResult[] = [];
  for (const [tag, { strict }] of r.excluded) {
    // Intolerancia (no alergia) a la lactosa: si el alimento trae los gramos y son ~0 (quesos maduros, mantequilla), se tolera.
    // Solo aplica a lácteos de verdad (allergens incluye lactosa): un "0" de USDA en un pan o un embutido no prueba que no lleve leche.
    if (tag === "lactosa" && !strict && food.allergens?.includes("lactosa") && food.lactoseG !== undefined && food.lactoseG <= LACTOSE_TOLERABLE_G) continue;
    const present = !!food.allergens?.includes(tag);
    if (present) { out.push({ ok: false, definite: true, reason: `contiene ${TAG_LABEL[tag] ?? tag}` }); continue; }
    if (strict && food.traces?.includes(tag)) { out.push({ ok: false, definite: true, reason: `puede tener trazas de ${TAG_LABEL[tag] ?? tag}` }); continue; }
    if (!food.verifiedFor?.includes(tag)) {
      // Alcohol: si sabemos qué es y nada sugiere alcohol, no hay nada que avisar (ver puedeTenerAlcohol)
      if (tag === "alcohol" && (food.name || food.ingredients) && !puedeTenerAlcohol(`${food.name ?? ""} ${food.ingredients ?? ""}`)) continue;
      out.push({ ok: false, definite: false, reason: tag === "alcohol" ? "puede llevar alcohol: revisa la etiqueta o pregunta cómo se preparó" : `no puedo confirmar que esté libre de ${TAG_LABEL[tag] ?? tag}` });
    }
  }
  if (r.vegetarian) {
    if (food.meat === true) out.push({ ok: false, definite: true, reason: "lleva carne o pescado" });
    else if (food.meat !== false) out.push({ ok: false, definite: false, reason: "no puedo confirmar que no lleve carne" });
  }
  if (r.vegan) {
    if (food.animal === true) out.push({ ok: false, definite: true, reason: "tiene derivados animales" });
    else if (food.animal !== false) out.push({ ok: false, definite: false, reason: "no puedo confirmar que no tenga derivados animales" });
  }
  if (r.pescetarian) {
    if (food.landMeat === true) out.push({ ok: false, definite: true, reason: "lleva carne (no es pescetariano)" });
    else if (food.landMeat !== false) out.push({ ok: false, definite: false, reason: "no puedo confirmar que no lleve carne" });
  }
  if (r.keto || r.lowCarb) {
    const [max100, maxPortion, label] = r.keto ? [KETO_MAX_NET_100, KETO_MAX_NET_PORTION, "keto"] as const : [LOWCARB_MAX_NET_100, LOWCARB_MAX_NET_PORTION, "bajo en carbohidratos"] as const;
    if (food.netCarbs100 === undefined) {
      out.push({ ok: false, definite: false, reason: `no puedo calcular sus carbohidratos para ${label}` });
    } else {
      // Pasa si la porción habitual es pequeña (nueces, palta) O si es baja por 100 g Y la porción tampoco se dispara
      // (la leche tiene 5 g/100 ml pero un vaso trae 12 g: no es keto).
      const portion = food.netCarbsPortion;
      // "Porción chica" no rescata a lo que es casi puro carbohidrato (azúcar, miel, mermelada, fruta seca: >25 g netos/100 g).
      const okPortion = portion !== undefined && portion <= maxPortion && food.netCarbs100 <= PORTION_RULE_MAX_100;
      const okBoth = food.netCarbs100 <= max100 && (portion === undefined || portion <= maxPortion * 2);
      if (!okPortion && !okBoth) {
        out.push({ ok: false, definite: true, reason: `${Math.round(food.netCarbs100)} g de carbohidratos netos por 100 g: mucho para ${label}` });
      }
    }
  }
  return out;
}

/** ¿Se puede recomendar este alimento? fail-closed: sin verificación, no. Un solo motivo (el primero que aplica). */
export function isAllowed(food: FoodSafety, r: Restrictions): AllowedResult {
  const [first] = allChecks(food, r);
  return first ?? { ok: true };
}

/**
 * Igual que `isAllowed` pero junta TODOS los motivos, no solo el primero — para avisarle al usuario de cada
 * restricción que no se pudo confirmar en vez de solo una (ver `allChecks`).
 */
export function isAllowedFull(food: FoodSafety, r: Restrictions): { ok: boolean; blocked: string[]; unknown: string[] } {
  const checks = allChecks(food, r);
  return {
    ok: checks.length === 0,
    blocked: checks.filter((c) => c.definite).map((c) => c.reason!),
    unknown: checks.filter((c) => !c.definite).map((c) => c.reason!),
  };
}

export interface DailyLimits {
  sodiumMg: number;
  sugarG: number;
  fiberG: number;   // META a alcanzar, no un límite a no pasar
  fatG: number;
  proteinG: number; // META a alcanzar, igual que fibra
}

/**
 * Referencias de sodio/azúcar/fibra/grasa/proteína — antes Métricas solo mostraba CUÁNTO consumiste, nunca si
 * eso era mucho, poco o normal. No son configurables por el usuario (no tendría sentido que alguien se suba su
 * propio límite de sodio): se recalculan del perfil médico cada vez, igual que las `cautions` de arriba, pero
 * acá con un número en vez de solo un texto. Base: guías generales (OMS, FDA Daily Value); se ajustan a la baja
 * para las mismas condiciones que ya generan una `caution` arriba — no un criterio nuevo.
 */
export function dailyLimits(medical: MedicalProfile | null | undefined, weightKg?: number): DailyLimits {
  // Sodio: 2000 mg/día (OMS, población general); 1500 con hipertensión o enfermedad renal.
  const sodiumMg = (hasCondition(medical, "hypertension") || hasCondition(medical, "ckd")) ? 1500 : 2000;
  // Azúcares libres: 50 g/día (OMS, ~10% de una dieta de 2000 kcal); 25 g con diabetes o prediabetes.
  const sugarG = (hasCondition(medical, "diabetes_t1") || hasCondition(medical, "diabetes_t2") || hasCondition(medical, "prediabetes")) ? 25 : 50;
  // Fibra: 28 g/día (OMS) — meta, no cambia por condición conocida.
  const fiberG = 28;
  // Grasa total: 70 g/día (FDA Daily Value, ~30% de una dieta de 2000 kcal) de referencia general.
  const fatG = 70;
  // Proteína: 1,6 g/kg si se conoce el peso (quien entrena: por sobre eso no se gana más músculo); con enfermedad
  // renal, 0,8 como tope. Es la misma regla que DailyTargets.proteinRule —la fuente única de metas— para que el
  // análisis del día, el asesor y la app no muestren tres cifras distintas (antes aquí era 1,8 y en el asesor 1,2–1,6).
  const proteinG = weightKg
    ? Math.round(weightKg * (hasCondition(medical, "ckd") ? 0.8 : 1.6))
    : 60;
  return { sodiumMg, sugarG, fiberG, fatG, proteinG };
}

export function hasAnyRestriction(r: Restrictions): boolean {
  return r.excluded.size > 0 || r.vegetarian || r.vegan || r.pescetarian || r.keto || r.lowCarb;
}

/** Resumen en una línea para mostrar arriba de cada recomendación. */
export function describeRestrictions(r: Restrictions): string {
  const parts = [...r.labels];
  if (r.unparsed.length) parts.push(`(no pude interpretar: "${r.unparsed.join('", "')}" — revisa etiquetas de todo lo que comas)`);
  return parts.length ? parts.join(", ") : "sin restricciones registradas";
}
