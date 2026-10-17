// ============================================================
// Eris — texto de un PDF con su posición (2026-10-16)
//
// Para leer la cartola del banco en PDF (FinanceStatement.ts) sin dependencias: se recorren los objetos del archivo
// (también los que vienen dentro de «object streams»), se descomprimen los contenidos (FlateDecode, zlib de bun) y se
// interpretan los operadores de texto (BT/ET, Tf, Td/TD/Tm/T*, Tj/TJ/'/", cm, q/Q) para saber QUÉ dice y DÓNDE.
// Las fuentes compuestas (Type0, códigos de 2 bytes) se traducen con su /ToUnicode; las simples, como Latin-1.
// Es un lector de texto, no de imágenes: un PDF escaneado no trae texto (eso sería OCR).
// ============================================================

import { inflateSync, inflateRawSync } from "zlib";
import { createHash, createDecipheriv, createCipheriv } from "crypto";

/** El PDF pide una clave para abrirse (o usa un cifrado que no conozco): no se puede leer su texto. */
export class PdfProtegido extends Error { constructor() { super("pdf_protegido"); } }

// ─── Cifrado estándar con la clave de apertura VACÍA ──────────────
// Muchas cartolas vienen «protegidas» solo con restricciones (no imprimir, no copiar) y se abren sin clave: la llave
// se deriva de la clave vacía (o de la que escribió la persona, si el PDF la pide; no se guarda) (ISO 32000, 7.6.3: algoritmos 2, 4/5, 2.A/2.B). Antes de usarla se COMPRUEBA contra el
// valor U del archivo: si no calza (el PDF sí pide clave), no se lee nada (nunca texto basura).
const PAD = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
const md5 = (...parts: Buffer[]) => { const h = createHash("md5"); for (const p of parts) h.update(p); return h.digest(); };

function rc4(key: Buffer, data: Buffer): Buffer {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t; }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + S[i]) & 255;
    const t = S[i]; S[i] = S[j]; S[j] = t;
    out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
  }
  return out;
}
function aesCbcDecrypt(key: Buffer, data: Buffer, iv?: Buffer): Buffer | null {
  const alg = key.length === 32 ? "aes-256-cbc" : "aes-128-cbc";
  const ivx = iv ?? data.subarray(0, 16), body = iv ? data : data.subarray(16);
  if (body.length % 16) return null;
  try { const d = createDecipheriv(alg, key, ivx); return Buffer.concat([d.update(body), d.final()]); } catch {}
  try { const d = createDecipheriv(alg, key, ivx); d.setAutoPadding(false); return Buffer.concat([d.update(body), d.final()]); } catch { return null; }
}
/** Algoritmo 2.B (R6): el hash iterativo de AES-256 */
function hash2B(pwd: Buffer, salt: Buffer, udata: Buffer): Buffer {
  let k = createHash("sha256").update(Buffer.concat([pwd, salt, udata])).digest();
  let e: Buffer = Buffer.alloc(0);
  for (let i = 0; i < 64 || e[e.length - 1] > i - 32; i++) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([pwd, k, udata])));
    const c = createCipheriv("aes-128-cbc", k.subarray(0, 16), k.subarray(16, 32));
    c.setAutoPadding(false);
    e = Buffer.concat([c.update(k1), c.final()]);
    let sum = 0;
    for (let b = 0; b < 16; b++) sum += e[b];
    k = createHash(["sha256", "sha384", "sha512"][sum % 3]).update(e).digest();
  }
  return k.subarray(0, 32);
}

