// Hestia como JARVIS · L3 (2026-11-17): el entrenador en el oído. Lo que dices en el gimnasio (por código) y lo que Hestia dice.
// Lo que de verdad se anota lo prueba eris-mobile/tests/forge_voz_l3.test.ts (con el núcleo de Forge).
import { test, expect } from "bun:test";
import { pideEntreno, serieDicha, plegarEntreno, duracionVoz, textoSigue, textoEmpezar, textoSerie, textoFalta, textoTerminar, hitosDescanso, type SesionVoz } from "C:/Proyectos/eris/src/services/hestia/Entrenador.ts";
import { parseTelefono } from "C:/Proyectos/eris/src/services/TelefonoParse.ts";
import { personalidad } from "C:/Proyectos/eris/src/services/hestia/Personalidad.ts";

const LIBRE = { activo: false, descansando: false }, ACTIVO = { activo: true, descansando: false }, DESC = { activo: true, descansando: true };

test("las series: con verbo siempre; sin verbo solo entrenando; carga, «y medio», al fallo, en reserva, negativas, ejercicio", () => {
  expect(pideEntreno("Hestia, hice 8 con 62,5", LIBRE)).toEqual({ tipo: "serie", reps: 8, kg: 62.5, rir: null, neg: null, ejercicio: null });
  expect(pideEntreno("hice 8 con 62 y medio kilos", LIBRE)).toMatchObject({ reps: 8, kg: 62.5 });
  expect(pideEntreno("hice ocho con sesenta", LIBRE)).toMatchObject({ reps: 8, kg: 60 });
  expect(pideEntreno("salieron diez", LIBRE)).toMatchObject({ reps: 10 });
  expect(pideEntreno("hice 10 al fallo", LIBRE)).toMatchObject({ reps: 10, rir: 0 });
  expect(pideEntreno("hice 8 y me quedaron 2", LIBRE)).toMatchObject({ reps: 8, rir: 2 });
  expect(pideEntreno("hice 6 y 3 negativas", LIBRE)).toMatchObject({ reps: 6, neg: 3 });
  expect(pideEntreno("hice 10 de sentadilla con 80", LIBRE)).toMatchObject({ reps: 10, kg: 80, ejercicio: "sentadilla" });
  expect(pideEntreno("8 con 60", ACTIVO)).toMatchObject({ reps: 8, kg: 60 });
  expect(pideEntreno("8 con 60", LIBRE)).toBeNull();
  // lo que no es una serie
  for (const t of ["hice 8 km", "hice 5 minutos de cardio", "hoy hice 8 km en bici", "hice 2 litros de agua", "hice 3 tareas", "¿qué hora es?",
    "Anota un gasto de 5 mil pesos en almuerzo", "registra 2 vasos de agua", "fueron 5 lucas", "hice 3 días seguidos"]) expect([t, pideEntreno(t, ACTIVO)]).toEqual([t, null]);
  expect(serieDicha(plegarEntreno("hice 400"), false)).toBeNull();
});

test("empezar, qué sigue, cuánto falta, terminar, borrar; el descanso solo mientras corre", () => {
  expect(pideEntreno("Hestia, vamos a entrenar", LIBRE)).toEqual({ tipo: "empezar" });
  expect(pideEntreno("llegué al gym", LIBRE)).toEqual({ tipo: "empezar" });
  expect(pideEntreno("¿qué sigue?", ACTIVO)).toEqual({ tipo: "sigue" });
  expect(pideEntreno("¿qué sigue?", LIBRE)).toBeNull();
  expect(pideEntreno("¿qué sigue en el entreno?", LIBRE)).toEqual({ tipo: "sigue" });
  expect(pideEntreno("¿cuánto me falta?", ACTIVO)).toEqual({ tipo: "cuanto_falta" });
  expect(pideEntreno("terminé", ACTIVO)).toEqual({ tipo: "terminar" });
  expect(pideEntreno("terminé", LIBRE)).toBeNull();
  expect(pideEntreno("terminé el entreno", LIBRE)).toEqual({ tipo: "terminar" });
  expect(pideEntreno("me equivoqué, borra la última serie", LIBRE)).toEqual({ tipo: "borrar" });
  expect(pideEntreno("ya estoy", DESC)).toEqual({ tipo: "descanso_cortar" });
  expect(pideEntreno("listo", DESC)).toEqual({ tipo: "descanso_cortar" });
  expect(pideEntreno("listo", ACTIVO)).toBeNull();
  expect(pideEntreno("dame 30 segundos más", DESC)).toEqual({ tipo: "descanso_mas", segundos: 30 });
  expect(pideEntreno("un minuto más", DESC)).toEqual({ tipo: "descanso_mas", segundos: 60 });
  expect(pideEntreno("quítale 15 segundos", DESC)).toEqual({ tipo: "descanso_menos", segundos: 15 });
  expect(pideEntreno("¿cuánto me queda?", DESC)).toEqual({ tipo: "descanso_cuanto" });
  // «eso es todo» sigue colgando la llamada (L1), aunque esté entrenando
  expect(pideEntreno("eso es todo", ACTIVO)).toBeNull();
  expect(personalidad("eso es todo", { enLlamada: true })?.colgar).toBe(true);
  // y nada de esto es del teléfono
  for (const t of ["hice 8 con 62,5", "vamos a entrenar", "borra la última serie", "ya estoy", "terminé el entreno"]) expect([t, parseTelefono(t, [])]).toEqual([t, null]);
});

