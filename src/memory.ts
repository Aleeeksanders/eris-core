// ============================================================
// Eris — Memoria Persistente (Zero-Knowledge)
// Guarda conversaciones aisladas por perfil usando cifrado E2EE
// ============================================================

import { readFile, writeFile, mkdir, rename, unlink } from "fs/promises";
import { join } from "path";
import * as os from "os";
import type { Message } from "./types/message.js";
import { CryptoService, type KeyMaterial } from "./services/security/CryptoService.js";

const MEMORY_DIR = join(os.homedir(), ".eris");
const PROFILES_DIR = join(MEMORY_DIR, "profiles");

/** Largo máximo de las instrucciones de un proyecto: van en CADA consulta y el contexto del modelo local es chico. */

/**
 * Una clave de la memoria es un nombre, nunca una ruta (revisión 2026-10-31, S1): con «../» una clave llegaba a escribir
 * fuera del perfil (otro perfil, roles.json). Solo letras, números, espacios, «_», «-», «.» y «:», sin «..», y largo acotado.
 */
export function claveSegura(key: string): string {
  const k = String(key ?? "");
  if (!/^[A-Za-z0-9 _.:-]{1,120}$/.test(k) || k.includes("..")) throw new Error(`Clave de memoria no válida: ${k.slice(0, 40)}`);
  return k;
}

export const MAX_PROJECT_INSTRUCTIONS = 1500;

export interface Project {
  id: string;
  name: string;
  emoji: string;
  createdAt: string;
  /** Instrucciones fijas para todos los chats del proyecto (p. ej. "actúa como experto en finanzas personales"). */
  instructions?: string;
}

// ─── Historial médico ────────────────────────────────────────

export type ConditionId =
  | 'diabetes_t1' | 'diabetes_t2' | 'prediabetes'
  | 'hypertension' | 'hypotension'
  | 'hypothyroidism' | 'hyperthyroidism'
  | 'obesity' | 'dyslipidemia'
  | 'asthma' | 'copd'
  | 'ckd'        // enfermedad renal crónica
  | 'heart_failure' // insuficiencia cardíaca
  | 'celiac' | 'ibs'
  | 'depression' | 'anxiety'
  | 'other';

export const CONDITION_LABELS: Record<ConditionId, string> = {
  diabetes_t1:    'Diabetes Tipo 1',
  diabetes_t2:    'Diabetes Tipo 2',
  prediabetes:    'Prediabetes',
  hypertension:   'Hipertensión',
  hypotension:    'Hipotensión',
  hypothyroidism: 'Hipotiroidismo',
  hyperthyroidism:'Hipertiroidismo',
  obesity:        'Obesidad',
  dyslipidemia:   'Dislipidemia',
  asthma:         'Asma',
  copd:           'EPOC',
  ckd:            'Enfermedad Renal Crónica',
  heart_failure:  'Insuficiencia Cardíaca',
  celiac:         'Celiaquía',
  ibs:            'SII / Colon irritable',
  depression:     'Depresión',
  anxiety:        'Ansiedad / Estrés crónico',
  other:          'Otra',
};

export interface MedicalCondition {
  id: ConditionId;
  diagnosedDate?: string;   // YYYY-MM-DD
  notes?: string;
}

export type MedicationType =
  | 'insulin_rapid' | 'insulin_long' | 'insulin_mixed'
  | 'metformin' | 'sglt2' | 'glp1' | 'dpp4' | 'sulfonylurea'
  | 'antihypertensive' | 'diuretic' | 'beta_blocker'
  | 'levothyroxine' | 'statin'
  | 'antidepressant' | 'anxiolytic'
  | 'other';

export interface Medication {
  id: string;               // uuid
  name: string;
  type: MedicationType;
  dose?: string;            // ej: "10 UI", "500 mg"
  schedule?: string;        // ej: "mañana y noche", "antes de cada comida"
  active: boolean;
}

export interface AlertThresholds {
  glucoseLow: number;        // default 70 mg/dL
  glucoseHigh: number;       // default 180 mg/dL
  glucoseUrgentLow: number;  // default 55
  glucoseUrgentHigh: number; // default 250
  systolicHigh?: number;     // hipertensión: default 140 mmHg
  diastolicHigh?: number;    // default 90
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  glucoseLow: 70,
  glucoseHigh: 180,
  glucoseUrgentLow: 55,
  glucoseUrgentHigh: 250,
};

