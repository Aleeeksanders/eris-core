// Eris «brígida» (2026-11-05): el tono, el veredicto de cada módulo, la fuerza y los días entrenados por código, y que
// no pierda el hilo. Sale del chat real «¿Qué tan fuerte estoy?» del 2026-11-05.
import { test, expect, setSystemTime, afterAll } from "bun:test";
import { quien, memoria } from "./rutas.ts";
import { routeTools } from "C:/Proyectos/eris/src/services/ToolRouter.ts";
import { toneInstruction, usaGarabatos, isTone } from "C:/Proyectos/eris/src/services/Tone.ts";
import { FUERZA_OPINION, DIA_ASK, parseKilos, diaPedido, respuestaDia, respuestaKilos, fuerzaComparada, veredictoProgreso, fold } from "C:/Proyectos/eris/src/services/EntrenoChat.ts";
import { veredictoAgua, veredictoComida, veredictoSueno } from "C:/Proyectos/eris/src/services/Brigida.ts";
import { veredictoFinanzas } from "C:/Proyectos/eris/src/services/FinanceReply.ts";
import { sanitizeProjection } from "C:/Proyectos/eris/src/services/TrainingIntent.ts";

afterAll(() => setSystemTime());

// Sus cifras de ese día (las que mostró Eris)
const PROGRESO = {
  score: 19,
  lifts: [
    { name: "Dominadas", e1rm: 99.2, level: "Principiante", pct: 17 },
    { name: "Fondos", e1rm: 105, level: "Principiante", pct: 15 },
    { name: "Press de hombros (mancuernas)", e1rm: 21.9, level: "Principiante", pct: 12 },
    { name: "Curl con mancuerna", e1rm: 12.3, level: "Principiante", pct: 9 },
  ],
  month: { sessions: 4, prev: 4, bestWeek: 2, streak: 1 },
  records: [{ day: "2026-11-04", name: "Press militar (mancuerna)", text: "~21,9 kg c/u de máximo estimado" }],
};
const RECIENTES = [
  { day: "2026-11-04", label: "martes 4 nov", items: [
    { name: "Press de pecho en máquina", group: "empuje", text: "3 series: 12, 12, 11 reps · 110 lb (~49,9 kg)", kg: 49.9 },
    { name: "Elevaciones laterales (mancuerna)", group: "empuje", text: "3 series: 12, 12, 12 reps · 8 kg cada mancuerna", kg: 8 },
    { name: "Press militar (mancuerna)", group: "empuje", text: "3 series: 8, 7, 6 reps · 16 kg cada mancuerna", kg: 16 },
  ] },
  { day: "2026-11-01", label: "domingo 1 nov", items: [{ name: "Remo con mancuerna", group: "tiron", text: "3 series: 8, 8, 8 reps · 20 kg cada mancuerna", kg: 20 }] },
];
const proj = () => sanitizeProjection({ day: "2026-11-05", progress: PROGRESO, recent: RECIENTES })!;
const AHORA = new Date(2026, 10, 5, 20, 27);

// ─── El tono ──────────────────────────────────────────────────────────────────────
test("tono brígida: existe, veredicto primero, sin «¿quieres que…?», garabatos solo si los usó, seria ante síntomas", () => {
  expect(isTone("brigida")).toBe(true);
  const t = toneInstruction("brigida");
  expect(t).toContain("veredicto");
  expect(t).toContain("«¿quieres que…?»");
  expect(t).toContain("Sin garabatos");
  expect(t).toContain("cuerpo");
  expect(toneInstruction("brigida", { garabatos: true })).toContain("garabatos");
  expect(toneInstruction("brigida", { garabatos: true })).not.toContain("Sin garabatos");
  const serio = toneInstruction("brigida", { serio: true, garabatos: true });
  expect(serio).toContain("seria");
  expect(serio).not.toContain("huevada");
});

