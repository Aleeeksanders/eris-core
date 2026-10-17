// ============================================================
// Eris — leer la cartola del banco (Finanzas 2.0, F4, 2026-10-15)
//
// El teléfono manda el archivo que descargó la persona (Excel .xlsx, CSV o PDF) y acá se convierte en movimientos
// {fecha, desc, monto (+ abono / − cargo), saldo}. No se guarda: se lee en memoria y se responde. La conciliación con
// lo ya anotado la hace el teléfono con el núcleo (FinanceCore.conciliarCartola).
// Sin dependencias: el .xlsx es un zip (zlib de bun) con XML adentro.
//   - PDF (2026-10-16): el texto con su posición (PdfText.ts) y las columnas según la fila de títulos. Un PDF escaneado o
//     protegido no se puede leer: se dice cómo descargarla en Excel.
//   - .xls antiguo (binario): todavía no. Cada banco arma su cartola distinto: el lector busca la fila de títulos
//     (fecha, descripción, cargo/abono o monto, saldo) en vez de suponer columnas.
// ============================================================

import { inflateRawSync } from "zlib";
import { pdfLines, PdfProtegido, type PdfLine } from "./PdfText.js";

export interface MovCartola { fecha: string; desc: string; monto: number; saldo?: number }
export interface Cartola { ok: true; formato: "xlsx" | "csv" | "pdf"; hoja?: string; movimientos: MovCartola[]; desde?: string; hasta?: string; omitidas: number }
export interface CartolaError { ok: false; code: "formato" | "vacia" | "sin_titulos" | "grande" | "clave"; msg: string }

const MAX_BYTES = 6 * 1024 * 1024;

// ─── zip (solo lectura: método 0 o 8) ─────────────────────────────
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // Fin del directorio central: firma 0x06054b50, buscando desde el final
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return out;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (buf.readUInt32LE(local) !== 0x04034b50) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    try {
      if (method === 0) out.set(name, Buffer.from(data));
      else if (method === 8) out.set(name, inflateRawSync(data));
    } catch { /* entrada dañada: se ignora */ }
  }
  return out;
}

// ─── xlsx → filas de texto ────────────────────────────────────────
const xmlText = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

function xlsxRows(files: Map<string, Buffer>): { hoja: string; rows: string[][] } | null {
  const shared: string[] = [];
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf8");
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, "")));
  // La primera hoja según el libro (o la primera que haya)
  const names = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const wb = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const hoja = xmlText(wb.match(/<sheet\b[^>]*name="([^"]*)"/)?.[1] ?? "");
  const sheet = names.length ? files.get(names[0])!.toString("utf8") : null;
  if (!sheet) return null;
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const t = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = "";
      if (t === "s" && v != null) val = shared[Number(v)] ?? "";
      else if (t === "inlineStr") val = xmlText(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
      else if (v != null) val = xmlText(v);
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push("");
      row[idx] = val.trim();
    }
    rows.push(row);
  }
  return { hoja, rows };
}

