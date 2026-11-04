// ============================================================
// Eris — InventoryReply (2026-10-22, fase I2)
//
// Arma, por código, la respuesta a una operación de Inventario con lo que devolvió el teléfono (o el último respaldo).
// El modelo no redacta cantidades: o se usa este texto tal cual (respuesta rápida) o se le entrega como resultado.
// ============================================================

import type { InventoryOp } from "./InventoryParse.js";
import type { InventoryResult } from "./InventoryBridge.js";

const clp = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("es-CL");
const chips = (xs?: string[]) => (xs?.length ? "\n" + xs.slice(0, 8).map((x) => `[Opción: ${x}]`).join(" ") : "");
const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** Un resultado de una cosa (las listas de varias cosas se arman juntando estos). */
function linea(action: InventoryOp["action"], r: InventoryResult): string {
  const d = r.data ?? {};
  if (!r.ok) {
    const msg = (r.msg || "no se pudo").replace(/\.$/, "");
    switch (r.code) {
      case "falta_area": return `${msg}${chips(r.opciones)}`;
      case "ambiguo": return `${msg}. ¿Cuál?${chips(r.opciones)}`;
      case "falta_cantidad": return /\?$/.test(msg) ? msg : `${msg}.`;
      case "no_encontrado": return `${msg} (agrégalo en Inventario → + Agregar, o dime «compré…»).`;
      case "sin_stock": return `${msg}: ya figuraba sin stock.`;
      case "timeout":
      case "sin_conexion": return `No pude anotarlo: ${msg}. Abre la app de Eris y pídemelo de nuevo.`;
      default: return `No lo anoté: ${msg}.`;
    }
  }
  switch (action) {
    case "compra":
      return `📦 **${d.nombre}**: +${d.agregado}${d.supuesto ? " (si fue otra cantidad, dímela)" : ""} → tienes ${d.cantidad}${d.nuevo ? ` · nuevo en ${d.area}` : ""}.`;
    case "consumo":
      return d.acabado ? `🛒 **${d.nombre}**: se acabó; quedó en tu lista de compras.` : `✓ **${d.nombre}**: −${d.usado}, te quedan ${d.cantidad}.`;
    case "se_acabo":
      return `🛒 **${d.nombre}**: anotado que se acabó; quedó en tu lista de compras.`;
    case "quedan":
      return d.hay ? `✓ **${d.nombre}**: ahora ${d.cantidad} (contado).` : `🛒 **${d.nombre}**: en 0; quedó en tu lista de compras.`;
    case "botar":
      return `🗑️ **${d.nombre}**: ${d.botado === "todo" ? "todo" : d.botado} a la basura${d.hay ? `; quedan ${d.cantidad}` : ""}.`;
    default: return "";
  }
}

