// Fase I5 (2026-10-23): vitaminas y minerales, fichas de suplementos y «Mis suplementos».
import { test, expect } from "bun:test";
import * as X from "C:/Proyectos/eris-mobile/src/services/supplements/supplementCore.ts";

let n = 0;
const ctx = (now = new Date(2026, 9, 23, 9)) => ({ now, newId: () => `s${++n}` });

test("recomendación diaria por sexo y edad (NIH), límites y formato", () => {
  expect(X.dri("fe", { sex: "m", age: 30 })).toBe(18);
  expect(X.dri("fe", { sex: "m", age: 60 })).toBe(8);
  expect(X.dri("fe", { sex: "h", age: 30 })).toBe(8);
  expect(X.dri("fe", {})).toBe(18); // sin sexo: la mayor
  expect(X.dri("vD", { age: 75 })).toBe(20);
  expect(X.dri("ca", { sex: "m", age: 55 })).toBe(1200);
  expect(X.dri("mg", { sex: "h", age: 25 })).toBe(400);
  expect(X.ul("ca", { age: 60 })).toBe(2000);
  expect(X.ul("vK")).toBeNull();
  expect(X.fmtMicro("ca", 1234.4)).toBe("1.234 mg");
  expect(X.fmtMicro("b12", 0.456)).toBe("0,46 µg");
  expect(X.scaleMicros({ vC: 4.6, ca: 6 }, 150)).toEqual({ vC: 6.9, ca: 9 });
  expect(X.addMicros({ vC: 1 }, { vC: 2.5, fe: 1 }, undefined)).toEqual({ vC: 3.5, fe: 1 });
});

test("fichas: se encuentran por cualquier nombre y los cuidados salen del perfil", () => {
  expect(X.fichaPara("Creatina monohidratada Optimum")?.id).toBe("creatina");
  expect(X.fichaPara("vitamina D3 1000 UI")?.id).toBe("vitamina_d");
  expect(X.fichaPara("aceite de pescado")?.id).toBe("omega3");
  expect(X.fichaPara("Whey protein isolate")?.id).toBe("proteina");
  expect(X.fichaPara("melatonina")).toBeNull();
  const b12 = X.fichaPorId("b12")!;
  const perfil = { conditions: [{ id: "diabetes_t2" }], medications: [{ name: "Metformina 850", active: true }, { name: "Omeprazol 20", active: false }] };
  expect(X.cuidadosPara(b12, perfil)).toEqual([expect.stringContaining("metformina")]);
  expect(X.cuidadosPara(X.fichaPorId("creatina")!, { conditions: [{ id: "ckd" }] })[0]).toContain("nefrólogo");
  expect(X.cuidadosPara(X.fichaPorId("omega3")!, { medications: [{ name: "Aspirina 100 mg" }] })[0]).toContain("sangrado");
  expect(X.cuidadosPara(X.fichaPorId("electrolitos")!, { medications: [{ name: "Losartán 50" }] })[0]).toContain("potasio");
  expect(X.cuidadosPara(X.fichaPorId("omega3")!, { allergies: "mariscos" })[0]).toContain("algas");
  expect(X.cuidadosPara(X.fichaPorId("creatina")!, {})).toEqual([]);
  // ninguna ficha indica empezar algo, y todas tienen fuente
  for (const f of X.FICHAS) {
    expect(f.fuentes.length).toBeGreaterThan(0);
    expect(`${f.que} ${f.dosis} ${f.general.join(" ")}`).not.toMatch(/\b(debes|deber[ií]as) tomar|t[oó]malo todos los d[ií]as/i);
  }
});

