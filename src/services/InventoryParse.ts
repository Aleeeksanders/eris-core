// ============================================================
// Eris — InventoryParse (2026-10-22, fase I2)
//
// Las frases claras de Inventario se reconocen por código (como FinanceParse) y se responden sin pasar por el modelo:
//   «compré 2 L de leche y 6 huevos», «se me acabó el shampoo», «me quedan 3 huevos», «usé 500 g de arroz»,
//   «boté el yogur, estaba vencido», «¿tengo arroz?», «¿qué tengo en la despensa?», «¿qué me falta comprar?»,
//   «anota pilas en la lista de compras», «¿qué se vence esta semana?», «deshaz lo último del inventario».
// Lo que trae plata («compré leche en 2 lucas») es de Finanzas (va antes). Lo que se come («me comí 2 huevos») es de
// Nutrición: descontarlo de la despensa es la fase I3.
// ============================================================

import { parseCantidad, fold, AREAS, areaPara, type AreaId, type Unidad, type Contenido, type OpAction } from "./InventoryCore.js";

export interface InventoryItemOp { producto: string; cantidad?: number; unidad?: Unidad; contenido?: Contenido }
export interface InventoryOp {
  action: OpAction;
  producto?: string;
  cantidad?: number;
  unidad?: Unidad;
  contenido?: Contenido;
  area?: AreaId;
  motivo?: string;
  dias?: number;
  /** varias cosas en un mensaje («compré leche, pan y huevos»): una operación por cada una */
  items?: InventoryItemOp[];
}

/** Plata en el mensaje: es de Finanzas. */
const MONEY = /\$\s?\d|\b\d+(?:[.,]\d+)?\s*(?:lucas?|luquitas?|pesos|palos?|mil)\b|\b(?:lucas?|luquitas?|una luca|luca y media)\b/;
/** Comer o beber: es de Nutrición. */
const ATE = /\b(me comi|comi|comimos|almorce|desayune|cene|me tome|tome|bebi|merende)\b/;
const LEAD = /^(?:(?:eris|oye|ya|bueno|ok|hoy|ayer|anoche|recien|recién|acabo de|al final)[\s,]+)*/;

const AREA_WORDS: Array<[AreaId, RegExp]> = [
  ["alimentos", /\b(refri\w*|refrigerador|nevera|alimentos|heladera)\b/],
  ["despensa", /\b(despensa|alacena|bodega)\b/],
  ["bano", /\b(bano|higiene)\b/],
  ["limpieza", /\b(limpieza|aseo)\b/],
  ["botiquin", /\b(botiquin|remedios|medicamentos|farmacia)\b/],
  ["ropa", /\b(ropa|closet|cl[oó]set)\b/],
  ["objetos", /\b(objetos|herramientas)\b/],
  ["mascotas", /\b(mascotas?|perro|gato)\b/],
];
export function areaDe(texto: string): AreaId | undefined {
  const t = fold(texto);
  for (const [a, re] of AREA_WORDS) if (re.test(t)) return a;
  const n = AREAS.find((a) => fold(a.nombre) === t || fold(a.corto) === t);
  return n?.id;
}

/** «el shampoo», «unas paltas para la semana», «pan en el super» → «shampoo», «paltas», «pan». */
export function limpiarProducto(s: string): string {
  let t = fold(s).replace(/[¿?¡!.;:]+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:(?:el|la|los|las|un|una|unos|unas|mi|mis|del|de|al|mas|otro|otra|otros|otras|nuevo|nueva)\s+)+/, "");
  t = t.replace(/\s+(?:(?:en|del?)\s+(?:el|la)\s+(?:super\w*|jumbo|lider|tottus|unimarc|santa isabel|acuenta|feria|almacen|negocio|botilleria|farmacia|minimarket)|para (?:la|el|mi|los|las) \w+(?: \w+)?|(?:con|en|por)\s+(?:la|el|mi)?\s*(?:tarjeta|efectivo|debito|credito|bci|cuenta)\b.*|de nuevo|otra vez|hoy|ayer|esta (?:semana|manana|tarde)|nomas|no mas|porfa\w*|por favor)\s*$/, "");
  t = t.replace(/\s+(?:que|porque|ya que)\s+.*$/, "").trim();
  return t;
}

