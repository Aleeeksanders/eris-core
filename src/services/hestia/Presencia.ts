// ============================================================
// Hestia como JARVIS · L1 (2026-11-17): «Welcome home, sir». Con lo que manda el teléfono (C4):
//  - volviste a casa (el teléfono alcanza al PC por la red de la casa) después de 1 h o más fuera → la bienvenida: lo que te queda
//    del día, quién te escribió y, si hay, un aviso del equipo. Una vez cada 3 h como mucho (un corte del WiFi no cuenta: < 1 h);
//  - te pusiste los audífonos por primera vez en la mañana → el saludo del día (el mismo de la primera llamada: Saludo.ts), una vez.
// Las transiciones son puras (se prueban con relojes inventados); lo que se dice lo arma el código, sin el modelo.
// ============================================================
import type { Presencia } from "./Estado.js";
import type { Sensores } from "./Interrupciones.js";

/** Fuera al menos esto para que la vuelta merezca bienvenida (HESTIA_FUERA_MIN: el banco de pruebas parte con 0) */
export const FUERA_MIN = Number.isFinite(Number(process.env.HESTIA_FUERA_MIN)) && process.env.HESTIA_FUERA_MIN !== "" && process.env.HESTIA_FUERA_MIN != null
  ? Number(process.env.HESTIA_FUERA_MIN) : 60;
/** Entre una bienvenida y otra */
export const ENTRE_BIENVENIDAS_MIN = 180;
/** «En la mañana»: el saludo con los audífonos va entre estas horas */
export const MANANA = { desde: 5, hasta: 13 };

export type EventoPresencia = "bienvenida" | "saludo_audifonos";

/**
 * Lo que cambia con una lectura nueva del teléfono. `antes`: los sensores anteriores (null = la primera lectura desde que partió
 * el servidor: los audífonos ya puestos no cuentan como «te los pusiste»).
 */
export function alCambiar(p: Presencia, antes: Sensores | null, s: Sensores, ahora: Date): { presencia: Presencia; eventos: EventoPresencia[] } {
  const t = ahora.getTime(), iso = ahora.toISOString();
  const n: Presencia = { ...p };
  const eventos: EventoPresencia[] = [];
  if (s.enCasa !== null && s.enCasa !== p.enCasa) {
    if (s.enCasa) {
      const fuera = p.fueraDesde ? t - Date.parse(p.fueraDesde) : 0;
      const ultima = p.ultimaBienvenida ? t - Date.parse(p.ultimaBienvenida) : Infinity;
      if (p.enCasa === false && fuera >= FUERA_MIN * 60_000 && ultima >= ENTRE_BIENVENIDAS_MIN * 60_000) {
        eventos.push("bienvenida");
        n.ultimaBienvenida = iso;
      }
      n.fueraDesde = null;
    } else {
      n.fueraDesde = iso;
    }
    n.enCasa = s.enCasa;
    n.desde = iso;
  }
  const hoy = ahora.toDateString();
  const h = ahora.getHours();
  // (se marca como dicho recién cuando se dijo: si ahora no puede hablar, la próxima vez que te los pongas en la mañana)
  if (antes && !antes.audifonos && s.audifonos && h >= MANANA.desde && h < MANANA.hasta && p.saludoAudifonos !== hoy && !eventos.includes("bienvenida")) {
    eventos.push("saludo_audifonos");
  }
  return { presencia: n, eventos };
}

const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);
const minus = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const MAX_PALABRAS = 42;

export interface DatosBienvenida {
  /** cómo le dice (el «Nombre o alias» del perfil) */
  trato?: string | null;
  /** «Bienvenida» si su perfil dice mujer */
  mujer?: boolean;
  ahora: Date;
  /** la agenda del día (DayAgendaTool): de ahí sale «Lo que sigue» */
  agenda?: string | null;
  /** quién te escribió mientras estabas fuera (nombres; los textos no se leen) */
  remitentes?: string[];
  /** un aviso del equipo, ya dicho por el vigía (Vigia.ts), corto */
  equipo?: string | null;
}

/** Lo que sigue del día (la sección «Lo que sigue» de la agenda), como frases cortas */
export function loQueSigue(agenda: string | null | undefined, max = 2): string[] {
  const ls = String(agenda ?? "").split("\n");
  const i = ls.findIndex((l) => /\*\*Lo que sigue:\*\*/.test(l));
  if (i < 0) return [];
  return ls.slice(i + 1).map((l) => /^•\s*(.+)/.exec(l)?.[1]).filter((x): x is string => !!x)
    .map((x) => x.replace(/\*\*/g, "").replace(/~\s?(\d{1,2}:\d{2})/g, "a eso de las $1").replace(/\s*\(ya es su hora\)/, " (ya es su hora)").replace(/[.;:]+$/, "").trim())
    .map((x) => x.replace(/^Entreno:\s*(.+)$/i, (_m, q) => `el entreno de ${String(q).replace(/\s*\(cuando te acomode\)/, "").toLowerCase()}`)
      .replace(/^Agua:\s*/i, "agua, ").replace(/^(Desayuno|Almuerzo|Once|Cena)\b/, (m) => `${/^(Once|Cena)$/.test(m) ? "la" : "el"} ${m.toLowerCase()}`))
    .filter(Boolean).slice(0, max);
}

/** «Bienvenido a casa, Alesito. Te queda la cena a eso de las 20:30 y el entreno. Te escribieron tu mamá y Pedro.» */
export function armarBienvenida(d: DatosBienvenida): string {
  const trato = d.trato?.trim();
  const partes: string[] = [`${d.mujer ? "Bienvenida" : "Bienvenido"} a casa${trato ? `, ${trato}` : ""}.`];
  const sigue = loQueSigue(d.agenda);
  if (sigue.length) partes.push(`Lo que sigue: ${lista(sigue.map(minus))}.`);
  else if (d.agenda) partes.push("Por hoy no te queda nada pendiente.");
  const rem = [...new Set((d.remitentes ?? []).map((r) => r.trim()).filter(Boolean))];
  if (rem.length) partes.push(rem.length > 3 ? `Te escribieron ${rem.slice(0, 3).join(", ")} y ${rem.length - 3} más.` : `Te ${rem.length === 1 ? "escribió" : "escribieron"} ${lista(rem)}.`);
  if (d.equipo) partes.push(d.equipo.trim().replace(/([^.!?])$/, "$1."));
  const out: string[] = [];
  for (const p of partes) {
    if (out.length && [...out, p].join(" ").split(/\s+/).length > MAX_PALABRAS) continue;
    out.push(p);
  }
  return out.join(" ");
}
