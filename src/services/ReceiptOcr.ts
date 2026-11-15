// ============================================================
// Eris — leer la foto de la boleta (Finanzas 2.0, F4, 2026-10-16)
//
// La foto llega del teléfono, se lee con el OCR que trae Windows (scripts/ocr.ps1: sin internet, sin descargas) y la
// imagen se borra al terminar. Lo que dice la boleta lo arma ESTE código, no la IA:
//   - se endereza (ángulo del texto) y se rearman las filas por posición (el OCR corta las columnas);
//   - cada fila con un precio a la derecha es un producto; «2 X 1.290» es la cantidad del producto de al lado;
//     un descuento se descuenta del producto anterior; lo de después del TOTAL (efectivo, vuelto, IVA) no son productos;
//   - la suma de los productos se CUADRA contra el TOTAL: si no cuadra, la persona lo ve antes de anotar.
// La categoría de cada producto es una sugerencia (comida por defecto en el súper; aseo → hogar; etc.).
// ============================================================

import { spawn } from "child_process";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { parseMonto } from "./FinanceStatement.js";

export interface OcrWord { t: string; x: number; y: number; w: number; h: number }
export interface OcrSalida { ok: boolean; angle?: number; width?: number; height?: number; lines?: Array<{ text: string; words: OcrWord[] }>; error?: string }

