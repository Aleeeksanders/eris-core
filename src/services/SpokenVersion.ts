// ============================================================
// Eris — Versión hablada
// La voz NO lee el texto de pantalla: es otro canal. Cuando la respuesta
// escrita es larga (listas, tablas, desgloses), Eris la "dice" en pocas
// frases, con su personalidad, complementando lo escrito en vez de repetirlo.
// ============================================================

import type { LLMProvider } from "./llm/LLMProvider.js";

/** Bajo este largo (ya sin markdown) se habla tal cual — ya es breve. */
const SPEAK_AS_IS_MAX_CHARS = 150;
/** Tope duro del texto final a sintetizar (~25-30 s de voz). */
const MAX_SPOKEN_CHARS = 520;

const SPOKEN_SYSTEM_PROMPT =
  "Eres Eris, la diosa del caos: directa, con chispa y humor seco (solo a veces), cero relleno. " +
  "Ahora vas a HABLAR, no a escribir. La voz es un canal distinto al texto: la respuesta escrita YA está " +
  "en la pantalla del usuario, así que NO la leas ni la repitas. Tu trabajo es que a la persona le quede " +
  "clarísimo lo importante, explicado como con peras y manzanas.\n\n" +
  "Reglas:\n" +
  "- Entre 2 y 4 frases cortas, máximo unas 60 palabras.\n" +
  "- Ve directo a lo que más importa y, si hay un siguiente paso o algo que cuidar, dilo.\n" +
  "- Complementa explicando el 'por qué' o qué hacer con lo que YA dice el texto, con una comparación simple si ayuda; " +
  "no es un resumen literal. La personalidad va en el TONO, nunca en los hechos: NO agregues alimentos, causas, consejos ni datos " +
  "que el texto no mencione, y no exageres ni dramatices.\n" +
  "- Si el texto tiene listas, tablas o muchos datos, nombra solo lo esencial y di que el detalle está en pantalla.\n" +
  "- Habla como una amiga muy lúcida y con carácter que te lo explica en la cocina, no como un informe: " +
  "opina y señala lo que pesa de verdad, sin sonar a resumen. VARÍA cómo empiezas cada vez: no uses una muletilla fija " +
  "ni empieces siempre igual. Nada de 'Claro', 'Perfecto' ni saludos vacíos.\n" +
  "- NO INVENTES NADA: usa solo hechos y cifras que aparezcan en el texto escrito. Si una cifra no está en el texto, no la digas. " +
  "No hagas cuentas nuevas: si necesitas un total, usa el que ya está escrito.\n" +
  "- Menciona como máximo 2 o 3 cifras, las que más importan, COPIADAS EXACTAS del texto y escritas en dígitos (ej. 1358, 20, 3.5).\n" +
  "- Comparaciones simples sí, pero sin inventar medidas ni objetos raros.\n" +
  "- PROHIBIDO: markdown, asteriscos, viñetas, emojis, paréntesis, símbolos, URLs. " +
  "Escribe las unidades completas: calorías, gramos, litros, mililitros (nunca kcal, g, L, ml).\n" +
  "- Responde SOLO con lo que dirías en voz alta, sin comillas ni comentarios.";

/** Las unidades abreviadas se dicen mal en voz alta — se expanden por código, no por el LLM. */
export function expandUnitsForSpeech(text: string): string {
  return text
    // Dinero: "$1.450.000" → "1450000 pesos" (el símbolo y los separadores de miles se leen mal)
    .replace(/\$\s*(\d[\d.,]*\d|\d)/g, "$1 pesos")
    // Miles agrupados (1.450.000 o 1,450,000) → número plano; antes de tocar decimales
    .replace(/\b\d{1,3}(?:[.,]\d{3})+\b/g, (m) => m.replace(/[.,]/g, ""))
    .replace(/(\d)\s*kcal\b/gi, "$1 calorías")
    .replace(/\bkcal\b/gi, "calorías")
    .replace(/(\d)\s*(?:ml|mL)\b/g, "$1 mililitros")
    .replace(/(\d)\s*L\b/g, "$1 litros")
    .replace(/(\d)\s*kg\b/gi, "$1 kilos")
    .replace(/(\d)\s*g\b/g, "$1 gramos")
    .replace(/(\d)\s*mg\/dL\b/gi, "$1 miligramos por decilitro")
    .replace(/(\d)\s*%/g, "$1 por ciento")
    .replace(/(\d)\.(\d)/g, "$1,$2");
}