export interface MedicalProfile {
  conditions: MedicalCondition[];
  medications: Medication[];
  thresholds: AlertThresholds;
  bloodType?: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
  allergies?: string;        // texto libre
  /** Restricciones alimentarias estructuradas (ids: sin_gluten, sin_lactosa, sin_frutos_secos, sin_mani,
   *  sin_mariscos, sin_pescado, sin_huevo, sin_soya, vegetariano, vegano). Se suman a lo deducido de
   *  condiciones (celiaquía) y del texto libre de alergias — ver services/DietaryRestrictions.ts. */
  dietaryRestrictions?: string[];
  /** Exámenes que el usuario contó (HbA1c, colesterol…), con su fecha. Los guarda lab_results; la app los conserva al guardar el perfil. */
  labs?: LabResult[];
  /**
   * El historial médico (Inventario → Botiquín, 2026-10-22): consultas, exámenes, vacunas, procedimientos y otros eventos con
   * su fecha. Lo escribe SOLO `medical_history_add/delete` (guardar el perfil desde la app no lo pisa).
   */
  history?: MedicalEvent[];
}

export type MedicalEventType = 'consulta' | 'examen' | 'vacuna' | 'procedimiento' | 'urgencia' | 'evento';
export interface MedicalEvent {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  type: MedicalEventType;
  title: string;
  note?: string;
  addedAt: string;
}

export type LabTest = 'hba1c' | 'glucosa_ayunas' | 'colesterol_total' | 'ldl' | 'hdl' | 'trigliceridos' | 'creatinina';
export interface LabResult {
  test: LabTest;
  value: number;
  unit: string;
  /** YYYY-MM-DD (o YYYY-MM si solo dijo el mes) */
  date?: string;
  note?: string;
  addedAt: string;
}

// ─── Registro de insulina ─────────────────────────────────────

export type InsulinType = 'rapid' | 'long' | 'mixed';

export interface InsulinDose {
  id: string;
  timestamp: string;         // ISO
  type: InsulinType;
  units: number;
  glucoseAtTime?: number;    // mg/dL en el momento de la dosis
  notes?: string;
  mealContext?: 'fasting' | 'pre_meal' | 'post_meal' | 'correction';
}

// ─── Rollup diario (para baselines personales) ─────────────────

export interface DailyRollupEntry {
  date: string;           // YYYY-MM-DD local (ver localDateKey)
  sleepHours?: number;
  /** Sueño 2.0 · S0: lo dormido en la noche (sleepHours es el total del día: noche + segundo sueño + siestas) */
  sleepNightHours?: number;
  restingHR?: number;
  steps?: number;
  hydrationL?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  calories?: number;
  trained?: boolean;
  /** histórico (hasta 2026-10-22): ingresos − gastos del mes; ya no se escribe */
  disponible?: number;
  /** tu plata: efectivo + débito + ahorro (Finanzas) */
  plata?: number;
  ahorroAcum?: number;
  savingsRate?: number;
  moodScore?: number;     // 1-5, promedio de las entradas del bloc de notas ese día
  updatedAt: string;      // ISO, última actualización
}

export function localDateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface UserProfile {
  displayName: string;
  role?: string;
  goals?: string;
  language?: string;
  customContext?: string;
  medical?: MedicalProfile;
  integrations?: {
    libreView?: { email?: string; password?: string; region?: string };
    fatSecret?: { clientId?: string; clientSecret?: string };
  };
}

export interface StoredConversation {
  id: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  title?: string;
  summary?: string;
  summaryUpTo?: number;
  projectId?: string;
  /** Con quién es el chat: Eris (modo personal) o Hestia (Modo AXS / empresa). Sin marca = chat antiguo, se ve en ambos. */
  persona?: ChatPersona;
}

export type ChatPersona = "eris" | "hestia";

/**
 * Un chat con esta cantidad de respuestas de la asistente o menos es "temporal": cuando deja de ser el chat abierto se
 * muestra en la carpeta "Chats temporales" (no se borra). Si se retoma y pasa de esto, vuelve a la lista normal.
 */
export const TEMP_MAX_AI_REPLIES = 5;

/**
 * De quién parece un chat antiguo (sin marca), por lo que pidió el usuario: AXS, la bóveda, el PC o comandos → Hestia;
 * lo demás (comida, agua, sueño, plata, charla) → Eris. Sin mensajes: de ninguna (se ve en las dos listas). No cambia
 * nada guardado: la marca real la pone el primer mensaje nuevo.
 */
