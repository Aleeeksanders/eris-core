import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { loadAffinity, suggestCarbOptions, formatCarbOptions, blockedFavorites } from "../services/CarbOptions.js";
import { deriveRestrictions } from "../services/DietaryRestrictions.js";
import { isPure } from "../services/Intent.js";

const CarbOptionsInputSchema = z.object({
  grams: z.number().optional().describe("Gramos de carbohidratos a cubrir. Default 15 (regla de 15 para un bajón de glucosa)."),
  purpose: z
    .enum(["hipoglucemia", "colacion", "energia"])
    .optional()
    .describe("hipoglucemia = glucosa baja o bajando (solo opciones que suben rápido); colacion o energia = un snack. Default hipoglucemia si grams<=20, si no colacion."),
});

type CarbOptionsInput = z.infer<typeof CarbOptionsInputSchema>;

export class CarbOptionsTool extends Tool<CarbOptionsInput> {
  readonly name = "carb_options";
  readonly description =
    "Convierte una cantidad de carbohidratos en ALIMENTOS CONCRETOS y porciones que el usuario reconoce " +
    "(un vaso de bebida, un Chocman, una porción de Tritón, gomitas...), con los gramos reales, " +
    "priorizando lo que el usuario ya come. " +
    "USAR SIEMPRE que haya que recomendar carbohidratos: glucosa baja o bajando ('me siento bajo', 'qué como para subir la glucosa'), " +
    "'necesito 15g de carbohidratos', 'qué puedo comer', 'dame una colación'. " +
    "NUNCA le digas al usuario solo '15 g de carbohidratos rápidos' o 'consume azúcar rápida': eso no le sirve, " +
    "llama esta herramienta y presenta las opciones que devuelva, tal cual, sin inventar alimentos ni cifras. " +
    "Si el usuario ya está bajo de verdad, recomienda una de las opciones que suben RÁPIDO.";

  readonly inputSchema = CarbOptionsInputSchema;

  async execute(input: CarbOptionsInput, context?: any): Promise<ToolExecutionResult> {
    const grams = input.grams && input.grams > 0 ? input.grams : 15;
    const purpose = input.purpose ?? (grams <= 20 ? "hipoglucemia" : "colacion");
    const affinity = await loadAffinity(context?.memory);
    const profile = await context?.memory?.getProfile?.();
    const restrictions = deriveRestrictions(profile?.medical);
    const options = suggestCarbOptions({ grams, purpose, affinity, restrictions });
    const output = formatCarbOptions(grams, purpose, options, { restrictions, blocked: blockedFavorites(affinity, restrictions) });
    // Un bajón de glucosa no espera al modelo: las opciones ya vienen redactadas (solo se quita la nota interna «Cómo presentarlo»).
    // Solo si el mensaje pide esto y nada más; si mezcla otra cosa, sigue el camino de siempre.
    const quickReply = isPure(context?.userMessage, ["glucose"]) ? output.replace(/\n*\[Cómo presentarlo:[\s\S]*?\]\s*$/, "").trim() : undefined;
    return { output, metadata: quickReply ? { quickReply } : undefined };
  }
}