/** Una cadena PDF en la posición i: (literal con escapes) o <hex> */
function pdfStringAt(s: string, i: number): Buffer | null {
  while (/\s/.test(s[i] ?? "")) i++;
  if (s[i] === "<") { const e = s.indexOf(">", i); const hex = s.slice(i + 1, e).replace(/[^0-9a-fA-F]/g, ""); return Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex"); }
  if (s[i] !== "(") return null;
  const tok = tokenize(Buffer.from(s.slice(i, i + 4096), "latin1"))[0];
  return tok && tok.t === "str" ? tok.v : null;
}
const strOf = (dict: string, key: string) => { const i = dict.search(new RegExp(`/${key}(?![A-Za-z])`)); return i < 0 ? null : pdfStringAt(dict, i + key.length + 1); };

type Decrypt = (num: number, gen: number, data: Buffer) => Buffer | null;

function setupCrypt(s: string, password = ""): Decrypt | null {
  const em = s.match(/\/Encrypt\s+(\d+)\s+(\d+)\s+R/);
  const inline = !em && s.match(/\/Encrypt\s*<</);
  if (!em && !inline) return null;
  let dict: string;
  if (em) {
    const om = s.match(new RegExp(`(?:^|[^0-9])${em[1]}\\s+${em[2]}\\s+obj([\\s\\S]*?)endobj`));
    if (!om) throw new PdfProtegido();
    dict = om[1];
  } else dict = valueOf(s.slice(s.search(/\/Encrypt\s*<</)), "Encrypt") ?? "";
  if (!/\/Filter\s*\/Standard/.test(dict)) throw new PdfProtegido();
  const V = Number(dict.match(/\/V\s+(\d+)/)?.[1] ?? 0), R = Number(dict.match(/\/R\s+(\d+)/)?.[1] ?? 0);
  const O = strOf(dict, "O"), U = strOf(dict, "U");
  const P = Number(dict.match(/\/P\s+(-?\d+)/)?.[1] ?? 0);
  if (!O || !U) throw new PdfProtegido();
  const cfm = dict.match(/\/CFM\s*\/(\w+)/)?.[1];
  const stmIdentity = /\/StmF\s*\/Identity/.test(dict);
  if (stmIdentity) return (_n, _g, d) => d;

  if (V === 5 || R >= 5) {
    const pwd = Buffer.from(password, "utf8").subarray(0, 127);
    const valSalt = U.subarray(32, 40), keySalt = U.subarray(40, 48);
    const check = R >= 6 ? hash2B(pwd, valSalt, Buffer.alloc(0)) : createHash("sha256").update(Buffer.concat([pwd, valSalt])).digest();
    if (!check.subarray(0, 32).equals(U.subarray(0, 32))) throw new PdfProtegido();
    const ue = strOf(dict, "UE");
    if (!ue) throw new PdfProtegido();
    const ik = R >= 6 ? hash2B(pwd, keySalt, Buffer.alloc(0)) : createHash("sha256").update(Buffer.concat([pwd, keySalt])).digest();
    const fileKey = aesCbcDecrypt(ik, ue.subarray(0, 32), Buffer.alloc(16));
    if (!fileKey || fileKey.length < 32) throw new PdfProtegido();
    const k = fileKey.subarray(0, 32);
    return (_n, _g, d) => aesCbcDecrypt(k, d);
  }

  if (R < 2 || R > 4) throw new PdfProtegido();
  const n = R === 2 ? 5 : Math.min(16, Math.max(5, Number(dict.match(/\/Length\s+(\d+)/)?.[1] ?? 40) / 8));
  const idm = s.match(/\/ID\s*\[\s*(<[0-9a-fA-F\s]*>|\()/);
  const id0 = idm ? pdfStringAt(s, (idm.index ?? 0) + idm[0].lastIndexOf(idm[1])) ?? Buffer.alloc(0) : Buffer.alloc(0);
  const p4 = Buffer.alloc(4); p4.writeInt32LE(P | 0, 0);
  const noMeta = R >= 4 && /\/EncryptMetadata\s+false/.test(dict) ? Buffer.from([255, 255, 255, 255]) : Buffer.alloc(0);
  const padded = Buffer.concat([Buffer.from(password, "latin1"), PAD]).subarray(0, 32);
  let key = md5(padded, O.subarray(0, 32), p4, id0, noMeta).subarray(0, n);
  if (R >= 3) for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n)).subarray(0, n);
  // Comprobar con U que la clave vacía abre el archivo (algoritmos 4 y 5)
  let ok: boolean;
  if (R === 2) ok = rc4(key, PAD).equals(U.subarray(0, 32));
  else {
    let x = rc4(key, md5(PAD, id0));
    for (let i = 1; i <= 19; i++) x = rc4(Buffer.from(key.map((b) => b ^ i)), x);
    ok = x.subarray(0, 16).equals(U.subarray(0, 16));
  }
  if (!ok) throw new PdfProtegido();
  const aes = V === 4 && cfm === "AESV2";
  return (num, gen, d) => {
    const nb = Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255]);
    const ok2 = md5(key, nb, aes ? Buffer.from("sAlT", "latin1") : Buffer.alloc(0)).subarray(0, Math.min(16, n + 5));
    return aes ? aesCbcDecrypt(ok2, d) : rc4(ok2, d);
  };
}