const HESTIA_TOPICS = /\b(axs|boveda|vault|obsidian|briefing|roadmap|lander|hestia|ikaros|servidor|comandos?|terminal|powershell|bash|script|archivos?|carpetas?|pc|reporte|bitacora|admin\w*|usuarios?|ollama|whisper|tailscale|proyectos?|inbox|cristaliz\w*|nota en la boveda)\b/;
export function inferPersona(messages: Message[]): ChatPersona | undefined {
  const said = messages.filter((m) => m.role === "user").slice(0, 20).map((m) => String(m.content ?? "")).join(" \n ");
  if (!said.trim()) return undefined;
  const t = said.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return HESTIA_TOPICS.test(t) ? "hestia" : "eris";
}

/** Respuestas de la asistente con texto (las llamadas a herramientas no cuentan). */
export const aiRepliesOf = (messages: Message[]) => messages.filter((m) => m.role === "assistant" && String(m.content ?? "").trim()).length;

export interface MemoryStore {
  version: number;
  conversations: StoredConversation[];
  projects: Project[];
}

export interface MemoryAdapter {
  load(): Promise<{ recoveryKey?: string } | void>;
  save(): Promise<void>;
  changePin(newPin: string): Promise<void>;
  getProfile(): Promise<UserProfile | null>;
  saveProfile(profile: UserProfile): Promise<void>;
  // ─── Insulina ────────────────────────────────────────────
  logInsulin(dose: InsulinDose): Promise<void>;
  getInsulinLog(limitDays?: number): Promise<InsulinDose[]>;
  deleteInsulinDose(id: string): Promise<void>;
  // ─── Rollup diario (baselines) ────────────────────────────
  /** `date` (YYYY-MM-DD local) para otro día que hoy (p. ej. el sueño de anteanoche); por defecto, hoy */
  upsertDailyRollup(partial: Partial<DailyRollupEntry>, date?: string): Promise<void>;
  fillDailyRollupGaps(entries: Array<Partial<DailyRollupEntry> & { date: string }>): Promise<number>;
  getDailyRollupLog(limitDays?: number): Promise<DailyRollupEntry[]>;
  /** Almacenamiento genérico clave-valor (no cifrado, para datos no sensibles como logs de nutrición) */
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  getConversation(sessionId: string): Message[];
  getConversationContext(sessionId: string, recentCount?: number): { summary: string | null; recentMessages: Message[] };
  getMessagesToSummarize(sessionId: string, keepRecent?: number): Message[] | null;
  updateSummary(sessionId: string, summary: string, summarizedUpTo: number): Promise<void>;
  saveConversation(sessionId: string, messages: Message[], persona?: ChatPersona): Promise<void>;
  /** Con quién es un chat guardado (undefined si no existe o es antiguo, sin marca). */
  conversationPersona(sessionId: string): ChatPersona | undefined;
  clearConversation(sessionId: string): Promise<void>;
  renameConversation(sessionId: string, title: string): Promise<void>;
  listConversations(): any[];
  listProjects(): Project[];
  createProject(name: string, emoji?: string, instructions?: string): Promise<Project>;
  updateProject(projectId: string, patch: { name?: string; emoji?: string; instructions?: string }): Promise<Project | undefined>;
  getProjectOfConversation(sessionId: string): Project | undefined;
  deleteProject(projectId: string): Promise<void>;
  assignConversationToProject(conversationId: string, projectId: string | null): Promise<void>;
  renameProject(projectId: string, name: string, emoji?: string): Promise<void>;
  saveTrainingData(sessionId: string, messages: Message[]): Promise<void>;
}

/**
 * Cifrado en reposo del perfil y de los datos del día (2026-10-15). Antes solo las conversaciones iban cifradas: el perfil
 * (condiciones, alergias, medicamentos) y los kv_* (comidas, agua, sueño, glucosa, finanzas, metas) quedaban en texto plano
 * en ~/.eris/profiles/<id>/. Ahora van con la misma llave maestra del perfil (AES-256-GCM), con este prefijo para
 * reconocerlos; los archivos viejos sin prefijo se siguen leyendo y se cifran al entrar (encryptAtRest).
 */
export const ENC_PREFIX = "ERISENC1:";

// Antes 50, y al pasarse se borraban los más viejos aunque fueran importantes. Con los chats temporales (cortos) se
// acumulan más: al pasar el tope se van primero los temporales más antiguos.
const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES_PER_CONVERSATION = 100;

