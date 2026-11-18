// Hestia como JARVIS · L6 (2026-11-18): en la llamada, solo tu voz, frase por frase. Lo que decide el código con lo que dijo
// Hestia Manos de cada frase: qué no se toma, que otra voz nunca aprueba, «tu voz» bloqueado frase por frase (y lo corto que sigue
// a una tuya), sin revisión = lo de K5, el estado del panel y el resumen.
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import { vozDeTurno, nuevoEstadoVoz, decidirFrase, textoNoSegura, resumenVoz, CONTINUIDAD_MS } from "C:/Proyectos/eris/src/services/voz/VozFrase.ts";
import { leerEstado, guardarVoz, guardarVozLlamada, cambiarEstado, _olvidarEstado } from "C:/Proyectos/eris/src/services/hestia/Estado.ts";
import { nivelBloqueado } from "C:/Proyectos/eris/src/services/voz/Bloqueado.ts";

beforeEach(() => {
  const h = mkdtempSync(join(os.tmpdir(), "erishome_l6_"));
  process.env.USERPROFILE = h; process.env.HOME = h;
  _olvidarEstado();
});

const T0 = 1_800_000_000_000;
const base = { soloTuya: true, tuVozInicio: false, ahora: T0 };

test("lo que manda la app se revisa: clase conocida, números finitos", () => {
  expect(vozDeTurno({ clase: "tuya", puntaje: 4.237, ms: 182 })).toEqual({ clase: "tuya", puntaje: 4.24, ms: 182 });
  expect(vozDeTurno({ clase: "otra" })).toEqual({ clase: "otra", puntaje: null, ms: null });
  expect(vozDeTurno({ clase: "yo", puntaje: 9 })).toBeNull();
  expect(vozDeTurno({ clase: "tuya", puntaje: Infinity, ms: "x" })).toEqual({ clase: "tuya", puntaje: null, ms: null });
  expect(vozDeTurno(null)).toBeNull();
  expect(vozDeTurno("tuya")).toBeNull();
});

test("otra voz: con «solo tu voz» no se toma; apagado se toma, pero nunca contesta una aprobación", () => {
  const e = nuevoEstadoVoz(false, T0);
  expect(decidirFrase({ clase: "otra", puntaje: -4, ms: 1 }, e, base)).toEqual({ tomar: false, tuVoz: false, revisada: true, motivo: "otra_voz" });
  expect(decidirFrase({ clase: "otra", puntaje: -4, ms: 1 }, e, { ...base, soloTuya: false })).toEqual({ tomar: true, tuVoz: false, revisada: true });
  expect(decidirFrase({ clase: "otra", puntaje: -4, ms: 1 }, e, { ...base, soloTuya: false, aprobando: true }).tomar).toBe(false);
  // (lo dudoso sí contesta: desbloqueado, es lo de siempre)
  expect(decidirFrase({ clase: "dudosa", puntaje: 0.5, ms: 1 }, e, { ...base, aprobando: true }).tomar).toBe(true);
  expect(e.cuenta).toEqual({ tuya: 0, dudosa: 1, otra: 3, corta: 0, sin: 0 });
});

test("bloqueado, «tu voz» frase por frase: tuya sí, dudosa no, sin revisión = K5", () => {
  const e = nuevoEstadoVoz(false, T0);
  expect(decidirFrase({ clase: "tuya", puntaje: 4, ms: 1 }, e, base).tuVoz).toBe(true);
  expect(decidirFrase({ clase: "dudosa", puntaje: 0.4, ms: 1 }, e, base)).toEqual({ tomar: true, tuVoz: false, revisada: true });
  // sin revisión: vale lo de la palabra al despertar
  expect(decidirFrase(null, nuevoEstadoVoz(true, T0), { ...base, tuVozInicio: true })).toEqual({ tomar: true, tuVoz: true, revisada: false });
  expect(decidirFrase({ clase: "sin", puntaje: null, ms: null }, nuevoEstadoVoz(false, T0), base)).toEqual({ tomar: true, tuVoz: false, revisada: false });
});

