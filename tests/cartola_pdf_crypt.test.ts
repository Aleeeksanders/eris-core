// Cartolas PDF «protegidas» solo con restricciones (se abren sin clave): RC4 (R2, R3), AES-128 (R4), AES-256 (R6).
// El cifrado de esta prueba está escrito aparte, siguiendo ISO 32000 (algoritmos 1, 3, 4, 5, 2.B), del lado del que crea
// el PDF. Y un PDF que SÍ pide clave → «pide clave», nunca texto basura.
import { test, expect } from "bun:test";
import { createHash, createCipheriv, randomBytes } from "crypto";
import { leerCartola } from "C:/Proyectos/eris/src/services/FinanceStatement.ts";

const NOW = new Date(2026, 9, 16, 9);
const PAD = Buffer.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);
const md5 = (...b: Buffer[]) => { const h = createHash("md5"); b.forEach((x) => h.update(x)); return h.digest(); };
const padPwd = (p: string) => Buffer.concat([Buffer.from(p, "latin1"), PAD]).subarray(0, 32);
function rc4(key: Buffer, data: Buffer) {
  const S = [...Array(256).keys()];
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) % 256; [S[i], S[j]] = [S[j], S[i]]; }
  const out = Buffer.alloc(data.length);
  let i = 0; j = 0;
  for (let k = 0; k < data.length; k++) { i = (i + 1) % 256; j = (j + S[i]) % 256; [S[i], S[j]] = [S[j], S[i]]; out[k] = data[k] ^ S[(S[i] + S[j]) % 256]; }
  return out;
}

const content = Buffer.from(
  "BT /F1 9 Tf 40 700 Td (Fecha) Tj ET BT /F1 9 Tf 110 700 Td (Glosa) Tj ET BT /F1 9 Tf 343 700 Td (Cargos) Tj ET BT /F1 9 Tf 433 700 Td (Abonos) Tj ET\n" +
  "BT /F1 9 Tf 40 684 Td (03/10/2026) Tj ET BT /F1 9 Tf 110 684 Td (COMPRA JUMBO) Tj ET BT /F1 9 Tf 343 684 Td (25.990) Tj ET\n" +
  "BT /F1 9 Tf 40 672 Td (04/10/2026) Tj ET BT /F1 9 Tf 110 672 Td (SUELDO) Tj ET BT /F1 9 Tf 420 672 Td (1.200.000) Tj ET\n", "latin1");
const ID0 = Buffer.from("8f1c2a9b3d4e5f60718293a4b5c6d7e8", "hex");

