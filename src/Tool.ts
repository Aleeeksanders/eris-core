// ============================================================
// Eris — Sistema Base de Herramientas (Tool)
// Inspirado en la arquitectura de Claude Code
// ============================================================

import { z, type ZodSchema } from "zod";

/**
 * Resultado de la ejecución de una herramienta
 */
export interface ToolExecutionResult {
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Clase base para todas las herramientas de Eris.
 * Cada herramienta define su esquema de entrada, descripción, y lógica de ejecución.
 * 
 * Inspirado en el Tool System de Claude Code (src/tools/).
 */
export abstract class Tool<TInput = unknown> {
  /** Nombre único de la herramienta */
  abstract readonly name: string;

  /** Descripción para el LLM */
  abstract readonly description: string;

  /** Schema Zod del input */
  abstract readonly inputSchema: ZodSchema<TInput>;

  /** Si requiere confirmación del usuario antes de ejecutar */
  readonly requiresConfirmation: boolean = false;

  /**
   * Ejecuta la herramienta con el input validado
   */
  abstract execute(input: TInput): Promise<ToolExecutionResult>;

  /**
   * Valida y ejecuta la herramienta
   */
  async run(rawInput: unknown): Promise<ToolExecutionResult> {
    try {
      const parsed = this.inputSchema.parse(rawInput);
      return await this.execute(parsed);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return {
          output: "",
          error: `Error de validación en ${this.name}: ${err.errors.map((e) => e.message).join(", ")}`,
        };
      }
      return {
        output: "",
        error: `Error ejecutando ${this.name}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Retorna la definición de la herramienta para el LLM
   */
  toDefinition(): {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  } {
    // Convertimos el schema Zod a JSON Schema para el LLM
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.zodToJsonSchema(),
    };
  }

  /**
   * Convierte un schema Zod a JSON Schema simplificado.
   * Not a full zod-to-json-schema, just enough for LLM tool calling.
   */
  private zodToJsonSchema(): Record<string, unknown> {
    const shape = (this.inputSchema as any)?._def?.shape?.();
    if (!shape) {
      return { type: "object", properties: {} };
    }

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const def = (value as any)?._def;
      let type = "string";
      let description = def?.description || "";

      if (def?.typeName === "ZodNumber") type = "number";
      else if (def?.typeName === "ZodBoolean") type = "boolean";
      else if (def?.typeName === "ZodArray") type = "array";
      else if (def?.typeName === "ZodEnum") type = "string";

      properties[key] = { type, description };

      // Si no es opcional, es requerido
      if (def?.typeName !== "ZodOptional") {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required,
    };
  }
}
