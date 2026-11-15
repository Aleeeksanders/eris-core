// ============================================================
// Eris — Medición de la beta (2026-11-11)
//
// Cuenta, por persona y por día, CUÁNTO se usa Eris; nunca QUÉ se escribe, come, gasta ni nada de su salud:
//   · cuántas veces abrió la app y cuántas cosas hizo (mensajes, anotar, buscar, tocar un botón del plan…);
//   · cuántos mensajes al chat, cuántos por voz y cuántos pasaron por el modelo (el resto lo responde el código);
//   · cuánto trabajó el PC: segundos del modelo (por chat, voz o tareas laterales), espera en cola, Whisper y Piper,
//     y en qué hora del día (para la hora punta);
//   · qué módulos anotó ese día (cuántas comidas, cuánta agua, si anotó sueño o entreno…): solo números.
//
// Las personas van con un alias (HMAC del perfil con la llave del servidor): los archivos y el informe no dicen quién es.
// Quien apaga «Ayudar a mejorar Eris» en Perfil queda fuera y sus días se borran.
// Archivos en ~/.eris/metricas: perfiles.json (alta, rol, grupo) y uso-AAAA-MM.json (los días).
// El informe (cohortes, retención, uso del PC) sale de services/BetaReport.ts.
// ============================================================

import { createHmac } from "crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import { join } from "path";

/** Lo que se anota de un día de una persona. Todo son conteos o tiempos. */
export interface DiaUso {
  /** Cosas que solo hace una persona: mensajes, anotar, buscar un alimento, tocar «Lo comí ✓»… */
  acciones: number;
  /** Inicios de sesión o reconexiones (la app abierta, o un aviso que se tocó). */
  conexiones: number;
  /** Mensajes al chat, escritos o hablados. */
  mensajes: number;
  voz: number;
  /** Respuestas que pasaron por el modelo (al menos una llamada); el resto las dio el código. */
  porModelo: number;
  /** Suma de los tiempos de respuesta del chat, en ms, y cuántas por tramo (ver TRAMOS_S). */
  msRespuesta: number;
  tramos: Record<string, number>;
  /** Trabajo del modelo en ms, por tipo, y llamadas. */
  modelo: { chat: number; voz: number; lateral: number };
  llamadas: number;
  esperaMs: number;
  whisperMs: number;
  piperMs: number;
  /** Trabajo del modelo por hora del día (0–23), en ms. */
  horas: Record<string, number>;
  /** Lo que anotó ese día, en números: máximos del día (comidas, agua) o cuántas veces (el resto). */
  reg: Partial<Record<Registro, number>>;
}

export type Registro = "comidas" | "aguaMl" | "sueno" | "entreno" | "finanzas" | "inventario" | "suplementos" | "forge" | "plan";
/** Registros que valen por el máximo del día (el teléfono manda el total); los demás se suman. */
const POR_MAXIMO = new Set<Registro>(["comidas", "aguaMl", "sueno", "entreno"]);

export type Grupo = "beta" | "pagado" | "equipo";
export interface PerfilUso {
  /** Día de alta (de la cuenta de Google, o el primero que se vio). */
  alta: string;
  rol: string;
  grupo?: Grupo;
  /** Desde qué día paga (grupo «pagado»). */
  pagoDesde?: string;
  /** Apagó la medición: no se anota nada y sus días se borraron. */
  fuera?: boolean;
  visto: string;
}

/** Tramos del tiempo de respuesta del chat, en segundos (el último es «más de 160»). */
export const TRAMOS_S = [1, 2, 5, 10, 20, 40, 80, 160];
/** Alias del trabajo del modelo que no es de nadie (precarga, tareas del servidor). */
export const SISTEMA = "_sistema";

