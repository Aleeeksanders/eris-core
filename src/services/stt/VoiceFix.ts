// ============================================================
// Eris — VoiceFix: que el dictado entienda lo que quisiste decir
//
// Whisper (modelo small, en CPU) oye mal justo lo que más importa: nombres de comida, marcas, el verbo de la orden y la
// comida del día. Una frase dicha rápido (2026-10-09), "Registra 150 gramos de Chocapic y una hallulla con palta para
// la once", llegó como "Te distra 150 gramos de chocopiqui y una lluja con palta para la donce". Dictar es para ahorrar
// tiempo; si no te entiende, estresa. Se corrige en tres capas, de la más barata a la más cara, y solo lo dudoso:
// palabras que no existen (diccionario español + vocabulario de Eris) o de las que Whisper mismo dudó (probabilidad).
//   1. Contexto para Whisper (su "prompt" inicial): vocabulario de Eris, lo del usuario (comidas frecuentes,
//      medicamentos) y lo último que dijo Eris. Solo con esto, esa frase salió "Registra … Chocapic … para la once".
//   2. Por sonido: una palabra que no existe y suena a UNA palabra conocida ("donce" → once, "chocopiqui" → Chocapic),
//      o dos que juntas son una ("choca pic").
//   3. Si quedan dudosas, el modelo reinterpreta la frase con la conversación, con esas partes marcadas y pistas de cómo
//      suenan. Cada cambio se revisa por separado: tiene que tocar algo dudoso, dejar palabras que existen y sonar
//      parecido a lo oído (o ser una de las pistas). Lo que no pasa la revisión queda como lo oyó Whisper.
// ============================================================

import { FoodIndex, normText, STOP, editDistance, phonWord } from "../FoodText.js";
import { SpanishWords } from "./SpanishWords.js";

/** Una palabra como la escribió Whisper (con su puntuación) y qué tan seguro estaba (la menor de sus partes). */
export interface HeardWord { text: string; p: number }

export interface VoiceContext {
  /** lo último que dijo Eris (a eso suele responder el usuario) */
  lastAssistant?: string;
  /** palabras propias del usuario: comidas frecuentes, medicamentos */
  vocabulary?: string[];
}

/** Lo que más se dice en Eris y Whisper confunde: verbos de orden, comidas del día, comida chilena, módulos. */
export const BASE_VOCAB = [
  "Eris", "registra", "anota", "agrega", "borra", "ingresa", "comí", "tomé", "gasté", "pagué", "entrené", "llevo",
  "desayuno", "almuerzo", "once", "cena", "colación", "agua", "hallulla", "marraqueta", "sopaipilla", "empanada",
  "cazuela", "porotos", "palta", "completo", "Chocapic", "Zucaritas", "Forge", "Finanzas", "Nutrición", "rutina",
  "sueldo", "lucas",
];

const MAX_PROMPT_CHARS = 700; // Whisper usa ~224 tokens de contexto: más se corta por el principio

/**
 * Palabras propias del usuario: lo que más anota (comidas frecuentes) y sus medicamentos. Todo queda en el PC: el
 * contexto va al Whisper local, no sale a internet.
 */
export async function voiceVocabulary(memory: any): Promise<string[]> {
  const out: string[] = [];
  try {
    const freq = await memory?.get?.("frequent_foods");
    if (freq && typeof freq === "object") {
      out.push(...Object.entries(freq as Record<string, { count?: number }>)
        .sort((a, b) => (b[1]?.count ?? 0) - (a[1]?.count ?? 0))
        .slice(0, 15)
        // "cereal azucarado (tipo zucaritas / chocapic)" → "cereal azucarado"
        .map(([name]) => name.replace(/\([^)]*\)/g, " ").split(" / ")[0].replace(/\s+/g, " ").trim())
        .filter((n) => n && n.length <= 30));
    }
  } catch {}
  try {
    const profile = await memory?.getProfile?.();
    for (const m of profile?.medical?.medications ?? []) if (m?.name) out.push(String(m.name).trim());
  } catch {}
  return [...new Set(out)];
}