test("mis suplementos: agregar, tomar en un toque, constancia y aporte a vitaminas", () => {
  const S = X.emptySupState();
  const c = ctx();
  const d = X.agregarSup(S, { nombre: "Vitamina D3", cantidad: 1000, unidad: "UI" }, c);
  expect(d).toMatchObject({ ok: true, msg: "Vitamina D3: 1.000 UI, 1 vez al día." });
  expect(S.items[0].fichaId).toBe("vitamina_d");
  const cre = X.agregarSup(S, { nombre: "Creatina", cantidad: 5, tomasDia: 1, horas: [7.5] }, c);
  expect(S.items[1]).toMatchObject({ unidad: "g", horas: [7.5], fichaId: "creatina" });
  const mg = X.agregarSup(S, { nombre: "Magnesio", cantidad: 200, unidad: "mg", tomasDia: 2 }, c);
  expect(S.items[2].horas).toEqual([8, 20]);
  expect(X.agregarSup(S, { nombre: "creatina", cantidad: 3 }, c).ok).toBe(false); // ya está
  const dia = X.diaKey(c.now);
  expect(X.tomar(S, d.id!, dia).msg).toBe("Vitamina D3: listo por hoy.");
  expect(X.tomar(S, mg.id!, dia).msg).toBe("Magnesio: 1 de 2.");
  expect(X.aporteDelDia(S, dia)).toEqual({ vD: 25, mg: 200 });
  const est = X.estadoHoy(S, dia, 10);
  expect(est.map((e) => [e.sup.nombre, e.tomadas, e.faltan, e.atrasada])).toEqual([["Creatina", 0, 1, true], ["Magnesio", 1, 1, false], ["Vitamina D3", 1, 0, false]]);
  expect(X.destomar(S, mg.id!, dia).ok).toBe(true);
  expect(X.destomar(S, mg.id!, dia).ok).toBe(false);
  // 3 días después: constancia de la semana desde que se agregó
  for (const k of [1, 2]) { const dd = new Date(c.now); dd.setDate(dd.getDate() + k); X.tomar(S, cre.id!, X.diaKey(dd)); }
  const cons = X.constancia(S, new Date(2026, 9, 25, 22));
  expect(cons.find((x) => x.nombre === "Creatina")).toMatchObject({ hechas: 2, esperadas: 3, pct: 67 });
  // quitar: deja de salir, pero lo tomado sigue sumando ese día
  X.quitarSup(S, d.id!);
  expect(X.estadoHoy(S, dia, 10).length).toBe(2);
  expect(X.aporteDelDia(S, dia).vD).toBe(25);
});

test("dosis sobre el límite superior: solo un aviso con fuente; unidades", () => {
  const S = X.emptySupState();
  const r = X.agregarSup(S, { nombre: "Vitamina D", cantidad: 5000, unidad: "UI" }, ctx());
  expect(r.ok).toBe(true);
  expect(r.aviso).toContain("límite superior de 100 µg");
  expect(X.agregarSup(S, { nombre: "Zinc", cantidad: 25, unidad: "mg", tomasDia: 2 }, ctx()).aviso).toContain("40 mg");
  expect(X.agregarSup(S, { nombre: "Omega 3", cantidad: 1, unidad: "cápsula", tomasDia: 2 }, ctx()).aviso).toBeUndefined();
  expect(X.aMicro("b12", 1, "mg")).toBe(1000);
  expect(X.aMicro("b12", 500, "mcg")).toBe(500);
  expect(X.aMicro("ca", 1, "g")).toBe(1000);
  expect(X.aMicro("mg", 2, "cápsula")).toBeNull();
  expect(X.fmtDosis(2, "cápsula")).toBe("2 cápsulas");
  expect(X.fmtDosis(1.5, "scoop")).toBe("1,5 scoops");
});

test("chat: «me tomé la creatina», deshacer y cómo voy; contexto para Eris", () => {
  let S = X.emptySupState();
  const c = ctx(new Date(2026, 9, 23, 21));
  X.agregarSup(S, { nombre: "Creatina monohidratada", cantidad: 5 }, c);
  X.agregarSup(S, { nombre: "Omega 3", cantidad: 1, unidad: "cápsula", tomasDia: 2 }, c);
  let r = X.applyOp(S, { action: "tomar", sup: "la creatina" }, c);
  expect(r.result).toMatchObject({ ok: true, msg: "Creatina monohidratada: listo por hoy." });
  S = r.state;
  r = X.applyOp(S, { action: "tomar", sup: "melatonina" }, c);
  expect(r.result).toMatchObject({ ok: false, code: "no_encontrado", opciones: ["Creatina monohidratada", "Omega 3"] });
  r = X.applyOp(S, { action: "estado" }, c);
  expect(r.result.msg).toContain("Omega 3: 0 de 2");
  const ex = X.extract(S, c.now);
  expect(ex.context).toContain("Creatina monohidratada 5 g, 1 vez al día (8:00): hoy listo");
  expect(ex.context).toContain("Eris no indica dosis");
  expect(ex.summary.activos).toBe(2);
  expect(X.extract(X.emptySupState(), c.now).context).toBe("");
});

