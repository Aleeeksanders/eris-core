// ============================================================
// Eris — Sistema Base de Herramientas (Tool)
// Inspirado en la arquitectura de Claude Code
// ============================================================

import { z, type ZodType, type ZodTypeDef } from "zod";

/**
 * Resultado de la ejecución de una herramienta
 */
export interface ToolExecutionResult {
  output: string;
  error?: string;
  /**
   * Datos extra. `appendToReply: { text, marker }` pide al QueryEngine anexar `text` (markdown ya listo)
   * al final de la respuesta del modelo, salvo que esa respuesta ya coincida con la regex `marker`.
   * Sirve para listas con cifras exactas que un modelo pequeño no debe resumir ni reescribir.
   */
  metadata?: Record<string, unknown>;
}

/** Lo que ve la persona en la tarjeta de aprobación. */
export interface ApprovalInfo {
  title: string;
  /** Texto literal de lo que se va a ejecutar (comando, ruta y resumen del contenido…). */
  detail: string;
  risk: "normal" | "high";
  /** Motivos concretos de riesgo ("borra archivos", "usa la red"…). */
  flags?: string[];
}

export type PreflightResult =
  | { ok: true; approval?: ApprovalInfo }
  | { ok: false; reason: string };

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
  abstract readonly inputSchema: ZodType<TInput, ZodTypeDef, any>;

  /**
   * Si requiere aprobación EXPLÍCITA de una persona antes de ejecutar (tarjeta "Aprobar / Rechazar" en la app).
   * El QueryEngine lo hace cumplir: la aprobación viaja por un canal aparte del modelo, así que ni el modelo ni un texto
   * inyectado pueden darla. Si el cliente no puede pedirla (CLI, app vieja), la acción se deniega.
   * Para decidir caso por caso (p. ej. "solo si modifica algo") o mostrar un detalle propio, define `preflight`.
   */
  readonly requiresConfirmation: boolean = false;

  /** true = deja constancia en la bitácora de auditoría aunque no sea `dangerous` (p. ej. consultas de administración). */
  readonly audited: boolean = false;

  /**
   * Revisión previa a ejecutar, con el input ya validado. Devuelve:
   *  - `{ ok: false, reason }`  → se deniega sin preguntar (ruta protegida, comando que oculta lo que hace…).
   *  - `{ ok: true, approval }` → hay que pedir aprobación con ese texto.
   *  - `{ ok: true }`           → sigue el flujo normal (aprobación genérica solo si `requiresConfirmation`).
   */
  preflight?(input: TInput, context?: any): Promise<PreflightResult> | PreflightResult;

  /**
   * true si lo que devuelve puede traer texto escrito por TERCEROS (web, archivos, notas, catálogos colaborativos).
   * Ese texto es dato, nunca una orden: el QueryEngine lo rotula así y, en ese mismo turno, bloquea las herramientas
   * `dangerous` (defensa contra inyección de prompts indirecta).
   */
  readonly untrustedOutput: boolean = false;

  /**
   * true si la herramienta cambia cosas importantes: ejecutar comandos, escribir/abrir archivos, reescribir el perfil de
   * salud o la memoria persistente. No se ejecuta en un turno donde entró contenido no confiable.
   */
  readonly dangerous: boolean = false;

  /**
   * Opcional. Si el mensaje del usuario es la continuación OBVIA de un flujo de esta herramienta (p. ej. responde
   * "tengo arroz y pollo" a la pregunta "¿qué tienes a mano?"), devuelve el input con el que hay que llamarla y el
   * QueryEngine la ejecuta sin depender de que un modelo pequeño se acuerde de hacerlo. null = no aplica.
   */
  preroute?(userMessage: string, context?: any): Promise<Record<string, unknown> | null>;

  /**
   * Ejecuta la herramienta con el input validado
   */
  abstract execute(input: TInput, context?: any): Promise<ToolExecutionResult>;

  /**
   * Valida y ejecuta la herramienta
   */
  async run(rawInput: unknown, context?: any): Promise<ToolExecutionResult> {
    try {
      const parsed = this.inputSchema.parse(rawInput);
      return await this.execute(parsed, context);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return {
          output: "",
          // Con el campo («items.0.grams: Required»): solo «Required» no le decía al modelo qué corregir (banco de pruebas 2026-10-16)
          error: `Error de validación en ${this.name}: ${err.errors.map((e) => `${e.path.length ? `${e.path.join(".")}: ` : ""}${e.message === "Required" ? "falta este dato" : e.message}`).join(", ")}. Corrige esos campos y vuelve a llamarla.`,
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
      const outerDef = (value as any)?._def;

      // Desenvolver ZodOptional/ZodDefault para llegar al tipo REAL adentro.
      // Sin esto, CUALQUIER campo .optional() (la mayoría de los parámetros
      // numéricos/booleanos de nuestras tools) se reportaba al LLM como
      // "string" sin importar su tipo real — porque el typeName de afuera es
      // "ZodOptional"/"ZodDefault", no "ZodNumber"/"ZodBoolean"/etc. Eso hacía
      // que el modelo mandara "0.5" (string) en vez de 0.5 (number), y la
      // validación Zod real (que sí exige number) lo rechazaba en cada intento.
      let innerType: any = value;
      let def = outerDef;
      while (def?.typeName === "ZodOptional" || def?.typeName === "ZodDefault") {
        innerType = def.innerType;
        def = innerType?._def;
      }

      let type = "string";
      // .describe() se llama casi siempre DESPUÉS de .optional(), así que el
      // texto queda en el wrapper de afuera — se sigue leyendo de ahí.
      const description = outerDef?.description || def?.description || "";

      if (def?.typeName === "ZodNumber") type = "number";
      else if (def?.typeName === "ZodBoolean") type = "boolean";
      else if (def?.typeName === "ZodArray") type = "array";
      else if (def?.typeName === "ZodEnum") type = "string";

      const prop: Record<string, unknown> = { type, description };
      // Exponer los valores válidos directamente en el schema (no solo en la
      // prosa) — más confiable para que el modelo no invente una opción.
      if (def?.typeName === "ZodEnum" && Array.isArray(def.values)) {
        prop.enum = def.values;
      }
      properties[key] = prop;

      // Requerido a menos que el wrapper de afuera sea Optional/Default.
      if (outerDef?.typeName !== "ZodOptional" && outerDef?.typeName !== "ZodDefault") {
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