function build(encDict: string, encContent: Buffer): Buffer {
  const objs: Array<[number, Buffer]> = [
    [1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>")],
    [2, Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")],
    [3, Buffer.from("<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>")],
    [4, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")],
    [5, Buffer.concat([Buffer.from(`<< /Length ${encContent.length} >>\nstream\n`), encContent, Buffer.from("\nendstream")])],
    [6, Buffer.from(encDict, "latin1")],
  ];
  const parts = [Buffer.from("%PDF-1.6\n")];
  for (const [n, b] of objs) parts.push(Buffer.from(`${n} 0 obj\n`), b, Buffer.from("\nendobj\n"));
  parts.push(Buffer.from(`trailer\n<< /Root 1 0 R /Encrypt 6 0 R /ID [<${ID0.toString("hex")}><${ID0.toString("hex")}>] >>\n%%EOF\n`));
  return Buffer.concat(parts);
}
const hex = (b: Buffer) => `<${b.toString("hex")}>`;

/** RC4 (R2/R3) o AES-128 (R4), clave de usuario `user`, de dueño "dueno" */
function legacy(R: 2 | 3 | 4, user = "") {
  const n = R === 2 ? 5 : 16, P = -3904; // sin imprimir ni copiar
  // Algoritmo 3: O
  let ok = md5(padPwd("dueno"));
  if (R >= 3) for (let i = 0; i < 50; i++) ok = md5(ok);
  ok = ok.subarray(0, n);
  let O = rc4(ok, padPwd(user));
  if (R >= 3) for (let i = 1; i <= 19; i++) O = rc4(Buffer.from(ok.map((b) => b ^ i)), O);
  // Algoritmo 2: la llave del archivo (con la clave de usuario)
  const p4 = Buffer.alloc(4); p4.writeInt32LE(P);
  let key = md5(padPwd(user), O, p4, ID0).subarray(0, n);
  if (R >= 3) for (let i = 0; i < 50; i++) key = md5(key).subarray(0, n);
  // Algoritmos 4/5: U
  let U: Buffer;
  if (R === 2) U = rc4(key, PAD);
  else {
    let x = rc4(key, md5(PAD, ID0));
    for (let i = 1; i <= 19; i++) x = rc4(Buffer.from(key.map((b) => b ^ i)), x);
    U = Buffer.concat([x, Buffer.alloc(16, 0x11)]);
  }
  // Algoritmo 1: el contenido (objeto 5, generación 0)
  const aes = R === 4;
  const ok5 = md5(key, Buffer.from([5, 0, 0, 0, 0]), aes ? Buffer.from("sAlT") : Buffer.alloc(0)).subarray(0, Math.min(16, n + 5));
  let enc: Buffer;
  if (aes) { const iv = randomBytes(16); const c = createCipheriv("aes-128-cbc", ok5, iv); enc = Buffer.concat([iv, c.update(content), c.final()]); }
  else enc = rc4(ok5, content);
  const dict = `<< /Filter /Standard /V ${R === 2 ? 1 : R === 3 ? 2 : 4} /R ${R} /Length ${n * 8} /P ${P} /O ${hex(O)} /U ${hex(U)}` +
    (aes ? " /CF << /StdCF << /CFM /AESV2 /AuthEvent /DocOpen /Length 16 >> >> /StmF /StdCF /StrF /StdCF" : "") + " >>";
  return build(dict, enc);
}

/** AES-256 (R6) con clave de usuario `user` */
function hash2B(pwd: Buffer, salt: Buffer, udata: Buffer) {
  let K = createHash("sha256").update(Buffer.concat([pwd, salt, udata])).digest();
  let round = 0, E = Buffer.alloc(1);
  while (round < 64 || E[E.length - 1] > round - 32) {
    const K1 = Buffer.concat(new Array(64).fill(Buffer.concat([pwd, K, udata])));
    const c = createCipheriv("aes-128-cbc", K.subarray(0, 16), K.subarray(16, 32)); c.setAutoPadding(false);
    E = Buffer.concat([c.update(K1), c.final()]);
    const mod = [...E.subarray(0, 16)].reduce((a, b) => a + b, 0) % 3;
    K = createHash(mod === 0 ? "sha256" : mod === 1 ? "sha384" : "sha512").update(E).digest();
    round++;
  }
  return K.subarray(0, 32);
}
function aes256(user = "") {
  const pwd = Buffer.from(user, "utf8"), fileKey = randomBytes(32), vs = randomBytes(8), ks = randomBytes(8);
  const U = Buffer.concat([hash2B(pwd, vs, Buffer.alloc(0)), vs, ks]);
  const c = createCipheriv("aes-256-cbc", hash2B(pwd, ks, Buffer.alloc(0)), Buffer.alloc(16)); c.setAutoPadding(false);
  const UE = Buffer.concat([c.update(fileKey), c.final()]);
  const iv = randomBytes(16), cc = createCipheriv("aes-256-cbc", fileKey, iv);
  const enc = Buffer.concat([iv, cc.update(content), cc.final()]);
  const dict = `<< /Filter /Standard /V 5 /R 6 /Length 256 /P -3904 /O ${hex(randomBytes(48))} /U ${hex(U)} /OE ${hex(randomBytes(32))} /UE ${hex(UE)} /Perms ${hex(randomBytes(16))}` +
    " /CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> /StmF /StdCF /StrF /StdCF >>";
  return build(dict, enc);
}

const esperado = [
  { fecha: "2026-10-03", desc: "COMPRA JUMBO", monto: -25990 },
  { fecha: "2026-10-04", desc: "SUELDO", monto: 1200000 },
];

for (const [nombre, f] of [["RC4 40 bits (R2)", () => legacy(2)], ["RC4 128 bits (R3)", () => legacy(3)], ["AES-128 (R4)", () => legacy(4)], ["AES-256 (R6)", () => aes256()]] as const) {
  test(`protegida sin clave de apertura: ${nombre}`, () => {
    const r = leerCartola(f().toString("base64"), "c.pdf", NOW);
    expect(r.ok && r.movimientos).toEqual(esperado);
  });
}

test("con clave de apertura: no se lee nada y se explica", () => {
  for (const buf of [legacy(3, "12345678"), legacy(4, "12345678"), aes256("12345678")]) {
    const r = leerCartola(buf.toString("base64"), "c.pdf", NOW);
    expect(!r.ok && r.msg).toContain("pide clave");
  }
});

test("con clave de apertura: la que escribe la persona lo abre; una equivocada, no", () => {
  for (const buf of [legacy(2, "12345678"), legacy(3, "12345678"), legacy(4, "12345678"), aes256("12345678")]) {
    const ok = leerCartola(buf.toString("base64"), "c.pdf", NOW, "12345678");
    expect(ok.ok && ok.movimientos).toEqual(esperado);
    const mal = leerCartola(buf.toString("base64"), "c.pdf", NOW, "87654321");
    expect(!mal.ok && mal.code).toBe("clave");
    expect(!mal.ok && mal.msg).toContain("no abre");
  }
});
