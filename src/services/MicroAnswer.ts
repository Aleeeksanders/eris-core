// ============================================================
// Eris — MicroAnswer (2026-10-23, fase I5)
//
// «¿Cuánta vitamina C tiene una naranja?», «¿cuánto hierro tienen las lentejas?»: se responde por código con la base de
// alimentos (USDA, fase I5), no de memoria. El 2026-10-23 el modelo dijo «unos 100 mg en una naranja de 150 g» (la base: 53 mg
// por 100 g → ~74 mg en una naranja de 140 g). La IA conecta, el código decide.
// ============================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MICROS, dri, fmtMicro, scaleMicros, type MicroKey, type Micros } from "./SupplementCore.js";
import type { UnifiedFoodService } from "./gluco/UnifiedFoodService.js";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;:]+/g, " ").replace(/\s+/g, " ").trim();

/** Cómo se nombra cada vitamina o mineral al preguntar */
const NOMBRES: Array<[RegExp, MicroKey]> = [
  [/^vitamina a$/, "vA"], [/^vitamina c$/, "vC"], [/^vitamina d$/, "vD"], [/^vitamina e$/, "vE"], [/^vitamina k$/, "vK"],
  [/^(vitamina )?b1$|^tiamina$/, "b1"], [/^(vitamina )?b2$|^riboflavina$/, "b2"], [/^(vitamina )?b3$|^niacina$/, "b3"],
  [/^(vitamina )?b6$/, "b6"], [/^(vitamina )?b12$/, "b12"], [/^(vitamina )?b9$|^folato$|^acido folico$/, "fol"],
  [/^calcio$/, "ca"], [/^hierro$/, "fe"], [/^magnesio$/, "mg"], [/^potasio$/, "k"], [/^zinc$/, "zn"], [/^fosforo$/, "p"],
];
const NUTRIENTE = "(vitamina [a-e]|vitamina k|vitamina b ?\\d{1,2}|b ?\\d{1,2}|tiamina|riboflavina|niacina|folato|acido folico|calcio|hierro|magnesio|potasio|zinc|fosforo)";
const RX = new RegExp(`\\bcuant[oa]s?\\s+(?:de\\s+)?${NUTRIENTE}\\s+(?:tiene|tienen|trae|traen|aporta|aportan|contiene|contienen|hay en)\\s+(.+)$`);

export interface MicroQuestion { key: MicroKey; alimento: string; gramos?: number }

/** La pregunta, si es «cuánto X tiene Y» (con gramos si los dijo: «100 g de lentejas»). */
export function microQuestion(text: string): MicroQuestion | null {
  const t = fold(text);
  if (t.length > 120) return null;
  const m = t.match(RX);
  if (!m) return null;
  const nombre = m[1].replace(/b (\d)/, "b$1");
  const key = NOMBRES.find(([re]) => re.test(nombre))?.[1];
  if (!key) return null;
  let alimento = m[2].replace(/^(un|una|el|la|los|las|mi|unos|unas)\s+/, "").trim();
  const g = alimento.match(/^(\d+[.,]?\d*)\s*(?:g|gr|gramos)\s+(?:de\s+)?(.+)$/);
  let gramos: number | undefined;
  if (g) { gramos = parseFloat(g[1].replace(",", ".")); alimento = g[2].replace(/^(el|la|los|las)\s+/, ""); }
  return alimento ? { key, alimento, gramos } : null;
}

type BaseFood = { name: string; serving: { description: string; grams: number }; micro?: Micros; liquid?: boolean };
let BASE: BaseFood[] | null = null;
function base(): BaseFood[] {
  if (!BASE) {
    try { BASE = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/chilean-foods.json"), "utf-8")); } catch { BASE = []; }
  }
  return BASE!;
}

/** La respuesta con la porción típica (o los gramos dichos) y por 100 g, o null si el alimento no está en la base o no trae el dato. */
export function microAnswer(q: MicroQuestion, foodService: Pick<UnifiedFoodService, "searchLocal"> | null): string | null {
  const hit = foodService?.searchLocal(q.alimento, 1)?.[0];
  if (!hit) return null;
  const f = base().find((x) => x.name === hit.name);
  const per100 = f?.micro?.[q.key];
  const info = MICROS.find((x) => x.key === q.key)!;
  const nombre = info.nombre.charAt(0).toLowerCase() + info.nombre.slice(1);
  if (!f || per100 == null) return f ? `En la base de Eris, ${f.name} no trae el dato de ${nombre}.` : null;
  const g = q.gramos ?? f.serving.grams;
  const v0 = scaleMicros({ [q.key]: per100 }, g)[q.key] ?? 0;
  const v = v0 >= 10 ? Math.round(v0) : v0; // «~80 mg», no «~79,8 mg»
  const ref = dri(q.key);
  const porcion = q.gramos ? `${g} ${f.liquid ? "ml" : "g"}` : f.serving.description;
  const pct = Math.round((v / ref) * 100);
  return `${f.name}, ${porcion}: ~${fmtMicro(q.key, v)} de ${nombre} ` +
    `(${pct > 300 ? "más de 3 veces" : `${pct} %`} de lo recomendado al día, ${fmtMicro(q.key, ref)} para un adulto). ` +
    `Por 100 ${f.liquid ? "ml" : "g"}: ${fmtMicro(q.key, per100)}. Fuente: USDA FoodData Central, en la base de alimentos de Eris.`;
}