test("lo que dice: la serie que sigue, empezar, anotada con récord y descanso, cuánto falta, el resumen", () => {
  const sigue = { exId: "press_banca", nombre: "press de banca", serie: 2, de: 4, carga: "62,5 kg", reps: "8", cambio: false };
  expect(textoSigue(sigue)).toBe("Press de banca: serie 2 de 4, 62,5 kg por 8.");
  expect(textoSigue({ ...sigue, nombre: "sentadilla", cambio: true, serie: 1, de: 3, carga: "80 kg", reps: "6 a 8" })).toBe("Sigue sentadilla: serie 1 de 3, 80 kg por 6 a 8.");
  const s: SesionVoz = { hayPlan: true, descansoRutina: false, nombreDia: "Empuje", hechas: 0, total: 16, ejercicios: 5, sigue, listo: false, descanso: null, ultima: null };
  expect(textoEmpezar(s, "Alesito")).toBe("Vamos, Alesito. Hoy toca Empuje: 5 ejercicios, 16 series. Press de banca: serie 2 de 4, 62,5 kg por 8.");
  expect(textoEmpezar({ ...s, hayPlan: false, descansoRutina: true })).toMatch(/^Hoy tu rutina dice descanso/);
  expect(textoEmpezar({ ...s, hayPlan: false })).toMatch(/^No tienes un plan para hoy en Forge/);
  expect(textoSerie({ anotada: { texto: "8 con 62,5 kg" }, record: "máximo estimado de unos 82 kg", descanso: { secs: 150 } }, "Alesito"))
    .toBe("Anotada: 8 con 62,5 kg. ¡Nuevo récord, Alesito! Máximo estimado de unos 82 kg. Descansa dos minutos y medio.");
  expect(textoSerie({ anotada: { texto: "10" }, listo: true, sesion: { hechas: 16 } })).toBe("Anotada: 10. Plan de hoy listo: 16 series. Buen trabajo.");
  expect(textoFalta({ ...s, hechas: 6 })).toMatch(/^Llevas 6 de 16 series; te quedan 10\./);
  expect(textoTerminar({ series: 14, minutos: 52, kcal: 310 }, ["a", "b"], "Alesito")).toBe("Listo, Alesito: 14 series en 52 minutos, unas 310 kcal. 2 récords hoy. Buen entreno.");
  expect(textoTerminar({ series: 0, minutos: 0, kcal: 0 }, [])).toMatch(/^Hoy no anotaste series/);
});

test("el descanso contado: un minuto y treinta segundos antes (lo que quepa); duraciones para decirlas", () => {
  expect(hitosDescanso(150)).toEqual([{ en: 90, texto: "Un minuto." }, { en: 120, texto: "Treinta segundos." }]);
  expect(hitosDescanso(60)).toEqual([{ en: 30, texto: "Treinta segundos." }]);
  expect(hitosDescanso(45)).toEqual([]);
  expect([150, 120, 90, 75, 45, 200].map(duracionVoz)).toEqual(["dos minutos y medio", "dos minutos", "un minuto y medio", "un minuto y 15 segundos", "45 segundos", "3 minutos y 20 segundos"]);
});
