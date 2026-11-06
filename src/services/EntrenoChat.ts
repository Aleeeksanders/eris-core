// ============================================================
// Eris — fuerza y días entrenados por chat, con los datos de Forge (2026-11-05)
//
// Chat real del 2026-11-05 («¿Qué tan fuerte estoy?»): después del score, «¿crees que soy fuerte?», «¿y para alguien que
// no entrena?» y «¿soy más fuerte que alguien normal?» iban al modelo sin sus datos: inventó una escala («un no entrenado
// está en 5–10/100»), se contradijo y terminó en «no tengo datos de fuerza en tu historial». «50 kilos de esta huea que se
// empuja» lo leyó como press militar (era el press de pecho en máquina, 110 lb) y «mi rutina de ayer», como algo que la
// app no guarda. Ahora lo responde el código con lo que manda el teléfono (projection.progress y projection.recent).
//
// Comparar con gente que NO entrena: no hay una tabla seria de eso. Strength Level (la que usa Forge) es de gente que
// entrena y anota sus levantamientos; su propia ayuda dice que esa comunidad probablemente es más fuerte que la población
// general, y su «Principiante» es el percentil 5 de esa gente (quien practica el ejercicio hace al menos un mes; en
// dominadas, hombres: menos de una repetición en casi todos los pesos). Consultado el 2026-11-05 en
// strengthlevel.com/faq y strengthlevel.com/strength-standards. Por eso se dice «lo más probable», nunca un porcentaje.
//
// Cada respuesta trae su `veredicto` (una línea) que el tono «brígida» pone primero (Tone.ts, QueryEngine.finishQuick).
// Puro: se prueba con bun.
// ============================================================
import type { RecentDay, RecoveryContext } from "./TrainingIntent.js";

export const fold = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DIA_RE = "lunes|martes|miercoles|jueves|viernes|sabado|domingo";
const CUANDO = `ayer|hoy|anteayer|antier|antes de ayer|el (${DIA_RE})( pasado)?|(el )?(${DIA_RE})( pasado)?|el \\d{1,2}( de \\w+)?`;

/** «¿Crees que soy fuerte?», «¿soy más fuerte que alguien normal?», «¿fuerte para alguien que no entrena?» */
export const FUERZA_OPINION = /\b(soy (muy |bien |harto |tan )?fuerte|crees que soy fuerte|que tan fuerte soy|cuan fuerte soy|(mas|menos) fuerte que (alguien|la gente|una persona|el promedio|lo normal|lo comun|un \w+|una \w+|otros|los demas|la mayoria|el resto)|fuerte (para|comparado con|al lado de) (alguien|una persona|la gente|mi edad|mi peso|no entrenar|el promedio|un \w+))\b/;
/** La comparación que pide: con gente que no entrena / el promedio */
export const CONTRA_CALLE = /\b(no entrena\w*|sedentari\w*|normal(es)?|promedio|comun(es)?|la gente|la mayoria|de la calle|cualquier\w*|alguien|una persona)\b/;

/** «¿Qué hice ayer?», «mi rutina de ayer», «lo que entrené el domingo», «mi último entreno» */
export const DIA_ASK = new RegExp(
  `\\b((que|lo que) (hice|entrene|trabaje|levante) (${CUANDO})` +
  `|mi (rutina|entreno|entrenamiento|sesion) (de|del) (ayer|anteayer|antier|antes de ayer|(el )?(${DIA_RE})( pasado)?|el \\d{1,2})` +
  `|(rutina|entreno|entrenamiento|sesion) (de|del) (ayer|anteayer|antier|antes de ayer)` +
  `|(cual fue |cual es )?mi ultimo (entreno|entrenamiento|dia de gym|dia de gimnasio)|que fue lo ultimo que entrene)\\b`,
);