// ─── csv → filas ──────────────────────────────────────────────────
function csvRows(text: string): string[][] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const sample = lines.slice(0, 20).join("\n");
  const sep = [";", "\t", ","].map((c) => [c, (sample.match(new RegExp(c === "\t" ? "\t" : `\\${c}`, "g")) || []).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  return lines.map((line) => {
    const out: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

// ─── filas → movimientos ──────────────────────────────────────────
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const pad = (n: number) => String(n).padStart(2, "0");

/** "15/10/2026", "15-10-26", "2026-10-15", "15/10" (con el año de referencia), serial de Excel (45945) */
export function parseFecha(raw: string, anioRef: number): string | null {
  const s = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  // "15 OCT 2026", "15-oct-26", "15/Oct"
  if ((m = fold(s).match(/^(\d{1,2})[\s/.-]*(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*\.?(?:[\s/.-]*(\d{2,4}))?(?:\s|$)/))) {
    const mo = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"].indexOf(m[2] === "set" ? "sep" : m[2]) + 1;
    let y = m[3] ? +m[3] : anioRef;
    if (y < 100) y += 2000;
    const d = +m[1];
    if (d < 1 || d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?:\s|$)/))) {
    const d = +m[1], mo = +m[2];
    let y = m[3] ? +m[3] : anioRef;
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial < 36526 || serial > 73051) return null; // 2000–2099
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return null;
}

/** "12.990", "-12.990", "$ 12.990", "(12.990)", "12990,00", "12,990.00" → número; "" → null */
export function parseMonto(raw: string): number | null {
  let s = raw.replace(/\s|\$|clp/gi, "");
  if (!s || s === "-") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");       // 12.990,00
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");                     // 12,990.00
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");                                   // 12990,5
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s));
  return neg ? -n : n;
}

const H = {
  fecha: /^(fecha|fecha (de )?(la )?(operacion|transaccion|movimiento|contable)|dia)$/,
  desc: /(descripcion|detalle|glosa|movimiento|concepto|comercio|transaccion)/,
  cargo: /(cargo|cargos|debito|debitos|egreso|egresos|giros?)( \(?\$?\)?)?$/,
  abono: /(abono|abonos|credito|creditos|ingreso|ingresos|depositos?)( \(?\$?\)?)?$/,
  monto: /^(monto|importe|valor)( \(?\$?\)?)?$/,
  saldo: /^saldo/,
};

export function rowsToMovimientos(rows: string[][], anioRef: number): { movimientos: MovCartola[]; omitidas: number } | null {
  // La fila de títulos: la primera que tiene «fecha» y (cargo/abono o monto)
  let hi = -1, col: Partial<Record<keyof typeof H, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 60) && hi < 0; i++) {
    const f = rows[i].map(fold);
    // Cada columna una sola vez ("Fecha movimiento" es la fecha, no la descripción)
    const used = new Set<number>();
    const find = (re: RegExp) => { const k = f.findIndex((x, j) => !used.has(j) && re.test(x)); if (k >= 0) used.add(k); return k; };
    const fecha = find(H.fecha), saldo = find(H.saldo), cargo = find(H.cargo), abono = find(H.abono), monto = find(H.monto), desc = find(H.desc);
    const c = { fecha, desc, cargo, abono, monto, saldo };
    if (c.fecha >= 0 && (c.cargo >= 0 || c.abono >= 0 || c.monto >= 0)) {
      hi = i;
      col = Object.fromEntries(Object.entries(c).filter(([, v]) => v >= 0));
    }
  }
  if (hi < 0) return null;
  const out: MovCartola[] = [];
  let omitidas = 0;
  for (const r of rows.slice(hi + 1)) {
    const cell = (k: keyof typeof H) => (col[k] != null ? r[col[k]!] ?? "" : "");
    const fecha = parseFecha(cell("fecha"), anioRef);
    if (!fecha) { if (r.some((x) => x)) omitidas++; continue; }
    let monto: number | null = null;
    if (col.cargo != null || col.abono != null) {
      const c = parseMonto(cell("cargo")), a = parseMonto(cell("abono"));
      if (c != null || a != null) monto = (a ? Math.abs(a) : 0) - (c ? Math.abs(c) : 0);
    }
    if (monto == null && col.monto != null) monto = parseMonto(cell("monto"));
    if (monto == null || monto === 0) { omitidas++; continue; }
    const desc = (cell("desc") || "Movimiento").replace(/\s+/g, " ").trim().slice(0, 80);
    if (/^saldo (inicial|anterior|final)/i.test(desc)) continue;
    const saldo = col.saldo != null ? parseMonto(cell("saldo")) : null;
    out.push({ fecha, desc, monto, ...(saldo != null ? { saldo } : {}) });
  }
  return { movimientos: out, omitidas };
}

/**
 * Las líneas del PDF → filas de la tabla, alineadas con la fila de títulos POR POSICIÓN: en un PDF una celda vacía no
 * existe (un cargo sin abono deja un hueco), así que cada trozo de texto va a la columna de título que tiene encima.
 * Una línea sin fecha justo debajo de un movimiento es la continuación de su descripción.
 */
function pdfTabla(lines: PdfLine[]): string[][] | null {
  let cols: Array<{ c: number }> = [];
  let iFecha = -1, iDesc = -1, money: number[] = [];
  const rows: string[][] = [];
  let prev: { row: string[]; y: number; page: number; size: number } | null = null;
  const esTitulo = (f: string[]) => f.some((x) => H.fecha.test(x)) && f.some((x) => H.cargo.test(x) || H.abono.test(x) || H.monto.test(x));
  for (const ln of lines) {
    const f = ln.cells.map((c) => fold(c.text));
    if (esTitulo(f)) {
      // (en cada página se repiten los títulos: se toman de nuevo las posiciones, pero la fila va una vez)
      cols = ln.cells.map((c) => ({ c: (c.x + c.xEnd) / 2 }));
      iFecha = f.findIndex((x) => H.fecha.test(x));
      iDesc = f.findIndex((x, j) => j !== iFecha && H.desc.test(x));
      money = f.map((x, j) => (H.cargo.test(x) || H.abono.test(x) || H.monto.test(x) || H.saldo.test(x) ? j : -1)).filter((j) => j >= 0);
      if (!rows.length) rows.push(ln.cells.map((c) => c.text));
      prev = null;
      continue;
    }
    if (!cols.length) continue;
    const row = cols.map(() => "");
    for (const cell of ln.cells) {
      const center = (cell.x + cell.xEnd) / 2;
      let k = 0;
      for (let j = 1; j < cols.length; j++) if (center > (cols[j - 1].c + cols[j].c) / 2) k = j;
      row[k] = row[k] ? `${row[k]} ${cell.text}` : cell.text;
    }
    const size = Math.max(6, Math.abs(prev?.size ?? 10));
    const sinFecha = iFecha >= 0 && !parseFecha(row[iFecha], 2000);
    const sinPlata = money.every((j) => !row[j]);
    if (prev && sinFecha && sinPlata && iDesc >= 0 && ln.page === prev.page && prev.y - ln.y < size * 2.6) {
      // continuación de la descripción de la línea anterior
      const extra = row.filter((x) => x).join(" ");
      prev.row[iDesc] = `${prev.row[iDesc]} ${extra}`.trim();
      prev.y = ln.y;
      continue;
    }
    rows.push(row);
    prev = sinFecha ? null : { row, y: ln.y, page: ln.page, size };
  }
  return rows.length > 1 ? rows : null;
}

