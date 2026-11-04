// Revisión V2c (servidor): A2 módulos apagados · M1 medicamentos sin la marca · (con HOME aislado, como revision_v1)
process.env.TZ = "America/Santiago";
import { test, expect } from "bun:test";
import { quien, memoria } from "./rutas.ts";
import { autoPrefsDe, modulosApagados, moduloOn } from "C:/Proyectos/eris/src/services/AutoPrefs.ts";
import { medicationTypes } from "C:/Proyectos/eris/src/services/DietaryRestrictions.ts";
import { waterRule } from "C:/Proyectos/eris/src/services/DailyTargets.ts";
if (!/erishome/i.test(process.env.USERPROFILE ?? "")) throw new Error("Usa un USERPROFILE aislado (erishome)");

const sinFinanzas = { pref_auto_prefs: { v: 1, modulos: ["pulso", "metricas", "nutri", "toji"] } };

test("A2: sin datos de la app, todo encendido; con la lista, lo que falta está apagado", async () => {
  expect(modulosApagados(autoPrefsDe(null))).toEqual([]);
  expect(modulosApagados(autoPrefsDe({ modulos: ["nutri", "toji"] }))).toEqual(["finanzas", "inventario"]);
  expect(modulosApagados(autoPrefsDe({ modulos: ["nutri"] }), true)).toEqual([]); // Modo AXS: todo
  expect(await moduloOn(memoria(sinFinanzas), "finanzas")).toBe(false);
  expect(await moduloOn(memoria(sinFinanzas), "nutri")).toBe(true);
  expect(await moduloOn(memoria(), "finanzas")).toBe(true);
});

test("A2: con Finanzas apagado, el chat no la toca y lo dice", async () => {
  const r = await quien("¿Cuánta plata tengo?", { mem: memoria(sinFinanzas) });
  expect(r.tool).not.toBe("finance_tracker");
  expect(r.texto ?? "").toMatch(/Finanzas\*\* apagado/);
  // con Finanzas encendido, como siempre
  expect((await quien("¿Cuánta plata tengo?", { mem: memoria({ pref_auto_prefs: { v: 1, modulos: ["finanzas", "nutri"] } }) })).tool).toBe("finance_tracker");
});

test("A2: con el Inventario apagado, «¿tengo arroz?» no lo contesta el Inventario", async () => {
  const r = await quien("¿Tengo arroz en la despensa?", { mem: memoria({ pref_auto_prefs: { v: 1, modulos: ["finanzas", "nutri"] } }) });
  expect(r.tool).not.toBe("inventory_tracker");
  expect(r.texto ?? "").toMatch(/Inventario\*\* apagado/);
});

test("A2: un mensaje mixto no se corta: la comida se anota aunque Finanzas esté apagado", async () => {
  const r = await quien("Anota 2 huevos al desayuno", { mem: memoria(sinFinanzas) });
  expect(r.tool).toBe("nutrition_tracker");
});

test("M1: un medicamento sin la marca «activo» cuenta (como en la app): SGLT2 → +30 % de agua", () => {
  const med: any = { conditions: [], medications: [{ id: "1", name: "Forxiga 10 mg" }] };
  expect(medicationTypes(med).has("sglt2")).toBe(true);
  expect(waterRule(med).multiplier).toBe(1.3);
  const apagado: any = { conditions: [], medications: [{ id: "1", name: "Forxiga 10 mg", active: false }] };
  expect(medicationTypes(apagado).has("sglt2")).toBe(false);
});
