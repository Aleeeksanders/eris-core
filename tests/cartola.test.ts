// La cartola del banco: leer (servidor, FinanceStatement) y conciliar con lo anotado (núcleo, conciliarCartola).
import { test, expect } from "bun:test";
import { deflateRawSync } from "zlib";
import { leerCartola, parseFecha, parseMonto } from "C:/Proyectos/eris/src/services/FinanceStatement.ts";
import * as C from "C:/Proyectos/eris/src/services/FinanceCore.ts";

const NOW = new Date(2026, 9, 15, 12);

// Un .xlsx mínimo hecho a mano (zip con sharedStrings + sheet1), con una entrada sin comprimir y las otras con deflate
function zip(files: Record<string, string>, store: string[] = []): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, "utf8"), method = store.includes(name) ? 0 : 8;
    const data = method === 0 ? raw : deflateRawSync(raw);
    const nm = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    local.push(lh, nm, data); central.push(ch, nm);
    off += lh.length + nm.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}
const strs = ["Cartola Cuenta Corriente", "Fecha", "Descripción", "Cargos ($)", "Abonos ($)", "Saldo ($)", "COMPRA LIDER EXPRESS", "TRANSF. DE EMPRESA SPA", "PAGO AGUAS ANDINAS", "Saldo inicial"];
const si = (s: string) => strs.indexOf(s);
const sheet = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>${si("Cartola Cuenta Corriente")}</v></c></row>
<row r="3"><c r="A3" t="s"><v>${si("Fecha")}</v></c><c r="B3" t="s"><v>${si("Descripción")}</v></c><c r="C3" t="s"><v>${si("Cargos ($)")}</v></c><c r="D3" t="s"><v>${si("Abonos ($)")}</v></c><c r="E3" t="s"><v>${si("Saldo ($)")}</v></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>01/10/2026</t></is></c><c r="B4" t="s"><v>${si("Saldo inicial")}</v></c><c r="E4"><v>400000</v></c></row>
<row r="5"><c r="A5"><v>46310</v></c><c r="B5" t="s"><v>${si("COMPRA LIDER EXPRESS")}</v></c><c r="C5"><v>12990</v></c><c r="E5"><v>387010</v></c></row>
<row r="6"><c r="A6" t="inlineStr"><is><t>05/10/2026</t></is></c><c r="B6" t="s"><v>${si("TRANSF. DE EMPRESA SPA")}</v></c><c r="D6"><v>500000</v></c><c r="E6"><v>887010</v></c></row>
<row r="7"><c r="A7" t="inlineStr"><is><t>07/10/2026</t></is></c><c r="B7" t="s"><v>${si("PAGO AGUAS ANDINAS")}</v></c><c r="C7"><v>18450</v></c></row>
</sheetData></worksheet>`;
const xlsx = zip({
  "[Content_Types].xml": "<Types/>",
  "xl/workbook.xml": `<workbook><sheets><sheet name="Movimientos" sheetId="1"/></sheets></workbook>`,
  "xl/sharedStrings.xml": `<sst>${strs.map((s) => `<si><t>${s.replace(/&/g, "&amp;")}</t></si>`).join("")}</sst>`,
  "xl/worksheets/sheet1.xml": sheet,
}, ["xl/workbook.xml"]);

test("fechas y montos a la chilena", () => {
  expect(parseFecha("15/10/2026", 2026)).toBe("2026-10-15");
  expect(parseFecha("15-10-26", 2026)).toBe("2026-10-15");
  expect(parseFecha("15/10", 2026)).toBe("2026-10-15");
  expect(parseFecha("2026-10-15T00:00:00", 2026)).toBe("2026-10-15");
  expect(parseFecha("46310", 2026)).toBe("2026-10-15");     // serial de Excel
  expect(parseFecha("Saldo", 2026)).toBeNull();
  expect(parseMonto("12.990")).toBe(12990);
  expect(parseMonto("-12.990")).toBe(-12990);
  expect(parseMonto("$ 1.250.000")).toBe(1250000);
  expect(parseMonto("(4.500)")).toBe(-4500);
  expect(parseMonto("12990,00")).toBe(12990);
  expect(parseMonto("12,990.00")).toBe(12990);
  expect(parseMonto("")).toBeNull();
});

test("Excel (.xlsx): busca la fila de títulos, cargo/abono, salta el saldo inicial", () => {
  const r = leerCartola(xlsx.toString("base64"), "cartola.xlsx", NOW);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.formato).toBe("xlsx");
  expect(r.hoja).toBe("Movimientos");
  expect(r.movimientos).toEqual([
    { fecha: "2026-10-15", desc: "COMPRA LIDER EXPRESS", monto: -12990, saldo: 387010 },
    { fecha: "2026-10-05", desc: "TRANSF. DE EMPRESA SPA", monto: 500000, saldo: 887010 },
    { fecha: "2026-10-07", desc: "PAGO AGUAS ANDINAS", monto: -18450 },
  ]);
  expect(r.desde).toBe("2026-10-05");
  expect(r.hasta).toBe("2026-10-15");
});

test("CSV con punto y coma, una columna Monto con signo, en Latin-1", () => {
  const csv = "Banco X;Cuenta Vista\n\nFecha Movimiento;Detalle;Monto;Saldo\n03/10/2026;Compra Farmacia Cruz Verde;-5.990;94.010\n04/10/2026;\"Abono; sueldo\";1.200.000;1.294.010\n";
  const r = leerCartola(Buffer.from(csv, "latin1").toString("base64"), "c.csv", NOW);
  expect(r.ok && r.movimientos).toEqual([
    { fecha: "2026-10-03", desc: "Compra Farmacia Cruz Verde", monto: -5990, saldo: 94010 },
    { fecha: "2026-10-04", desc: "Abono; sueldo", monto: 1200000, saldo: 1294010 },
  ]);
});

test("tabla HTML disfrazada de Excel, PDF y .xls antiguo", () => {
  const html = "<html><table><tr><th>Fecha</th><th>Glosa</th><th>Cargo</th><th>Abono</th></tr><tr><td>02/10/2026</td><td>UBER TRIP</td><td>4.300</td><td></td></tr></table></html>";
  const r = leerCartola(Buffer.from(html).toString("base64"), "c.xls", NOW);
  expect(r.ok && r.movimientos).toEqual([{ fecha: "2026-10-02", desc: "UBER TRIP", monto: -4300 }]);
  const pdf = leerCartola(Buffer.from("%PDF-1.7 ...").toString("base64"), "c.pdf", NOW);
  expect(!pdf.ok && pdf.msg).toContain("descárgala en Excel");
  const xls = leerCartola(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]).toString("base64"), "c.xls", NOW);
  expect(!xls.ok && xls.msg).toContain(".xlsx");
  const raro = leerCartola(Buffer.from("hola\nmundo").toString("base64"), "x.csv", NOW);
  expect(!raro.ok && raro.code).toBe("sin_titulos");
});

test("conciliar: lo anotado calza (±2 días, una vez cada uno); lo que falta se propone", () => {
  let id = 1;
  const ctx = { now: new Date(2026, 9, 1, 9), newId: () => id++ };
  const S = C.draft(C.onboarding({ sueldo: 1_200_000 }, ctx));
  C.formCuenta(S, { banco: "BCI", tipo: "debito", saldo: 400_000 }, ctx);
  C.formCuenta(S, { banco: "Banco Estado", tipo: "debito", saldo: 100_000 }, ctx);
  const bci = S.cuentas.find((c) => c.nombre === "BCI")!.id, be = S.cuentas.find((c) => c.nombre === "Banco Estado")!.id;
  C.formGasto(S, { desc: "Lider", monto: 12990, cat: "alimentacion", cuenta: bci, fecha: "2026-10-14" }, ctx);     // 1 día antes que la cartola
  C.formGasto(S, { desc: "Almuerzo", monto: 6000, cat: "alimentacion", cuenta: bci, fecha: "2026-10-08" }, ctx);
  C.formGasto(S, { desc: "Almuerzo", monto: 6000, cat: "alimentacion", cuenta: bci, fecha: "2026-10-09" }, ctx);
  C.formGasto(S, { desc: "Uber", monto: 4300, cat: "transporte", cuenta: be, fecha: "2026-10-02" }, ctx);           // de OTRA cuenta
  const movs = [
    { fecha: "2026-10-15", desc: "COMPRA LIDER EXPRESS", monto: -12990 },
    { fecha: "2026-10-09", desc: "ALMUERZO", monto: -6000 },
    { fecha: "2026-10-08", desc: "ALMUERZO", monto: -6000 },
    { fecha: "2026-10-10", desc: "ALMUERZO", monto: -6000 },          // un tercero: no está anotado
    { fecha: "2026-10-02", desc: "UBER TRIP", monto: -4300 },         // el anotado es de Banco Estado: no calza con la BCI
    { fecha: "2026-10-20", desc: "PAGO AGUAS ANDINAS", monto: -18450 },
    { fecha: "2026-10-05", desc: "TRANSF. DE EMPRESA SPA", monto: 500000 },
  ];
  const r = C.conciliarCartola(S, movs, { cuenta: bci });
  expect(r.coinciden.map((c) => `${c.mov.fecha}→${c.tx.fecha}`).sort()).toEqual(["2026-10-08→2026-10-08", "2026-10-09→2026-10-09", "2026-10-15→2026-10-14"]);
  expect(r.faltan.map((m) => m.desc)).toEqual(["UBER TRIP", "ALMUERZO", "PAGO AGUAS ANDINAS"]);
  expect(r.abonosFaltan.map((m) => m.monto)).toEqual([500000]);
});
