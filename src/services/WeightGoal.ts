// ============================================================
// Eris — WeightGoal (2026-10-23, «Eris como Jarvis»)
//
// «Quiero bajar 3 kilos para diciembre, ¿qué hago?»: el ritmo, el déficit y dónde se ajusta, con SU cuerpo y SUS metas.
// Antes el modelo hablaba del agua o daba consejos genéricos. Reglas (con respaldo, sin dietas extremas):
//   - ritmo seguro: hasta ~1 % del peso por semana; lo cómodo, 0,5–0,75 % (se pierde grasa y no músculo);
//   - ~7.700 kcal por kilo de grasa → el déficit diario sale del ritmo;
//   - nunca bajo un piso (el basal, y 1.500 kcal en hombres / 1.200 en mujeres) ni más de un 25 % bajo la mantención;
//   - proteína alta en déficit (1,8–2,2 g/kg) y seguir con la fuerza; con enfermedad renal la proteína es un tope (su médico).
// Si la fecha pide un ritmo inseguro, se dice y se propone la fecha realista. «Medir sin obsesión»: el promedio de la semana.
// ============================================================

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const NUM: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, medio: 0.5 };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const KG_PER_KCAL = 1 / 7700;

export interface WeightGoalAsk { dir: "bajar" | "subir"; kg: number; by?: Date; byText?: string }

/** «bajar 3 kilos para diciembre», «perder 5 kg en 2 meses», «subir 2 kilos de músculo» */
export function parseWeightGoal(message: string, now: Date = new Date()): WeightGoalAsk | null {
  const t = fold(message || "").replace(/[¿?¡!]/g, " ");
  if (t.length > 220) return null;
  const m = t.match(/\b(bajar|perder|bajarme|adelgazar|botar|subir|ganar)\s+(?:unos?\s+|como\s+)?(\d+(?:[.,]\d+)?|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|medio)\s*(kilos?|kg|kgs|kilogramos?)\b/);
  if (!m) return null;
  // «comí» o «bajé 3 kilos» (pasado) no es una meta
  if (/\b(baje|perdi|subi|gane)\b/.test(t) && !/\b(quiero|quisiera|necesito|me gustaria|como (hago|puedo)|que hago|meta|objetivo)\b/.test(t)) return null;
  const kg = NUM[m[2]] ?? Number(m[2].replace(",", "."));
  if (!(kg > 0 && kg <= 40)) return null;
  const dir = /^(subir|ganar)$/.test(m[1]) ? "subir" : "bajar";
  const by = deadlineOf(t, now);
  return { dir, kg, ...(by ? { by: by.date, byText: by.text } : {}) };
}

function deadlineOf(t: string, now: Date): { date: Date; text: string } | null {
  const y = now.getFullYear();
  const at = (yy: number, mm: number, dd: number) => new Date(yy, mm, dd, 12);
  const future = (d: Date) => (d.getTime() > now.getTime() + 86_400_000 ? d : at(d.getFullYear() + 1, d.getMonth(), d.getDate()));
  const fmt = (d: Date) => `al ${d.getDate()} de ${MESES[d.getMonth()]}`;
  let m = t.match(/\ben (\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez) (semanas?|mes(?:es)?)\b/);
  if (m) {
    const n = NUM[m[1]] ?? Number(m[1]);
    const d = new Date(now); d.setDate(d.getDate() + Math.round(/^sem/.test(m[2]) ? n * 7 : n * 30.4));
    return { date: d, text: n === 1 ? (/^sem/.test(m[2]) ? "en una semana" : "en un mes") : `en ${n} ${m[2]}` };
  }
  m = t.match(new RegExp(`\\b(?:para|antes del?|al|hasta)\\s+(?:el\\s+)?(\\d{1,2})\\s+de\\s+(${MESES.join("|")})\\b`));
  if (m) { const d = future(at(y, MESES.indexOf(m[2]), Number(m[1]))); return { date: d, text: fmt(d) }; }
  if (/\b(navidad)\b/.test(t)) { const d = future(at(y, 11, 24)); return { date: d, text: "para Navidad" }; }
  if (/\b(fin de ano|ano nuevo)\b/.test(t)) { const d = future(at(y, 11, 31)); return { date: d, text: "para fin de año" }; }
  if (/\b(el verano|verano)\b/.test(t)) { const d = future(at(y, 11, 21)); return { date: d, text: "para el verano (21 de diciembre)" }; }
  m = t.match(new RegExp(`\\b(?:para|en|antes de|a)\\s+(?:fines? de\\s+|fin de\\s+)?(${MESES.join("|")})\\b`));
  if (m) {
    const mm = MESES.indexOf(m[1]);
    const fin = /\bfin(es)? de\b/.test(t);
    // «para diciembre»: al 1 de diciembre (el mes en curso: a fin de mes)
    let d = fin || mm === now.getMonth() ? at(y, mm + 1, 0) : at(y, mm, 1);
    d = future(d);
    return { date: d, text: fin || mm === now.getMonth() ? `para fin de ${m[1]}` : `al 1 de ${m[1]}` };
  }
  return null;
}

