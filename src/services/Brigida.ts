// ============================================================
// Eris — el veredicto de cada módulo para el tono «brígida» (2026-11-05)
//
// Pedido del usuario: «me gustaría que fuera más brígida, tú me entiendes… necesito que sea bacán con todos los
// módulos, no solo Forge». Las respuestas que arma el código (anotar comida, agua, plata, sueño, entreno…) salen sin
// pasar por el modelo; con el tono «brígida» se les antepone una línea de veredicto (QueryEngine.finishQuick), calculada
// acá con los MISMOS datos de la respuesta. Nunca inventa: si no hay dato, no hay veredicto.
//
// Reglas (las del tono, Tone.ts): el veredicto primero y corto; pica cuando corresponde; nunca con el cuerpo, el peso ni
// la comida como culpa (medir sin obsesión): se habla de lo que viene («lo que queda del día, liviano»), no de lo hecho.
// Puro: se prueba con bun.
// ============================================================
import { trackGoal, type GoalTrack } from "./NutritionQualityCore.js";

const fmtL = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("es-CL")} L`;
const fmtN = (n: number) => Math.round(n).toLocaleString("es-CL");

/** Agua: cómo va A ESTA HORA (la misma cuenta de los cuadros de Métricas) */
export function veredictoAgua(w: { totalL: number; goalL: number | null; pace?: GoalTrack }): string | undefined {
  if (w.goalL === null || !w.pace) return undefined;
  const p = w.pace;
  switch (p.state) {
    case "cumplida": return "Agua cumplida. Bien ahí.";
    case "adelantado": return "Vas sobrado con el agua. Así se hace.";
    case "al_dia": return "Al día con el agua.";
    case "temprano": return w.totalL > 0 ? "Buen partido con el agua." : "Recién parte el día: arranca con un vaso.";
    default: {
      // Nunca «14 vasos ahora» (banco 2026-11-05): lo que falta se reparte; ahora, uno o dos
      const vasos = p.vasos ?? Math.max(1, Math.ceil(p.toCatchUp / 0.25 - 1e-9));
      if (vasos <= 2) return `Vas atrasado con el agua: ${vasos} ${vasos === 1 ? "vaso" : "vasos"} ahora, sin cuento.`;
      return "Vas muy atrasado con el agua: un vaso ahora y otro cada hora, sin cuento.";
    }
  }
}

/** Comida del día: energía y proteína contra lo esperable A ESTA HORA */
export function veredictoComida(
  v: { totals: { calories: number; protein: number }; kcalGoal: number; proteinGoal: number; proteinIsCap?: boolean },
  now: Date = new Date(), wakeHour?: number,
): string | undefined {
  if (!(v.kcalGoal > 0)) return undefined;
  const e = trackGoal(v.totals.calories, v.kcalGoal, { now, wakeHour, kind: "energia", unit: "kcal" });
  if (v.totals.calories > v.kcalGoal * 1.1) return `Te pasaste ${fmtN(v.totals.calories - v.kcalGoal)} kcal de tu meta. Lo que queda del día, liviano y listo.`;
  if (e.state === "de_mas") return "Vas adelantado en calorías: lo que viene, más liviano.";
  if (!v.proteinIsCap && v.proteinGoal > 0) {
    const p = trackGoal(v.totals.protein, v.proteinGoal, { now, wakeHour, kind: "comida", unit: "g" });
    if ((p.state === "atras" || p.state === "algo_atras") && p.toCatchUp >= 10) return `Vas corto de proteína: ${fmtN(p.toCatchUp)} g abajo de lo esperable a esta hora. Lo próximo, con proteína.`;
  }
  if (e.state === "temprano") return undefined;
  return "Vas al día. Así se hace.";
}

/** Sueño de una noche (horas) */
export function veredictoSueno(horas: number | null | undefined): string | undefined {
  if (typeof horas !== "number" || !Number.isFinite(horas) || horas <= 0) return undefined;
  if (horas < 5) return "Dormiste muy poco: hoy nada de café en la tarde y a la cama temprano, sin excusas.";
  if (horas < 6.5) return "Corto. Esta noche, a la cama antes.";
  if (horas <= 9.5) return "Bien dormido.";
  return "Dormiste harto: si igual andas cansado, ojo con eso.";
}

/** «¿Y si me compro…?» (FinanceCore.simularCompra) */
export function veredictoSimulacion(v: "holgado" | "justo" | "no_alcanza"): string {
  return v === "holgado" ? "Dale, te alcanza." : v === "justo" ? "Te alcanza, pero quedas justo: piénsalo dos veces." : "No te alcanza. No lo compres ahora.";
}

/** Litros con coma, para quien lo necesite */
export const litros = fmtL;