test("garabatos: «esta huea», «weón», «la wea» sí; «un huevo duro», «las 3 y pico» no", () => {
  expect(usaGarabatos(["Pero ojito que yo lo que puedo hacer es 50 kilos de esta huea que se empuja."])).toBe(true);
  expect(usaGarabatos(["oye weón"])).toBe(true);
  expect(usaGarabatos(["pásame la wea"])).toBe(true);
  expect(usaGarabatos(["me comí un huevo duro", "llegué a las 3 y pico", "¿qué tan fuerte estoy?"])).toBe(false);
});

// ─── Seguir el hilo ───────────────────────────────────────────────────────────────
const TODAS = ["nutrition_tracker", "metabolic_advisor", "symptom_guide", "get_live_context", "day_plan", "day_agenda", "training_today", "training_plan",
  "sleep_log", "finance_tracker", "inventory_tracker", "supplement_tracker", "personal_baseline", "carb_options", "lab_results", "manage_user_profile",
  "manage_user_context", "personal_journal", "insight_feedback", "web_search"];

test("hilo: sin tema propio, sigue con las herramientas del turno anterior (protegidas al recortar)", () => {
  const r = routeTools("¿y eso es mucho?", ["¿cuánto llevo gastado este mes?"], TODAS, { prevTools: ["finance_tracker"] });
  expect(r.intent).toBe("seguimiento");
  expect([...r.tools]).toEqual(["finance_tracker"]);
  // El chat real: con el grupo de salud entero eran 19 herramientas y se recortaba justo training_plan
  const f = routeTools("Eso es para alguien que entrena, pero tú crees que soy fuerte para alguien que no entrena, por ejemplo?", [], TODAS, { prevTools: ["training_plan"] });
  expect(f.intent).toBe("seguimiento");
  expect(f.tools.has("training_plan")).toBe(true);
  expect(f.tools.size).toBeLessThanOrEqual(3);
});

test("hilo: un pedido nuevo o una charla no siguen el hilo", () => {
  expect(routeTools("anota un café con leche", [], TODAS, { prevTools: ["training_plan"] }).intent).toBe("registrar_comida");
  expect(routeTools("¿cuánta plata me queda?", [], TODAS, { prevTools: ["training_plan"] }).intent).not.toBe("seguimiento");
  expect(routeTools("gracias", [], TODAS, { prevTools: ["training_plan"] }).intent).toBeUndefined();
  expect(routeTools("¿y eso es mucho?", [], TODAS, { prevTools: ["web_search"] }).intent).not.toBe("seguimiento");
});

// ─── Fuerza y días entrenados ─────────────────────────────────────────────────────
test("las frases del chat real se reconocen", () => {
  for (const f of ["¿Crees que soy fuerte?", "Eso es para alguien que entrena, pero tú crees que soy fuerte para alguien que no entrena, por ejemplo?",
    "Y en base a mi historial, ¿tú crees que soy más fuerte que alguien normal?"]) expect(FUERZA_OPINION.test(fold(f))).toBe(true);
  expect(DIA_ASK.test(fold("Pero puedo mirar mi rutina de ayer por ejemplo, donde sí entrené y ahí se ve mi número."))).toBe(true);
  expect(DIA_ASK.test(fold("¿Qué entrené el domingo?"))).toBe(true);
  expect(DIA_ASK.test(fold("¿Qué me toca hoy?"))).toBe(false);
  expect(parseKilos("Pero ojito que yo lo que puedo hacer es 50 kilos de esta huea que se empuja.")).toEqual({ kg: 50, patron: "empuje", dicho: "50 kilos" });
  expect(parseKilos("peso 80 kilos")).toBeNull();
  expect(parseKilos("compré 2 kilos de pan")).toBeNull();
  expect(parseKilos("hoy le puse 110 libras a la máquina de pecho")?.kg).toBeCloseTo(49.9, 1);
});

