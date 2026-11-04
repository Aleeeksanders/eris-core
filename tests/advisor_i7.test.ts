// Fase I7 (2026-10-23): el asesor arma con la despensa del Inventario, antojos con contrapartida y modo estricto.
import { test, expect } from "bun:test";
import { contrapartida, contraLineas, respuestaAntojo, tratoLinea, PENDIENTE_KEY } from "C:/Proyectos/eris/src/services/Antojo.ts";
import { pantryFrom } from "C:/Proyectos/eris/src/services/HomePantry.ts";

const at = (h: number, m = 0) => new Date(2026, 9, 23, h, m);

test("contrapartida: si calza, nada; si no, la próxima comida más liviana y caminata según el peso", () => {
  // Un día al ritmo: a media tarde lleva 1.300 de 2.200 y una fruta no lo pasa
  expect(contrapartida({ goalKcal: 2200, kcalAntes: 1300, kcalAntojo: 80, slot: "once", at: at(17), caidaNota: 0, letraDespues: "B" })).toBeNull();
  // Un completo (546 kcal) en la once con 1.500 ya comidas: la cena más liviana y caminata
  const c = contrapartida({ goalKcal: 2200, kcalAntes: 1500, kcalAntojo: 546, slot: "once", at: at(17), weightKg: 80, caidaNota: 23, letraDespues: "C" })!;
  expect(c.excesoKcal).toBeGreaterThan(300);
  expect(c.comidaMenos).toMatchObject({ slot: "cena", nombre: "cena", tipico: 506 });
  expect(c.comidaMenos!.kcal).toBe(200);
  expect(c.caminataMin! % 5).toBe(0);
  expect(c.caminataMin).toBeLessThanOrEqual(45);
  expect(c.caminataKcal).toBe(Math.round(c.caminataMin! * (3.5 * 3.5 * 80) / 200));
  const ls = contraLineas(c);
  expect(ls[0]).toMatch(/^La cena más liviana: ~306 kcal en vez de ~506 \(−200\)\.$/);
  expect(ls[1]).toMatch(/min de caminata a paso rápido/);
  // El almuerzo es masculino; la caminata tiene tope suave de 45 min y el resto solo se dice
  const al = contrapartida({ goalKcal: 2850, kcalAntes: 714, kcalAntojo: 1092, slot: "desayuno", at: at(8, 30), weightKg: 85, caidaNota: 37, letraDespues: "C" })!;
  expect(al.comidaMenos?.slot).toBe("almuerzo");
  expect(al.caminataMin).toBe(45);
  expect(contraLineas(al)[0]).toMatch(/^El almuerzo más liviano: /);
  expect(contraLineas(al).at(-1)).toMatch(/^Aun así quedarías ~[\d.]+ kcal sobre tu meta/);
  expect(tratoLinea({ said: "dos completos", dia: "2026-10-23", comidaMenos: al.comidaMenos, caminataMin: 45, at: "" })).toContain("el almuerzo más liviano (−");
  // En la cena no hay comida que aliviar: solo caminata (nunca al día siguiente)
  const n = contrapartida({ goalKcal: 2000, kcalAntes: 1700, kcalAntojo: 600, slot: "cena", at: at(21), weightKg: 70, caidaNota: 5, letraDespues: "C" })!;
  expect(n.comidaMenos).toBeUndefined();
  expect(n.caminataMin).toBeGreaterThan(0);
  // Con insuficiencia cardíaca no se indica caminar
  const hf = contrapartida({ goalKcal: 2000, kcalAntes: 1700, kcalAntojo: 600, slot: "cena", at: at(21), conditions: ["heart_failure"], caidaNota: 5, letraDespues: "C" })!;
  expect(hf.caminataMin).toBeUndefined();
  expect(hf.sinCaminar).toBe(true);
  expect(contraLineas(hf).join(" ")).toMatch(/la que te indique tu médico/);
  // Solo la calidad: el cambio que más ayuda
  const q = contrapartida({ goalKcal: 2400, kcalAntes: 600, kcalAntojo: 140, slot: "almuerzo", at: at(13), caidaNota: 12, letraDespues: "C", mejorCambio: "con agua o una bebida zero en vez de coca-cola" })!;
  expect(q.excesoKcal).toBe(0);
  expect(contraLineas(q, true)).toEqual(["Para la calidad: con agua o una bebida zero en vez de coca-cola."]);
});

test("aceptar o no la contrapartida (solo justo después de ofrecerla)", async () => {
  const mem = new Map<string, any>();
  const memory = { get: async (k: string) => mem.get(k) ?? null, set: async (k: string, v: any) => { mem.set(k, v); } };
  expect(await respuestaAntojo(memory, "Acepto la contrapartida")).toBeNull(); // nada pendiente
  mem.set(PENDIENTE_KEY, { said: "un completo", kcal: 546, contra: { excesoKcal: 300 }, strict: true, dia: "2026-10-23", at: new Date().toISOString() });
  expect((await respuestaAntojo(memory, "Acepto la contrapartida"))?.accept).toBe(true);
  expect((await respuestaAntojo(memory, "Mejor no"))?.accept).toBe(false);
  expect(await respuestaAntojo(memory, "¿qué tal el clima?")).toBeNull();
  mem.set(PENDIENTE_KEY, { said: "x", kcal: 1, contra: {}, strict: false, dia: "2026-10-23", at: new Date(Date.now() - 31 * 60000).toISOString() });
  expect(await respuestaAntojo(memory, "acepto")).toBeNull(); // pasaron 30 min
  expect(tratoLinea({ said: "un completo", dia: "2026-10-23", comidaMenos: { slot: "cena", nombre: "cena", kcal: 200, tipico: 506 }, caminataMin: 25, at: "" }))
    .toBe("Hoy hay un trato por un completo: la cena más liviana (−200 kcal) y 25 min de caminata.");
});