export class FileSystemAdapter implements MemoryAdapter {
  private store: MemoryStore = { version: 2, conversations: [], projects: [] };
  private loaded = false;
  private profileDir: string;
  private conversationsFile: string;
  private keyFile: string;
  private trainingDir: string;
  private crypto: CryptoService;

  constructor(profileId: string = "default", private pin?: string) {
    this.profileDir = join(PROFILES_DIR, profileId);
    this.conversationsFile = join(this.profileDir, "conversations.json");
    this.keyFile = join(this.profileDir, "key.json");
    this.trainingDir = join(this.profileDir, "training");
    this.crypto = new CryptoService();
  }

  async load(): Promise<{ recoveryKey?: string } | void> {
    await mkdir(this.profileDir, { recursive: true });
    await mkdir(this.trainingDir, { recursive: true });

    let isNewProfile = false;
    let recoveryKeyToReturn: string | undefined = undefined;

    let keyMaterial: KeyMaterial;
    try {
      const kData = await readFile(this.keyFile, "utf-8");
      keyMaterial = JSON.parse(kData);
    } catch {
      // Perfil nuevo o migración
      if (!this.pin) {
        throw new Error('Se requiere un PIN de cifrado para inicializar el perfil.');
      }
      const initResult = this.crypto.initNewProfile(this.pin);
      keyMaterial = initResult.keyMaterial;
      recoveryKeyToReturn = initResult.recoveryKey;
      await writeFile(this.keyFile, JSON.stringify(keyMaterial), "utf-8");
      isNewProfile = true;
    }

    if (!isNewProfile && this.pin) {
      const unlocked = this.crypto.unlock(this.pin, keyMaterial);
      if (!unlocked) throw new Error("PIN o Llave de Recuperación incorrecto.");
    } else if (!isNewProfile && !this.pin) {
        throw new Error("Se requiere PIN para desbloquear el perfil.");
    }

    // Lo que quede en texto plano (perfil y kv_*) se cifra al entrar; un archivo que no calza queda como estaba.
    const enc = await this.encryptAtRest();
    if (enc.migrated) console.log(`[Memoria] ${enc.migrated} archivo(s) del perfil cifrados en reposo.`);
    if (enc.skipped.length) console.warn(`[Memoria] Quedan sin cifrar (sin tocar): ${enc.skipped.join("; ")}`);

    try {
      const rawData = await readFile(this.conversationsFile, "utf-8");
      const decryptedData = this.crypto.decrypt(rawData);
      this.store = JSON.parse(decryptedData);
      if (!this.store.projects) this.store.projects = [];
      this.loaded = true;
      if (recoveryKeyToReturn) return { recoveryKey: recoveryKeyToReturn };
    } catch (e: any) {
      if (e.message && e.message.includes('PIN')) {
        throw e; // Rechazar si el PIN es incorrecto
      }

      // Migración de datos legacy
      const globalLegacyFile = join(MEMORY_DIR, "conversations.json");
      try {
        const rawData = await readFile(globalLegacyFile, "utf-8");
        this.store = JSON.parse(rawData);
        if (!this.store.projects) this.store.projects = [];
        await this.save(); // Guarda cifrado en el nuevo perfil
        await rename(globalLegacyFile, globalLegacyFile + ".bak");
        console.log(`[Memoria] Migración exitosa de memoria legacy al perfil actual.`);
        this.loaded = true;
        if (recoveryKeyToReturn) return { recoveryKey: recoveryKeyToReturn };
      } catch (err) {
        // No hay archivo legacy o falló, crear nuevo
        this.store = { version: 2, conversations: [], projects: [] };
        this.loaded = true;
        if (recoveryKeyToReturn) return { recoveryKey: recoveryKeyToReturn };
      }
    }
  }

  async changePin(newPin: string): Promise<void> {
    const kData = await readFile(this.keyFile, "utf-8");
    const keyMaterial = JSON.parse(kData);
    const newMaterial = this.crypto.changePin(newPin, keyMaterial);
    await writeFile(this.keyFile, JSON.stringify(newMaterial), "utf-8");
    this.pin = newPin;
  }

  // ─── Cifrado en reposo (ver ENC_PREFIX) ───

  /** Lo que va al disco: cifrado. Sin llave NO se escribe en claro (antes `encrypt` devolvía el texto tal cual sin avisar). */
  private sealFile(json: string): string {
    if (!this.crypto.isUnlocked()) throw new Error("Perfil bloqueado: no se guarda sin cifrar.");
    return ENC_PREFIX + this.crypto.encrypt(json);
  }

