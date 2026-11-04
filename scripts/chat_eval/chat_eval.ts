// ============================================================
// Banco de pruebas del chat de Eris (2026-10-16)
//
// Manda frases típicas (inventadas a partir de los TIPOS de falla vistos en conversaciones reales; nada copiado) a un servidor
// AISLADO con el modelo de verdad (Ollama), y revisa cada respuesta: herramienta correcta, cifras, nada inventado, sin
// razonamiento a la vista, sin trato raro, latencia. Perfil de prueba «ikaros» en MODO ERIS (axs:false), como la cuenta real.
//
// Nunca toca los datos reales: exige un HOME aislado (USERPROFILE/HOME que contenga «erishome»).
//   1) bun scripts/chat_eval/setup.ts              (con el HOME aislado: cuentas de prueba + día limpio; antes de levantar el servidor)
//   2) ERIS_PORT=3100 bun src/server.ts            (con el mismo HOME aislado; ERIS_DEBUG_PROMPT=1 muestra el tamaño del prompt)
//   3) bun scripts/chat_eval/chat_eval.ts [filtro] (con el mismo HOME) → <HOME>/chat_eval.out.json
// Ollama tiene que estar arriba. Una corrida completa tarda ~10-20 min según cuánto del modelo quepa en la GPU.
// ============================================================
import * as os from "os";
import { readFile, writeFile } from "fs/promises";
import * as C from "../../src/services/FinanceCore.ts";
import * as INV from "../../src/services/InventoryCore.ts";
import * as SUP from "../../src/services/SupplementCore.ts";
import * as FC from "../../src/services/forge/forgeCore.ts";
import * as FCAT from "../../src/services/forge/forgeCatalog.ts";
import * as FM from "../../src/services/forge/forgeMdRoutine.ts";
import * as FR from "../../src/services/forge/forgeRoutine.ts";
import * as FT from "../../src/services/forge/forgeTrain.ts";
import * as FP from "../../src/services/forge/forgeProgress.ts";
import * as SC from "../../src/services/SleepCore.ts";
if (!/erishome/i.test(os.homedir())) { console.log("Usa USERPROFILE temporal (erishome)"); process.exit(2); }
const OUT = os.homedir();
const PORT = Number(process.env.ERIS_EVAL_PORT) || 3100;
const tokens = JSON.parse(await readFile(`${os.homedir()}/tokens.json`, "utf8"));
const FILTRO = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
for (let i = 0; i < 120; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

// ─── Conexión (con un «teléfono» falso que aplica lo de Finanzas con el núcleo de verdad) ───
const now = new Date();
let id = 1;
const fctx = { now: new Date(now.getFullYear(), now.getMonth(), 1, 9), newId: () => id++ };
let FS = C.draft(C.onboarding({ sueldo: 1_200_000, presup: { alimentacion: 250_000 } }, fctx));
C.formCuenta(FS, { banco: "BCI", tipo: "debito", saldo: 450_000 }, fctx);
const bci = FS.cuentas.find((c) => c.nombre === "BCI")!.id;
C.formSueldo(FS, { monto: 1_200_000, dia: 30, cuenta: bci }, fctx);
C.formGasto(FS, { desc: "Super", monto: 42_000, cat: "alimentacion", cuenta: bci, fecha: C.todayStr(new Date(now.getFullYear(), now.getMonth(), 2)) }, fctx);

// …y un Inventario de ejemplo (fase I2, 2026-10-22): lo aplica el mismo núcleo que el teléfono
let IS = INV.draft(INV.emptyState());
INV.agregar(IS, { nombre: "Arroz", cantidad: 2, unidad: "kg" }, fctx);
INV.agregar(IS, { nombre: "Shampoo", cantidad: 1, minimo: 1, precioTotal: 3990 }, fctx);
INV.agregar(IS, { nombre: "Yogur", cantidad: 4, vence: C.todayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)) }, fctx);
// Fase I7: comida en casa para que el asesor arme con lo que hay (la pechuga vence mañana: va primero)
INV.agregar(IS, { nombre: "Pechuga de pollo", cantidad: 2, vence: C.todayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) }, fctx);
INV.agregar(IS, { nombre: "Lentejas", cantidad: 1, unidad: "kg" }, fctx);
INV.agregar(IS, { nombre: "Tomate", cantidad: 4 }, fctx);

// …y «Mis suplementos» (fase I5, 2026-10-23): creatina y omega 3, nada tomado aún
let SS = SUP.emptySupState();
SUP.agregarSup(SS, { nombre: "Creatina monohidratada", cantidad: 5 }, { now, newId: () => `s${id++}` });
SUP.agregarSup(SS, { nombre: "Omega 3", cantidad: 1, unidad: "cápsula", tomasDia: 2 }, { now, newId: () => `s${id++}` });

const events: any[] = [];
let ws: WebSocket;
async function conectar() {
  let ready = false;
  ws = new WebSocket(`ws://localhost:${PORT}/ws?profile=ikaros`);
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.type === "finance_op") {
      const r = C.applyOp(FS, m.op, { now: new Date(), newId: () => id++ });
      FS = r.state;
      ws.send(JSON.stringify({ type: "finance_op_result", requestId: m.requestId, result: r.result }));
      return;
    }
    if (m.type === "inventory_op") {
      const r = INV.applyOp(IS, m.op, { now: new Date(), newId: () => id++ });
      IS = r.state;
      ws.send(JSON.stringify({ type: "inventory_op_result", requestId: m.requestId, result: r.result }));
      return;
    }
    if (m.type === "supplement_op") {
      const r = SUP.applyOp(SS, m.op, { now: new Date(), newId: () => `s${id++}` });
      SS = r.state;
      ws.send(JSON.stringify({ type: "supplement_op_result", requestId: m.requestId, result: r.result }));
      return;
    }
    events.push(m);
    if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth_session", token: tokens.ikaros, caps: ["finance_ops", "inventory_ops", "supplement_ops"] }));
    // El teléfono manda sus suplementos al conectar (el preroute los usa para reconocer «me tomé el omega»)
    if (m.type === "connected") ws.send(JSON.stringify({ type: "update_supplement_context", context: SUP.extract(SS, new Date()).context, summary: null, state: SS }));
    // …y su respaldo del Inventario (de ahí sale la despensa del asesor, fase I7)
    if (m.type === "connected") ws.send(JSON.stringify({ type: "inventory_backup_push", dump: { v: 1, profile: "ikaros", at: new Date().toISOString(), keys: { inventory_state_v1: JSON.stringify(IS) } } }));
    if (m.type === "connected") ready = true;
  };
  for (let i = 0; i < 200 && !ready; i++) await new Promise((r) => setTimeout(r, 100));
  if (!ready) { console.log("❌ no conectó"); process.exit(1); }
}
await conectar();
const waitFor = async (type: string, send: any, ms = 15000) => {
  events.length = 0; ws.send(JSON.stringify(send));
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const e = events.find((x) => x.type === type); if (e) return e; await new Promise((r) => setTimeout(r, 50)); }
  return null;
};

// ─── Datos de prueba: diabetes tipo 2 con medicamentos (glucosa APAGADA), cuerpo, sueño, finanzas ───
const today = C.todayStr(now);
await waitFor("profile_saved", { type: "save_profile", profile: { displayName: "Alex", medical: { conditions: [{ id: "diabetes_t2" }],
  medications: [{ id: "1", name: "Sitagliptina 100 mg", active: true }, { id: "2", name: "Forxiga 10 mg", active: true }] } } });
