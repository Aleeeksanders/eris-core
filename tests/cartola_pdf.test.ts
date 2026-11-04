// La cartola en PDF: texto con posición (PdfText) → tabla por columnas (FinanceStatement). PDFs sintéticos con la forma
// de los que generan los bancos: uno simple (Helvetica, sin comprimir) y uno «difícil» (Flate, fuente Type0 con
// ToUnicode, objetos dentro de un object stream, cm, TJ con ajustes, dos páginas con los títulos repetidos).
import { test, expect } from "bun:test";
import { deflateSync } from "zlib";
import { pdfLines } from "C:/Proyectos/eris/src/services/PdfText.ts";
import { leerCartola } from "C:/Proyectos/eris/src/services/FinanceStatement.ts";

const NOW = new Date(2026, 9, 16, 9);

/** Arma un PDF con los objetos dados (num → cuerpo), sin xref (el lector recorre los objetos). */
function pdf(objs: Array<[number, string | Buffer]>): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.5\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  for (const [n, body] of objs) parts.push(Buffer.from(`${n} 0 obj\n`), Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"), Buffer.from("\nendobj\n"));
  parts.push(Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n"));
  return Buffer.concat(parts);
}
const stream = (dict: string, data: Buffer) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, Buffer.from("\nendstream")]);
// Texto en Helvetica: x a la izquierda; para alinear a la derecha se resta ~0,5 em por carácter (lo que estima el lector)
const t = (x: number, y: number, s: string, size = 9) => `BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET\n`;
const r = (xr: number, y: number, s: string, size = 9) => t(xr - s.length * size * 0.5, y, s, size);

