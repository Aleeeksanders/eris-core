// ============================================================
// Eris — SpanishWords: ¿esta palabra existe en español?
//
// Para el dictado (VoiceFix): una palabra que Whisper escribió y que no existe ("chocopiqui", "donce", "Forre") es casi
// seguro un error de oído, aunque Whisper estuviera seguro de ella; y una corrección del modelo solo se acepta si deja
// palabras que existen ("Qeda" no). Diccionario: es_ES de Hunspell (RLA-ES, Santiago Bosio; licencia GPLv3 / LGPLv3 /
// MPL 1.1, ver src/data/dict/es_ES/). Se revisa como lo hace Hunspell, raíz + prefijo/sufijo de sus reglas, sin tildes
// ni mayúsculas: no hace falta expandir el millón de formas (verbos conjugados), basta un mapa de ~71.000 raíces.
// ============================================================

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Lo que el diccionario de España no trae y en Chile se dice a diario (la comida y las marcas van por la base de alimentos). */
const CHILE = [
  "po", "cachai", "cachas", "fome", "pololo", "polola", "pololear", "luca", "lucas", "luquitas", "palo", "palos", "harto", "harta",
  "bacan", "guagua", "pega", "carrete", "flaite", "cuatico", "pucha", "porfa", "porfis", "altiro", "weon", "wea", "weas", "once",
  "onces", "colacion", "completo", "completos", "chela", "chelas", "copete", "fonda", "fondas", "micro", "metro", "plata",
  "bencina", "taco", "pucho", "pituto", "cuea", "piola", "filete", "fono", "celu", "ok", "okey", "app", "eris", "forge", "ikaros",
];

interface Rule { flag: string; strip: string; add: string; cond: RegExp | null; cross: boolean }

export class SpanishWords {
  private stems = new Map<string, string>(); // raíz sin tildes → sus banderas (de todas sus acepciones)
  private sfx = new Map<string, Rule[]>(); // por lo que agregan al final
  private pfx = new Map<string, Rule[]>(); // por lo que agregan al principio
  private maxSfx = 0;
  private maxPfx = 0;
  private extra = new Set(CHILE);

  constructor(aff: string, dic: string) {
    const cross = new Map<string, boolean>();
    for (const line of aff.split(/\r?\n/)) {
      const p = line.trim().split(/\s+/);
      if (p[0] !== "PFX" && p[0] !== "SFX") continue;
      if (p.length === 4 && /^[YN]$/.test(p[2])) { cross.set(p[0] + p[1], p[2] === "Y"); continue; }
      if (p.length < 5) continue;
      const isSfx = p[0] === "SFX";
      const strip = p[2] === "0" ? "" : fold(p[2]);
      const add = p[3] === "0" ? "" : fold(p[3].split("/")[0]);
      const c = fold(p[4]);
      const rule: Rule = { flag: p[1], strip, add, cond: c === "." ? null : new RegExp(isSfx ? `${c}$` : `^${c}`), cross: cross.get(p[0] + p[1]) ?? false };
      const map = isSfx ? this.sfx : this.pfx;
      const list = map.get(add);
      if (list) list.push(rule); else map.set(add, [rule]);
      if (isSfx) this.maxSfx = Math.max(this.maxSfx, add.length); else this.maxPfx = Math.max(this.maxPfx, add.length);
    }
    const lines = dic.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const raw = lines[i].split(/[\t ]/)[0];
      if (!raw) continue;
      const slash = raw.indexOf("/");
      const word = fold(slash >= 0 ? raw.slice(0, slash) : raw);
      const flags = slash >= 0 ? raw.slice(slash + 1) : "";
      this.stems.set(word, (this.stems.get(word) ?? "") + flags);
    }
  }

  /** El diccionario del proyecto (src/data/dict/es_ES), o null si no está. Se carga una sola vez. */
  static shared(): SpanishWords | null {
    if (SHARED !== undefined) return SHARED;
    try {
      const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/dict/es_ES");
      const aff = path.join(dir, "es_ES.aff"), dic = path.join(dir, "es_ES.dic");
      SHARED = existsSync(aff) && existsSync(dic) ? new SpanishWords(readFileSync(aff, "latin1"), readFileSync(dic, "latin1")) : null;
    } catch {
      SHARED = null;
    }
    return SHARED;
  }

  /** ¿Existe? Sin importar tildes ni mayúsculas ("geometria" sí, "chocopiqui" no). */
  has(word: string): boolean {
    const w = fold(word).replace(/[^a-z]/g, "");
    if (!w) return false;
    if (this.extra.has(w) || this.stems.has(w)) return true;
    return this.bySuffix(w, null) || this.byPrefix(w);
  }

  /** Raíz + un sufijo de sus reglas ("entrené" = entrenar + é). Con `pfxFlag`: además debe aceptar ese prefijo. */
  private bySuffix(w: string, pfxFlag: string | null): boolean {
    for (let n = 0; n <= Math.min(this.maxSfx, w.length - 1); n++) {
      const rules = this.sfx.get(n ? w.slice(-n) : "");
      if (!rules) continue;
      const head = w.slice(0, w.length - n);
      for (const r of rules) {
        const base = head + r.strip;
        if (r.cond && !r.cond.test(base)) continue;
        const fl = this.stems.get(base);
        if (fl === undefined || !fl.includes(r.flag)) continue;
        if (!pfxFlag || (r.cross && fl.includes(pfxFlag))) return true;
      }
    }
    return false;
  }

  /** Un prefijo de sus reglas + raíz ("reagendar"), y prefijo + raíz + sufijo si ambas reglas lo permiten. */
  private byPrefix(w: string): boolean {
    for (let n = 1; n <= Math.min(this.maxPfx, w.length - 1); n++) {
      const rules = this.pfx.get(w.slice(0, n));
      if (!rules) continue;
      const tail = w.slice(n);
      for (const r of rules) {
        const base = r.strip + tail;
        if (r.cond && !r.cond.test(base)) continue;
        const fl = this.stems.get(base);
        if (fl !== undefined && fl.includes(r.flag)) return true;
        if (r.cross && this.bySuffix(base, r.flag)) return true;
      }
    }
    return false;
  }
}

let SHARED: SpanishWords | null | undefined;
