// ============================================================
// Banco de enrutamiento (revisión exhaustiva V3, 2026-11-04): frase → la herramienta que debe tomarla, o la que NO debe
// robársela. Cada fila es un fallo real que ya se arregló (chats del 22 al 30-10 y el banco con el modelo del 04-11).
// Sin modelo ni servidor: corre en segundos. Correr cada vez que se toque el enrutador, un atajo (preroute) o el orden:
//   bun scripts/rutas/rutas_check.ts      → sale con 1 si alguna frase cae donde no debe
// (Lo que dice el modelo se prueba aparte, con Ollama arriba: scripts/chat_eval.)
// ============================================================
import * as os from "os";
import { join } from "path";
import { mkdirSync } from "fs";

// HOME aislado: algunas herramientas leen ~/.eris (módulos con visto bueno, la base de alimentos del usuario)
const HOME = join(os.tmpdir(), "eris_rutas_home");
mkdirSync(HOME, { recursive: true });
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
process.env.TZ = "America/Santiago";
console.log = ((orig) => (...a: any[]) => { if (!/^\[(Router|Contexto|Seguridad)\]/.test(String(a[0]))) orig(...a); })(console.log);

const { quien, memoria } = await import("./arnes.ts");

type Fila = { frase: string; es?: string; noEs?: string; texto?: RegExp; mem?: () => any; hist?: Array<["user" | "assistant", string]>; por?: string };