  /** Lo que viene del disco: cifrado (con prefijo) o un archivo viejo en texto plano. */
  private openFile(raw: string): string {
    return raw.startsWith(ENC_PREFIX) ? this.crypto.decrypt(raw.slice(ENC_PREFIX.length)) : raw;
  }

  /** Escritura atómica: a un archivo temporal y luego se reemplaza de una vez (nadie lee nunca un archivo a medias). */
  private async writeAtomic(file: string, content: string): Promise<void> {
    await mkdir(this.profileDir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, content, "utf-8");
    for (let attempt = 0; ; attempt++) {
      try { await rename(tmp, file); return; } catch (e: any) {
        // En Windows el reemplazo falla si otro proceso tiene el archivo abierto en ese instante: se reintenta
        if (attempt < 6 && (e?.code === "EPERM" || e?.code === "EBUSY" || e?.code === "EACCES")) { await new Promise((r) => setTimeout(r, 20 * (attempt + 1))); continue; }
        await unlink(tmp).catch(() => {});
        throw e;
      }
    }
  }

  /**
   * Cifra los archivos del perfil que todavía están en texto plano (profile.json y kv_*.json) en `dir` (por defecto,
   * la carpeta del perfil; también sirve para un respaldo del mismo perfil). Cada archivo se cifra, se descifra de vuelta
   * y se compara con el original ANTES de reemplazarlo: si algo no calza, el original queda intacto.
   */
  async encryptAtRest(dir: string = this.profileDir): Promise<{ migrated: number; skipped: string[] }> {
    const { readdir } = await import("fs/promises");
    const out = { migrated: 0, skipped: [] as string[] };
    if (!this.crypto.isUnlocked()) return out;
    let names: string[] = [];
    try { names = await readdir(dir); } catch { return out; }
    for (const name of names) {
      if (name !== "profile.json" && !(name.startsWith("kv_") && name.endsWith(".json"))) continue;
      const file = join(dir, name);
      try {
        const raw = await readFile(file, "utf-8");
        if (raw.startsWith(ENC_PREFIX)) continue;
        const value = JSON.parse(raw); // un archivo dañado no se toca
        const sealed = this.sealFile(JSON.stringify(value));
        if (JSON.stringify(JSON.parse(this.openFile(sealed))) !== JSON.stringify(value)) throw new Error("no calza al descifrar");
        const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        await writeFile(tmp, sealed, "utf-8");
        // Lo escrito en disco también se verifica antes de reemplazar
        if (JSON.stringify(JSON.parse(this.openFile(await readFile(tmp, "utf-8")))) !== JSON.stringify(value)) { await unlink(tmp).catch(() => {}); throw new Error("no calza en disco"); }
        await rename(tmp, file);
        out.migrated++;
      } catch (e: any) {
        out.skipped.push(`${name}: ${e?.message ?? e}`);
      }
    }
    return out;
  }

  async getProfile(): Promise<import('./memory.js').UserProfile | null> {
    try {
      const profileFile = join(this.profileDir, "profile.json");
      const raw = await readFile(profileFile, "utf-8");
      return JSON.parse(this.openFile(raw));
    } catch (e: any) {
      if (e?.code !== "ENOENT") console.error(`[Memory] profile.json no se puede leer (dañado o no descifra): ${e?.message ?? e}`);
      return null;
    }
  }

  async saveProfile(profile: import('./memory.js').UserProfile): Promise<void> {
    const profileFile = join(this.profileDir, "profile.json");
    await this.writeAtomic(profileFile, this.sealFile(JSON.stringify(profile)));
  }

  /** Almacenamiento genérico clave-valor por perfil (cifrado en reposo desde 2026-10-15) */
  /**
   * null solo si la clave no existe. Antes CUALQUIER error devolvía null, también leer un archivo a medio escribir: quien
   * agregaba algo (el historial diario, el agua del día…) creía que estaba vacío y escribía encima solo lo nuevo. Así se
   * perdieron 17 días del historial diario el 2026-10-10, cuando dos actualizaciones de la app llegaron a la vez.
   * Ahora la escritura es atómica (ver set) y una lectura que no se puede interpretar se reintenta; si sigue fallando, lanza.
   */
  async get(key: string): Promise<any> {
    const file = join(this.profileDir, `kv_${claveSegura(key)}.json`);
    for (let attempt = 0; ; attempt++) {
      let raw: string;
      try {
        raw = await readFile(file, "utf-8");
      } catch (e: any) {
        if (e?.code === "ENOENT") return null;
        if (attempt < 4) { await new Promise((r) => setTimeout(r, 25 * (attempt + 1))); continue; }
        throw e;
      }
      try {
        return JSON.parse(this.openFile(raw));
      } catch (e) {
        if (attempt < 4) { await new Promise((r) => setTimeout(r, 25 * (attempt + 1))); continue; }
        console.error(`[Memory] La clave "${key}" no se puede leer (dañada o no descifra): no se toca`);
        throw e;
      }
    }
  }