const KILOS_RE = /(\d+(?:[.,]\d+)?)\s*(kilos?|kgs?|libras?|lbs?)\b/;
const LEVANTA = /\b(puedo (hacer|levantar|mover|empujar|tirar|jalar|subir|meter)|levanto|muevo|empujo|tiro|jalo|meto|le pongo|le meto|le doy|le puse|le meti|le di|hice|levante|movi|empuje|tire|jale|que se (empuja|tira|jala)|de (esta|esa|la) (huea|hueá|wea|cosa|maquina)|en (la|esa|esta) maquina)\b/;
const NO_KILOS = /\b(peso|pese|pesaba|bajar|baje|engord\w*|adelgac\w*|comi|comer|gramos|kilos? de (pan|papas?|arroz|carne|pollo|fruta|azucar|harina|tomates?|manzanas?|platanos?)|registra\w*|anota\w*|guarda\w*|cambia\w*|ponle|sube(le)? a|bajale)\b/;

/** «50 kilos de esta huea que se empuja» → { kg: 50, patron: "empuje" }; null si no habla de una carga levantada */
export function parseKilos(texto: string): { kg: number; patron: "empuje" | "tiron" | "pierna" | null; dicho: string } | null {
  const t = fold(texto);
  const m = t.match(KILOS_RE);
  if (!m || !LEVANTA.test(t) || NO_KILOS.test(t)) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 600) return null;
  const kg = /^l/.test(m[2]) ? n * 0.45359237 : n;
  const patron = /\bempuj\w*|\bpress\b|\bpecho\b|\bbanca\b/.test(t) ? "empuje" : /\b(tir|jal|rem)\w*|\bdominad\w*/.test(t) ? "tiron" : /\b(pierna|sentadill\w*|prensa|cuadricep\w*)\b/.test(t) ? "pierna" : null;
  return { kg, patron, dicho: `${m[1]} ${m[2]}` };
}

const kgTxt = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** El día que pide («ayer», «el domingo», «el 18»); null si no nombra uno (= el último entrenado) */
export function diaPedido(texto: string, now = new Date()): string | null {
  const t = fold(texto);
  const atras = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return keyOf(d); };
  if (/\b(anteayer|antier|antes de ayer)\b/.test(t)) return atras(2);
  if (/\bayer\b/.test(t)) return atras(1);
  const dia = t.match(new RegExp(`\\b(${DIA_RE})\\b`));
  if (dia) {
    const w = DIAS.indexOf(dia[1]);
    let n = (now.getDay() - w + 7) % 7;
    if (n === 0 && !/\bhoy\b/.test(t)) n = 7;
    return atras(n);
  }
  if (/\bhoy\b/.test(t)) return atras(0);
  const num = t.match(/\bel (\d{1,2})\b/);
  if (num) {
    const d = Number(num[1]);
    if (d >= 1 && d <= 31) {
      const x = new Date(now.getFullYear(), now.getMonth(), d);
      if (x > now) x.setMonth(x.getMonth() - 1);
      return keyOf(x);
    }
  }
  return null;
}

export interface Respuesta { texto: string; veredicto: string }

const SIN_HISTORIAL = "Todavía no me llega tu historial día por día de Forge: actualiza la app y abre Forge una vez con conexión, y te lo cuento.";

