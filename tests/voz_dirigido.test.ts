// «Solo si digo Hestia» (2026-11-17): el comando por voz, por código. El filtro lo hace la app (HestiaLlamada, LA_NOMBRA).
import { test, expect } from "bun:test";
import { modoDirigido, respuestaModo, LA_NOMBRA } from "C:/Proyectos/eris/src/services/voz/Dirigido.ts";

test("activar y apagar el modo por voz", () => {
  for (const f of ["Hestia, solo cuando te hable", "solo cuando te nombre", "modo reunión", "respóndeme solo cuando te hablo"]) expect([f, modoDirigido(f)]).toEqual([f, true]);
  for (const f of ["Hestia, escúchame siempre", "modo normal", "ya no hace falta decir tu nombre", "sal del modo reunión"]) expect([f, modoDirigido(f)]).toEqual([f, false]);
  for (const f of ["¿qué hora es?", "escucha esto", "pon una alarma a las 7", "solo quiero agua"]) expect([f, modoDirigido(f)]).toEqual([f, null]);
  expect(respuestaModo(true, "Alesito")).toBe("Listo, Alesito: desde ahora te respondo solo cuando me digas «Hestia».");
  expect(respuestaModo(false, null)).toBe("Listo: te escucho siempre.");
});

test("¿la frase la nombra? (como la escribe el reconocimiento)", () => {
  for (const f of ["Hestia, ¿qué hora es?", "oye estia pon música", "¿qué opinas, Hestia?"]) expect([f, LA_NOMBRA.test(f)]).toEqual([f, true]);
  for (const f of ["el de Michael me pasó la suya", "esta semana", "fiesta en la casa", "bestia"]) expect([f, LA_NOMBRA.test(f)]).toEqual([f, false]);
});
