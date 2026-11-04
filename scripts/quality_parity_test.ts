// ============================================================
// El núcleo de calidad del servidor (src/services/NutritionQualityCore.ts) es COPIA EXACTA del de la app
// (eris-mobile/src/services/nutritionQualityCore.ts) salvo las rutas de los import. Esta prueba revisa las dos cosas:
//   1) el texto: el del servidor es el de la app con las rutas cambiadas (scripts/sync_quality_core.ts);
//   2) los resultados: los mismos días dan la misma nota, letra por letra, en los dos.
//   bun scripts/quality_parity_test.ts    (sale con 1 si algo difiere)
// ============================================================

import { readFileSync } from "fs";
import { join } from "path";
import { serverVersion } from "./sync_quality_core.ts";

const APP_FILE = "C:/Proyectos/eris-mobile/src/services/nutritionQualityCore.ts";
const SRV_FILE = join(import.meta.dir, "..", "src", "services", "NutritionQualityCore.ts");
const app = await import(APP_FILE);
const srv = await import(SRV_FILE);

let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { fails++; console.log("  ✗", msg); } else console.log("  ✓", msg); };

check(readFileSync(SRV_FILE, "utf-8") === serverVersion(readFileSync(APP_FILE, "utf-8")), "el archivo del servidor es copia del de la app");

// Días de prueba: buenos, malos, de trasnochador, con productos envasados (Nutri-Score/NOVA) y vacíos
const at = (h: number, m = 0) => new Date(2026, 9, 15, h, m);
const facts = (name: string, grams: number, mealType: string, t: Date, p: any, extra: any = {}) => ({ name, grams, mealType, at: t, per100: p, ...extra });
const P = {
  marraqueta: { kcal: 267, protein: 8.6, carbs: 55, fat: 1.2, fiber: 2.6, sugar: 2 },
  palta: { kcal: 160, protein: 2, carbs: 8.5, fat: 14.7, fiber: 6.7, sugar: 0.7 },
  huevo: { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5, fiber: 0 },
  completo: { kcal: 260, protein: 9, carbs: 25, fat: 14, fiber: 1.5, sugar: 4, sodium: 700 },
  ensalada: { kcal: 18, protein: 0.9, carbs: 3.9, fat: 0.2, fiber: 1.2 },
  pollo: { kcal: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 },
  arroz: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4 },
  coca: { kcal: 42, protein: 0, carbs: 10.6, fat: 0, fiber: 0, sugar: 10.6, sodium: 10 },
  chocapic: { kcal: 389, protein: 7.5, carbs: 80, fat: 3.8, fiber: 5, sugar: 26, sodium: 300 },
  pizza: { kcal: 266, protein: 11, carbs: 33, fat: 10, fiber: 2.3, sugar: 3.6, sodium: 598, satFat: 4.5 },
};
const days: Array<{ name: string; items: any[]; cand: any[]; now: Date; wake?: number; goals: any }> = [
  { name: "buen día", now: at(19, 30), goals: { kcal: 2400, protein: 130, fiber: 28, water: 2.8 },
    items: [facts("Marraqueta", 100, "desayuno", at(8), P.marraqueta), facts("Palta", 60, "desayuno", at(8), P.palta), facts("Huevo", 110, "desayuno", at(8), P.huevo),
      facts("Pechuga de pollo", 150, "almuerzo", at(13, 30), P.pollo), facts("Arroz blanco", 200, "almuerzo", at(13, 30), P.arroz), facts("Ensalada de lechuga", 150, "almuerzo", at(13, 30), P.ensalada)],
    cand: [facts("Completo", 200, "once", at(19, 30), P.completo)] },
  { name: "solo comida rápida", now: at(16), goals: { kcal: 2000 },
    items: [facts("Pizza", 300, "almuerzo", at(13), P.pizza), facts("Coca-Cola", 500, "almuerzo", at(13), P.coca)],
    cand: [facts("Completo", 200, "colacion_pm", at(16), P.completo), facts("Coca-Cola", 350, "colacion_pm", at(16), P.coca)] },
  { name: "trasnochador (despertó a las 13)", now: at(17), wake: 13, goals: { kcal: 2400, protein: 140, fiber: 30, water: 3 },
    items: [facts("Cereal (Chocapic)", 60, "desayuno", at(13, 30), P.chocapic, { nova: 4, nutriscore: "d" })],
    cand: [facts("Pechuga de pollo", 150, "almuerzo", at(17), P.pollo)] },
  { name: "nada anotado, temprano", now: at(8), goals: {}, items: [], cand: [facts("Marraqueta", 100, "desayuno", at(8), P.marraqueta)] },
  { name: "nada anotado, tarde", now: at(15), goals: { kcal: 1800 }, items: [], cand: [facts("Completo", 200, "almuerzo", at(15), P.completo)] },
];

