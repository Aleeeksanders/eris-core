// ============================================================
// Eris — «Otro» del plan de Eris leído por el modelo (Eris al timón · T3, 2026-10-29)
//
// Las notas comunes las lee el código (DayPlan.parseNota). Lo que el código no entiende («mañana tengo examen y no voy a
// tener tiempo», «hoy viene mi suegra a almorzar», «ando con resaca») lo convierte el modelo, SOLO a datos: un JSON con
// ajustes acotados (zod). El plan lo sigue armando el código con esos ajustes. Si el modelo no responde o responde otra
// cosa, se ignora (el día se arma en el camino elegido y se dice que la nota no se pudo usar).
// ============================================================

import { z } from "zod";
import type { Ajustes } from "./DayPlan.js";

export interface NotaLLM { provider: { generate: (messages: any[], tools?: any, options?: any) => Promise<any> }; model?: string }

const Schema = z.object({
  afuera: z.array(z.enum(["desayuno", "almuerzo", "once", "cena"])).max(4).optional(),
  sinPlata: z.boolean().optional(),
  enfermo: z.boolean().optional(),
  dolor: z.string().max(30).optional(),
  sinTiempo: z.boolean().optional(),
  sinEntreno: z.boolean().optional(),
  evento: z.object({ que: z.string().min(2).max(30), hora: z.number().min(0).max(24).nullable() }).optional(),
  kcalExtra: z.number().min(-300).max(500).optional(),
});

const PROMPT = `Convierte la nota de una persona sobre su día en ajustes para su plan del día. Responde SOLO un objeto JSON, sin texto antes ni después, con estas claves (todas opcionales; pon solo las que la nota dice):
- "afuera": comidas que hará fuera de casa: ["desayuno","almuerzo","once","cena"]
- "sinPlata": true si dice que tiene poca plata o está corto de dinero
- "enfermo": true si está enfermo, con resaca, con fiebre o se siente mal del cuerpo
- "dolor": la parte del cuerpo que le duele, en una palabra ("rodilla")
- "sinTiempo": true si tendrá poco tiempo
- "sinEntreno": true si dice que hoy no entrenará
- "evento": {"que": "cumpleaños" o lo que sea, en 1–3 palabras, "hora": hora del día 0–24 o null} si tiene una comida o celebración
- "kcalExtra": número (−300 a 500) solo si dice que comerá más o menos de lo normal
Si la nota no dice nada de esto, responde {}.`;

/** Lo que el modelo entiende de la nota (validado), o null */
export async function readNotaLLM(llm: NotaLLM, nota: string): Promise<Ajustes | null> {
  const res = await llm.provider.generate(
    [{ role: "system", content: PROMPT }, { role: "user", content: nota.slice(0, 240) }],
    undefined,
    { ...(llm.model ? { modelOverride: llm.model } : {}), temperature: 0, maxTokens: 160, enableThinking: false, signal: AbortSignal.timeout(15000) },
  );
  const text = String(res?.content ?? "");
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let raw: unknown;
  try { raw = JSON.parse(m[0]); } catch { return null; }
  const p = Schema.safeParse(raw);
  if (!p.success) return null;
  const a = conRespaldo(p.data as Ajustes, nota);
  return Object.keys(a).length ? a : null;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/**
 * El modelo propone, el código decide: cada ajuste se acepta solo si la nota trae palabras que lo respalden. El modelo de 4B
 * llenaba de más (a «ando con resaca» le agregó «come afuera» y «sin plata»).
 */
export function conRespaldo(a: Ajustes, nota: string): Ajustes {
  const t = fold(nota);
  const out: Ajustes = {};
  if (a.afuera?.length && /\b(afuera|fuera|calle|restaurant\w*|trabajo|oficina|pega|casa de|donde (mi|un|una))\b/.test(t)) out.afuera = a.afuera;
  if (a.sinPlata && /\b(plata|lucas|dinero|pesos|pato|gast\w*|presupuesto|fin de mes|me paguen)\b/.test(t)) out.sinPlata = true;
  if (a.enfermo && /\b(enferm\w*|resfri\w*|gripe|fiebre|resaca|tos|vomit\w*|diarrea|mal del estomago|me siento mal|decaid\w*|covid)\b/.test(t)) out.enfermo = true;
  if (a.dolor && /\b(duele|dolor|molesta|lesion\w*|torci\w*|esguince|tendinitis|desgarro)\b/.test(t)) out.dolor = a.dolor;
  if (a.sinTiempo && /\b(tiempo|apurad\w*|ocupad\w*|reunion\w*|examen\w*|full|corriendo|viaje|turno)\b/.test(t)) out.sinTiempo = true;
  if (a.sinEntreno && (/\b(gym|gimnasio|entren\w*|ejercicio|deporte|rutina|pesas)\b/.test(t) || out.enfermo)) out.sinEntreno = true;
  if (a.evento && /\b(cumple\w*|asado|fiesta|carrete|matrimonio|celebra\w*|junta|visita|viene|vienen|invitad\w*|almuerzo con|cena con|once con|salida)\b/.test(t)) out.evento = a.evento;
  if (a.kcalExtra && /\b(comer|como|comere|hambre|carrera|maraton|partido|competencia)\b/.test(t)) out.kcalExtra = a.kcalExtra;
  return out;
}
