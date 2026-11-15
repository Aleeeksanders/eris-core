// La foto de la boleta: salida real del OCR de Windows sobre boletas de PRUEBA dibujadas (derecha y girada 4°).
import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { armarBoleta, arreglarNumero, categoriaProducto, leerBoletaFoto } from "C:/Proyectos/eris/src/services/ReceiptOcr.ts";

const FX = `${import.meta.dir}/fixtures/ocr_fx`;
const fx = (n: string) => JSON.parse(readFileSync(`${FX}/${n}.json`, "utf8"));

const ESPERADO = [
  { desc: "Leche Entera Soprole", monto: 1190 }, // (el OCR no leyó «1L» en esta imagen)
  { desc: "Pan Marraqueta Kg", monto: 1980 },
  { desc: "Queso Gauda Laminado 250G", monto: 3490 },
  { desc: "Yoghurt Frutilla 1L", monto: 2580, cant: 2, unit: 1290 },
  { desc: "Detergente Liq Omo 3L", monto: 8990, cat: "hogar" },
  { desc: "Papel Higienico Elite 12UN", monto: 5490, descuento: -1000, cat: "hogar" },
  { desc: "Tomate Kg", monto: 1250 },
  { desc: "Cerveza Cristal Lata 470CC", monto: 1100, cat: "entretenimiento" },
];

test("números leídos por OCR", () => {
  expect(arreglarNumero("1.19O")).toBe("1.190");
  expect(arreglarNumero("I.250")).toBe("1.250");
  expect(arreglarNumero("3 .490")).toBe("3.490");
  expect(arreglarNumero("LECHE")).toBeNull();
  expect(arreglarNumero("250G")).toBeNull();
});

test("boleta derecha: productos, cantidad, descuento, total que cuadra, encabezado", () => {
  const r = armarBoleta(fx("boleta_c"));
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.items.map(({ desc, monto, cant, unit, descuento, cat }) => ({ desc, monto, ...(cant ? { cant, unit } : {}), ...(descuento ? { descuento } : {}), ...(cat ? { cat } : {}) }))).toEqual(ESPERADO);
  expect(r.total).toBe(26070);
  expect(r.suma).toBe(26070);
  expect(r.cuadra).toBe(true);
  expect(r).toMatchObject({ comercio: "SUPERMERCADO DEMO", rut: "76123456-7", fecha: "2026-10-15", hora: "18:42", folio: 4521337 });
});

test("foto girada 4°: la endereza y lee lo mismo", () => {
  const r = armarBoleta(fx("boleta_rot"));
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.items.map((i) => i.monto)).toEqual(ESPERADO.map((i) => i.monto));
  expect(r.total).toBe(26070);
  expect(r.cuadra).toBe(true);
});

test("letra que confunde (cero con punto): lo que no cuadra se avisa, no se esconde", () => {
  const r = armarBoleta(fx("boleta_fake"));
  // Con Consolas el OCR lee «e» por «0»: los números se arreglan, pero si algo queda mal la suma no cuadra con el total
  if (r.ok && !r.cuadra) expect(r.total == null || r.suma !== r.total).toBe(true);
  if (r.ok && r.cuadra) expect(r.suma).toBe(26070);
});

test("categorías sugeridas", () => {
  expect(categoriaProducto("Lavaloza Quix 750Ml")).toBe("hogar");
  expect(categoriaProducto("Paracetamol 500Mg 16 Comp")).toBe("salud");
  expect(categoriaProducto("Vino Gato Tinto 1L")).toBe("entretenimiento");
  expect(categoriaProducto("Dog Chow Adulto 3Kg")).toBe("otros");
  expect(categoriaProducto("Manzana Fuji Kg")).toBeUndefined();
});

test("la imagen se valida y se borra", async () => {
  expect(await leerBoletaFoto(Buffer.from("hola").toString("base64"))).toMatchObject({ ok: false, code: "imagen" });
  let visto = "";
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  const r = await leerBoletaFoto(png.toString("base64"), async (p) => { visto = p; return fx("boleta_c"); });
  expect(r.ok).toBe(true);
  const { existsSync } = await import("fs");
  expect(visto).toContain("eris-boleta-");
  expect(existsSync(visto)).toBe(false);
});

test("otro formato: códigos de barras, $ en los precios, cantidad después, descripción en dos líneas, SUBTOTAL y AHORRO", () => {
  const r = armarBoleta(fx("boleta_b"));
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.items.map((i) => [i.desc, i.monto])).toEqual([
    ["Arroz Gl Graneado 1KG", 1390],          // (el OCR leyó «Gl» por «G1»)
    ["Aceite Maravilla Chef 900ML", 2890],
    ["Bebida Cola 3L", 3180],
    ["Lavaloza Quix 750ML", 1490],
    ["Cafe Nescafe Trad 170G", 5490],
  ]);
  expect(r.items[2]).toMatchObject({ cant: 2, unit: 1590 });
  expect(r.items[3]).toMatchObject({ descuento: -500, cat: "hogar" });
  expect(r).toMatchObject({ total: 14440, suma: 14440, cuadra: true, comercio: "HIPER DEMO LTDA", rut: "96555444-3", fecha: "2026-10-03", hora: "13:07", folio: 981234 });
});

// ─── Boleta REAL del Jumbo (2026-11-15; sin los datos de la persona) ───────────────────────────────────────────
// Los precios ya traen el IVA: «NETO 24.772 + IVA 4.708 = TOTAL 29.480» es solo el desglose del pie. Antes el lector se
// cortaba en «NETO» (el TOTAL nunca se leía), un «5.300» leído como «5-'300» se perdía y el comercio era la oficina del SII.
import { eanValido, ivaAparte, sumarIva } from "C:/Proyectos/eris/src/services/ReceiptOcr.ts";