/** El archivo (base64) → movimientos. `nombre` solo ayuda a decir qué formato era. */
/** `clave`: la del PDF, si la pide (la escribe la persona en la app; se usa en memoria y no se guarda). */
export function leerCartola(base64: string, nombre = "", now = new Date(), clave = ""): Cartola | CartolaError {
  let buf: Buffer;
  try { buf = Buffer.from(base64, "base64"); } catch { return { ok: false, code: "formato", msg: "No pude leer el archivo." }; }
  if (buf.length > MAX_BYTES) return { ok: false, code: "grande", msg: "El archivo es muy grande (máximo 6 MB)." };
  if (!buf.length) return { ok: false, code: "vacia", msg: "El archivo está vacío." };
  const head = buf.subarray(0, 8);
  let formato: "xlsx" | "csv" | "pdf", rows: string[][], hoja: string | undefined;
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const x = xlsxRows(unzip(buf));
    if (!x) return { ok: false, code: "formato", msg: "Ese Excel no trae hojas que pueda leer." };
    formato = "xlsx"; rows = x.rows; hoja = x.hoja || undefined;
  } else if (head.toString("latin1").startsWith("%PDF")) {
    let lines: PdfLine[] = [];
    try { lines = pdfLines(buf, clave); } catch (e) {
      if (e instanceof PdfProtegido) return { ok: false, code: "clave", msg: clave ? "Esa clave no abre el PDF. Revísala (muchos bancos usan parte del RUT) o descárgala en Excel o CSV." : "Ese PDF pide clave para abrirse." };
      lines = [];
    }
    if (!lines.length) return { ok: false, code: "formato", msg: "Ese PDF no trae texto que pueda leer (¿es una foto o un escaneo?): descárgala en Excel o CSV desde tu banco." };
    const t = pdfTabla(lines);
    if (!t) return { ok: false, code: "sin_titulos", msg: "No encontré la tabla de movimientos en el PDF (busco columnas como Fecha, Descripción, Cargo/Abono o Monto). Si puedes, descárgala en Excel." };
    formato = "pdf"; rows = t;
  } else if (head[0] === 0xd0 && head[1] === 0xcf) {
    return { ok: false, code: "formato", msg: "Ese es un Excel antiguo (.xls): ábrelo y guárdalo como .xlsx, o descárgala en CSV." };
  } else {
    // Texto: UTF-8, o Latin-1 si trae bytes inválidos (muchos bancos exportan así)
    let text = buf.toString("utf8");
    if (text.includes("�")) text = buf.toString("latin1");
    if (/<html|<table/i.test(text.slice(0, 2000))) {
      // "Excel" que en realidad es una tabla HTML (pasa con algunos bancos)
      rows = [...text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => xmlText(c[1]).replace(/&nbsp;/g, " ").trim()));
    } else rows = csvRows(text);
    formato = "csv";
  }
  const r = rowsToMovimientos(rows, now.getFullYear());
  if (!r) return { ok: false, code: "sin_titulos", msg: `No encontré la tabla de movimientos${nombre ? ` en ${nombre}` : ""} (busco columnas como Fecha, Descripción, Cargo/Abono o Monto).` };
  if (!r.movimientos.length) return { ok: false, code: "vacia", msg: "La cartola no trae movimientos." };
  const fechas = r.movimientos.map((m) => m.fecha).sort();
  return { ok: true, formato, ...(hoja ? { hoja } : {}), movimientos: r.movimientos, desde: fechas[0], hasta: fechas[fechas.length - 1], omitidas: r.omitidas };
}