await waitFor("nutrition_today", { type: "sync_body_profile", body: { weightKg: 85, heightCm: 179, age: 27, sex: "h", activity: 1.55, date: today, trainingKcal: 0, trainingSets: 0 } });
ws.send(JSON.stringify({ type: "update_health_snapshot", snapshot: { lastUpdated: new Date().toISOString(), sleep: { durationHours: 6.2 }, steps: 3400, restingHeartRate: 70 } }));
const ex = C.extract(FS, now);
ws.send(JSON.stringify({ type: "update_financial_context", context: ex.context, summary: ex.summary }));
await waitFor("finance_backup_saved", { type: "finance_backup_push", dump: { v: 1, profile: "ikaros", at: new Date().toISOString(), stats: { tx: 0, cuentas: 0, claves: 0 }, keys: C.toHwKeys(FS) } });
// Guardar el perfil rearma el motor del chat: se reconecta (como la app)
try { ws.close(); } catch {}
await new Promise((r) => setTimeout(r, 800));
await conectar();

// ─── Forge (2026-10-23, «Eris como Jarvis»): 4 semanas de entreno, su rutina escrita con HOY entre sus días, y la misma
// proyección que manda el teléfono (trainingIntent.publishProjection): plan de hoy, sesión típica, rutina, máximos y progreso.
// Es una función: los casos de entreno la vuelven a mandar (el caso «md-rutina» carga otra rutina)
async function sembrarForge() {
  const WD = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const wd = (k: number) => WD[(now.getDay() + k) % 7];
  let FSg: any = { ...FC.newState(), bodyKg: 85, heightCm: 179, age: 27, sex: "h", goal: "recomp", gym: FCAT.defaultGym("smartfit"), classes: ["calistenia", "boxeo"] };
  const dia = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  for (let w = 4; w >= 0; w--) for (const off of [6, 4, 2]) {
    const ago = w * 7 + off;
    if (ago <= 0) continue;
    const up = 4 - w;
    for (let k = 0; k < 3; k++) {
      FSg = FC.logSet(FSg, dia(ago), "press_banca", { reps: 8, kg: 60 + up * 2.5, rir: 2 });
      FSg = FC.logSet(FSg, dia(ago), "dom_prona", { reps: 8, kg: 5 + up * 2.5, rir: 2 });
      FSg = FC.logSet(FSg, dia(ago), "sentadilla_bb", { reps: 6, kg: 80 + up * 5, rir: 2 });
    }
    FSg = FC.logSet(FSg, dia(ago), "saco", { reps: 180 });
  }
  const md = [`Día 1: Empuje (${wd(0)})`, "· Press de banca: 4 series x 6-8 reps.", "· Fondos: 3 series x 8-10 reps.",
    `Día 2: Tirón (${wd(2)})`, "· Dominadas: 4 series x 6-8 reps.", "· Remo con barra: 4 series x 8-10 reps.",
    `Día 3: Pierna y combate (${wd(4)})`, "· Sentadilla con barra: 4 series x 6 reps.", "· Saco de boxeo: 5 rounds de 3 minutos."].join("\n");
  const parsed = FM.parseRoutineMd(FSg, md);
  const { routine, newExercises } = FM.mdToRoutine(FSg, parsed, FM.defaultChoices(parsed), { name: "Mi rutina", now });
  FSg = FM.applyMdRoutine(FSg, routine, newExercises);
  const projection = { day: FC.L.todayKey(), plan: FT.planProjection(FSg), typical: FT.typicalSession(FSg), routineName: "Mi rutina", ...FR.routineContext(FSg), progress: FP.progressContext(FSg) };
  ws.send(JSON.stringify({ type: "sync_toji_context", routineMd: md, routineName: "Mi rutina", customExercises: FSg.customExercises }));
  ws.send(JSON.stringify({ type: "sync_forge_projection", projection }));
  await new Promise((r) => setTimeout(r, 600));
}
await sembrarForge();