export interface TextRun { page: number; x: number; y: number; xEnd: number; size: number; text: string }
export interface PdfLine { page: number; y: number; cells: Array<{ x: number; xEnd: number; text: string }> }

type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];
const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

interface PdfObj { dict: string; stream?: Buffer }

// ─── Objetos ──────────────────────────────────────────────────────
function decodeStream(dict: string, raw: Buffer): Buffer | null {
  if (!/\/Filter\s*(?:\[\s*)?\/FlateDecode/.test(dict)) return /\/Filter/.test(dict) ? null : raw;
  try { return inflateSync(raw); } catch {}
  try { return inflateRawSync(raw); } catch {}
  // Algunos generadores cortan mal el final: se intenta sin los últimos bytes
  for (let cut = 1; cut <= 4 && raw.length > cut; cut++) { try { return inflateSync(raw.subarray(0, raw.length - cut)); } catch {} }
  return null;
}

function readObjects(buf: Buffer, password = ""): Map<number, PdfObj> {
  const s = buf.toString("latin1");
  const decrypt = setupCrypt(s, password);
  const objs = new Map<number, PdfObj>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    const end = s.indexOf("endobj", start);
    if (end < 0) break;
    let body = s.slice(start, end);
    const st = body.search(/\bstream\r?\n/);
    let stream: Buffer | undefined;
    if (st >= 0) {
      const dict = body.slice(0, st);
      const dataStart = start + st + body.slice(st).match(/^stream\r?\n/)![0].length;
      const len = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
      let dataEnd = len ? dataStart + Number(len[1]) : -1;
      if (dataEnd < 0 || dataEnd > end || !/^\s*endstream/.test(s.slice(dataEnd, dataEnd + 20))) dataEnd = s.lastIndexOf("endstream", end);
      if (dataEnd > dataStart) {
        // sin el salto de línea antes de endstream
        let e2 = dataEnd;
        if (!len && s[e2 - 1] === "\n") e2--;
        if (!len && s[e2 - 1] === "\r") e2--;
        let raw: Buffer | null = buf.subarray(dataStart, e2);
        // (los flujos van cifrados, salvo la tabla de referencias)
        if (decrypt && !/\/Type\s*\/XRef/.test(dict)) raw = decrypt(num, Number(m[2]), raw);
        const decoded = raw ? decodeStream(dict, raw) : null;
        if (decoded) stream = decoded;
      }
      body = dict;
    }
    objs.set(num, { dict: body, ...(stream ? { stream } : {}) });
    re.lastIndex = end + 6;
  }
  // Objetos comprimidos dentro de object streams (PDF 1.5+): ahí suelen venir las fuentes y las páginas
  for (const o of [...objs.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict) || !o.stream) continue;
    const n = Number(o.dict.match(/\/N\s+(\d+)/)?.[1] ?? 0), first = Number(o.dict.match(/\/First\s+(\d+)/)?.[1] ?? 0);
    const text = o.stream.toString("latin1");
    const head = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = head[i * 2], off = head[i * 2 + 1], next = i + 1 < n ? head[(i + 1) * 2 + 1] : text.length - first;
      if (!Number.isFinite(num) || objs.has(num)) continue;
      objs.set(num, { dict: text.slice(first + off, first + next) });
    }
  }
  return objs;
}