/** Mensajes del teléfono que solo manda una persona haciendo algo (no las sincronizaciones automáticas). */
export const ACCIONES = new Set([
  "message", "voice_message", "log_water_quick", "food_search", "food_barcode", "food_barcode_contribute", "check_food_safety",
  "check_food_similarity", "delete_nutrition_entry", "set_nutrition_goals", "day_plan_request", "set_tone", "set_training_intent",
  "finance_statement_parse", "finance_receipt_photo", "finance_balance_photo", "add_journal_entry", "delete_user_note",
  "medical_history_add", "medical_history_delete", "save_profile", "new_chat", "sleep_tramo", "sleep_wake_decision",
  "request_about_me", "nudge_suggest", "stop", "tts_request",
]);

export function diaVacio(): DiaUso {
  return {
    acciones: 0, conexiones: 0, mensajes: 0, voz: 0, porModelo: 0, msRespuesta: 0, tramos: {},
    modelo: { chat: 0, voz: 0, lateral: 0 }, llamadas: 0, esperaMs: 0, whisperMs: 0, piperMs: 0, horas: {}, reg: {},
  };
}

export const diaLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const esDia = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function tramoDe(ms: number): string {
  const s = ms / 1000;
  for (const t of TRAMOS_S) if (s <= t) return String(t);
  return "mas";
}

export interface BetaMetricsDeps {
  dir: string;
  /** Llave del servidor para el alias (la misma que abre los perfiles con Google). */
  secreto: () => Promise<Buffer>;
  ahora?: () => Date;
  /** Cada cuánto se guarda lo anotado (ms). */
  cadaMs?: number;
}

type Mes = Record<string, Record<string, DiaUso>>;

export class BetaMetrics {
  private perfiles: Record<string, PerfilUso> | null = null;
  private meses = new Map<string, Mes>();
  private sucios = new Set<string>();
  private perfilesSucio = false;
  private aliases = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private guardando: Promise<void> = Promise.resolve();
  private ahora: () => Date;

  constructor(private d: BetaMetricsDeps) {
    this.ahora = d.ahora ?? (() => new Date());
  }

  // ─── Alias ───
  async alias(profileId: string): Promise<string> {
    const hit = this.aliases.get(profileId);
    if (hit) return hit;
    const a = createHmac("sha256", await this.d.secreto()).update(`uso:${profileId}`).digest("base64url").slice(0, 12);
    this.aliases.set(profileId, a);
    return a;
  }

  // ─── Registro de perfiles ───
  private async cargarPerfiles(): Promise<Record<string, PerfilUso>> {
    if (this.perfiles) return this.perfiles;
    try { this.perfiles = JSON.parse(await readFile(join(this.d.dir, "perfiles.json"), "utf-8")) || {}; } catch { this.perfiles = {}; }
    return this.perfiles!;
  }

  /** Al iniciar sesión: alta, rol y una conexión más. */
  async conectar(profileId: string, info: { rol: string; alta?: string }): Promise<void> {
    const a = await this.alias(profileId);
    const ps = await this.cargarPerfiles();
    const hoy = diaLocal(this.ahora());
    const alta = info.alta && !Number.isNaN(Date.parse(info.alta)) ? diaLocal(new Date(info.alta)) : undefined;
    const p = ps[a];
    if (!p) ps[a] = { alta: alta ?? hoy, rol: info.rol, visto: hoy };
    else {
      if (alta && alta < p.alta) p.alta = alta;
      p.rol = info.rol;
      p.visto = hoy;
    }
    this.perfilesSucio = true;
    if (ps[a].fuera) { this.programar(); return; }
    (await this.diaDe(a)).conexiones++;
    this.programar();
  }

  async estaFuera(profileId: string): Promise<boolean> {
    const ps = await this.cargarPerfiles();
    return !!ps[await this.alias(profileId)]?.fuera;
  }

  /** «Ayudar a mejorar Eris» apagado: se deja de anotar y se borra lo anotado. Encendido: vuelve a contar desde hoy. */
  async setFuera(profileId: string, fuera: boolean): Promise<void> {
    const a = await this.alias(profileId);
    const ps = await this.cargarPerfiles();
    const hoy = diaLocal(this.ahora());
    if (!ps[a]) ps[a] = { alta: hoy, rol: "eris", visto: hoy };
    if (fuera) {
      ps[a].fuera = true;
      for (const mes of await this.listaMeses()) {
        const m = await this.cargarMes(mes);
        if (m[a]) { delete m[a]; this.sucios.add(mes); }
      }
    } else delete ps[a].fuera;
    this.perfilesSucio = true;
    this.programar();
  }