export interface ItemBoleta {
  desc: string;
  /** lo que se pagó por el producto, ya con su descuento */
  monto: number;
  /** el descuento que tuvo (negativo), si tuvo */
  descuento?: number;
  cant?: number; unit?: number;
  /** categoría sugerida; sin ella, la del comercio */
  cat?: string;
  /** el código de barras que la boleta imprime al comienzo de la línea (Jumbo, Lider…), solo si su dígito verificador calza */
  ean?: string;
  /** el precio no se pudo leer: es lo que falta para el total (era el único sin leer) */
  estimado?: boolean;
}
/** Un producto que está en la boleta pero cuyo precio no se pudo leer */
export interface SinPrecio { desc: string; ean?: string; descuento?: number; cant?: number; /** dónde iba entre los productos */ pos: number }
export interface BoletaLeida {
  ok: true;
  /** el nombre que viene arriba ("SUPERMERCADO DEMO") */
  comercio?: string;
  rut?: string; fecha?: string; hora?: string; folio?: number;
  items: ItemBoleta[];
  total?: number;
  /** suma de los productos (con descuentos) */
  suma: number;
  /** la suma calza con el TOTAL (±$1) */
  cuadra: boolean;
  /**
   * Los precios venían SIN IVA (como en una factura: neto + IVA = total) y ya se le sumó a cada producto, para que la
   * suma sea lo que se pagó. En una boleta normal el IVA va incluido y el «NETO / IVA» del pie es solo el desglose.
   */
  ivaAparte?: boolean;
  /** el IVA que se le sumó (solo con ivaAparte) */
  iva?: number;
  /** productos que están en la boleta pero sin precio legible (van al inventario igual; la plata, a «sin leer») */
  sinPrecio?: Array<{ desc: string; ean?: string; cant?: number }>;
  /** filas con un precio que no se pudo leer bien (para avisar) */
  dudosas: string[];
}
export interface BoletaError { ok: false; code: "imagen" | "ocr" | "sin_productos" | "grande" | "ocupado"; msg: string }

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ─── Números leídos por OCR ───────────────────────────────────────
/** "1.19O" → "1.190", "I.250" → "1.250", "3 .490" → "3.490" (solo en lo que parece un número) */
export function arreglarNumero(t: string): string | null {
  // «5-'300»: el punto de miles leído como guion o apóstrofo (boleta real del Jumbo, 2026-11-15)
  const s = t.replace(/\s+/g, "").replace(/(\d)[-'’`´]{1,2}(?=\d{3}$)/, "$1.");
  if (!/^[-$]?[\dOoDQIl|SBZ.,$-]+$/.test(s) || !/\d/.test(s)) return null;
  const letras = (s.match(/[OoDQIl|SBZ]/g) || []).length, digitos = (s.match(/\d/g) || []).length;
  if (letras > digitos) return null;
  return s.replace(/[OoDQ]/g, "0").replace(/[Il|]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");
}
const PRECIO = /^-?\$?(?:\d{1,3}(?:[.,]\d{3})+|\d{1,7})-?$/;
function precioDe(t: string): number | null {
  const s = arreglarNumero(t);
  if (!s || !PRECIO.test(s)) return null;
  const n = parseMonto(s.replace(/^\$/, "").replace(/^(-?)\$/, "$1"));
  return n == null ? null : n;
}

// ─── Filas por posición ───────────────────────────────────────────
interface Tok { t: string; x: number; xEnd: number; cy: number; h: number }
interface Fila { cy: number; toks: Tok[] }

function filas(o: OcrSalida): Fila[] {
  const words = (o.lines ?? []).flatMap((l) => l.words ?? []);
  if (!words.length) return [];
  // (las posiciones que da el OCR de Windows ya vienen enderezadas según el ángulo del texto: comprobado con una foto girada 4°)
  const toks: Tok[] = words.map((w) => ({ t: w.t, x: w.x, xEnd: w.x + w.w, cy: w.y + w.h / 2, h: w.h })).sort((p, q) => p.cy - q.cy);
  const hs = toks.map((t) => t.h).sort((p, q) => p - q), h = hs[Math.floor(hs.length / 2)] || 10;
  const out: Fila[] = [];
  for (const t of toks) {
    const f = out.find((r) => Math.abs(r.cy - t.cy) < h * 0.55);
    if (f) { f.toks.push(t); f.cy = (f.cy * (f.toks.length - 1) + t.cy) / f.toks.length; }
    else out.push({ cy: t.cy, toks: [t] });
  }
  for (const f of out) {
    f.toks.sort((p, q) => p.x - q.x);
    // "30 . 000", "1. 980": trozos de un mismo número separados por el OCR
    const m: Tok[] = [];
    for (const t of f.toks) {
      const last = m[m.length - 1];
      const num = (s: string) => /^[-$]?[\dOoIl.,]+$/.test(s) && /[\d.,]/.test(s);
      if (last && num(last.t) && num(t.t) && t.x - last.xEnd < h * 0.7 && (/[.,]$/.test(last.t) || /^[.,]/.test(t.t) || t.t === "." || last.t === ".")) {
        last.t += t.t; last.xEnd = t.xEnd;
      } else m.push({ ...t });
    }
    f.toks = m;
  }
  return out.sort((p, q) => p.cy - q.cy);
}

// ─── Qué es cada fila ─────────────────────────────────────────────
const CORTE = /\b(total|neto|iva|efectivo|vuelto|cambio|tarjeta|debito|credito|redcompra|donacion|redondeo|propina|forma de pago|monto pagado|pagado|recibido)\b/;
const DESCUENTO = /\b(desc\w*|dcto\w*|dscto\w*|ahorro|oferta|promo\w*|rebaja|cupon\w*|convenio)\b/;
// «2 X $2.650»; también «2 $2.650» (la X que el OCR no leyó: el $ dice que lo de al lado es el precio unitario)
const CANT = /^(\d+(?:[.,]\d+)?)\s*(?:un|u|kg|k|gr|g)?\s*(?:[x*]\s*\$?|\$)\s*([\d.,OoIl]+)$/i;

/** ¿Es un código de barras real? (EAN-13, EAN-8, UPC-A o GTIN-14: el último dígito verifica a los demás; así un código mal leído no se guarda) */
export function eanValido(c: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(c) || /^0+$/.test(c)) return false;
  const d = c.split("").map(Number), chk = d.pop()!;
  const s = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (s % 10)) % 10 === chk;
}

function limpiarDesc(s: string): string {
  let d = s.replace(/^\s*\d{6,14}\s+/, "")                 // código de barras al comienzo
    .replace(/\s+[A-Z]$/, "")                                  // marca de exento/afecto al final
    .replace(/\b[Il](L|LT|KG|G|ML|CC|UN)\b/g, "1$1")           // "IL", "ILT" eran "1L", "1LT"
    .replace(/[-'’`´]+(?=\s|$)/g, "")                           // "li-": basura del OCR al final de una palabra
    .replace(/\s+/g, " ").trim();
  // "LECHE ENTERA 1L" → "Leche Entera 1L" (las medidas con números quedan como venían)
  d = d.split(" ").map((w) => (/\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
  return d.slice(0, 48);
}

/** `hoy` («2026-11-15», el día del PC por defecto): una fecha posterior en la boleta es un dígito mal leído. */
export function armarBoleta(o: OcrSalida, hoy: string = hoyLocal()): BoletaLeida | BoletaError {
  const fs = filas(o);
  if (!fs.length) return { ok: false, code: "ocr", msg: "No pude leer texto en la foto. Sácala con buena luz, derecha y que se vea entera." };
  // El borde derecho de los precios: donde terminan los números que van al final de su fila
  const finales = fs.map((f) => f.toks[f.toks.length - 1]).filter((t) => precioDe(t.t) != null).map((t) => t.xEnd).sort((p, q) => p - q);
  const derecha = finales.length ? finales[Math.floor(finales.length * 0.75)] : Infinity;
  const ancho = Math.max(...fs.flatMap((f) => f.toks.map((t) => t.xEnd))) - Math.min(...fs.flatMap((f) => f.toks.map((t) => t.x)));

  const items: ItemBoleta[] = [];
  const dudosas: string[] = [];
  let total: number | undefined, neto: number | undefined, iva: number | undefined;
  let enProductos = false, cortado = false;
  let cantPend: { cant: number; unit: number } | null = null;
  let descPend: string | null = null;
  // Productos cuyo precio no se pudo leer («5.aoo»): existen, con su código; el precio se calcula con el total si falta uno solo
  const sinPrecio: SinPrecio[] = [];
  let spUltimo: SinPrecio | null = null;
  const textoTodo = fs.map((f) => f.toks.map((t) => t.t).join(" "));
  // El margen izquierdo (para reconocer la continuación sangrada de una descripción) y el alto de la letra
  const margen = Math.min(...fs.map((f) => f.toks[0]?.x ?? Infinity));
  const hMed = fs.flatMap((f) => f.toks.map((t) => t.h)).sort((p, q) => p - q)[Math.floor(fs.length / 2)] || 10;

  for (const f of fs) {
    const last = f.toks[f.toks.length - 1];
    const enBorde = last && Math.abs(last.xEnd - derecha) < ancho * 0.12;
    const precio = last && enBorde ? precioDe(last.t) : null;
    const resto = precio != null ? f.toks.slice(0, -1) : f.toks;
    const label = resto.map((t) => t.t).join(" ").replace(/\$\s*$/, "").trim();
    const fl = fold(label);
    const todo = f.toks.map((t) => t.t).join(" ").trim();

    // «2 X 1.290»: cantidad × precio unitario (va con el producto de al lado)
    const cq = todo.match(CANT);
    if (cq && !/[a-z]{3,}/i.test(todo.replace(/\b(un|kg|gr)\b/gi, ""))) {
      const cant = Number(cq[1].replace(",", ".")), unit = precioDe(cq[2]);
      if (cant > 0 && unit) {
        const prev = items[items.length - 1];
        if (prev && !prev.cant && Math.abs(prev.monto - Math.round(cant * unit)) <= 1) { prev.cant = cant; prev.unit = unit; }
        else cantPend = { cant, unit };
      }
      continue;
    }
    // El pie, después de los productos: NETO, IVA y TOTAL se leen todos (antes se cortaba en el primero y en la boleta del
    // Jumbo «NETO» va antes que «TOTAL»: el total no se leía, 2026-11-15); lo demás (débito, efectivo, vuelto) es el pago
    const pie = () => {
      if (precio == null) return;
      const v = Math.abs(precio);
      if (/\biva\b/.test(fl)) { if (iva == null && !/exent/.test(fl)) iva = v; }
      else if (/\b(neto|afecto)\b/.test(fl)) { if (neto == null) neto = v; }
      else if (/\btotal\b/.test(fl) && !/exent|ahorr|desc|dcto|punto/.test(fl)) { if (total == null) total = v; }
    };
    if (cortado) { pie(); continue; }
    if (precio != null && CORTE.test(fl) && !/\bsub\s?total\b/.test(fl)) {
      if (enProductos) { pie(); cortado = true; }
      continue;
    }
    if (precio != null && /\bsub\s?total\b/.test(fl)) continue;
    // «DESCUENTOS $ 2.020», «TOTAL AHORRO»: el resumen de los descuentos que ya se restaron a cada producto (suma lo mismo), no uno nuevo
    const descHechos = items.reduce((a, i) => a + Math.abs(i.descuento ?? 0), 0);
    if (precio != null && precio > 0 && descHechos > 0 && Math.abs(precio - descHechos) <= 1 && /\b(desc\w*|dcto\w*|dscto\w*|ahorr\w*)\b/.test(fl)) continue;
    if (precio != null && (precio < 0 || DESCUENTO.test(fl))) {
      // va con el producto de arriba, aunque a ese no se le haya podido leer el precio
      if (spUltimo) { spUltimo.descuento = (spUltimo.descuento ?? 0) - Math.abs(precio); continue; }
      const prev = items[items.length - 1];
      if (prev) { prev.descuento = (prev.descuento ?? 0) - Math.abs(precio); prev.monto -= Math.abs(precio); }
      continue;
    }
    if (precio != null) {
      let desc = label;
      // La descripción empezó en la fila de arriba (sin precio) y el precio quedó en esta: se juntan
      if (descPend && (!/[a-zA-ZÁÉÍÓÚÑáéíóúñ]{2,}/.test(desc) || (resto[0] && resto[0].x > margen + hMed * 1.2))) desc = /[a-zA-Z]{2,}/.test(desc) ? `${descPend} ${desc}` : descPend;
      descPend = null;
      if (!/[a-zA-ZÁÉÍÓÚÑáéíóúñ]{2,}/.test(desc)) { if (enProductos) dudosas.push(todo); continue; }
      enProductos = true;
      const it: ItemBoleta = { desc: limpiarDesc(desc), monto: precio };
      // El código de barras al comienzo de la línea: con él, el Inventario reconoce el producto como si lo escanearas
      const ean = desc.match(/^\s*(\d{8,14})\s/)?.[1];
      if (ean && eanValido(ean)) it.ean = ean;
      if (cantPend && Math.abs(precio - Math.round(cantPend.cant * cantPend.unit)) <= 1) { it.cant = cantPend.cant; it.unit = cantPend.unit; }
      cantPend = null;
      const cat = categoriaProducto(it.desc);
      if (cat) it.cat = cat;
      items.push(it);
      spUltimo = null;
      continue;
    }
    // Una fila de producto con el precio ilegible («LECHE PRO CAPPU 5.aoo»): el producto existe y su código de barras también
    if (last && enBorde && f.toks.length > 1 && /^[-$]?\d/.test(last.t) && !/[a-z]{4,}/i.test(last.t) && (/[.,]/.test(last.t) || last.t.length >= 4)) {
      const lab = f.toks.slice(0, -1).map((t) => t.t).join(" ").trim();
      if (/[a-zA-Z]{3,}/.test(lab) && !CORTE.test(fold(lab)) && (enProductos || /^\d{8,14}\s/.test(lab))) {
        const sp: SinPrecio = { desc: limpiarDesc(lab), pos: items.length };
        const e = lab.match(/^\s*(\d{8,14})\s/)?.[1];
        if (e && eanValido(e)) sp.ean = e;
        if (cantPend) sp.cant = cantPend.cant; // «2 X $2.650» de arriba: cuántos son (para el inventario)
        sinPrecio.push(sp); spUltimo = sp; dudosas.push(todo);
        descPend = null; cantPend = null; enProductos = true;
        continue;
      }
    }
    // Una fila con texto y sin precio, en medio de los productos: puede ser la descripción cuyo precio viene abajo
    if ((enProductos || /^\d{8,14}\s/.test(label)) && /[a-zA-Z]{3,}/.test(label) && !CORTE.test(fl)) descPend = label;
  }

  if (!items.length) return { ok: false, code: "sin_productos", msg: "No encontré productos con precio en la foto. Sácala derecha, con buena luz y que se vea entera." };
  const suma = items.reduce((s, i) => s + i.monto, 0);
  // Encabezado: comercio, RUT, fecha, hora, folio
  const cab = textoTodo.slice(0, 14).join("\n");
  const rut = cab.match(/\b(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])\b/)?.[1]?.replace(/\./g, "").toUpperCase();
  // La fecha de la compra: no la de los puntos («saldo de puntos al 13-11», «por vencer al 01-12») ni una que aún no llega
  const conFecha = textoTodo.filter((x) => !/punto|venc|saldo|valid|hasta|desde/i.test(fold(x))).join("\n");
  const valida = (f?: string) => (f && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(f) && f <= hoy ? f : undefined);
  const fm = conFecha.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  // Una fecha que todavía no llega es un dígito mal leído («16/11» por «15/11»): entonces, la del número largo de abajo
  // (el Jumbo imprime «20261115…» bajo su código de barras)
  const larga = conFecha.match(/\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{6,}\b/);
  const fecha = valida(fm ? `${fm[3].length === 2 ? "20" + fm[3] : fm[3]}-${fm[2].padStart(2, "0")}-${fm[1].padStart(2, "0")}` : undefined)
    ?? valida(larga ? `${larga[1]}-${larga[2]}-${larga[3]}` : undefined);
  const hora = textoTodo.join("\n").match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)?.[0];
  const folio = Number(cab.match(/\b(?:boleta[^\n\d]{0,25}|folio\D{0,5}|n[°ºo]?\s?)(\d{4,10})\b/i)?.[1]) || undefined;
  // El nombre de arriba (sin la oficina del SII que la boleta del Jumbo imprime antes que «CENCOSUD RETAIL S.A.»)
  const comercio = textoTodo.slice(0, 5).map((x) => x.trim())
    .find((x) => /[a-zA-Z]{3,}/.test(x) && !/\brut\b|\bgiro\b|\bboleta\b|\bfecha\b|^s[.\s]?[i1l][.\s]?[i1l]\b|\d{3,}/i.test(x));
  // ¿Precios sin IVA (neto + IVA = total)? Entonces se le suma a cada producto, para que la suma sea lo que se pagó
  const aparte = !sinPrecio.length && ivaAparte({ suma, iva, neto, total, n: items.length });
  const pagado = aparte ? total ?? suma + (iva ?? Math.round(suma * 0.19)) : null;
  let its = pagado != null ? sumarIva(items, pagado) : items;
  // Un solo producto sin precio legible y el total sí se leyó: su precio es lo que falta (si es un precio razonable)
  let faltan = sinPrecio;
  const dif = total != null ? total - suma : 0;
  if (pagado == null && sinPrecio.length === 1 && dif > 0 && dif <= (3 * suma) / Math.max(1, items.length)) {
    const sp = sinPrecio[0];
    const it: ItemBoleta = { desc: sp.desc, monto: dif, estimado: true, ...(sp.cant ? { cant: sp.cant } : {}), ...(sp.ean ? { ean: sp.ean } : {}), ...(sp.descuento ? { descuento: sp.descuento } : {}) };
    const cat = categoriaProducto(it.desc);
    if (cat) it.cat = cat;
    its = [...its.slice(0, sp.pos), it, ...its.slice(sp.pos)];
    faltan = [];
  }
  const suma2 = its.reduce((s, i) => s + i.monto, 0);
  // Un número suelto que es el NETO, el IVA o el TOTAL (su etiqueta no se leyó) no es una línea dudosa
  const delPie = [total, neto, iva, total != null ? Math.round(total / 1.19) : undefined].filter((v): v is number => v != null);
  const dudosas2 = dudosas.filter((d) => { const v = /^[\d.,$\s]+$/.test(d) ? parseMonto(d.replace(/[$\s]/g, "")) : null; return v == null || !delPie.some((x) => Math.abs(x - v) <= 2); });
  const total2 = total ?? (pagado != null && (iva != null || neto != null) ? pagado : undefined);
  return {
    ok: true, ...(comercio ? { comercio } : {}), ...(rut ? { rut } : {}), ...(fecha ? { fecha } : {}),
    ...(hora ? { hora } : {}), ...(folio ? { folio } : {}),
    items: its, ...(total2 != null ? { total: total2 } : {}), suma: suma2, cuadra: total2 != null && Math.abs(suma2 - total2) <= 1, dudosas: dudosas2,
    ...(pagado != null ? { ivaAparte: true, iva: pagado - suma } : {}),
    ...(faltan.length ? { sinPrecio: faltan.map(({ desc, ean, cant }) => ({ desc, ...(ean ? { ean } : {}), ...(cant ? { cant } : {}) })) } : {}),
  };
}

/** Hoy en el reloj del PC (Chile), «2026-11-15» */
function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * ¿Los precios de los productos vienen SIN IVA? En Chile la boleta los trae con IVA y el «NETO / IVA» del pie es solo el
 * desglose del total (la del Jumbo: productos $29.480 = TOTAL; neto $24.772 + IVA $4.708 = lo mismo). Sin IVA viene una
 * factura o algún comercio: ahí la suma de los productos es el neto y el total es neto + IVA (19 %).
 */
export function ivaAparte(x: { suma: number; iva?: number; neto?: number; total?: number; n: number }): boolean {
  const { suma, iva, neto, total } = x;
  if (!(suma > 0)) return false;
  const tol = Math.max(3, x.n);
  const cerca = (a: number, b: number) => Math.abs(a - b) <= tol;
  if (total != null && Math.abs(suma - total) <= 1) return false; // cuadra: el IVA ya va adentro
  if (iva != null) {
    if (cerca(iva, (suma * 19) / 119) && !cerca(iva, suma * 0.19)) return false; // «IVA incluido: $X»
    if (total != null) return cerca(suma + iva, total);
    if (neto != null) return cerca(neto, suma) && cerca(iva, suma * 0.19);
    return cerca(iva, suma * 0.19);
  }
  // Sin la línea del IVA (no se leyó): el total es justo el neto + 19 %
  return total != null && cerca(Math.round(suma * 1.19), total) && (neto == null || cerca(neto, suma));
}

/** Le suma el IVA a cada producto en proporción, para que sumen lo pagado (lo que sobra por redondeo, al más caro). */
export function sumarIva<T extends { monto: number; unit?: number; descuento?: number }>(items: T[], pagado: number): T[] {
  const suma = items.reduce((s, i) => s + i.monto, 0);
  if (!(suma > 0)) return items;
  const k = pagado / suma;
  const out = items.map((it) => ({ ...it, monto: Math.round(it.monto * k), ...(it.unit ? { unit: Math.round(it.unit * k) } : {}), ...(it.descuento ? { descuento: Math.round(it.descuento * k) } : {}) }));
  const dif = pagado - out.reduce((s, i) => s + i.monto, 0);
  if (dif) { let m = 0; out.forEach((it, i) => { if (it.monto > out[m].monto) m = i; }); out[m] = { ...out[m], monto: out[m].monto + dif }; }
  return out;
}

// ─── Categoría sugerida de cada producto ──────────────────────────
// En el súper casi todo es comida (la categoría del comercio); acá solo lo que NO lo es.
const CAT_PRODUCTO: Array<[string, RegExp]> = [
  ["hogar", /\b(deterg\w*|lavaloza\w*|lavavaj\w*|cloro|confort|papel hig\w*|p\.? ?hig\w*|toalla(s)? (de )?papel|toalla nova|nova|servillet\w*|limpia\w*|desinfect\w*|lysoform|esponja\w*|bolsa(s)? (de )?basura|suaviz\w*|quix|omo|ariel|poett|cif|pato|ampolleta\w*|pila(s)?|insectic\w*|raid|fosforo\w*|vela(s)?|alusa|aluminio|film|shampoo|champu|acondic\w*|jabon\w*|pasta dent\w*|cepillo dent\w*|desodor\w*|panal\w*|toalla(s)? hig\w*|protector(es)? diario|afeitad\w*|gillette|colgate|dove|rexona|nivea|huggies|babysec|pampers|elite)\b/],
  ["salud", /\b(paracetamol|ibuprofeno|aspirina|tapsin|kitadol|zyrtec|loratadina|omeprazol|vitamina\w*|suplement\w*|parche(s)? curit\w*|curita(s)?|alcohol gel|termometro|mascarilla\w*|preservativ\w*)\b/],
  ["entretenimiento", /\b(cerv\w*|vino|vinos|pisco|ron|whisky|vodka|gin|espumante|champagne|tequila|fernet|cristal|escudo|becker|heineken|corona|kunstmann|royal guard|austral|stella|budweiser|cigarr\w*)\b/],
  ["otros", /\b(dog ?chow|cat ?chow|master ?dog|master ?cat|champion|purina|pedigree|whiskas|arena (para )?gato|alimento (para )?(perro|gato|mascota)\w*)\b/],
];
export function categoriaProducto(desc: string): string | undefined {
  const f = fold(desc);
  for (const [cat, re] of CAT_PRODUCTO) if (re.test(f)) return cat;
  return undefined;
}

// ─── La foto → el OCR de Windows ──────────────────────────────────
const MAX_BYTES = 9 * 1024 * 1024;
let ocupado = false;
const SCRIPT = join(import.meta.dir, "..", "..", "scripts", "ocr.ps1");

function correrOcr(path: string, timeoutMs = 45_000): Promise<OcrSalida> {
  return new Promise((resolve) => {
    const p = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Path", path], { windowsHide: true });
    let out = "";
    const timer = setTimeout(() => { try { p.kill(); } catch {} resolve({ ok: false, error: "tiempo" }); }, timeoutMs);
    p.stdout.on("data", (d) => { out += d.toString("utf8"); });
    p.on("close", () => { clearTimeout(timer); try { resolve(JSON.parse(out)); } catch { resolve({ ok: false, error: "salida" }); } });
    p.on("error", () => { clearTimeout(timer); resolve({ ok: false, error: "powershell" }); });
  });
}

/** La foto (base64, JPEG o PNG) → la boleta. La imagen se guarda un momento en una carpeta temporal y se borra al terminar. */
export async function leerBoletaFoto(base64: string, run: (path: string) => Promise<OcrSalida> = correrOcr): Promise<BoletaLeida | BoletaError> {
  let buf: Buffer;
  try { buf = Buffer.from(base64, "base64"); } catch { return { ok: false, code: "imagen", msg: "No pude abrir la foto." }; }
  if (buf.length > MAX_BYTES) return { ok: false, code: "grande", msg: "La foto es muy pesada." };
  const jpg = buf[0] === 0xff && buf[1] === 0xd8, png = buf[0] === 0x89 && buf[1] === 0x50;
  if (!jpg && !png) return { ok: false, code: "imagen", msg: "Eso no parece una foto (JPEG o PNG)." };
  if (ocupado) return { ok: false, code: "ocupado", msg: "Estoy leyendo otra boleta: intenta en unos segundos." };
  ocupado = true;
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "eris-boleta-"));
    const path = join(dir, jpg ? "boleta.jpg" : "boleta.png");
    await writeFile(path, buf);
    const o = await run(path);
    if (!o.ok) return { ok: false, code: "ocr", msg: "No pude leer la foto en el PC (el lector de texto de Windows falló)." };
    return armarBoleta(o);
  } finally {
    ocupado = false;
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Eris administra (A2): el saldo de una captura de la app del banco ─────────────────────────
// Para cuadrar: la persona sube una captura de su banco y vuelven SOLO los saldos que muestra (y los 4 dígitos de la cuenta,
// para elegirla). Se aceptan las líneas que dicen «saldo» o «disponible» (no la línea de crédito ni el cupo).

export interface SaldosCaptura { ok: true; saldos: Array<{ etiqueta: string; monto: number }>; last4: string[] }

export function armarSaldos(o: OcrSalida): SaldosCaptura | BoletaError {
  const lines = (o.lines ?? []).map((l) => String(l.text ?? "").trim()).filter(Boolean);
  const out: Array<{ etiqueta: string; monto: number; orden: number }> = [];
  const ORDEN: Record<string, number> = { "Saldo disponible": 0, "Saldo": 1, "Saldo contable": 2 };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/\$\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,})(?![\d.,]*%)/);
    if (!m || /-\s?\$/.test(l)) continue;
    const v = Number(m[1].replace(/[.,]/g, ""));
    if (!(v >= 0) || v > 10_000_000_000) continue;
    const antes = fold(l.slice(0, m.index ?? 0)).trim();
    const label = antes || fold(lines[i - 1] ?? "");
    if (/linea|cupo|credito|deuda|pagar|minimo|facturado/.test(label)) continue;
    const etiqueta = /disponible/.test(label) ? "Saldo disponible" : /contable/.test(label) ? "Saldo contable" : /\bsaldo\b/.test(label) ? "Saldo" : null;
    if (!etiqueta || out.some((x) => x.monto === v && x.etiqueta === etiqueta)) continue;
    out.push({ etiqueta, monto: v, orden: ORDEN[etiqueta] });
  }
  const last4 = [...new Set(lines.flatMap((l) => [...l.matchAll(/(?:\*+|x{2,}|n[°º]\s?)\s?(\d{4})\b/gi)].map((x) => x[1])))].slice(0, 4);
  if (!out.length) return { ok: false, code: "sin_productos", msg: "No encontré un saldo en la captura: escríbelo tú." };
  return { ok: true, saldos: out.sort((a, b) => a.orden - b.orden).slice(0, 5).map(({ etiqueta, monto }) => ({ etiqueta, monto })), last4 };
}