test("PDF simple: columnas por posición, celdas vacías, descripción en dos líneas, acentos", () => {
  let c = "";
  c += t(40, 760, "BANCO EJEMPLO - CARTOLA CUENTA CORRIENTE N\\260 12345", 11);
  c += t(40, 740, "Periodo: 01/10/2026 al 15/10/2026");
  c += t(40, 700, "Fecha") + t(110, 700, "Descripci\\363n") + r(370, 700, "Cargos") + r(460, 700, "Abonos") + r(550, 700, "Saldo");
  c += t(40, 684, "03/10/2026") + t(110, 684, "COMPRA FARMACIA CRUZ VERDE") + r(370, 684, "5.990") + r(550, 684, "94.010");
  c += t(40, 672, "04/10/2026") + t(110, 672, "TRANSFERENCIA DE EMPRESA SPA") + r(460, 672, "1.200.000") + r(550, 672, "1.294.010");
  c += t(40, 660, "05/10/2026") + t(110, 660, "PAGO EN LIDER EXPRESS") + r(370, 660, "12.990") + r(550, 660, "1.281.020");
  c += t(110, 650, "SANTIAGO CENTRO");
  c += t(40, 638, "07/10/2026") + t(110, 638, "PAGO AUTOM\\301TICO ENEL") + r(370, 638, "38.400") + r(550, 638, "1.242.620");
  c += t(250, 60, "P\\341gina 1 de 1");
  const buf = pdf([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 4 0 R >> >> >>"],
    [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>"],
    [4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"],
    [5, stream("", Buffer.from(c, "latin1"))],
  ]);
  const lines = pdfLines(buf);
  expect(lines[0].cells[0].text).toBe("BANCO EJEMPLO - CARTOLA CUENTA CORRIENTE N° 12345");
  const res = leerCartola(buf.toString("base64"), "cartola.pdf", NOW);
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.formato).toBe("pdf");
  expect(res.movimientos).toEqual([
    { fecha: "2026-10-03", desc: "COMPRA FARMACIA CRUZ VERDE", monto: -5990, saldo: 94010 },
    { fecha: "2026-10-04", desc: "TRANSFERENCIA DE EMPRESA SPA", monto: 1200000, saldo: 1294010 },
    { fecha: "2026-10-05", desc: "PAGO EN LIDER EXPRESS SANTIAGO CENTRO", monto: -12990, saldo: 1281020 },
    { fecha: "2026-10-07", desc: "PAGO AUTOMÁTICO ENEL", monto: -38400, saldo: 1242620 },
  ]);
});

test("PDF «difícil»: Flate, Type0 + ToUnicode, object stream, cm, TJ, fechas con mes en letras, 2 páginas", () => {
  // Fuente compuesta: cada carácter es un código de 2 bytes = su código Unicode + 100 (solo el ToUnicode lo traduce)
  const enc = (s: string) => "<" + [...s].map((ch) => (ch.charCodeAt(0) + 100).toString(16).padStart(4, "0")).join("") + ">";
  const used = new Set<string>();
  const T = (x: number, y: number, s: string) => { for (const ch of s) used.add(ch); return `BT /F2 9 Tf 1 0 0 1 ${x} ${y} Tm ${enc(s)} Tj ET\n`; };
  // TJ con ajustes: las palabras separadas por un ajuste grande (−250 = espacio)
  const TJ = (x: number, y: number, words: string[]) => { for (const w of words) for (const ch of w) used.add(ch); return `BT /F2 9 Tf ${x} ${y} Td [${words.map(enc).join(" -250 ")}] TJ ET\n`; };
  const R = (xr: number, y: number, s: string) => T(xr - s.length * 4.5, y, s);
  // cm: todo el contenido va escalado ×2 dentro de un q … Q (el lector multiplica por la matriz)
  const page = (rows: string) => Buffer.from(`q 0.5 0 0 0.5 0 0 cm\n${rows}Q\n`, "latin1");
  const head = (y: number) => T(80, y, "Fecha") + T(220, y, "Detalle del movimiento") + R(740, y, "Cargos") + R(920, y, "Abonos") + R(1100, y, "Saldo");
  const p1 = page(head(1400) + T(80, 1370, "02 OCT 2026") + TJ(220, 1370, ["UBER", "TRIP"]) + R(740, 1370, "4.300") + R(1100, 1370, "500.000")
    + T(80, 1346, "09 OCT 2026") + T(220, 1346, "SUSHI BLUES ÑUÑOA") + R(740, 1346, "18.900") + R(1100, 1346, "481.100"));
  const p2 = page(head(1400) + T(80, 1370, "12 OCT 2026") + T(220, 1370, "DEPÓSITO") + R(920, 1370, "50.000") + R(1100, 1370, "531.100"));
  // ToUnicode con bfrange para todo el rango usado
  const codes = [...used].map((ch) => ch.charCodeAt(0)).sort((a, b) => a - b);
  const ranges = codes.map((u) => `<${(u + 100).toString(16).padStart(4, "0")}> <${(u + 100).toString(16).padStart(4, "0")}> <${u.toString(16).padStart(4, "0")}>`).join("\n");
  const cmap = Buffer.from(`/CIDInit /ProcSet findresource begin\nbegincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${codes.length} beginbfrange\n${ranges}\nendbfrange\nendcmap\n`, "latin1");
  // La fuente y las páginas van dentro de un object stream comprimido
  const inner: Array<[number, string]> = [
    [2, "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>"],
    [3, "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F2 6 0 R >> >> /Contents 10 0 R >>"],
    [4, "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F2 6 0 R >> >> /Contents 11 0 R >>"],
    [6, "<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Arial /Encoding /Identity-H /ToUnicode 7 0 R >>"],
  ];
  let offs = "", body = "";
  for (const [n, o] of inner) { offs += `${n} ${body.length} `; body += o + "\n"; }
  const objstm = Buffer.from(offs + body, "latin1");
  const buf = pdf([
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [7, stream("/Filter /FlateDecode", deflateSync(cmap))],
    [9, stream(`/Type /ObjStm /N ${inner.length} /First ${offs.length} /Filter /FlateDecode`, deflateSync(objstm))],
    [10, stream("/Filter /FlateDecode", deflateSync(p1))],
    [11, stream("/Filter /FlateDecode", deflateSync(p2))],
  ]);
  const res = leerCartola(buf.toString("base64"), "cartola.pdf", NOW);
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.movimientos).toEqual([
    { fecha: "2026-10-02", desc: "UBER TRIP", monto: -4300, saldo: 500000 },
    { fecha: "2026-10-09", desc: "SUSHI BLUES ÑUÑOA", monto: -18900, saldo: 481100 },
    { fecha: "2026-10-12", desc: "DEPÓSITO", monto: 50000, saldo: 531100 },
  ]);
});

test("PDF protegido o escaneado: se explica qué hacer", () => {
  const prot = Buffer.from("%PDF-1.6\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF", "latin1");
  const a = leerCartola(prot.toString("base64"), "c.pdf", NOW);
  expect(!a.ok && a.msg).toContain("pide clave");
  const img = pdf([[1, "<< /Type /Catalog /Pages 2 0 R >>"], [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"], [3, "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>"], [4, stream("", Buffer.from("q 600 0 0 800 0 0 cm /Im1 Do Q"))]]);
  const b = leerCartola(img.toString("base64"), "c.pdf", NOW);
  expect(!b.ok && b.msg).toContain("escaneo");
});