  /** Escritura atómica y cifrada (ver writeAtomic y sealFile). */
  async set(key: string, value: any): Promise<void> {
    try {
      const file = join(this.profileDir, `kv_${claveSegura(key)}.json`);
      await this.writeAtomic(file, this.sealFile(JSON.stringify(value)));
    } catch (e) {
      console.error(`[Memory] Error guardando clave "${key}":`, e);
    }
  }

  async save(): Promise<void> {
    try {
      await mkdir(this.profileDir, { recursive: true });
      const jsonStr = JSON.stringify(this.store, null, 2);
      const encryptedData = this.crypto.encrypt(jsonStr);

      const writeFileAtomic = (await import("write-file-atomic")).default;
      await writeFileAtomic(this.conversationsFile, encryptedData, "utf-8");
    } catch (err) {
      console.error("Error guardando memoria cifrada:", err);
    }
  }

  getConversation(sessionId: string): Message[] {
    const conv = this.store.conversations.find((c) => c.id === sessionId);
    return conv ? conv.messages : [];
  }

  getConversationContext(sessionId: string, recentCount = 12): { summary: string | null; recentMessages: Message[] } {
    const conv = this.store.conversations.find((c) => c.id === sessionId);
    if (!conv) return { summary: null, recentMessages: [] };
    return {
      summary: conv.summary || null,
      recentMessages: conv.messages.slice(-recentCount),
    };
  }

  getMessagesToSummarize(sessionId: string, keepRecent = 6): Message[] | null {
    const conv = this.store.conversations.find((c) => c.id === sessionId);
    if (!conv) return null;
    const total = conv.messages.length;
    const summarizedUpTo = conv.summaryUpTo || 0;
    if (total - summarizedUpTo <= keepRecent + 4) return null;
    const endIdx = total - keepRecent;
    return conv.messages.slice(summarizedUpTo, endIdx);
  }

  async updateSummary(sessionId: string, summary: string, summarizedUpTo: number): Promise<void> {
    const conv = this.store.conversations.find((c) => c.id === sessionId);
    if (!conv) return;
    // El compresor ya integra el resumen anterior (se le pasa): se REEMPLAZA. Antes se pegaba detrás del viejo y el resumen
    // se duplicaba en cada compresión (revisión 2026-11-04, R4). Tope por si el modelo se alarga.
    conv.summary = summary.trim().slice(0, 4000);
    conv.summaryUpTo = summarizedUpTo;
    await this.save();
  }

  async saveConversation(sessionId: string, messages: Message[], persona?: ChatPersona): Promise<void> {
    const existing = this.store.conversations.find((c) => c.id === sessionId);
    const trimmedMessages = messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
    const firstUserMsg = trimmedMessages.find((m) => m.role === "user");
    const title = firstUserMsg ? firstUserMsg.content.substring(0, 60) : "Conversación";

    if (existing) {
      existing.messages = trimmedMessages;
      existing.updatedAt = new Date().toISOString();
      existing.title = existing.title || title;
      // Un chat antiguo (sin marca) pasa a ser de quien lo retome; uno marcado no cambia de dueña
      if (persona && !existing.persona) existing.persona = persona;
    } else {
      this.store.conversations.push({
        id: sessionId,
        messages: trimmedMessages,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        title,
        ...(persona ? { persona } : {}),
      });
    }

    if (this.store.conversations.length > MAX_CONVERSATIONS) {
      // Primero se van los temporales más antiguos (cortos y sin proyecto); recién después, los más antiguos en general
      const temp = (c: StoredConversation) => !c.projectId && aiRepliesOf(c.messages) <= TEMP_MAX_AI_REPLIES;
      const byAge = [...this.store.conversations].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
      const drop = new Set<string>();
      for (const c of byAge) { if (this.store.conversations.length - drop.size <= MAX_CONVERSATIONS) break; if (temp(c) && c.id !== sessionId) drop.add(c.id); }
      for (const c of byAge) { if (this.store.conversations.length - drop.size <= MAX_CONVERSATIONS) break; if (c.id !== sessionId) drop.add(c.id); }
      this.store.conversations = this.store.conversations.filter((c) => !drop.has(c.id));
    }
    await this.save();
  }