/** Lo que no es una cosa de la casa: «no hay problema», «se acabó la reunión», «me quedan 2 horas», «usé la cabeza». */
const NO_PRODUCTO = /^(?:problemas?|drama|de que|tiempo|nada|caso|dudas?|ganas|apuro|prisa|rollo|temas?|reunion(?:es)?|clases?|peliculas?|series?|partidos?|juegos?|horas?|minutos?|segundos?|dias?|semanas?|mes(?:es)?|anos?|años?|plazos?|paciencia|bateria|señal|senal|internet|luz|cabeza|plata|dinero|sueldo|cuotas?|pagos?|sesion(?:es)?|repeticion(?:es)?|capitulos?|episodios?|paginas?|cuadras?|kilometros?|km|puntos?|vidas?|intentos?|oportunidad(?:es)?|cupos?|turnos?)\b/;
/**
 * Gente y cosas que «llegan» sin ser de la casa (revisión 2026-11-04, C2): «llegó mi hermano», «me llegó el pedido», «me llegó
 * un correo» creaban un producto en el Inventario.
 */
const NO_COSA = /^(?:(?:mi|mis|tu|su|el|la|los|las|un|una)\s+)*(?:herman[oa]s?|mama|mami|papa|papi|padres|hij[oa]s?|primo|prima|primos|tio|tia|tios|abuel[oa]s?|amig[oa]s?|polol[oa]|novi[oa]|espos[oa]|pareja|jefe|jefa|vecin[oa]s?|visitas?|gente|familia|suegr[oa]|cunad[oa]|sobrin[oa]s?|guagua|bebe|pedido|encomienda|paquete|correo|mail|mensaje|whatsapp|notificacion|boleta|cuenta|factura|cobro|transferencia|deposito|aviso|carta|invitacion|respuesta|resultado|examen|turno|hora|regla|periodo|menstruacion|sueldo|pago)\b/;
/**
 * «¿Tengo X?» / «¿cuánto X me queda?» que no preguntan por una cosa de la casa (revisión 2026-11-04, C1, chats reales):
 * «¿tengo fuerza?», «¿tengo fiebre?», «¿cuántas calorías me quedan?», «¿cuánto me queda?» respondían desde el Inventario.
 * Lo del cuerpo, la salud, la comida del día y la plata es de otras herramientas.
 */
export const NO_CONSULTA = /^(?:me|te|se|le|nos|algo|eso|esto|esa|ese|que|cuanto|cuanta|tiempo|ganas|fuerzas?|energia|animo|sueno|hambre|sed|frio|calor|fiebre|gripe|covid|resfrio|tos|dolor\w*|diabetes|presion|infarto|ansiedad|estres|depresion|azucar alta|glucosa\w*|glicemia|calorias?|kcal|proteinas?|carbos?|carbohidratos|macros?|grasa corporal|agua|litros|vasos|pasos|horas?|minutos?|dias?|plata|dinero|saldo|presupuesto|sueldo|deudas?|cuotas?|credito|cupo|vacaciones|permiso|clases?|pega|trabajo|razon|derecho|chance|suerte|problemas?|cancer|alergia\w*|intolerancia\w*|celiaquia|anemia|colesterol|trigliceridos|hba1c|hemoglobina|mal|bien|un problema)\b/;