/** Índice del vocabulario de Eris y del usuario (para corregir por sonido junto con la base de alimentos). */
export function lexiconIndex(vocabulary: string[] = []): FoodIndex<unknown> {
  return new FoodIndex([...BASE_VOCAB, ...vocabulary], (t) => [{ text: t }]) as FoodIndex<unknown>;
}

/** Texto plano para el contexto de Whisper (imita el estilo de lo que lee: sin emojis, viñetas ni markdown). */
function plain(s: string): string {
  return s
    .replace(/<think>[\s\S]*?<\/think>/g, " ")
    .replace(/[*_`#>|~[\](){}]/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Contexto para Whisper: vocabulario de Eris, el del usuario y, al final (lo que más pesa), lo último que dijo Eris. */
export function buildWhisperPrompt(ctx: VoiceContext): string {
  const own = (ctx.vocabulary ?? []).filter(Boolean).slice(0, 20);
  const head = `${BASE_VOCAB.join(", ")}.${own.length ? ` ${own.join(", ")}.` : ""}`;
  const room = MAX_PROMPT_CHARS - head.length - 1;
  const last = ctx.lastAssistant ? plain(ctx.lastAssistant) : "";
  const tail = room > 40 && last ? last.slice(-room) : "";
  return tail ? `${head} ${tail}` : head;
}

// ─── Lo que devuelve Whisper ─────────────────────────────────

// Sin habla Whisper "rellena": "[Música]", "(risas)", "Subtítulos realizados por la comunidad de Amara.org"…
const NON_SPEECH = /\[[^\]]*\]|\((?:[^)]*\b(?:m[uú]sica|risas?|aplausos|ruido|silencio|inaudible|sonido|tos)\b[^)]*)\)|[♪♫]+/gi;
const PHANTOM = /[^.!?]*amara\.org|subt[ií]tulos?\s+(realizados|por|hechos)[^.!?]*[.!?]?|gracias por (ver|mirar)[^.!?]*[.!?]?|suscr[ií]bete[^.!?]*[.!?]?/gi;

/** Palabras con su probabilidad, a partir de los "words" de verbose_json (cada palabra nueva empieza con espacio). */
export function heardWords(json: any): HeardWord[] {
  const out: HeardWord[] = [];
  for (const seg of json?.segments ?? []) {
    for (const w of seg?.words ?? []) {
      const piece = String(w?.word ?? "");
      if (!piece || /^\s*\[_/.test(piece)) continue; // marcas internas de Whisper ([_BEG_], [_TT_…])
      const p = typeof w?.probability === "number" ? w.probability : 1;
      if (/^\s/.test(piece) || !out.length) out.push({ text: piece.trim(), p });
      else { const last = out[out.length - 1]; last.text += piece; last.p = Math.min(last.p, p); }
    }
  }
  return out.filter((w) => w.text);
}

/** Saca lo que no es habla. Devuelve las palabras que quedan (vacío si no se dijo nada). */
export function cleanHeard(words: HeardWord[], prompt = ""): HeardWord[] {
  const text = words.map((w) => w.text).join(" ");
  const cleaned = text.replace(NON_SPEECH, " ").replace(PHANTOM, " ").replace(/\s+/g, " ").trim();
  if (!/[a-zñáéíóú0-9]/i.test(cleaned)) return [];
  // Con poco o nada de voz, Whisper a veces "lee" su propio contexto: si lo oído está tal cual en él, no se dijo nada
  const n = normText(cleaned);
  if (prompt && n.split(" ").length >= 3 && normText(prompt).includes(n)) return [];
  if (cleaned === text) return words;
  const keep = cleaned.split(" ");
  const out: HeardWord[] = [];
  let j = 0;
  for (const w of words) if (j < keep.length && w.text === keep[j]) { out.push(w); j++; }
  return j === keep.length ? out : keep.map((t) => ({ text: t, p: 1 }));
}

// ─── ¿Qué es dudoso? ─────────────────────────────────────────

/** Whisper dudó de la palabra (aunque exista). */
export const LOW = 0.35;
const key = (s: string) => normText(s).replace(/ /g, "");
const isContent = (w: string) => { const n = normText(w); return n.replace(/ /g, "").length >= 3 && !STOP.has(n) && !/\d/.test(n); };

export interface Lexicon {
  indexes: Array<FoodIndex<unknown>>;
  spanish: SpanishWords | null;
  /** vocabulario de Eris y del usuario: lo único por lo que se cambia una palabra que SÍ existe */
  core?: FoodIndex<unknown> | null;
}

/** ¿Existe? Una cifra, una palabra del diccionario español o una del vocabulario de Eris (comidas, marcas, módulos). */
export function isKnown(word: string, lx: Lexicon): boolean {
  const toks = normText(word).split(" ").filter(Boolean);
  if (!toks.length) return true; // solo puntuación
  return toks.every((t) => /^\d+$/.test(t) || STOP.has(t) || !!lx.spanish?.has(t) || lx.indexes.some((ix) => ix.knows(t)));
}

/** Palabras dudosas: no existen, o Whisper dudó de ellas. */
export function suspectsOf(words: HeardWord[], lx: Lexicon): number[] {
  return words.map((w, i) => (isContent(w.text) && (w.p < LOW || !isKnown(w.text, lx)) ? i : -1)).filter((i) => i >= 0);
}

// ─── Capa 2: por sonido ──────────────────────────────────────

/** Nombres propios del vocabulario de Eris, con su mayúscula ("chocapic" → "Chocapic"). */
const PROPER = new Map(BASE_VOCAB.filter((w) => /^[A-ZÁÉÍÓÚÑ]/.test(w)).map((w) => [normText(w).replace(/ /g, ""), w]));

/** Reemplaza las palabras [i, i+span) por `word`, conservando la mayúscula inicial y la puntuación de los bordes. */
function replaceSpan(words: HeardWord[], i: number, span: number, word: string): HeardWord[] {
  const first = words[i].text, last = words[i + span - 1].text;
  const lead = first.match(/^[¿¡"«]*/)?.[0] ?? "";
  const trail = last.match(/[.,;:!?…"»]*$/)?.[0] ?? "";
  const proper = PROPER.get(normText(word).replace(/ /g, "")) ?? word;
  const core = /^[¿¡"«]*[A-ZÁÉÍÓÚÑ]/.test(first) ? proper[0].toUpperCase() + proper.slice(1) : proper;
  return [...words.slice(0, i), { text: lead + core + trail, p: 1 }, ...words.slice(i + span)];
}

/**
 * La palabra conocida (una sola) a la que suena `w`, solo si es casi igual: 1 letra en palabras de 6 o más, 2 desde 9
 * (comparando la palabra entera, sin quitarle el plural). Con menos, el parecido engaña y se anotaría OTRO alimento:
 * "lluja" (hallulla) quedaba "yuca" y "páltele" (palta, el) quedaba "pastel". Esas van al modelo, con la conversación.
 */
function nearestKnown(w: string, indexes: Array<FoodIndex<unknown>>): string | null {
  let best: { word: string; dist: number } | null = null, tie = false;
  for (const ix of indexes) {
    const c = ix.nearest(key(w));
    if (!c) continue;
    if (!best || c.dist < best.dist) { best = c; tie = false; } else if (c.dist === best.dist && key(c.word) !== key(best.word)) tie = true;
  }
  if (!best || tie) return null;
  const a = phonWord(key(w)), b = phonWord(key(best.word));
  const len = Math.max(key(w).length, key(best.word).length);
  const d = editDistance(a, b, 3);
  return (d <= 1 && len >= 6) || (d <= 2 && len >= 9) ? best.word : null;
}

/** Corrige por sonido solo palabras que NO existen: una real con poca probabilidad necesita el contexto (capa 3). */
export function fixBySound(words: HeardWord[], lx: Lexicon): { words: HeardWord[]; fixes: string[] } {
  let out = [...words];
  const fixes: string[] = [];
  for (let i = 0; i < out.length; i++) {
    if (!isContent(out[i].text) || isKnown(out[i].text, lx)) continue;
    // Dos palabras que juntas son una: "choca pic" → chocapic, "geome tría" → geometría
    if (i + 1 < out.length && /^[a-záéíóúñü]+[.,;:!?…]*$/i.test(out[i + 1].text) && (out[i + 1].p < 0.8 || !isKnown(out[i + 1].text, lx))) {
      const joined = key(out[i].text + out[i + 1].text);
      const word = joined.length >= 5 ? (lx.indexes.map((ix) => ix.spell(joined)).find(Boolean) ?? (lx.spanish?.has(joined) ? joined : null)) : null;
      if (word) {
        fixes.push(`${out[i].text} ${out[i + 1].text} → ${word}`);
        out = replaceSpan(out, i, 2, word);
        continue;
      }
    }
    let near = nearestKnown(out[i].text, lx.indexes);
    // La base tiene el singular: "sopaipiñas" → sopaipillas, no sopaipilla
    if (near && /s$/.test(key(out[i].text)) && !/s$/.test(key(near))) near += /[aeiouáéíóú]$/i.test(near) ? "s" : "es";
    if (near) {
      fixes.push(`${out[i].text} → ${near}`);
      out = replaceSpan(out, i, 1, near);
    }
  }
  return { words: out, fixes };
}

// ─── Capa 3: el modelo, con el contexto ──────────────────────

export interface Span { start: number; end: number; candidates: string[] }

/** Agrupa lo dudoso en tramos (con las palabras cortas de en medio) y busca a qué suena cada tramo. */
export function spansOf(words: HeardWord[], suspects: number[], lx: Lexicon): Span[] {
  const spans: Span[] = [];
  for (const i of suspects) {
    const last = spans[spans.length - 1];
    // "la vida, el pitina": lo dudoso separado por una palabra corta es un solo tramo
    if (last && i - last.end <= 2) { last.end = i + 1; continue; }
    // "Te distra" (registra): una palabra corta justo antes, de la que Whisper también dudó, es parte de lo dudoso
    const prev = words[i - 1];
    const start = prev && !isContent(prev.text) && prev.p < 0.6 && !/\d/.test(prev.text) ? i - 1 : i;
    spans.push({ start, end: i + 1, candidates: [] });
  }
  for (const s of spans) {
    const cands: string[] = [];
    // Ventanas de 1 a 3 palabras alrededor del tramo, juntas: "para a el bípedo" → paralelepípedo
    for (let a = Math.max(0, s.start - 1); a <= s.end - 1; a++) {
      for (let b = Math.max(a + 1, s.start + 1); b <= Math.min(words.length, a + 3, s.end + 1); b++) {
        const joined = key(words.slice(a, b).map((w) => w.text).join(""));
        if (joined.length < 3) continue;
        for (const ix of lx.indexes) cands.push(...ix.similar(joined, joined.length >= 10 ? 4 : 3, 2));
      }
    }
    s.candidates = [...new Set(cands)].slice(0, 6);
  }
  return spans;
}

export function buildReinterpretPrompt(words: HeardWord[], spans: Span[], ctx: VoiceContext): { system: string; user: string } {
  const parts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const s = spans.find((x) => x.start === i);
    if (s) { parts.push(`⟦${words.slice(s.start, s.end).map((w) => w.text).join(" ")}⟧`); i = s.end - 1; } else parts.push(words[i].text);
  }
  const system =
    "Corriges dictados por voz para Eris, una asistente de salud, comida, finanzas y entrenamiento en Chile. " +
    "El reconocimiento de voz confundió algunas palabras con otras que suenan parecido; las partes dudosas van entre ⟦ ⟧. " +
    "Escribe la frase que la persona QUISO decir.\n" +
    "Reglas:\n" +
    "1. Cambia SOLO lo que está entre ⟦ ⟧ (pueden ser dos palabras que eran una, o una que eran dos). Todo lo demás va igual, palabra por palabra.\n" +
    "2. Guíate por cómo suena y por la conversación; las pistas son palabras que suenan parecido. Si no sabes qué quiso decir, déjalo como está.\n" +
    "3. Las cifras van tal cual. Escribe bien las palabras, con tildes.\n" +
    "4. Una orden suele empezar con un verbo (registra, agrega, anota, borra…). No pongas un alimento que no suene casi igual a lo oído.\n" +
    "5. Responde solo la frase corregida: sin comillas, sin ⟦ ⟧ y sin explicar nada.";
  const last = ctx.lastAssistant ? plain(ctx.lastAssistant).slice(-300) : "";
  const hints = spans
    .map((s) => `«${words.slice(s.start, s.end).map((w) => w.text).join(" ")}»${s.candidates.length ? ` suena a: ${s.candidates.join(", ")}` : ""}`)
    .join("\n");
  const user =
    (last ? `Lo último que dijo Eris: «${last}»\n` : "") +
    `Palabras frecuentes en Eris: ${[...BASE_VOCAB, ...(ctx.vocabulary ?? []).slice(0, 15)].join(", ")}\n` +
    `Pistas:\n${hints}\n` +
    `Frase dictada: ${parts.join(" ")}`;
  return { system, user };
}

/** Diferencias entre dos listas de palabras (subsecuencia común más larga): tramos a[i0,i1) → b[j0,j1). */
function hunks(a: string[], b: string[]): Array<{ i0: number; i1: number; j0: number; j1: number }> {
  const L: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Array<{ i0: number; i1: number; j0: number; j1: number }> = [];
  let i = 0, j = 0, open: { i0: number; j0: number } | null = null;
  const close = () => { if (open) { out.push({ i0: open.i0, i1: i, j0: open.j0, j1: j }); open = null; } };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { close(); i++; j++; continue; }
    if (!open) open = { i0: i, j0: j };
    if (j >= b.length || (i < a.length && L[i + 1][j] >= L[i][j + 1])) i++; else j++;
  }
  close();
  return out;
}

/**
 * Aplica de la frase del modelo solo los cambios que pasan la revisión, cada uno por separado: tiene que reemplazar algo
 * dudoso (no solo agregar), no tocar palabras seguras (a lo más una corta al lado), dejar palabras que existen y sonar
 * parecido a lo oído o ser una de las pistas. Mismas cifras o nada.
 */
export function applyRewrite(words: HeardWord[], spans: Span[], suspects: number[], raw: string, lx: Lexicon): { text: string; changes: string[] } | null {
  const line = String(raw ?? "").split("\n").map((l) => l.trim()).find((l) => l) ?? "";
  const out = line.replace(/^(frase( corregida| dictada)?|correcci[oó]n|texto)\s*:\s*/i, "").replace(/[⟦⟧]/g, "").replace(/^["«“']+|["»”']+$/g, "").trim();
  if (!out) return null;
  const bSurf = out.split(/\s+/).filter((t) => key(t));
  const a = words.map((w) => key(w.text)), b = bSurf.map(key);
  const digits = (xs: string[]) => xs.join(" ").match(/\d+/g)?.join(",") ?? "";
  if (digits(a) !== digits(b)) return null;
  const inSpan = (i: number) => spans.some((s) => i >= s.start && i < s.end);
  const sus = new Set(suspects);
  const allCands = new Set(spans.flatMap((s) => s.candidates.map(key)));
  const result: string[] = [];
  const changes: string[] = [];
  let at = 0;
  for (const h of hunks(a, b)) {
    for (; at < h.i0; at++) result.push(words[at].text);
    const oldW = words.slice(h.i0, h.i1), newW = bSurf.slice(h.j0, h.j1);
    const oldIdx = Array.from({ length: h.i1 - h.i0 }, (_, k) => h.i0 + k);
    const replacesSuspect = oldIdx.some((i) => sus.has(i));
    const touchesSafe = oldIdx.filter((i) => !inSpan(i) && isContent(words[i].text));
    const allExist = newW.every((t) => isKnown(t, lx));
    const oldJ = key(oldW.map((w) => w.text).join("")), newJ = key(newW.join(""));
    const po = phonWord(oldJ), pn = phonWord(newJ);
    // Suena parecido: a lo más un tercio de las letras distintas ("paralelepiteo" → paralelepípedo sí; "embueso" → espresso no)
    const closeSound = editDistance(po, pn, 99) <= Math.max(2, Math.floor(0.34 * Math.max(po.length, pn.length)));
    const isPista = allCands.has(newJ);
    // Si lo oído eran palabras que existen (Whisper solo dudó), el cambio tiene que ser una de las pistas por sonido:
    // si no, el modelo cambia "suiza" por "pizza" porque sí
    const oldReal = oldW.filter((w) => isContent(w.text)).every((w) => isKnown(w.text, lx));
    // ...y solo por una palabra del vocabulario de Eris o del usuario ("Forre" → Forge sí; "suiza" → pizza no)
    const inCore = newW.filter((t) => isContent(t)).every((t) => !!lx.core?.knows(key(t)));
    // Un alimento que no es del vocabulario del usuario entra solo si suena CASI igual: si no, se anotaría algo que no
    // comió ("Areea" (agrega) → "Avena")
    const newFood = newW.filter((t) => isContent(t)).some((t) => !lx.core?.knows(key(t)) && lx.indexes.some((ix) => ix !== lx.core && ix.knows(key(t))));
    const foodOk = !newFood || editDistance(po, pn, 2) <= 1;
    // Siempre tiene que sonar parecido: "compáltanle" (con palta y) no es "cumpleaños" aunque esté entre las pistas
    const ok = replacesSuspect && newW.length > 0 && touchesSafe.length === 0 && allExist && closeSound && foodOk && (!oldReal || (isPista && inCore));
    if (ok) {
      result.push(...newW);
      changes.push(`${oldW.map((w) => w.text).join(" ")} → ${newW.join(" ")}`);
    } else {
      result.push(...oldW.map((w) => w.text));
    }
    at = h.i1;
  }
  for (; at < words.length; at++) result.push(words[at].text);
  return changes.length ? { text: result.join(" "), changes } : null;
}

// ─── Todo junto ──────────────────────────────────────────────

export interface VoiceResult {
  /** lo que se entendió (lo que se manda al chat) */
  text: string;
  /** lo que Whisper oyó, tal cual */
  heard: string;
  /** qué se corrigió y cómo ("chocopiqui → Chocapic", "modelo: …") */
  fixes: string[];
  ms: { whisper: number; fix: number };
}

export interface VoiceDeps {
  transcribe: (prompt: string) => Promise<any>;
  indexes: Array<FoodIndex<unknown>>;
  /** vocabulario de Eris y del usuario (lexiconIndex): también va en `indexes` */
  core?: FoodIndex<unknown> | null;
  /** diccionario español (por defecto el del proyecto) */
  spanish?: SpanishWords | null;
  /** el modelo, para la capa 3 (null = sin ella) */
  llm?: ((system: string, user: string) => Promise<string>) | null;
}

export async function understandVoice(ctx: VoiceContext, deps: VoiceDeps): Promise<VoiceResult> {
  const prompt = buildWhisperPrompt(ctx);
  const t0 = Date.now();
  const json = await deps.transcribe(prompt);
  const tw = Date.now() - t0;
  let words = cleanHeard(heardWords(json), prompt);
  // Sin palabras con probabilidad (versión vieja de whisper-server): el texto tal cual
  if (!words.length && typeof json?.text === "string") {
    words = cleanHeard(json.text.trim().split(/\s+/).filter(Boolean).map((t: string) => ({ text: t, p: 1 })), prompt);
  }
  const heard = words.map((w) => w.text).join(" ");
  if (!words.length) return { text: "", heard: "", fixes: [], ms: { whisper: tw, fix: 0 } };

  const t1 = Date.now();
  const lx: Lexicon = { indexes: deps.indexes, core: deps.core ?? null, spanish: deps.spanish === undefined ? SpanishWords.shared() : deps.spanish };
  const bySound = fixBySound(words, lx);
  words = bySound.words;
  const fixes = [...bySound.fixes];
  let text = words.map((w) => w.text).join(" ");

  const suspects = suspectsOf(words, lx);
  if (deps.llm && suspects.length && words.length >= 2 && words.length <= 80) {
    const spans = spansOf(words, suspects, lx);
    const { system, user } = buildReinterpretPrompt(words, spans, ctx);
    try {
      const r = applyRewrite(words, spans, suspects, await deps.llm(system, user), lx);
      if (r) { text = r.text; fixes.push(...r.changes.map((c) => `modelo: ${c}`)); }
    } catch { /* sin el modelo, queda lo de las capas 1 y 2 */ }
  }
  return { text, heard, fixes, ms: { whisper: tw, fix: Date.now() - t1 } };
}