export function formatInventoryReply(op: InventoryOp, results: InventoryResult[], opts: { respaldo?: string } = {}): string {
  const r = results[0];
  const nota = opts.respaldo ? `\n_(según tu último respaldo, ${opts.respaldo}: abre la app para ver lo de ahora)_` : "";
  if (op.items && results.length > 1 || ["compra", "consumo", "se_acabo", "quedan", "botar"].includes(op.action)) {
    const ls = results.map((x) => linea(op.action, x)).filter(Boolean);
    return ls.join("\n");
  }
  if (!r) return "No pude revisar tu inventario.";
  if (!r.ok) return linea(op.action, r);
  const d = r.data ?? {};
  const vacio = d.vacio ? "Todavía no anotas nada en Inventario: agrega lo que tienes en la app (+ Agregar) o dime «compré…» y lo voy llevando." : "";
  switch (op.action) {
    case "consultar": {
      const xs = (d.items ?? []) as Array<{ nombre: string; area: string; cantidad: string; hay: boolean; vence?: string; ubicacion?: string }>;
      if (!xs.length) return (vacio || `No tengo «${d.producto}» anotado en tu inventario.`) + nota;
      const [a, ...rest] = xs;
      const l1 = a.hay ? `Sí: **${a.nombre}**, ${a.cantidad} (${a.area}${a.ubicacion ? ` · ${a.ubicacion}` : ""})${a.vence ? `, ${a.vence}` : ""}.` : `No te queda **${lower(a.nombre)}**: se acabó (está en tu lista de compras).`;
      const otros = rest.filter((x) => x.hay).slice(0, 3).map((x) => `${x.nombre} ${x.cantidad}`);
      return l1 + (otros.length ? `\nTambién: ${otros.join(" · ")}.` : "") + nota;
    }
    case "en_area": {
      const xs = (d.items ?? []) as Array<{ nombre: string; cantidad: string; hay: boolean; vence?: string }>;
      if (!xs.length) return (vacio || `${d.icono} En ${d.area} no tienes nada anotado.`) + nota;
      const con = xs.filter((x) => x.hay), sin = xs.filter((x) => !x.hay);
      return `${d.icono} **${d.area}** (${con.length} con stock):\n` + con.slice(0, 25).map((x) => `· ${x.nombre}: ${x.cantidad}${x.vence ? ` (${x.vence})` : ""}`).join("\n")
        + (sin.length ? `\nSe acabó: ${sin.slice(0, 10).map((x) => x.nombre).join(", ")}.` : "") + nota;
    }
    case "lista": {
      const auto = (d.auto ?? []) as Array<{ nombre: string; estado: string; sugerida?: string; costo?: number }>;
      const manual = (d.manual ?? []) as Array<{ nombre: string; cantidad?: string }>;
      if (!auto.length && !manual.length) return (vacio || "🛒 Tu lista de compras está vacía: no se te ha acabado nada de lo que anotas.") + nota;
      const ls = [
        ...auto.map((f) => `· ${f.nombre}${f.estado === "acabado" ? " (se acabó)" : f.estado === "pronto" ? " (se acaba pronto a tu ritmo)" : " (queda poco)"}${f.sugerida ? ` — ~${f.sugerida}` : ""}${f.costo ? ` · ~${clp(f.costo)}` : ""}`),
        ...manual.map((c) => `· ${c.nombre}${c.cantidad ? ` — ${c.cantidad}` : ""}`),
      ];
      const tot = d.total > 0 ? `\nEstimado: ~${clp(d.total)}${d.sinPrecio ? ` (+${d.sinPrecio} sin precio conocido)` : ""}, con lo que pagaste la última vez.` : "";
      return `🛒 **Lista de compras** (${ls.length}):\n${ls.slice(0, 30).join("\n")}${tot}${nota}`;
    }
    case "agregar_lista": return `🛒 ${d.nombre[0].toUpperCase() + d.nombre.slice(1)}: a la lista de compras (${d.lista} anotado${d.lista === 1 ? "" : "s"} a mano).`;
    case "por_vencer": {
      const xs = (d.items ?? []) as Array<{ nombre: string; cantidad: string; cuando: string; dias: number }>;
      if (!xs.length) return (vacio || `✓ Nada por vencer en los próximos ${op.dias ?? 7} días (de lo que tiene fecha anotada).`) + nota;
      return `⏳ **Por vencer:**\n` + xs.slice(0, 15).map((x) => `· ${x.dias < 0 ? "⚠️ " : ""}${x.nombre} (${x.cantidad}): ${x.cuando}`).join("\n")
        + (xs.some((x) => x.dias < 0) ? `\nLo que ya venció: bótalo y dime «boté…» para que el inventario siga fiel.` : "")
        // Lo que vence y se come: el asesor lo usa primero (fase I7). Un botón en vez de que tenga que preguntar (2026-10-23)
        + (xs.some((x) => x.dias >= 0) ? `\nPara aprovecharlo, te armo una comida que lo use primero.\n\n[Opción: ¿Qué cocino con eso?]` : "") + nota;
    }
    case "resumen": {
      if (!d.items) return vacio + nota;
      const areas = (d.areas ?? []) as Array<{ nombre: string; icono: string; conStock: number }>;
      const ls = [`📦 **Tu inventario:** ${d.conStock} cosa${d.conStock === 1 ? "" : "s"} con stock — ${areas.map((a) => `${a.icono} ${a.nombre} ${a.conStock}`).join(" · ")}`];
      if (d.porVencer?.length) ls.push(`⏳ Por vencer: ${d.porVencer.slice(0, 5).map((v: any) => v.nombre).join(", ")}.`);
      if (d.acabados?.length) ls.push(`🛒 Se acabó: ${d.acabados.slice(0, 8).join(", ")}.`);
      if (d.poco?.length) ls.push(`Queda poco: ${d.poco.slice(0, 8).join(", ")}.`);
      return ls.join("\n") + nota;
    }
    case "deshacer": return `↩️ Listo: ${lower(String(d.msg ?? "deshecho"))}.`;
    default: return "";
  }
}

/** Resultado para el MODELO (si el mensaje mezclaba más cosas y no se usó la respuesta rápida). */
export function inventoryToolOutput(op: InventoryOp, results: InventoryResult[], reply: string): string {
  const escribe = ["compra", "consumo", "se_acabo", "quedan", "botar", "agregar_lista", "deshacer"].includes(op.action);
  const ok = results.some((r) => r.ok);
  if (escribe && !ok) {
    return `NO se anotó nada en Inventario (${results[0]?.code ?? "error"}): ${results[0]?.msg ?? ""}\n` +
      `[Cómo presentarlo: dile al usuario exactamente esto, sin afirmar que quedó anotado]\n${reply}`;
  }
  return `${escribe ? "Operación aplicada en Inventario" : "Consulta de Inventario"} (${op.action}). Datos reales:\n${reply}\n` +
    `[Cómo presentarlo: usa estas cantidades tal cual; no inventes lo que tiene ni lo que le falta]`;
}
