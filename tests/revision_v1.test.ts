// Revisión V1 (chat): qué herramienta se queda con cada frase, con TODAS las herramientas reales en su orden (rutas.ts).
// Correr con un HOME aislado: USERPROFILE=…/erishome_v1 bun test revision_v1.test.ts
process.env.TZ = "America/Santiago";
import { test, expect } from "bun:test";
import { quien, memoria, inventarioEjemplo } from "./rutas.ts";
import { ToolRegistry } from "C:/Proyectos/eris/src/tools.ts";
import { ROLES, canUseTool } from "C:/Proyectos/eris/src/services/security/RoleSystem.ts";
import { routeTools } from "C:/Proyectos/eris/src/services/ToolRouter.ts";
import { classifyQuery } from "C:/Proyectos/eris/src/types/config.ts";
import { esAnalisisDia, sinContextoPegado } from "C:/Proyectos/eris/src/services/AnalisisDia.ts";
import { sinRutas, salidaHumana } from "C:/Proyectos/eris/src/QueryEngine.ts";
import { LABS_TOPIC } from "C:/Proyectos/eris/src/services/LiveContext.ts";
import * as FC from "C:/Proyectos/eris/src/services/forge/forgeCore.ts";
import * as FCAT from "C:/Proyectos/eris/src/services/forge/forgeCatalog.ts";
import * as FM from "C:/Proyectos/eris/src/services/forge/forgeMdRoutine.ts";
import * as FR from "C:/Proyectos/eris/src/services/forge/forgeRoutine.ts";
import * as FT from "C:/Proyectos/eris/src/services/forge/forgeTrain.ts";
import * as FP from "C:/Proyectos/eris/src/services/forge/forgeProgress.ts";

if (!/erishome/i.test(process.env.USERPROFILE ?? "")) throw new Error("Usa un USERPROFILE aislado (erishome)");

const T = 60_000;
const tool = async (msg: string, opts?: any) => (await quien(msg, opts)).tool;

test("C1: «¿tengo X?» es del Inventario solo si X es una cosa de la casa", async () => {
  expect(await tool("¿Tengo fuerza?")).not.toBe("inventory_tracker");
  expect(await tool("¿Tengo fiebre?")).toBe("symptom_guide");
  expect(await tool("¿Cuántas calorías me quedan?")).toBe("nutrition_tracker");
  const r = await quien("¿Cuánto me queda?");
  expect(r.tool).not.toBe("inventory_tracker");
  expect(r.ofrecidas.length).toBeGreaterThan(1);
  for (const f of ["¿Tengo arroz?", "¿Hay leche?", "¿Me queda shampoo?", "¿cuántos huevos me quedan?"]) expect(await tool(f)).toBe("inventory_tracker");
}, T);

test("C2: atajos que ya no se roban mensajes (y los de siempre siguen)", async () => {
  expect(await tool("voy a hacer la cena")).not.toBe("training_today");
  expect(await tool("hoy toca lavar ropa")).not.toBe("training_today");
  expect(await tool("llegó mi hermano")).not.toBe("inventory_tracker");
  expect(await tool("me llegó el pedido")).not.toBe("inventory_tracker");
  expect(await tool("mi semana fue horrible")).not.toBe("day_agenda");
  expect(await tool("¿cómo me fue esta semana?")).toBe("day_agenda");
  const dormir = await quien("hazme una rutina para dormir");
  expect(dormir.tool).not.toBe("training_plan");
  expect(dormir.ofrecidas).toContain("sleep_log");
  expect(dormir.ofrecidas).not.toContain("training_plan");
  expect(await tool("¿cómo ando de sueño?")).toBe("sleep_log");
  expect(await tool("¿cómo voy hoy?")).toBe("metabolic_advisor");
  for (const f of ["hoy entreno pierna", "voy a jugar básquet 2 horas", "voy a correr a las 7", "voy al gym", "hoy descanso", "hoy toca pecho"]) expect(await tool(f)).toBe("training_today");
  for (const f of ["me llegó 1 kg de arroz", "llegaron 6 huevos", "compré 2 L de leche"]) expect(await tool(f)).toBe("inventory_tracker");
}, T);

test("C2: la nota del plan y «¿Cómo sigues?» del sueño solo responden a SU pregunta", async () => {
  const ahora = new Date().toISOString();
  const otro = "Cuéntame tu caso en una frase y armo el día con eso. Por ejemplo: «hoy almuerzo afuera»…";
  expect(await tool("hoy almuerzo afuera", { mem: memoria({ day_plan_pending: { awaiting: "nota", at: ahora } }), hist: [["user", "Otro"], ["assistant", otro]] })).toBe("day_plan");
  expect(await tool("¿cuánta agua llevo?", { mem: memoria({ day_plan_pending: { awaiting: "nota", at: ahora } }), hist: [["user", "hola"], ["assistant", "¡Hola! ¿En qué te ayudo?"]] })).not.toBe("day_plan");
  const q = "😴 Anoté: Ayer, de 17:30 a 23:50 · 6 h 20. ¿Cómo sigues?";
  const sl = () => memoria({ sleep_pending: { kind: "seguir", fin: ahora, at: ahora } });
  expect(await tool("Parto mi día ahora", { mem: sl(), hist: [["user", "dormí de 17:30 a 23:50"], ["assistant", q]] })).toBe("sleep_log");
  expect(await tool("no, ¿qué como ahora?", { mem: sl(), hist: [["user", "dormí de 17:30 a 23:50"], ["assistant", q]] })).not.toBe("sleep_log");
  expect(await tool("Parto mi día ahora", { mem: sl(), hist: [["user", "hola"], ["assistant", "¿Quieres ideas para la once?"]] })).not.toBe("sleep_log");
}, T);