test("Jumbo de cerca: los 5 productos con su código de barras, el TOTAL que cuadra y el comercio", () => {
  const r = armarBoleta(fx("boleta_jumbo"), "2026-11-15");
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.total).toBe(29480);
  expect(r.suma).toBe(29480);
  expect(r.cuadra).toBe(true);
  expect(r.ivaAparte).toBeUndefined(); // el IVA va incluido
  expect(r.items.map((i) => [i.monto, i.ean])).toEqual([
    [7990, "6902221399694"], [4290, "7802910007123"], [4290, "7802910007093"], [6260, "7804000002926"], [6650, "7804000003206"],
  ]);
  expect(r.items[0].desc).toBe("Botella 1LT Keep");
  expect(r.items[2]).toMatchObject({ cant: 2, unit: 2650, descuento: -1010 });
  expect(r.comercio).toBe("CENCOSUD RETAIL S.A.");
  expect(r.dudosas).toEqual([]);
});

test("Jumbo entera (letra más chica): un precio ilegible se calcula con el total; la fecha mal leída no gana", () => {
  const r = armarBoleta(fx("boleta_jumbo_entera"), "2026-11-15");
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.total).toBe(29480);
  expect(r.cuadra).toBe(true);
  expect(r.items.length).toBe(5);
  // «LECHE PRO CAPPU 5.aoo»: el producto (y su código) está; su precio es lo que falta para el total, marcado
  expect(r.items[2]).toMatchObject({ desc: "Leche Pro Cappu", ean: "7802910007093", estimado: true, monto: 3280 });
  expect(r.dudosas).toEqual(["7802910007093 LECHE PRO CAPPU 5.aoo"]); // el «24.772» suelto es el neto: no es dudoso
  // «16/11/26» (un 5 leído como 6) es mañana: vale la del número largo (20261115…); no la de los puntos (13-11)
  expect(r.fecha).toBe("2026-11-15");
  expect(r.hora).toBe("18:07");
  expect(r.comercio).toBe("CENCOSUD RETAIL S.A."); // «sil SANTIAGO PONIENTE» es el SII
  // Con el día siguiente, «16/11» sería válida: manda lo que dice la boleta
  const r2 = armarBoleta(fx("boleta_jumbo_entera"), "2026-11-16");
  expect(r2.ok && r2.fecha).toBe("2026-11-16");
});

test("números: el punto de miles leído como guion o apóstrofo", () => {
  expect(arreglarNumero("5-'300")).toBe("5.300");
  expect(arreglarNumero("5'300")).toBe("5.300");
  expect(arreglarNumero("-1.010")).toBe("-1.010");
});

test("código de barras: solo si el dígito verificador calza", () => {
  expect(eanValido("7802910007123")).toBe(true);
  expect(eanValido("7802910007124")).toBe(false); // un dígito mal leído
  expect(eanValido("96385074")).toBe(true); // EAN-8
  expect(eanValido("3522445815")).toBe(false); // un folio no es un código de barras
});

test("IVA: incluido (boleta) o aparte (factura: neto + IVA = total)", () => {
  // La del Jumbo: los productos ya suman el total
  expect(ivaAparte({ suma: 29480, iva: 4708, neto: 24772, total: 29480, n: 5 })).toBe(false);
  // «IVA incluido: $4.162» sin el total leído
  expect(ivaAparte({ suma: 26070, iva: 4162, n: 8 })).toBe(false);
  // Precios netos: 24.772 + IVA 4.708 = 29.480 (con o sin la línea del total)
  expect(ivaAparte({ suma: 24772, iva: 4708, total: 29480, n: 5 })).toBe(true);
  expect(ivaAparte({ suma: 24772, iva: 4708, neto: 24772, n: 5 })).toBe(true);
  expect(ivaAparte({ suma: 24772, total: 29480, n: 5 })).toBe(true); // la línea del IVA no se leyó
  // Faltó un producto: no se inventa un IVA
  expect(ivaAparte({ suma: 20000, iva: 4708, total: 29480, n: 4 })).toBe(false);
  const its = sumarIva([{ monto: 10000 }, { monto: 14772, unit: 7386 }], 29480);
  expect(its.reduce((s, i) => s + i.monto, 0)).toBe(29480);
  expect(its[0].monto).toBe(11901); // 10.000 × 29.480 / 24.772 (el IVA de cada línea se redondea)
  expect(its[1].unit).toBe(8790);
});

test("factura con precios netos: se le suma el IVA a cada producto y cuadra con lo pagado", () => {
  // Filas armadas a mano (como las da el OCR): producto a la izquierda, precio pegado al borde derecho
  const fila = (y: number, label: string, precio?: string) => [
    ...label.split(" ").map((t, i) => ({ t, x: 10 + i * 90, y, w: 80, h: 20 })),
    ...(precio ? [{ t: precio, x: 400 - precio.length * 12, y, w: precio.length * 12, h: 20 }] : []),
  ];
  const filas2 = [
    fila(0, "FERRETERIA DEMO SPA"), fila(30, "TORNILLOS CAJA", "10.000"), fila(60, "PINTURA LATEX", "14.772"),
    fila(90, "NETO", "24.772"), fila(120, "IVA 19%", "4.708"), fila(150, "TOTAL", "29.480"),
  ];
  const r = armarBoleta({ ok: true, lines: filas2.map((w) => ({ text: w.map((x) => x.t).join(" "), words: w })) }, "2026-11-15");
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.ivaAparte).toBe(true);
  expect(r.iva).toBe(4708);
  expect(r.total).toBe(29480);
  expect(r.cuadra).toBe(true);
  expect(r.items.map((i) => i.monto)).toEqual([11901, 17579]);
  expect(r.comercio).toBe("FERRETERIA DEMO SPA");
});
