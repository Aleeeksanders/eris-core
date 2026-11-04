// Revisión V2b — lo que encontró el banco con el modelo real (2026-11-04), probado sin depender del orden del banco:
//   r-senales: «¿Cómo vengo de estrés?» lo robaba la guía de síntomas
//   t-otra-cosa: una comida que el plan no tenía no rearmaba lo que quedaba del día
//   v2b-colacion: «colación de la mañana» a las 17:00 quedaba como colación de la tarde
// Correr con un HOME aislado: USERPROFILE=…/erishome_v1 bun test revision_v2b_chat.test.ts
process.env.TZ = "America/Santiago";
import { test, expect } from "bun:test";
import { quien, memoria } from "./rutas.ts";
import { mentionedMeal, mentionedMeals } from "C:/Proyectos/eris/src/services/FoodParse.ts";
if (!/erishome/i.test(process.env.USERPROFILE ?? "")) throw new Error("Usa un USERPROFILE aislado (erishome)");

test("r-senales: «¿cómo vengo de estrés?» va al Plan; un síntoma de verdad sigue yendo a la guía", async () => {
  expect((await quien("¿Cómo vengo de estrés?")).tool).not.toBe("symptom_guide");
  expect((await quien("¿Cómo ando de ánimo esta semana?")).tool).not.toBe("symptom_guide");
  expect((await quien("¿Cómo voy con este dolor de cabeza?")).tool).toBe("symptom_guide");
  expect((await quien("¿Qué hago con la ansiedad?")).tool).toBe("symptom_guide");
  expect((await quien("Me duele el pecho y el brazo izquierdo, ¿cómo vengo?")).tool).toBe("symptom_guide");
});

test("t-otra-cosa: una comida fuera del plan rearma lo que queda del día", async () => {
  const mem = memoria();
  const plan = await quien("Toma el control, modo óptimo", { mem });
  expect(plan.tool).toBe("day_plan");
  const antes = JSON.stringify(await mem.get(Object.keys((mem as any).__store ?? {}).find((k: string) => /^day_plan_\d/.test(k)) ?? "x").catch(() => null));
  void antes;
  const r = await quien("Anota un completo italiano para la cena", { mem, hist: [["user", "Toma el control, modo óptimo"], ["assistant", plan.texto ?? ""]] });
  expect(r.tool).toBe("nutrition_tracker");
  const comidasPendientes = /(Desayuno|Almuerzo|Colación|Once|Para completar)/.test(plan.texto ?? "");
  if (comidasPendientes) expect(r.texto ?? "").toMatch(/rearm[eé] lo que queda del d[ií]a/);
});

test("v2b-colacion: la colación que se nombra manda sobre la hora", () => {
  const tarde = new Date(2026, 10, 4, 17, 0), manana = new Date(2026, 10, 4, 10, 0);
  expect(mentionedMeal("Anota una manzana como colación de la mañana", tarde)).toBe("colacion_am");
  expect(mentionedMeal("yogur como colación de la tarde", manana)).toBe("colacion_pm");
  expect(mentionedMeal("me comí un plátano a media mañana", tarde)).toBe("colacion_am");
  expect(mentionedMeal("una manzana de colación", tarde)).toBe("colacion_pm"); // sin decirlo, la hora
  expect(mentionedMeals("2 huevos al desayuno y una manzana como colación de la mañana", tarde)).toEqual(["desayuno", "colacion_am"]);
});

test("v2b-colacion: se anota por código, en la colación de la mañana", async () => {
  const r = await quien("Anota una manzana como colación de la mañana");
  expect(r.tool).toBe("nutrition_tracker");
  expect(r.via).toBe("atajo");
  expect(r.texto ?? "").toMatch(/Colación mañana/);
});