test("la despensa del Inventario: Alimentos y Despensa con algo, sin lo vencido, lo que vence pronto primero", () => {
  const now = at(12);
  const st = { items: [
    { nombre: "Huevos", area: "alimentos", cantidad: 6 },
    { nombre: "Pechuga de pollo", area: "alimentos", cantidad: 1, vence: "2026-10-24" },
    { nombre: "Arroz", area: "despensa", cantidad: 1 },
    { nombre: "Yogur natural", area: "alimentos", cantidad: 2, vence: "2026-10-20" }, // vencido
    { nombre: "Leche", area: "alimentos", cantidad: 0 }, // se acabó
    { nombre: "Shampoo", area: "bano", cantidad: 1 },
    { nombre: "Galleta triton 126g", area: "despensa", cantidad: 1 }, // el catálogo no la conoce
  ] };
  const p = pantryFrom(st, "2026-10-23T11:00:00.000Z", now)!;
  expect(p.frags).toEqual(["Huevos", "Pechuga de pollo", "Arroz"]);
  expect([...p.pronto]).toContain("pechuga_plancha");
  expect(p.prontoNombres).toEqual(["Pechuga de pollo"]);
  expect(pantryFrom({ items: [{ nombre: "Huevos", area: "alimentos", cantidad: 6 }] }, "x", now)).toBeNull(); // con 1 cosa no se arma nada
});

test("el recomendador usa solo lo de casa, lo que vence primero y la comida del trato más liviana", async () => {
  const { recommendMeals, formatRecommendation } = await import("C:/Proyectos/eris/src/services/MealRecommender.ts");
  const { analyze } = await import("C:/Proyectos/eris/src/services/MetabolicAnalysis.ts");
  const { deriveRestrictions } = await import("C:/Proyectos/eris/src/services/DietaryRestrictions.ts");
  const ctx: any = {
    now: at(13), profile: null, medical: null, restrictions: deriveRestrictions(null), medTypes: new Set(), weightKg: 80,
    sleepHours: 7, restingHR: 60, steps: 3000, activeCalories: 100, trainedToday: false, exerciseMinutes: 0, snapshotAgeMin: 5, snapshotIsToday: true,
    eaten: { kcal: 500, protein: 25, carbs: 60, fat: 15, fiber: 5 }, mealsToday: 1, lastMealAt: at(8), hydrationEffectiveL: 1, hydrationRawL: 1,
    goals: { kcal: 2200, protein: 130, carbs: 250, fat: 70, hydrationL: 2.8, steps: 8000, sources: [] }, glucose: null, diag: null, routine: null, budget: null, dataNotes: [],
  };
  const a = analyze(ctx);
  const home = pantryFrom({ items: [
    { nombre: "Huevos", area: "alimentos", cantidad: 6 }, { nombre: "Pechuga de pollo", area: "alimentos", cantidad: 1, vence: "2026-10-24" },
    { nombre: "Arroz", area: "despensa", cantidad: 1 }, { nombre: "Lentejas", area: "despensa", cantidad: 1 },
  ] }, "2026-10-23T11:00:00.000Z", at(12))!;
  const rec = recommendMeals({ ctx, analysis: a, moment: "comida", pantry: home.frags, prefer: home.pronto, fromInventory: "el 23-10 a las 8:00" });
  expect(rec.plates.length).toBeGreaterThan(0);
  const allowed = new Set([...home.ids, "lechuga", "tomate", "ensalada_chilena"]);
  for (const pl of rec.plates) for (const c of pl.components) expect(home.ids.has(c.id) || allowed.has(c.id)).toBe(true);
  expect(rec.plates[0].components.some((c) => c.id === "pechuga_plancha")).toBe(true);
  expect(formatRecommendation(rec, ctx)).toContain("Con lo que hay en tu Inventario");
  // el trato: la comida va más liviana
  const liv = recommendMeals({ ctx, analysis: a, moment: "comida", pantry: home.frags, kcalMenos: 250 });
  expect(liv.targetText).toContain("más liviana por tu trato de hoy (−250 kcal)");
  expect(liv.plates[0].totals.kcal).toBeLessThanOrEqual(rec.plates[0].totals.kcal);
});

test("«tengo antojo de…» se simula; «quiero comer algo» no es un alimento", async () => {
  const { parseWhatIfMessage } = await import("C:/Proyectos/eris/src/services/FoodParse.ts");
  const { UnifiedFoodService } = await import("C:/Proyectos/eris/src/services/gluco/UnifiedFoodService.ts");
  const u = new UnifiedFoodService("");
  const lookup = async (q: string) => u.searchLocal(q);
  expect((await parseWhatIfMessage("Tengo antojo de una pizza", lookup))?.items[0].name).toBe("Pizza (trozo)");
  expect((await parseWhatIfMessage("me tinca un completo", lookup))?.said).toBe("un completo");
  expect(await parseWhatIfMessage("quiero comer algo", lookup)).toBeNull();
  expect(await parseWhatIfMessage("quiero tomar agua", lookup)).toBeNull();
});