/** «¿Qué hice ayer?», «mi rutina del domingo»: lo que anotó en Forge ese día (o el último día entrenado) */
export function respuestaDia(texto: string, recent: RecentDay[] | undefined, now = new Date()): Respuesta {
  if (!recent) return { texto: SIN_HISTORIAL, veredicto: "Ese dato no me ha llegado." };
  const pedido = diaPedido(texto, now);
  const hoy = keyOf(now);
  const lista = (d: RecentDay) => d.items.map((x) => `• ${x.name}: ${x.text}`).join("\n");
  const series = (d: RecentDay) => d.items.reduce((a, x) => a + (Number(x.text.match(/^(\d+) series?/)?.[1]) || 0), 0);
  if (pedido) {
    const d = recent.find((x) => x.day === pedido);
    const cuando = pedido === hoy ? "Hoy" : pedido === keyOf(new Date(now.getTime() - 86400000)) ? "Ayer" : null;
    if (d) {
      const n = series(d);
      return {
        texto: `${cuando ? `${cuando} (${d.label})` : `El ${d.label}`} hiciste:\n${lista(d)}`,
        veredicto: `${cuando ?? `El ${d.label}`} le diste: ${d.items.length} ${d.items.length === 1 ? "ejercicio" : "ejercicios"}${n ? `, ${n} series` : ""}.`,
      };
    }
    const ult = recent.find((x) => x.day < pedido) ?? recent[0];
    const nombre = cuando ? cuando.toLowerCase() : `el ${pedido.split("-").reverse().slice(0, 2).join("/")}`;
    if (!ult) return { texto: `No tengo entrenos anotados en Forge en tus últimos días.`, veredicto: "No hay entrenos anotados." };
    return {
      texto: `${cuando ?? "Ese día"} no anotaste entreno en Forge. Lo último antes fue el ${ult.label}:\n${lista(ult)}`,
      veredicto: `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} no anotaste entreno.`,
    };
  }
  const ult = recent[0];
  if (!ult) return { texto: "No tengo entrenos anotados en Forge en tus últimos días.", veredicto: "No hay entrenos anotados." };
  return { texto: `Tu último entreno fue el ${ult.label}:\n${lista(ult)}`, veredicto: `Lo último fue el ${ult.label}.` };
}

/** «50 kilos de esta huea que se empuja»: el ejercicio de sus últimos días con esa carga */
export function respuestaKilos(q: { kg: number; patron: string | null; dicho: string }, recent: RecentDay[] | undefined, lifts: Array<{ name: string; level: string; pct: number }> = []): Respuesta | null {
  if (!recent) return { texto: SIN_HISTORIAL, veredicto: "Ese dato no me ha llegado." };
  const cand = recent.flatMap((d) => d.items.filter((x) => x.kg != null && Math.abs(x.kg - q.kg) <= Math.max(2, q.kg * 0.07)).map((x) => ({ d, x })));
  if (!cand.length) return null;
  const grupo = q.patron === "empuje" ? "empuje" : q.patron === "tiron" ? "tiron" : q.patron === "pierna" ? "pierna" : null;
  const best = (grupo && cand.find((c) => c.x.group === grupo)) || cand[0];
  const lift = lifts.find((l) => fold(best.x.name).includes(fold(l.name)) || fold(l.name).includes(fold(best.x.name)));
  const nivel = lift
    ? `Ahí estás en nivel ${lift.level} (percentil ${lift.pct} entre gente que entrena, de tu peso y sexo).`
    : "En máquinas no hay una tabla seria para compararte (cada máquina pesa distinto), así que no entra en tu score de fuerza.";
  return {
    texto: `Eso es el **${best.x.name}**: el ${best.d.label} hiciste ${best.x.text}.\n${nivel}`,
    veredicto: `Cierto: ${best.x.name.charAt(0).toLowerCase()}${best.x.name.slice(1)}, ~${kgTxt(best.x.kg!)} kg. Eso cuenta.`,
  };
}

interface Progreso {
  score?: number | null;
  lifts?: Array<{ name: string; e1rm: number; level: string; pct: number }>;
  month?: { sessions: number; prev?: number; streak?: number } | null;
}

const nivelDe = (pct: number) => (pct < 5 ? "recién empezando" : pct < 20 ? "Principiante" : pct < 50 ? "Novato" : pct < 80 ? "Intermedio" : pct < 95 ? "Avanzado" : "Élite");

/** El empujón por constancia (solo si entrena poco) */
function constancia(p: Progreso): string {
  const s = p.month?.sessions;
  return typeof s === "number" && s < 8 ? ` Con ${s} ${s === 1 ? "entreno" : "entrenos"} al mes no vas a despegar.` : "";
}

