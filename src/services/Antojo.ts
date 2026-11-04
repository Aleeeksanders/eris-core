// ============================================================
// Eris — Antojos con contrapartida y modo estricto (fase I7, 2026-10-23)
//
// Decisión del usuario: «contrapartida por defecto + modo estricto opcional». Ante un antojo que no calza con el día
// («¿y si me como un completo?», «tengo antojo de pizza»), Eris muestra el impacto (WhatIfFood) y una CONTRAPARTIDA CONCRETA:
//   - la próxima comida principal más liviana (hasta 40 % menos de lo típico de esa comida);
//   - y, si no alcanza, minutos de caminata según su peso (~3,5 MET), hasta 45 min (suave: el resto se dice y no se exige).
// Sin modo estricto es una sugerencia (se puede aceptar como «trato»). Con el modo estricto (Perfil), Eris se lo recomienda
// SOLO si acepta la contrapartida; si no, propone otra cosa. Aceptada, queda el trato del día: la comida compensada sale más
// liviana en el asesor y Eris lo recuerda en «¿cómo voy hoy?».
// «Medir sin obsesión»: nunca se compensa al día siguiente, no hay culpa, y si aun así se pasa un poco, se dice que un día así
// no es un problema. Con insuficiencia cardíaca o EPOC no se indica caminar: la actividad la define su médico.
// ============================================================

import { expectedShareAt } from "./NutritionQualityCore.js";
import { normDayHour, MEAL_NAME } from "./MealSchedule.js";

/** Lo típico de cada comida principal (fracción de la energía del día, el medio de SLOT_INFO del núcleo de calidad) */
const TIPICO: Record<string, number> = { almuerzo: 0.33, once: 0.18, cena: 0.23 };
/** La próxima comida principal después del antojo */
const SIGUIENTE: Record<string, string | null> = {
  desayuno: "almuerzo", colacion_am: "almuerzo", almuerzo: "cena", colacion_pm: "cena", merienda: "cena", once: "cena", cena: null,
};
const SIN_CAMINAR = new Set(["heart_failure", "copd"]);
const r5 = (n: number) => Math.ceil(n / 5) * 5;
/** Caminar para compensar: tope suave (lo que no alcance se dice, sin exigirlo ni pasarlo a mañana) */
const CAMINATA_MAX = 45;

export interface Contrapartida {
  /** lo que el día quedaría sobre la meta de energía, contando lo típico del resto del día (kcal) */
  excesoKcal: number;
  /** la próxima comida principal más liviana */
  comidaMenos?: { slot: string; nombre: string; kcal: number; tipico: number };
  caminataMin?: number;
  caminataKcal?: number;
  /** lo que queda aun con la contrapartida (un día así no es un problema) */
  resto?: number;
  /** si lo que empeora es la calidad: el acompañamiento o cambio que más ayuda (WhatIfFood.alternatives) */
  calidad?: string;
  /** no se indica caminar (condición): la actividad la define su médico */
  sinCaminar?: boolean;
}

export interface AntojoInput {
  goalKcal: number;
  kcalAntes: number;
  kcalAntojo: number;
  /** la comida donde cae el antojo y a qué hora */
  slot: string;
  at: Date;
  wakeHour?: number;
  weightKg?: number | null;
  conditions?: string[];
  /** cuántos puntos baja la nota del día y la letra con que queda */
  caidaNota: number;
  letraDespues: string | null;
  /** el mejor cambio chico que sube la nota («con agua en vez de…», «con una ensalada al lado») */
  mejorCambio?: string;
}

/** ¿Calza con el día? Si no, la contrapartida concreta. null = calza (no hace falta compensar). */
export function contrapartida(i: AntojoInput): Contrapartida | null {
  // Lo típico que queda del día después del antojo (en la hora de SU día)
  const hAfter = Math.min(24, normDayHour(i.at, i.wakeHour) + 0.5);
  const resto = i.goalKcal * Math.max(0, 1 - expectedShareAt(hAfter));
  const exceso = Math.round(i.kcalAntes + i.kcalAntojo + resto - i.goalKcal);
  const malaCalidad = i.caidaNota >= 8 || i.letraDespues === "D" || i.letraDespues === "E";
  if (exceso < 100 && !malaCalidad) return null;

  const c: Contrapartida = { excesoKcal: Math.max(0, exceso) };
  if (exceso >= 100) {
    let falta = exceso;
    const sig = SIGUIENTE[i.slot] ?? null;
    if (sig) {
      const tipico = Math.round(i.goalKcal * (TIPICO[sig] ?? 0.25));
      const menos = Math.min(falta, Math.round(tipico * 0.4));
      if (menos >= 60) { c.comidaMenos = { slot: sig, nombre: MEAL_NAME[sig] ?? sig, kcal: Math.round(menos / 10) * 10, tipico }; falta -= menos; }
    }
    const sinCaminar = (i.conditions ?? []).some((x) => SIN_CAMINAR.has(x));
    if (falta >= 50 && !sinCaminar) {
      // Caminar a paso rápido ~3,5 MET: kcal/min = 3,5 × 3,5 × kg / 200
      const porMin = (3.5 * 3.5 * (i.weightKg && i.weightKg > 30 ? i.weightKg : 70)) / 200;
      c.caminataMin = Math.min(CAMINATA_MAX, Math.max(10, r5(falta / porMin)));
      c.caminataKcal = Math.round(c.caminataMin * porMin);
      falta -= c.caminataKcal;
    }
    if (sinCaminar && falta >= 50) c.sinCaminar = true;
    if (falta >= 50) c.resto = Math.round(falta);
  }
  if (malaCalidad && i.mejorCambio) c.calidad = i.mejorCambio;
  return c;
}

