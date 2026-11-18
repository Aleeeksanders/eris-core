// (2026-11-17, su pedido: «todo lo que reviso y lo que pido es referente al celu, nunca al PC») En Hestia, sin nombrar el PC, las
// herramientas del PC quedan fuera (QueryEngine: sinPC). Nombrarlo, o seguir algo que ya era del PC, las devuelve.
import { test, expect } from "bun:test";
import { nombraPC, abreSinDecirCual } from "C:/Proyectos/eris/src/services/hestia/Dispositivo.ts";

test("«abre la aplicación» sin decir cuál se pregunta; «abre Spotify» no", () => {
  for (const t of ["Abre la aplicación.", "ábrela", "Hestia, abre la app", "abre esa aplicación"]) expect([t, abreSinDecirCual(t)]).toEqual([t, true]);
  for (const t of ["abre Spotify", "abre la aplicación de la cámara", "abre el calendario"]) expect([t, abreSinDecirCual(t)]).toEqual([t, false]);
});

test("sin nombrar el PC es el teléfono; nombrarlo (o un archivo, la RAM, el escritorio) es el PC", () => {
  for (const t of ["Abre la aplicación", "abre el calendario", "revisa mis mensajes", "Busca una farmacia cerca", "Revisa si tengo algo pendiente", "abre YouTube"]) expect([t, nombraPC(t)]).toEqual([t, false]);
  for (const t of ["Abre YouTube en el navegador del PC", "Revisa en el PC qué programas están usando más memoria", "Borra el archivo x del escritorio", "¿cómo está la RAM?", "abre spotify en el computador", "abre la carpeta de descargas"]) expect([t, nombraPC(t)]).toEqual([t, true]);
});

test("lo que sigue a algo del PC sigue en el PC («sí, ábrelo»); después de algo del teléfono, no", () => {
  expect(nombraPC("sí, ábrelo", { trace: { tools: ["open"] } })).toBe(true);
  expect(nombraPC("sí", { trace: { tools: ["telefono"] } })).toBe(false);
  expect(nombraPC("sí", null)).toBe(false);
});