/** «¿Qué tan fuerte estoy?» (el resumen ya lo arma progressReply): el veredicto */
export function veredictoProgreso(p: Progreso): string {
  if (p.score == null) return "Todavía no tengo cómo medirte: anota tus series con peso en Forge.";
  const s = p.score;
  const base = s >= 80 ? "Fuerte de verdad." : s >= 50 ? "Fuerte: más que la mitad de los que entrenan." : s >= 20 ? "Vas bien, pero hay harto por subir." : s >= 5 ? `Estás partiendo: percentil ${s} entre los que entrenan.` : "Recién partiendo.";
  return base + constancia(p);
}

/** «¿Crees que soy fuerte?», «¿más que alguien que no entrena?»: con sus cifras y sin inventar una escala */
export function fuerzaComparada(p: Progreso | null | undefined, contraCalle: boolean): Respuesta {
  if (!p || p.score == null || !p.lifts?.length) {
    return { texto: "Aún no tengo series suficientes para medir tu fuerza: anota tus series con peso y repeticiones en Forge y te lo digo con cifras.", veredicto: "No te puedo decir sin datos." };
  }
  const lifts = p.lifts;
  const sobre = lifts.filter((l) => l.level !== "Empezando" && l.pct >= 5);
  const domina = lifts.find((l) => /dominad/i.test(l.name) && l.level !== "Empezando");
  const mayoria = sobre.length >= Math.ceil(lifts.length * 0.6);
  const out: string[] = [];
  out.push(`Entre los que entrenan estás en el percentil ${p.score} (nivel ${nivelDe(p.score)}): de cada 100 personas que entrenan, ${p.score} son menos fuertes que tú.`);
  if (contraCalle || p.score < 50) {
    out.push("Contra gente que no entrena no hay una tabla seria: la que uso (Strength Level) es de gente que entrena y anota sus levantamientos, que según ellos mismos es más fuerte que la población general.");
    out.push(`Tú pasas el nivel Principiante (el de alguien que practica hace al menos un mes) en ${sobre.length} de ${lifts.length} levantamientos.${domina ? " Y haces dominadas con tu peso: en esa tabla un principiante hace como mucho una." : ""}`);
    out.push(mayoria ? "Lo más probable: sí, eres más fuerte que el promedio de la gente que no entrena."
      : sobre.length ? "Lo más probable: algo más fuerte que el promedio de la gente que no entrena, no mucho."
        : "Lo más probable: parecido al promedio de la gente que no entrena; con constancia eso cambia rápido.");
  }
  if (p.month) out.push(`En los últimos 30 días: ${p.month.sessions} entrenos${p.month.prev != null ? ` (los 30 anteriores: ${p.month.prev})` : ""}.${p.month.sessions < 8 ? " Para subir de nivel, lo que más pesa es la constancia: 3 entrenos por semana." : ""}`);
  const veredicto = p.score >= 50 ? "Sí, fuerte de verdad." : mayoria ? "Para la calle, sí. Para el gym, todavía no." : sobre.length ? "Más o menos: algo sobre el promedio, nada más." : "Todavía no, pero se arregla entrenando.";
  return { texto: out.join("\n"), veredicto: veredicto + constancia(p) };
}

/** «¿Qué me toca hoy?»: el veredicto */
export function veredictoHoy(today: { rest: boolean; name: string | null; doneSets: number } | null | undefined): string | undefined {
  if (!today) return undefined;
  if (today.rest) return "Hoy toca descanso. Descansa de verdad.";
  return today.doneSets > 0 ? "Ya partiste: termínalo." : `Hoy toca ${today.name ?? "entrenar"}. Sin cuento.`;
}

// ─── La recuperación (2026-11-06; la evidencia está en forge/forgeRecovery.ts) ────────────────────────────────────────