/** El almuerzo es masculino; la once y la cena, femeninas */
export const esMasc = (slot: string): boolean => slot === "almuerzo";
/** «el almuerzo más liviano», «la cena más liviana» */
export function comidaLiviana(cm: { slot: string; nombre: string }): string {
  return esMasc(cm.slot) ? `el ${cm.nombre} más liviano` : `la ${cm.nombre} más liviana`;
}
const mayus = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Las líneas de la contrapartida («la cena más liviana: ~400 kcal en vez de ~550», «+25 min de caminata») */
export function contraLineas(c: Contrapartida, usted = false): string[] {
  const out: string[] = [];
  if (c.comidaMenos) out.push(`${mayus(comidaLiviana(c.comidaMenos))}: ~${miles(c.comidaMenos.tipico - c.comidaMenos.kcal)} kcal en vez de ~${miles(c.comidaMenos.tipico)} (−${c.comidaMenos.kcal}).`);
  if (c.caminataMin) out.push(`${c.caminataMin} min de caminata a paso rápido (~${c.caminataKcal} kcal).`);
  if (c.sinCaminar) out.push(`La actividad para compensar el resto, la que ${usted ? "le" : "te"} indique ${usted ? "su" : "tu"} médico.`);
  if (c.calidad) out.push(`Para la calidad: ${c.calidad}.`);
  if (c.resto) out.push(`Aun así ${usted ? "quedaría" : "quedarías"} ~${miles(c.resto)} kcal sobre ${usted ? "su" : "tu"} meta: un día así no es un problema.`);
  return out;
}

const miles = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// ─── El trato ────────────────────────────────────────────────────────────────

export interface AntojoPendiente { said: string; kcal: number; contra: Contrapartida; strict: boolean; alt?: string; dia: string; at: string }
export interface Trato { said: string; dia: string; comidaMenos?: Contrapartida["comidaMenos"]; caminataMin?: number; calidad?: string; at: string }

export const PENDIENTE_KEY = "antojo_pending";
export const TRATO_KEY = "antojo_trato";
export const STRICT_KEY = "strict_mode";
const PENDIENTE_MIN = 30;

type Mem = { get(k: string): Promise<any>; set(k: string, v: unknown): Promise<void> };

/** El trato de hoy (null si no hay o es de otro día). */
export async function tratoDeHoy(memory: Mem | null | undefined, dia: string): Promise<Trato | null> {
  const t: any = await memory?.get(TRATO_KEY).catch(() => null);
  return t && t.dia === dia && typeof t.said === "string" ? t : null;
}

/** «Hoy hay un trato por el completo: la cena más liviana (−150 kcal) y 25 min de caminata.» */
export function tratoLinea(t: Trato): string {
  const partes: string[] = [];
  if (t.comidaMenos) partes.push(`${comidaLiviana(t.comidaMenos)} (−${t.comidaMenos.kcal} kcal)`);
  if (t.caminataMin) partes.push(`${t.caminataMin} min de caminata`);
  if (t.calidad) partes.push(t.calidad);
  return `Hoy hay un trato por ${t.said}${partes.length ? `: ${partes.join(" y ")}` : ""}.`;
}

/** ¿El mensaje responde a la contrapartida recién ofrecida? «Acepto la contrapartida» / «Mejor no». */
export async function respuestaAntojo(memory: Mem | null | undefined, text: string): Promise<{ accept: boolean; p: AntojoPendiente } | null> {
  if (!memory) return null;
  const p: any = await memory.get(PENDIENTE_KEY).catch(() => null);
  if (!p || !p.at || Date.now() - new Date(p.at).getTime() > PENDIENTE_MIN * 60000) return null;
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¡!.¿?]/g, "").trim();
  if (t.length > 60) return null;
  // Las palabras cortas solo si son TODO el mensaje: «hecho, ya entrené» o «paso por el súper» no son respuesta al trato
  if (/^(si,? )?(acepto|dale,? acepto|trato hecho|ok,? acepto)\b/.test(t) || /^(si,? )?hecho$/.test(t)) return { accept: true, p };
  if (/^(mejor no|no,? gracias|no acepto|no,? mejor (otra cosa|no))\b/.test(t) || /^paso(,? gracias)?$/.test(t)) return { accept: false, p };
  return null;
}