export interface WeightGoalPlan {
  weeks: number | null;
  ratePerWeek: number;      // kg por semana
  ratePct: number;          // % del peso por semana
  tooFast: boolean;
  realisticDate?: Date;     // con un ritmo seguro (0,75 %/sem)
  dailyKcalDelta: number;   // − déficit / + superávit
  kcalTarget: number | null;
  maintenance: number | null;
  floorHit: boolean;
  protein?: [number, number];
}

/** El plan: ritmo, déficit (o superávit) y la meta de calorías, respetando el piso. */
export function planWeightGoal(g: WeightGoalAsk, body: { weightKg: number; sex?: string | null; bmr?: number | null; maintenance?: number | null; proteinIsCap?: boolean }, now: Date = new Date()): WeightGoalPlan {
  const w = body.weightKg;
  const safePct = g.dir === "bajar" ? 0.0075 : 0.0035;   // lo cómodo
  const maxPct = g.dir === "bajar" ? 0.01 : 0.005;       // el máximo razonable
  const weeks = g.by ? Math.max(0.5, (g.by.getTime() - now.getTime()) / (7 * 86_400_000)) : null;
  let rate = weeks ? g.kg / weeks : w * safePct;
  const tooFast = rate > w * maxPct + 1e-9;
  let realisticDate: Date | undefined;
  if (tooFast || !weeks) {
    const wk = g.kg / (w * safePct);
    realisticDate = new Date(now.getTime() + wk * 7 * 86_400_000);
    if (tooFast) rate = w * safePct;
  }
  let delta = g.dir === "bajar" ? -(rate / KG_PER_KCAL) / 7 : Math.min(350, (rate / KG_PER_KCAL) / 7);
  let kcalTarget: number | null = null;
  let floorHit = false;
  if (body.maintenance && body.maintenance > 0) {
    const floor = Math.max(body.bmr ?? 0, /^(m|f|mujer)/i.test(String(body.sex ?? "")) ? 1200 : 1500, body.maintenance * 0.75);
    let k = body.maintenance + delta;
    if (k < floor) { k = floor; floorHit = true; delta = k - body.maintenance; }
    kcalTarget = Math.round(k / 50) * 50;
  }
  return {
    weeks: weeks != null ? Math.round(weeks * 10) / 10 : null, ratePerWeek: Math.round(rate * 100) / 100, ratePct: Math.round((rate / w) * 1000) / 10,
    tooFast, realisticDate, dailyKcalDelta: Math.round(delta / 10) * 10, kcalTarget, maintenance: body.maintenance ? Math.round(body.maintenance / 10) * 10 : null, floorHit,
    ...(body.proteinIsCap ? {} : { protein: [Math.round((w * 1.8) / 5) * 5, Math.round((w * 2.2) / 5) * 5] as [number, number] }),
  };
}

const dec = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
const kc = (n: number) => Math.round(n).toLocaleString("es-CL");
const fecha = (d: Date) => `${d.getDate()} de ${MESES[d.getMonth()]}`;