test("¿qué día?: ayer, el domingo, hoy, el 18", () => {
  expect(diaPedido("mi rutina de ayer", AHORA)).toBe("2026-11-04");
  expect(diaPedido("¿qué hice el domingo?", AHORA)).toBe("2026-11-01");
  expect(diaPedido("¿qué entrené el jueves?", AHORA)).toBe("2026-10-29"); // hoy es jueves: el anterior
  expect(diaPedido("¿qué hice hoy?", AHORA)).toBe("2026-11-05");
  expect(diaPedido("lo que entrené el 18", AHORA)).toBe("2026-10-18");
  expect(diaPedido("mi último entreno", AHORA)).toBeNull();
});

test("«mi rutina de ayer»: lo que anotó en Forge, con las cargas; un día sin entreno lo dice", () => {
  const r = respuestaDia("Pero puedo mirar mi rutina de ayer", RECIENTES, AHORA);
  expect(r.texto).toContain("Ayer (martes 4 nov) hiciste:");
  expect(r.texto).toContain("Press de pecho en máquina: 3 series: 12, 12, 11 reps · 110 lb (~49,9 kg)");
  expect(r.veredicto).toBe("Ayer le diste: 3 ejercicios, 9 series.");
  const nada = respuestaDia("¿qué hice el lunes?", RECIENTES, AHORA);
  expect(nada.texto).toContain("no anotaste entreno");
  expect(nada.texto).toContain("domingo 1 nov");
  expect(respuestaDia("mi rutina de ayer", undefined, AHORA).texto).toContain("actualiza la app");
});

test("«50 kilos de esta huea que se empuja» es el press de pecho en máquina (no el press militar)", () => {
  const r = respuestaKilos(parseKilos("50 kilos de esta huea que se empuja")!, RECIENTES, PROGRESO.lifts)!;
  expect(r.texto).toContain("**Press de pecho en máquina**");
  expect(r.texto).toContain("110 lb");
  expect(r.texto).toContain("En máquinas no hay una tabla seria");
  expect(r.veredicto).toContain("press de pecho en máquina");
});

test("¿soy fuerte?: percentil entre los que entrenan, la comparación honesta con quien no entrena y la constancia", () => {
  const r = fuerzaComparada(PROGRESO, true);
  expect(r.texto).toContain("percentil 19");
  expect(r.texto).toContain("Strength Level");
  expect(r.texto).toContain("4 de 4 levantamientos");
  expect(r.texto).toContain("haces dominadas");
  expect(r.texto).toContain("Lo más probable: sí");
  expect(r.texto).not.toMatch(/5[–-]10\/100/); // la escala inventada del chat real
  expect(r.veredicto).toBe("Para la calle, sí. Para el gym, todavía no. Con 4 entrenos al mes no vas a despegar.");
  expect(veredictoProgreso(PROGRESO)).toBe("Estás partiendo: percentil 19 entre los que entrenan. Con 4 entrenos al mes no vas a despegar.");
  expect(fuerzaComparada(null, true).texto).toContain("Aún no tengo series");
});

test("la proyección guarda los días entrenados acotados (y descarta lo que no sirve)", () => {
  const p = sanitizeProjection({ day: "2026-11-05", recent: [...RECIENTES, { day: "malo", items: [] }, { day: "2026-10-01", items: [{ name: "X", kg: 5000 }] }] })!;
  expect(p.recent!.length).toBe(3);
  expect(p.recent![2].items[0].kg).toBeNull();
});

// ─── El chat real, por el motor ───────────────────────────────────────────────────
const mem = (tone: string) => memoria({ forge_projection: proj(), tone });

test("chat real con tono brígida: veredicto primero, con sus datos y sin pasar por el modelo", async () => {
  setSystemTime(AHORA);
  const m = mem("brigida");
  const a = await quien("¿Crees que soy fuerte?", { mem: m });
  expect(a.via).toBe("atajo");
  expect(a.texto.startsWith("Para la calle, sí.")).toBe(true);
  expect(a.texto).toContain("percentil 19");
  const b = await quien("Pero ojito que yo lo que puedo hacer es 50 kilos de esta huea que se empuja.", { mem: m });
  expect(b.texto).toContain("Press de pecho en máquina");
  const c = await quien("Pero puedo mirar mi rutina de ayer por ejemplo, donde sí entrené y ahí se ve mi número.", { mem: m });
  expect(c.texto.startsWith("Ayer le diste")).toBe(true);
  expect(c.texto).not.toMatch(/no guarda/);
  const d = await quien("¿Qué tan fuerte estoy?", { mem: m });
  expect(d.texto.startsWith("Estás partiendo")).toBe(true);
});

