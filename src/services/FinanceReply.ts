// ============================================================
// Eris — FinanceReply
//
// Arma, por código, la respuesta a una operación de Finanzas con los números que devolvió el teléfono. El modelo no
// redacta cifras: o se usa este texto tal cual (respuesta rápida) o se le entrega como resultado de la herramienta.
// ============================================================

import type { FinanceOp } from "./FinanceParse.js";
import type { FinanceAccountView, FinanceResult } from "./FinanceBridge.js";

export const clp = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("es-CL");
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaCorta = (f: string) => { const [, m, d] = f.split("-").map(Number); return `${d} ${MES_CORTO[m - 1]}`; };
const hoyIso = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

function saldoLinea(c?: FinanceAccountView): string {
  if (!c) return "";
  if (c.tipo === "credito") {
    const deuda = Math.max(0, (c.cupo ?? 0) - c.saldo);
    return `Cupo libre en ${c.nombre}: ${clp(c.saldo)}${deuda > 0 ? ` (deuda ${clp(deuda)})` : ""}.`;
  }
  return c.saldo < 0 ? `⚠️ ${c.nombre} quedó en ${clp(c.saldo)}.` : `Te quedan ${clp(c.saldo)} en ${c.nombre}.`;
}
const chips = (xs?: string[]) => (xs?.length ? "\n" + xs.slice(0, 6).map((x) => `[Opción: ${x}]`).join(" ") : "");