test("lo corto («sí», «dale») vale como tuyo hasta 60 s después de una tuya, si no habló otra voz entre medio", () => {
  const e = nuevoEstadoVoz(false, T0);
  const corta = { clase: "corta" as const, puntaje: null, ms: 1 };
  expect(decidirFrase(corta, e, base).tuVoz).toBe(false);             // nada tuyo antes
  decidirFrase({ clase: "tuya", puntaje: 4, ms: 1 }, e, base);
  expect(decidirFrase(corta, e, { ...base, ahora: T0 + 20_000 }).tuVoz).toBe(true);
  expect(decidirFrase(corta, e, { ...base, ahora: T0 + CONTINUIDAD_MS + 1 }).tuVoz).toBe(false);
  decidirFrase({ clase: "tuya", puntaje: 4, ms: 1 }, e, { ...base, ahora: T0 + 100_000 });
  decidirFrase({ clase: "otra", puntaje: -5, ms: 1 }, e, { ...base, ahora: T0 + 101_000 });
  expect(decidirFrase(corta, e, { ...base, ahora: T0 + 102_000 }).tuVoz).toBe(false); // otra voz cortó el hilo
  // la palabra al despertar (K5) cuenta como una tuya en ese momento
  const k5 = nuevoEstadoVoz(true, T0);
  expect(decidirFrase(corta, k5, { ...base, tuVozInicio: true, ahora: T0 + 5_000 }).tuVoz).toBe(true);
});

test("bloqueado y no sonó como tú: se dice eso solo cuando con tu voz valdría", () => {
  expect(textoNoSegura("Alesito")).toBe("No estoy segura de que seas tú, Alesito: dilo de nuevo, o desbloquea el teléfono y sigo.");
  // anotar agua vale con tu voz; mandar un WhatsApp, nunca bloqueado (ahí va el «desbloquea» de siempre)
  expect(nivelBloqueado("Tomé medio litro de agua", false)).toBe("desbloquear");
  expect(nivelBloqueado("Tomé medio litro de agua", true)).toBe("tu_voz");
  expect(nivelBloqueado("Mándale un WhatsApp a Pedro diciendo que voy", true)).toBe("desbloquear");
});

test("el resumen de la llamada para el panel", () => {
  expect(resumenVoz({ tuya: 9, dudosa: 2, otra: 1, corta: 3, sin: 0 })).toBe("15 frases: 9 tuyas, 2 dudosas, 3 cortas y 1 de otra voz.");
  expect(resumenVoz({ tuya: 1, dudosa: 0, otra: 0, corta: 0, sin: 0 })).toBe("1 frase: 1 tuya.");
  expect(resumenVoz({ tuya: 0, dudosa: 0, otra: 0, corta: 0, sin: 4 })).toBe("4 frases, sin revisar tu voz.");
  expect(resumenVoz({ tuya: 0, dudosa: 0, otra: 0, corta: 0, sin: 0 })).toBe("Sin frases.");
});

test("el estado: «solo tu voz» encendido de fábrica, se guarda, y la última llamada (sin frases no borra la anterior)", async () => {
  expect((await leerEstado()).voz).toEqual({ soloTuya: true, ultima: null });
  await guardarVoz({ soloTuya: false });
  await guardarVoz({ soloTuya: "no" });
  expect((await leerEstado()).voz.soloTuya).toBe(false);
  await guardarVozLlamada({ tuya: 5, dudosa: 1, otra: 0, corta: 2, sin: 0 }, new Date("2026-11-18T10:00:00Z"));
  await guardarVozLlamada({ tuya: 0, dudosa: 0, otra: 0, corta: 0, sin: 0 });
  _olvidarEstado();
  const e = await leerEstado();
  expect(e.voz.ultima).toEqual({ t: "2026-11-18T10:00:00.000Z", cuenta: { tuya: 5, dudosa: 1, otra: 0, corta: 2, sin: 0 } });
  // lo raro del archivo se limpia
  await cambiarEstado((x) => { (x as any).voz = { soloTuya: 1, ultima: { t: "nunca", cuenta: { tuya: -3 } } }; });
  _olvidarEstado();
  expect((await leerEstado()).voz).toEqual({ soloTuya: true, ultima: null });
});
