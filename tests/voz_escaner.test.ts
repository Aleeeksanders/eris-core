// El escáner por voz (2026-11-17): «Hestia, escanea el código de barras» → «Claro, señor. ¿Qué desea escanear: comida, gastos o
// inventario?» → la app abre la cámara que corresponde. Lo que se entiende por código.
import { test, expect } from "bun:test";
import { pideEscanear, respuestaEscaner, PREGUNTA_ESCANER, abriendoEscaner, preguntaEscaner, tratoDe } from "C:/Proyectos/eris/src/services/voz/Escaner.ts";
import { parseTelefono } from "C:/Proyectos/eris/src/services/TelefonoParse.ts";

test("pedir escanear: sin decir de qué, se pregunta; dicho, se abre al tiro", () => {
  const casos: Array<[string, string | null]> = [
    ["Hestia, escanea el código de barras", null], ["Hestia, encanea el código de barras", null], ["escanea esto", null],
    ["abre el escáner", null], ["lee el código de barras", null], ["oye Hestia, escanea", null],
    ["escanea la boleta", "gastos"], ["sácale una foto a la boleta", "gastos"], ["escanea el ticket del supermercado", "gastos"],
    ["escanea un producto para la despensa", "inventario"], ["escanea esto para el inventario", "inventario"], ["escanea algo del botiquín", "inventario"],
    ["escanea la comida", "comida"], ["escanea el yogur que me voy a comer", "comida"], ["escanea lo que me comí", "comida"],
  ];
  for (const [f, que] of casos) expect([f, pideEscanear(f)]).toEqual([f, que ? { que } : {}]);
  for (const f of ["¿cómo funciona el escáner?", "¿para qué sirve el escáner?", "escanea el disco del PC", "¿qué tengo hoy?", "no escanees nada"]) {
    expect([f, pideEscanear(f)]).toEqual([f, null]);
  }
});

test("la respuesta a «¿qué desea escanear?»", () => {
  const casos: Array<[string, string | null]> = [["comida", "comida"], ["la comida", "comida"], ["gastos", "gastos"], ["una boleta", "gastos"],
    ["inventario", "inventario"], ["para la despensa", "inventario"], ["no, mejor dime qué tengo hoy en el calendario", null], ["hola", null]];
  for (const [f, q] of casos) expect([f, respuestaEscaner(f)]).toEqual([f, q]);
  expect(PREGUNTA_ESCANER).toBe("Claro, señor. ¿Qué desea escanear: comida, gastos o inventario?");
  // el trato es el «Nombre o alias» del perfil: un título, de usted; un nombre, de tú; sin alias, sin nombre
  expect(preguntaEscaner(tratoDe({ displayName: "Señor" }))).toBe("Claro, Señor. ¿Qué desea escanear: comida, gastos o inventario?");
  expect(preguntaEscaner(tratoDe({ displayName: "Alesito" }))).toBe("Claro, Alesito. ¿Qué quieres escanear: comida, gastos o inventario?");
  expect(preguntaEscaner(tratoDe({ displayName: "jefe" }))).toBe("Claro, jefe. ¿Qué desea escanear: comida, gastos o inventario?");
  expect(preguntaEscaner(tratoDe({ displayName: "Donato" }))).toBe("Claro, Donato. ¿Qué quieres escanear: comida, gastos o inventario?");
  expect(preguntaEscaner(tratoDe({ displayName: "  " }))).toBe("Claro. ¿Qué quieres escanear: comida, gastos o inventario?");
  expect(preguntaEscaner(tratoDe(null))).toBe("Claro. ¿Qué quieres escanear: comida, gastos o inventario?");
  expect(abriendoEscaner("gastos")).toBe("Abriendo la foto de la boleta.");
});

test("escanear no es una orden del teléfono (no la toma Hestia Manos)", () => {
  for (const f of ["escanea el código de barras", "escanea la boleta", "abre el escáner"]) expect([f, parseTelefono(f)]).toEqual([f, null]);
});