/** La respuesta en palabras. `goal`: el objetivo de Forge que tiene hoy; `forgeKcal`: la meta que le deja Forge hoy. */
export function weightGoalText(g: WeightGoalAsk, p: WeightGoalPlan, o: { weightKg: number; goal?: string | null; forgeKcal?: number | null; diabetes?: boolean; renal?: boolean }): string {
  const verbo = g.dir === "bajar" ? "bajar" : "subir";
  const out: string[] = [];
  const meta = `${verbo} ${dec(g.kg)} kg${g.byText ? ` ${g.byText}` : ""}`;
  if (p.weeks != null && !p.tooFast) {
    out.push(`Para ${meta} (${dec(p.weeks)} semanas) necesitas ~${dec(p.ratePerWeek)} kg por semana: es un ritmo ${p.ratePct <= (g.dir === "bajar" ? 0.75 : 0.35) ? "seguro y sostenible" : "exigente pero razonable"} (${dec(p.ratePct)} % de tu peso a la semana).`);
  } else if (p.tooFast) {
    out.push(`${meta[0].toUpperCase()}${meta.slice(1)} pediría ~${dec(g.kg / (p.weeks ?? 1))} kg por semana: es más rápido de lo que conviene (se pierde músculo y cuesta sostenerlo).`);
    if (p.realisticDate) out.push(`A un ritmo seguro (~${dec(p.ratePerWeek)} kg por semana) llegas cerca del **${fecha(p.realisticDate)}**.`);
  } else if (p.realisticDate) {
    out.push(`A un ritmo cómodo (~${dec(p.ratePerWeek)} kg por semana) puedes ${verbo} ${dec(g.kg)} kg cerca del **${fecha(p.realisticDate)}**.`);
  }
  if (p.kcalTarget) {
    out.push(g.dir === "bajar"
      ? `Eso es un déficit de ~${kc(p.maintenance ? p.maintenance - p.kcalTarget : -p.dailyKcalDelta)} kcal al día: comer ~**${kc(p.kcalTarget)} kcal** en vez de tus ~${kc(p.maintenance ?? p.kcalTarget - p.dailyKcalDelta)} de mantención.${p.floorHit ? " (No bajo de ese piso: menos te dejaría sin energía para entrenar y vivir.)" : ""}`
      : `Eso es un superávit de ~${kc(p.maintenance ? p.kcalTarget - p.maintenance : p.dailyKcalDelta)} kcal al día: comer ~**${kc(p.kcalTarget)} kcal**, con entrenamiento de fuerza para que sea músculo.`);
  } else out.push("Para darte las calorías exactas me falta tu peso, altura y edad (Forge › Personaje › Cuerpo y metas).");
  if (p.protein) out.push(`Proteína: entre ${p.protein[0]} y ${p.protein[1]} g al día (1,8–2,2 g/kg), y sigue con tu rutina de fuerza: así ${g.dir === "bajar" ? "lo que bajas es grasa y no músculo" : "lo que subes es músculo"}.`);
  else if (o.renal) out.push("Con tu condición renal la proteína tiene un tope que define tu médico: no la subas por tu cuenta.");
  // Dónde se ajusta
  const goalWord = g.dir === "bajar" ? "perder" : "ganar";
  if (o.goal === goalWord) {
    out.push(o.forgeKcal ? `Tu objetivo en Forge ya es «${g.dir === "bajar" ? "Perder grasa" : "Ganar músculo"}»: hoy tu meta es ${kc(o.forgeKcal)} kcal.${p.kcalTarget && Math.abs(o.forgeKcal - p.kcalTarget) > 150 ? ` Para esta fecha, fíjala en ~${kc(p.kcalTarget)} en Perfil › Metas nutricionales (o pídemelo).` : ""}` : `Tu objetivo en Forge ya es «${g.dir === "bajar" ? "Perder grasa" : "Ganar músculo"}».`);
  } else {
    out.push(`Para que tus metas de cada día se ajusten solas, pon el objetivo «${g.dir === "bajar" ? "Perder grasa" : "Ganar músculo"}» en Forge › Personaje › Cuerpo y metas${p.kcalTarget ? `, o fija ~${kc(p.kcalTarget)} kcal en Perfil › Metas nutricionales` : ""}.`);
  }
  if (o.diabetes && g.dir === "bajar") out.push("Con tu diabetes, bajar de peso suele ayudar; si vas a cambiar mucho lo que comes, avísale a tu médico por tus remedios.");
  out.push("Para medirlo sin obsesionarte: pésate 2–3 veces por semana, en ayunas, y mira el promedio de la semana (el peso de un día sube y baja por agua).");
  return out.join("\n\n");
}
