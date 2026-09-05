// ============================================================
// Eris — Memoria Persistente (Zero-Knowledge)
// Guarda conversaciones aisladas por perfil usando cifrado E2EE
// ============================================================

import { readFile, writeFile, mkdir, rename } from "fs/promises";
import { join } from "path";
import * as os from "os";
import type { Message } from "./types/message.js";
import { CryptoService, type KeyMaterial } from "./services/security/CryptoService.js";

const MEMORY_DIR = join(os.homedir(), ".eris");
const PROFILES_DIR = join(MEMORY_DIR, "profiles");

export interface Project {
  id: string;
  name: string;
  emoji: string;
  createdAt: string;
}

// ─── Historial médico ────────────────────────────────────────

export type ConditionId =
  | 'diabetes_t1' | 'diabetes_t2' | 'prediabetes'
  | 'hypertension' | 'hypotension'
  | 'hypothyroidism' | 'hyperthyroidism'
  | 'obesity' | 'dyslipidemia'
  | 'asthma' | 'copd'
  | 'ckd'        // enfermedad renal crónica
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
}

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
  /** Almacenamiento genérico clave-valor (no cifrado, para datos no sensibles como logs de nutrición) */
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  getConversation(sessionId: string): Message[];
  getConversationContext(sessionId: string, recentCount?: number): { summary: string | null; recentMessages: Message[] };
  getMessagesToSummarize(sessionId: string, keepRecent?: number): Message[] | null;
  updateSummary(sessionId: string, summary: string, summarizedUpTo: number): Promise<void>;
  saveConversation(sessionId: string, messages: Message[]): Promise<void>;
  clearConversation(sessionId: string): Promise<void>;
  listConversations(): any[];
  listProjects(): Project[];
  createProject(name: string, emoji?: string): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
  assignConversationToProject(conversationId: string, projectId: string | null): Promise<void>;
  renameProject(projectId: string, name: string, emoji?: string): Promise<void>;
  saveTrainingData(sessionId: string, messages: Message[]): Promise<void>;
}

const MAX_CONVERSATIONS = 50;
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

  async getProfile(): Promise<import('./memory.js').UserProfile | null> {
    try {
      const profileFile = join(this.profileDir, "profile.json");
      const raw = await readFile(profileFile, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async saveProfile(profile: import('./memory.js').UserProfile): Promise<void> {
    const profileFile = join(this.profileDir, "profile.json");
    await writeFile(profileFile, JSON.stringify(profile, null, 2), "utf-8");
  }

  /** Almacenamiento genérico clave-valor por perfil (no cifrado) */
  async get(key: string): Promise<any> {
    try {
      const file = join(this.profileDir, `kv_${key}.json`);
      const raw = await readFile(file, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async set(key: string, value: any): Promise<void> {
    try {
      await mkdir(this.profileDir, { recursive: true });
      const file = join(this.profileDir, `kv_${key}.json`);
      await writeFile(file, JSON.stringify(value, null, 2), "utf-8");
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
    if (conv.summary) {
      conv.summary = `${conv.summary}\n\n${summary}`;
    } else {
      conv.summary = summary;
    }
    conv.summaryUpTo = summarizedUpTo;
    await this.save();
  }

  async saveConversation(sessionId: string, messages: Message[]): Promise<void> {
    const existing = this.store.conversations.find((c) => c.id === sessionId);
    const trimmedMessages = messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
    const firstUserMsg = trimmedMessages.find((m) => m.role === "user");
    const title = firstUserMsg ? firstUserMsg.content.substring(0, 60) : "Conversación";

    if (existing) {
      existing.messages = trimmedMessages;
      existing.updatedAt = new Date().toISOString();
      existing.title = existing.title || title;
    } else {
      this.store.conversations.push({
        id: sessionId,
        messages: trimmedMessages,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        title,
      });
    }

    if (this.store.conversations.length > MAX_CONVERSATIONS) {
      this.store.conversations = this.store.conversations
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, MAX_CONVERSATIONS);
    }
    await this.save();
  }

  async clearConversation(sessionId: string): Promise<void> {
    this.store.conversations = this.store.conversations.filter((c) => c.id !== sessionId);
    await this.save();
  }

  listConversations(): Array<{ id: string; title: string; updatedAt: string; messageCount: number; projectId?: string; }> {
    return this.store.conversations
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((c) => ({
        id: c.id,
        title: c.title || "Conversación",
        updatedAt: c.updatedAt,
        messageCount: c.messages.length,
        projectId: c.projectId,
      }));
  }

  listProjects(): Project[] {
    return this.store.projects || [];
  }

  async createProject(name: string, emoji = "📁"): Promise<Project> {
    const project: Project = { id: crypto.randomUUID(), name, emoji, createdAt: new Date().toISOString() };
    this.store.projects.push(project);
    await this.save();
    return project;
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
      const filePath = join(this.trainingDir, "conversations.jsonl");
      // Cifrado de training omitido temporalmente, se guardará cifrado en el futuro o se cifra la línea
      const line = JSON.stringify(entry) + "\n";
      const encryptedLine = this.crypto.encrypt(line) + "\n";

      try {
        const existing = await readFile(filePath, "utf-8");
        await writeFile(filePath, existing + encryptedLine, "utf-8");
      } catch {
        await writeFile(filePath, encryptedLine, "utf-8");
      }
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
}
