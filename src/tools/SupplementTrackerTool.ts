// ============================================================
// Eris — SupplementTrackerTool (supplement_tracker) · 2026-10-23, fase I5
//
// Los suplementos por chat:
//   - «me tomé la creatina» / «no me tomé el omega» / «¿qué me falta hoy?»: lo aplica el TELÉFONO, donde vive «Mis
//     suplementos» (SupplementBridge), y vuelve lo que de verdad quedó. Sin el teléfono, «¿qué me falta?» sale de lo último
//     que mandó (avisando de cuándo es).
//   - «¿qué es la creatina?», «¿sirve el magnesio?», «¿cuánta vitamina D se toma?»: la FICHA (SupplementCore), igual que en
//     la app: qué hace, qué tan estudiado está, la dosis de los estudios como REFERENCIA con su fuente y los cuidados según
//     su perfil (condiciones, remedios, alergias). Por código, sin el modelo.
// «Cuida, no trata»: nunca indica empezar, subir ni dejar un suplemento; con un cuidado que aplica, lo dice y manda a su médico.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { parseSupplementMessage } from "../services/SupplementParse.js";
import { canSupplement, requestSupplementOp, type SupplementResult } from "../services/SupplementBridge.js";
import { applyOp, cuidadosPara, fichaPara, FICHAS, emptySupState, type Ficha, type SupState } from "../services/SupplementCore.js";
import { isPure } from "../services/Intent.js";
import { faqSuplemento } from "../services/SupplementFaq.js";
import { microQuestion, microAnswer } from "../services/MicroAnswer.js";
import { MICRO_KEYS, type MicroKey } from "../services/SupplementCore.js";

const SupplementSchema = z.object({
  action: z.enum(["tomar", "deshacer", "estado", "ficha", "nutriente"]).describe(
    "tomar = dice que ya tomó un suplemento ('me tomé la creatina'; '*' = todos los que faltan hoy); deshacer = no lo tomó / se equivocó; " +
    "estado = qué suplementos le faltan hoy o si ya tomó uno; ficha = qué es un suplemento, si sirve, qué dice la evidencia, la dosis de los estudios y sus cuidados; " +
    "nutriente = cuánto de una vitamina o mineral trae un alimento ('¿cuánta vitamina C tiene una naranja?')."),
  sup: z.string().optional().describe("El suplemento, como lo nombró: 'creatina', 'vitamina D', 'omega 3', 'magnesio'."),
  sups: z.array(z.string()).optional().describe("tomar: varios a la vez ('la creatina y el omega')."),
  nutriente: z.enum(MICRO_KEYS as unknown as [string, ...string[]]).optional().describe("nutriente: vA, vC, vD, vE, vK, b1, b2, b3, b6, b12, fol, ca (calcio), fe (hierro), mg (magnesio), k (potasio), zn (zinc), p (fósforo)."),
  alimento: z.string().optional().describe("nutriente: el alimento ('naranja', 'lentejas')."),
  gramos: z.number().positive().optional().describe("nutriente: los gramos, si los dijo."),
});
type SupplementInput = z.infer<typeof SupplementSchema>;

const EVIDENCIA: Record<string, string> = { fuerte: "muy estudiado", moderada: "evidencia moderada", limitada: "poca evidencia" };
const hhmm = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : `${d.getDate()}-${d.getMonth() + 1} a las ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };

async function lastState(memory: any): Promise<{ state: SupState; at: string } | null> {
  const s = await memory?.get?.("supplements_state").catch(() => null);
  return s && s.state && Array.isArray(s.state.items) ? s : null;
}

/** La ficha en texto, con los cuidados que aplican a ESTA persona. */
export function fichaTexto(f: Ficha, medical: any): string {
  const paraTi = cuidadosPara(f, medical);
  const fuentes = f.fuentes.map((x) => `${x.nombre} (${x.url})`).join("; ");
  return [
    `**${f.nombre}** · ${EVIDENCIA[f.evidencia]}`,
    f.que,
    `**Qué tan estudiado está:** ${f.evidenciaTexto}`,
    `**Dosis que usan los estudios (referencia, no indicación):** ${f.dosis}`,
    ...(paraTi.length ? [`**Para ti, según tu perfil:**\n${paraTi.map((t) => `• ${t}`).join("\n")}`] : []),
    ...(f.general.length ? [`**Cuidados:**\n${f.general.map((t) => `• ${t}`).join("\n")}`] : []),
    `Fuente: ${fuentes}.`,
    "No te indico dosis ni que empieces nada: si tomas remedios o tienes una condición, conversa con tu médico antes de empezar o cambiar un suplemento. La ficha completa está en Nutrición → Suplementos.",
  ].join("\n\n");
}

export class SupplementTrackerTool extends Tool<SupplementInput> {
  readonly name = "supplement_tracker";
  readonly description =
    "Los suplementos del usuario (viven en su teléfono): marcar que tomó uno ('me tomé la creatina'), deshacerlo, ver qué le falta hoy, y la " +
    "FICHA de un suplemento (qué hace, evidencia, dosis de los estudios como referencia con su fuente, cuidados según su perfil). USAR cuando hable " +
    "de suplementos (creatina, omega-3, vitamina D, magnesio, B12, hierro, zinc, proteína en polvo, cafeína, electrolitos, calcio, vitamina C). " +
    "Nunca digas que anotaste una toma sin esta herramienta, y nunca indiques una dosis ni que empiece un suplemento.";
  readonly inputSchema = SupplementSchema;

  async preroute(userMessage: string, context?: any): Promise<Record<string, unknown> | null> {
    // «¿Cuánta vitamina C tiene una naranja?»: por código, con la base de alimentos
    const mq = microQuestion(userMessage);
    if (mq) return { action: "nutriente", nutriente: mq.key, alimento: mq.alimento, ...(mq.gramos ? { gramos: mq.gramos } : {}) };
    const last = await lastState(context?.memory).catch(() => null);
    const op = parseSupplementMessage(userMessage, last?.state ?? null);
    return op ? { ...op } : null;
  }

  async execute(input: SupplementInput, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    const ws = context?.wsClient;
    const quick = isPure(context?.userMessage, ["supplement"]);

    if (input.action === "nutriente") {
      const reply = input.nutriente && input.alimento
        ? microAnswer({ key: input.nutriente as MicroKey, alimento: input.alimento, gramos: input.gramos }, context?.foodService ?? null)
        : null;
      if (!reply) return { output: `«${input.alimento ?? ""}» no está en la base de alimentos de Eris: si respondes de memoria, dilo y redondea.`, metadata: {} };
      const pure = isPure(context?.userMessage, ["supplement", "food"]);
      return { output: `DATO DE LA BASE (copia la cifra tal cual):