  /** El administrador marca a quién cuenta la beta: beta (gratis), pagado (desde hoy) o equipo (no cuenta). */
  async setGrupo(profileId: string, grupo: Grupo): Promise<PerfilUso> {
    const a = await this.alias(profileId);
    const ps = await this.cargarPerfiles();
    const hoy = diaLocal(this.ahora());
    if (!ps[a]) ps[a] = { alta: hoy, rol: "eris", visto: hoy };
    ps[a].grupo = grupo;
    if (grupo === "pagado") ps[a].pagoDesde = ps[a].pagoDesde ?? hoy; else delete ps[a].pagoDesde;
    this.perfilesSucio = true;
    this.programar();
    return ps[a];
  }

  async grupoDe(profileId: string): Promise<Grupo | undefined> {
    const ps = await this.cargarPerfiles();
    return ps[await this.alias(profileId)]?.grupo;
  }

  // ─── Lo que se anota ───
  private async diaDe(a: string, dia?: string): Promise<DiaUso> {
    const key = esDia(dia) ? dia : diaLocal(this.ahora());
    const mes = key.slice(0, 7);
    const m = await this.cargarMes(mes);
    const fila = (m[a] ??= {});
    this.sucios.add(mes);
    return (fila[key] ??= diaVacio());
  }

  /** null si la persona apagó la medición. */
  private async aliasActivo(profileId: string | null): Promise<string | null> {
    if (!profileId) return SISTEMA;
    const a = await this.alias(profileId);
    const ps = await this.cargarPerfiles();
    return ps[a]?.fuera ? null : a;
  }

  async accion(profileId: string, tipo: string): Promise<void> {
    if (!ACCIONES.has(tipo)) return;
    const a = await this.aliasActivo(profileId);
    if (!a) return;
    (await this.diaDe(a)).acciones++;
    this.programar();
  }

  /** Una respuesta del chat terminada. */
  async chat(profileId: string, r: { voz: boolean; porModelo: boolean; ms: number }): Promise<void> {
    const a = await this.aliasActivo(profileId);
    if (!a) return;
    const d = await this.diaDe(a);
    d.mensajes++;
    if (r.voz) d.voz++;
    if (r.porModelo) d.porModelo++;
    const ms = Math.max(0, Math.round(r.ms));
    d.msRespuesta += ms;
    const t = tramoDe(ms);
    d.tramos[t] = (d.tramos[t] ?? 0) + 1;
    this.programar();
  }

  /** Una llamada al modelo (la avisa services/llm/ModelMeter.ts). */
  async modelo(profileId: string | null, l: { tipo: "chat" | "voz" | "lateral"; modeloMs: number; esperaMs: number }): Promise<void> {
    const a = await this.aliasActivo(profileId);
    if (!a) return;
    const d = await this.diaDe(a);
    const ms = Math.max(0, Math.round(l.modeloMs));
    d.modelo[l.tipo] += ms;
    d.llamadas++;
    d.esperaMs += Math.max(0, Math.round(l.esperaMs));
    const h = String(this.ahora().getHours());
    d.horas[h] = (d.horas[h] ?? 0) + ms;
    this.programar();
  }

  /** Lo que tardaron Whisper (oír) o Piper (hablar). */
  async voz(profileId: string, r: { whisperMs?: number; piperMs?: number }): Promise<void> {
    const a = await this.aliasActivo(profileId);
    if (!a) return;
    const d = await this.diaDe(a);
    if (r.whisperMs) d.whisperMs += Math.max(0, Math.round(r.whisperMs));
    if (r.piperMs) d.piperMs += Math.max(0, Math.round(r.piperMs));
    this.programar();
  }