export function formatFinanceReply(op: FinanceOp, r: FinanceResult, now: Date = new Date()): string {
  if (!r.ok) {
    const msg = (r.msg || "no se pudo").replace(/\.$/, "");
    switch (r.code) {
      case "sin_fondos": return `No lo anoté: ${msg}. ¿Lo pagaste con otra?${chips(r.opciones)}`;
      case "cuenta_no_encontrada":
      case "cuenta_ambigua": return `Todavía no lo anoto: ${msg}. ¿Cuál fue?${chips(r.opciones)}`;
      // aquí el teléfono ya manda la pregunta ("¿Con qué pagaste?", "¿De dónde salió la plata?")
      case "falta_cuenta": return `Para anotarlo me falta un dato: ${/\?$/.test(msg) ? msg : msg + "?"}${chips(r.opciones)}`;
      case "sin_prestamo":
      case "prestamo_ambiguo": return `${msg}.${chips(r.opciones)}`;
      case "timeout":
      case "sin_conexion": return `No pude anotarlo: ${msg}. Abre la app de Eris y pídemelo de nuevo.`;
      default: return `No lo anoté: ${msg}.`;
    }
  }
  const d = r.data ?? {};
  const lines: string[] = [];
  switch (op.action) {
    case "gasto": {
      const desde = d.cuenta ? ` · desde ${d.cuenta.nombre}` : "";
      // En cuotas: el total usa el cupo, pero al mes cuenta solo la cuota (desde el mes siguiente)
      const enCuotas = d.cuotas > 1 ? ` en ${d.cuotas} cuotas de ${clp(d.valorCuota)}${d.primeraCuota ? ` (la 1ª en ${d.primeraCuota})` : ""}` : "";
      lines.push(`✅ Anotado en Finanzas: **${d.desc}** — ${clp(d.monto)}${enCuotas} · ${d.catIcon ?? ""} ${d.catLabel ?? d.cat}${desde}${d.fecha && d.fecha !== hoyIso(now) ? ` (${fechaCorta(d.fecha)})` : ""}.`.replace(/ {2,}/g, " "));
      if (d.cuenta) lines.push(saldoLinea(d.cuenta));
      if (d.cuotas > 1) lines.push(`Este mes no te suma: cada mes cuenta solo la cuota.`);
      if (d.asumida && d.cuenta) lines.push(`Lo descontamos de ${d.cuenta.nombre} porque fue la última que usaste; si fue con otra, dime «borra el último gasto» y lo anotamos de nuevo.`);
      const mc = d.mesCat;
      if (mc?.presup > 0) {
        const pct = Math.round((mc.gastado / mc.presup) * 100);
        lines.push(`${pct >= 100 ? "⚠️ " : pct >= 85 ? "Ojo: " : ""}${d.catLabel} lleva ${clp(mc.gastado)} de ${clp(mc.presup)} este mes (${pct} %).`);
      }
      break;
    }
    case "prestamo":
      lines.push(`📋 Anotado: le prestaste ${clp(d.monto)} a ${d.persona}${d.cuenta ? ` desde ${d.cuenta.nombre}` : ""}.${d.devolucion ? ` Te lo devuelve el ${fechaCorta(d.devolucion)}.` : ""}`);
      if (d.cuenta) lines.push(saldoLinea(d.cuenta));
      if (d.asumida && d.cuenta) lines.push(`Salió de ${d.cuenta.nombre} porque fue la última que usaste; si fue de otra, dime «borra el último préstamo».`);
      break;
    case "cobro":
      lines.push(d.parcial
        ? `✓ ${d.persona} te devolvió ${clp(d.monto)}; todavía te debe ${clp(d.restante)}.`
        : `✓ Cobrado: ${d.persona} te devolvió ${clp(d.monto)}.`);
      if (d.cuenta) lines.push(`Volvió a ${d.cuenta.nombre}: ahora tienes ${clp(d.cuenta.saldo)}.`);
      break;
    case "abono":
      if (d.hacia?.tipo === "credito") {
        const deuda = Math.max(0, (d.hacia.cupo ?? 0) - d.hacia.saldo);
        lines.push(`💳 Abonaste ${clp(d.monto)} a ${d.hacia.nombre}. ${deuda > 0 ? `Deuda restante: ${clp(deuda)}.` : "Quedó sin deuda. 🎉"}`);
      } else if (d.fuente) {
        // Sueldo, extra o pasivo: queda como INGRESO del mes (no solo plata que entra a la cuenta)
        const ic = d.fuente === "sueldo" ? "💼" : d.fuente === "pasivo" ? "🌱" : "⚡";
        const etiqueta = String(d.fuenteLabel ?? d.fuente).toLowerCase();
        if (d.programado) {
          // Confirmó un ingreso fijo (sueldo, quincena, arriendo…): se dice contra lo esperado
          const dif = d.monto - (d.programado.esperado ?? d.monto);
          const que = /^sueldo \(saldo\)$/i.test(d.programado.desc) ? "el resto de tu sueldo" : /quincena|anticipo/i.test(d.programado.desc) ? "tu quincena"
            : /^sueldo$/i.test(d.programado.desc) ? "tu sueldo" : String(d.programado.desc).toLowerCase();
          lines.push(`${ic} ¡Llegó ${que}! ${clp(d.monto)} en ${d.hacia?.nombre}${dif !== 0 ? ` (esperabas ${clp(d.programado.esperado)}, ${dif > 0 ? "llegaron" : "faltaron"} ${clp(Math.abs(dif))})` : ""}. Saldo: ${clp(d.hacia?.saldo ?? 0)}.`);
        } else {
          const detalle = d.desc && String(d.desc).toLowerCase() !== etiqueta ? ` — ${d.desc}` : "";
          lines.push(`${ic} Ingreso anotado (${etiqueta}): ${clp(d.monto)}${detalle} en ${d.hacia?.nombre}. Saldo: ${clp(d.hacia?.saldo ?? 0)}.`);
        }
      } else {
        lines.push(`➕ Abonado: ${clp(d.monto)}${d.desc ? ` (${d.desc})` : ""} a ${d.hacia?.nombre}. Saldo: ${clp(d.hacia?.saldo ?? 0)}.`);
      }
      break;
    case "giro":
      lines.push(`🏧 Giro de ${clp(d.monto)} desde ${d.desde?.nombre}. Efectivo: ${clp(d.hacia?.saldo ?? 0)} · ${d.desde?.nombre}: ${clp(d.desde?.saldo ?? 0)}.`);
      break;
    case "transferencia":
      lines.push(`⇄ Listo: ${clp(d.monto)} de ${d.desde?.nombre} a ${d.hacia?.nombre}. ${d.desde?.nombre}: ${clp(d.desde?.saldo ?? 0)} · ${d.hacia?.nombre}: ${clp(d.hacia?.saldo ?? 0)}.`);
      break;
    case "pago_tarjeta":
      lines.push(`💳 Pagaste ${clp(d.monto)} de ${d.hacia?.nombre} desde ${d.desde?.nombre}. ${d.deuda > 0 ? `Deuda restante: ${clp(d.deuda)}.` : "Quedó sin deuda. 🎉"}`);
      lines.push(saldoLinea(d.desde));
      break;
    case "ahorro": {
      lines.push(`💰 Ahorro anotado: ${clp(d.monto)}${d.desc && d.desc !== "Ahorro" ? ` para ${d.desc.toLowerCase()}` : ""}. Llevas ${clp(d.ahorroAcum)} ahorrados.`);
      if (d.tier?.id) lines.push(d.tier.siguiente
        ? `Rango de ahorro ${d.tier.id}: te faltan ${clp(d.tier.falta)} para subir a ${d.tier.siguiente}.`
        : `Rango de ahorro ${d.tier.id}: el máximo. 👑`);
      break;
    }
    case "deshacer":
      lines.push(`↩️ Listo, borré ${d.tipo} «${d.desc}» de ${clp(d.monto)}${d.cuenta ? ` y la plata volvió a ${d.cuenta}` : ""}.`);
      break;
    case "resumen": {
      if (d.hayBoveda) {
        lines.push(`💰 Plata a mano: **${clp(d.liquidez)}**`);
        lines.push(`· Efectivo: ${clp(d.efectivo)}`);
        for (const c of (d.cuentas ?? []) as FinanceAccountView[]) {
          lines.push(c.tipo === "credito"
            ? `· ${c.nombre}: cupo libre ${clp(c.saldo)}${(c.cupo ?? 0) - c.saldo > 0 ? `, deuda ${clp((c.cupo ?? 0) - c.saldo)}` : ""}`
            : `· ${c.nombre}: ${clp(c.saldo)}`);
        }
        if (d.deudaTC > 0) lines.push(`💳 Deuda en tarjetas: ${clp(d.deudaTC)}`);
      } else {
        lines.push("Todavía no tienes cuentas en la Bóveda de Finanzas, así que no sé cuánta plata hay en cada lado.");
      }
      lines.push(d.ingreso > 0
        ? `📊 ${d.mes}: llevas ${clp(d.gastoMes)} gastados de ${clp(d.ingreso)}${d.ingresoExtra > 0 ? ` (incluye ${clp(d.ingresoExtra)} extra)` : ""} — te quedan ${clp(d.disponible)} del mes.`
        : `📊 ${d.mes}: llevas ${clp(d.gastoMes)} gastados. Todavía no tengo tu sueldo: anótalo en Finanzas para saber cuánto te queda.`);
      if (d.ahorroAcum > 0) lines.push(`💰 Ahorro: ${clp(d.ahorroAcum)}.`);
      if (d.pendienteCobro > 0) lines.push(`📋 Te deben ${clp(d.pendienteCobro)}.`);
      for (const p of (d.porConfirmar ?? []).slice(0, 3)) {
        const q = /quincena|anticipo/i.test(p.desc) ? ["tu quincena", "me llegó la quincena"] : /^sueldo/i.test(p.desc) ? ["tu sueldo", "me llegó el sueldo"] : [String(p.desc).toLowerCase(), "me llegó"];
        lines.push(`❓ ¿Ya llegó ${q[0]} (${clp(p.monto)})? Dime «${q[1]}» y lo anoto.`);
      }
      const prox = (d.proximos ?? []).slice(0, 3);
      if (prox.length) lines.push(`📅 Próximos: ${prox.map((p: any) => `${p.desc} ${p.tipo === "ingreso" ? "+" : "−"}${clp(p.monto)} el ${fechaCorta(p.fecha)}`).join(" · ")}.`);
      if (d.cuotasProxMes > 0) lines.push(`💳 El próximo mes vienen ${clp(d.cuotasProxMes)} en cuotas.`);
      break;
    }
  }
  return lines.filter(Boolean).join("\n");
}

