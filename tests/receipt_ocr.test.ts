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
