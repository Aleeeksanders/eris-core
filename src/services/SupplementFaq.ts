// ============================================================
// Eris — preguntas frecuentes de los suplementos (revisión 2026-11-04, Q1)
//
// Chat real: «¿puedo tomar creatina con un mocaccino?» → el modelo dijo que la cafeína «elimina» la creatina y que los días
// de descanso no hay que tomarla. Las dudas típicas (con café, los días de descanso, a qué hora, con qué no mezclarlo) se
// responden por código, con lo mismo que dicen las fuentes de cada ficha (SupplementCore.FICHAS: ISSN, NIH ODS). Nada de
// dosis nuevas: solo cómo y cuándo.
// ============================================================

const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;:]+/g, " ").replace(/\s+/g, " ").trim();

const CAFE = /\b(cafe|cafes|cafeina|mocaccino|mokaccino|moka|capuccino|cappuccino|capuchino|latte|expreso|espresso|nescafe|pre ?entrenos?|energeticas?|red ?bull|monster)\b/;
const HORA = /\b(a que hora|cuando (la |lo |se |me )?(tomo|toma|tomar\w*)|antes o despues|antes (de|del) (entrenar|entreno|gym)|despues (de|del) (entrenar|entreno|gym)|en ayunas|con (la |una )?comida|con el estomago vacio|en la manana|en la noche|momento del dia)\b/;
const DESCANSO = /\b(descanso|descanzo|no entreno|dias? (libres?|sin entrenar|que no entreno|off)|fin de semana|todos los dias|cada dia|diariamente|saltarme|me la salte|me lo salte|se me olvido|se me paso|olvide)\b/;

interface Faq { q: RegExp; a: string }
const FAQ: Record<string, Faq[]> = {
  creatina: [
    // 2026-11-06: las revisiones narrativas dicen que «puede» acelerar la recuperación; el meta-análisis de ensayos (Northeast y Clifford 2021, 13 estudios) no halló efecto
    { q: /\b(recuper\w*|agujetas?|adolorid\w*|dolor muscular|dano muscular)\b/, a: "Para ganar fuerza y rendir más en series cortas funciona; para recuperarte más rápido, la evidencia no es firme: un meta-análisis de 13 estudios (2021) no encontró diferencias en fuerza ni agujetas hasta 96 horas después, aunque otros trabajos más chicos sí ven algo. Tómala por lo primero, no para acortar tus descansos." },
    { q: CAFE, a: "Sí, puedes tomarla con café. Un par de estudios antiguos, con mucha cafeína durante la fase de «carga», vieron algo menos de efecto, pero otros no lo confirmaron: no hay evidencia de que el café la «elimine» ni le quite lo que hace. Lo que importa es tomarla todos los días. Si te cae pesado al estómago, sepáralas un rato." },
    { q: DESCANSO, a: "Sí, se toma todos los días, también los de descanso: funciona llenando de a poco las reservas del músculo, no como un pre-entreno de ese día. Si un día se te olvida no pasa nada: al día siguiente sigues con tu toma normal, sin duplicarla." },
    { q: HORA, a: "La hora casi no importa: lo que cuenta es tomarla todos los días. Algunos estudios ven una ventaja pequeña tomándola cerca del entreno (antes o después), y con una comida se tolera mejor." },
  ],
  proteina: [
    { q: DESCANSO, a: "Sí, también sirve los días de descanso si te cuesta llegar a tu proteína con comida: el músculo se recupera esos días. Lo que cuenta es el total de proteína del día, no el batido en sí." },
    { q: HORA, a: "Lo que más importa es el total de proteína del día. Repartida en 3 o 4 comidas, con una cerca del entreno (antes o después), funciona bien; no hay una «ventana» de minutos que se pierda." },
  ],
  hierro: [
    { q: /\b(cafe|cafes|te|leche|lacteos?|calcio|yogur\w*|queso|mate)\b/, a: "Mejor lejos (1 a 2 horas) del café, el té, el mate y los lácteos o el calcio: bajan cuánto hierro absorbes. Con algo de vitamina C (un jugo de naranja o una fruta) se absorbe mejor." },
    { q: HORA, a: "Se absorbe mejor en ayunas, pero si te cae mal al estómago tómalo con algo de comida (que no sea un lácteo). Sigue la indicación de quien te lo recetó." },
  ],
  vitamina_d: [
    { q: HORA, a: "Con una comida que tenga algo de grasa (huevo, palta, aceite, lácteos) se absorbe mejor. La hora del día da lo mismo." },
  ],
  omega3: [
    { q: /\b(a que hora|cuando (la |lo |se |me )?(tomo|toma)|con (la |una )?comida|en ayunas|reflujo|sabor|repite|me repite)\b/, a: "Con una comida: se absorbe mejor y da menos reflujo o «sabor a pescado». La hora del día da lo mismo." },
  ],
  calcio: [
    { q: /\bhierro\b/, a: "Sepáralo del hierro (unas 2 horas): compiten por absorberse." },
    { q: HORA, a: "Se absorbe mejor en tomas de hasta 500 mg; si tomas más, divídelo durante el día. El carbonato de calcio, con comida; el citrato, da igual." },
  ],
};

/** La respuesta corta a una duda típica de ese suplemento («¿con café?», «¿los días de descanso?»), o null. */
export function faqSuplemento(fichaId: string, message: string): string | null {
  const t = ` ${fold(message)} `;
  return (FAQ[fichaId] ?? []).find((f) => f.q.test(t))?.a ?? null;
}
