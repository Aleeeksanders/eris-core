// ============================================================
// Eris — Tipos de Configuración
// ============================================================

export interface ErisConfig {
  /** Nombre del asistente */
  name: string;

  /** Versión */
  version: string;

  /** Configuración del LLM */
  llm: LLMConfig;

  /** Configuración del sistema */
  system: SystemConfig;
}

export interface LLMConfig {
  /** Proveedor del LLM: "ollama" | "eris" */
  provider: "ollama" | "eris";

  /** URL del servidor del LLM */
  baseUrl: string;

  /** Modelo a usar */
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
  version: "0.1.0",
  llm: {
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    model: "qwen2.5:3b",
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
};
