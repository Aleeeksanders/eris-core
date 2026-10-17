// ============================================================
// Eris — el agua que trae la comida
//
// 2026-10-10: una jalea quedó anotada solo como comida, y es ~85 % agua. La meta de agua (35 ml/kg + actividad + entreno)
// es de agua TOTAL, igual que la referencia europea (EFSA: 2,5 L/día en hombres, de los que ~20–30 % viene de la comida),
// así que el agua de los alimentos también cuenta. Las bebidas ya se suman aparte (como toma de agua): acá no entran.
//
// Cuánta agua tiene un alimento sale de su composición, sin tabla aparte: lo que no es proteína, carbohidratos, grasa,
// fibra ni minerales (~1 %) es agua. Contra la tabla USDA: jalea 84 % (USDA 85), arroz cocido 68 (68), pan 30 (30–36),
// pechuga cocida 64 (65), huevo duro 75 (75), cereal 3 (2–3). En frutas da un poco MENOS que la tabla (la fibra a veces ya
// viene dentro de los carbohidratos y se resta dos veces): el error va hacia no inflar el agua.
// Si los macros no calzan con las calorías (falta un dato, trae alcohol o edulcorantes), no se suma nada.
//
// La app tiene la misma regla (eris-mobile/src/services/foodWater.ts): mismo resultado en el teléfono y en el chat.
// ============================================================

import { beverageTypeOf } from "./Beverage.js";
import { dayEntries, type LogEntry } from "./NutritionLog.js";
import { dayCtxFrom, nutritionDayKey } from "./MealSchedule.js";

/** Minerales (ceniza) por 100 g: ~1 g en promedio (verduras 0,5–1; carnes 1; quesos 2–4). */
const ASH_G = 1;

const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

/**
 * Fracción de agua (0–1) según la composición por 100 g. null = los datos no alcanzan o no calzan con las calorías
 * (entonces no se suma agua: mejor de menos que inventada).
 */
export function waterFraction(per100: { calories?: number; protein?: number; carbs?: number; fat?: number; fiber?: number }): number | null {
  const { calories: kcal, protein: p, carbs: c, fat: f } = per100;
  if (!ok(kcal) || !ok(p) || !ok(c) || !ok(f)) return null;
  if (kcal <= 0 && p + c + f <= 0) return null; // sin datos
  const macroKcal = 4 * p + 4 * c + 9 * f;
  if (Math.abs(kcal - macroKcal) > Math.max(25, 0.3 * Math.max(kcal, macroKcal))) return null;
  const solids = p + c + f + (ok(per100.fiber) ? per100.fiber : 0) + ASH_G;
  return solids >= 100 ? 0 : (100 - solids) / 100;
}

/** Litros de agua de un alimento ya anotado (valores de la PORCIÓN, como en el registro). Bebidas: 0 (van aparte). */
export function itemWaterL(item: { name: string; grams: number; calories: number; protein: number; carbs: number; fat: number; fiber?: number }): number {
  if (!item || !(item.grams > 0) || beverageTypeOf(item.name) !== null) return 0;
  const k = 100 / item.grams;
  const fr = waterFraction({ calories: item.calories * k, protein: item.protein * k, carbs: item.carbs * k, fat: item.fat * k, fiber: (item.fiber ?? 0) * k });
  return fr === null ? 0 : (item.grams * fr) / 1000;
}

/** Litros de agua de un conjunto de comidas. */
export function entriesWaterL(entries: LogEntry[]): number {
  const l = entries.reduce((a, e) => a + (e.items ?? []).reduce((b, i) => b + itemWaterL(i), 0), 0);
  return Math.round(l * 100) / 100;
}

/** El agua de la comida de HOY: lo anotado por chat + lo anotado a mano en el teléfono (sin repetir ni revivir lo borrado). */
export async function foodWaterToday(memory: { get(k: string): Promise<any> }, snap?: any): Promise<number> {
  const safe = async (k: string) => { try { return await memory.get(k); } catch { return null; } };
  const s = snap !== undefined ? snap : await safe("health_snapshot_latest");
  const day = nutritionDayKey(new Date(), dayCtxFrom(s));
  const { entries } = dayEntries((await safe(`nutrition_log_${day}`)) || [], s?.foodLog, day, await safe(`nutrition_deleted_${day}`));
  return entriesWaterL(entries);
}
