// ============================================================
// Eris — SupplementParse (2026-10-23, fase I5)
//
// Las frases claras de suplementos se reconocen por código (como las de Inventario y Finanzas), antes del modelo:
//   - «me tomé la creatina», «ya tomé la vitamina D» → tomar;
//   - «no me tomé el omega», «borra la toma de magnesio» → deshacer;
//   - «¿me tomé la creatina?», «¿qué suplementos me faltan?», «mis suplementos» → estado;
//   - «¿qué es la creatina?», «¿sirve el magnesio para dormir?», «¿cuánta vitamina D se toma?» → ficha.
// Lo que se toma tiene que ser un suplemento: uno de SU lista (el último estado que mandó el teléfono) o uno con ficha.
// «Me tomé un jugo» o «me tomé la leche» no son suplementos: los ve Nutrición.
// ============================================================

import { fichaPara, buscarMio, type SupState } from "./SupplementCore.js";
import { faqSuplemento } from "./SupplementFaq.js";

export interface SupplementOp { action: "tomar" | "deshacer" | "estado" | "ficha"; sup?: string; sups?: string[] }

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;:]+/g, " ").replace(/\s+/g, " ").trim();
const ART = "(?:el|la|los|las|mi|mis|una|un|unas|unos|su|sus)\\s+";
/** Palabras que dicen que es comida o bebida, no un suplemento («me tomé un jugo con proteína») */
const COMIDA = /\b(jugo|leche|cafe|te|bebida|coca|agua|vaso|taza|batido|yogurt?|once|desayuno|almuerzo|cena|comi|comida|cerveza|vino)\b/;

/** Lo dicho es un suplemento: de su lista o con ficha. Devuelve el nombre como lo dijo. */
function esSuplemento(nombre: string, S: SupState | null): string | null {
  const n = nombre.replace(/\b(de hoy|hoy|ya|recien|denuevo|de nuevo|tambien|por favor|porfa)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!n || n.length > 40) return null;
  if (S && buscarMio(S, n)) return n;
  return fichaPara(n) ? n : null;
}

export function parseSupplementMessage(text: string, S: SupState | null): SupplementOp | null {
  const raw = String(text ?? "");
  if (!raw.trim() || raw.length > 160) return null;
  const t = fold(raw);
  const pregunta = /[?¿]/.test(raw) || /^(que|cual|cuanto|cuanta|como|sirve|es bueno|es buena|conviene|me conviene)\b/.test(t);

  // Estado: «mis suplementos», «¿qué suplementos me faltan?», «¿tomé mis suplementos?»
  if (/^(?:eris\s+)?(?:(?:cuales son|como van|como voy con|que tal)\s+)?mis suplementos$/.test(t)
    || /\b(que|cuales) suplementos (me )?(falta\w*|tengo|tomo|me toca\w*)\b/.test(t)
    || /\b(me )?tome (todos )?mis suplementos\b/.test(t) && pregunta) return { action: "estado" };

  // «Ya me tomé mis suplementos», «tomé todos los suplementos»: una toma de cada uno de los que faltan
  if (!pregunta && /^(?:ya\s+)?(?:me\s+)?tome\s+(?:todos\s+)?(?:mis|los)\s+suplementos(?:\s+de hoy)?$/.test(t)) return { action: "tomar", sup: "*" };

  // Deshacer: «no me tomé la creatina», «borra la toma de magnesio», «me equivoqué, no tomé el omega»
  let m = t.match(new RegExp(`^(?:me equivoque\\s+)?no (?:me )?tome (?:${ART})?(.+)$`)) ?? t.match(new RegExp(`^(?:borra|quita|deshace)(?:r)? (?:la )?toma de (?:${ART})?(.+)$`));
  if (m && !pregunta) { const sup = esSuplemento(m[1], S); if (sup && !COMIDA.test(m[1])) return { action: "deshacer", sup }; }

  // Tomar / ¿tomé?: «me tomé la creatina», «ya tomé la vitamina D», «tomé 5 g de creatina»
  m = t.match(new RegExp(`^(?:eris\\s+)?(?:anota(?:me)? que\\s+)?(?:ya\\s+)?(?:me\\s+)?tome\\s+(?:ya\\s+)?(?:\\d+[.,]?\\d*\\s*(?:g|gr|mg|ui|capsulas?|tabletas?)\\s+de\\s+)?(?:${ART})?(.+)$`))
    ?? t.match(new RegExp(`^(?:ya\\s+)?(?:me\\s+)?tome\\s+(?:${ART})?(.+?)\\s*(?:hoy|ya)?$`));
  if (m && !COMIDA.test(m[1])) {
    // «la creatina y una de omega», «el magnesio, la vitamina D y el omega»: varios, si cada parte es un suplemento
    const partes = m[1].split(/\s*,\s*|\s+y\s+/).map((p) => p.replace(new RegExp(`^(?:una? de |una? |${ART})`), "").trim()).filter(Boolean);
    if (!pregunta && partes.length > 1) {
      const sups = partes.map((p) => esSuplemento(p, S));
      if (sups.every(Boolean)) return { action: "tomar", sup: sups[0]!, sups: sups as string[] };
    }
    const sup = esSuplemento(m[1], S);
    if (sup) return { action: pregunta ? "estado" : "tomar", sup };
  }
  m = t.match(/^(?:ya\s+)?(.+?)\s+tomad[oa]s?$/);
  if (m && !pregunta) { const sup = esSuplemento(m[1], S); if (sup) return { action: "tomar", sup }; }

  // Ficha: «¿qué es la creatina?», «¿sirve el magnesio?», «¿cuánta vitamina D se toma?», «ficha de omega 3»
  if (pregunta || /^ficha (de|del)\b/.test(t)) {
    const f = fichaPara(t);
    const asks = /\b(que es|para que sirve|sirve|sirven|es bueno|es buena|es malo|es mala|conviene|evidencia|estudios|dosis|cuanto|cuanta|cuantos|cuantas|efectos|riesgos?|dana|danan|peligros\w*|seguro|segura|ficha|recomiendas|como se toma|cuando se toma)\b/.test(t);
    // «¿cuánta vitamina C tiene la naranja?» pregunta por un alimento, no por el suplemento
    const deUnAlimento = /\b(tiene|tienen|trae|traen|aporta|aportan|contiene|contienen|hay en)\b/.test(t);
    // «¿cuánta proteína me falta hoy?» es de su día (Nutrición), no la ficha de la proteína en polvo
    const deSuDia = /\b(me falta\w*|me queda\w*|llevo|he comido|comi|para completar\w*|completarla|hoy)\b/.test(t) && !/\b(polvo|suplemento|whey|batido)\b/.test(t);
    if (f && asks && !COMIDA.test(t) && !deUnAlimento && !deSuDia) return { action: "ficha", sup: f.nombre };
    // Una duda típica («¿la creatina se puede tomar con café?», «¿la tomo los días de descanso?»): la ficha con su respuesta,
    // aunque nombre el café o «hoy» (revisión 2026-11-04, Q1)
    if (f && !deUnAlimento && faqSuplemento(f.id, t)) return { action: "ficha", sup: f.nombre };
  }
  return null;
}