for (const d of days) {
  console.log(d.name);
  const ai = d.items.map((f) => app.toQualityItem(f, d.wake)), si = d.items.map((f) => srv.toQualityItem(f, d.wake));
  check(JSON.stringify(ai) === JSON.stringify(si), "mismos ítems (toQualityItem)");
  const ac = d.cand.map((f) => app.toQualityItem(f, d.wake)), sc = d.cand.map((f) => srv.toQualityItem(f, d.wake));
  const opts = { now: d.now, goals: d.goals, waterLiters: 1.2, wakeHour: d.wake };
  const a = app.simulateAdd(ai, ac, opts), s = srv.simulateAdd(si, sc, opts);
  check(JSON.stringify(a) === JSON.stringify(s), `misma simulación (antes ${s.before.letter ?? "—"} ${s.before.foodScore ?? "—"} → después ${s.after.letter} ${s.after.foodScore})`);
  for (const [kind, unit, got, goal] of [["energia", "kcal", s.after.kcal, s.after.goals.kcal], ["comida", "g", s.after.protein, s.after.goals.protein], ["agua", "L", 1.2, 2.8]] as const) {
    check(JSON.stringify(app.trackGoal(got, goal, { now: d.now, wakeHour: d.wake, kind, unit })) === JSON.stringify(srv.trackGoal(got, goal, { now: d.now, wakeHour: d.wake, kind, unit })), `mismo seguimiento de ${kind}`);
  }
}

// Calidad v2 (fase I6): con vitaminas y minerales (de la base por el nombre, o los del alimento) y lo de los suplementos
{
  console.log("calidad v2 (vitaminas, minerales y suplementos)");
  const SUP = await import("../src/services/SupplementCore.ts");
  const items = [facts("Manzana", 150, "desayuno", at(8), { kcal: 52, protein: 0.3, carbs: 14, fat: 0.2, fiber: 2.4, sugar: 10 }),
    facts("Leche entera", 200, "desayuno", at(8), { kcal: 61, protein: 3.2, carbs: 4.8, fat: 3.3, fiber: 0 }),
    facts("Producto con micros", 100, "almuerzo", at(13), P.pollo, { micros: { fe: 2, zn: 3, k: 300 } })];
  const ai = items.map((f) => app.toQualityItem(f)), si = items.map((f) => srv.toQualityItem(f));
  check(JSON.stringify(ai) === JSON.stringify(si) && ai.every((x: any) => x.micros), "mismos ítems con vitaminas y minerales");
  const opts = { now: at(14), goals: { kcal: 2200, protein: 120 }, waterLiters: 1, microRef: SUP.microRef({ sex: "h", age: 40 }), supMicros: { vD: 25, mg: 200 } };
  const a = app.evaluateDay(ai, opts), s = srv.evaluateDay(si, opts);
  check(JSON.stringify(a) === JSON.stringify(s) && a.parts?.micros != null, `misma nota v2 (${s.letter} ${s.foodScore}, vitaminas ${s.parts?.micros})`);
}

console.log(fails ? `\n${fails} diferencia(s)` : "\nServidor = app ✓");
process.exit(fails ? 1 : 0);