/** La captura (base64, JPEG o PNG) → los saldos. La imagen se guarda un momento en una carpeta temporal y se borra al terminar. */
export async function leerSaldoCaptura(base64: string, run: (path: string) => Promise<OcrSalida> = correrOcr): Promise<SaldosCaptura | BoletaError> {
  let buf: Buffer;
  try { buf = Buffer.from(base64, "base64"); } catch { return { ok: false, code: "imagen", msg: "No pude abrir la captura." }; }
  if (buf.length > MAX_BYTES) return { ok: false, code: "grande", msg: "La imagen es muy pesada." };
  const jpg = buf[0] === 0xff && buf[1] === 0xd8, png = buf[0] === 0x89 && buf[1] === 0x50;
  if (!jpg && !png) return { ok: false, code: "imagen", msg: "Eso no parece una imagen (JPEG o PNG)." };
  if (ocupado) return { ok: false, code: "ocupado", msg: "Estoy leyendo otra imagen: intenta en unos segundos." };
  ocupado = true;
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "eris-saldo-"));
    const path = join(dir, jpg ? "saldo.jpg" : "saldo.png");
    await writeFile(path, buf);
    const o = await run(path);
    if (!o.ok) return { ok: false, code: "ocr", msg: "No pude leer la captura en el PC (el lector de texto de Windows falló)." };
    return armarSaldos(o);
  } finally {
    ocupado = false;
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
