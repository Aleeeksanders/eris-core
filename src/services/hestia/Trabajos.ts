// ============================================================
// Hestia como JARVIS · L4 (2026-11-18): los trabajos de fondo. «Hestia, investiga X y me avisas», «compárame A con B», «arma un
// resumen de la bóveda sobre Y»: quedan en una cola (en disco, sobrevive a un reinicio) y se hacen cuando el PC está libre
// (Presupuesto.ts): sin una llamada abierta, sin nadie usando el chat y con el equipo bajo sus límites. Uno a la vez.
// Más los vigías del PC, sin el modelo y baratos: «avísame cuando termine de compilar», «cuando termine el proceso X», «cuando
// se caiga Ollama», «cuando aparezca el archivo X en descargas».
// El resultado va al TELÉFONO (su regla: todo es para el celular): un chat de Hestia «Trabajos de Hestia» y el aviso (C3/C5). A la
// bóveda solo si él lo pide después («guárdalo en la bóveda»: vault_note con su aprobación), así la bóveda no se llena de búsquedas.
// Solo Hestia (Ikaros en Modo AXS).
// ============================================================
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as os from "node:os";

export type TipoTrabajo = "investigar" | "comparar" | "resumen_boveda" | "vigia_proceso" | "vigia_servicio" | "vigia_archivo";
export type EstadoTrabajo = "pendiente" | "corriendo" | "listo" | "fallo" | "cancelado";
export interface Fuente { titulo: string; url: string; resumen: string }

export interface Trabajo {
  id: string;
  tipo: TipoTrabajo;
  /** sobre qué («los mejores audífonos con cancelación de ruido»), o lo vigilado («compilar», «Ollama», «informe.pdf») */
  tema: string;
  /** comparar: el segundo */
  b?: string;
  /** cómo lo dijo */
  pedido: string;
  estado: EstadoTrabajo;
  creado: string;
  actualizado: string;
  /** lo que está haciendo ahora («buscando en la web»), para el panel y «¿cómo vas?» */
  paso?: string;
  progreso: number;
  /** lo ya hecho (si se interrumpe, no se repite) */
  datos?: { web?: Fuente[]; webB?: Fuente[]; webVs?: Fuente[]; boveda?: string[] };
  resultado?: { corto: string; texto: string; fuentes: Array<{ titulo: string; url: string }> };
  error?: string;
  intentos: number;
  /** el resultado ya llegó a su chat (si el servidor se reinició antes, se entrega al volver) */
  entregado?: boolean;
  /** vigías: los nombres de proceso, el servicio o la carpeta y el archivo */
  vigia?: { procesos?: string[]; servicio?: string; carpeta?: string; archivo?: string; hasta: string };
}

/** Lo que no termina en esto, se deja (vigías) */
export const VIGIA_HORAS = 6;
const MAX = 40;

const archivo = () => join(os.homedir(), ".eris", "hestia_trabajos.json");
let cache: Trabajo[] | null = null;
let cola: Promise<unknown> = Promise.resolve();

const esTrabajo = (x: any): x is Trabajo => x && typeof x.id === "string" && typeof x.tipo === "string" && typeof x.tema === "string" && typeof x.estado === "string";

export async function leerTrabajos(): Promise<Trabajo[]> {
  if (cache) return cache;
  try { const v = JSON.parse(await readFile(archivo(), "utf-8")); cache = Array.isArray(v) ? v.filter(esTrabajo) : []; } catch { cache = []; }
  // (un trabajo que quedó «corriendo» por un reinicio vuelve a la cola: lo hecho queda en `datos`)
  for (const t of cache) if (t.estado === "corriendo") t.estado = "pendiente";
  return cache;
}