/** Saca markdown, emojis, tags de razonamiento y símbolos que la voz leería mal. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~>|]/g, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Corta en el último final de frase antes del límite. */
function capAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "), cut.lastIndexOf("."));
  return (lastEnd > max * 0.5 ? cut.slice(0, lastEnd + 1) : cut).trim();
}

const MAX_NUMBERS_SPOKEN = 4;

/** Números de un texto, sin separadores ("1.450.000", "1,450,000" y "1450000" son el mismo). */
function numbersIn(text: string): string[] {
  return (text.match(/\d[\d.,]*/g) || []).map((n) => n.replace(/[.,]+$/, "").replace(/[.,]/g, ""));
}

/**
 * ¿Lo dicho es fiel al texto? El modelo chico a veces inventa una cifra o recita
 * todos los totales; eso es justo lo contrario de "que le quede claro".
 * Devuelve null si está bien, o el motivo para corregirlo.
 */
function problemWith(spoken: string, source: string): string | null {
  const known = new Set(numbersIn(source));
  const said = numbersIn(spoken);
  const invented = said.filter((n) => !known.has(n));
  if (invented.length > 0) return `Dijiste cifras que NO están en el texto (${invented.join(", ")}). Usa solo cifras que aparezcan tal cual.`;
  if (said.length > MAX_NUMBERS_SPOKEN) return `Dijiste demasiadas cifras (${said.length}). Menciona solo 2 o 3, las más importantes, y NO recites los totales.`;
  return null;
}

/**
 * Devuelve el texto que debe sintetizar la voz. Nunca lanza: si el LLM falla
 * o devuelve vacío, cae a las primeras frases del texto limpio.
 */
export async function buildSpokenVersion(
  provider: LLMProvider,
  fullText: string,
  userQuestion: string | null,
  modelOverride: string,
  opts: { skipLLM?: boolean } = {},
): Promise<string> {
  const cleaned = expandUnitsForSpeech(cleanForSpeech(fullText));
  if (!cleaned) return "";
  if (cleaned.length <= SPEAK_AS_IS_MAX_CHARS) return cleaned;
  // El modelo local atiende UNA cosa a la vez: si ya está redactando otra respuesta, pedirle además el resumen hablado
  // lo deja en cola detrás (minutos). En ese caso se habla directo un extracto del texto, sin pasar por el modelo.
  if (opts.skipLLM) return capAtSentence(cleaned, 320);

  try {
    const question = userQuestion ? `Lo que preguntó el usuario: "${userQuestion.slice(0, 300)}"\n\n` : "";
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: SPOKEN_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `${question}Respuesta escrita (ya visible en pantalla, no la leas):\n"""\n${fullText.slice(0, 3500)}\n"""\n\nDilo en voz alta.`,
      },
    ];

    let spoken = "";
    let problem: string | null = null;
    // Hasta 2 intentos: el modelo chico a veces inventa cifras o recita totales.
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await provider.generate(messages, undefined, {
        temperature: attempt === 0 ? 0.35 : 0.2,
        maxTokens: 220,
        modelOverride,
        enableThinking: false,
      });
      spoken = cleanForSpeech(response.content || "").replace(/^["“”']+|["“”']+$/g, "").trim();
      if (spoken.length < 20) { problem = null; spoken = ""; continue; }
      problem = problemWith(spoken, fullText);
      if (!problem) break;
      messages.push({ role: "assistant", content: spoken });
      messages.push({ role: "user", content: `Corrige: ${problem} Dilo de nuevo en voz alta, con las mismas reglas.` });
    }

    if (spoken) {
      // Si aún quedan cifras inventadas, mejor callar esa frase que decir algo falso.
      if (problem && problem.startsWith("Dijiste cifras que NO")) {
        const known = new Set(numbersIn(fullText));
        const safe = spoken
          .split(/(?<=[.!?])\s+/)
          .filter((sentence) => numbersIn(sentence).every((n) => known.has(n)))
          .join(" ")
          .trim();
        spoken = safe;
      }
      if (spoken.length >= 20) return capAtSentence(expandUnitsForSpeech(spoken), MAX_SPOKEN_CHARS);
    }
  } catch {
    // cae al fallback
  }
  return capAtSentence(cleaned, 320);
}