test("con otro tono, la misma respuesta sin el veredicto", async () => {
  setSystemTime(AHORA);
  const a = await quien("¿Crees que soy fuerte?", { mem: mem("humor") });
  expect(a.texto.startsWith("Entre los que entrenan")).toBe(true);
});

// ─── El veredicto de los otros módulos ────────────────────────────────────────────
test("agua: atrasado → vasos ahora; al día; cumplida; sin meta → nada", () => {
  const base = { expectedNow: 1.4, leftToday: 2, next: null, status: "", detail: "", tone: "behind" as const };
  expect(veredictoAgua({ totalL: 0.5, goalL: 3, pace: { ...base, state: "atras", toCatchUp: 0.75 } })).toBe("Vas muy atrasado con el agua: un vaso ahora y otro cada hora, sin cuento.");
  expect(veredictoAgua({ totalL: 1, goalL: 3, pace: { ...base, state: "algo_atras", toCatchUp: 0.4 } })).toBe("Vas atrasado con el agua: 2 vasos ahora, sin cuento.");
  expect(veredictoAgua({ totalL: 1.5, goalL: 3, pace: { ...base, state: "al_dia", toCatchUp: 0 } })).toBe("Al día con el agua.");
  expect(veredictoAgua({ totalL: 3.1, goalL: 3, pace: { ...base, state: "cumplida", toCatchUp: 0 } })).toBe("Agua cumplida. Bien ahí.");
  expect(veredictoAgua({ totalL: 1, goalL: null })).toBeUndefined();
});

test("comida: pasado de la meta (sin culpa, lo que viene), corto de proteína a la hora, al día", () => {
  const tarde = new Date(2026, 10, 5, 19, 0);
  expect(veredictoComida({ totals: { calories: 3000, protein: 150 }, kcalGoal: 2500, proteinGoal: 150 }, tarde, 7)).toBe("Te pasaste 500 kcal de tu meta. Lo que queda del día, liviano y listo.");
  expect(veredictoComida({ totals: { calories: 1700, protein: 50 }, kcalGoal: 2500, proteinGoal: 150 }, tarde, 7)).toMatch(/^Vas corto de proteína: \d+ g abajo/);
  expect(veredictoComida({ totals: { calories: 1800, protein: 110 }, kcalGoal: 2500, proteinGoal: 150 }, tarde, 7)).toBe("Vas al día. Así se hace.");
  // Renal (la proteína es un tope): nunca «vas corto de proteína»
  expect(veredictoComida({ totals: { calories: 1700, protein: 20 }, kcalGoal: 2500, proteinGoal: 60, proteinIsCap: true }, tarde, 7)).not.toMatch(/proteína/);
});

test("sueño y plata", () => {
  expect(veredictoSueno(4.5)).toContain("muy poco");
  expect(veredictoSueno(7.5)).toBe("Bien dormido.");
  expect(veredictoSueno(null)).toBeUndefined();
  const gasto = (gastado: number) => veredictoFinanzas({ action: "gasto", monto: 5000 } as any, { ok: true, data: { catLabel: "Comida", mesCat: { gastado, presup: 100000 } } } as any);
  expect(gasto(104000)).toBe("Te pasaste en comida: 104 % del presupuesto. Frena ahí.");
  expect(gasto(90000)).toBe("Ojo con comida: vas en 90 % del mes.");
  expect(gasto(20000)).toBe("Listo, anotado.");
  expect(veredictoFinanzas({ action: "resumen" } as any, { ok: true, data: { conCuentas: true, libre: 120000, porDia: 8000 } } as any)).toBe("Te quedan ~$8.000 al día hasta el próximo ingreso. Aguanta.");
  expect(veredictoFinanzas({ action: "gasto" } as any, { ok: false } as any)).toBeUndefined();
});

