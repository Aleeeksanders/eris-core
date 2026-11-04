import { test, expect } from "bun:test";
import { routeTools, TOOL_GROUP } from "C:/Proyectos/eris/src/services/ToolRouter.ts";
const ALL = Object.keys(TOOL_GROUP);
const R = (m: string, prev: string[] = []) => routeTools(m, prev, ALL);

test("intención única → solo su herramienta", () => {
  const cases: Array<[string, string | undefined]> = [
    ["Registra: completo italiano sin mayo como once", "registrar_comida"],
    ["Registra un yogurt como colación", "registrar_comida"],
    ["Anota un pan con palta y un café con leche", "registrar_comida"],
    ["Almorcé un plato de porotos con riendas", "registrar_comida"],
    ["Quiero anotar maní confitado y no lo encontré en el buscador, ¿me ayudas? unos 50 g como colación", "registrar_comida"],
    ["¿Me anotas 2 marraquetas?", "registrar_comida"],
    ["¿Anoté las marraquetas?", undefined],
    ["Anoche dormí 4 horas y después en la mañana dormí 3 horas más", "sueno"],
    ["Dormí desde las ocho y cuarto hasta las once y cuarto", "sueno"],
    ["Me va a dar un calambre en el pie, ¿qué hago?", "sintoma"],
    ["Voy a entrenar en una hora, dame ideas para comer antes", "ideas_comida"],
    ["Proponme opciones para comer ahora", "ideas_comida"],
    // no deben estrecharse
    ["Gasté 5 lucas en almuerzo con la BCI", undefined],
    ["Me tomé dos coca zero de 591 ml, ¿cuentan como agua?", undefined],
    ["anota en mi diario que hoy me sentí bien", undefined],
    ["anota mi peso: 80 kilos", undefined],
    ["Te faltó la carne molida, unos 150 g", undefined],
    ["¿Puedo entrenar al fallo hoy?", undefined],
    ["¿Cuánta agua llevo hoy?", undefined],
    ["Eris, analiza mis métricas de hoy", "analisis_dia"], // revisión V1 (R1): intención propia, 2 herramientas
    ["Cruza mi perfil y dime cómo van mis gastos", undefined],
    ["comí 2 empanadas y me duele la guata", undefined],
  ];
  const bad: string[] = [];
  for (const [m, want] of cases) {
    const r = R(m);
    const line = `${(r.intent ?? "—").padEnd(17)} ${[...r.tools].join(",").slice(0, 90)}  «${m}»`;
    console.log(line);
    if (r.intent !== want) bad.push(`esperaba ${want ?? "—"}: ${line}`);
  }
  expect(bad).toEqual([]);
});
test("pregunta general: solo web", () => {
  const r = R("¿Cuál es el orden de las comidas del día, de la más temprano a la más tarde?");
  console.log(r.groups, [...r.tools]);
});
test("explicaciones y despertar: sin herramientas", () => {
  for (const m of ["¿Por qué la hora de mi día es distinta a la hora actual?", "Recién desperté, no hace falta nada todavía"]) {
    const r = R(m);
    console.log([...r.tools].join(","), "«" + m + "»");
    expect([...r.tools]).toEqual(["web_search"]);
  }
  expect(R("¿Cómo va mi día?").groups).toContain("finance");
});
test("pregunta general sin nada personal → solo web, y el «sí porfa» que sigue también", () => {
  expect([...R("Para hacer básquet, ¿qué zapatillas debo usar?").tools]).toEqual(["web_search"]);
  expect([...R("Sí porfa", ["Para hacer básquet, ¿qué zapatillas debo usar?"]).tools]).toEqual(["web_search"]);
  // lo personal sigue con sus herramientas
  expect(R("¿Cuánto me queda este mes?").tools.size).toBeGreaterThan(1);
  expect(R("¿Cuánta agua llevo hoy?").tools.has("nutrition_tracker")).toBe(true);
  expect(R("sí, dale", ["Registra 2 marraquetas"]).tools.has("nutrition_tracker")).toBe(true);
});