test("C3: «añade», «pon», «suma» anotan comida, también sin cantidades (porción típica, avisando)", async () => {
  const r = await quien("Añade una ensalada de lechuga, repollo y choclo al almuerzo");
  expect(r.tool).toBe("nutrition_tracker");
  expect(r.texto).toMatch(/registrad/i);
  expect(r.texto).toMatch(/Asumí una porción normal/);
  expect(r.texto).toMatch(/Choclo/);
  expect(await tool("pon 2 huevos en el desayuno")).toBe("nutrition_tracker");
  expect(await tool("suma un pan con palta a la once")).toBe("nutrition_tracker");
  // contar lo que comió sin cantidad sigue yendo al modelo (no se asume)
  expect(await tool("comí lechuga y choclo")).not.toBe("nutrition_tracker");
}, T);

test("Alimentos con dos nombres en la base («Plátano / Banana», «Palta / Aguacate») se anotan", async () => {
  for (const [f, n] of [["anota 1 plátano", "Plátano"], ["registra 200 g de fideos", "Fideos"], ["me comí una hallulla con palta", "Palta"], ["registra 2 vienesas", "Vienesa"]]) {
    const r = await quien(f);
    expect(r.texto).toContain(n);
    expect(r.texto).not.toMatch(/No (encontré|anoté)/);
  }
}, T);

// Forge de ejemplo, como el banco de chat: rutina escrita con HOY en Empuje
function forgeMem() {
  const now = new Date();
  const WD = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const wd = (k: number) => WD[(now.getDay() + k) % 7];
  let S: any = { ...FC.newState(), bodyKg: 85, heightCm: 179, age: 27, sex: "h", goal: "recomp", gym: FCAT.defaultGym("smartfit") };
  const md = [`Día 1: Empuje (${wd(0)})`, "· Press de banca: 4 series x 6-8 reps.", "· Fondos: 3 series x 8-10 reps.", "· Flexiones: 3 series x 12 reps.",
    `Día 2: Tirón (${wd(2)})`, "· Dominadas: 4 series x 6-8 reps.", "· Remo con barra: 4 series x 8-10 reps."].join("\n");
  const parsed = FM.parseRoutineMd(S, md);
  const { routine, newExercises } = FM.mdToRoutine(S, parsed, FM.defaultChoices(parsed), { name: "Mi rutina", now });
  S = FM.applyMdRoutine(S, routine, newExercises);
  const projection = { day: FC.L.todayKey(), plan: FT.planProjection(S), typical: FT.typicalSession(S), routineName: "Mi rutina", ...FR.routineContext(S), progress: FP.progressContext(S) };
  return memoria({ forge_projection: projection, body_profile: { weightKg: 85, heightCm: 179, age: 27, sex: "h" } });
}

test("C4: entreno por código: qué toca hoy, gym o casa, analiza mi entrenamiento", async () => {
  const hoy = await quien("¿qué ejercicio hago hoy?", { mem: forgeMem() });
  expect(hoy.tool).toBe("training_plan");
  expect(hoy.texto).toMatch(/Empuje/);
  const lugar = await quien("¿me conviene ir al gym o entreno en casa?", { mem: forgeMem() });
  expect(lugar.tool).toBe("training_plan");
  expect(lugar.texto).toMatch(/Hoy toca \*\*Empuje\*\*/);
  expect(lugar.texto).toMatch(/casa/);
  expect(lugar.texto).not.toMatch(/undefined|null/);
  expect(await tool("analiza mi entrenamiento", { mem: forgeMem() })).toBe("training_plan");
}, T);