test("servidor: frases de suplementos por código (y lo que NO es suplemento queda para Nutrición)", async () => {
  const { parseSupplementMessage } = await import("C:/Proyectos/eris/src/services/SupplementParse.ts");
  const S = X.emptySupState();
  X.agregarSup(S, { nombre: "Proteína Whey", cantidad: 30, unidad: "g" }, ctx());
  X.agregarSup(S, { nombre: "Omega 3", cantidad: 1, unidad: "cápsula" }, ctx());
  const p = (t: string) => parseSupplementMessage(t, S);
  expect(p("Me tomé la creatina")).toEqual({ action: "tomar", sup: "creatina" });
  expect(p("ya tomé la vitamina D")).toEqual({ action: "tomar", sup: "vitamina d" });
  expect(p("tomé 5 g de creatina")).toEqual({ action: "tomar", sup: "creatina" });
  expect(p("me tomé la proteína")).toEqual({ action: "tomar", sup: "proteina" });
  expect(p("¿me tomé el omega?")).toEqual({ action: "estado", sup: "omega" });
  expect(p("no me tomé el omega")).toEqual({ action: "deshacer", sup: "omega" });
  expect(p("ya me tomé mis suplementos")).toEqual({ action: "tomar", sup: "*" });
  expect(p("¿qué suplementos me faltan?")).toEqual({ action: "estado" });
  expect(p("¿Qué es la creatina?")).toEqual({ action: "ficha", sup: "Creatina monohidratada" });
  expect(p("¿sirve el magnesio para dormir?")).toEqual({ action: "ficha", sup: "Magnesio" });
  expect(p("¿cuánta vitamina D se toma?")).toEqual({ action: "ficha", sup: "Vitamina D" });
  // no son suplementos
  expect(p("me tomé un jugo de naranja")).toBeNull();
  expect(p("me tomé un vaso de leche con proteína")).toBeNull();
  expect(p("me tomé un café")).toBeNull();
  expect(p("¿cuánta vitamina C tiene la naranja?")).toBeNull();
});

test("servidor: la ficha por chat trae los cuidados del perfil y nunca indica empezar", async () => {
  const { fichaTexto } = await import("C:/Proyectos/eris/src/tools/SupplementTrackerTool.ts");
  const F = await import("C:/Proyectos/eris/src/services/SupplementCore.ts");
  const t = fichaTexto(F.fichaPorId("b12")!, { medications: [{ name: "Glafornil 850", active: true }] });
  expect(t).toContain("**Para ti, según tu perfil:**");
  expect(t).toContain("metformina");
  expect(t).toContain("No te indico dosis");
  expect(t).toContain("ods.od.nih.gov");
});

test("servidor: «me tomé la creatina» va solo a suplementos; «¿cuánta vitamina C tiene la naranja?» no", async () => {
  const { intentOf } = await import("C:/Proyectos/eris/src/services/ToolRouter.ts");
  expect(intentOf("me tomé la creatina", new Set(["health"] as any))).toBe("suplementos");
  expect(intentOf("¿qué dice la evidencia del magnesio?", new Set(["health"] as any))).toBe("suplementos");
  expect(intentOf("¿cuánta vitamina C tiene la naranja?", new Set(["health"] as any))).not.toBe("suplementos");
});

test("servidor: «¿cuánta vitamina C tiene una naranja?» sale de la base (USDA), no de memoria", async () => {
  const { microQuestion, microAnswer } = await import("C:/Proyectos/eris/src/services/MicroAnswer.ts");
  const { UnifiedFoodService } = await import("C:/Proyectos/eris/src/services/gluco/UnifiedFoodService.ts");
  const u = new UnifiedFoodService("");
  expect(microQuestion("¿Cuánta vitamina C tiene una naranja?")).toEqual({ key: "vC", alimento: "naranja" });
  expect(microQuestion("¿cuánto calcio tiene 200 g de yogur natural?")).toEqual({ key: "ca", alimento: "yogur natural", gramos: 200 });
  expect(microQuestion("¿cuánta creatina tomo?")).toBeNull();
  expect(microAnswer(microQuestion("¿Cuánta vitamina C tiene una naranja?")!, u)).toContain("~80 mg de vitamina C");
  expect(microAnswer(microQuestion("cuanta vitamina c tiene la lucuma")!, u)).toBe("En la base de Eris, Lúcuma no trae el dato de vitamina C.");
  expect(microAnswer(microQuestion("¿cuánta vitamina C tiene un dragón?")!, u)).toBeNull();
});