  conversationPersona(sessionId: string): ChatPersona | undefined {
    return this.store.conversations.find((c) => c.id === sessionId)?.persona;
  }

  async clearConversation(sessionId: string): Promise<void> {
    this.store.conversations = this.store.conversations.filter((c) => c.id !== sessionId);
    await this.save();
  }

  async renameConversation(sessionId: string, title: string): Promise<void> {
    const conv = this.store.conversations.find((c) => c.id === sessionId);
    if (!conv) return;
    conv.title = title.trim().substring(0, 60) || conv.title;
    await this.save();
  }

  listConversations(): Array<{ id: string; title: string; updatedAt: string; messageCount: number; projectId?: string; persona?: ChatPersona; inferredPersona?: ChatPersona; aiReplies: number }> {
    return this.store.conversations
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((c) => ({
        id: c.id,
        title: c.title || "Conversación",
        updatedAt: c.updatedAt,
        messageCount: c.messages.length,
        projectId: c.projectId,
        persona: c.persona,
        inferredPersona: c.persona ? undefined : inferPersona(c.messages),
        aiReplies: aiRepliesOf(c.messages),
      }));
  }

  listProjects(): Project[] {
    return this.store.projects || [];
  }

  async createProject(name: string, emoji = "📁", instructions?: string): Promise<Project> {
    const project: Project = { id: crypto.randomUUID(), name, emoji, createdAt: new Date().toISOString() };
    const ins = (instructions ?? "").trim().slice(0, MAX_PROJECT_INSTRUCTIONS);
    if (ins) project.instructions = ins;
    this.store.projects.push(project);
    await this.save();
    return project;
  }

  /** Cambia nombre, emoji y/o instrucciones; solo toca lo que viene en `patch` (instructions "" las borra). */
  async updateProject(projectId: string, patch: { name?: string; emoji?: string; instructions?: string }): Promise<Project | undefined> {
    const p = this.store.projects.find((p) => p.id === projectId);
    if (!p) return undefined;
    if (patch.name !== undefined && patch.name.trim()) p.name = patch.name.trim();
    if (patch.emoji) p.emoji = patch.emoji;
    if (patch.instructions !== undefined) {
      const ins = patch.instructions.trim().slice(0, MAX_PROJECT_INSTRUCTIONS);
      if (ins) p.instructions = ins; else delete p.instructions;
    }
    await this.save();
    return p;
  }

  /** Proyecto al que pertenece una conversación (undefined si es un chat suelto). */
  getProjectOfConversation(sessionId: string): Project | undefined {
    const conv = this.store.conversations.find((c) => c.id === sessionId);
    if (!conv?.projectId) return undefined;
    return this.store.projects.find((p) => p.id === conv.projectId);
  }

  async deleteProject(projectId: string): Promise<void> {
    for (const conv of this.store.conversations) {
      if (conv.projectId === projectId) conv.projectId = undefined;
    }
    this.store.projects = this.store.projects.filter((p) => p.id !== projectId);
    await this.save();
  }

  async assignConversationToProject(conversationId: string, projectId: string | null): Promise<void> {
    const conv = this.store.conversations.find((c) => c.id === conversationId);
    if (!conv) return;
    conv.projectId = projectId ?? undefined;
    await this.save();
  }

  async renameProject(projectId: string, name: string, emoji?: string): Promise<void> {
    const p = this.store.projects.find((p) => p.id === projectId);
    if (!p) return;
    p.name = name;
    if (emoji) p.emoji = emoji;
    await this.save();
  }