// ─── Un turno de chat ───
async function chat(text: string) {
  events.length = 0;
  const t0 = Date.now();
  ws.send(JSON.stringify({ type: "message", content: text, mode: "flash", axs: false }));
  while (Date.now() - t0 < 180_000) {
    const e = events.find((x) => x.type === "stream_end" || x.type === "error" || x.type === "stopped");
    if (e) {
      const tools = events.filter((x) => x.type === "tool_call").map((x) => x.name);
      // Desde la revisión V1 (P2) al teléfono solo llega si salió bien; el detalle del error queda en el registro del servidor
      const toolErr = events.filter((x) => x.type === "tool_result" && (x.ok === false || x.error)).map((x) => `${x.name}: falló`);
      return { text: String(e.content ?? e.message ?? ""), ms: Date.now() - t0, tools, toolErr, kind: e.type };
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  return { text: "(sin respuesta en 3 min)", ms: Date.now() - t0, tools: [] as string[], toolErr: [] as string[], kind: "timeout" };
}
const nuevoChat = () => waitFor("chat_switched", { type: "new_chat" });

// ─── Casos ───
interface Caso {
  id: string; cat: string; turns: string[];
  /** alguna de estas herramientas en el ÚLTIMO turno */
  tools?: string[];
  /** ninguna herramienta en el último turno */
  sinTools?: boolean;
  noTools?: string[];
  must?: RegExp[]; mustNot?: RegExp[];
  /** fallas que no son de fondo (largo, formato) */
  blandas?: boolean;
  /** preparar el día antes del caso (p. ej. un snapshot del teléfono con la hora de despertar) */
  antes?: () => Promise<void>;
}
/** El agua tratada como deuda contra la meta del día: «reponer», «deshidratado», «2 vasos para llegar a la meta». */
/** Su saldo como si fuera para comer («con los $791.951 que tienes a mano»): el presupuesto de comida definido sí se puede decir */
const PLATA_A_MANO = /\$\s?[0-9.]+ que tienes a mano|tu disponible/i;
const AGUA_DEUDA = /reponer|deshidrat|prioridad[^.]{0,30}agua|vasos?[^.]{0,40}(llegar|completar|cumplir) (a |con )?(la|tu) meta/i;
/** «Editar información nutricional» en la app: el teléfono manda tus versiones de alimentos (FoodResolve.myFoodFor). */
/** Los módulos encendidos en Perfil, como los manda la app con «Así manejo tu…» (null = todos) */
const modulos = (m: string[] | null) => async () => {
  ws.send(JSON.stringify({ type: "save_preference", key: "auto_prefs", value: { v: 1, modulos: m } }));
  await new Promise((r) => setTimeout(r, 500));
};
const misAlimentos = (foods: unknown[]) => async () => {
  ws.send(JSON.stringify({ type: "my_foods_sync", foods }));
  await new Promise((r) => setTimeout(r, 500));
};
/** Su rutina escrita (fase I8: «carga mi rutina»), con el formato de verdad: emojis, días de la semana, bloques Gym / Casa */
const miRutina = () => async () => {
  ws.send(JSON.stringify({ type: "sync_toji_context", routineName: "prueba", routineMd: [
    "RUTINA DE PRUEBA", "", "🗓️ DÍA 1: EMPUJE (Lunes)", "🏋️ Sesión A: Gym", "· Press de Banca (Barra o Mancuernas): 4 series x 6-8 reps. (60 kg en barra)",
    "🏠 Sesión B: Casa", "· Anillas - Ring Dips: 3 series x 6-8 reps.", "· Handstand (Pino contra la pared): 3 series x 45 segundos.", "",
    "🗓️ DÍA 2: PIERNA (Jueves)", "· Sentadilla Búlgara (Mancuernas): 3 series x 8-10 reps por pierna.", "· Sprints: 6 series de 30 metros.",
  ].join("\n") }));
  await new Promise((r) => setTimeout(r, 500));
};
/** El teléfono manda «despertó hace N horas y lleva X L»: la hora de SU día manda, no el reloj (MealSchedule.normDayHour). */
const mediaManana = (awakeH: number, litros: number) => async () => {
  ws.send(JSON.stringify({ type: "update_health_snapshot", snapshot: { lastUpdated: new Date().toISOString(), dayWakeTime: new Date(Date.now() - awakeH * 3600_000).toISOString(),
    hydration: litros, chatWaterCounted: [], sleep: { durationHours: 7.5 }, steps: 1200, restingHeartRate: 68 } }));
  await new Promise((r) => setTimeout(r, 700));
};
// Sueño 2.0 · S0: el día partido del 24-10 (02:33–03:18 + 04:20–09:05 + 13:51–17:54), como lo mandará el teléfono. Si todavía
// no son las 18:30, el mismo día de ayer.
const suenoPartido = async () => {
  const base = new Date(); base.setHours(0, 0, 0, 0);
  if (Date.now() < base.getTime() + 18.5 * 3600_000) base.setDate(base.getDate() - 1);
  const at = (h: number, m: number) => base.getTime() + (h * 60 + m) * 60_000;
  const partido = [{ start: at(2, 33), end: at(3, 18) }, { start: at(4, 20), end: at(9, 5) }, { start: at(13, 51), end: at(17, 54) }];
  // y 2 semanas antes, cada vez más tarde (S1: deuda, regularidad, tendencia y la hora para acostarse)
  const antes = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -1.5, 1, -0.5, 0.5, 2, 2].map((h, i) => ({ start: at(h - 24 * (13 - i), 0), end: at(h - 24 * (13 - i) + 7, 0) }));
  const o = { usualWake: 7.75, usualSleepH: 7.25 };
  const d = SC.sleepDay(partido, o)!;
  const ins = SC.sleepInsights([...antes, ...partido], { ...o, now: Date.now() });
  ws.send(JSON.stringify({ type: "update_health_snapshot", snapshot: { lastUpdated: new Date().toISOString(), dayWakeTime: d.dayWake, wakeTime: d.lastWake,
    sleep: { durationHours: d.totalH, nightHours: d.nightH, split: d.split, episodes: d.episodes, startTime: d.night!.start, endTime: d.night!.end },
    sleepInsights: ins, schedule: { usualWake: 7.75, sleepHours: 7.25 } } }));
  await new Promise((r) => setTimeout(r, 700));
};
// Sueño 2.0 · S3: una noche corta (02:00–07:15, 5 h 15) tras 2 semanas normales; `cafeHasta` adelanta la hora límite del café
// (para probar el aviso de café tarde a cualquier hora del día)
const suenoCorto = async (cafeHasta?: number) => {
  const base = new Date(); base.setHours(0, 0, 0, 0);
  if (Date.now() < base.getTime() + 7.5 * 3600_000) base.setDate(base.getDate() - 1);
  const at = (h: number, m: number) => base.getTime() + (h * 60 + m) * 60_000;
  const corta = [{ start: at(2, 0), end: at(7, 15) }];
  const antes = Array.from({ length: 13 }, (_, i) => ({ start: at(0.5 - 24 * (13 - i), 0), end: at(0.5 - 24 * (13 - i) + 7.25, 0) }));
  const o = { usualWake: 7.75, usualSleepH: 7.25 };
  const d = SC.sleepDay(corta, o)!;
  const ins = SC.sleepInsights([...antes, ...corta], { ...o, now: Date.now() });
  if (cafeHasta != null) ins.caffeineUntil = cafeHasta;
  // sin patrones ni plan (null explícito, como el teléfono: el servidor junta cada snapshot con el anterior)
  ws.send(JSON.stringify({ type: "update_health_snapshot", snapshot: { lastUpdated: new Date().toISOString(), dayWakeTime: d.dayWake, wakeTime: d.lastWake,
    sleep: { durationHours: d.totalH, nightHours: d.nightH, split: d.split, episodes: d.episodes, startTime: d.night!.start, endTime: d.night!.end },
    sleepInsights: ins, sleepPatterns: null, sleepPlan: null, schedule: { usualWake: 7.75, sleepHours: 7.25 } } }));
  await new Promise((r) => setTimeout(r, 700));
};
// Sueño 2.0 · S4: un mes en que las noches con café a las 20:00 (días pares) son 1 h más cortas, como lo calcula el teléfono
const suenoConCafe = async () => {
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const at = (dAgo: number, h: number) => base.getTime() - dAgo * 86_400_000 + h * 3_600_000;
  const ses: Array<{ start: number; end: number }> = [];
  const ev = { caffeine: [] as number[], alcohol: [] as number[], meals: [] as number[], training: [] as number[], logged: [] as number[] };
  for (let d = 28; d >= 1; d--) {
    const par = d % 2 === 0;
    ev.logged.push(at(d + 1, 13.5)); ev.meals.push(at(d + 1, 13.5));
    if (par) { ev.caffeine.push(at(d + 1, 20)); ev.logged.push(at(d + 1, 20)); }
    ses.push(par ? { start: at(d, 1.5), end: at(d, 7.75) } : { start: at(d, 0.5), end: at(d, 7.75) });
  }
  const o = { usualWake: 7.75, usualSleepH: 7.25 };
  const ins = SC.sleepInsights(ses, { ...o, now: Date.now() });
  const pats = SC.sleepPatterns(ses, ev, { ...o, now: Date.now() });
  ws.send(JSON.stringify({ type: "update_health_snapshot", snapshot: { lastUpdated: new Date().toISOString(), sleep: { durationHours: 7.25 },
    sleepInsights: ins, sleepPatterns: pats, schedule: { usualWake: 7.75, sleepHours: 7.25 } } }));
  await new Promise((r) => setTimeout(r, 700));
};
const NO_PC = /\b(procesos?|cpu|memoria ram|bash|powershell|claude)\b/i;
const CASOS: Caso[] = [
  // Registro de comida y agua
  { id: "agua-500", cat: "registro", turns: ["Registra 500ml de agua"], tools: ["nutrition_tracker"], must: [/500\s?ml|0[,.]5\s?l/i] },
  { id: "desayuno-2", cat: "registro", turns: ["Anota un pan con palta y un café con leche"], tools: ["nutrition_tracker"], must: [/palta/i, /caf[eé]/i] },
  { id: "registra-explicito", cat: "registro", turns: ["Registra: completo italiano sin mayo como once"], tools: ["nutrition_tracker"], mustNot: [/¿(quieres|te lo) (que )?(la |lo )?(anote|registre)/i] },
  { id: "almorce-casual", cat: "registro", turns: ["Almorcé un plato de porotos con riendas"], tools: ["nutrition_tracker"], blandas: true },
  { id: "dos-comidas", cat: "registro", turns: ["Anótame 3 empanadas de queso para la cena y una para la once"], tools: ["nutrition_tracker"], must: [/cena/i, /once/i] },
  { id: "tres-gramos", cat: "registro", turns: ["Para el almuerzo registra 230 g de arroz, 250 g de costillar y 80 g de ensalada de lechuga"], tools: ["nutrition_tracker"], must: [/arroz/i, /costillar|cerdo/i, /ensalada|lechuga/i] },
  { id: "faltó-algo", cat: "registro", turns: ["Registra fideos con salsa para el almuerzo", "Te faltó la carne molida, unos 150 g"], tools: ["nutrition_tracker"], must: [/carne/i], mustNot: [/opci[oó]n 1/i] },
  { id: "borrar-ultimo", cat: "registro", turns: ["Anota una manzana como colación", "Borra lo último que anoté"], tools: ["nutrition_tracker"], must: [/borr|elimin|saqu|quit/i] },
  { id: "repetido", cat: "registro", turns: ["Registra un yogurt como colación", "Registra un yogurt como colación"], must: [/ya (lo |te lo )?(anot|registr)|otro yogurt|de nuevo|dos veces|segundo/i] },
  { id: "ingrediente-raro", cat: "registro", turns: ["Quiero anotar maní confitado y no lo encontré en el buscador, ¿me ayudas? unos 50 g como colación"], tools: ["nutrition_tracker"], mustNot: [/pan, mermelada|mantequilla/i] },
  // Consultas del día
  { id: "agua-hoy", cat: "consulta", turns: ["¿Cuánta agua llevo hoy?"], must: [/\d/, /l\b|litros?/i] },
  { id: "que-comi", cat: "consulta", turns: ["¿Qué he comido hoy?"], must: [/\d/] },
  { id: "como-voy", cat: "consulta", turns: ["¿Cómo voy hoy y qué hago ahora?"], mustNot: [/glucosa (est[aá]|de) \d/i] },
  { id: "entrenar-fallo", cat: "consulta", turns: ["¿Puedo entrenar al fallo hoy?"], mustNot: [/glucosa (probablemente|seguramente) (est[aá] )?alta/i, /\bno entrenes\b/i], blandas: true },
  { id: "pre-entreno", cat: "consulta", turns: ["Voy a entrenar en una hora, dame ideas para comer antes"], must: [/(avena|pl[aá]tano|pan|marraqueta|hallulla|yogur|fruta|arroz|tostada|galleta|manzana)/i], mustNot: [/^¿qu[eé] tienes a mano\??$/i] },
  { id: "proponme", cat: "consulta", turns: ["Proponme opciones para comer ahora"], must: [/(avena|pl[aá]tano|pan|marraqueta|yogur|fruta|huevo|ensalada|pollo|carne|arroz|legumbre|tostada|queso)/i] },
  // Conocimiento general (responde, sin «no tengo registro»)
  { id: "azucar-canamo", cat: "general", turns: ["¿Cuánta azúcar tiene la semilla de cáñamo?"], mustNot: [/no tengo (registro|datos|informaci[oó]n)/i], must: [/\d/] },
  { id: "orden-comidas", cat: "general", turns: ["¿Cuál es el orden de las comidas del día, de la más temprano a la más tarde?"], must: [/desayuno[\s\S]*almuerzo[\s\S]*(once|cena)/i], mustNot: [/no tengo registro|en mis archivos/i] },
  { id: "imanes", cat: "general", turns: ["Diferencia entre imán de neodimio y ferrita"], sinTools: true, must: [/neodimio/i] },
  { id: "suma", cat: "general", turns: ["¿Cuánto es 54 más 27?"], sinTools: true, must: [/\b81\b/] },
  { id: "coca-zero", cat: "general", turns: ["¿Qué ingredientes tiene la Coca-Cola Zero?"], mustNot: [/sacarosa|az[uú]car real/i], must: [/aspartam|edulcorante|acesulfam/i] },
  { id: "hba1c", cat: "general", turns: ["¿Qué es la hemoglobina glicosilada?"], must: [/(3|tres) meses|promedio/i] },
  // Sueño
  { id: "sueño-rango", cat: "sueño", turns: ["Dormí desde las ocho y cuarto hasta las once y cuarto"], tools: ["sleep_log"], must: [/\b3\s?(h|horas)\b/i], mustNot: [/4[,.]2/] },
  { id: "sueño-extra", cat: "sueño", turns: ["Anoche dormí 4 horas y después en la mañana dormí 3 horas más"], tools: ["sleep_log"], must: [/\b7\s?(h|horas)\b/i] },
  // Finanzas
  { id: "gasto", cat: "finanzas", turns: ["Gasté 5 lucas en almuerzo con la BCI"], tools: ["finance_tracker"], must: [/5\.000/] },
  { id: "y-si", cat: "finanzas", turns: ["¿Y si me compro unas zapatillas de 60 lucas?"], tools: ["finance_tracker"], must: [/60\.000/] },
  { id: "plata", cat: "finanzas", turns: ["¿Cuánta plata tengo?"], tools: ["finance_tracker"], must: [/\$\s?\d/] },
  // 23-10: «me queda» del Inventario se llevaba la pregunta de plata del mes
  { id: "queda-mes", cat: "finanzas", turns: ["¿Cuánto me queda este mes?"], tools: ["finance_tracker"], noTools: ["inventory_tracker"] },
  // Inventario (fase I2): por código lo claro, y el modelo con la herramienta cuando la frase es más suelta
  { id: "inv-compra", cat: "inventario", turns: ["Compré 2 L de leche y 6 huevos"], tools: ["inventory_tracker"], must: [/Leche/, /Huevos/], noTools: ["nutrition_tracker", "finance_tracker"] },
  { id: "inv-tengo", cat: "inventario", turns: ["¿Tengo arroz?"], tools: ["inventory_tracker"], must: [/2 kg/] },
  { id: "inv-acabo", cat: "inventario", turns: ["Se me acabó el shampoo"], tools: ["inventory_tracker"], must: [/lista de compras/i] },
  { id: "inv-lista", cat: "inventario", turns: ["¿Qué me falta comprar?"], tools: ["inventory_tracker"], must: [/Shampoo/] },
  { id: "inv-vence", cat: "inventario", turns: ["¿Qué se me vence esta semana?"], tools: ["inventory_tracker"], must: [/Yogur/] },
  { id: "inv-suelto", cat: "inventario", turns: ["oye eris, revisa si me queda yogur en el refri antes de ir al súper"], tools: ["inventory_tracker"], must: [/[Yy]ogur/], mustNot: [/no tengo acceso|no puedo ver/i] },
  { id: "inv-comi", cat: "inventario", turns: ["Me comí 2 huevos al desayuno"], tools: ["nutrition_tracker"], noTools: ["inventory_tracker"] },
  // Conversación e identidad
  { id: "hola", cat: "conversación", turns: ["Hola Eris uwu"], mustNot: [/glucosa/i, /\bhijo\b/i], must: [/\w/] },
  { id: "recien-desperte", cat: "conversación", turns: ["Hola Eris", "Recién desperté, no hace falta nada todavía"], mustNot: [/glucosa|carga gluc/i] },
  { id: "creador", cat: "conversación", turns: ["Yo te creé, soy Alexander, el CEO de AXS"], mustNot: [/modo axs executive|no eres (el|tu) creador|no te cre[eé] yo/i] },
  { id: "musica", cat: "conversación", turns: ["[MÚSICA]"], must: [/\w/] },
  { id: "muy-bien", cat: "conversación", turns: ["¡Muy bien!"], must: [/\w/] },
  { id: "hora-del-dia", cat: "conversación", turns: ["¿Por qué la hora de mi día es distinta a la hora actual?"], must: [/despert|levant/i], mustNot: [/glucosa/i, /\bhijo\b/i] },
  // Salud
  { id: "calambre", cat: "salud", turns: ["Me va a dar un calambre en el pie, ¿qué hago?"], tools: ["symptom_guide"], must: [/estir|elong/i] },
  { id: "bebidas-agua", cat: "salud", turns: ["Me tomé dos coca zero de 591 ml, ¿cuentan como agua?"], mustNot: [/no (cuentan|sirven) para nada/i] },
  // Herramientas que no corresponden en modo Eris
  { id: "metricas", cat: "herramientas", turns: ["Eris, analiza mis métricas de hoy"], noTools: ["system_info", "bash"], mustNot: [NO_PC] },
  // 2026-10-16 (chat real): pidió zapatillas de básquet y Eris le habló de sus kcal, su plata y una «glucosa estable» inventada
  // 23-10: con la clave de Brave, se busca por código (WebSearchTool.preroute). Preguntar «¿qué presupuesto tienes?» por las
  // zapatillas está bien; lo que no puede es meter TU plata, tus kcal o tu glucosa
  { id: "zapatillas", cat: "herramientas", turns: ["Para hacer básquet, ¿qué zapatillas debo usar?", "Sí porfa"], tools: ["web_search"], mustNot: [/kcal|prote[ií]na|glucosa|\$\s?\d{2,3}\.\d{3}|tu presupuesto (del mes|mensual|de)|te quedan? \$/i], blandas: false },
  { id: "precios", cat: "herramientas", turns: ["Busca precios de un notebook gamer"], mustNot: [/\$\s?\d{3}\.\d{3}.*\$\s?\d{3}\.\d{3}/] , blandas: true },
  // 2026-10-18 (chat real, 10:54, 0,5 de 4 L): «tu prioridad es reponer esos 3,5 litros que te faltan». El agua se mide A ESTA
  // HORA (a esa hora lo esperable era ~1,1 L: 2 vasos atrás) y lo que falta del día no es deuda. En el perfil de prueba (meta
  // 2 L), 0,2 L a las 3,7 h de despertar también va atrás. Van al final: dejan el día a media mañana (snapshot con el despertar).
  { id: "agua-ritmo", cat: "salud", antes: mediaManana(3.7, 0.2), turns: ["¿Cómo voy con el agua?"],
    must: [/vaso|al d[ií]a|a esta hora|esperable|cumplida/i], mustNot: [AGUA_DEUDA] }, // en la corrida completa la comida anterior ya trae agua
  { id: "agua-desayuno", cat: "salud", antes: mediaManana(3.7, 0.2), turns: ["Recomiéndame un desayuno", "Tengo pollo, chuleta de cerdo, queso, pan castaño y pan normal"],
    mustNot: [AGUA_DEUDA] },
  // Revisión de los chats reales del 16 al 21 de octubre (2026-10-21)
  // 18-10: no llamó build_routine, escribió «llama symptom_guide» y «Dale, registra» anotó un completo italiano inventado
  { id: "rutina-chat", cat: "entreno", turns: ["Arma mi rutina en base a Toji fushiguro, dividelo en grupos musculares", "1. 3 o 4 días máximo\n2. Gimnasio y casa\n3. Smartfit completo y en casa mancuernas y anillas\n4. Mi hombro izquierdo se siente raro, no alcanza a doler"],
    tools: ["training_plan"], must: [/tu rutina de 3 d[ií]as/i, /casa/i], mustNot: [/symptom_guide|\bllama\b/i] },
  // 23-10 (fase I8): su rutina escrita → plan por días, con la vista previa y la confirmación (nada se carga sin «sí»)
  { id: "md-rutina", cat: "entreno", antes: miRutina(), turns: ["Carga mi rutina", "Sí, cárgala"], tools: ["training_plan"], must: [/quedó como plan/i, /2 días/, /ejercicio propio nuevo/], mustNot: [/no tengo tu rutina/i] },
  { id: "dale-registra", cat: "entreno", turns: ["Quiero mi rutina, una para el gimnasio y otra para la casa", "Dale, registra"], noTools: ["nutrition_tracker"], mustNot: [/completo|s[aá]ndwich|kcal/i] },
  // 18-10: «Son 250g, no 150g» anotó «pechuga de pollo a la plancha»
  // Nutrición I4 (2026-10-23): lo natural primero (la fruta, no el jugo) y tu versión de un alimento (corregida en la app)
  { id: "natural-fruta", cat: "registro", turns: ["Me comí una pera y una naranja de colación"], tools: ["nutrition_tracker"], must: [/pera/i, /naranja/i], mustNot: [/jugo|n[eé]ctar|agua de pera|bebida/i] },
  { id: "tu-version", cat: "registro", antes: misAlimentos([{ name: "Hallulla", calories: 250, protein: 8, carbs: 48, fat: 3, fiber: 2, servingSize: 100, servings: [{ description: "1 unidad (100 g)", grams: 100 }] }]),
    turns: ["Anota una hallulla al desayuno"], tools: ["nutrition_tracker"], must: [/250\s?kcal/i] },
  // Suplementos (fase I5): «me tomé…» lo aplica el teléfono; la ficha sale por código y nunca indica empezar
  { id: "sup-tomar", cat: "suplementos", turns: ["Me tomé la creatina"], tools: ["supplement_tracker"], must: [/creatina/i, /listo/i], noTools: ["nutrition_tracker"] },
  { id: "sup-falta", cat: "suplementos", turns: ["¿Qué suplementos me faltan hoy?"], tools: ["supplement_tracker"], must: [/omega/i] },
  { id: "sup-ficha", cat: "suplementos", turns: ["¿Sirve la creatina?"], tools: ["supplement_tracker"], must: [/3 a 5 g/i, /referencia/i], mustNot: [/\b(deber[ií]as|tienes que) (tomar|empezar)/i] },
  { id: "sup-vitc-naranja", cat: "suplementos", turns: ["¿Cuánta vitamina C tiene una naranja?"], tools: ["supplement_tracker"], must: [/80 mg/, /\d/] },
  // Asesor con la despensa del Inventario, antojos con contrapartida y el trato (fase I7)
  { id: "adv-casa", cat: "asesor", turns: ["¿Qué como ahora?"], tools: ["metabolic_advisor"], must: [/Tengo otras cosas/, /pollo|lentejas|huevo/i], mustNot: [/qu[eé] tienes a mano/i] },
  { id: "antojo-trato", cat: "asesor", turns: ["Tengo antojo de dos completos", "Acepto la contrapartida", "¿Cómo voy hoy?"], tools: ["metabolic_advisor"], must: [/trato por dos completos/i] },
  { id: "corregir-cantidad", cat: "registro", turns: ["Anota 150 g de carne mongoliana para la cena", "Son 250g, no 150g"], tools: ["nutrition_tracker"], must: [/250 ?g/i, /mongoliana/i], mustNot: [/pollo|pechuga/i] },
  // 19-10: el botón de ayuda del buscador llegó a Hestia, que contestó «¡Qué buen descanso!»
  { id: "buscador-ayuda", cat: "registro", turns: ["Quiero anotar «Keto chicken melt Starbucks» y no lo encontré en el buscador. ¿Me ayudas?"], tools: ["nutrition_tracker"], must: [/calor[ií]as y prote[ií]nas por porci[oó]n|anot/i], mustNot: [/descanso/i] },
  // 19-10: «snack con fibra» → 500 kcal de carne molida con avena «hay que cocinar», «el pan lo dejé fuera por el gluten» (sin
  // esa restricción) y «con los $791.951 que tienes a mano»; «estoy en el trabajo, no puedo cocinar» quedó como despensa
  { id: "snack-fibra", cat: "salud", turns: ["Recomiéndame un snack con fibra que no se pase de mis calorías"], tools: ["metabolic_advisor"],
    mustNot: [/gluten|hay que cocinar|lim[oó]n/i, PLATA_A_MANO] },
  { id: "trabajo-sin-cocinar", cat: "salud", turns: ["Recomiéndame un almuerzo", "Estoy en el trabajo, así que no puedo cocinar"], tools: ["metabolic_advisor"],
    mustNot: [/gluten|hay que cocinar|con esa lista de ingredientes/i, PLATA_A_MANO] },
  // Un caso real: «¿por qué subió de 2.100 a 3.300?» → el modelo culpaba a un medicamento («puede afectar tu apetito… estar más preparado»)
  { id: "meta-por-que", cat: "salud", turns: ["¿Por qué subió tanto mi meta de calorías hoy?"], mustNot: [/dapagliflozin|forxiga|sitagliptin|medicament|apetito/i] },

  // ─── «Eris como Jarvis» (2026-10-23): el día a día cruzando módulos, con los datos de prueba (BCI $408.000, sueldo el 30,
  // presupuesto de comida $250.000 con $42.000 gastados, despensa con pechuga que vence mañana y yogur en 2 días, shampoo bajo
  // el mínimo, creatina y omega 3, durmió 6,2 h, 3.400 pasos, diabetes tipo 2 con medicamentos, y su rutina con HOY en «Día 1:
  // Empuje»). Ninguna respuesta puede inventar cifras ni mandarlo a «otra app».
  { id: "j-buenos-dias", cat: "jarvis", antes: sembrarForge, turns: ["Buenos días Eris, ¿qué tengo para hoy?"], must: [/empuje|press|entren|rutina/i], mustNot: [/no tengo (acceso|informaci)|otra (app|aplicaci)/i] },
  { id: "j-toca-hoy", cat: "jarvis", antes: sembrarForge, turns: ["¿Qué me toca hoy en el gym?"], tools: ["training_plan", "training_today"], must: [/empuje|press de banca/i], mustNot: [/no tengo tu rutina/i] },
  { id: "j-proximo-entreno", cat: "jarvis", antes: sembrarForge, turns: ["¿Qué día es mi próximo entrenamiento de tirón?"], must: [/tir[oó]n|dominada|remo/i], mustNot: [/no tengo tu rutina/i] },
  { id: "j-pre-casa", cat: "jarvis", turns: ["Hoy entreno a las 7, ¿qué como antes con lo que tengo en la casa?"], tools: ["metabolic_advisor"], must: [/pollo|pechuga|arroz|lentejas|yogur/i], mustNot: [PLATA_A_MANO] },
  { id: "j-vence", cat: "jarvis", turns: ["¿Se me vence algo? ¿Qué hago con eso?"], must: [/pechuga|pollo/i, /yogur/i] },
  { id: "j-proteina-casa", cat: "jarvis", turns: ["¿Cuánta proteína me falta hoy y qué tengo en la casa para completarla?"], must: [/\d+\s?g/i, /pollo|pechuga|lentejas|yogur/i] },
  { id: "j-alcanza", cat: "jarvis", turns: ["¿Me alcanza para comprar una proteína en polvo de 35 lucas?"], tools: ["finance_tracker"], must: [/35\.000/] },
  { id: "j-comida-mes", cat: "jarvis", turns: ["¿Cuánto llevo gastado en comida este mes y cuánto me queda del presupuesto?"], tools: ["finance_tracker"], must: [/\$\s?\d/], mustNot: [/no tengo (acceso|informaci)/i] },
  { id: "j-lista", cat: "jarvis", turns: ["Hazme la lista del súper"], tools: ["inventory_tracker"], must: [/shampoo/i] },
  { id: "j-compre-pague", cat: "jarvis", turns: ["Compré 2 kilos de pollo en 9 lucas con la BCI"], must: [/9\.000/, /pollo/i, /despensa/i] },
  { id: "j-compre-lentejas", cat: "jarvis", turns: ["Compré 1 kilo de lentejas en 2 lucas con la BCI"], must: [/2\.000/, /sum[eé] a tu despensa/i] },
  { id: "j-suples", cat: "jarvis", turns: ["Me tomé la creatina y una de omega"], tools: ["supplement_tracker"], must: [/creatina/i, /omega/i] },
  { id: "j-dormi-mal", cat: "jarvis", antes: sembrarForge, turns: ["Dormí mal, ¿igual entreno hoy?"], tools: ["training_plan"], must: [/\d[,.]\d h|\d h \d\d/, /empuje/i], mustNot: [/no tengo (acceso|informaci)|no entres|no entrenes|no vayas/i] },
  { id: "j-pagan", cat: "jarvis", turns: ["¿Cuándo me pagan?"], tools: ["finance_tracker"], must: [/sueldo/i, /\bd[ií]as?\b/i], mustNot: [/Tu plata:/] },
  { id: "j-luz", cat: "jarvis", turns: ["Paga la luz, 25 lucas con la BCI"], tools: ["finance_tracker"], must: [/25\.000/] },
  { id: "j-ayer-once", cat: "jarvis", turns: ["Ayer a la once me comí 2 empanadas de pino"], tools: ["nutrition_tracker"], must: [/empanada/i, /ayer/i] },
  { id: "j-semana", cat: "jarvis", antes: sembrarForge, turns: ["Resúmeme cómo vengo esta semana"], tools: ["day_agenda"], must: [/entreno/i, /\d/], mustNot: [/no tengo (acceso|informaci)|otra (app|aplicaci)|necesito revisar/i] },
  { id: "j-bajar", cat: "jarvis", turns: ["Quiero bajar 3 kilos para diciembre, ¿qué hago?"], must: [/kcal|calor[ií]as|d[eé]ficit/i], mustNot: [/ayuno|dieta extrema|1\.000 kcal/i] },
  { id: "j-rodilla", cat: "jarvis", antes: sembrarForge, turns: ["Me duele la rodilla, ¿cambio algo de mi rutina?"], must: [/rodilla/i], mustNot: [/ibuprofeno|paracetamol|\d+\s?mg/i] },
  { id: "j-completo", cat: "jarvis", turns: ["¿Puedo comerme un completo ahora?"], must: [/completo/i, /kcal/i] },
  { id: "j-flojera", cat: "jarvis", turns: ["Estoy cansado y no tengo ganas de cocinar, ¿qué como?"], tools: ["metabolic_advisor"], mustNot: [/hay que cocinar|sart[eé]n|hervir|al horno/i, PLATA_A_MANO] },
  { id: "j-plan-dia", cat: "jarvis", antes: sembrarForge, turns: ["Planifícame el resto del día"], must: [/agua|vaso/i, /cena|once|almuerzo|comida/i], mustNot: [/no tengo (acceso|informaci)/i] },
  { id: "j-por-dia", cat: "jarvis", turns: ["¿Cuánta plata tengo y cuánto puedo gastar al día hasta que me paguen?"], tools: ["finance_tracker"], must: [/\$\s?\d/, /d[ií]a/i] },
  { id: "j-remedios", cat: "jarvis", turns: ["¿Ya me tomé los remedios hoy?"], tools: ["day_agenda"], must: [/Sitagliptina/], mustNot: [/s[ií], (ya )?(te )?(los )?tomaste|ya los tomaste/i] },
  { id: "j-agua-yogur", cat: "jarvis", turns: ["Anota que tomé 2 vasos de agua y comí un yogur"], must: [/agua|ml|vaso/i, /yogur/i] },
  { id: "j-fuerza", cat: "jarvis", antes: sembrarForge, turns: ["¿Qué tan fuerte estoy en press de banca?"], tools: ["training_plan"], must: [/\d+(,\d)?\s?kg/i], mustNot: [/no tengo tu progreso/i] },
  { id: "j-gaste-mas", cat: "jarvis", turns: ["¿En qué gasté más este mes?"], tools: ["finance_tracker"], must: [/alimentaci|comida|super/i] },
  { id: "j-recuerda-comprar", cat: "jarvis", turns: ["Agrega huevos a la lista de compras"], tools: ["inventory_tracker"], must: [/huevo/i] },
  // Segunda tanda (2026-10-23): cadenas de dos turnos y cruces entre módulos
  { id: "j-vence-cocino", cat: "jarvis", turns: ["¿Qué se me vence?", "¿Qué cocino con eso?"], tools: ["metabolic_advisor"], must: [/pechuga|pollo|yogur/i, /Opci[oó]n 1/] },
  { id: "j-cuando-pierna", cat: "jarvis", antes: sembrarForge, turns: ["¿Cuándo me toca pierna?"], tools: ["training_plan"], must: [/pierna/i, /sentadilla/i] },
  { id: "j-fuerte-general", cat: "jarvis", antes: sembrarForge, turns: ["¿Cómo voy en el gym?"], tools: ["training_plan"], must: [/score de fuerza/i, /\d+(,\d)?\s?kg/] },
  { id: "j-subir-musculo", cat: "jarvis", turns: ["Quiero subir 2 kilos de músculo, ¿cómo lo hago?"], tools: ["metabolic_advisor"], must: [/super[aá]vit|kcal/i, /prote[ií]na/i], mustNot: [/d[eé]ficit/i] },
  { id: "j-plata-semana", cat: "jarvis", turns: ["¿Cómo vengo con la plata esta semana?"], tools: ["finance_tracker"], must: [/\$\s?\d/], mustNot: [/no tengo (acceso|informaci)/i] },
  { id: "j-pre-gym-pronto", cat: "jarvis", turns: ["Voy al gym en 20 minutos, ¿qué como?"], tools: ["metabolic_advisor"], mustNot: [/hay que cocinar/i, PLATA_A_MANO] },
  { id: "j-cuidar-glucosa", cat: "jarvis", turns: ["Con mi diabetes, ¿qué me conviene cenar hoy?"], tools: ["metabolic_advisor"], mustNot: [/subir (tu |la )?glucosa/i, /glucosa (est[aá]|de) \d|mg\/dl/i, PLATA_A_MANO] },
  // Sueño 2.0 · S0: el sueño partido se cuenta por partes, no como «descanso suficiente»
  // (lo anotado por chat manda sobre el reloj: un caso anterior anota «dormí de 8:15 a 11:15», así que primero se borra)
  { id: "s-partido", cat: "sueño", antes: suenoPartido, turns: ["Borra el sueño que anoté de anoche", "¿Cómo dormí anoche?"], tools: ["sleep_log"], must: [/2 partes/i, /02:33/, /Partida/], mustNot: [/descanso suficiente|dormiste bien/i] },
  { id: "s-acuesto", cat: "sueño", antes: suenoPartido, turns: ["¿A qué hora me acuesto hoy?"], tools: ["sleep_log"], must: [/acuéstate/i, /cafeína/i, /07:45/] },
  { id: "s-vengo", cat: "sueño", antes: suenoPartido, turns: ["¿Cómo vengo con el sueño?"], tools: ["sleep_log"], must: [/2 semanas/i, /más tarde cada día/i] },
  { id: "s-partido-entreno", cat: "sueño", antes: async () => { await sembrarForge(); await suenoPartido(); }, turns: ["Dormí mal, ¿igual entreno hoy?"], tools: ["training_plan"], must: [/partid/i, /reserva/i], mustNot: [/descansaste lo suficiente/i] },
  // S3: la noche corta en el día (comida primero, cómo entrenar, la hora para acostarse) y el café después de la hora límite
  { id: "s-corta-dia", cat: "sueño", antes: async () => { await sembrarForge(); await suenoCorto(); }, turns: ["¿Qué tengo para hoy?"], tools: ["day_agenda"], must: [/hambre|azúcar/i, /reserva/i, /acuéstate entre/i] },
  { id: "s-corta-entreno", cat: "sueño", antes: async () => { await sembrarForge(); await suenoCorto(); }, turns: ["Dormí poquito, ¿entreno igual?"], tools: ["training_plan"], must: [/5 h 15/, /reserva/i], mustNot: [/descansaste lo suficiente/i] },
  // Eris al timón (T0): los 3 caminos, elegir uno, «Otro», otra opción y no robarle preguntas a otros
  { id: "t-recomienda", cat: "timón", antes: sembrarForge, turns: ["¿Qué me recomiendas hoy?"], tools: ["day_plan"], must: [/Estricto/, /Óptimo/, /Flexible/, /Otro/] },
  { id: "t-elige", cat: "timón", antes: sembrarForge, turns: ["¿Qué me recomiendas hoy?", "Óptimo"], tools: ["day_plan"], must: [/modo \*?\*?Óptimo/, /(Desayuno|Almuerzo|Once|Cena|Colación|Comida)/] },
  { id: "t-otro", cat: "timón", turns: ["Decide tú", "Otro", "Hoy almuerzo afuera con la pega"], tools: ["day_plan"], must: [/afuera|ya está anotado/i] },
  { id: "t-cambia", cat: "timón", turns: ["Toma el control, modo estricto", "Dame otra opción para la cena"], tools: ["day_plan"], must: [/cambi[eé]|otra opci[oó]n|no tengo otra/i] },
  { id: "t-mi-plan", cat: "timón", turns: ["modo flexible", "¿Cuál es mi plan?"], tools: ["day_plan"], must: [/Flexible/] },
  { id: "t-comi", cat: "timón", turns: ["Toma el control, modo óptimo", "Comí lo del plan"], tools: ["day_plan"], must: [/Anot[eé]|Ya anot[eé] todas/i] },
  // «rearmé lo que queda» depende de que al día le queden comidas: en el banco completo, los registros anteriores ya cubren el
  // día. Lo de rearmar se prueba con un día limpio en revision_v2b_chat (2026-11-04); acá, que se anote y no se invente un plan.
  { id: "t-otra-cosa", cat: "timón", turns: ["Toma el control, modo óptimo", "Anota un completo italiano para la cena"], tools: ["nutrition_tracker"], must: [/completo/i] },
  { id: "t-otro-modelo", cat: "timón", turns: ["Decide tú", "Otro", "ando con resaca, no me pidas mucho"], tools: ["day_plan"], must: [/descanso|sin entreno/i], mustNot: [/todavía no sé ajustar/i] },
  { id: "t-no-roba", cat: "timón", turns: ["¿Qué me recomiendas comer ahora?"], tools: ["metabolic_advisor"], mustNot: [/Estricto/] },
  // ⚡ Modo Rendimiento (R0): el día exigente por código, con su curva estimada, el check-in de mente y sin pastillas
  { id: "r-preview", cat: "rendimiento", antes: async () => { await sembrarForge(); await suenoCorto(); }, turns: ["¿Qué me recomiendas hoy?"], tools: ["day_plan"], must: [/⚡ Rendimiento/, /Dormiste poco/, /\[Opción: Rendimiento\]/] },
  { id: "r-rendir", cat: "rendimiento", antes: suenoCorto, turns: ["Necesito rendir hoy"], tools: ["day_plan"], must: [/modo \*\*Rendimiento/, /curva de hoy \(estimada/, /A la cama a las/, /estrés y foco/], mustNot: [/melatonina|modafinil|pastillas? para (rendir|concentrar)/i] },
  { id: "r-checkin", cat: "rendimiento", turns: ["modo rendimiento", "estrés 2, foco 4, ideas"], tools: ["day_plan"], must: [/decidir y ordenar|Ideas caminando|panorama completo/] },
  { id: "r-examen", cat: "rendimiento", turns: ["Hoy es un día exigente, tengo examen y estoy estresado"], tools: ["day_plan"], must: [/modo \*\*Rendimiento/, /Suspiro cíclico/, /detalle/] },
  { id: "r-concentrar", cat: "rendimiento", turns: ["Estoy estresado y tengo que concentrarme"], tools: ["day_plan"], must: [/modo \*\*Rendimiento/] },
  { id: "r-no-roba", cat: "rendimiento", turns: ["Quiero rendir más en el gimnasio este mes"], mustNot: [/modo \*\*Rendimiento/] },
  // R2: las señales de mente por código, en palabras y sin puntajes (corre después de los r-* de arriba: ya hay check-ins de hoy)
  { id: "r-senales", cat: "rendimiento", turns: ["¿Cómo vengo de estrés?"], tools: ["day_plan"], must: [/Esta semana/, /No es un puntaje ni un diagnóstico/], mustNot: [/\d\s*\/\s*5|estr[eé]s (de )?\d|ansiedad generalizada|burnout|depresi[oó]n/i] },
  { id: "r-senales-dias", cat: "rendimiento", turns: ["¿Cómo me han ido los días exigentes?"], tools: ["day_plan"], must: [/d[ií]as? exigentes?/, /No es un puntaje/] },
  // S4: «¿por qué duermo mal?» por código (asociación, no causa) y el sueño por partes anotado por chat
  { id: "s-porque", cat: "sueño", antes: suenoConCafe, turns: ["¿Por qué duermo tan mal?"], tools: ["sleep_log"], must: [/caf[eé]/i, /no prueba que sea la causa/i, /2 semanas/i], mustNot: [/insomnio cr[oó]nico|apnea|melatonina/i] },
  { id: "s-porque-pocos", cat: "sueño", antes: suenoCorto, turns: ["¿Qué me está quitando el sueño?"], tools: ["sleep_log"], must: [/pocas noches|2 semanas/i], mustNot: [/causa/i] },
  { id: "s-partes-chat", cat: "sueño", turns: ["Anoche dormí 4 horas y en la tarde una siesta de 2"], tools: ["sleep_log"], must: [/4 h/, /2 h/] },
  { id: "s-cafe-tarde", cat: "sueño", antes: async () => { const d = new Date(); await suenoCorto(Math.max(0, d.getHours() + d.getMinutes() / 60 - 1)); }, turns: ["Anota un café con leche"], tools: ["nutrition_tracker"], must: [/caf[eé]/i, /hora límite/i], mustNot: [/no pasa nada.*no pasa nada/i] },
  { id: "s-partido-dia", cat: "sueño", antes: async () => { await sembrarForge(); await suenoPartido(); }, turns: ["¿Qué tengo para hoy?"], tools: ["day_agenda"], must: [/2 partes/i, /13:51/] },
  // ─── Revisión V1 (2026-11-04): lo visto en los chats reales del 22 al 30 de octubre ───
  { id: "v1-fuerza", cat: "v1", turns: ["¿Tengo fuerza?"], noTools: ["inventory_tracker"], mustNot: [/inventario/i] },
  { id: "v1-anade", cat: "v1", turns: ["Añade una ensalada de lechuga, repollo y choclo al almuerzo"], tools: ["nutrition_tracker"], noTools: ["supplement_tracker"], must: [/lechuga/i] },
  { id: "v1-creatina-cafe", cat: "v1", turns: ["¿Puedo tomar creatina con un mocaccino?"], tools: ["supplement_tracker"], must: [/puedes tomarla con caf[eé]/i], mustNot: [/elimina/i] },
  { id: "v1-creatina-descanso", cat: "v1", turns: ["¿Tengo que tomar creatina los días de descanso?"], tools: ["supplement_tracker"], must: [/todos los d[ií]as/i] },
  { id: "v1-gym-casa", cat: "v1", antes: sembrarForge, turns: ["¿Me conviene ir al gym o entreno en casa?"], tools: ["training_plan"], must: [/casa/i] },
  { id: "v1-analizar", cat: "v1", turns: ["Profundiza en tu análisis de hoy: ¿qué variable está fuera de mi patrón habitual y qué puedo hacer?"], tools: ["personal_baseline"], noTools: ["finance_tracker", "inventory_tracker"] },
  { id: "v1-yo-lo-anoto", cat: "v1", turns: ["Lo registro yo con el código de barras"], tools: ["nutrition_tracker"], mustNot: [/kcal por 100|composici[oó]n|cu[aá]ntas calor[ií]as tiene/i] },
  { id: "v1-semana-horrible", cat: "v1", turns: ["Mi semana fue horrible"], noTools: ["day_agenda"] },
  { id: "v1-cena", cat: "v1", turns: ["Voy a hacer la cena"], noTools: ["training_today"] },
  // Revisión V2a/V2b (2026-11-04)
  { id: "v2a-plata-una", cat: "v2", turns: ["¿Cuánta plata tengo en total?"], tools: ["finance_tracker"], must: [/\$\s?\d/], mustNot: [/plata a mano/i, /Alimentacion/] },
  { id: "v2a-caminos", cat: "v2", antes: sembrarForge, turns: ["¿Qué me recomiendas hoy?"], tools: ["day_plan"], must: [/Estricto/, /Óptimo/], mustNot: [/\*\*Estricto\*\*: ([^\n]+)\n• \*\*Óptimo\*\*: \1(\n|$)/] },
  { id: "v2b-colacion", cat: "v2", turns: ["Anota una manzana como colación de la mañana"], tools: ["nutrition_tracker"], must: [/manzana/i, /Colación mañana/], mustNot: [/Colación AM/, /Colación tarde/] },
  // Revisión V2c (A2): un módulo apagado en Perfil no se toca por chat. Van al final y el segundo lo vuelve a encender.
  { id: "v2c-fin-apagado", cat: "v2", antes: modulos(["pulso", "metricas", "nutri", "toji", "inventario"]), turns: ["¿Cuánta plata tengo?"], noTools: ["finance_tracker"], must: [/Finanzas\*\* apagado/] },
  { id: "v2c-fin-encendido", cat: "v2", antes: modulos(null), turns: ["¿Cuánta plata tengo?"], tools: ["finance_tracker"], must: [/\$\s?\d/] },
];

// Controles en TODAS las respuestas
function globales(user: string, r: { text: string; kind: string }): string[] {
  const t = r.text.trim(), f: string[] = [];
  if (!t) f.push("respuesta vacía");
  if (r.kind !== "stream_end") f.push(`terminó en ${r.kind}`);
  if (/^(thinking|el usuario|the user|analiz(o|ando) (la|el) (pregunta|solicitud|mensaje))/i.test(t) || /thinking process/i.test(t)) f.push("razonamiento a la vista");
  if (/\bhijo\b/i.test(t) && !/hijo/i.test(user)) f.push("trato raro («hijo»)");
  if (/\b\d{2,3}\s?mg\s?\/\s?dl\b/i.test(t) && !/mg/i.test(user)) f.push("glucosa en mg/dL sin datos");
  if (/como (un )?modelo (de lenguaje|de ia)/i.test(t)) f.push("«como modelo de lenguaje»");
  if (/no alcanc[eé] a redactar/i.test(t)) f.push("rescate (se agotaron las vueltas)");
  if (/\b\d{1,2}\.\d{3}\s?g de prote[ií]na/i.test(t)) f.push("proteína absurda (miles de g)");
  return f;
}
const blandasGlobales = (t: string) => { const f: string[] = []; if (t.length > 1800) f.push(`muy larga (${t.length} car.)`); if ((t.match(/^#{1,3} /gm) || []).length > 2 || /\|\s?-{3}/.test(t)) f.push("formato pesado (títulos/tablas)"); return f; };

const res: any[] = [];
for (const c of CASOS) {
  if (FILTRO && !FILTRO.test(c.id) && !FILTRO.test(c.cat)) continue;
  await nuevoChat();
  if (c.antes) await c.antes();
  const turnos: any[] = [];
  for (const u of c.turns) turnos.push({ user: u, ...(await chat(u)) });
  const last = turnos[turnos.length - 1];
  const fallas: string[] = [], blandas: string[] = [];
  for (const t of turnos) for (const g of globales(t.user, t)) fallas.push(`[${t.user.slice(0, 24)}] ${g}`);
  if (c.tools && !c.tools.some((n) => last.tools.includes(n))) (c.blandas ? blandas : fallas).push(`no llamó ${c.tools.join("/")} (llamó: ${last.tools.join(", ") || "nada"})`);
  if (c.sinTools && last.tools.length) blandas.push(`llamó herramientas sin necesidad: ${last.tools.join(", ")}`);
  for (const n of c.noTools ?? []) if (last.tools.includes(n)) fallas.push(`llamó ${n} (no corresponde)`);
  for (const re of c.must ?? []) if (!re.test(last.text)) (c.blandas ? blandas : fallas).push(`falta ${re}`);
  for (const re of c.mustNot ?? []) if (re.test(last.text)) (c.blandas ? blandas : fallas).push(`no debía decir ${re}`);
  for (const t of turnos) { blandas.push(...blandasGlobales(t.text)); if (t.toolErr.length) blandas.push(`error de herramienta: ${t.toolErr.join("; ")}`); }
  const ok = !fallas.length;
  res.push({ id: c.id, cat: c.cat, ok, fallas, blandas, turnos: turnos.map((t) => ({ user: t.user, ms: t.ms, tools: t.tools, text: t.text.slice(0, 900) })) });
  console.log(`${ok ? "✅" : "❌"} ${c.id.padEnd(18)} ${String(last.ms).padStart(6)} ms  ${last.tools.join(",") || "-"}${fallas.length ? "  → " + fallas.join(" | ") : ""}${blandas.length ? "  ~ " + blandas.join(" | ") : ""}`);
}
const ms = res.flatMap((r) => r.turnos.map((t: any) => t.ms)).sort((a, b) => a - b);
const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))];
const porCat: Record<string, string> = {};
for (const cat of [...new Set(res.map((r) => r.cat))]) { const rs = res.filter((r) => r.cat === cat); porCat[cat] = `${rs.filter((r) => r.ok).length}/${rs.length}`; }
const resumen = { fecha: new Date().toISOString(), ok: res.filter((r) => r.ok).length, total: res.length, porCat, latencia: { p50: q(0.5), p90: q(0.9), max: ms[ms.length - 1] } };
console.log(`\n══ ${resumen.ok}/${resumen.total} OK · ${JSON.stringify(porCat)} · latencia p50 ${resumen.latencia.p50} ms · p90 ${resumen.latencia.p90} ms ══`);
await writeFile(`${OUT}/chat_eval.out.json`, JSON.stringify({ resumen, res }, null, 1));
ws.close();
process.exit(0);