/** Cambia la cola y la guarda de una vez (uno a la vez) */
export function cambiarTrabajos(f: (xs: Trabajo[]) => void): Promise<Trabajo[]> {
  const run = cola.then(async () => {
    const xs = structuredClone(await leerTrabajos());
    f(xs);
    // los terminados más viejos se van primero; los pendientes nunca se pierden
    const vivos = xs.filter((t) => t.estado === "pendiente" || t.estado === "corriendo");
    const hechos = xs.filter((t) => !vivos.includes(t)).sort((a, b) => a.actualizado.localeCompare(b.actualizado)).slice(-Math.max(5, MAX - vivos.length));
    const final = [...hechos, ...vivos].sort((a, b) => a.creado.localeCompare(b.creado));
    await mkdir(join(os.homedir(), ".eris"), { recursive: true });
    const tmp = `${archivo()}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(final, null, 1), "utf-8");
    for (let i = 0; ; i++) {
      try { await rename(tmp, archivo()); break; } catch (err: any) {
        if (i < 6 && ["EPERM", "EBUSY", "EACCES"].includes(err?.code)) { await new Promise((r) => setTimeout(r, 20 * (i + 1))); continue; }
        await unlink(tmp).catch(() => {});
        throw err;
      }
    }
    cache = final;
    return final;
  });
  cola = run.catch(() => {});
  return run;
}

export async function agregarTrabajo(t: Omit<Trabajo, "id" | "estado" | "creado" | "actualizado" | "progreso" | "intentos">, ahora = new Date()): Promise<Trabajo> {
  const nuevo: Trabajo = { ...t, id: `t${ahora.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, estado: "pendiente", creado: ahora.toISOString(), actualizado: ahora.toISOString(), progreso: 0, intentos: 0 };
  await cambiarTrabajos((xs) => { xs.push(nuevo); });
  return nuevo;
}

export async function actualizarTrabajo(id: string, patch: Partial<Trabajo>, ahora = new Date()): Promise<void> {
  await cambiarTrabajos((xs) => { const t = xs.find((x) => x.id === id); if (t) Object.assign(t, patch, { actualizado: ahora.toISOString() }); });
}

/** Cancela por id, por lo que se dijo («lo de los audífonos») o todos los pendientes; devuelve los cancelados */
export async function cancelarTrabajos(que: { id?: string; tema?: string; todos?: boolean }): Promise<Trabajo[]> {
  const out: Trabajo[] = [];
  const q = que.tema ? plegar(que.tema) : "";
  // («lo de los audífonos» calza con «los mejores audífonos con cancelación de ruido»: todas sus palabras con sentido están)
  const VACIAS = new Set(["el", "la", "los", "las", "lo", "de", "del", "un", "una", "con", "y", "a", "en", "sobre"]);
  const palabras = (s: string) => plegar(s).split(" ").filter((w) => w && !VACIAS.has(w));
  const pq = palabras(q);
  const calzaTema = (tema: string) => { const pt = palabras(tema); return pq.length > 0 && pq.every((w) => pt.some((x) => x === w || x.startsWith(w) || w.startsWith(x))); };
  await cambiarTrabajos((xs) => {
    for (const t of xs) {
      if (t.estado !== "pendiente" && t.estado !== "corriendo") continue;
      const calza = que.todos || (que.id && t.id === que.id) || (q && (calzaTema(t.tema) || (t.b && calzaTema(t.b)) || q.includes(plegar(t.tema))));
      if (calza) { t.estado = "cancelado"; t.actualizado = new Date().toISOString(); out.push({ ...t }); }
    }
  });
  return out;
}

/** El próximo de la cola (el más antiguo), sin los vigías (esos los revisa el reloj aparte) */
export function siguiente(xs: Trabajo[]): Trabajo | null {
  return xs.find((t) => t.estado === "pendiente" && !t.tipo.startsWith("vigia")) ?? null;
}

/** Para las pruebas: otro HOME */
export function _olvidarTrabajos(): void { cache = null; cola = Promise.resolve(); }

// ─── Lo que se le pide ───
export const plegar = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;:«»"]+/g, " ").replace(/\s+/g, " ").trim();
const sinHestia = (t: string) => t.replace(/^(?:(?:oye|ok|okey|ya|bueno|porfa) )?h?estia /, "").replace(/ (?:por favor|porfa|po)$/, "").trim();
const COLA = /(?:\s+(?:y (?:me avisas|avisame|me cuentas|despues me cuentas|me lo dejas|me lo mandas)|cuando puedas|con calma|en segundo plano|de fondo|para despues|mas tarde))+$/;

export type PedidoTrabajo =
  | { tipo: "investigar" | "resumen_boveda"; tema: string }
  | { tipo: "comparar"; tema: string; b: string }
  | { tipo: "vigia_proceso"; tema: string; procesos: string[] | null }
  | { tipo: "vigia_servicio"; tema: string; servicio: string }
  | { tipo: "vigia_archivo"; tema: string; carpeta: string; archivo: string }
  | { estado: true }
  | { cancelar: string | null; todos?: boolean };

/** El tema tal como lo dijo (con sus tildes y mayúsculas): las mismas palabras, del texto original */
export function delOriginal(original: string, plegado: string): string {
  const palabras = String(original ?? "").split(/\s+/).map((w) => ({ w: w.replace(/^[¿¡«"']+|[?!.,;:»"']+$/g, ""), k: plegar(w) })).filter((x) => x.w && x.k);
  const quiero = plegado.split(" ").filter(Boolean);
  for (let i = 0; i + quiero.length <= palabras.length; i++) {
    if (quiero.every((q, j) => palabras[i + j].k === q)) return palabras.slice(i, i + quiero.length).map((x) => x.w).join(" ");
  }
  return plegado;
}

const SERVICIOS: Record<string, string> = { ollama: "ollama", modelo: "ollama", whisper: "whisper", dictado: "whisper", piper: "piper", voz: "piper", servidor: "backend", backend: "backend", eris: "backend" };
const CARPETAS: Record<string, string> = { descargas: "Downloads", escritorio: "Desktop", documentos: "Documents" };
/** «compilar»: lo que compila en su PC (Gradle es Java; Bun, Node y tsc el servidor) */
export const COMPILADORES = ["java", "gradle", "kotlin", "tsc", "node", "bun", "cargo", "msbuild", "dotnet", "cl"];

export function pideTrabajo(texto: string): PedidoTrabajo | null {
  const t0 = sinHestia(plegar(texto));
  if (!t0 || t0.length > 200) return null;
  if (/^(?:en que estas trabajando|que estas haciendo de fondo|como (?:va|vas con) (?:lo que te pedi|eso|tus trabajos|los trabajos)|que trabajos tienes|tus trabajos|que tienes de fondo|que te pedi que investigaras|como va la investigacion)$/.test(t0)) return { estado: true };
  const can = /^(?:cancela|olvida|deja|para|suelta)(?:te)? (?:(todo lo de fondo|todos los trabajos|los trabajos|todo lo que te pedi)|(?:lo de(?:l)?|la investigacion (?:de(?:l)?|sobre)|el trabajo (?:de(?:l)?|sobre)|la comparacion de(?:l)?|el resumen (?:de(?:l)?|sobre)) (.{2,80}))$/.exec(t0);
  if (can) return can[1] ? { cancelar: null, todos: true } : { cancelar: delOriginal(texto, can[2]) };
  // los vigías del PC (sin el modelo)
  if (/^avisame (?:cuando|si) (?:termine|acabe|se termine) (?:de )?(?:compilar|la compilacion|el build|de buildear|la build)(?: en el (?:pc|computador))?$/.test(t0)) return { tipo: "vigia_proceso", tema: "compilar", procesos: null };
  const proc = /^avisame (?:cuando|si) (?:termine|acabe|se cierre|se termine) (?:el proceso|el programa) ([a-z0-9._-]{2,40})(?: en el (?:pc|computador))?$/.exec(t0);
  if (proc) return { tipo: "vigia_proceso", tema: proc[1], procesos: [proc[1].replace(/\.exe$/, "")] };
  const serv = /^avisame (?:cuando|si) (?:se cae|se caiga|se muere|se muera|deja de (?:andar|funcionar)) (?:el |la )?(ollama|modelo|whisper|dictado|piper|voz|servidor|backend|eris)(?: del (?:pc|computador))?$/.exec(t0);
  if (serv) return { tipo: "vigia_servicio", tema: serv[1], servicio: SERVICIOS[serv[1]] };
  // (el nombre del archivo con su punto: «informe.pdf»)
  const conPunto = sinHestia(String(texto ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[¿?¡!,;:«»"]+/g, " ").replace(/\.(?=\s|$)/g, " ").replace(/\s+/g, " ").trim());
  const arch = /^avisame cuando (?:aparezca|llegue|este|se descargue|termine de descargar(?:se)?) (?:el archivo |la descarga |el )?(.{2,60}?) (?:en|a) (?:la carpeta de |mis )?(descargas|escritorio|documentos)$/.exec(conPunto);
  if (arch) return { tipo: "vigia_archivo", tema: arch[1], carpeta: CARPETAS[arch[2]], archivo: arch[1] };
  // los que usan el modelo
  const cmp = /^(?:comparame|compara|haz(?:me)? una comparacion (?:de|entre)|que (?:es|sera) mejor(?: entre)?) (.{2,60}?) (?:con|y|vs|versus|contra|o) (.{2,60}?)$/.exec(t0.replace(COLA, ""));
  if (cmp && /^(?:comparame|compara|haz)/.test(t0)) return { tipo: "comparar", tema: delOriginal(texto, cmp[1]), b: delOriginal(texto, cmp[2]) };
  const res = /^(?:arma(?:me)?|haz(?:me)?|preparame|dame|escribeme) un resumen de (?:la boveda|lo que (?:hay|tengo) en la boveda|mis notas|las notas) (?:sobre|de|acerca de) (.{2,100})$/.exec(t0.replace(COLA, ""));
  if (res) return { tipo: "resumen_boveda", tema: delOriginal(texto, res[1]) };
  const inv = /^(?:investiga(?:me)?|investigame|averigua(?:me)?|averiguame|ponte a investigar|haz(?:me)? una investigacion (?:sobre|de)|busca(?:me)? (?:informacion|info) (?:sobre|de))(?: (?:sobre|de|acerca de|que onda con))? (.{3,120})$/.exec(t0.replace(COLA, ""));
  if (inv) return { tipo: "investigar", tema: delOriginal(texto, inv[1]) };
  // «busca X y me avisas» (con la cola: si no, es una búsqueda de ahora)
  const bus = /^(?:busca(?:me)?|revisa|mira) (.{3,120}?)$/.exec(t0.replace(COLA, ""));
  if (bus && COLA.test(t0) && !/\b(mensajes?|correos?|calendario|agenda|whatsapp|notificaciones)\b/.test(t0)) return { tipo: "investigar", tema: delOriginal(texto, bus[1]) };
  return null;
}

/** «Investigar los mejores audífonos…», «comparar A con B», «resumen de la bóveda sobre X», «avisarte cuando termine de compilar» */
export function queEs(t: Pick<Trabajo, "tipo" | "tema" | "b">): string {
  switch (t.tipo) {
    case "investigar": return `investigar ${t.tema}`;
    case "comparar": return `comparar ${t.tema} con ${t.b}`;
    case "resumen_boveda": return `el resumen de la bóveda sobre ${t.tema}`;
    case "vigia_proceso": return t.tema === "compilar" ? "avisarte cuando termine de compilar" : `avisarte cuando termine ${t.tema}`;
    case "vigia_servicio": return `avisarte si se cae ${t.tema}`;
    case "vigia_archivo": return `avisarte cuando aparezca ${t.tema}`;
  }
}

/** «¿En qué estás trabajando?» */
export function textoEstado(xs: Trabajo[], ahora = new Date()): string {
  const vivos = xs.filter((t) => t.estado === "corriendo" || t.estado === "pendiente");
  const recientes = xs.filter((t) => t.estado === "listo" && ahora.getTime() - Date.parse(t.actualizado) < 24 * 3_600_000);
  if (!vivos.length) return recientes.length ? `Nada pendiente. Hoy terminé ${recientes.length === 1 ? `una cosa: ${queEs(recientes[0])}` : `${recientes.length} cosas`}; está en el chat «Trabajos de Hestia».` : "No tengo nada de fondo ahora. Pídeme, por ejemplo, «investiga tal cosa y me avisas».";
  const ahoraT = vivos.find((t) => t.estado === "corriendo");
  const partes: string[] = [];
  if (ahoraT) partes.push(`Ahora estoy con ${queEs(ahoraT)}${ahoraT.paso ? ` (${ahoraT.paso})` : ""}.`);
  const enCola = vivos.filter((t) => t.estado === "pendiente");
  if (enCola.length) partes.push(`${ahoraT ? "Después" : "En cola"}: ${enCola.slice(0, 3).map(queEs).join("; ")}${enCola.length > 3 ? ` y ${enCola.length - 3} más` : ""}.`);
  return partes.join(" ");
}