test("guardia de plata: entiende «$408k», «$1,2M», «2 palos»; «$5 más» no son millones; lo inventado se sigue quitando", async () => {
  const { moneyIn, groundMoney } = await import("C:/Proyectos/eris/src/services/ReplyGuards.ts");
  expect(moneyIn("Con $408k y un sueldo de $1,2M en 25 días")).toEqual([408000, 1200000]);
  expect(moneyIn("me debe 2 palos")).toEqual([2000000]);
  expect(moneyIn("$5 más")).toEqual([5]);
  expect(moneyIn("$3 millones")).toEqual([3000000]);
  const real = ["💰 Tu plata: **$408.000**\n🗓️ Puedes gastar $408.000 hasta tu sueldo (en 25 días), ~$16.320 por día.\n📊 Noviembre: entraron (o vienen) $1.200.000"];
  expect(groundMoney("Es harto. Con $408k y un sueldo de $1,2M te alcanza.", real).removed).toEqual([]);
  expect(groundMoney("Te sobran $999k", real).removed).toEqual(["Te sobran $999k"]);
});

// ─── La recuperación por chat (2026-11-06) ───────────────────────────────────────────────
test("recuperación: agujetas ≠ sin recuperar, con sus datos, sin horas inventadas y con la alarma", async () => {
  const { respuestaRecuperacion, RECUPERACION_ASK } = await import("C:/Proyectos/eris/src/services/EntrenoChat.ts");
  const rec = { musculos: [{ nombre: "pecho", state: "cargado", hoursAgo: 33, sets: 6, fallo: 1, habitual: false, range: [48, 96] as [number, number], soreness: "molesta" }], personal: "Todavía no puedo medir cómo te recuperas.", pares: 4 };
  const a = respuestaRecuperacion(rec, "aún tengo agujetas del miércoles", { suenoH: 5.5, proteinaAyer: 60, proteinaMeta: 136 });
  expect(a.veredicto).toBe("Agujetas no es lo mismo que no estar recuperado. Ese músculo va recién cargado: hoy dale a otro.");
  expect(a.texto).toContain("proceso normal");
  expect(a.texto).toContain("pecho, hace 33 h");
  expect(a.texto).toContain("entre 2 días y 4 días");
  expect(a.texto).toContain("estimación");
  expect(a.texto).toContain("Todavía no puedo medir");
  expect(a.texto).toContain("~5,5 h");
  expect(a.texto).toContain("60 de 136 g");
  expect(a.texto).toContain("primera serie");
  expect(a.texto).toContain("orina oscura");
  expect(a.texto).not.toMatch(/creatina/i);
  const b = respuestaRecuperacion(rec, "¿estoy recuperado?", { suenoH: 8, proteinaAyer: 130, proteinaMeta: 136 });
  expect(b.texto).not.toContain("orina oscura");
  expect(b.texto).not.toContain("durmiendo");
  expect(b.texto).not.toContain("proteína");
  expect(respuestaRecuperacion(undefined, "tengo agujetas").veredicto).toContain("Agujetas no es lo mismo");
  for (const f of ["tengo agujetas", "¿estoy recuperado?", "¿cuánto tardo en recuperarme?", "sigo adolorido del gym"]) expect(RECUPERACION_ASK.test(fold(f))).toBe(true);
  expect(RECUPERACION_ASK.test(fold("¿qué me toca hoy?"))).toBe(false);
});

test("la proyección acepta la recuperación solo si es chica", () => {
  const ok = sanitizeProjection({ day: "2026-11-05", recovery: { musculos: [], personal: "x", pares: 0 } })!;
  expect(ok.recovery?.personal).toBe("x");
  expect(sanitizeProjection({ day: "2026-11-05", recovery: { musculos: [], personal: "x".repeat(5000) } })!.recovery).toBeUndefined();
});
