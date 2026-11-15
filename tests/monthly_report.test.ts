// El informe del mes para el control médico (fase 1): el cálculo, puro.
import { test, expect } from "bun:test";
import { armarInformeMes, periodoDe, informeEnTexto, fmt } from "../src/services/MonthlyReport";

const dia = (n: number, extra: Record<string, any> = {}) => ({ date: `2026-10-${String(n).padStart(2, "0")}`, updatedAt: "x", ...extra });
const medical = (conds: string[] = [], extra: Record<string, any> = {}) => ({ conditions: conds.map((id) => ({ id })), medications: [], thresholds: {}, ...extra }) as any;

test("el período: el mes en curso llega hasta ayer; un mes pasado, completo; el futuro y el día 1 no tienen informe", () => {
  expect(periodoDe({ mes: "2026-11", hoy: "2026-11-15" })).toEqual({ desde: "2026-11-01", hasta: "2026-11-14", etiqueta: "noviembre de 2026 (hasta el 14)" });
  expect(periodoDe({ mes: "2026-10", hoy: "2026-11-15" })).toEqual({ desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "octubre de 2026" });
  expect(periodoDe({ mes: "2026-12", hoy: "2026-11-15" })).toBeNull();
  expect(periodoDe({ mes: "2026-11", hoy: "2026-11-01" })).toBeNull();
  // Sin mes: el mes de hoy
  expect(periodoDe({ hoy: "2026-11-15" })!.desde).toBe("2026-11-01");
  // Un rango: tampoco pasa de ayer
  expect(periodoDe({ desde: "2026-10-20", hasta: "2026-11-30", hoy: "2026-11-15" })!.hasta).toBe("2026-11-14");
  expect(periodoDe({ desde: "2026-10-20", hasta: "2026-11-30", hoy: "2026-11-15" })!.etiqueta).toBe("del 20 de octubre al 14 de noviembre de 2026");
  expect(periodoDe({ desde: "2026-12-20", hasta: "2027-01-10", hoy: "2027-02-01" })!.etiqueta).toBe("del 20 de diciembre de 2026 al 10 de enero de 2027");
  // Febrero bisiesto y diciembre
  expect(periodoDe({ mes: "2028-02", hoy: "2028-03-10" })!.hasta).toBe("2028-02-29");
  expect(periodoDe({ mes: "2026-12", hoy: "2027-01-05" })!.hasta).toBe("2026-12-31");
});

test("promedios solo con los días que tienen el dato; lo de otro mes no entra", () => {
  const inf = armarInformeMes({
    mes: "2026-10", hoy: "2026-11-15",
    rollup: [
      dia(1, { calories: 2000, proteinG: 100, carbsG: 200, fatG: 70, hydrationL: 2, sleepHours: 7, steps: 8000 }),
      dia(2, { calories: 2400, proteinG: 120, hydrationL: 3, sleepHours: 8, steps: 4000 }),
      dia(3, { sleepHours: 17 }), // dos días sumados: no es creíble
      { date: "2026-09-30", updatedAt: "x", calories: 9999 }, // otro mes
    ] as any,
    metas: { kcal: 2200, proteinG: 110, waterL: 2.5 },
  })!;
  expect(inf.comida).toMatchObject({ diasAnotados: 2, kcalProm: 2200, protProm: 110, carbProm: 200, grasaProm: 70, kcalMeta: 2200, protMeta: 110 });
  expect(inf.agua).toMatchObject({ dias: 2, litrosProm: 2.5, meta: 2.5, sinMeta: false, diasEnMeta: 1 });
  expect(inf.sueno).toMatchObject({ noches: 2, horasProm: 7.5 });
  expect(inf.movimiento).toMatchObject({ diasConPasos: 2, pasosProm: 6000, diasBajo5000: 1 });
  expect(inf.periodo).toMatchObject({ desde: "2026-10-01", hasta: "2026-10-31", dias: 31, diasConDatos: 3 });
});