/** Resultado para el MODELO (si el mensaje mezclaba más cosas y no se usó la respuesta rápida). */
export function financeToolOutput(op: FinanceOp, r: FinanceResult, reply: string): string {
  if (!r.ok) {
    return `NO se anotó nada en Finanzas (${r.code ?? "error"}): ${r.msg ?? ""}\n` +
      `[Cómo presentarlo: dile al usuario exactamente esto, sin afirmar que quedó anotado]\n${reply}`;
  }
  return `Operación aplicada en Finanzas (${op.action}). Datos reales del teléfono:\n${reply}\n` +
    `[Cómo presentarlo: usa estas cifras tal cual; no inventes saldos ni porcentajes]`;
}

// ─── «¿Y si me compro…?» ──────────────────────────────────────────
// La simulación la calcula el núcleo (FinanceCore.simularCompra) sobre el último respaldo de Finanzas; acá solo se arma
// el texto. Nada se anota.

export interface WhatIfReplyInput {
  descripcion?: string;
  monto: number;
  cuotas: number;
  veredicto: "holgado" | "justo" | "no_alcanza";
  hasta: string;
  lineas: string[];
  /** cuándo quedó así Finanzas (lo último que mandó el teléfono) */
  at?: string;
}

export function formatWhatIfReply(s: WhatIfReplyInput, now: Date = new Date()): string {
  const en = s.descripcion ? ` en ${s.descripcion.charAt(0).toLowerCase()}${s.descripcion.slice(1)}` : "";
  const titulo = `🧮 Si gastas ${clp(s.monto)}${en}${s.cuotas > 1 ? ` en ${s.cuotas} cuotas` : ""}:`;
  const veredicto = s.veredicto === "holgado" ? "Te alcanza sin problema."
    : s.veredicto === "justo" ? "Te alcanza, pero queda justo."
    : s.cuotas > 1 ? "No te alcanza el cupo de la tarjeta." : `No te alcanza con lo que tienes ${s.hasta}.`;
  let footer = "Es solo una simulación: no anoté nada.";
  if (s.at) {
    const d = new Date(s.at);
    if (!Number.isNaN(d.getTime())) {
      const hh = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      footer += ` Datos de Finanzas ${hoyIso(d) === hoyIso(now) ? `de hoy ${hh}` : `del ${fechaCorta(hoyIso(d))}, ${hh}`}.`;
    }
  }
  return [titulo, veredicto, ...s.lineas.map((l) => `• ${l}`), footer].join("\n");
}