test("Q1: dudas típicas de un suplemento, por código y con la respuesta de la ficha", async () => {
  const cafe = await quien("¿Puedo tomar creatina con un mocaccino?");
  expect(cafe.tool).toBe("supplement_tracker");
  expect(cafe.texto).toMatch(/puedes tomarla con café/);
  expect(cafe.texto).not.toMatch(/elimina la creatina/);
  const desc = await quien("¿tengo que tomar creatina los días de descanso?");
  expect(desc.texto).toMatch(/todos los días, también los de descanso/);
  expect(desc.texto).toMatch(/\[Opción: Ficha de creatina/);
  expect(await tool("¿qué es la creatina?")).toBe("supplement_tracker");
}, T);

test("Q3: «yo lo anoto» se suelta sin insistir", async () => {
  const r = await quien("Lo registro yo con el código de barras");
  expect(r.tool).toBe("nutrition_tracker");
  expect(r.texto).toMatch(/anótalo tú con el código de barras/);
  expect(await tool("no, yo lo anoto")).toBe("nutrition_tracker");
}, T);

test("H1 sigue: con señal de alarma, primero la guía de síntomas", async () => {
  expect(await tool("¿Qué me recomiendas? Me duele el pecho y el brazo izquierdo")).toBe("symptom_guide");
  expect(await tool("¿Qué me recomiendas hoy?")).toBe("day_plan");
}, T);

test("R1: «analiza mi día» por código (línea base) y en Flash; el contexto pegado por apps viejas se quita", async () => {
  const boton = "Profundiza en tu análisis de hoy: ¿qué variable está fuera de mi patrón habitual y qué puedo hacer?";
  expect(esAnalisisDia(boton)).toBe(true);
  expect(classifyQuery(boton)).toBe("flash");
  const r = await quien(boton);
  expect(r.tool).toBe("personal_baseline");
  expect(r.ofrecidas.sort()).toEqual(["get_live_context", "personal_baseline"]);
  const metricas = "Eris, analiza mis métricas de hoy: dame un resumen de cómo estoy y recomendaciones concretas.";
  expect(await tool(metricas)).toBe("personal_baseline");
  // apps ≤1.78
  const viejo1 = `${boton}\n\n[Contexto biométrico detallado: Sueño 6,2 h; pasos 3400; agua 1,2 L …]`;
  expect(sinContextoPegado(viejo1)).toBe(boton);
  const viejo2 = "Eris, analiza mis métricas de hoy. Aquí tienes mi estado detallado:\n\nSueño: 6 h\nPasos: 3400\n\nBasado en esto, dame un resumen de cómo estoy y recomendaciones concretas.";
  expect(sinContextoPegado(viejo2)).toBe("Eris, analiza mis métricas de hoy.: dame un resumen de cómo estoy y recomendaciones concretas.");
  expect(esAnalisisDia(sinContextoPegado(viejo2))).toBe(true);
  // no se confunde con otras cosas
  expect(esAnalisisDia("analiza mis gastos del mes")).toBe(false);
  expect(esAnalisisDia("analiza mi entrenamiento")).toBe(false);
}, T);

test("R2/R5: los usuarios públicos tienen selector y sus herramientas nuevas", async () => {
  for (const n of ["personal_baseline", "get_live_context", "manage_user_context", "personal_journal", "insight_feedback"]) expect(canUseTool(ROLES.eris, n)).toBe(true);
  for (const n of ["bash", "file_read", "file_write", "knowledge_search", "vault_note"]) expect(canUseTool(ROLES.eris, n)).toBe(false);
  const disponibles = new ToolRegistry().getAll().filter((t) => canUseTool(ROLES.eris, t.name)).map((t) => t.name);
  const r = routeTools("registra 2 marraquetas", [], disponibles);
  expect([...r.tools].length).toBeLessThan(disponibles.length);
  expect(r.tools.has("nutrition_tracker")).toBe(true);
});

test("R3: los exámenes solo entran al contexto si el mensaje habla de eso", () => {
  for (const f of ["¿cómo está mi glucosa?", "mis exámenes", "¿qué me dice mi hba1c?", "¿cuántos carbos puedo comer?"]) expect(LABS_TOPIC.test(f.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase())).toBe(true);
  for (const f of ["¿qué ceno?", "¿cuánta plata tengo?", "hola", "me tomé la creatina"]) expect(LABS_TOPIC.test(f.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase())).toBe(false);
});

test("P1/P2: sin rutas del PC ni marcas internas en lo que lee la persona", () => {
  expect(sinRutas("Según C:\\Proyectos\\AXS\\10-19 Strategic Vision\\Visión de Eris.md, la meta es…")).toBe("Según «Visión de Eris», la meta es…");
  expect(sinRutas("Está en `C:\\Proyectos\\eris\\` y en ~/.eris/profiles/x")).toBe("Está en una carpeta del PC y en los datos de Eris");
  expect(sinRutas("Toma 2 vasos de agua.")).toBe("Toma 2 vasos de agua.");
  // los enlaces de las fuentes quedan intactos
  const fuentes = "Fuente: https://doi.org/10.1186/s12970-017-0173-z y https://ods.od.nih.gov/factsheets/Iron-HealthProfessional/ (ver https://x.cl/c/Users/a.md)";
  expect(sinRutas(fuentes)).toBe(fuentes);
  expect(sinRutas("Lo dejé en /c/Users/arkse/Desktop/informe.pdf")).toBe("Lo dejé en «informe»");
  expect(sinRutas("a las 10:30 y 5:2 de ratio")).toBe("a las 10:30 y 5:2 de ratio");
  expect(salidaHumana("HECHO (estado): Creatina: te falta la toma de hoy.")).toBe("Creatina: te falta la toma de hoy.");
  expect(salidaHumana("FICHA (copia el contenido tal cual, sin agregar dosis):\nCreatina monohidratada…")).toBe("Creatina monohidratada…");
  expect(salidaHumana("SIN DATOS de Inventario. Tu Inventario vive en el teléfono.")).toBe("Tu Inventario vive en el teléfono.");
});