${reply}`, metadata: { quickReply: pure ? reply : undefined } };
    }
    if (input.action === "ficha") {
      const f = fichaPara(input.sup ?? "") ?? fichaPara(String(context?.userMessage ?? ""));
      if (!f) {
        const reply = `De «${input.sup ?? "ese suplemento"}» no tengo ficha. Tengo fichas de: ${FICHAS.map((x) => x.nombre).join(", ")}.`;
        // Sin ficha: que el modelo conteste (puede buscar en la web), sin inventar dosis
        return { output: `SIN FICHA en Eris para «${input.sup ?? ""}». ${reply} Si respondes con lo que sabes, NO indiques dosis ni que empiece a tomarlo.`, metadata: {} };
      }
      const medical = memory ? (await memory.getProfile?.().catch(() => null))?.medical : undefined;
      // La duda puntual primero, con lo que la ficha dice para su caso; la ficha completa queda a un botón (Q1)
      const faq = faqSuplemento(f.id, String(context?.userMessage ?? ""));
      if (faq) {
        const suyos = cuidadosPara(f, medical);
        const corto = [faq, ...(suyos.length ? ["", `En tu caso: ${suyos.join(" ")}`] : []), "", `[Opción: Ficha de ${f.nombre.toLowerCase()}]`].join("\n");
        return { output: `RESPUESTA DE LA FICHA (copia tal cual, sin agregar dosis):\n${corto}`, metadata: { quickReply: corto } };
      }
      const reply = fichaTexto(f, medical);
      return { output: `FICHA (copia el contenido tal cual, sin agregar dosis):\n${reply}`, metadata: { quickReply: quick ? reply : undefined } };
    }

    // Varios a la vez («me tomé la creatina y una de omega»): uno por uno, y la respuesta junta (2026-10-23: antes solo el primero)
    if (input.action === "tomar" && (input.sups?.length ?? 0) > 1 && ws && canSupplement(ws)) {
      const partes: string[] = [];
      let alguno = false;
      for (const sup of input.sups!) {
        const r1 = await requestSupplementOp(ws, { action: "tomar", sup });
        alguno ||= r1.ok;
        partes.push(r1.msg ?? "");
      }
      const reply = partes.filter(Boolean).join("\n");
      return { output: `${alguno ? "HECHO" : "NO SE ANOTÓ"} (tomar ${input.sups!.length}): ${reply}`, metadata: { quickReply: quick ? reply : undefined, supplementOk: alguno } };
    }
    const op = { action: input.action, sup: input.sup };
    let r: SupplementResult;
    let respaldo: string | undefined;
    if (ws && canSupplement(ws)) {
      r = await requestSupplementOp(ws, op);
    } else if (input.action === "estado" && memory) {
      const last = await lastState(memory);
      if (!last) {
        const reply = "Tus suplementos viven en el teléfono y todavía no me llegan: ábrelos una vez en la app (Nutrición → Suplementos) con conexión.";
        return { output: `SIN DATOS de suplementos. ${reply}`, metadata: { quickReply: quick ? reply : undefined } };
      }
      r = applyOp(last.state ?? emptySupState(), op as any, { now: new Date(), newId: () => "x" }).result;
      respaldo = hhmm(last.at);
    } else {
      const reply = "Eso lo anoto en tus suplementos, que viven en tu teléfono: pídemelo desde la app de Eris (actualizada) y queda al tiro.";
      return { output: `NO se anotó: esta conexión no es la app del teléfono.\n${reply}`, metadata: { quickReply: quick ? reply : undefined, supplementOk: false } };
    }

    let reply = r.msg ?? "";
    if (!r.ok && r.opciones?.length) reply += ` Tus suplementos: ${r.opciones.join(", ")}.`;
    if (r.ok && input.action === "tomar" && /prote/i.test(`${input.sup ?? ""} ${reply}`)) reply += "\nSi quieres que sume a tus calorías y proteína, anótala también en Nutrición.";
    if (respaldo) reply += `\n(Según lo último que mandó tu teléfono, el ${respaldo}.)`;
    // «No encontré X en tus suplementos» por una frase que quizás no era de suplementos: que conteste el modelo
    const dudoso = !r.ok && r.code === "no_encontrado" && input.action !== "estado";
    return {
      output: `${r.ok ? "HECHO" : "NO SE ANOTÓ"} (${input.action}): ${reply}`,
      metadata: { quickReply: quick && !dudoso ? reply : undefined, supplementOk: r.ok && input.action !== "estado" },
    };
  }
}