  async saveTrainingData(sessionId: string, messages: Message[]): Promise<void> {
    try {
      await mkdir(this.trainingDir, { recursive: true });
      const cleanMessages = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() }))
        .filter((m) => m.content.length > 0);

      if (cleanMessages.length < 2) return;

      const entry = { id: sessionId, timestamp: new Date().toISOString(), approved: false, messages: cleanMessages };
      // Un archivo por conversación, con su última versión. Antes se agregaba la conversación ENTERA en cada turno a un solo
      // archivo que además se leía completo para reescribirlo: crecía al cuadrado (860 KB en un perfil) y cada respuesta lo
      // releía (revisión 2026-11-04, R4). conversations.jsonl queda como estaba (lo antiguo).
      const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "sin_id";
      const filePath = join(this.trainingDir, `sesion_${safe}.jsonl`);
      const line = JSON.stringify(entry) + "\n";
      await writeFile(filePath, this.crypto.encrypt(line) + "\n", "utf-8");
    } catch (err) {
      console.error("Error guardando training data:", err);
    }
  }

  // ─── Insulina ────────────────────────────────────────────────

  async logInsulin(dose: InsulinDose): Promise<void> {
    const existing: InsulinDose[] = await this.get('insulin_log') || [];
    existing.unshift(dose);
    // Mantener máximo 500 registros (~1 año con 4 dosis/día)
    await this.set('insulin_log', existing.slice(0, 500));
  }

  async getInsulinLog(limitDays = 7): Promise<InsulinDose[]> {
    const all: InsulinDose[] = await this.get('insulin_log') || [];
    const cutoff = new Date(Date.now() - limitDays * 86_400_000).toISOString();
    return all.filter(d => d.timestamp >= cutoff);
  }

  async deleteInsulinDose(id: string): Promise<void> {
    const existing: InsulinDose[] = await this.get('insulin_log') || [];
    await this.set('insulin_log', existing.filter(d => d.id !== id));
  }

  // ─── Rollup diario (baselines) ────────────────────────────

  /** Las actualizaciones del historial diario van en fila: dos a la vez se pisaban (leer-modificar-escribir). */
  private rollupQueue: Promise<void> = Promise.resolve();

  upsertDailyRollup(partial: Partial<DailyRollupEntry>, date?: string): Promise<void> {
    const run = this.rollupQueue.then(() => this.upsertDailyRollupNow(partial, date));
    this.rollupQueue = run.catch(() => {});
    return run;
  }

  /**
   * Rellena el historial con días anteriores que manda el teléfono (Health Connect): solo días y campos que faltan; lo que
   * ya está no se toca. Va en la misma fila que upsertDailyRollup. Devuelve cuántos días se agregaron o completaron.
   */
  fillDailyRollupGaps(entries: Array<Partial<DailyRollupEntry> & { date: string }>): Promise<number> {
    const run = this.rollupQueue.then(async () => {
      const existing: DailyRollupEntry[] = (await this.get('daily_rollup_log')) || [];
      const byDate = new Map(existing.map((e) => [e.date, e]));
      const today = localDateKey();
      let changed = 0;
      for (const raw of entries) {
        if (!raw?.date || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || raw.date >= today) continue;
        const cur = byDate.get(raw.date);
        const add = Object.fromEntries(Object.entries(raw).filter(([k, v]) => k !== 'date' && v !== undefined && v !== null && (cur as any)?.[k] === undefined));
        if (!Object.keys(add).length) continue;
        byDate.set(raw.date, { ...(cur ?? { date: raw.date }), ...add, updatedAt: cur?.updatedAt ?? new Date().toISOString() } as DailyRollupEntry);
        changed++;
      }
      if (changed) await this.set('daily_rollup_log', [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 180));
      return changed;
    });
    this.rollupQueue = run.then(() => {}, () => {});
    return run;
  }

  private async upsertDailyRollupNow(partial: Partial<DailyRollupEntry>, date?: string): Promise<void> {
    const today = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDateKey();
    // Si no se puede leer, get lanza y NO se escribe (antes un error de lectura dejaba el historial con solo el día de hoy)
    const existing: DailyRollupEntry[] = (await this.get('daily_rollup_log')) || [];
    const clean = Object.fromEntries(
      Object.entries(partial).filter(([, v]) => v !== undefined && v !== null && !Number.isNaN(v as any))
    );
    const idx = existing.findIndex(e => e.date === today);
    if (idx >= 0) {
      existing[idx] = { ...existing[idx], ...clean, date: today, updatedAt: new Date().toISOString() };
    } else {
      existing.unshift({ date: today, updatedAt: new Date().toISOString(), ...clean } as DailyRollupEntry);
    }
    existing.sort((a, b) => b.date.localeCompare(a.date));
    await this.set('daily_rollup_log', existing.slice(0, 180));
  }

  async getDailyRollupLog(limitDays = 180): Promise<DailyRollupEntry[]> {
    const all: DailyRollupEntry[] = await this.get('daily_rollup_log') || [];
    const cutoff = localDateKey(Date.now() - limitDays * 86_400_000);
    return all.filter(e => e.date >= cutoff);
  }
}