test("enfermedad renal: sin meta de agua aunque venga una, y la proteína es un tope que se cuenta cuando se pasa", () => {
  const rollup = Array.from({ length: 10 }, (_, i) => dia(i + 1, { calories: 1800, proteinG: i < 4 ? 70 : 50, hydrationL: 1.4 }));
  const inf = armarInformeMes({ mes: "2026-10", hoy: "2026-11-15", rollup: rollup as any, medical: medical(["ckd"]), metas: { kcal: 1900, proteinG: 56, proteinIsCap: true, waterL: 2.5 } })!;
  expect(inf.agua).toMatchObject({ sinMeta: true, litrosProm: 1.4 });
  expect(inf.agua!.meta).toBeUndefined();
  expect(inf.comida).toMatchObject({ protEsTope: true, diasSobreTope: 4 });
  expect(inf.paraConversar.some((x) => /4 de 10 días la proteína pasó tu tope de 56 g/.test(x))).toBe(true);
  expect(inf.paraConversar.some((x) => /1,4 L al día.*especialista/.test(x))).toBe(true);
  expect(inf.perfil.condiciones).toEqual(["Enfermedad Renal Crónica"]);
});

test("insuficiencia cardíaca: tampoco hay meta de agua", () => {
  const inf = armarInformeMes({ mes: "2026-10", hoy: "2026-11-15", rollup: [dia(5, { hydrationL: 1.2 })] as any, medical: medical(["heart_failure"]), metas: { waterL: 2.8 } })!;
  expect(inf.agua!.sinMeta).toBe(true);
});

test("patrones: noches cortas, pulso que cambia, pocos pasos y agua bajo la meta; con pocos datos no se dice nada", () => {
  const rollup = Array.from({ length: 10 }, (_, i) => dia(i + 1, {
    sleepHours: i < 4 ? 5 : 7.5, restingHR: i < 5 ? 58 : 66, steps: 3500, hydrationL: 1,
  }));
  const inf = armarInformeMes({ mes: "2026-10", hoy: "2026-11-15", rollup: rollup as any, metas: { waterL: 2.5 } })!;
  const t = inf.paraConversar.join(" | ");
  expect(t).toMatch(/4 de 10 noches dormiste menos de 6 horas/);
  expect(t).toMatch(/pulso en reposo subió de 58 a 66/);
  expect(t).toMatch(/3\.500 pasos al día/);
  expect(t).toMatch(/meta actual de agua \(2,5 L\) 0 de 10 días/);
  // Con 3 días, nada de patrones
  const poco = armarInformeMes({ mes: "2026-10", hoy: "2026-11-15", rollup: rollup.slice(0, 3) as any, metas: { waterL: 2.5 } })!;
  expect(poco.paraConversar).toEqual([]);
});

test("la noche manda para contar las noches cortas cuando hay siesta", () => {
  const rollup = Array.from({ length: 7 }, (_, i) => dia(i + 1, { sleepHours: 7.5, sleepNightHours: 5 }));
  const inf = armarInformeMes({ mes: "2026-10", hoy: "2026-11-15", rollup: rollup as any })!;
  expect(inf.sueno).toMatchObject({ nochesCortas: 7, nocheProm: 5, horasProm: 7.5 });
});

test("suplementos: las tomas anotadas frente a las que tocaban desde que lo agregaste", () => {
  const log: Record<string, Record<string, number>> = {};
  for (const d of ["2026-10-21", "2026-10-22", "2026-10-25"]) log[d] = { s1: 1 };
  log["2026-09-30"] = { s1: 1 }; // otro mes
  const inf = armarInformeMes({
    mes: "2026-10", hoy: "2026-11-15", rollup: [] as any,
    suplementos: { items: [{ id: "s1", nombre: "Creatina", tomasDia: 1, activo: true, creado: "2026-10-20T10:00:00Z" }, { id: "s2", nombre: "Apagado", tomasDia: 1, activo: false }], log },
  })!;
  expect(inf.suplementos).toEqual([{ nombre: "Creatina", tomadas: 3, programadas: 12, pct: 25 }]);
  expect(inf.paraConversar.some((x) => /Creatina: anotaste 3 de 12 tomas \(25 %\)/.test(x))).toBe(true);
});