const refsIn = (s: string) => [...s.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
/** El valor de una clave del diccionario: un `N 0 R` o un diccionario/arreglo directo */
function valueOf(dict: string, key: string): string | null {
  const i = dict.search(new RegExp(`/${key}(?![A-Za-z])`));
  if (i < 0) return null;
  let j = i + key.length + 1;
  while (/\s/.test(dict[j] ?? "")) j++;
  if (dict.startsWith("<<", j)) {
    let depth = 0;
    for (let k = j; k < dict.length - 1; k++) {
      if (dict.startsWith("<<", k)) { depth++; k++; }
      else if (dict.startsWith(">>", k)) { depth--; k++; if (depth === 0) return dict.slice(j, k + 1); }
    }
    return dict.slice(j);
  }
  if (dict[j] === "[") { const e = dict.indexOf("]", j); return dict.slice(j, e + 1); }
  const r = dict.slice(j).match(/^(\d+\s+\d+\s+R|\/[^\s/<>\[\]()]+|[^\s/<>\[\]()]+)/);
  return r ? r[1] : null;
}
function deref(objs: Map<number, PdfObj>, v: string | null): string | null {
  if (!v) return null;
  const r = v.match(/^(\d+)\s+\d+\s+R$/);
  return r ? objs.get(Number(r[1]))?.dict ?? null : v;
}

// ─── Fuentes y ToUnicode ──────────────────────────────────────────
interface Font { bytes: 1 | 2; map: Map<number, string> | null }

const hexToStr = (h: string) => {
  const clean = h.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let i = 0; i + 4 <= clean.length; i += 4) out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
  if (clean.length % 4 === 2) out += String.fromCharCode(parseInt(clean.slice(-2), 16));
  return out;
};

function parseCMap(text: string): { bytes: 1 | 2; map: Map<number, string> } {
  const map = new Map<number, string>();
  const cs = text.match(/begincodespacerange\s*<([0-9a-fA-F]+)>/);
  const bytes: 1 | 2 = cs && cs[1].length <= 2 ? 1 : 2;
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (hi - lo > 65535) continue;
      if (m[3] != null) {
        const base = m[3];
        const last = parseInt(base.slice(-4), 16), prefix = base.length > 4 ? hexToStr(base.slice(0, -4)) : "";
        for (let c = lo; c <= hi; c++) map.set(c, prefix + String.fromCharCode(last + (c - lo)));
      } else {
        const list = [...(m[4] ?? "").matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => hexToStr(x[1]));
        for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, list[c - lo]);
      }
    }
  }
  return { bytes, map };
}

function fontsOf(objs: Map<number, PdfObj>, resources: string | null): Map<string, Font> {
  const out = new Map<string, Font>();
  const fd = deref(objs, valueOf(resources ?? "", "Font"));
  if (!fd) return out;
  for (const m of fd.matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const f = objs.get(Number(m[2]))?.dict ?? "";
    const type0 = /\/Subtype\s*\/Type0/.test(f);
    const tu = valueOf(f, "ToUnicode");
    const tuObj = tu && /R$/.test(tu) ? objs.get(refsIn(tu)[0]) : null;
    if (tuObj?.stream) {
      const cm = parseCMap(tuObj.stream.toString("latin1"));
      out.set(m[1], { bytes: type0 ? 2 : cm.bytes, map: cm.map });
    } else out.set(m[1], { bytes: type0 ? 2 : 1, map: null });
  }
  return out;
}

function decodeText(bytes: Buffer, font: Font | undefined): string {
  if (!font || font.bytes === 1) {
    let s = "";
    for (const b of bytes) s += font?.map?.get(b) ?? String.fromCharCode(b);
    return s;
  }
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = (bytes[i] << 8) | bytes[i + 1];
    s += font.map?.get(code) ?? (code >= 32 && code < 0xd800 ? String.fromCharCode(code) : "");
  }
  return s;
}

// ─── Contenido de la página ───────────────────────────────────────
type Tok = { t: "num"; v: number } | { t: "str"; v: Buffer } | { t: "name"; v: string } | { t: "op"; v: string } | { t: "arr"; v: Tok[] };