/** «¿Estoy recuperado?», «tengo agujetas», «¿cuánto tardo en recuperarme?» (lo de suplementos va a su ficha) */
export const RECUPERACION_ASK = /\b(agujetas?|estoy recuperad\w*|ya (me )?recuper\w*|(cuanto|cuando|como) .{0,30}recuper\w*|tiempo de recuperacion|recuperacion muscular|sigo adolorid\w*|estoy adolorid\w*|ando adolorid\w*|estoy listo para entrenar)\b/;
const ES_DE_AGUJETAS = /\b(agujetas?|adolorid\w*)\b/;

const horasTxt = (h: number) => (h < 48 ? `${h} h` : `${Math.round(h / 24)} días`);
const juntar = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}` : xs[0] ?? "");

/** Lo demás que influye: sin horas inventadas, porque ningún estudio da una fórmula */
export interface RecuperacionExtras { suenoH?: number | null; proteinaAyer?: number | null; proteinaMeta?: number | null }

export function respuestaRecuperacion(rec: RecoveryContext | undefined | null, texto: string, ex: RecuperacionExtras = {}): Respuesta {
  const agujetas = ES_DE_AGUJETAS.test(fold(texto));
  const out: string[] = [];
  if (agujetas) out.push("Las agujetas son un proceso normal y, por sí solas, no significan que el músculo no rinda: en gente que entrena seguido la fuerza vuelve antes que el dolor (a las 48 h el dolor puede estar en su peak y el rendimiento ya de vuelta). Si no estás acostumbrado a ese ejercicio, sí puede bajar más.");
  const ms = rec?.musculos ?? [];
  if (ms.length) {
    const top = ms.slice(0, 3);
    const m0 = top[0];
    out.push(`${m0.fallo >= 0.5 ? "Tu última carga fuerte" : "Lo último"}: ${juntar(top.map((m) => m.nombre))}, hace ${horasTxt(m0.hoursAgo)} (${m0.sets} series${m0.fallo >= 0.5 ? ", casi todas cerca del fallo" : ""}${m0.habitual ? "" : ", y no lo entrenas tan seguido"}). Estimo que rinde normal entre ${horasTxt(m0.range[0])} y ${horasTxt(m0.range[1])}; es una estimación y varía de persona a persona.`);
  } else if (!agujetas) {
    out.push("No tengo trabajo reciente anotado en Forge: por lo que veo, ningún músculo viene cargado.");
  }
  if (rec?.personal) out.push(rec.personal);
  if (typeof ex.suenoH === "number" && ex.suenoH > 0 && ex.suenoH < 6) out.push(`Vienes durmiendo ~${kgTxt(ex.suenoH)} h: eso baja algo el rendimiento, más en ejercicios grandes.`);
  if (typeof ex.proteinaAyer === "number" && ex.proteinaAyer > 0 && ex.proteinaMeta && ex.proteinaAyer < ex.proteinaMeta * 0.7) out.push(`Ayer anotaste ${Math.round(ex.proteinaAyer)} de ${Math.round(ex.proteinaMeta)} g de proteína: comerla cerca del entreno ayuda a conservar fuerza.`);
  out.push("La prueba real es tu primera serie: con la misma carga, si haces lo de siempre, estás bien; si las repeticiones bajan harto, corta el volumen de hoy.");
  if (agujetas) out.push("Si el dolor es muy fuerte, hay mucha hinchazón u orina oscura, eso ya no son agujetas normales: consulta.");
  const st = ms[0]?.state;
  const veredicto = (agujetas ? "Agujetas no es lo mismo que no estar recuperado. " : "")
    + (st === "cargado" ? "Ese músculo va recién cargado: hoy dale a otro." : st === "probable" ? "Probablemente ya rindes: pruébate en la primera serie." : st === "listo" ? "Por tiempo, ya estás: dale." : "Dale y mira tu primera serie.");
  return { texto: out.join("\n"), veredicto };
}
