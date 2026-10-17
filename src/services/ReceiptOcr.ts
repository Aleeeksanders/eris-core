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
}
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
  /** filas con un precio que no se pudo leer bien (para avisar) */
  dudosas: string[];
}
export interface BoletaError { ok: false; code: "imagen" | "ocr" | "sin_productos" | "grande" | "ocupado"; msg: string }

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ─── Números leídos por OCR ───────────────────────────────────────
/** "1.19O" → "1.190", "I.250" → "1.250", "3 .490" → "3.490" (solo en lo que parece un número) */
export function arreglarNumero(t: string): string | null {
  const s = t.replace(/\s+/g, "");
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
const CANT = /^(\d+(?:[.,]\d+)?)\s*(?:un|u|kg|k|gr|g)?\s*[x*]\s*\$?\s*([\d.,OoIl]+)$/i;

function limpiarDesc(s: string): string {
  let d = s.replace(/^\s*\d{6,14}\s+/, "")                 // código de barras al comienzo
    .replace(/\s+[A-Z]$/, "")                                  // marca de exento/afecto al final
    .replace(/\bI(L|KG|G|ML|CC|UN)\b/g, "1$1")                 // "IL" era "1L"
    .replace(/\s+/g, " ").trim();
  // "LECHE ENTERA 1L" → "Leche Entera 1L" (las medidas con números quedan como venían)
  d = d.split(" ").map((w) => (/\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
  return d.slice(0, 48);
}

export function armarBoleta(o: OcrSalida): BoletaLeida | BoletaError {
  const fs = filas(o);
  if (!fs.length) return { ok: false, code: "ocr", msg: "No pude leer texto en la foto. Sácala con buena luz, derecha y que se vea entera." };
  // El borde derecho de los precios: donde terminan los números que van al final de su fila
  const finales = fs.map((f) => f.toks[f.toks.length - 1]).filter((t) => precioDe(t.t) != null).map((t) => t.xEnd).sort((p, q) => p - q);
  const derecha = finales.length ? finales[Math.floor(finales.length * 0.75)] : Infinity;
  const ancho = Math.max(...fs.flatMap((f) => f.toks.map((t) => t.xEnd))) - Math.min(...fs.flatMap((f) => f.toks.map((t) => t.x)));

  const items: ItemBoleta[] = [];
  const dudosas: string[] = [];
  let total: number | undefined;
  let enProductos = false, cortado = false;
  let cantPend: { cant: number; unit: number } | null = null;
  let descPend: string | null = null;
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
    if (cortado) continue;
    if (precio != null && CORTE.test(fl) && !/\bsub\s?total\b/.test(fl)) {
      // TOTAL (el primero después de los productos); lo demás es el pago
      if (/\btotal\b/.test(fl) && total == null && enProductos) total = Math.abs(precio);
      if (enProductos) cortado = true;
      continue;
    }
    if (precio != null && /\bsub\s?total\b/.test(fl)) continue;
    if (precio != null && (precio < 0 || DESCUENTO.test(fl))) {
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
      if (cantPend && Math.abs(precio - Math.round(cantPend.cant * cantPend.unit)) <= 1) { it.cant = cantPend.cant; it.unit = cantPend.unit; }
      cantPend = null;
      const cat = categoriaProducto(it.desc);
      if (cat) it.cat = cat;
      items.push(it);
      continue;
    }
    // Una fila con texto y sin precio, en medio de los productos: puede ser la descripción cuyo precio viene abajo
    if ((enProductos || /^\d{8,14}\s/.test(label)) && /[a-zA-Z]{3,}/.test(label) && !CORTE.test(fl)) descPend = label;
  }

  if (!items.length) return { ok: false, code: "sin_productos", msg: "No encontré productos con precio en la foto. Sácala derecha, con buena luz y que se vea entera." };
  const suma = items.reduce((s, i) => s + i.monto, 0);
  // Encabezado: comercio, RUT, fecha, hora, folio
  const cab = textoTodo.slice(0, 14).join("\n");
  const rut = cab.match(/\b(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])\b/)?.[1]?.replace(/\./g, "").toUpperCase();
  const fm = textoTodo.join("\n").match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  const fecha = fm ? `${fm[3].length === 2 ? "20" + fm[3] : fm[3]}-${fm[2].padStart(2, "0")}-${fm[1].padStart(2, "0")}` : undefined;
  const hora = textoTodo.join("\n").match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)?.[0];
  const folio = Number(cab.match(/\b(?:boleta[^\n\d]{0,25}|folio\D{0,5}|n[°ºo]?\s?)(\d{4,10})\b/i)?.[1]) || undefined;
  const comercio = textoTodo.slice(0, 4).map((x) => x.trim()).find((x) => /[a-zA-Z]{3,}/.test(x) && !/\brut\b|\bgiro\b|\bboleta\b|\bfecha\b|\d{3,}/i.test(x));
  return {
    ok: true, ...(comercio ? { comercio } : {}), ...(rut ? { rut } : {}), ...(fecha && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(fecha) ? { fecha } : {}),
    ...(hora ? { hora } : {}), ...(folio ? { folio } : {}),
    items, ...(total != null ? { total } : {}), suma, cuadra: total != null && Math.abs(suma - total) <= 1, dudosas,
  };
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