function tokenize(src: Buffer): Tok[] {
  const out: Tok[] = [];
  const stack: Tok[][] = [out];
  const push = (t: Tok) => stack[stack.length - 1].push(t);
  let i = 0;
  const n = src.length;
  const isWs = (c: number) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
  const isDelim = (c: number) => "()<>[]{}/%".includes(String.fromCharCode(c));
  while (i < n) {
    const c = src[i];
    if (isWs(c)) { i++; continue; }
    if (c === 37) { while (i < n && src[i] !== 10 && src[i] !== 13) i++; continue; } // %
    if (c === 40) { // ( string )
      const bytes: number[] = [];
      let depth = 1; i++;
      while (i < n && depth > 0) {
        const ch = src[i];
        if (ch === 92) { // \
          const e = src[i + 1];
          const map: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
          if (e in map) { bytes.push(map[e]); i += 2; continue; }
          if (e === 10) { i += 2; continue; }
          if (e === 13) { i += src[i + 2] === 10 ? 3 : 2; continue; }
          let o = "", k = i + 1;
          while (k < n && o.length < 3 && src[k] >= 48 && src[k] <= 55) o += String.fromCharCode(src[k++]);
          if (o) { bytes.push(parseInt(o, 8) & 255); i = k; continue; }
          i++; continue;
        }
        if (ch === 40) depth++;
        if (ch === 41) { depth--; if (depth === 0) { i++; break; } }
        bytes.push(ch); i++;
      }
      push({ t: "str", v: Buffer.from(bytes) });
      continue;
    }
    if (c === 60 && src[i + 1] === 60) { i += 2; continue; } // << (diccionarios en línea: se ignoran)
    if (c === 62 && src[i + 1] === 62) { i += 2; continue; }
    if (c === 60) { // <hex>
      const e = src.indexOf(62, i);
      const hex = src.toString("latin1", i + 1, e < 0 ? n : e).replace(/[^0-9a-fA-F]/g, "");
      push({ t: "str", v: Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex") });
      i = e < 0 ? n : e + 1; continue;
    }
    if (c === 91) { const a: Tok[] = []; push({ t: "arr", v: a }); stack.push(a); i++; continue; }
    if (c === 93) { if (stack.length > 1) stack.pop(); i++; continue; }
    if (c === 47) { // /name
      let k = i + 1;
      while (k < n && !isWs(src[k]) && !isDelim(src[k])) k++;
      push({ t: "name", v: src.toString("latin1", i + 1, k) }); i = k; continue;
    }
    let k = i;
    while (k < n && !isWs(src[k]) && !isDelim(src[k])) k++;
    if (k === i) { i++; continue; }
    const w = src.toString("latin1", i, k);
    i = k;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) { push({ t: "num", v: Number(w) }); continue; }
    if (w === "BI") { // imagen en línea: hasta EI
      const e = src.indexOf(Buffer.from("EI"), i);
      i = e < 0 ? n : e + 2; continue;
    }
    push({ t: "op", v: w });
  }
  return out;
}

function runsOfPage(content: Buffer, fonts: Map<string, Font>, page: number): TextRun[] {
  const runs: TextRun[] = [];
  const toks = tokenize(content);
  let ctm: Mat = IDENT;
  const gstack: Mat[] = [];
  let tm: Mat = IDENT, tlm: Mat = IDENT;
  let font: Font | undefined, size = 10, leading = 0, hscale = 1, charSp = 0, wordSp = 0;
  const args: Tok[] = [];
  const nums = () => args.map((a) => (a.t === "num" ? a.v : 0));
  const show = (parts: Tok[]) => {
    let text = "";
    let adv = 0;
    for (const p of parts) {
      if (p.t === "str") { const s = decodeText(p.v, font); text += s; adv += s.length; }
      else if (p.t === "num" && p.v < -180) { text += " "; adv += 1; } // ajuste grande = espacio entre palabras
    }
    if (!text) return;
    const m = mul(tm, ctm);
    const scale = Math.hypot(m[0], m[1]) || 1;
    const fsize = size * scale;
    const width = adv * size * 0.5 * hscale + text.length * charSp + (text.split(" ").length - 1) * wordSp;
    runs.push({ page, x: m[4], y: m[5], xEnd: m[4] + width * scale, size: fsize, text });
    tm = mul([1, 0, 0, 1, width, 0], tm);
  };
  for (const tk of toks) {
    if (tk.t !== "op") { args.push(tk); continue; }
    const a = nums();
    switch (tk.v) {
      case "q": gstack.push(ctm); break;
      case "Q": ctm = gstack.pop() ?? IDENT; break;
      case "cm": if (a.length >= 6) ctm = mul(a.slice(-6) as Mat, ctm); break;
      case "BT": tm = IDENT; tlm = IDENT; break;
      case "Tf": { const nm = args.find((x) => x.t === "name") as { v: string } | undefined; font = nm ? fonts.get(nm.v) : undefined; size = a[a.length - 1] || size; break; }
      case "TL": leading = a[0] ?? leading; break;
      case "Tz": hscale = (a[0] ?? 100) / 100; break;
      case "Tc": charSp = a[0] ?? 0; break;
      case "Tw": wordSp = a[0] ?? 0; break;
      case "Td": tlm = mul([1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0], tlm); tm = tlm; break;
      case "TD": leading = -(a[1] ?? 0); tlm = mul([1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0], tlm); tm = tlm; break;
      case "Tm": if (a.length >= 6) { tlm = a.slice(-6) as Mat; tm = tlm; } break;
      case "T*": tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; break;
      case "Tj": { const s = args.filter((x) => x.t === "str"); show(s); break; }
      case "TJ": { const arr = args.find((x) => x.t === "arr") as { v: Tok[] } | undefined; if (arr) show(arr.v); break; }
      case "'": tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; show(args.filter((x) => x.t === "str")); break;
      case '"': wordSp = a[0] ?? wordSp; charSp = a[1] ?? charSp; tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; show(args.filter((x) => x.t === "str")); break;
    }
    args.length = 0;
  }
  return runs;
}

/** Todo el texto del PDF, con página y posición (y crece hacia arriba, como en el PDF). */
export function pdfRuns(buf: Buffer, password = ""): TextRun[] {
  const objs = readObjects(buf, password);
  const pages = [...objs.entries()].filter(([, o]) => /\/Type\s*\/Page(?!s)\b/.test(o.dict)).sort((a, b) => a[0] - b[0]);
  const runs: TextRun[] = [];
  pages.forEach(([, o], idx) => {
    // Recursos: los de la página o los heredados de /Pages
    let res = deref(objs, valueOf(o.dict, "Resources"));
    let parent = valueOf(o.dict, "Parent");
    for (let hops = 0; !res && parent && hops < 10; hops++) {
      const p = deref(objs, parent);
      res = deref(objs, valueOf(p ?? "", "Resources"));
      parent = valueOf(p ?? "", "Parent");
    }
    const fonts = fontsOf(objs, res);
    const contents = valueOf(o.dict, "Contents");
    const parts = refsIn(contents ?? "").map((r) => objs.get(r)?.stream).filter((x): x is Buffer => !!x);
    if (!parts.length) return;
    runs.push(...runsOfPage(Buffer.concat(parts.flatMap((p) => [p, Buffer.from("\n")])), fonts, idx + 1));
  });
  return runs;
}

/**
 * Las líneas de cada página, de arriba hacia abajo, con sus celdas de izquierda a derecha. Dos trozos de texto
 * separados por menos de ~un espacio van en la misma celda.
 */
export function pdfLines(buf: Buffer, password = ""): PdfLine[] {
  const runs = pdfRuns(buf, password).filter((r) => r.text.trim());
  const out: PdfLine[] = [];
  const byPage = new Map<number, TextRun[]>();
  for (const r of runs) { const l = byPage.get(r.page) ?? []; l.push(r); byPage.set(r.page, l); }
  for (const [page, rs] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    rs.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Array<{ y: number; runs: TextRun[] }> = [];
    for (const r of rs) {
      const tol = Math.max(1.5, r.size * 0.35);
      const l = lines.find((x) => Math.abs(x.y - r.y) <= tol);
      if (l) l.runs.push(r); else lines.push({ y: r.y, runs: [r] });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) {
      l.runs.sort((a, b) => a.x - b.x);
      const cells: PdfLine["cells"] = [];
      for (const r of l.runs) {
        const last = cells[cells.length - 1];
        const gap = last ? r.x - last.xEnd : Infinity;
        if (last && gap < Math.max(2, r.size * 0.6)) { last.text += (gap > r.size * 0.15 ? " " : "") + r.text.trim(); last.xEnd = Math.max(last.xEnd, r.xEnd); }
        else cells.push({ x: r.x, xEnd: r.xEnd, text: r.text.trim() });
      }
      out.push({ page, y: l.y, cells: cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, " ").trim() })).filter((c) => c.text) });
    }
  }
  return out;
}