test("lo que falta se dice: sin datos, remedios, glucosa apagada y presión", () => {
  const inf = armarInformeMes({
    mes: "2026-10", hoy: "2026-11-15", rollup: [] as any,
    medical: medical(["diabetes_t2", "hypertension"], { medications: [{ id: "m", name: "Metformina", type: "metformin", dose: "850 mg", schedule: "con el almuerzo", active: true }] }),
  })!;
  const f = inf.faltan.join(" | ");
  expect(f).toMatch(/Comida: no hay días/);
  expect(f).toMatch(/Agua: no hay días/);
  expect(f).toMatch(/Sueño: no hay noches/);
  expect(f).toMatch(/Remedios: las tomas se anotan en el teléfono/);
  expect(f).toMatch(/Glucosa: el módulo está apagado/);
  expect(f).toMatch(/Presión arterial/);
  expect(inf.comida).toBeNull();
  expect(inf.perfil.remedios).toEqual([{ nombre: "Metformina", dosis: "850 mg", horario: "con el almuerzo" }]);
});

test("exámenes: el último de cada uno, del más nuevo al más viejo", () => {
  const inf = armarInformeMes({
    mes: "2026-10", hoy: "2026-11-15", rollup: [] as any,
    medical: medical([], { labs: [
      { test: "hba1c", value: 12.2, unit: "%", date: "2025-11-01", addedAt: "x" },
      { test: "hba1c", value: 5.2, unit: "%", date: "2026-09-14", addedAt: "x" },
      { test: "ldl", value: 95, unit: "mg/dL", date: "2026-08-01", addedAt: "x" },
    ] }),
  })!;
  expect(inf.perfil.examenes).toEqual([
    { examen: "HbA1c", valor: 5.2, unidad: "%", fecha: "2026-09-14" },
    { examen: "LDL", valor: 95, unidad: "mg/dL", fecha: "2026-08-01" },
  ]);
});

test("en texto: números como en Chile, secciones y el aviso de que no es un diagnóstico", () => {
  expect(fmt(12345)).toBe("12.345");
  expect(fmt(2.45, 1)).toBe("2,5");
  expect(fmt(-1500)).toBe("-1.500");
  const inf = armarInformeMes({
    mes: "2026-10", hoy: "2026-11-15",
    rollup: [dia(1, { calories: 2100, proteinG: 90, hydrationL: 2.2, sleepHours: 7, steps: 9500, restingHR: 60, trained: true, moodScore: 4 })] as any,
    medical: medical(["diabetes_t2"], { labs: [{ test: "hba1c", value: 5.2, unit: "%", date: "2026-09-14", addedAt: "x" }] }),
    metas: { kcal: 2300, proteinG: 120, waterL: 2.6 }, pesoKg: 78.04,
  })!;
  const t = informeEnTexto(inf, "Alex");
  expect(t).toMatch(/Informe para tu control médico · Alex/);
  expect(t).toMatch(/Octubre de 2026 · 1 de 31 días con datos/);
  expect(t).toMatch(/- 1 día anotado/);
  expect(t).toMatch(/7 h al día en promedio \(1 día\)/);
  expect(t).not.toMatch(/,0/);
  expect(t).toMatch(/Condiciones: Diabetes Tipo 2/);
  expect(t).toMatch(/HbA1c: 5,2 % \(14 de septiembre de 2026\)/);
  expect(t).toMatch(/2\.100 kcal al día \(tu meta actual: 2\.300\)/);
  expect(t).toMatch(/9\.500 pasos/);
  expect(t).toMatch(/78 kg/);
  expect(t).toMatch(/No es un diagnóstico/);
  // Nunca dosis ni diagnósticos
  expect(t).not.toMatch(/\b(dosis|diagnosticad|te recomiendo (tomar|subir|bajar))\b/i);
});