/** «leche, pan y 6 huevos» → tres cosas, cada una con su cantidad. */
export function itemsDe(texto: string): InventoryItemOp[] {
  const parts = fold(texto).replace(/\s+(?:y|e)\s+(?=\S)/g, ", ").split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);
  const out: InventoryItemOp[] = [];
  for (const p of parts) {
    const c = parseCantidad(p);
    const producto = limpiarProducto(c ? c.resto : p);
    if (!producto || producto.length < 2 || /^\d+$/.test(producto) || NO_PRODUCTO.test(producto)) continue;
    out.push({ producto, ...(c ? { cantidad: c.cant, unidad: c.unidad, ...(c.contenido ? { contenido: c.contenido } : {}) } : {}) });
  }
  return out.slice(0, 12);
}
const one = (action: OpAction, it: InventoryItemOp, extra: Partial<InventoryOp> = {}): InventoryOp => ({ action, ...it, ...extra });
const many = (action: OpAction, xs: InventoryItemOp[], extra: Partial<InventoryOp> = {}): InventoryOp | null =>
  !xs.length ? null : xs.length === 1 ? one(action, xs[0], extra) : { action, items: xs, ...extra };

/** Lo que pide el mensaje, si es una frase clara de Inventario; si no, null (decide el modelo o lo toma otra herramienta). */
export function parseInventoryMessage(message: string): InventoryOp | null {
  const raw = String(message || "").trim();
  if (!raw || raw.length > 220) return null;
  const t0 = fold(raw).replace(/\s+/g, " ").trim();
  if (MONEY.test(t0) || ATE.test(t0)) return null;
  const pregunta = /[?¿]/.test(raw);
  const t = t0.replace(/[¡!]+/g, "").replace(LEAD, "").replace(/^[¿\s]+/, "").replace(/[?.\s]+$/, "").trim();

  // Deshacer lo último que se anotó por chat en Inventario
  if (/^(?:deshaz|deshace|deshacer|borra|anula)\s+(?:lo|el)\s+ultimo\b.*\b(?:inventario|despensa|stock)\b/.test(t)) return { action: "deshacer" };

  // La lista de compras
  const ag = t.match(/^(?:anota|agrega|agregame|anotame|pon|ponme|suma|mete|apunta)\s+(.+?)\s+(?:a|en)\s+(?:la\s+|mi\s+)?lista(?:\s+de\s+(?:las\s+)?compras?)?$/)
    ?? t.match(/^(?:hay que|tengo que|tenemos que|necesito|necesitamos)\s+comprar\s+(.+)$/);
  if (ag && !pregunta) return many("agregar_lista", itemsDe(ag[1]));
  if (/\b(?:lista (?:de (?:las )?compras?|del (?:super|supermercado|mercado|almacen|feria))|lista para (?:el )?(?:super|supermercado)|que (?:me |nos )?falta(?:n)?(?: por)? comprar|que (?:tengo|tenemos|hay) que comprar|que debo comprar|que me falta(?:n)?)\b/.test(t)
    && !/^(?:anota|agrega|pon|suma|borra|quita)\b/.test(t)) return { action: "lista" };

  // Lo que se vence
  if (/\b(?:(?:que|algo) se (?:me |nos )?(?:vence|vencen|va a vencer|van a vencer|esta por vencer|estan por vencer)|se (?:me |nos )?(?:vence|vencen|esta por vencer) algo|por vencer|vencimientos?|que vence|que caduca)\b/.test(t)) {
    return { action: "por_vencer", dias: /\beste mes\b/.test(t) ? 30 : /\b(hoy|manana)\b/.test(t) ? 1 : 7 };
  }

  // «¿Qué tengo en la despensa?», «mi inventario»
  const enArea = t.match(/^(?:que|cuanto|cuantas cosas)\s+(?:tengo|hay|tenemos|me queda|queda)\s+en\s+(?:el|la|mi|los)?\s*(.+)$/);
  if (enArea) {
    const a = areaDe(enArea[1]);
    if (a) return { action: "en_area", area: a };
    if (/\b(inventario|casa|stock)\b/.test(enArea[1])) return { action: "resumen" };
  }
  if (/^(?:mi inventario|resumen del inventario|como esta (?:mi |el )?inventario|que tengo en (?:mi )?(?:inventario|casa))$/.test(t)) return { action: "resumen" };

  // «¿Tengo arroz?», «¿cuánto arroz me queda?», «¿queda leche?»
  if (pregunta) {
    const q = t.match(/^(?:tengo|tenemos|me queda(?:n)?|nos queda(?:n)?|queda(?:n)?|hay)\s+(?:algo de\s+|mas\s+)?(.+)$/)
      ?? t.match(/^cuant[oa]s?\s+(.+?)\s+(?:me |nos )?(?:queda(?:n)?|tengo|tenemos|hay)$/);
    if (q) { const p = limpiarProducto(q[1]); return p && !NO_CONSULTA.test(p) ? { action: "consultar", producto: p } : null; }
    return null;
  }

  // Se acabó / no queda
  const acabo = t.match(/^(?:se (?:me |nos )?(?:acabo|acabaron|termino|terminaron|agoto|agotaron))\s+(.+)$/)
    ?? t.match(/^(?:ya )?no (?:me |nos )?queda(?:n)?(?: mas| nada de)?\s+(.+)$/)
    ?? t.match(/^(?:ya )?no hay (?:mas\s+)?(.+)$/)
    ?? t.match(/^(?:el|la|los|las)\s+(.+?)\s+se (?:me |nos )?(?:acabo|acabaron|termino|terminaron)$/);
  if (acabo) return many("se_acabo", itemsDe(acabo[1]).map((x) => ({ producto: x.producto })));

  // Lo que se botó (vencido, malo)
  const bote = t.match(/^(?:bote|botamos|tire|tiramos|eche a la basura)\s+(.+?)(?:\s*[,.]?\s*(?:porque\s+)?(?:estaba|estaban|se (?:habia|habian)|venci\w*|malo|mala|podrid\w*).*)?$/);
  if (bote) return many("botar", itemsDe(bote[1]), { motivo: /podrid|malo|mala|echo a perder/.test(t) ? "malo" : "vencido" });
  const vencio = t.match(/^se (?:me |nos )?(?:vencio|vencieron|echo a perder|echaron a perder|pudrio|pudrieron)\s+(.+)$/);
  if (vencio) return many("botar", itemsDe(vencio[1]), { motivo: /vencio|vencieron/.test(t) ? "vencido" : "malo" });

  // Conteo: «me quedan 3 huevos», «quedan 2 rollos de papel»
  const quedan = t.match(/^(?:me |nos )?queda(?:n)?\s+(.+)$/);
  if (quedan) { const it = itemsDe(quedan[1]); return it.length === 1 && it[0].cantidad != null ? one("quedan", it[0]) : null; }

  // Uso: «usé 500 g de arroz», «ocupé 2 rollos de papel»
  const uso = t.match(/^(?:use|usamos|ocupe|ocupamos|consumi|consumimos)\s+(.+)$/);
  if (uso) return many("consumo", itemsDe(uso[1]));

  // Compra: «compré 2 L de leche y 6 huevos», «traje pan», «agrega 2 shampoo al inventario»
  const compra = t.match(/^(?:me |nos )?(?:compre|compramos|traje|trajimos|repuse|repusimos|me llego|nos llego|llego|me llegaron|nos llegaron|llegaron)\s+(.+)$/)
    ?? t.match(/^(?:anota|agrega|suma|pon|mete|apunta)\s+(.+?)\s+(?:al|en el|a mi|en mi)\s+(?:inventario|stock|despensa|refri\w*|botiquin|bano)$/);
  if (compra) {
    // «Me llegó…»: solo cosas de la casa (con cantidad o reconocibles por su nombre), nunca gente ni avisos (C2)
    const its = itemsDe(compra[1]);
    if (its.some((x) => NO_COSA.test(x.producto))) return null;
    if (/^(?:me |nos )?(?:me llego|nos llego|llego|me llegaron|nos llegaron|llegaron)\b/.test(t) && its.some((x) => x.cantidad == null && !areaPara(x.producto))) return null;
    const area = areaDe(t.match(/\b(?:al|en el|a mi|en mi)\s+(inventario|stock|despensa|refri\w*|botiquin|bano)$/)?.[1] ?? "");
    return many("compra", itemsDe(compra[1]), area && area !== undefined ? { area } : {});
  }
  return null;
}