  /**
   * Lo que anotó: un número, nunca el detalle. Comidas y agua van por el máximo del día que manda el teléfono (el total
   * del día); el resto suma uno por vez. `dia`: el día al que cuenta (la comida de las 2 AM sin haber dormido es de ayer).
   */
  async registro(profileId: string, r: Registro, valor = 1, dia?: string): Promise<void> {
    if (!Number.isFinite(valor) || valor <= 0) return;
    const a = await this.aliasActivo(profileId);
    if (!a) return;
    const d = await this.diaDe(a, dia);
    d.reg[r] = POR_MAXIMO.has(r) ? Math.max(d.reg[r] ?? 0, Math.round(valor)) : (d.reg[r] ?? 0) + 1;
    this.programar();
  }

  // ─── Disco ───
  private async listaMeses(): Promise<string[]> {
    let nombres: string[] = [];
    try { nombres = await readdir(this.d.dir); } catch {}
    const enDisco = nombres.map((n) => /^uso-(\d{4}-\d{2})\.json$/.exec(n)?.[1]).filter((x): x is string => !!x);
    return [...new Set([...enDisco, ...this.meses.keys()])].sort();
  }

  private async cargarMes(mes: string): Promise<Mes> {
    const hit = this.meses.get(mes);
    if (hit) return hit;
    let m: Mes = {};
    try { m = JSON.parse(await readFile(join(this.d.dir, `uso-${mes}.json`), "utf-8")) || {}; } catch {}
    this.meses.set(mes, m);
    return m;
  }

  private programar() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.guardar(); }, this.d.cadaMs ?? 20_000);
    (this.timer as any).unref?.();
  }

  /** Guarda lo pendiente (escritura atómica: nunca queda un archivo a medias). */
  async guardar(): Promise<void> {
    this.guardando = this.guardando.then(async () => {
      const tareas: Array<[string, unknown]> = [];
      if (this.perfilesSucio && this.perfiles) { tareas.push(["perfiles.json", this.perfiles]); this.perfilesSucio = false; }
      for (const mes of this.sucios) tareas.push([`uso-${mes}.json`, this.meses.get(mes) ?? {}]);
      this.sucios.clear();
      if (!tareas.length) return;
      await mkdir(this.d.dir, { recursive: true });
      for (const [nombre, valor] of tareas) {
        const file = join(this.d.dir, nombre);
        const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        try {
          await writeFile(tmp, JSON.stringify(valor), "utf-8");
          for (let i = 0; ; i++) {
            try { await rename(tmp, file); break; } catch (e: any) {
              if (i < 6 && (e?.code === "EPERM" || e?.code === "EBUSY" || e?.code === "EACCES")) { await new Promise((r) => setTimeout(r, 20 * (i + 1))); continue; }
              throw e;
            }
          }
        } catch (e) {
          await unlink(tmp).catch(() => {});
          console.warn(`[Uso] No pude guardar ${nombre}:`, e);
        }
      }
    }).catch(() => {});
    return this.guardando;
  }

  /** Todo lo anotado, para el informe. */
  async datos(): Promise<{ perfiles: Record<string, PerfilUso>; dias: Record<string, Record<string, DiaUso>> }> {
    const perfiles = await this.cargarPerfiles();
    const dias: Record<string, Record<string, DiaUso>> = {};
    for (const mes of await this.listaMeses()) {
      const m = await this.cargarMes(mes);
      for (const [a, fila] of Object.entries(m)) Object.assign((dias[a] ??= {}), fila);
    }
    return { perfiles: JSON.parse(JSON.stringify(perfiles)), dias: JSON.parse(JSON.stringify(dias)) };
  }
}

/** Para leer lo guardado sin el servidor (scripts/beta/informe.ts): no necesita la llave, los archivos ya van con alias. */
export async function leerMetricas(dir: string): Promise<{ perfiles: Record<string, PerfilUso>; dias: Record<string, Record<string, DiaUso>> }> {
  const bm = new BetaMetrics({ dir, secreto: async () => Buffer.alloc(32) });
  return bm.datos();
}
