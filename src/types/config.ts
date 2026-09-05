// ============================================================
// Eris — Tipos de Configuración
// Incluye sistema de modos de pensamiento (Flash / Deep / Auto)
// ============================================================

// ─── Thinking Modes ─────────────────────────────────────────

export type ThinkingMode = "auto" | "flash" | "deep";

export interface ThinkingModeConfig {
  /** Identificador del modo */
  id: ThinkingMode;
  /** Modelo Ollama a usar */
  model: string;
  /** Nombre display */
  label: string;
  /** Icono emoji */
  icon: string;
  /** Descripción breve */
  description: string;
  /** Temperatura de generación */
  temperature: number;
  /** Máximo de tokens a generar */
  maxTokens: number;
  /** Ventana de contexto */
  contextLength: number;
  /** Activar thinking (<think> tags) */
  enableThinking: boolean;
}

export const THINKING_MODES: Record<ThinkingMode, ThinkingModeConfig> = {
  flash: {
    id: "flash",
    model: "qwen3.5:4b",
    label: "Flash",
    icon: "⚡",
    description: "Respuestas rápidas e instantáneas",
    // Sin thinking = ahorra 1-3s en el primer token
    // temp 0.3 = más determinista, menos "duda"
    temperature: 0.3,
    maxTokens: 2048,   // Aumentado para dar espacio al <think>
    contextLength: 4096,
    enableThinking: true, // Reactivado para evitar que escupa el razonamiento en crudo
  },
  deep: {
    id: "deep",
    model: "qwen3.5:4b",
    label: "Deep",
    icon: "🧠",
    description: "Análisis profundo y razonamiento complejo",
    temperature: 0.6,  // Bajado de 0.7: más preciso sin perder creatividad
    maxTokens: 6144,   // Subido para análisis largos
    contextLength: 8192,
    enableThinking: true,
  },
  auto: {
    id: "auto",
    model: "",
    label: "Auto",
    icon: "🔮",
    description: "Eris decide el mejor modo según la consulta",
    temperature: 0,
    maxTokens: 0,
    contextLength: 0,
    enableThinking: true,
  },
};

// ─── Heurística para modo Auto ──────────────────────────────

/** Palabras clave que disparan modo Deep (herramientas y análisis) */
const DEEP_KEYWORDS = [
  "reporte", "report", "análisis", "analisis", "auditoría", "auditoria",
  "ejecuta", "genera", "cristaliza", "crystallize", "investiga",
  "compara", "evalúa", "evalua", "planifica", "estrategia",
  "explica", "por qué", "porque", "cómo funciona", "como funciona",
  "herramienta", "tool", "vault", "boveda", "bóveda",
  "código", "codigo", "script", "archivo", "file",
  "roadmap", "timeline", "estatus", "status",
  // Introspección — requiere consultar el libro de registros
  "sabes de", "sabes sobre", "qué eres", "que eres", "quién eres", "quien eres",
  "cuéntame de ti", "cuentame de ti", "cuéntame sobre ti", "cuentame sobre ti",
  "qué puedes", "que puedes", "qué sabes", "que sabes",
  "sobre eris", "de eris", "acerca de eris",
  "registro", "registros", "libro de", "historial", "log",
  // Funciones de la App Móvil
  "glucosa", "azúcar", "azucar", "cgm", "librelink", "diabetes", "métrica", "metrica",
  "comida", "comí", "comi", "alimento", "calorías", "calorias", "macronutrientes", "macros", "dieta", "desayuno", "almuerzo", "cena",
  "nota", "crea nota", "guarda", "recuerda", "recordatorio"
];

/** Patrones que disparan modo Flash */
const FLASH_PATTERNS = [
  /^(hola|hey|buenas|qué tal|que tal|hi|hello|buenos días|buenas tardes|buenas noches)/i,
  /^(gracias|thanks|ok|vale|listo|perfecto|genial|dale)/i,
  /^(sí|si|no|claro|obvio|exacto)/i,
  /^.{0,40}(\?|!)$/,  // Preguntas/exclamaciones cortas (<40 chars)
];

/**
 * Clasifica una consulta en modo Flash o Deep.
 * Usado por el modo Auto para decidir dinámicamente.
 */
export function classifyQuery(query: string): "flash" | "deep" {
  const normalized = query.toLowerCase().trim();

  // Si es muy corto y simple → Flash
  if (normalized.length < 30) {
    const isFlash = FLASH_PATTERNS.some((p) => p.test(normalized));
    if (isFlash) return "flash";
  }

  // Si contiene keywords de profundidad → Deep
  const hasDeepKeyword = DEEP_KEYWORDS.some((kw) =>
    normalized.includes(kw)
  );
  if (hasDeepKeyword) return "deep";

  // Si es largo (>100 chars) probablemente necesita Deep
  if (normalized.length > 100) return "deep";

  // Default: Flash para ser rápido
  return "flash";
}

/**
 * Resuelve la configuración final de un modo,
 * resolviendo "auto" al modo apropiado según la consulta.
 */
export function resolveMode(
  mode: ThinkingMode,
  query?: string
): { resolved: ThinkingModeConfig; actualMode: "flash" | "deep" } {
  if (mode === "auto" && query) {
    const actual = classifyQuery(query);
    return { resolved: THINKING_MODES[actual], actualMode: actual };
  }
  if (mode === "auto") {
    // Sin query, default a deep
    return { resolved: THINKING_MODES.deep, actualMode: "deep" };
  }
  return { resolved: THINKING_MODES[mode], actualMode: mode };
}

// ─── Config General ─────────────────────────────────────────

export interface ErisConfig {
  /** Nombre del asistente */
  name: string;

  /** Versión */
  version: string;

  /** Configuración del LLM */
  llm: LLMConfig;

  /** Configuración del sistema */
  system: SystemConfig;

  /** Modo de pensamiento por defecto */
  defaultMode: ThinkingMode;
}

export interface LLMConfig {
  /** Proveedor del LLM: "ollama" | "eris" */
  provider: "ollama" | "eris";

  /** URL del servidor del LLM */
  baseUrl: string;

  /** Modelo a usar (fallback) */
  model: string;

  /** Temperatura de generación (0-1) */
  temperature: number;

  /** Máximo de tokens a generar */
  maxTokens: number;

  /** Tokens de contexto máximo */
  contextLength: number;
}

export interface SystemConfig {
  /** Shell por defecto para ejecutar comandos */
  shell: string;

  /** Directorio de trabajo */
  workingDirectory: string;

  /** Idioma de Eris */
  language: "es" | "en";

  /** Habilitar logs verbose */
  verbose: boolean;
}

export const DEFAULT_CONFIG: ErisConfig = {
  name: "Eris",
  version: "0.2.0",
  llm: {
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    model: "qwen3.5:4b",
    temperature: 0.7,
    maxTokens: 4096,
    contextLength: 8192,
  },
  system: {
    shell: "powershell",
    workingDirectory: process.cwd(),
    language: "es",
    verbose: false,
  },
  defaultMode: "auto",
};