const sinFinanzas = () => memoria({ pref_auto_prefs: { v: 1, modulos: ["pulso", "metricas", "nutri", "toji"] } });
const FILAS: Fila[] = [
  // C1 — Inventario no se roba «¿tengo X?»
  { frase: "¿Tengo fuerza?", noEs: "inventory_tracker", por: "C1" },
  { frase: "¿Tengo fiebre?", es: "symptom_guide", por: "C1/H1" },
  { frase: "¿Cuántas calorías me quedan?", es: "nutrition_tracker", por: "C1" },
  { frase: "¿Cuánto me queda?", noEs: "inventory_tracker", por: "C1" },
  { frase: "¿Tengo arroz?", es: "inventory_tracker", por: "C1" },
  { frase: "llegaron 6 huevos", es: "inventory_tracker", por: "C2" },
  // C2 — atajos demasiado amplios
  { frase: "voy a hacer la cena", noEs: "training_today", por: "C2" },
  { frase: "hoy toca lavar ropa", noEs: "training_today", por: "C2" },
  { frase: "hoy entreno pierna", es: "training_today", por: "C2" },
  { frase: "llegó mi hermano", noEs: "inventory_tracker", por: "C2" },
  { frase: "mi semana fue horrible", noEs: "day_agenda", por: "C2" },
  { frase: "¿cómo me fue esta semana?", es: "day_agenda", por: "C2" },
  { frase: "hazme una rutina para dormir", noEs: "training_plan", por: "C2" },
  { frase: "¿cómo ando de sueño?", es: "sleep_log", por: "C2" },
  { frase: "¿cómo voy hoy?", es: "metabolic_advisor", por: "C2" },
  // C3 — verbos de anotar
  { frase: "Añade una ensalada de lechuga, repollo y choclo al almuerzo", es: "nutrition_tracker", por: "C3" },
  { frase: "pon 2 huevos en el desayuno", es: "nutrition_tracker", por: "C3" },
  { frase: "anota 1 plátano", es: "nutrition_tracker", texto: /Pl[aá]tano/, por: "C3 (nombre con «/»)" },
  // H1 — la guía de síntomas primero, sin robarse lo que no es
  { frase: "¿Qué me recomiendas? Me duele el pecho y el brazo izquierdo", es: "symptom_guide", por: "H1" },
  { frase: "¿Qué me recomiendas hoy?", es: "day_plan", por: "H1" },
  { frase: "¿Cómo vengo de estrés?", noEs: "symptom_guide", por: "banco 04-11 (r-senales)" },
  { frase: "¿Cómo voy con este dolor de cabeza?", es: "symptom_guide", por: "banco 04-11" },
  // Q1–Q3
  { frase: "¿Puedo tomar creatina con un mocaccino?", es: "supplement_tracker", texto: /puedes tomarla con caf[eé]/i, por: "Q1" },
  { frase: "¿tengo que tomar creatina los días de descanso?", es: "supplement_tracker", por: "Q1" },
  { frase: "Lo registro yo con el código de barras", es: "nutrition_tracker", por: "Q3" },
  // R1 — «Analizar métricas» por código
  { frase: "Profundiza en tu análisis de hoy: ¿qué variable está fuera de mi patrón habitual y qué puedo hacer?", es: "personal_baseline", por: "R1" },
  // Comidas: lo dicho manda
  { frase: "Anota una manzana como colación de la mañana", es: "nutrition_tracker", texto: /Colación mañana/, por: "banco 04-11" },
  { frase: "Registra 500ml de agua", es: "nutrition_tracker", por: "agua" },
  // Pendientes que solo valen como respuesta a su pregunta
  { frase: "¿cuánta agua llevo?", noEs: "day_plan", mem: () => memoria({ day_plan_pending: { awaiting: "nota", at: new Date().toISOString() } }), hist: [["user", "hola"], ["assistant", "¡Hola! ¿En qué te ayudo?"]], por: "C2" },
  // Finanzas y módulos apagados (A2)
  { frase: "Gasté 5 lucas en almuerzo con la BCI", es: "finance_tracker", por: "Finanzas" },
  { frase: "¿Cuánta plata tengo?", noEs: "finance_tracker", texto: /Finanzas\*\* apagado/, mem: sinFinanzas, por: "A2" },
  { frase: "Anota 2 huevos al desayuno", es: "nutrition_tracker", mem: sinFinanzas, por: "A2 (lo demás sigue)" },
  // Brígida (chat real 2026-11-05, «¿Qué tan fuerte estoy?»): fuerza y días entrenados por código
  { frase: "¿Crees que soy fuerte?", es: "training_plan", por: "B1" },
  { frase: "Eso es para alguien que entrena, pero tú crees que soy fuerte para alguien que no entrena, por ejemplo?", es: "training_plan", por: "B1" },
  { frase: "Y en base a mi historial, ¿tú crees que soy más fuerte que alguien normal?", es: "training_plan", por: "B1" },
  { frase: "Pero ojito que yo lo que puedo hacer es 50 kilos de esta huea que se empuja.", es: "training_plan", por: "B1" },
  { frase: "Pero puedo mirar mi rutina de ayer por ejemplo, donde sí entrené y ahí se ve mi número.", es: "training_plan", por: "B2" },
  { frase: "¿Qué entrené el domingo?", es: "training_plan", por: "B2" },
  { frase: "peso 80 kilos", noEs: "training_plan", por: "B1 (no es una carga)" },
  // Recuperación (2026-11-06): con evidencia y sus datos
  { frase: "Me dice que ya estoy listo pero aún tengo agujetas del miércoles", es: "training_plan", por: "recuperación" },
  { frase: "¿Estoy recuperado para entrenar pecho?", es: "training_plan", por: "recuperación" },
  { frase: "¿Cuánto tardo en recuperarme?", es: "training_plan", por: "recuperación" },
  { frase: "¿La creatina ayuda a recuperarme más rápido?", es: "supplement_tracker", por: "recuperación → ficha" },
  { frase: "Se me recuperó la plata del banco", noEs: "training_plan", por: "recuperación (no es del cuerpo)" },
  { frase: "Me da lata ir al gym hoy, ¿lo dejo para mañana?", es: "training_plan", por: "B4" },
  { frase: "Me da lata cocinar", noEs: "training_plan", por: "B4 (no es el gym)" },
  { frase: "¿Qué ingredientes tiene la Coca-Cola Zero?", es: "web_search", por: "producto de marca (banco 11-05)" },
  { frase: "¿Qué ingredientes tiene mi almuerzo de hoy?", noEs: "web_search", por: "lo suyo no va a internet" },
];

let mal = 0;
for (const f of FILAS) {
  const r = await quien(f.frase, { mem: f.mem?.(), hist: f.hist });
  const fallas: string[] = [];
  if (f.es && r.tool !== f.es) fallas.push(`debía ir a ${f.es} y fue a ${r.tool}`);
  if (f.noEs && r.tool === f.noEs) fallas.push(`no debía ir a ${f.noEs}`);
  if (f.texto && !f.texto.test(r.texto ?? "")) fallas.push(`la respuesta no dice ${f.texto}`);
  if (fallas.length) mal++;
  console.log(`${fallas.length ? "❌" : "✅"} [${f.por ?? ""}] «${f.frase.slice(0, 60)}» → ${r.tool} (${r.via})${fallas.length ? "  · " + fallas.join(" · ") : ""}`);
}
console.log(`\n══ ${FILAS.length - mal}/${FILAS.length} frases donde corresponde ══`);
process.exit(mal ? 1 : 0);
