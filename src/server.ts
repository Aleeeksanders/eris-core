// ============================================================
// Eris — Web Server
// Servidor HTTP + WebSocket con proyectos + compresión de contexto
// Soporta perfiles múltiples aislados (Zero-Knowledge)
// ============================================================

import { QueryEngine } from "./QueryEngine.js";
import { ToolRegistry } from "./tools.js";
import { OllamaProvider } from "./services/llm/OllamaProvider.js";
import { WhisperProvider } from "./services/stt/WhisperProvider.js";
import { VozSesion } from "./services/voz/VozSesion.js";
import { claseAprobacion, preguntaHablada, respuestaSiNo, type ClaseAprobacion } from "./services/voz/AprobacionVoz.js";
import { respuestaDirecta } from "./services/voz/Directas.js";
import { resumenLlamada, guardarLlamada, llamadaReciente, CLAVE_LLAMADAS, type EventoLlamada } from "./services/voz/ResumenLlamada.js";
import { armarSaludo, detalleSaludo } from "./services/voz/Saludo.js";
import { immediateRoadmap } from "./services/vault/VaultBriefing.js";
import { afinarVoz, mencionaAntes } from "./services/voz/RutaVoz.js";
import { CacheVoz, ARRANQUES } from "./services/voz/CacheVoz.js";
import { paraHablar } from "./services/voz/Hablar.js";
import { PiperProvider } from "./services/tts/PiperProvider.js";
import { buildSpokenVersion } from "./services/SpokenVersion.js";
import { ContextCompressor } from "./services/ContextCompressor.js";
import { loadSystemPrompt, getSystemContext } from "./context.js";
import { DEFAULT_CONFIG, THINKING_MODES } from "./types/config.js";
import type { ThinkingMode } from "./types/config.js";
import { FileSystemAdapter, type MemoryAdapter, type ChatPersona, TEMP_MAX_AI_REPLIES } from "./memory.js";
import { VaultService } from "./services/vault/VaultService.js";
import { VaultIndex } from "./services/vault/VaultIndex.js";
import { buildProject } from "./services/vault/VaultBriefing.js";
import { buildAxsDashboard } from "./services/vault/AxsDashboard.js";
import { systemStatus } from "./services/SystemStatus.js";
import { parseServiceRequest, runServiceAction, SERVICE_LABEL } from "./services/ServiceControl.js";
import { sanitizeDump, saveFinanceBackup, listFinanceBackups, pullFinanceBackup } from "./services/FinanceBackup.js";
import { sanitizeForgeDump, saveForgeBackup, listForgeBackups, pullForgeBackup } from "./services/ForgeBackup.js";
import { sanitizeInventoryDump, saveInventoryBackup, listInventoryBackups, pullInventoryBackup } from "./services/InventoryBackup.js";
import { resolveInventoryOp } from "./services/InventoryBridge.js";
import { resolveTelefonoOp } from "./services/TelefonoBridge.js";
import { TelefonoTool } from "./tools/TelefonoTool.js";
import { resolveSupplementOp } from "./services/SupplementBridge.js";
import { saveIntent, sanitizeProjection, PROJECTION_KEY, intentFor } from "./services/TrainingIntent.js";
import { sanitizeIntent } from "./services/forge/forgeTrain.js";
import { leerCartola } from "./services/FinanceStatement.js";
import { leerBoletaFoto, leerSaldoCaptura } from "./services/ReceiptOcr.js";
import { diagnoseBaseline, formatDiagnosisForLLM } from "./services/BaselineEngine.js";
import { deriveRestrictions } from "./services/DietaryRestrictions.js";
import { assessFood } from "./services/FoodSafetyCheck.js";
import { getGuidance } from "./services/MedicalKnowledgeBase.js";
import { buildMedicalContext } from "./services/LiveContext.js";
import { getUserNotes, formatNotesForLLM, deleteUserNote } from "./tools/UserContextTool.js";
import { getJournalEntries, addJournalEntry } from "./tools/JournalTool.js";
import { getDismissals, getOverrides, clearDismissal, clearOverride } from "./tools/InsightFeedbackTool.js";
import { join } from "path";
import type { Message } from "./types/message.js";
import { createMessage } from "./types/message.js";
import { roleManager } from "./services/security/RoleManager.js";
import { ROLES, canUseTool, type Role } from "./services/security/RoleSystem.js";
import { authRateLimiter } from "./services/security/AuthRateLimiter.js";
import { resolveSso, isSafeProfileId } from "./services/security/SsoAuth.js";
import { accountStore } from "./services/security/AccountStore.js";
import { getAuditLog } from "./services/security/AuditLog.js";
import { removeItem, todayPayload, isValidDay, applyGoalUpdate, upsertChatRollup, sanitizePhoneFoodLog } from "./services/NutritionLog.js";
import { todayKeyOf } from "./services/NutritionDay.js";
import { dayCtxFrom, nutritionDayOf, isoDayKey } from "./services/MealSchedule.js";
import { AdminService } from "./services/security/AdminService.js";
import { BetaMetrics, ACCIONES as ACCIONES_USO } from "./services/BetaMetrics.js";
import { armarInforme } from "./services/BetaReport.js";
import { alMedirModelo, contextoUso, type ContextoUso } from "./services/llm/ModelMeter.js";
import { getFeatures, setFeature, isFeatureName, FEATURE_LABELS } from "./services/Features.js";
import { loadTargets, sanitizeBody, localDay } from "./services/DailyTargets.js";
import { buildNudge, parseNudgeRequest } from "./services/NudgeSuggest.js";
import { isTone, getTone, toneForAge } from "./services/Tone.js";
import { manualSleepFor } from "./tools/SleepLogTool.js";
import { AdminOverviewTool } from "./tools/AdminOverviewTool.js";
import { AxsBriefingTool } from "./tools/AxsBriefingTool.js";
import { VaultNoteTool } from "./tools/VaultNoteTool.js";
import { routeTools, TOOL_GROUP } from "./services/ToolRouter.js";
import { sinContextoPegado } from "./services/AnalisisDia.js";
import type { ApprovalRequest, ApprovalDecision } from "./QueryEngine.js";
import { GlucoService } from "./services/gluco/GlucoService.js";
import { UnifiedFoodService } from "./services/gluco/UnifiedFoodService.js";
import { GlucoTool } from "./tools/GlucoTool.js";
import { NutritionTool } from "./tools/NutritionTool.js";
import { resolveFinanceOp } from "./services/FinanceBridge.js";
import { lookupBarcode, contributeProduct } from "./services/BarcodeLookup.js";
import { searchPackagedHits } from "./services/PackagedFoods.js";
import { cleanMyFoods } from "./services/FoodResolve.js";
import { waterTotalToday } from "./services/WaterToday.js";
import { understandVoice, voiceVocabulary, lexiconIndex } from "./services/stt/VoiceFix.js";
import { ProfileManagementTool } from "./tools/ProfileManagementTool.js";
import { emailService } from "./services/EmailService.js";
import { CryptoService } from "./services/security/CryptoService.js";
import { readFile, writeFile } from "fs/promises";
import { randomBytes } from "crypto";
import * as os from "os";

// Mapa de prompts por rol
const ROLE_PROMPTS: Record<Role, string> = {
  ikaros: join((import.meta as any).dir || process.cwd(), '..', 'data', 'prompts', 'ikaros.md'),
  eris: join((import.meta as any).dir || process.cwd(), '..', 'data', 'system-prompt.md'),
};

const PORT = Number(process.env.ERIS_PORT) || 3000;
const MAX_USER_MESSAGE_CHARS = 8000;
/** Tamaño máximo (caracteres del JSON) de cada mensaje del teléfono (revisión 2026-10-31, S2). */
const WS_TOPE_DEFAULT = 2_000_000;
const WS_TOPES: Record<string, number> = {
  // fotos, audio y archivos (la foto llega en base64: hasta ~9 MB de imagen)
  message: 14_000_000, voice_message: 14_000_000, finance_receipt_photo: 14_000_000, finance_balance_photo: 14_000_000, finance_statement_parse: 10_000_000,
  // respaldos de los módulos
  finance_backup_push: 8_000_000, forge_backup_push: 8_000_000, inventory_backup_push: 8_000_000, backfill_rollup: 4_000_000, sync_nutrition_days: 4_000_000,
  // lo que va a la memoria y al contexto del modelo: acotado
  update_health_snapshot: 600_000, sync_toji_context: 400_000, save_profile: 200_000, update_financial_context: 120_000, update_inventory_context: 120_000,
  // Hestia por voz: solo texto (el audio lo reconoce el teléfono)
  voz_turno: 4_000, voz_inicio: 2_000, voz_cortar: 1_000, voz_colgar: 1_000,
  update_supplement_context: 40_000, add_journal_entry: 20_000, create_project: 20_000, rename_project: 20_000, update_project: 20_000, tts_request: 20_000,
  save_preference: 12_000, set_tone: 2_000, set_strict_mode: 2_000, set_persona: 2_000, rename_chat: 4_000,
};
// (El contexto de Ollama ya no es fijo por perfil: lo elige ContextPlanner por turno, entre 8192 y 16384, según lo que de verdad se
//  envía. Antes Ikaros tenía 16384 fijo —14 % más lento en cada respuesta— y cada cambio de perfil o de modo recargaba el modelo.)

/**
 * Acceso anterior con ID + PIN. Mientras esté en 1 sirve para MIGRAR perfiles viejos y para apps sin actualizar;
 * ERIS_LEGACY_LOGIN=0 lo desactiva del todo (solo Google). Un perfil ya ligado a Google no se abre con su PIN viejo
 * (se re-cifró con la llave del servidor), así que dejarlo activo no expone a las cuentas ya migradas.
 */
const LEGACY_LOGIN_ENABLED = process.env.ERIS_LEGACY_LOGIN !== "0";

/** sessionId → perfil dueño. Impide que un perfil lea/borre el historial de otro pasando su id de sesión. */
const sessionOwners = new Map<string, string>();
/** El piloto automático del plan, uno a la vez por perfil (se reprograma con cada parte del snapshot) */
const autoTickTimers = new Map<string, ReturnType<typeof setTimeout>>();
function claimSession(id: string, profileId: string): string {
  const owner = sessionOwners.get(id);
  if (owner && owner !== profileId) id = crypto.randomUUID();
  sessionOwners.set(id, profileId);
  return id;
}

/** Límite simple por IP para el envío de correos de PIN: 5 por hora. */
const notifyHits = new Map<string, number[]>();
function notifyPinAllowed(ip: string): boolean {
  const now = Date.now();
  const recent = (notifyHits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= 5) { notifyHits.set(ip, recent); return false; }
  recent.push(now); notifyHits.set(ip, recent);
  return true;
}
const CONTEXT_RECENT = 12;
const COMPRESS_THRESHOLD = 16;

// Mapea cada métrica del BaselineEngine a la categoría de nota personal
// correspondiente (UserContextTool), para filtrar solo las notas
// relevantes a la variable que se está comentando en un tip/card.
const METRIC_TO_NOTE_SCOPE: Record<string, "hydration" | "sleep" | "nutrition" | "training" | "finance" | "general"> = {
  hydrationL: "hydration",
  sleepHours: "sleep",
  proteinG: "nutrition",
  steps: "training",
  restingHR: "training",
  plata: "finance",
  savingsRate: "finance",
  moodScore: "general",
};

const BASELINE_PHRASING_SYSTEM_PROMPT =
  "Eres Eris. Se te dan datos YA CALCULADOS sobre cómo está el usuario hoy comparado con su propio patrón " +
  "histórico personal (nunca umbrales genéricos de industria). Si el texto incluye un bloque 'TENDENCIA SOSTENIDA " +
  "DETECTADA', es una señal DISTINTA al desvío de hoy — compara la última semana completa contra la anterior, así " +
  "que un patrón sostenido de varios días pesa más que un día atípico puntual y merece más seriedad (o, si mejora, " +
  "un reconocimiento genuino); no lo mezcles con el desvío de hoy en una sola frase confusa. Si además se incluye " +
  "un bloque de historial médico (condiciones, medicamentos activos), tenlo en cuenta para el tono y las " +
  "recomendaciones — pero nunca des indicaciones clínicas específicas (dosis, diagnósticos); para eso remite al " +
  "usuario a su médico. Tu único trabajo es redactar el texto pedido, en español, natural y directo, sin inventar " +
  "números ni datos médicos adicionales a los que se te dan. Habla SOLO de las métricas que aparecen, por su nombre " +
  "(si es de Finanzas, di que es de Finanzas): nunca hables de glucosa, azúcar en sangre ni 'control' de una " +
  "enfermedad si esa métrica no está en los datos. Nunca uses markdown, headers ni listas — solo texto " +
  "plano de conversación.";

// ─── PIN ejecutivo Ikaros ───────────────────────────────────
// El acceso remoto a 'ikaros' está protegido por el PIN en .env

// Cache de memorias y query engines aislados por perfil
const memories = new Map<string, MemoryAdapter>();
const queryEngines = new Map<string, QueryEngine>(); // profileKey → QueryEngine (y profileKey#eris: Ikaros en modo Eris)

/** Con quién habla esta conexión: Hestia (perfil Ikaros en Modo AXS o empresa) o Eris. Los chats van separados. */
const personaOfWs = (ws: any): ChatPersona => (ws?.data?.role === "ikaros" && ws?.data?.persona === "hestia" ? "hestia" : "eris");

/**
 * Los chats de quien atiende ahora (los antiguos, sin marca, se ven en ambos), con los cortos marcados como temporales:
 * 5 respuestas o menos, sin proyecto y que no sea el abierto → la app los muestra en "Chats temporales" (no se borran).
 */
function convList(memory: MemoryAdapter, ws: any) {
  const persona = personaOfWs(ws);
  const ikaros = ws?.data?.role === "ikaros";
  const active = ws?.data?.sessionId;
  return memory.listConversations()
    // Los antiguos (sin marca) van a quien corresponden por tema; los vacíos se ven en ambas listas
    .filter((c: any) => !ikaros || (c.persona ?? c.inferredPersona ?? persona) === persona)
    .map((c: any) => ({ ...c, temporary: !c.projectId && c.id !== active && (c.aiReplies ?? 0) <= TEMP_MAX_AI_REPLIES }));
}
/**
 * ¿Mostrarle la bienvenida? Solo a quien recién empieza: nunca la vio y todavía no ha conversado con Eris. Queda guardado en
 * su perfil, así que no vuelve a salir al reinstalar ni en otro teléfono. 2026-10-11: le salía a un tester que ya usaba la
 * app (la marca vivía solo en el teléfono y se ponía al terminarla; si la cerraba a medias, salía de nuevo).
 */
async function shouldWelcome(memory: MemoryAdapter): Promise<boolean> {
  if (await memory.get("welcome_done").catch(() => null)) return false;
  if (memory.listConversations().some((c: any) => (c.aiReplies ?? 0) > 0)) {
    await memory.set("welcome_done", { at: new Date().toISOString(), by: "ya usaba la app" }).catch(() => {});
    return false;
  }
  return true;
}

/** Hestia por voz (J2): preguntas de plata, que se responden enteras y revisadas antes de decirlas */
/** Hestia por voz (J3): los WAV de las frases cortas que se repiten (services/voz/CacheVoz.ts), para todas las llamadas */
const CACHE_VOZ = new CacheVoz();

const PLATA_VOZ = /plata|dinero|pesos|\blucas?\b|gast[oaée]|ahorr|sueldo|alcanza|presupuesto|deuda|saldo|finanzas|tarjeta|\bcuotas?\b|\bpag(ar|o|u)/i;

/** Grupos de herramientas que solo existen para Ikaros en el Modo AXS Executive (PC, administración, bóveda de AXS). */
const IKAROS_ONLY_GROUPS = new Set(["axs", "system", "admin", "telefono"]);
const activeGlucoServices = new Map<string, GlucoService>();
// Clientes WebSocket activos por profileId → para push de alertas CGM
const activeClients = new Map<string, Set<any>>(); // profileId → Set<ServerWebSocket>

function pushToProfile(profileId: string, payload: object) {
  const clients = activeClients.get(profileId);
  if (!clients) return;
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    try { ws.send(msg); } catch {}
  }
}

function registerClient(profileId: string, ws: any) {
  if (!activeClients.has(profileId)) activeClients.set(profileId, new Set());
  activeClients.get(profileId)!.add(ws);
}

function unregisterClient(profileId: string, ws: any) {
  activeClients.get(profileId)?.delete(ws);
}

// ─── Aprobaciones humanas ───────────────────────────────────────────────────
// Las acciones sensibles (comandos, escribir archivos, reparar la bóveda…) esperan a que una PERSONA toque
// "Aprobar" en la app. La solicitud vive en el servidor: el celular solo devuelve {id, approved}; el contenido a
// aprobar nunca lo puede cambiar el cliente ni el modelo. Solo vale la respuesta que llega por la MISMA conexión.
const APPROVAL_TTL_MS = 180_000;
interface PendingApproval { ws: any; profileId: string; finish: (d: ApprovalDecision, notify: boolean) => void }
const pendingApprovals = new Map<string, PendingApproval>();
const lastLoginAudit = new Map<string, number>(); // `${perfil}:${tipo}` → último registro de acceso en la bitácora

function askApproval(
  ws: any, profileId: string, req: ApprovalRequest, signal?: AbortSignal,
  /** Llamada de voz (J2): `extra` va en la tarjeta (cómo se aprueba) y `onId` deja responderla diciendo «sí» o «no» */
  opts?: { extra?: Record<string, unknown>; onId?: (id: string) => void },
): Promise<ApprovalDecision> {
  // Una app vieja no sabe mostrar la tarjeta: se deniega de inmediato en vez de dejar colgado el chat 3 minutos
  if (!(ws.data as any)?.canApprove) return Promise.resolve("unavailable");
  const id = crypto.randomUUID();
  opts?.onId?.(id);
  return new Promise<ApprovalDecision>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (d: ApprovalDecision, notify: boolean) => {
      if (!pendingApprovals.has(id)) return;
      clearTimeout(timer);
      pendingApprovals.delete(id);
      if (notify) { try { ws.send(JSON.stringify({ type: "confirm_cancelled", id, reason: d })); } catch {} }
      resolve(d);
    };
    timer = setTimeout(() => finish("timeout", true), APPROVAL_TTL_MS);
    pendingApprovals.set(id, { ws, profileId, finish });
    signal?.addEventListener("abort", () => finish("denied", true), { once: true });
    try {
      ws.send(JSON.stringify({
        type: "confirm_request", id, tool: req.tool, title: req.title,
        detail: String(req.detail).slice(0, 3000), risk: req.risk, flags: req.flags, ttlMs: APPROVAL_TTL_MS, ...(opts?.extra ?? {}),
      }));
    } catch { finish("denied", false); }
  });
}

/** Cancela (como rechazo) todo lo pendiente de una conexión, o de un perfil entero. */
function denyApprovals(match: { ws?: any; profileId?: string }) {
  for (const p of [...pendingApprovals.values()]) {
    if ((match.ws && p.ws === match.ws) || (match.profileId && p.profileId === match.profileId)) p.finish("denied", true);
  }
}

/**
 * Saca a un perfil de sus conexiones abiertas y descarta sus motores en caché, para que el próximo ingreso arme todo
 * de nuevo con el rol vigente (cambio de rol) o falle si la sesión ya no existe (cierre de sesiones / suspensión).
 */
function kickProfile(profileId: string) {
  for (const k of [...queryEngines.keys()]) if (k.startsWith(profileId + ":")) queryEngines.delete(k);
  denyApprovals({ profileId });
  for (const ws of [...(activeClients.get(profileId) ?? [])]) {
    try { ws.close(4001, "session_changed"); } catch {}
  }
}

// Cooldowns de alertas: evitar spam (1 alerta por tipo cada 10 min por perfil)
const alertCooldowns = new Map<string, number>(); // `${profileId}:${type}` → timestamp

function wireGlucoAlerts(profileId: string, svc: GlucoService, thresholds?: import('./memory.ts').AlertThresholds) {
  const t = thresholds ?? { glucoseLow: 70, glucoseHigh: 180, glucoseUrgentLow: 55, glucoseUrgentHigh: 250 };
  svc.onAlert((reading, alertType) => {
    const urgentLow  = reading.value < t.glucoseUrgentLow;
    const urgentHigh = reading.value > t.glucoseUrgentHigh;
    const type = urgentLow ? 'urgent_low' : urgentHigh ? 'urgent_high' : alertType === 'low' ? 'low' : 'high';
    const key = `${profileId}:${type}`;
    const now = Date.now();
    const cooldownMs = (type.startsWith('urgent') ? 5 : 10) * 60_000;
    if ((alertCooldowns.get(key) ?? 0) + cooldownMs > now) return; // aún en cooldown
    alertCooldowns.set(key, now);
    pushToProfile(profileId, {
      type: 'glucose_alert',
      alertType: type,
      value: reading.value,
      valueInMmol: reading.valueInMmol,
      trend: reading.trendArrow,
      timestamp: reading.timestamp,
    });
    console.log(`[Alert] ${profileId} ${type}: ${reading.value} mg/dL`);
  });
}
// UnifiedFoodService: singleton del servidor — usa USDA (env) + local DB + Open Food Facts (sin key)
const usdaApiKey = process.env.USDA_API_KEY ?? "DEMO_KEY";
const unifiedFood = new UnifiedFoodService(usdaApiKey);


/** Estado de nutrición de HOY para el móvil (comidas, agua efectiva y cada toma de agua). */
async function buildNutritionToday(memory: MemoryAdapter) {
  // El día de COMIDA (termina al dormir, no a medianoche): el mismo que calcula el teléfono
  const today = await todayKeyOf(memory);
  const nutritionLog = await memory.get(`nutrition_log_${today}`).catch(() => []);
  const hydrationLog = await memory.get(`hydration_log_${today}`).catch(() => []);
  // Metas configuradas por chat (set_nutritional_goals): el móvil las guardaba solo localmente y nada las llenaba
  // desde el servidor, así que el resumen del día siempre mostraba los valores por defecto (2000 kcal / 2,5 L).
  const storedGoals = (await memory.get("nutrition_goals").catch(() => null)) || {};
  // Sodio/azúcar/fibra/grasa: antes se mostraba solo cuánto consumiste, nunca si eso era mucho o poco. Van en el
  // mismo objeto `goals` (el móvil ya sabe fusionar cualquier campo numérico ahí, ver mergeGoals) pero se
  // recalculan siempre del perfil médico — no son algo que el usuario edite en "Metas nutricionales". Un objeto
  // NUEVO, nunca se mutan `storedGoals`: si `memory.get` alguna vez devolviera una referencia compartida,
  // mutarla podría terminar persistiéndose por accidente la próxima vez que se guarden metas de verdad.
  // Metas efectivas de HOY desde la fuente única (DailyTargets): calorías y agua según Forge y el perfil médico, no
  // 2.000 kcal / 2,5 L fijos. `null` = esa meta no aplica (p. ej. agua con enfermedad renal): el móvil la borra.
  let goals: Record<string, number | null> = { ...storedGoals };
  let goalsSet: Record<string, number> = {};
  let targets: Record<string, unknown> | undefined;
  try {
    const t = await loadTargets(memory);
    goals = {
      ...goals,
      calories: t.kcal, waterLiters: t.waterL, waterTargetOff: t.waterL === null ? 1 : null,
      proteinGGoal: t.proteinG, proteinIsCap: t.proteinIsCap ? 1 : null,
      // rango con respaldo de la meta de proteína (según el objetivo de Forge); null = no aplica (tope renal o fijada a mano)
      proteinGMin: t.proteinRange?.[0] ?? null, proteinGMax: t.proteinRange?.[1] ?? null,
      sodiumMgLimit: t.sodiumMgLimit, sugarGLimit: t.sugarGLimit, fiberGGoal: t.fiberGGoal,
      fatGLimit: storedGoals.fat || t.fatGLimit,
    };
    goalsSet = t.set as Record<string, number>;
    targets = {
      sources: t.sources, notes: t.notes, kcalMaintenance: t.kcalMaintenance, kcalTraining: t.kcalTraining,
      // El entreno de hoy (Forge 2.0): «te quedan X (incluye ~N de tu pierna de las 19:00) · sin el entreno te pasarías por Y»
      byDay: t.byDay ?? null, kcalGhost: t.kcalGhost ?? null, kcalNoGhost: t.kcalNoGhost ?? null, kcalPlanned: t.kcalPlanned ?? null,
      intentPhrase: t.intentPhrase ?? null, minutesToWorkout: t.minutesToWorkout ?? null,
    };
  } catch {}
  // Hidratación EFECTIVA (café/alcohol/bebidas azucaradas hidratan menos que el agua), igual que get_daily_log
  // y el asesor metabólico — antes esto sumaba litros crudos y las cifras no coincidían entre pantallas.
  // Sueño anotado por chat para anoche (sleep_log): el teléfono lo usa en Métricas y en el puntaje si el reloj no lo midió
  const sleepToday = await manualSleepFor(memory).catch(() => null);
  return { ...todayPayload(nutritionLog, hydrationLog), goals, goalsSet, targets, sleepToday };
}

async function getOrCreateMemory(
  profileId: string,
  pin?: string
): Promise<{ memory: MemoryAdapter; recoveryKey?: string }> {
  const key = `${profileId}:${pin || ''}`;
  if (memories.has(key)) return { memory: memories.get(key)! };

  // Verificar rate limit antes del intento
  const isRecovery = !!pin && /^[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/i.test(pin);
  const rateCheck = await authRateLimiter.check(profileId, isRecovery);
  if (!rateCheck.allowed) {
    throw new Error(rateCheck.message || 'Demasiados intentos fallidos.');
  }

  try {
    const memory = new FileSystemAdapter(profileId, pin);
    const result = await memory.load();
    // Autenticación exitosa — resetear contador
    await authRateLimiter.reset(profileId);
    memories.set(key, memory);
    return { memory, recoveryKey: result ? result.recoveryKey : undefined };
  } catch (e) {
    // Registrar intento fallido
    await authRateLimiter.recordFailure(profileId);
    throw e;
  }
}

async function startServer() {
  // ─── Bootstrap Ikaros en startup ────────────────────────────
  // Garantiza que Ikaros siempre tenga rol ikaros en roles.json
  await roleManager.bootstrapIkaros('ikaros');
  console.log(`🛡️  Perfil Soberano: ID "ikaros" reservado y protegido.`);

  const provider = new OllamaProvider(
    DEFAULT_CONFIG.llm.baseUrl,
    DEFAULT_CONFIG.llm.model
  );

  // Sin Ollama el servidor arranca igual (2026-10-14, "solo registro": el usuario apagó el chat para liberar RAM y GPU):
  // el registro, la sincronización y los avisos del teléfono no usan el modelo. El chat responde que está en pausa.
  const isAvailable = await provider.isAvailable();
  if (!isAvailable) {
    console.log("⚠️  Ollama no está disponible: el chat queda en pausa; el registro y los avisos siguen funcionando. Para el chat: ollama serve");
  } else {
    // Precarga del modelo (sin generar nada): el primer mensaje real no paga la carga (~5 s) ni espera a que se cargue.
    void provider.warmup(THINKING_MODES.flash.model, THINKING_MODES.flash.contextLength).then((ok) =>
      console.log(ok ? "🔥 Modelo precargado en memoria." : "⚠️  No se pudo precargar el modelo (se cargará con el primer mensaje).")
    );
  }

  // Whisper es opcional — si no está corriendo, todo Eris sigue funcionando
  // normal, solo el dictado por voz falla con un mensaje claro en vez de
  // tumbar el server entero (a diferencia de Ollama, que es obligatorio).
  const whisperProvider = new WhisperProvider();
  const whisperOk = await whisperProvider.isAvailable();
  console.log(whisperOk
    ? "🎙️  Whisper (voz) disponible."
    : "🎙️  Whisper (voz) no disponible — el dictado por voz no funcionará hasta levantar whisper-server.");

  // Piper (voz de respuesta) — también opcional, mismo criterio que Whisper.
  const piperProvider = new PiperProvider();
  const piperOk = await piperProvider.isAvailable("daniela");
  console.log(piperOk
    ? "🗣️  Piper (voz de respuesta) disponible."
    : "🗣️  Piper (voz de respuesta) no disponible — la respuesta hablada no funcionará hasta levantar los servidores de Piper.");

  const toolRegistry = new ToolRegistry();

  // ─── Herramientas estándar ──────────────────────────────────────────
  const { LogManagementTool } = await import("./tools/LogManagementTool.js");
  const { VaultAuditTool } = await import("./tools/VaultAuditTool.js");
  const { VaultHealerTool } = await import("./tools/VaultHealerTool.js");
  const { ExecutiveReportTool } = await import("./tools/ExecutiveReportTool.js");
  const { CrystallizeTool } = await import("./tools/CrystallizeTool.js");
  
  toolRegistry.register(new LogManagementTool(provider));
  toolRegistry.register(new VaultAuditTool());
  toolRegistry.register(new VaultHealerTool());
  toolRegistry.register(new ExecutiveReportTool(provider));
  // Estaba importada pero nunca se registraba: el prompt de Ikaros manda guardar las decisiones con `crystallize` y cada
  // intento fallaba con "herramienta no disponible". Es `dangerous`: pide aprobación antes de escribir en la bóveda.
  toolRegistry.register(new CrystallizeTool());
  toolRegistry.register(new GlucoTool());
  toolRegistry.register(new NutritionTool());
  toolRegistry.register(new ProfileManagementTool());
  // Hestia Manos (K0): el teléfono, solo para Ikaros en Modo AXS (grupo «telefono», oculto en el modo Eris)
  toolRegistry.register(new TelefonoTool());

  // ─── Administración y auditoría ─────────────────────────────────────
  const audit = getAuditLog();
  const adminService = new AdminService({
    store: accountStore,
    profilesDir: join(os.homedir(), ".eris", "profiles"),
    audit,
    online: (id) => activeClients.get(id)?.size ?? 0,
    roles: {
      getRole: (id) => roleManager.getRole(id),
      setRole: async (id, role) => {
        if (role === "eris") await roleManager.revokeRole(id, "ikaros");
        else await roleManager.assignRole(id, role, "ikaros");
      },
    },
  });
  toolRegistry.register(new AdminOverviewTool(adminService, audit));

  // ─── Medición de la beta (2026-11-11): cuánto se usa y cuánto PC ocupa cada persona, sin leer lo que escribe ──
  const betaMetrics = new BetaMetrics({ dir: join(os.homedir(), ".eris", "metricas"), secreto: () => accountStore.getSecret() });
  alMedirModelo((l) => { void betaMetrics.modelo(l.profileId, l).catch(() => {}); });
  const usoMedido = (fn: () => Promise<unknown>) => { void fn().catch(() => {}); };
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => { void betaMetrics.guardar().finally(() => process.exit(0)); });
  // Herramientas de AXS que hacen el trabajo en código (solo Ikaros: el rol público no las tiene en su lista)
  toolRegistry.register(new AxsBriefingTool());
  toolRegistry.register(new VaultNoteTool());

  const compressor = new ContextCompressor(provider);

  const sessions = new Map<string, Message[]>();
  const webDir = join((import.meta as any).dir, "..", "web");

  Bun.serve({
    port: PORT,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const sessionId = url.searchParams.get("session") || crypto.randomUUID();
        const rawProfileId = url.searchParams.get("profile") || "default";
        const profileId = rawProfileId.toLowerCase();
        // El id se usa como nombre de carpeta: solo letras, números, punto, guion y guion bajo (evita "../../" y rutas raras)
        if (!isSafeProfileId(profileId)) return new Response("Perfil inválido", { status: 400 });
        // PIN ya NO viaja en la URL — se envía como primer mensaje WebSocket

        const remoteAddress =
          req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
          server.requestIP(req)?.address ||
          '';

        // Ya no bloqueamos la conexión remota por defecto si es ikaros, 
        // porque usará la app (Tailscale) y requiere PIN.

        const upgraded = server.upgrade(req, { data: { sessionId, profileId, remoteAddress, authenticated: false } as any });
        if (upgraded) return undefined as any;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      if (url.pathname === "/api/status") {
        // Público (sin login): solo lo mínimo. Antes listaba todas las herramientas y el modelo.
        const ollamaOk = await provider.isAvailable();
        return Response.json({ status: "ok", ollama: ollamaOk });
      }

      // ─── Reset de PIN usando Recovery Key ────────────────────────────
      if ((url.pathname === "/api/auth/reset-pin-with-rk" || url.pathname === "/api/auth/notify-pin") && !LEGACY_LOGIN_ENABLED) {
        return Response.json({ error: "Desactivado: el acceso es solo con Google." }, { status: 410 });
      }

      if (url.pathname === "/api/auth/reset-pin-with-rk" && req.method === "POST") {
        try {
          const body = await req.json() as { profileId: string; recoveryKey: string };
          if (!body.profileId || !body.recoveryKey || !isSafeProfileId(String(body.profileId).toLowerCase())) {
            return Response.json({ error: "Faltan campos." }, { status: 400 });
          }

          const keyPath = join(os.homedir(), ".eris", "profiles", body.profileId, "key.json");
          let keyMaterial: any;
          try {
            keyMaterial = JSON.parse(await readFile(keyPath, "utf-8"));
          } catch {
            return Response.json({ error: "Perfil no encontrado." }, { status: 404 });
          }

          // Verificar Recovery Key
          const crypto = new CryptoService();
          const unlocked = crypto.unlock(body.recoveryKey.toUpperCase().trim(), keyMaterial);
          if (!unlocked) {
            await authRateLimiter.recordFailure(body.profileId);
            return Response.json({ error: "Llave de recuperación incorrecta." }, { status: 401 });
          }

          // Generar nuevo PIN y actualizar key.json
          const newPin = randomBytes(4).toString("hex").toUpperCase();
          const newKeyMaterial = crypto.changePin(newPin, keyMaterial);
          await writeFile(keyPath, JSON.stringify(newKeyMaterial), "utf-8");

          // Resetear contadores de seguridad
          await authRateLimiter.reset(body.profileId);

          console.log(`[reset-pin] PIN reseteado para perfil: ${body.profileId}`);
          return Response.json({ success: true, newPin, profileId: body.profileId });
        } catch (e: any) {
          console.error("[reset-pin] Error:", e.message);
          return Response.json({ error: "Error interno." }, { status: 500 });
        }
      }

      // ─── Notificación PIN nuevo perfil Google ─────────────────────────
      if (url.pathname === "/api/auth/notify-pin" && req.method === "POST") {
        try {
          const body = await req.json() as { email: string; name?: string; profileId: string; pin: string };
          if (!body.email || !body.pin || !body.profileId) {
            return Response.json({ error: "Faltan campos requeridos." }, { status: 400 });
          }
          // Antes cualquiera podía mandar correos con texto propio desde la cuenta del servidor (phishing / spam).
          // Ahora: límite por IP, correo con formato válido, y solo se envía si el PIN corresponde de verdad al perfil.
          const ip = server.requestIP(req)?.address || "desconocida";
          if (!notifyPinAllowed(ip)) return Response.json({ error: "Demasiadas solicitudes." }, { status: 429 });
          const pid = String(body.profileId).toLowerCase();
          if (!isSafeProfileId(pid) || !/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(String(body.email))) {
            return Response.json({ error: "Datos inválidos." }, { status: 400 });
          }
          try {
            const km = JSON.parse(await readFile(join(os.homedir(), ".eris", "profiles", pid, "key.json"), "utf-8"));
            if (!new CryptoService().unlock(String(body.pin), km)) return Response.json({ error: "No autorizado." }, { status: 401 });
          } catch {
            return Response.json({ error: "No autorizado." }, { status: 401 });
          }
          const result = await emailService.sendNewProfilePin({
            email: body.email,
            name: body.name || body.profileId,
            profileId: body.profileId,
            pin: body.pin,
          });
          return Response.json(result);
        } catch (e: any) {
          console.error('[notify-pin] Error:', e.message);
          return Response.json({ error: 'Error interno.' }, { status: 500 });
        }
      }

      if (url.pathname.startsWith("/api/gluco/")) {
        let profileId = req.headers.get("x-profile-id");
        let pin = req.headers.get("x-pin");
        const bearer = (req.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1];
        if (bearer) {
          // Sesión de Google: el perfil y la llave salen del token, no de lo que mande el cliente
          try {
            const r = await resolveSso({ type: "auth_session", token: bearer });
            profileId = r.profileId; pin = r.pin;
          } catch { return Response.json({ error: "Sesión inválida o vencida." }, { status: 401 }); }
        } else if (!LEGACY_LOGIN_ENABLED) {
          return Response.json({ error: "Inicia sesión con Google." }, { status: 401 });
        }
        if (profileId && !isSafeProfileId(profileId.toLowerCase())) return Response.json({ error: "Perfil inválido." }, { status: 400 });
        
        if (!profileId || !pin) {
          return Response.json({ error: "No autorizado. Faltan cabeceras de perfil o PIN." }, { status: 401 });
        }

        // 1. Obtener la bóveda del usuario
        let vault;
        try {
          const res = await getOrCreateMemory(profileId, pin);
          vault = res.memory;
        } catch (e: any) {
          return Response.json({ error: "PIN incorrecto o perfil no existe." }, { status: 401 });
        }

        // 2. Resolver GlucoService o FoodService según la ruta
        const isFoodApi = url.pathname.startsWith("/api/gluco/food/");
        
        if (!isFoodApi) {
          // Módulo de glucosa sin visto bueno del administrador: ni conexión al sensor, ni lecturas, ni alertas
          if (!(await getFeatures()).glucose) {
            return Response.json({ ok: false, code: "module_disabled", message: "El módulo de glucosa está desactivado por ahora." }, { status: 403 });
          }
          // ─── Diagnóstico de conexión (crea servicio temporal, no usa caché) ──
          if (url.pathname === "/api/gluco/test") {
            const profile = await vault.getProfile();
            const config = profile?.integrations?.libreView;
            if (!config?.email || !config?.password) {
              return Response.json({ ok: false, code: "not_configured", message: "Configura tus credenciales de LibreLinkUp en el perfil de Eris." });
            }
            try {
              // Si ya tiene región guardada la usa; si no, autodiscovery automático
              let testSvc: GlucoService;
              let discoveredRegion: string | null = null;
              if (config.region) {
                testSvc = new GlucoService({ email: config.email, password: config.password, region: config.region as any });
                await testSvc.login();
                discoveredRegion = testSvc.discoveredRegion;
              } else {
                const result = await GlucoService.discover(config.email, config.password);
                testSvc = result.service;
                discoveredRegion = result.region;
              }
              // Guardar región descubierta en perfil para futuros logins instantáneos
              if (discoveredRegion && discoveredRegion !== config.region) {
                const updatedProfile = { ...profile!, integrations: { ...profile!.integrations, libreView: { ...config, region: discoveredRegion } } };
                await vault.saveProfile(updatedProfile as any);
              }
              const snap = await testSvc.fetchLatest();
              const old = activeGlucoServices.get(profileId);
              if (old) old.stopPolling();
              activeGlucoServices.set(profileId, testSvc);
              wireGlucoAlerts(profileId, testSvc, (await vault.getProfile())?.medical?.thresholds);
              testSvc.startPolling();
              return Response.json({ ok: true, code: "connected", message: `Sensor conectado (región: ${discoveredRegion ?? 'auto'}).`, current: snap.current, sensorInfo: snap.sensorInfo });
            } catch (err: any) {
              const msg: string = err?.message || "";
              let code = "unknown_error";
              let message = "Error desconocido al conectar con LibreLinkUp.";
              if (msg.includes("Términos") || msg.includes("tou") || msg.includes("ToS")) {
                code = "tos_required";
                message = "Debes aceptar los Términos de Servicio en la app FreeStyle LibreLinkUp.";
              } else if (msg.includes("credenciales") || msg.includes("Login fallido") || msg.includes("incorrecto") || msg.includes("No se encontró servidor")) {
                code = "invalid_credentials";
                message = "Email o contraseña incorrectos para LibreLinkUp.";
              } else if (msg.includes("No se encontraron conexiones")) {
                code = "no_connections";
                message = "No hay sensor compartido con esta cuenta de LibreLinkUp.";
              } else if (msg.includes("401") || msg.includes("403")) {
                code = "auth_failed";
                message = "Error de autenticación. Las credenciales ya no son válidas.";
              }
              return Response.json({ ok: false, code, message, detail: msg });
            }
          }

          let glucoSvc = activeGlucoServices.get(profileId);
          if (!glucoSvc) {
            const profile = await vault.getProfile();
            const config = profile?.integrations?.libreView;
            if (!config || !config.email || !config.password) {
              return Response.json({ ok: false, code: "not_configured", message: "Configura tus credenciales de LibreLinkUp en el perfil de Eris." }, { status: 503 });
            }
            if (config.region) {
              // Región ya conocida → login directo
              glucoSvc = new GlucoService({ email: config.email, password: config.password, region: config.region as any });
            } else {
              // Primera vez sin región → autodiscovery y guardar resultado
              const result = await GlucoService.discover(config.email, config.password);
              glucoSvc = result.service;
              const updatedProfile = { ...profile, integrations: { ...profile.integrations, libreView: { ...config, region: result.region } } };
              await vault.saveProfile(updatedProfile).catch(() => {});
            }
            activeGlucoServices.set(profileId, glucoSvc);
            wireGlucoAlerts(profileId, glucoSvc, profile?.medical?.thresholds);
            glucoSvc.startPolling();
          }

          if (url.pathname === "/api/gluco/current") {
            const snapshot = glucoSvc.getSnapshot();
            if (Date.now() - snapshot.lastFetched.getTime() > 10 * 60 * 1000) {
              try { await glucoSvc.fetchLatest(); } catch {}
            }
            const s = glucoSvc.getSnapshot();
            return Response.json({ current: s.current, lastFetched: s.lastFetched, sensorInfo: s.sensorInfo });
          }
          if (url.pathname === "/api/gluco/history") {
            const hours = parseInt(url.searchParams.get("hours") || "24", 10);
            return Response.json({ readings: glucoSvc.getHistory(hours), hours });
          }
          if (url.pathname === "/api/gluco/stats") {
            const hours = parseInt(url.searchParams.get("hours") || "24", 10);
            return Response.json({ stats: glucoSvc.getStats(hours), hours });
          }
        } else {
          // UnifiedFoodService: USDA + Local Chile/LATAM + Open Food Facts (sin config por perfil)
          const foodSvc = unifiedFood;

          if (url.pathname === "/api/gluco/food/search") {
            const q = url.searchParams.get("q") || "";
            if (!q) return Response.json({ error: "Parámetro 'q' requerido" }, { status: 400 });
            const results = await foodSvc.searchFoods(q);
            return Response.json(results);
          }
          if (url.pathname === "/api/gluco/food/detail") {
            const id = url.searchParams.get("id") || "";
            if (!id) return Response.json({ error: "Parámetro 'id' requerido" }, { status: 400 });
            const food = await foodSvc.getFoodById(id);
            return Response.json(food);
          }
          if (url.pathname === "/api/gluco/food/barcode") {
            const code = url.searchParams.get("code") || "";
            if (!code) return Response.json({ error: "Parámetro 'code' requerido" }, { status: 400 });
            const food = await foodSvc.findByBarcode(code);
            if (!food) return Response.json({ error: "Producto no encontrado en FatSecret" }, { status: 404 });
            return Response.json(food);
          }
        }
      }

      if (url.pathname === "/api/modes") {
        const modes = Object.values(THINKING_MODES).map((m) => ({
          id: m.id,
          label: m.label,
          icon: m.icon,
          description: m.description,
          model: m.model || "dynamic",
        }));
        return Response.json({ modes, default: DEFAULT_CONFIG.defaultMode });
      }

      // Archivos estáticos
      let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const fullPath = join(webDir, filePath);

      try {
        const file = Bun.file(fullPath);
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": getContentType(filePath) },
          });
        }
      } catch {}

      return new Response("404 Not Found", { status: 404 });
    },

    websocket: {
      open(ws) {
        ws.send(JSON.stringify({ type: 'auth_required' }));
      },

      async message(ws, message) {
        // Medición de la beta: lo que corre por este mensaje (las llamadas al modelo incluidas) sabe de quién es y de qué tipo
        const ctxUso: ContextoUso = { profileId: (ws.data as any)?.profileId ?? null, tipo: "lateral", llamadas: 0 };
        return contextoUso.run(ctxUso, async () => {
        let { sessionId, profileId, remoteAddress } = ws.data as any;
        let data: any;
        try { data = JSON.parse(message as string); } catch { return; }

        // ─── Handshake de autenticación ──────────────────────────────────────
        if (!((ws.data as any).authenticated)) {
          let pin: string | undefined;
          let sessionTokenOut: string | undefined;
          let ssoLogin = false;
          // Capacidades del cliente: solo una app que sabe mostrar la tarjeta "Aprobar/Rechazar" puede ejecutar acciones sensibles
          (ws.data as any).canApprove = Array.isArray(data.caps) && data.caps.includes("approvals");
          // …y solo una app que sabe aplicar operaciones en Finanzas (FinanceBridge) recibe las de finance_tracker
          (ws.data as any).canFinance = Array.isArray(data.caps) && data.caps.includes("finance_ops");
          // …y lo mismo con el Inventario (InventoryBridge, 2026-10-22)
          (ws.data as any).canInventory = Array.isArray(data.caps) && data.caps.includes("inventory_ops");
          // …y con «Mis suplementos» (SupplementBridge, 2026-10-23)
          (ws.data as any).canSupplement = Array.isArray(data.caps) && data.caps.includes("supplement_ops");
          // …y Hestia Manos en el teléfono (K0): solo la anuncia Eris si la app aparte está instalada y firmada igual
          (ws.data as any).canTelefono = Array.isArray(data.caps) && data.caps.includes("telefono_ops");

          if (data.type === 'auth_google' || data.type === 'auth_session') {
            // ─── SSO de Google: el SERVIDOR verifica la identidad; el perfil sale de la cuenta, no de lo que diga el cliente ───
            try {
              const r = await resolveSso(data);
              profileId = r.profileId;
              pin = r.pin;              // llave interna del servidor: jamás viaja al celular
              sessionTokenOut = r.sessionToken;
              ssoLogin = true;
              (ws.data as any).profileId = profileId;
              (ws.data as any).sso = true;
            } catch (e: any) {
              ws.send(JSON.stringify({ type: 'auth_error', code: e?.code || 'forbidden', message: e?.message || 'No se pudo iniciar sesión.', ...(e?.extra || {}) }));
              // Se deja constancia de lo que sí importa (token falso, cuenta suspendida); una sesión vencida es rutina
              if (e?.code === 'invalid_token' || e?.code === 'account_disabled' || e?.code === 'forbidden') {
                void audit.record({ event: 'login_failed', profileId: 'desconocido', detail: String(e?.code || 'forbidden'), ip: remoteAddress });
              }
              return;
            }
          } else if (data.type === 'auth') {
            if (!LEGACY_LOGIN_ENABLED) {
              ws.send(JSON.stringify({ type: 'auth_error', code: 'legacy_disabled', message: 'El acceso con ID y PIN está desactivado. Inicia sesión con Google.' }));
              return;
            }
            pin = data.pin;

            // ─── Hardcode de Ikaros en servidor ───────────────────────────────────
            if (profileId === 'ikaros') {
              const serverIkarosPin = process.env.IKAROS_PIN;
              if (serverIkarosPin && pin !== serverIkarosPin) {
                ws.send(JSON.stringify({ type: 'error', message: 'Credenciales administrativas incorrectas para Ikaros.' }));
                return;
              }
            }
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Autenticación requerida.' }));
            return;
          }

          try {
            const { memory, recoveryKey } = await getOrCreateMemory(profileId, pin);
            (ws.data as any).pin = pin;
            (ws.data as any).authenticated = true;
            (ws.data as any).memory = memory;
            // El id de sesión viene de la URL (lo elige el cliente): si ya es de OTRO perfil, se le da uno nuevo.
            sessionId = claimSession(sessionId, profileId);
            (ws.data as any).sessionId = sessionId;

            const userProfile = await memory.getProfile();

            let profileRole = await roleManager.getRole(profileId);
            // Se eliminó el downgrade remoto de ikaros, ya que ikaros está diseñado
            // para usarse en la app móvil. El PIN protege el acceso.
            (ws.data as any).role = profileRole;

            const roleDefinition = ROLES[profileRole] ?? ROLES.eris;
            const rolPromptPath = ROLE_PROMPTS[profileRole] ?? ROLE_PROMPTS.eris;

            // Cargar archivos de contexto opcionales del perfil
            const profileDir = join(os.homedir(), ".eris", "profiles", profileId);
            let trainingPlanBlock = '';
            try {
              const tp = await readFile(join(profileDir, "training_plan.md"), "utf-8");
              trainingPlanBlock = `\n\n### Plan de Entrenamiento Actual\n${tp}`;
            } catch { /* sin plan registrado */ }

            const profileText = userProfile
              ? [
                  userProfile.displayName ? `Nombre: ${userProfile.displayName}` : '',
                  userProfile.role ? `Contexto: ${userProfile.role}` : '',
                  userProfile.goals ? `Objetivos: ${userProfile.goals}` : '',
                  userProfile.language ? `Idioma preferido: ${userProfile.language}` : '',
                  userProfile.customContext || '',
                ].filter(Boolean).join('\n') + trainingPlanBlock
              : trainingPlanBlock.trim() || undefined;
            const personalizedPrompt = await loadSystemPrompt(rolPromptPath, profileText, profileRole);

            const filteredRegistry = roleDefinition.allowedTools.includes('*')
              ? toolRegistry
              : new ToolRegistry(toolRegistry.getAll().filter(t => canUseTool(roleDefinition, t.name)));

            const profileKey = `${profileId}:${pin || ''}`;
            if (!queryEngines.has(profileKey)) {
              queryEngines.set(profileKey, new QueryEngine(provider, filteredRegistry, personalizedPrompt, {
                // El modelo solo ve las herramientas del grupo que pide cada mensaje (de las que su rol tiene). Antes los usuarios
                // públicos no tenían selector: cada mensaje llevaba sus 16 herramientas (revisión 2026-11-04, R2)
                router: routeTools,
              }));
            }
            // Separación Eris / Ikaros. Con el Modo AXS Executive APAGADO, el perfil Ikaros habla con ERIS: su prompt (reglas de
            // nutrición, Finanzas, salud) y SIN herramientas del PC, de administración ni de AXS. Antes seguía siendo Hestia, cuyo
            // prompt habla de comandos y aprobaciones y no trae las reglas de nutrición: "ingresa 1 empanada… como once" terminó
            // en una tarjeta para aprobar un comando en el PC (2026-10-03). Hestia y todo lo demás quedan en el Modo AXS Executive.
            if (profileRole === 'ikaros' && !queryEngines.has(`${profileKey}#eris`)) {
              const erisModeNote = 'Estás en el modo Eris de la app. Si pide algo del PC (archivos, comandos, abrir programas), de administración ' +
                'o de AXS (bóveda, proyectos, briefing), dile en una frase que eso se hace en el Modo AXS Executive (Perfil → Modo AXS Executive). No intentes hacerlo.\n' +
                'La persona con la que hablas es el fundador de AXS: él te creó. Si te lo menciona, reconócelo con cercanía (nunca le digas que no es tu creador).';
              const erisPrompt = await loadSystemPrompt(ROLE_PROMPTS.eris, [profileText, erisModeNote].filter(Boolean).join('\n'), 'eris');
              const erisRegistry = new ToolRegistry(toolRegistry.getAll().filter((t) => !IKAROS_ONLY_GROUPS.has(TOOL_GROUP[t.name])));
              queryEngines.set(`${profileKey}#eris`, new QueryEngine(provider, erisRegistry, erisPrompt, { router: routeTools }));
            }
            // Hestia por voz (J1, 2026-11-16): las mismas herramientas de Hestia con un prompt corto de conversación hablada. J0 midió
            // que el prompt completo de Hestia (~10 KB + la bóveda) es lo que hace lento el primer token; con este, ~1 s.
            if (profileRole === 'ikaros' && !queryEngines.has(`${profileKey}#voz`)) {
              const vozPrompt = await readFile(join((import.meta as any).dir || process.cwd(), '..', 'data', 'prompts', 'hestia-voz.md'), 'utf-8').catch(() => '');
              // Solo las herramientas de una intención clara: sin ella, el selector juntaba 13 a 19 herramientas («¿y si mañana amanezco
              // cansado…?») y el primer audio tardaba 18-29 s (prueba J1). Lo que se responde por código (los atajos) sigue igual.
              // J2: también lo que el MENSAJE pide del PC, la bóveda o la web (grupos de pocas herramientas). Sin eso, «borra el archivo…»
              // llegaba sin herramientas y el modelo respondía «Borrado.» sin haber hecho nada (banco «voz», 2026-11-16).
              // La búsqueda web se suma a casi todo; en voz, solo si la pide (cada herramienta de más alarga el primer audio: con la
              // bóveda + web eran 9 herramientas y 8 s). Seguir el hilo («¿y eso alcanza?») trae lo del turno anterior, si es poco:
              // sin eso el modelo contestaba de memoria con cifras inventadas que la guardia quitaba cuando ya se habían dicho.
              const PIDE_WEB = /internet|en la web|google|en l[ií]nea|noticias|busca(r|me)? en (la )?red/i;
              const routerVoz: typeof routeTools = (msg, prev, available, hint) => {
                const r = routeTools(msg, prev, available, hint);
                const vacio = { ...r, tools: new Set<string>(), deferred: [] as string[] };
                // (J3: y dentro de la bóveda y del PC, solo las que pide el mensaje: services/voz/RutaVoz.ts)
                const sinWeb = (x: typeof r) => {
                  const y = PIDE_WEB.test(msg) ? x
                    : { ...x, tools: new Set([...x.tools].filter((n) => TOOL_GROUP[n] !== "web")), deferred: (x.deferred ?? []).filter((n) => TOOL_GROUP[n] !== "web") };
                  return { ...y, tools: afinarVoz(msg, y.tools) };
                };
                if (r.intent === "seguimiento") return r.tools.size <= 4 ? sinWeb(r) : vacio;
                if (r.intent) return sinWeb(r);
                if (r.reason === "mensaje" && r.groups.some((g) => IKAROS_ONLY_GROUPS.has(g))) return sinWeb(r);
                return vacio;
              };
              // El PC (J2): sin esto el modelo escribía comandos de Linux («ps aux», «rm /home/alex/Desktop/…») en un Windows
              const pc = (await getSystemContext('ikaros').catch(() => '')).split('\n').filter((l) => /^- (SO|Shell|Home|Escritorio|Documentos):/.test(l)).join('\n');
              if (vozPrompt) queryEngines.set(`${profileKey}#voz`, new QueryEngine(provider, filteredRegistry, `${vozPrompt}${pc ? `\n\n### Su PC\n${pc}` : ''}\n\n### Perfil\n${profileText ?? ''}`, {
                router: routerVoz,
                // Sin herramientas para el turno, de verdad ninguna: el respaldo de salud + Finanzas llevaba el prompt a ~7.200 tokens,
                // pasaba de 8192 y Ollama recargaba el modelo en cada turno (4 s cada vez; prueba J1)
                respaldoHerramientas: false,
                // J2: con las herramientas del PC el prompt pedía 10240 → Ollama recargaba el modelo y quedaba 59 % en la tarjeta (6-10 s
                // hasta la pregunta de aprobación). En la llamada, siempre 8192: si no cabe, se recorta la conversación vieja.
                maxContext: 8192,
                // y la redacción después de una herramienta también por tokens (antes llegaba entera: 6-9 s de silencio tras la muletilla)
                hablaTrasHerramientas: true,
                // J3: las definiciones en corto (Ollama lee todo el prompt en cada pasada con este modelo)
                herramientasCortas: true,
              }));
            }

            if (!sessions.has(sessionId)) sessions.set(sessionId, memory.getConversation(sessionId));
            const history = sessions.get(sessionId) || [];

            // Registrar cliente para recibir push de alertas CGM
            registerClient(profileId, ws);

            // Medición de la beta: alta (la de su cuenta de Google), rol y una conexión más
            ctxUso.profileId = profileId;
            const cuentaUso = await accountStore.findByProfile(profileId).catch(() => undefined);
            await betaMetrics.conectar(profileId, { rol: profileRole, alta: cuentaUso?.account.createdAt }).catch(() => {});
            const usoFuera = await betaMetrics.estaFuera(profileId).catch(() => false);

            ws.send(JSON.stringify({
              type: 'connected',
              features: await getFeatures(),
              // «Ayudar a mejorar Eris» (Perfil): si se cuentan sus datos de uso
              usoMedido: !usoFuera,
              sessionId, profileId,
              role: profileRole,
              showWelcome: await shouldWelcome(memory),
              // Con Google no hay PIN ni llave de recuperación que mostrar; el token de sesión solo viaja en el inicio
              recoveryKey: ssoLogin ? undefined : recoveryKey,
              sessionToken: sessionTokenOut,
              userProfile,
              conversations: convList(memory, ws),
              projects: memory.listProjects(),
              history: history.map(m => ({ role: m.role, content: m.content, id: m.id })),
              defaultMode: DEFAULT_CONFIG.defaultMode,
              availableModes: Object.values(THINKING_MODES).map(m => ({ id: m.id, label: m.label, icon: m.icon, description: m.description })),
            }));

            // Bitácora de accesos. Las reconexiones automáticas de la app se agrupan: una entrada cada 30 min por perfil.
            const loginKind = sessionTokenOut ? 'google' : ssoLogin ? 'sesión' : 'legacy';
            const lk = `${profileId}:${loginKind}`;
            if (loginKind !== 'sesión' || Date.now() - (lastLoginAudit.get(lk) ?? 0) > 30 * 60_000) {
              lastLoginAudit.set(lk, Date.now());
              void audit.record({ event: 'login', profileId, role: profileRole, detail: loginKind, ip: remoteAddress });
            }
          } catch (err: any) {
            console.error('[WS] Error de autenticación/memoria:', err);
            // code: la app cierra la sesión solo con esto (no por una palabra del texto; revisión S3)
            ws.send(JSON.stringify({ type: 'error', code: 'auth_failed', message: err?.message || 'PIN incorrecto.' }));
            return;
          }
          return;
        }

        // ─── Mensajes post-autenticación ───────────────────────────────────────
        const pin = (ws.data as any).pin;
        let memory: MemoryAdapter;
        try {
          const m = await getOrCreateMemory(profileId, pin);
          memory = m.memory;
        } catch (e) {
          ws.send(JSON.stringify({ type: "error", message: "Acceso denegado al perfil." }));
          return;
        }

        try {
          const data = JSON.parse(message as string);
          // Tamaño máximo por tipo de mensaje (revisión 2026-10-31, S2): lo que manda el teléfono termina en la memoria y en
          // el contexto del modelo; sin tope, un texto enorme llenaba el disco o el prompt. Los mayores son el audio y las fotos.
          const tope = WS_TOPES[String(data?.type)] ?? WS_TOPE_DEFAULT;
          if (String(message).length > tope) {
            console.warn(`[WS] ${profileId}: «${String(data?.type).slice(0, 40)}» de ${String(message).length} caracteres (tope ${tope}): se ignora`);
            ws.send(JSON.stringify({ type: "error", code: "too_large", message: "El mensaje es demasiado grande." }));
            return;
          }
          // Medición de la beta: una cosa más que hizo la persona (solo cuenta los tipos de ACCIONES; las sincronizaciones no)
          if (ACCIONES_USO.has(String(data.type))) usoMedido(() => betaMetrics.accion(profileId, String(data.type)));

          if (data.type === "logout") {
            // Cerrar sesión: el token deja de valer también en el servidor
            try {
              const s = data.token ? await accountStore.resolveSession(String(data.token)) : null;
              if (s && s.profileId === profileId) await accountStore.revokeSession(String(data.token));
            } catch {}
            ws.send(JSON.stringify({ type: "logged_out" }));
            void audit.record({ event: "logout", profileId, role: (ws.data as any).role, ip: remoteAddress });
            return;
          }

          // ─── Respuesta a una tarjeta de aprobación ───────────────────────────
          // Solo cuenta si llega por la misma conexión y del mismo perfil que la recibió; el contenido lo puso el servidor.
          if (data.type === "confirm_response") {
            const p = pendingApprovals.get(String(data.id));
            if (!p || p.ws !== ws || p.profileId !== profileId) return;
            p.finish(data.approved === true ? "approved" : "denied", false);
            return;
          }

          // ─── Panel de administración (solo Ikaros con Google) ────────────────
          if (typeof data.type === "string" && data.type.startsWith("admin_")) {
            const isAdmin = (ws.data as any).role === "ikaros" && (ws.data as any).sso === true;
            if (!isAdmin) {
              void audit.record({ event: "security", profileId, role: (ws.data as any).role, detail: `intento de ${String(data.type).slice(0, 40)} sin ser administrador`, ok: false, ip: remoteAddress });
              ws.send(JSON.stringify({ type: "admin_result", ok: false, message: "Permiso denegado." }));
              return;
            }
            const sendOverview = async () => {
              const filas = await adminService.overview();
              ws.send(JSON.stringify({
                type: "admin_overview",
                // Con el grupo de la beta de cada uno (beta, paga o equipo): lo marca el administrador
                profiles: await Promise.all(filas.map(async (r) => ({ ...r, grupo: await betaMetrics.grupoDe(r.profileId).catch(() => undefined) }))),
                integrity: await audit.verify(),
                server: {
                  uptimeSec: Math.round(process.uptime()),
                  connections: [...activeClients.values()].reduce((n, s) => n + s.size, 0),
                  pendingApprovals: pendingApprovals.size,
                  legacyLogin: LEGACY_LOGIN_ENABLED,
                },
                features: await getFeatures(),
              }));
            };
            const target = String(data.profileId ?? "").toLowerCase();
            const reply = async (action: string, r: { ok: boolean; message: string }) => {
              ws.send(JSON.stringify({ type: "admin_result", action, ok: r.ok, message: r.message }));
              await sendOverview();
            };

            if (data.type === "admin_overview") { await sendOverview(); return; }

            // ─── Medición de la beta: el informe (cohortes, chat, PC) y a quién cuenta cada grupo ──
            if (data.type === "admin_beta_report") {
              await betaMetrics.guardar();
              ws.send(JSON.stringify({ type: "admin_beta_report", informe: armarInforme(await betaMetrics.datos(), isoDayKey(new Date())) }));
              return;
            }
            if (data.type === "admin_set_grupo") {
              const grupo = String(data.grupo ?? "");
              if (!/^[a-z0-9._-]{1,64}$/.test(target) || !["beta", "pagado", "equipo"].includes(grupo)) {
                await reply("set_grupo", { ok: false, message: "Grupo o perfil inválido." });
                return;
              }
              await betaMetrics.setGrupo(target, grupo as "beta" | "pagado" | "equipo");
              void audit.record({ event: "admin", profileId, role: "ikaros", detail: `set_grupo ${target}: ${grupo}`, ok: true });
              await reply("set_grupo", { ok: true, message: grupo === "pagado" ? `${target} cuenta como persona que paga desde hoy.` : grupo === "equipo" ? `${target} es del equipo: no entra en las cifras de la beta.` : `${target} cuenta en la beta (gratis).` });
              return;
            }

            // ─── Modo empresa de la app: estado de AXS (bóveda) y del PC, calculados en código ──
            if (data.type === "admin_axs_dashboard") {
              const [dash, system] = await Promise.all([
                VaultIndex.build(new VaultService().getVaultPath()).then((idx) => buildAxsDashboard(idx)).catch((e) => ({ error: String(e?.message ?? e) })),
                systemStatus(PORT).catch(() => null),
              ]);
              ws.send(JSON.stringify({
                type: "admin_axs_dashboard",
                ...("error" in dash ? { ok: false, message: `No pude leer la bóveda de AXS (${dash.error.slice(0, 120)}).` } : { ok: true, dashboard: dash }),
                system,
                server: { connections: [...activeClients.values()].reduce((n, x) => n + x.size, 0), pendingApprovals: pendingApprovals.size, integrity: await audit.verify().catch(() => null) },
              }));
              return;
            }
            // ─── Sistema (Modo AXS): iniciar, detener o reiniciar un servicio de Eris con un botón (services/ServiceControl.ts) ──
            if (data.type === "admin_service") {
              const req = parseServiceRequest(data.service, data.action, PORT);
              const base = { type: "admin_service", service: String(data.service ?? "").slice(0, 20), action: String(data.action ?? "").slice(0, 20) };
              if ("error" in req) { ws.send(JSON.stringify({ ...base, ok: false, message: req.error })); return; }
              ws.send(JSON.stringify({ ...base, pending: true }));
              const r = await runServiceAction(req.service, req.action);
              void audit.record({ event: "admin", profileId, role: "ikaros", detail: `Servicios: ${req.action} ${SERVICE_LABEL[req.service]}${r.ok ? "" : " (no resultó)"}`, ok: r.ok, ip: remoteAddress });
              try { ws.send(JSON.stringify({ ...base, ok: r.ok, message: r.message, restartingServer: !!r.restartingServer, system: r.restartingServer ? undefined : await systemStatus(PORT).catch(() => null) })); } catch {}
              return;
            }
            // Ficha de un proyecto o nota (la misma del chat: «¿en qué está Lander?»)
            if (data.type === "admin_axs_project") {
              try {
                const idx = await VaultIndex.build(new VaultService().getVaultPath());
                const r = buildProject(idx, String(data.name ?? "").slice(0, 120));
                ws.send(JSON.stringify({ type: "admin_axs_project", requestId: data.requestId, ok: !!r.found, name: r.found?.name ?? String(data.name ?? ""), path: r.found?.path, text: r.text }));
              } catch (e: any) {
                ws.send(JSON.stringify({ type: "admin_axs_project", requestId: data.requestId, ok: false, name: String(data.name ?? ""), text: "No pude leer la bóveda de AXS." }));
              }
              return;
            }

            if (data.type === "admin_audit") {
              const f = String(data.filter ?? "all");
              const event = f === "tools" ? "tool" : f === "access" ? ["login", "login_failed", "logout"] as any : f === "admin" ? ["admin", "security"] as any : undefined;
              ws.send(JSON.stringify({ type: "admin_audit", filter: f, entries: await audit.tail({ limit: Math.min(Number(data.limit) || 80, 200), event, profileId: data.profileId ? target : undefined }) }));
              return;
            }

            if (data.type === "admin_set_role") {
              const role = data.role === "ikaros" ? "ikaros" : "eris";
              // Primero se valida: no se le pide al admin aprobar algo que igual se rechazaría
              const pre = await adminService.checkSetRole(profileId, target, role);
              if (!pre.ok) { await reply("set_role", pre); return; }
              if (role === "ikaros" && !pre.unchanged) {
                // Dar Ikaros es dar el control de este PC (con aprobación): se pide una confirmación aparte
                const ok = await askApproval(ws, profileId, {
                  toolCallId: "admin", tool: "admin_set_role", risk: "high", flags: ["acceso total al sistema"],
                  title: `Dar el rol Ikaros a ${target}`,
                  detail: `${target} podrá pedirle a Eris que ejecute comandos y toque archivos de este PC (cada acción sigue pidiendo aprobación en SU teléfono, no en el tuyo), y administrar a todos los usuarios.\n\nSolo se lo das a alguien de total confianza.`,
                });
                if (ok !== "approved") { await reply("set_role", { ok: false, message: "Cambio cancelado." }); return; }
              }
              const r = await adminService.setRole(profileId, target, role);
              if (r.ok) kickProfile(target);
              await reply("set_role", r);
              return;
            }

            if (data.type === "admin_revoke_sessions") {
              const r = await adminService.revokeSessions(profileId, target);
              if (r.ok) kickProfile(target);
              await reply("revoke_sessions", r);
              return;
            }

            // Visto bueno de un módulo (p. ej. glucosa). Se aplica en vivo a todos los teléfonos conectados.
            if (data.type === "admin_set_feature") {
              const feature: unknown = data.feature;
              if (!isFeatureName(feature)) { await reply("set_feature", { ok: false, message: "Función desconocida." }); return; }
              const on = data.enabled === true;
              const features = await setFeature(feature, on);
              void audit.record({ event: "admin", profileId, role: "ikaros", detail: `${FEATURE_LABELS[feature]}: ${on ? "activado" : "desactivado"}`, ok: true, ip: remoteAddress });
              if (feature === "glucose" && !on) {
                // Apagarlo corta la lectura del sensor y sus alertas en el acto
                for (const [pid, svc] of [...activeGlucoServices.entries()]) { try { svc.stopPolling(); } catch {} activeGlucoServices.delete(pid); }
              }
              for (const set of activeClients.values()) for (const c of set) { try { c.send(JSON.stringify({ type: "features_updated", features })); } catch {} }
              await reply("set_feature", { ok: true, message: `${FEATURE_LABELS[feature]} ${on ? "activado" : "desactivado"} para todos.` });
              return;
            }

            if (data.type === "admin_set_disabled") {
              const r = await adminService.setDisabled(profileId, target, data.disabled === true);
              if (r.ok && data.disabled === true) kickProfile(target);
              await reply("set_disabled", r);
              return;
            }
            return;
          }

          if (data.type === "change_pin") {
            if ((ws.data as any).sso) {
              ws.send(JSON.stringify({ type: "error", message: "Tu cuenta usa Google: no hay PIN que cambiar." }));
              return;
            }
            const newPin = data.newPin;
            if (!newPin) { ws.send(JSON.stringify({ type: "error", message: "Nuevo PIN inválido" })); return; }
            await memory.changePin(newPin);
            
            const oldKey = `${profileId}:${pin || ''}`;
            const newKey = `${profileId}:${newPin}`;
            memories.delete(oldKey);
            memories.set(newKey, memory);
            (ws.data as any).pin = newPin;
            
            ws.send(JSON.stringify({ type: "pin_changed", success: true }));
            return;
          }

          // ─── Eris ↔ Hestia: la app avisa en qué modo está (al conectar y al cambiar). Cada una tiene su lista de chats y
          // su último chat abierto; los datos (comida, agua, metas, Finanzas) son los mismos para las dos. ──
          if (data.type === "set_persona") {
            const prev = personaOfWs(ws);
            (ws.data as any).persona = (ws.data as any).role === "ikaros" && data.axs === true ? "hestia" : "eris";
            const next = personaOfWs(ws);
            const cur = (ws.data as any).sessionId;
            const curOwner = memory.conversationPersona(cur);
            const curHasMsgs = (sessions.get(cur)?.length ?? 0) > 0;
            // El chat abierto ya es de quien atiende (p. ej. al reconectar en Hestia): se queda; solo cambia la lista
            if (curOwner === next || (!curOwner && prev === next)) {
              ws.send(JSON.stringify({ type: "conversations_updated", conversations: convList(memory, ws), projects: memory.listProjects() }));
              return;
            }
            // El chat abierto queda como el último de quien atendía; se abre el último de la otra (o uno nuevo; uno vacío se reusa)
            if (curHasMsgs) await memory.set(`last_chat_${curOwner ?? prev}`, cur).catch(() => {});
            const remembered = await memory.get(`last_chat_${next}`).catch(() => null);
            const valid = typeof remembered === "string" && remembered !== cur &&
              memory.getConversation(remembered).length > 0 && (memory.conversationPersona(remembered) ?? next) === next;
            const targetId = valid ? claimSession(remembered, profileId) : curHasMsgs ? crypto.randomUUID() : cur;
            if (!sessions.has(targetId)) sessions.set(targetId, valid ? memory.getConversation(targetId) : []);
            sessionOwners.set(targetId, profileId);
            (ws.data as any).sessionId = targetId;
            const h = sessions.get(targetId) || [];
            ws.send(JSON.stringify({
              type: "chat_switched", sessionId: targetId,
              history: h.map((m) => ({ role: m.role, content: m.content, id: m.id })),
              conversations: convList(memory, ws), projects: memory.listProjects(),
            }));
            return;
          }

          if (data.type === "new_chat") {
            const newId = crypto.randomUUID();
            sessions.set(newId, []);
            sessionOwners.set(newId, profileId);
            (ws.data as any).sessionId = newId;
            
            if (data.projectId) {
              await memory.saveConversation(newId, [], personaOfWs(ws));
              await memory.assignConversationToProject(newId, data.projectId);
            }

            ws.send(JSON.stringify({
              type: "chat_switched",
              sessionId: newId,
              history: [],
              conversations: convList(memory, ws),
            }));
            return;
          }

          if (data.type === "switch_chat") {
            // Si ese chat es de otro perfil no se muestra (se abre uno vacío): antes los ids de sesión eran globales
            const targetId = claimSession(String(data.conversationId), profileId);
            if (!sessions.has(targetId)) {
              const saved = memory.getConversation(targetId);
              sessions.set(targetId, saved);
            }
            (ws.data as any).sessionId = targetId;
            const history = sessions.get(targetId) || [];
            ws.send(JSON.stringify({
              type: "chat_switched",
              sessionId: targetId,
              history: history.map(m => ({ role: m.role, content: m.content, id: m.id })),
              conversations: convList(memory, ws),
            }));
            return;
          }

          if (data.type === "delete_chat") {
            const targetId = data.conversationId;
            if (sessionOwners.get(targetId) === profileId || !sessionOwners.has(targetId)) sessions.delete(targetId);
            await memory.clearConversation(targetId);
            const currentId = (ws.data as any).sessionId;
            if (currentId === targetId) {
              const newId = crypto.randomUUID();
              sessions.set(newId, []);
              (ws.data as any).sessionId = newId;
              ws.send(JSON.stringify({
                type: "chat_switched",
                sessionId: newId,
                history: [],
                conversations: convList(memory, ws),
              }));
            } else {
              ws.send(JSON.stringify({
                type: "conversations_updated",
                conversations: convList(memory, ws),
              }));
            }
            return;
          }

          if (data.type === "rename_chat") {
            await memory.renameConversation(data.conversationId, data.title || "");
            ws.send(JSON.stringify({
              type: "conversations_updated",
              conversations: convList(memory, ws),
            }));
            return;
          }

          if (data.type === "create_project") {
            const project = await memory.createProject(data.name || "Nuevo Proyecto", data.emoji || "📁", typeof data.instructions === "string" ? data.instructions : undefined);
            ws.send(JSON.stringify({
              type: "project_created",
              project,
              projects: memory.listProjects(),
            }));
            return;
          }

          if (data.type === "delete_project") {
            await memory.deleteProject(data.projectId);
            ws.send(JSON.stringify({
              type: "conversations_updated",
              conversations: convList(memory, ws),
              projects: memory.listProjects(),
            }));
            return;
          }

          if (data.type === "assign_to_project") {
            await memory.assignConversationToProject(data.conversationId, data.projectId);
            ws.send(JSON.stringify({
              type: "conversations_updated",
              conversations: convList(memory, ws),
              projects: memory.listProjects(),
            }));
            return;
          }

          // Editar un proyecto: nombre, emoji y/o instrucciones (las instrucciones se aplican a TODOS sus chats)
          if (data.type === "update_project") {
            await memory.updateProject(data.projectId, {
              name: typeof data.name === "string" ? data.name : undefined,
              emoji: typeof data.emoji === "string" ? data.emoji : undefined,
              instructions: typeof data.instructions === "string" ? data.instructions : undefined,
            });
            ws.send(JSON.stringify({
              type: "conversations_updated",
              conversations: convList(memory, ws),
              projects: memory.listProjects(),
            }));
            return;
          }

          if (data.type === "rename_project") {
            await memory.renameProject(data.projectId, data.name, data.emoji);
            ws.send(JSON.stringify({
              type: "conversations_updated",
              conversations: convList(memory, ws),
              projects: memory.listProjects(),
            }));
            return;
          }

          if (data.type === "refresh") {
            // El cliente solicita reenvío del estado de sesión.
            // Esto ocurre cuando ChatScreen monta DESPUÉS de que la conexión ya fue establecida
            // (ej: reboot de la app) y nunca recibió el evento 'connected' inicial.
            const currentSessionId = (ws.data as any).sessionId;
            const history = sessions.get(currentSessionId) || [];
            ws.send(JSON.stringify({
              type: 'connected',
              features: await getFeatures(),
              sessionId: currentSessionId,
              profileId,
              role: (ws.data as any).role,
              showWelcome: await shouldWelcome(memory),
              conversations: convList(memory, ws),
              projects: memory.listProjects(),
              history: history.map((m: any) => ({ role: m.role, content: m.content, id: m.id })),
              defaultMode: DEFAULT_CONFIG.defaultMode,
            }));
            return;
          }

          if (data.type === "save_preference") {
            // Solo las preferencias que manda la app y con tamaño acotado (revisión 2026-10-31, S1: la clave iba tal cual a
            // la ruta del archivo y con «../» se escribía fuera del perfil)
            const PREFS = new Set(["notifications", "auto_prefs", "metricas_uso"]);
            const key = typeof data.key === "string" ? data.key : "";
            // «Ayudar a mejorar Eris» (medición de la beta): apagado deja de contar y borra lo contado. Vive fuera del perfil
            // cifrado (la medición no lo abre), en el registro de la medición.
            if (key === "metricas_uso" && typeof data.value === "boolean") {
              await betaMetrics.setFuera(profileId, !data.value).catch(() => {});
              ws.send(JSON.stringify({ type: "preference_saved", key }));
              return;
            }
            if (PREFS.has(key) && JSON.stringify(data.value ?? null).length <= 8_000) {
              try { await memory.set(`pref_${key}`, data.value); } catch {}
              ws.send(JSON.stringify({ type: "preference_saved", key }));
            }
            return;
          }

          if (data.type === "save_profile") {
            // La app manda el perfil completo que tenía en pantalla: lo que guardó Eris por chat y la app no conoce (exámenes)
            // no se pierde por guardar desde el teléfono
            const current = await memory.getProfile().catch(() => null);
            if (data.profile?.medical && data.profile.medical.labs === undefined && current?.medical?.labs?.length) {
              data.profile = { ...data.profile, medical: { ...data.profile.medical, labs: current.medical.labs } };
            }
            // El historial médico tiene un solo camino (medical_history_*): una copia vieja de la app no lo pisa ni revive lo borrado
            if (data.profile?.medical) {
              const { history: _h, ...med } = data.profile.medical;
              data.profile = { ...data.profile, medical: { ...med, ...(current?.medical?.history?.length ? { history: current.medical.history } : {}) } };
            }
            await memory.saveProfile(data.profile);
            queryEngines.delete(`${profileId}:${pin || ''}`);
            queryEngines.delete(`${profileId}:${pin || ''}#eris`);
            queryEngines.delete(`${profileId}:${pin || ''}#voz`);
            const oldGluco = activeGlucoServices.get(profileId);
            if (oldGluco) { oldGluco.stopPolling(); activeGlucoServices.delete(profileId); }
            ws.send(JSON.stringify({ type: "profile_saved", profile: data.profile }));
            return;
          }

          // ─── Historial médico (Inventario → Botiquín): consultas, exámenes, vacunas y eventos con su fecha ───
          if (data.type === "medical_history_add" || data.type === "medical_history_delete") {
            const profile: any = await memory.getProfile().catch(() => null);
            if (!profile) { ws.send(JSON.stringify({ type: "medical_history_saved", requestId: data.requestId, ok: false, msg: "Todavía no tienes perfil" })); return; }
            const medical = profile.medical ?? { conditions: [], medications: [], thresholds: {} };
            let history: any[] = Array.isArray(medical.history) ? medical.history : [];
            if (data.type === "medical_history_add") {
              const e = data.entry ?? {};
              const TIPOS = ["consulta", "examen", "vacuna", "procedimiento", "urgencia", "evento"];
              const title = String(e.title ?? "").trim().slice(0, 80);
              if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) || !TIPOS.includes(e.type) || !title) {
                ws.send(JSON.stringify({ type: "medical_history_saved", requestId: data.requestId, ok: false, msg: "Falta la fecha, el tipo o qué fue" }));
                return;
              }
              history = [...history, { id: crypto.randomUUID(), date: e.date, type: e.type, title, ...(e.note ? { note: String(e.note).trim().slice(0, 400) } : {}), addedAt: new Date().toISOString() }]
                .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 300);
            } else {
              history = history.filter((h) => h.id !== data.id);
            }
            const next = { ...profile, medical: { ...medical, history } };
            await memory.saveProfile(next);
            ws.send(JSON.stringify({ type: "medical_history_saved", requestId: data.requestId, ok: true, history }));
            ws.send(JSON.stringify({ type: "profile_saved", profile: next }));
            return;
          }

          // ─── Insulina ──────────────────────────────────────────────────────
          // Registrar dosis es TRATAR, no cuidar (decisión 2026-10-07): va con el módulo de glucosa, apagado hasta su visto bueno
          if ((data.type === "log_insulin" || data.type === "get_insulin_log" || data.type === "delete_insulin_dose") && !(await getFeatures()).glucose) {
            ws.send(JSON.stringify({ type: "error", message: "El registro de insulina está desactivado por ahora." }));
            return;
          }
          if (data.type === "log_insulin") {
            try {
              await memory.logInsulin(data.dose);
              ws.send(JSON.stringify({ type: "insulin_logged", dose: data.dose }));
            } catch (e: any) {
              ws.send(JSON.stringify({ type: "error", message: e.message }));
            }
            return;
          }

          if (data.type === "get_insulin_log") {
            try {
              const log = await memory.getInsulinLog(data.days ?? 7);
              ws.send(JSON.stringify({ type: "insulin_log", log }));
            } catch (e: any) {
              ws.send(JSON.stringify({ type: "error", message: e.message }));
            }
            return;
          }

          if (data.type === "delete_insulin_dose") {
            try {
              await memory.deleteInsulinDose(data.id);
              ws.send(JSON.stringify({ type: "insulin_dose_deleted", id: data.id }));
            } catch (e: any) {
              ws.send(JSON.stringify({ type: "error", message: e.message }));
            }
            return;
          }

          // ─── Snapshot de salud desde el móvil ────────────────────────────
          // El móvil manda esto cuando lee datos de Health Connect.
          // Lo guardamos en memoria para inyectarlo al contexto del LLM.
          if (data.type === "update_health_snapshot") {
            if (data.snapshot) {
              // Lista de alimentos del día que manda el teléfono (lo anotado a mano incluido): es entrada externa, se valida.
              if (data.snapshot.foodLog !== undefined) {
                const foodLog = sanitizePhoneFoodLog(data.snapshot.foodLog);
                if (foodLog) data.snapshot.foodLog = foodLog; else delete data.snapshot.foodLog;
              }
              // Qué tomas de agua del chat ya están en el total del teléfono (services/WaterToday.ts): solo instantes válidos
              if (data.snapshot.chatWaterCounted !== undefined) {
                const list = Array.isArray(data.snapshot.chatWaterCounted)
                  ? data.snapshot.chatWaterCounted.filter((t: unknown) => typeof t === "string" && t.length <= 40 && !Number.isNaN(Date.parse(t))).slice(-200)
                  : null;
                if (list) data.snapshot.chatWaterCounted = list; else delete data.snapshot.chatWaterCounted;
              }
              // Merge en lugar de reemplazar para que cada fuente (métricas, nutrición, etc.)
              // pueda actualizar su propia parte sin borrar las demás. Antes esto vivía en un
              // Map en memoria (se perdía al reiniciar el server); ahora el merge se hace
              // directo contra lo último persistido, que es también lo que lee LiveContextTool.
              let merged = data.snapshot;
              let prevActivity: any = null;
              // Piloto automático del plan de Eris: con los datos al día (despertó, es de noche), arma lo que toque
              // (uno por perfil: el teléfono manda varias partes seguidas y cada una armaba su propio intento; revisión S2)
              clearTimeout(autoTickTimers.get(profileId));
              autoTickTimers.set(profileId, setTimeout(() => { autoTickTimers.delete(profileId); import("./services/DayPlanService.js").then((DP) => DP.autoTick(memory, ws)).catch(() => null); }, 1500));
              try {
                const existing = await memory.get('health_snapshot_latest');
                prevActivity = existing?.activity ?? null;
                merged = existing ? { ...existing, ...data.snapshot } : data.snapshot;
                await memory.set('health_snapshot_latest', merged);
              } catch {}
              // La actividad del reloj cambió (terminó un partido): las metas de hoy cambian (DailyTargets) → al teléfono
              try {
                const na = merged?.activity;
                if (na && typeof na.kcal === "number" && (!prevActivity || na.day !== prevActivity.day || Math.abs(na.kcal - (prevActivity.kcal ?? 0)) >= 50)) {
                  ws.send(JSON.stringify({ type: "nutrition_today", ...(await buildNutritionToday(memory)) }));
                }
              } catch {}
              try {
                // Sueño, pulso y entreno: el día calendario. El sueño, en el día al que cuenta: a medianoche, lo último que se sabe sigue
                // siendo la noche de ayer y se copiaba a la fila de hoy (el 11-07 ya traía las 7 h 45 del 11-06, sin haber dormido).
                // Una app sin ese dato (antes de la 1.89): como antes.
                const sueno = {
                  sleepHours: merged.sleep?.durationHours,
                  sleepNightHours: typeof merged.sleep?.nightHours === "number" ? merged.sleep.nightHours : undefined,
                };
                const diaSueno = typeof merged.sleep?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(merged.sleep.day) ? merged.sleep.day : null;
                if (diaSueno) await memory.upsertDailyRollup(sueno, diaSueno);
                await memory.upsertDailyRollup({
                  ...(diaSueno ? {} : sueno),
                  restingHR: merged.heartRate?.resting,
                  // Solo si Forge dijo que fue HOY: `trained` a secas quedaba en true para siempre y marcaba todos los días
                  trained: merged.trainedDay === isoDayKey(new Date()) || undefined,
                });
                // Comida y agua: el día de COMIDA (termina al dormir; services/MealSchedule.ts). A las 2 AM sin haber dormido
                // los totales del teléfono son los de ayer y van a ayer.
                await memory.upsertDailyRollup({
                  // Los pasos también (pedido del usuario, 2026-11-05): desde la 1.84 el teléfono los cuenta hasta que te duermes;
                  // en el día del calendario, los de después de medianoche caían en la fila de hoy y se pisaban al día siguiente
                  steps: merged.steps,
                  // La cuenta única del agua (teléfono + lo del chat que el teléfono aún no contó); solo lo BEBIDO: los días
                  // anteriores del historial no tienen el agua de la comida y el análisis compara contra ellos
                  hydrationL: (await waterTotalToday(memory).catch(() => null))?.drinksL ?? merged.hydration,
                  proteinG: merged.nutrition?.protein,
                  carbsG: merged.nutrition?.carbs,
                  fatG: merged.nutrition?.fat,
                  calories: merged.nutrition?.calories,
                }, isoDayKey(nutritionDayOf(new Date(), dayCtxFrom(merged))));
              } catch {}
              // Medición de la beta: cuántas comidas, cuánta agua y si hubo sueño o entreno ese día (números, nunca el detalle).
              // Solo lo que trae ESTE envío: lo mezclado arrastra valores de envíos anteriores.
              try {
                const s = data.snapshot;
                const diaComida = isoDayKey(nutritionDayOf(new Date(), dayCtxFrom(merged)));
                // La lista del teléfono es { date, items } (ya validada arriba): cuántos alimentos tiene ese día
                // (su `date` va como «Wed Nov 11 2026», el formato del registro de comidas; la medición usa 2026-11-11)
                if (Array.isArray(s.foodLog?.items)) usoMedido(() => betaMetrics.registro(profileId, "comidas", s.foodLog.items.length, isValidDay(s.foodLog.date) ? isoDayKey(new Date(Date.parse(s.foodLog.date))) : diaComida));
                if (typeof s.hydration === "number") usoMedido(() => betaMetrics.registro(profileId, "aguaMl", s.hydration * 1000, diaComida));
                if (typeof s.sleep?.day === "string" && Number(s.sleep?.durationHours) > 0) usoMedido(() => betaMetrics.registro(profileId, "sueno", 1, s.sleep.day));
                if (typeof s.trainedDay === "string" && s.trainedDay === isoDayKey(new Date())) usoMedido(() => betaMetrics.registro(profileId, "entreno", 1, s.trainedDay));
              } catch {}
              ws.send(JSON.stringify({ type: "health_snapshot_received" }));
            }
            return;
          }

          // ─── Resultado de una operación de Finanzas pedida por finance_tracker ───
          if (data.type === "finance_op_result") {
            resolveFinanceOp(ws, data);
            return;
          }
          // ─── Resultado de una operación de Inventario pedida por inventory_tracker ───
          // ─── Hestia Manos (K0): el resultado de algo hecho en el teléfono, y sus apps (para «abre Spotify») ───
          if (data.type === "telefono_op_result") {
            resolveTelefonoOp(ws, data);
            return;
          }
          if (data.type === "telefono_apps") {
            (ws.data as any).telefonoApps = Array.isArray(data.apps) ? data.apps.map((a: unknown) => String(a).slice(0, 60)).slice(0, 300) : [];
            return;
          }
          if (data.type === "inventory_op_result") {
            resolveInventoryOp(ws, data);
            return;
          }
          // ─── Lo que tiene en casa (Inventario): el texto para Eris y los números (el asesor de comida los usa en I7) ───
          // ─── «Mis suplementos» (fase I5): el resultado de una toma por chat, lo de hoy para Eris y el estado completo ──
          // El estado se guarda (cifrado, como todo el perfil) para responder «¿qué me falta?» sin el teléfono y para devolverlo
          // si el teléfono aparece sin nada (otro teléfono, app reinstalada). Un estado vacío nunca pisa uno con suplementos.
          if (data.type === "supplement_op_result") {
            resolveSupplementOp(ws, data);
            return;
          }
          if (data.type === "update_supplement_context") {
            usoMedido(() => betaMetrics.registro(profileId, "suplementos"));
            try {
              if (typeof data.context === "string" && data.context.length < 20_000) {
                await memory.set("supplements_context_latest", { at: new Date().toISOString(), context: data.context, summary: data.summary && typeof data.summary === "object" ? data.summary : null });
              }
              const st = data.state;
              if (st && typeof st === "object" && Array.isArray(st.items) && JSON.stringify(st).length < 200_000) {
                const prev: any = await memory.get("supplements_state").catch(() => null);
                const vacio = !st.items.length && !Object.keys(st.log ?? {}).length;
                if (!vacio || !prev?.state?.items?.length) await memory.set("supplements_state", { at: new Date().toISOString(), state: st });
              }
            } catch {}
            return;
          }
          if (data.type === "supplement_state_get") {
            const prev: any = await memory.get("supplements_state").catch(() => null);
            ws.send(JSON.stringify({ type: "supplement_state", state: prev?.state ?? null, at: prev?.at ?? null }));
            return;
          }
          // ─── Tus versiones de alimentos (app 1.58): el chat las usa antes que la base (FoodResolve.myFoodFor) ──
          if (data.type === "my_foods_sync") {
            try { await memory.set("my_foods", cleanMyFoods(data.foods)); } catch {}
            return;
          }
          if (data.type === "update_inventory_context") {
            usoMedido(() => betaMetrics.registro(profileId, "inventario"));
            if (typeof data.context === "string" && data.context.length < 60_000) {
              try { await memory.set("inventory_context_latest", { at: new Date().toISOString(), context: data.context, summary: data.summary && typeof data.summary === "object" ? data.summary : null }); } catch {}
            }
            return;
          }

          // ─── Contexto financiero desde Hunter Wallet ─────────────────────────
          if (data.type === "update_financial_context") {
            usoMedido(() => betaMetrics.registro(profileId, "finanzas"));
            if (data.context) {
              try { await memory.set('financial_context_latest', data.context); } catch {}
              // Finanzas 2.0: los números como dato (el asesor de comida usa el presupuesto al día; MetabolicAnalysis)
              if (data.summary && typeof data.summary === "object") {
                const sm = data.summary, num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
                const presupuesto = Array.isArray(sm.presupuesto) ? sm.presupuesto.slice(0, 20).filter((l: any) => l && typeof l.cat === "string")
                  .map((l: any) => ({ cat: String(l.cat).slice(0, 30), estado: String(l.estado ?? "").slice(0, 20), queda: num(l.queda), porDia: num(l.porDia), presup: num(l.presup), gastado: num(l.gastado) })) : undefined;
                try {
                  await memory.set('financial_summary_latest', { at: new Date().toISOString(), plata: num(sm.plata), libre: num(sm.libre), porDia: num(sm.porDia),
                    runwayDias: num(sm.runwayDias), patrimonio: num(sm.patrimonio), rating: sm.rating && typeof sm.rating.nota === "string" ? { nota: sm.rating.nota.slice(0, 4), score: num(sm.rating.score) } : undefined,
                    ...(presupuesto ? { presupuesto } : {}) });
                } catch {}
              }
              if (data.summary) {
                try {
                  // Sin movimientos anotados hace más de una semana, la tasa de ahorro sale 100 % (no hay gastos) y el análisis la
                  // celebraba como mejora (2026-10-07). Las apps nuevas mandan ultimoMovimiento; con eso, sin movimientos recientes no cuenta.
                  const last = data.summary.ultimoMovimiento;
                  const stale = "ultimoMovimiento" in data.summary && (typeof last !== "string" || Date.now() - Date.parse(`${last}T12:00:00`) > 7 * 86_400_000);
                  // «Tu plata» (cuentas + ahorro) en vez del «disponible» del mes, que contaba el sueldo que aún no llegaba (2026-10-22)
                  await memory.upsertDailyRollup({
                    plata: typeof data.summary.plata === "number" ? data.summary.plata : undefined,
                    ahorroAcum: data.summary.ahorroAcum,
                    savingsRate: stale ? undefined : data.summary.savingsRate,
                  });
                } catch {}
              }
              ws.send(JSON.stringify({ type: "financial_context_received" }));
            }
            return;
          }

          // ─── Chequeo de restricciones de un alimento (la app lo pide al elegir/escanear) ──
          // Solo INFORMA: el usuario decide. Usa el catálogo de Eris + productos envasados (por código de barras).
          if (data.type === "check_food_safety") {
            try {
              const profile = await memory.getProfile();
              const restrictions = deriveRestrictions(profile?.medical);
              let name = String(data.name || "");
              let safety: any = undefined;
              if (data.barcode) {
                const f = await unifiedFood.findByBarcode(String(data.barcode)).catch(() => null);
                if (f) { name = f.name || name; safety = f.safety; }
              }
              const risk = name ? assessFood(name, safety, restrictions) : null;
              ws.send(JSON.stringify({
                type: "food_safety_result", requestId: data.requestId,
                risk: risk ? { level: risk.level, reason: risk.reason } : null,
              }));
            } catch {
              ws.send(JSON.stringify({ type: "food_safety_result", requestId: data.requestId, risk: null }));
            }
            return;
          }

          // ─── Código de barras: búsqueda en cascada (base local → OFF → USDA → solo nombre) ──
          if (data.type === "food_barcode") {
            try {
              const hit = await lookupBarcode(String(data.code || ""));
              ws.send(JSON.stringify({ type: "food_barcode_result", requestId: data.requestId, ...hit }));
            } catch {
              ws.send(JSON.stringify({ type: "food_barcode_result", requestId: data.requestId, found: false, code: String(data.code || "") }));
            }
            return;
          }
          // ─── Buscador de Nutrición: envasados chilenos (con su calce) + corrección del texto con todas las bases ──
          // Misma normalización que el resto (FoodText): tildes, mayúsculas, símbolos, espacios, orden y errores de tipeo.
          if (data.type === "food_search") {
            const query = String(data.query || "").slice(0, 80);
            let hits: Array<{ product: unknown; score: number; exact: boolean }> = [];
            let corrected: string | null = null;
            try {
              hits = searchPackagedHits(query, 8, { prefix: true, partial: true }).map((h) => ({ product: h.item, score: Math.round(h.score * 100) / 100, exact: h.exact }));
              corrected = unifiedFood.correctQuery(query);
            } catch {}
            ws.send(JSON.stringify({ type: "food_search_result", requestId: data.requestId, hits, corrected }));
            return;
          }
          // ─── Modo estricto con los antojos (fase I7; Perfil): un antojo que no calza se recomienda solo con la contrapartida ──
          // ─── «¿Qué recomienda Eris?» (Eris al timón · T1): la hoja y la tarjeta «Plan de Eris» de Inicio ──
          if (data.type === "day_plan_request") {
            const reply = (o: Record<string, unknown>) => ws.send(JSON.stringify({ type: "day_plan", requestId: data.requestId, ...o }));
            // Medición de la beta: usó el plan de Eris (armarlo, cambiar un paso, «Lo comí ✓»); mirarlo no cuenta
            if (["build", "swap", "done", "replan"].includes(String(data.action))) usoMedido(() => betaMetrics.registro(profileId, "plan"));
            try {
              const DP = await import("./services/DayPlanService.js");
              // La app que conoce el Modo Rendimiento (R1) lo avisa con v: 2; a las anteriores el plan les llega como Óptimo
              if (Number(data.v) >= 2) (ws.data as any).planV = 2;
              const rend = (ws.data as any).planV >= 2 && await DP.rendimientoOk((ws.data as any).role);
              const mode = ["estricto", "optimo", "flexible"].includes(data.mode) || (data.mode === "rendimiento" && rend) ? data.mode : "optimo";
              const nota = typeof data.nota === "string" ? data.nota.slice(0, 240) : undefined;
              // El check-in de mente (de la hoja, en el Modo Rendimiento): números del 1 al 5 y el tipo de día
              const mm = data.mente && typeof data.mente === "object" ? data.mente : null;
              const n15 = (x: unknown) => (Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 5 ? (x as number) : undefined);
              const mente = mm ? Object.fromEntries(Object.entries({ estres: n15(mm.estres), foco: n15(mm.foco), tipo: ["detalle", "ideas", "todo"].includes(mm.tipo) ? mm.tipo : undefined }).filter(([, v]) => v !== undefined)) : null;
              const reply = (o: Record<string, unknown>) => ws.send(JSON.stringify({ type: "day_plan", requestId: data.requestId, ...o, ...("plan" in o ? { plan: DP.planForClient(ws, o.plan as any) } : {}) }));
              switch (data.action) {
                case "preview": reply({ plan: await DP.loadPlan(memory), modos: await DP.previewPlans(memory, new Date(), { rendimiento: rend }), auto: (await DP.getAuto(memory)).on }); break;
                case "build": reply({ plan: await DP.buildPlan(memory, mode, nota, new Date(), null, { provider, model: THINKING_MODES.flash.model }, mente && Object.keys(mente).length ? mente : null), aplicar: true }); break;
                // Piloto automático: «que Eris arme mi día cada mañana»
                case "auto": reply({ plan: await DP.loadPlan(memory), auto: (await DP.setAuto(memory, data.on === true)).on }); if (data.on === true) void DP.autoTick(memory, ws).catch(() => null); break;
                case "swap": { const r = await DP.swapPlan(memory, String(data.slot ?? "")); reply({ plan: r?.plan ?? await DP.loadPlan(memory), ...(r ? {} : { error: "sin_opcion" }) }); break; }
                case "undo": await DP.undoPlan(memory); reply({ plan: null }); break;
                case "done": { const r = await DP.doneStep(memory, ws, String(data.pasoId ?? "")); reply({ plan: r?.plan ?? await DP.loadPlan(memory), logged: !!r?.logged }); break; }
                // Comió otra cosa (lo anotó en la app): el resto del día se rearma con lo que el teléfono sabe que comió
                case "replan": {
                  const a = data.ate && typeof data.ate === "object" ? data.ate : {};
                  const ate = { slots: Array.isArray(a.slots) ? a.slots.filter((s: unknown) => typeof s === "string").slice(0, 8) : [], kcal: Number(a.kcal) || 0, protein: Number(a.protein) || 0 };
                  reply({ plan: await DP.replan(memory, null, ate) ?? null });
                  break;
                }
                default: reply({ plan: await DP.loadPlan(memory) });
              }
            } catch (e: any) {
              reply({ error: String(e?.message ?? e).slice(0, 200) });
            }
            return;
          }
          if (data.type === "set_strict_mode") {
            try { await memory.set("strict_mode", data.on === true); } catch {}
            ws.send(JSON.stringify({ type: "strict_mode", on: data.on === true }));
            return;
          }
          // ─── El tono con que habla Eris (lo elige la persona; la edad de Forge solo sugiere uno) ──
          if (data.type === "set_tone") {
            if (isTone(data.tone)) { try { await memory.set("tone", data.tone); } catch {} }
            ws.send(JSON.stringify({ type: "tone", tone: (await getTone(memory)) ?? null }));
            return;
          }
          if (data.type === "get_tone") {
            const body: any = await memory.get("body_profile").catch(() => null);
            ws.send(JSON.stringify({ type: "tone", requestId: data.requestId, tone: (await getTone(memory)) ?? null, suggested: toneForAge(body?.age) }));
            return;
          }
          // ─── Sugerencia concreta para un aviso del teléfono (fibra, proteína, colación): por código, sin el modelo ──
          if (data.type === "nudge_suggest") {
            let suggestion = null;
            const req = parseNudgeRequest(data);
            if (req) { try { suggestion = await buildNudge(memory, req); } catch {} }
            ws.send(JSON.stringify({ type: "nudge_suggestion", requestId: data.requestId, suggestion }));
            return;
          }
          // ─── Respaldo de Finanzas, cifrado en el PC (services/FinanceBackup.ts) ──
          if (data.type === "finance_backup_push") {
            const dump = sanitizeDump(data.dump, profileId);
            if (!dump) { ws.send(JSON.stringify({ type: "finance_backup_saved", ok: false })); return; }
            try {
              const r = await saveFinanceBackup(memory, dump);
              if (r.saved) console.log(`[Finanzas] respaldo de ${profileId}: ${dump.stats.tx} movimientos, ${dump.stats.cuentas} cuentas`);
              ws.send(JSON.stringify({ type: "finance_backup_saved", ...r }));
            } catch (e: any) {
              console.warn("[Finanzas] no se pudo guardar el respaldo:", e?.message ?? e);
              ws.send(JSON.stringify({ type: "finance_backup_saved", ok: false }));
            }
            return;
          }
          if (data.type === "finance_backup_list") {
            ws.send(JSON.stringify({ type: "finance_backup_list", requestId: data.requestId, copies: await listFinanceBackups(memory).catch(() => []) }));
            return;
          }
          if (data.type === "finance_backup_pull") {
            const day = typeof data.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.day) ? data.day : undefined;
            const dump = await pullFinanceBackup(memory, day).catch(() => null);
            ws.send(JSON.stringify({ type: "finance_backup_pull", requestId: data.requestId, ok: !!dump, dump }));
            return;
          }
          // ─── El entreno de hoy («¿entrenas hoy?», services/TrainingIntent.ts): metas según el día ──
          if (data.type === "set_training_intent") {
            const today = localDay();
            const intent = data.intent === null ? null : sanitizeIntent(data.intent, today);
            if (data.intent !== null && !intent) { ws.send(JSON.stringify({ type: "training_intent", ok: false })); return; }
            await saveIntent(memory, intent?.day ?? today, intent).catch(() => {});
            ws.send(JSON.stringify({ type: "training_intent", ok: true, day: intent?.day ?? today, intent }));
            try { ws.send(JSON.stringify({ type: "nutrition_today", ...(await buildNutritionToday(memory)) })); } catch {}
            return;
          }
          if (data.type === "get_training_intent") {
            ws.send(JSON.stringify({ type: "training_intent", ok: true, day: localDay(), intent: await intentFor(memory).catch(() => null) }));
            return;
          }
          // Lo que calcula Forge con el plan de hoy y tus últimas cargas (para «hoy entreno» por chat)
          if (data.type === "sync_forge_projection") {
            const p = sanitizeProjection(data.projection);
            if (p) await memory.set(PROJECTION_KEY, p).catch(() => {});
            if (p) usoMedido(() => betaMetrics.registro(profileId, "forge"));
            return;
          }
          // ─── Respaldo de Forge, cifrado en el PC (services/ForgeBackup.ts) ──
          if (data.type === "forge_backup_push") {
            const dump = sanitizeForgeDump(data.dump, profileId);
            if (!dump) { ws.send(JSON.stringify({ type: "forge_backup_saved", ok: false })); return; }
            try {
              const r = await saveForgeBackup(memory, dump);
              if (r.saved) console.log(`[Forge] respaldo de ${profileId}: ${dump.stats.dias} días entrenados, ${dump.stats.habilidades} habilidades`);
              ws.send(JSON.stringify({ type: "forge_backup_saved", ...r }));
            } catch (e: any) {
              console.warn("[Forge] no se pudo guardar el respaldo:", e?.message ?? e);
              ws.send(JSON.stringify({ type: "forge_backup_saved", ok: false }));
            }
            return;
          }
          if (data.type === "forge_backup_list") {
            ws.send(JSON.stringify({ type: "forge_backup_list", requestId: data.requestId, copies: await listForgeBackups(memory).catch(() => []) }));
            return;
          }
          if (data.type === "forge_backup_pull") {
            const day = typeof data.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.day) ? data.day : undefined;
            const dump = await pullForgeBackup(memory, day).catch(() => null);
            ws.send(JSON.stringify({ type: "forge_backup_pull", requestId: data.requestId, ok: !!dump, dump }));
            return;
          }
          // ─── Respaldo de Inventario, cifrado en el PC (services/InventoryBackup.ts) ──
          if (data.type === "inventory_backup_push") {
            const dump = sanitizeInventoryDump(data.dump, profileId);
            if (!dump) { ws.send(JSON.stringify({ type: "inventory_backup_saved", ok: false })); return; }
            try {
              const r = await saveInventoryBackup(memory, dump);
              if (r.saved) console.log(`[Inventario] respaldo de ${profileId}: ${dump.stats.items} cosas (${dump.stats.conStock} con stock)`);
              ws.send(JSON.stringify({ type: "inventory_backup_saved", ...r }));
            } catch (e: any) {
              console.warn("[Inventario] no se pudo guardar el respaldo:", e?.message ?? e);
              ws.send(JSON.stringify({ type: "inventory_backup_saved", ok: false }));
            }
            return;
          }
          if (data.type === "inventory_backup_list") {
            ws.send(JSON.stringify({ type: "inventory_backup_list", requestId: data.requestId, copies: await listInventoryBackups(memory).catch(() => []) }));
            return;
          }
          if (data.type === "inventory_backup_pull") {
            const day = typeof data.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.day) ? data.day : undefined;
            const dump = await pullInventoryBackup(memory, day).catch(() => null);
            ws.send(JSON.stringify({ type: "inventory_backup_pull", requestId: data.requestId, ok: !!dump, dump }));
            return;
          }
          // Cartola del banco (Excel/CSV) → movimientos; se lee en memoria y no se guarda (services/FinanceStatement.ts).
          // La conciliación con lo anotado la hace el teléfono con el núcleo (conciliarCartola).
          if (data.type === "finance_statement_parse") {
            const b64 = typeof data.data === "string" ? data.data : "";
            const name = typeof data.name === "string" ? data.name.slice(0, 120) : "";
            let r: any;
            // La clave del PDF (si la pide): solo para abrirlo ahora; no se guarda ni se registra
            const clave = typeof data.clave === "string" ? data.clave.slice(0, 64) : "";
            try { r = leerCartola(b64, name, new Date(), clave); } catch (e: any) { r = { ok: false, code: "formato", msg: "No pude leer la cartola." }; }
            if (r.ok) console.log(`[Finanzas] cartola de ${profileId}: ${r.movimientos.length} movimientos (${r.formato})`);
            ws.send(JSON.stringify({ type: "finance_statement_parsed", requestId: data.requestId, ...r }));
            return;
          }
          // Foto de la boleta → productos y total (OCR de Windows en el PC; la imagen se borra al terminar; services/ReceiptOcr.ts)
          if (data.type === "finance_receipt_photo") {
            const img = typeof data.image === "string" ? data.image : "";
            let r: any;
            try { r = await leerBoletaFoto(img); } catch { r = { ok: false, code: "ocr", msg: "No pude leer la foto." }; }
            if (r.ok) console.log(`[Finanzas] boleta de ${profileId}: ${r.items.length} productos, ${r.cuadra ? "cuadra" : "NO cuadra"} con el total`);
            ws.send(JSON.stringify({ type: "finance_receipt_read", requestId: data.requestId, ...r }));
            return;
          }
          // Captura de la app del banco → los saldos que muestra (Eris administra, A2: para cuadrar). Vuelven solo números.
          if (data.type === "finance_balance_photo") {
            const img = typeof data.image === "string" ? data.image : "";
            let r: any;
            try { r = await leerSaldoCaptura(img); } catch { r = { ok: false, code: "ocr", msg: "No pude leer la captura." }; }
            ws.send(JSON.stringify({ type: "finance_balance_read", requestId: data.requestId, ...r }));
            return;
          }
          // Producto que el usuario cargó a mano desde el envase: queda en la base para la próxima vez
          if (data.type === "food_barcode_contribute") {
            const saved = data.product ? contributeProduct(data.product) : null;
            ws.send(JSON.stringify({ type: "food_barcode_saved", requestId: data.requestId, ok: !!saved, product: saved }));
            return;
          }

          // ─── Historial diario desde Health Connect: el teléfono manda los días anteriores y se rellenan SOLO los huecos ──
          if (data.type === "backfill_rollup") {
            const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined);
            const days = (Array.isArray(data.days) ? data.days : []).slice(0, 120).map((d: any) => {
              // La comida de un día solo si es creíble: con menos de 300 kcal el día quedó a medio anotar, y con más de 4.500 kcal
              // o 300 g de proteína son registros duplicados o de prueba (2026-10-10: Health Connect traía días de 7.879 kcal y
              // 413 g de proteína de cuando se probaba la app). Un día así arruinaría el patrón personal.
              const kcal = num(d?.calories, 15000), prot = num(d?.proteinG, 1000);
              const food = kcal !== undefined && kcal >= 300 && kcal <= 4500 && (prot ?? 0) <= 300;
              return {
                date: typeof d?.date === "string" ? d.date.slice(0, 10) : "",
                steps: num(d?.steps, 100000), sleepHours: num(d?.sleepHours, 20), sleepNightHours: num(d?.sleepNightHours, 20), hydrationL: num(d?.hydrationL, 15),
                ...(food ? { calories: kcal, proteinG: prot, carbsG: num(d?.carbsG, 2000), fatG: num(d?.fatG, 1000) } : {}),
              };
            });
            try {
              const n = await memory.fillDailyRollupGaps(days);
              if (n) console.log(`[Historial] ${profileId}: ${n} día(s) completados desde Health Connect`);
            } catch (e) { console.warn("[Historial] No se pudo completar desde Health Connect:", e); }
            return;
          }

          // ─── Sync nutrición: el móvil pide el log del día al montar NutritionScreen ──
          if (data.type === "sync_nutrition_today") {
            try { ws.send(JSON.stringify({ type: "nutrition_today", ...(await buildNutritionToday(memory)) })); } catch {}
            return;
          }

          // ─── Lo anotado por chat para días anteriores («ayer cené…»): el teléfono lo pide al conectarse, por si no estaba
          // conectado cuando se anotó. Solo esas entradas (pastDay): lo de cada día ya le llegó cuando ese día era hoy.
          if (data.type === "sync_nutrition_days") {
            try {
              const asked = Array.isArray(data.days) ? data.days.filter(isValidDay).slice(0, 7) : [];
              const days: Array<{ day: string; entries: unknown[] }> = [];
              for (const day of asked) {
                const log = await memory.get(`nutrition_log_${day}`).catch(() => []);
                const entries = (Array.isArray(log) ? log : []).filter((e: any) => e?.pastDay);
                if (entries.length) days.push({ day, entries });
              }
              ws.send(JSON.stringify({ type: "nutrition_days", days }));
            } catch {}
            return;
          }

          // ─── Forge → cuerpo y entreno de hoy: con esto se calculan las metas de todos los módulos (DailyTargets) ──
          if (data.type === "sync_body_profile") {
            const body = sanitizeBody(data.body);
            if (body) {
              try { await memory.set("body_profile", body); } catch {}
              try { ws.send(JSON.stringify({ type: "nutrition_today", ...(await buildNutritionToday(memory)) })); } catch {}
            }
            return;
          }

          // ─── Botón "+250 ml" de la notificación de agua: se anota sin abrir el chat, con la misma lógica que el chat
          // (registro del día, rollup y aviso hydration_logged → la app vuelve a sincronizar y recalcula sus avisos).
          if (data.type === "log_water_quick") {
            const ml = Number(data.ml);
            const liters = Number.isFinite(ml) && ml >= 50 && ml <= 1000 ? Math.round(ml) / 1000 : 0.25;
            try {
              const r = await toolRegistry.get("nutrition_tracker")?.execute({ action: "log_water", waterLiters: liters, beverageType: "agua" } as any, { memory, wsClient: ws });
              ws.send(JSON.stringify({ type: "water_quick_logged", liters, ok: !!r && !(r as any).error }));
            } catch {
              try { ws.send(JSON.stringify({ type: "water_quick_logged", liters, ok: false })); } catch {}
            }
            return;
          }

          // ─── El móvil fija metas nutricionales directo (Perfil), sin pasar por el chat ──
          // Misma validación que `set_nutritional_goals` (NutritionTool): rangos compartidos en NutritionLog.ts.
          if (data.type === "set_nutrition_goals") {
            try {
              const current = (await memory.get("nutrition_goals").catch(() => null)) || {};
              const { next, saved, rejected } = applyGoalUpdate(current, data.goals || {});
              if (saved.length) await memory.set("nutrition_goals", next);
              ws.send(JSON.stringify({ type: "nutrition_goals_updated", goals: next, rejected }));
              // Las metas efectivas cambian (lo fijado manda sobre lo calculado): se reenvía el día completo
              if (saved.length) { try { ws.send(JSON.stringify({ type: "nutrition_today", ...(await buildNutritionToday(memory)) })); } catch {} }
            } catch {
              ws.send(JSON.stringify({ type: "nutrition_goals_updated", goals: null, error: "No se pudo guardar." }));
            }
            return;
          }

          // ─── El móvil borró un alimento de su registro: se borra también acá ──
          // Antes el borrado era solo local: al reabrir la pantalla el servidor reenviaba todo y el alimento "resucitaba",
          // y el asesor seguía contándolo. Se identifica por instante de la comida + nombre + gramos (un solo ítem).
          if (data.type === "delete_nutrition_entry") {
            try {
              const name = typeof data.name === "string" ? data.name.slice(0, 200) : "";
              const grams = Number(data.grams);
              const timestamp = typeof data.timestamp === "string" ? data.timestamp.slice(0, 40) : "";
              const todayKey = await todayKeyOf(memory);
              const day = data.date === undefined ? todayKey : data.date;
              if (!name || !timestamp || !Number.isFinite(grams) || !isValidDay(day)) {
                ws.send(JSON.stringify({ type: "nutrition_delete_result", ok: false, removed: false }));
                return;
              }
              const key = `nutrition_log_${day}`;
              const { log, removed } = removeItem(await memory.get(key).catch(() => []), { timestamp, name, grams });
              if (removed) {
                await memory.set(key, log);
                if (day === todayKey) {
                  const hydrationLog = await memory.get(`hydration_log_${day}`).catch(() => []);
                  await upsertChatRollup(memory, log, hydrationLog).catch(() => {});
                }
              }
              ws.send(JSON.stringify({ type: "nutrition_delete_result", ok: true, removed: !!removed, timestamp, name, grams }));
              // Si fue el día de hoy, se reenvía el estado fresco para que Inicio y Nutrición se alineen de inmediato
              if (day === todayKey) ws.send(JSON.stringify({ type: "nutrition_today", ...(await buildNutritionToday(memory)) }));
            } catch {
              try { ws.send(JSON.stringify({ type: "nutrition_delete_result", ok: false, removed: false })); } catch {}
            }
            return;
          }

          // ─── Sync desde Forge/Toji: rutina markdown y/o catálogo de ejercicios
          // personalizados, para que TrainingPlanTool pueda leerlos aunque el
          // usuario le hable a Eris con Forge cerrado. Envíos parciales OK —
          // el móvil manda solo lo que cambió (rutina al guardarla/borrarla,
          // catálogo en cada cambio de customExercises).
          if (data.type === "sync_toji_context") {
            try {
              if (data.routineMd !== undefined) {
                await memory.set("toji_routine_md", data.routineMd ? { md: data.routineMd, name: data.routineName || "rutina.md" } : null);
              }
              if (data.customExercises !== undefined) {
                await memory.set("toji_exercise_catalog", { custom: data.customExercises });
              }
              ws.send(JSON.stringify({ type: "toji_context_received" }));
            } catch {}
            return;
          }

          // ─── Diagnóstico basado en patrón personal (tip proactivo + card de Pulso) ──
          // No pasa por el loop agéntico de QueryEngine (no hay forma de forzar la
          // llamada a la tool ahí) — el diagnóstico ya es aritmética determinista en
          // TS (BaselineEngine), así que le pedimos al LLM solo la redacción vía una
          // llamada directa a provider.generate(), igual que ExecutiveReportTool.
          // No se guarda en sessions/history — no debe ensuciar la conversación real.
          if (data.type === "request_proactive_tip" || data.type === "request_daily_insight") {
            const isCard = data.type === "request_daily_insight";
            try {
              const [log, profile, medicalContext, dismissals, overrides] = await Promise.all([
                memory.getDailyRollupLog(),
                memory.getProfile(),
                buildMedicalContext(memory),
                getDismissals(memory),
                getOverrides(memory),
              ]);
              const diag = diagnoseBaseline(log, new Date(), { medical: profile?.medical, dismissals, overrides, day: dayCtxFrom(await memory.get("health_snapshot_latest").catch(() => null)) });
              const primaryScope = diag.primary ? METRIC_TO_NOTE_SCOPE[diag.primary.key] : undefined;
              const notesText = formatNotesForLLM(await getUserNotes(memory), primaryScope);
              const personalNotesBlock = notesText
                ? `\n\nContexto que el usuario ya explicó sobre este tema (tenlo en cuenta, no lo contradigas):\n${notesText}`
                : '';
              const dataBlock = formatDiagnosisForLLM(diag) + personalNotesBlock + medicalContext;
              const instruction = isCard
                ? "Escribe el texto de una tarjeta 'Análisis del Día': 2-3 frases dirigidas al usuario, terminando " +
                  "opcionalmente con una pregunta abierta. Si nada está fuera de rango, dilo brevemente en tono " +
                  "positivo — SIEMPRE debe haber texto visible, nunca respondas vacío."
                : "Escribe un tip para notificación push: máximo 1 frase, menos de 160 caracteres. Si no hay nada " +
                  "relevante que decir (todo en rango o confianza insuficiente en todo), responde EXACTAMENTE la " +
                  "palabra NADA y nada más.";

              const ask = (extra = "") => provider.generate(
                [
                  { role: "system", content: BASELINE_PHRASING_SYSTEM_PROMPT },
                  { role: "user", content: `${dataBlock}\n\n${instruction}${extra}` },
                ],
                undefined,
                // Sin razonamiento: con 220 tokens, "pensar" se los comía y la tarjeta o el aviso salían vacíos
                { temperature: 0.6, maxTokens: 220, modelOverride: THINKING_MODES.flash.model, enableThinking: false }
              );
              let text = (await ask()).content?.trim();
              // Sin datos de glucosa (módulo apagado) el modelo igual escribía "mientras controlas tu glucosa" o "tu nivel de
              // glucosa se mantiene estable" (2026-10-10): una vez más, pidiéndole que no la nombre
              const glucoseInData = /glucos|gluc[eé]mi/i.test(formatDiagnosisForLLM(diag));
              if (text && !glucoseInData && /glucos|gluc[eé]mi|az[uú]car en (la )?sangre/i.test(text)) {
                const again = (await ask("\n\nNo menciones la glucosa ni el azúcar en sangre: no hay datos de eso.")).content?.trim();
                if (again && !/glucos|gluc[eé]mi|az[uú]car en (la )?sangre/i.test(again)) text = again;
              }
              const readiness = diag.readiness;

              if (isCard) {
                ws.send(JSON.stringify({
                  type: "daily_insight",
                  text: text || "Todo en orden por ahora.",
                  unlocked: readiness.unlocked,
                  daysTracked: readiness.daysTracked,
                  daysRemaining: readiness.daysRemaining,
                }));
              } else if (text && text.toUpperCase() !== "NADA" && text.length < 400) {
                ws.send(JSON.stringify({ type: "proactive_tip", text }));
              } else {
                ws.send(JSON.stringify({ type: "proactive_tip_skipped" }));
              }
            } catch {
              if (isCard) ws.send(JSON.stringify({ type: "daily_insight", text: "No pude analizar tu día en este momento." }));
              else ws.send(JSON.stringify({ type: "proactive_tip_skipped" }));
            }
            return;
          }

          // ─── Juicio semántico de "¿es el mismo alimento?" — el móvil ya
          // filtró candidatos por texto (comparten una palabra distintiva);
          // acá se decide de verdad, porque nombres parecidos pueden ser
          // preparaciones con macros muy distintas (empanada de pino ≠
          // empanada de carne). Mismo patrón que request_daily_insight:
          // llamada directa a provider.generate(), fuera de QueryEngine,
          // no se guarda en el historial de la conversación. ──
          if (data.type === "check_food_similarity") {
            try {
              const newFood = data.newFood;
              const candidates: Array<{ name: string; brand?: string }> = Array.isArray(data.candidates) ? data.candidates : [];
              if (!newFood?.name || candidates.length === 0) {
                ws.send(JSON.stringify({ type: "food_similarity_result", matchIndex: null }));
                return;
              }

              const list = candidates
                .map((c, i) => `${i + 1}. ${c.name}${c.brand ? ` (marca: ${c.brand})` : ""}`)
                .join("\n");

              // Prompt con ejemplos en ambas direcciones (mismo alimento con
              // nombre distinto vs. nombre parecido pero alimento distinto) —
              // sin los ejemplos "positivos" el modelo flash (4B, sin
              // thinking) se volvía excesivamente conservador y respondía
              // NINGUNO incluso para casos obviamente iguales. Verificado
              // contra Ollama real con el caso reportado por el usuario.
              const response = await provider.generate(
                [
                  {
                    role: "system", content:
                      "Eres un clasificador de alimentos. Decides si un alimento nuevo es el MISMO producto/plato " +
                      "que uno ya registrado, aunque el nombre esté escrito distinto (otro idioma, con/sin marca, " +
                      "abreviado). Ejemplos de MISMO alimento (nombres distintos, mismo producto real):\n" +
                      '- "Empanada, beef" = "empanada de carne" (misma preparación, un nombre está en inglés)\n' +
                      '- "Coca Cola 350ml" = "Coca-Cola lata 350 ml" (mismo producto, formato de texto distinto)\n' +
                      "Ejemplos de alimentos DISTINTOS (nombre parecido, producto real distinto):\n" +
                      '- "empanada de pino" ≠ "empanada de carne" (relleno distinto)\n' +
                      '- "leche entera" ≠ "leche descremada" (distinto contenido graso)\n' +
                      "Responde SOLO con el número del candidato que es el mismo alimento, o NINGUNO si ninguno lo es. Nunca expliques.",
                  },
                  {
                    role: "user",
                    content: `Alimento nuevo: "${newFood.name}"${newFood.brand ? ` (marca: ${newFood.brand})` : ""}\n\nCandidatos ya registrados:\n${list}\n\n¿Cuál es el mismo alimento?`,
                  },
                ],
                undefined,
                { temperature: 0, maxTokens: 20, modelOverride: THINKING_MODES.flash.model, enableThinking: false }
              );

              const raw = (response.content || "").trim();
              const num = parseInt(raw.match(/\d+/)?.[0] || "", 10);
              const matchIndex = Number.isInteger(num) && num >= 1 && num <= candidates.length ? num - 1 : null;
              ws.send(JSON.stringify({ type: "food_similarity_result", matchIndex }));
            } catch {
              ws.send(JSON.stringify({ type: "food_similarity_result", matchIndex: null }));
            }
            return;
          }

          // ─── "Sobre mí": transparencia total de lo que Eris sabe/calculó ──
          // No pasa por el LLM — es un volcado directo de los datos ya
          // calculados (BaselineEngine, MedicalKnowledgeBase, notas
          // personales) para que el usuario vea el "por qué" de las
          // decisiones, en vez de vivir oculto en el prompt.
          if (data.type === "request_about_me") {
            try {
              const [log, profile, notes, journal, dismissals, overrides, latestSnapshot] = await Promise.all([
                memory.getDailyRollupLog(),
                memory.getProfile(),
                getUserNotes(memory),
                getJournalEntries(memory),
                getDismissals(memory),
                getOverrides(memory),
                memory.get("health_snapshot_latest").catch(() => null),
              ]);
              // Mismo peso que usa dailyLimits() para la meta de proteína — sin esto,
              // la referencia de "Sobre mí" ignoraba el peso real del usuario aunque
              // Eris ya lo supiera.
              const weightKg = typeof (latestSnapshot as any)?.weight === "number" ? (latestSnapshot as any).weight : undefined;
              const diag = diagnoseBaseline(log, new Date(), { medical: profile?.medical, dismissals, overrides, weightKg, day: dayCtxFrom(latestSnapshot) });
              const kbGuidance = getGuidance(profile?.medical);
              const now = Date.now();
              const activeDismissals = Object.entries(dismissals)
                .filter(([, until]) => until && new Date(until as string).getTime() > now)
                .map(([metric, until]) => ({ metric, until }));
              const activeOverrides = Object.entries(overrides).map(([metric, ov]) => ({ metric, ...(ov as object) }));
              ws.send(JSON.stringify({
                type: "about_me",
                readiness: diag.readiness,
                metrics: diag.all,
                trends: diag.trends,
                kbGuidance,
                notes,
                journal: journal.slice(0, 14),
                dismissals: activeDismissals,
                overrides: activeOverrides,
                // Perfil fresco (ya lo leímos arriba para kbGuidance) — el móvil
                // solo tenía el snapshot cacheado de 'connected', que queda
                // desactualizado si el perfil cambió por chat sin reconectar.
                userProfile: profile,
              }));
            } catch {
              ws.send(JSON.stringify({ type: "about_me", readiness: null, metrics: [], trends: [], kbGuidance: [], notes: [], journal: [], dismissals: [], overrides: [] }));
            }
            return;
          }

          // ─── La bienvenida ya se mostró (la app la marca al abrirla, no al terminarla) ──
          if (data.type === "welcome_done") {
            await memory.set("welcome_done", { at: new Date().toISOString(), by: "app" }).catch(() => {});
            return;
          }

          // ─── Reactivar un tema silenciado / quitar un objetivo verificado (desde "Sobre mí") ──
          if (data.type === "clear_metric_feedback" && (data.metric)) {
            try {
              if (data.kind === "override") await clearOverride(memory, data.metric);
              else await clearDismissal(memory, data.metric);
              ws.send(JSON.stringify({ type: "metric_feedback_cleared", metric: data.metric, kind: data.kind || "dismissal" }));
            } catch {}
            return;
          }

          // ─── Borrado directo de una nota de contexto personal (desde "Sobre mí") ──
          if (data.type === "delete_user_note") {
            try {
              if (data.noteId) await deleteUserNote(memory, data.noteId);
              ws.send(JSON.stringify({ type: "user_note_deleted", noteId: data.noteId }));
            } catch {}
            return;
          }

          // ─── Entrada directa al bloc de notas (quick check-in desde Pulso) ──
          if (data.type === "add_journal_entry") {
            try {
              const entry = await addJournalEntry(memory, { moodScore: data.moodScore, note: data.note });
              ws.send(JSON.stringify({ type: "journal_entry_added", entry }));
            } catch (e: any) {
              ws.send(JSON.stringify({ type: "journal_entry_error", error: e?.message || String(e) }));
            }
            return;
          }

          // ─── Cancelar la consulta en curso en esta conexión (botón "detener") ──
          if (data.type === "stop") {
            const activeAbort = (ws.data as any).abortController as AbortController | undefined;
            if (activeAbort) activeAbort.abort();
            // Nada en curso en esta conexión (p. ej. el cliente se reconectó a mitad de una respuesta): igual se confirma,
            // o la app queda en "procesando" para siempre esperando un "stopped" que nunca llegaba.
            else ws.send(JSON.stringify({ type: "stopped" }));
            return;
          }

          // Cuerpo compartido entre texto tipeado ("message") y texto
          // transcripto por voz ("voice_message" → Whisper → acá) — una vez
          // que hay texto del usuario, el camino es idéntico sin importar de
          // dónde vino (tools, modos, persistencia, todo igual).
          const handleUserText = async (userText: string, requestedMode: ThinkingMode, porVoz = false) => {
            // Tope de largo: un mensaje gigante no debe inundar el contexto del modelo ni hacer gastar el equipo
            if (typeof userText !== "string") return;
            // Medición de la beta: desde acá, lo que haga el modelo es trabajo del chat; si llama al modelo, «pasó por el modelo»
            ctxUso.tipo = "chat";
            const llamadasAntes = ctxUso.llamadas;
            if (userText.length > MAX_USER_MESSAGE_CHARS) userText = userText.slice(0, MAX_USER_MESSAGE_CHARS);
            const currentSessionId = (ws.data as any).sessionId;
            const history = sessions.get(currentSessionId) || [];

            // Apps ≤1.78 pegaban «[Contexto biométrico detallado: …]» al pedir el análisis: el servidor ya tiene esos datos,
            // y en el texto hacían lento el turno y quedaban guardados como si los hubiera escrito la persona (R1)
            userText = sinContextoPegado(userText) || userText;
            console.log(`\n[MSG] ${profileId}: "${userText.substring(0, 30)}..." | Modo: ${requestedMode}`);
            const startTime = Date.now();

            const userMsg = createMessage("user", userText);
            history.push(userMsg);

            ws.send(JSON.stringify({ type: "thinking", status: "Pensando...", mode: requestedMode }));

            const ctx = memory.getConversationContext(currentSessionId, CONTEXT_RECENT);
            const recentHistory = history.slice(-CONTEXT_RECENT);

            // Usar el engine personalizado de este perfil
            const profileKey = `${profileId}:${pin || ''}`;
            // Sin motor de respaldo: el genérico tiene TODAS las herramientas. Si el motor de este perfil no está
            // (p. ej. le cambiaron el rol y se descartó), se le pide reconectar para armarlo con su rol actual.
            // Perfil Ikaros con la app en modo Eris (no AXS Executive): el motor de Eris (ver la separación al conectar)
            const erisMode = (ws.data as any).role === 'ikaros' && data.axs === false;
            const engine = (erisMode && queryEngines.get(`${profileKey}#eris`)) || queryEngines.get(profileKey);
            if (!engine) {
              ws.send(JSON.stringify({ type: "error", message: "Tu sesión cambió. Reconectando…" }));
              try { ws.close(4001, "session_changed"); } catch {}
              return;
            }

            // Antes acá se forzaba salud+médico+personal+finanzas en CADA mensaje —
            // por eso Eris comentaba tu glucosa aunque solo dijeras "hola". Ahora ese
            // contexto vive detrás de get_live_context (LiveContextTool): Eris lo pide
            // cuando la conversación realmente lo amerita, no en cada respuesta.
            //
            // AbortController por conexión — permite que el botón "detener" del
            // cliente (mensaje {type:'stop'}) corte esta generación a mitad de
            // camino. Se guarda en ws.data para que la rama "stop" de arriba lo
            // encuentre; se limpia en el finally para no dejarlo colgado.
            const ac = new AbortController();
            (ws.data as any).abortController = ac;
            // Rastro de este turno (Message.trace): qué herramientas se llamaron y cuáles fallaron
            const traceTools: string[] = [];
            const traceErrors: string[] = [];
            let queryResult;
            // J3: en el chat de Hestia (Modo AXS), la llamada de voz reciente (su resumen, armado por código al colgar)
            const llamadaPrevia = (ws.data as any).role === "ikaros" && data.axs === true
              ? llamadaReciente(await memory.get(CLAVE_LLAMADAS).catch(() => null), new Date())?.resumen ?? null : null;
            const resumenTurno = llamadaPrevia
              ? [ctx.summary, `La última llamada de voz con él (por si la menciona):\n${llamadaPrevia}`].filter(Boolean).join("\n\n") : ctx.summary;
            try {
              queryResult = await engine.query(
                userText,
                recentHistory,
                {
                  onToken: (token) => {
                    ws.send(JSON.stringify({ type: "token", content: token }));
                  },
                  onThinking: (text) => {
                    ws.send(JSON.stringify({ type: "thinking_token", content: text }));
                  },
                  // Al teléfono solo QUÉ herramienta corre (para la interfaz), nunca su entrada ni su salida: llevaban datos internos
                  // y texto para el modelo (revisión 2026-11-04, P2). El detalle queda en el rastro del mensaje (trace).
                  onToolCall: (tc) => {
                    traceTools.push(tc.name);
                    ws.send(JSON.stringify({ type: "tool_call", name: tc.name }));
                  },
                  onToolResult: (result) => {
                    if (result.error) traceErrors.push(`${result.name}: ${String(result.error).slice(0, 120)}`);
                    ws.send(JSON.stringify({ type: "tool_result", name: result.name, ok: !result.error, duration: result.duration }));
                  },
                  onModeResolved: (mode, model) => {
                    ws.send(JSON.stringify({
                      type: "mode_resolved",
                      mode,
                      model,
                    }));
                  },
                  // Acciones sensibles: tarjeta "Aprobar / Rechazar" en la app (se cancela si se pulsa "detener")
                  onConfirm: (req) => askApproval(ws, profileId, req, ac.signal),
                },
                resumenTurno,
                requestedMode,
                {
                  profileId,
                  memory,
                  role: (ws.data as any).role,
                  wsClient: ws,
                  // Para lo que el código no entiende y el modelo SOLO convierte a datos («Otro» del plan de Eris)
                  llm: { provider, model: THINKING_MODES.flash.model },
                  glucoService: activeGlucoServices.get(profileId) || null,
                  foodService: unifiedFood,
                  // La app manda si está en Modo AXS Executive: fuera de él, Eris no usa las herramientas de AXS
                  // (bóveda, briefing, reportes). Sin el dato (web, clientes viejos) todo sigue como antes.
                  axsMode: typeof data.axs === "boolean" ? data.axs : undefined,
                },
                undefined,
                ac.signal,
                // Instrucciones del proyecto al que pertenece este chat (si tiene)
                memory.getProjectOfConversation(currentSessionId)?.instructions
              );
            } catch (err) {
              // Chat en pausa (Ollama apagado para liberar memoria): un aviso claro en vez de un error técnico, y el
              // mensaje sin respuesta no queda en la conversación
              if (!(await provider.isAvailable().catch(() => false))) {
                history.pop();
                ws.send(JSON.stringify({ type: "error", message: "El chat de Eris está en pausa por ahora. Lo que anotes en la app se sigue guardando." }));
                return;
              }
              throw err;
            } finally {
              (ws.data as any).abortController = null;
            }

            const response = queryResult.message;
            response.trace = {
              tools: traceTools,
              ...(traceErrors.length ? { errors: traceErrors } : {}),
              ...(queryResult.quick ? { quick: true } : {}),
              ms: Date.now() - startTime,
            };
            history.push(response);
            sessions.set(currentSessionId, history);
            // Persistir SIEMPRE, incluso si el socket ya murió (app en segundo
            // plano/cerrada) — así la respuesta está lista cuando el cliente
            // reconecte y vuelva a pedir el historial de esta sesión.
            // De quién es el chat: lo dice el modo con que llegó el mensaje (Modo AXS → Hestia); sin el dato, el de la conexión
            if (typeof data.axs === "boolean") (ws.data as any).persona = (ws.data as any).role === "ikaros" && data.axs ? "hestia" : "eris";
            const chatPersona = personaOfWs(ws);
            await memory.saveConversation(currentSessionId, history, chatPersona);
            await memory.set(`last_chat_${chatPersona}`, currentSessionId).catch(() => {});

            // Guardar para training (en background)
            memory.saveTrainingData(currentSessionId, history).catch(() => {});

            // Medición de la beta: un mensaje más, si pasó por el modelo y cuánto tardó; y cuántas comidas tiene hoy (lo
            // anotado por chat también cuenta, aunque no abra Nutrición). Solo números.
            const llamoModelo = ctxUso.llamadas > llamadasAntes;
            usoMedido(() => betaMetrics.chat(profileId, { voz: porVoz, porModelo: llamoModelo, ms: Date.now() - startTime }));
            usoMedido(async () => {
              const dia = await todayKeyOf(memory);
              const log = await memory.get(`nutrition_log_${dia}`).catch(() => null);
              // Cada registro del chat trae sus alimentos (items): se cuentan alimentos, igual que la lista del teléfono
              const n = Array.isArray(log) ? log.reduce((s: number, e: any) => s + (Array.isArray(e?.items) ? e.items.length : 0), 0) : 0;
              if (n) await betaMetrics.registro(profileId, "comidas", n, isoDayKey(new Date(Date.parse(dia)))); // «Wed Nov 11 2026» → 2026-11-11
            });

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[OK] ${profileId} ${duration}s${queryResult.quick ? " (al instante)" : ""} Resp: "${response.content.substring(0, 50).replace(/\n/g, " ")}..."`);

            // Los ws.send de acá en adelante son best-effort: si el socket ya
            // cerró (app minimizada/matada mientras generaba), la respuesta ya
            // quedó guardada arriba — no queremos que un send fallido tire el
            // resto del handler.
            try {
              ws.send(JSON.stringify(
                queryResult.stopped
                  ? { type: "stopped", content: response.content, id: response.id }
                  : {
                      type: "stream_end",
                      content: response.content,
                      id: response.id,
                      modeUsed: queryResult.modeUsed,
                      modelUsed: queryResult.modelUsed,
                    }
              ));
            } catch {}

            try {
              ws.send(JSON.stringify({
                type: "conversations_updated",
                conversations: convList(memory, ws),
              }));
            } catch {}

            // ─── Compresión en background ───
            if (history.length > COMPRESS_THRESHOLD) {
              const toSummarize = memory.getMessagesToSummarize(currentSessionId, 6);
              if (toSummarize && toSummarize.length > 0) {
                console.log(`  🗜️ [${profileId}] Comprimiendo ${toSummarize.length} mensajes...`);
                const nombre = await memory.getProfile().then((p: any) => p?.displayName ?? p?.name ?? null).catch(() => null);
                compressor
                  .compress(toSummarize, ctx.summary, nombre)
                  .then((summary) => {
                    // Un resumen vacío (falló el modelo) no reemplaza al anterior ni da por resumidos esos mensajes
                    if (!summary.trim()) return;
                    const upTo = history.length - 6;
                    memory.updateSummary(currentSessionId, summary, upTo);
                  })
                  .catch((err) => {
                    console.error("  ❌ Error comprimiendo:", err);
                  });
              }
            }
          };

          if (data.type === "message") {
            await handleUserText(data.content, data.mode || DEFAULT_CONFIG.defaultMode);
            return;
          }

          // ─── Hestia por voz (J1, 2026-11-16): una llamada en tiempo real ───
          // El teléfono reconoce la voz (en el aparato) y manda el texto de cada turno; acá el motor de voz responde por tokens, se
          // corta en trozos y Piper los dice uno tras otro (VozSesion). Solo Hestia: rol ikaros en Modo AXS Executive.
          if (data.type === "voz_inicio" || data.type === "voz_turno" || data.type === "voz_cortar" || data.type === "voz_colgar") {
            const enviar = (m: Record<string, unknown>) => { try { ws.send(JSON.stringify(m)); } catch {} };
            type Pendiente = { id: string; clase: ClaseAprobacion; tool: string; dudas: number };
            const voz = (ws.data as any).voz as { sesion: VozSesion; sessionId: string; history: any[]; titulado: boolean; aprobacion: Pendiente | null; herramientasTurno: string[]; cerrar: () => Promise<void> } | undefined;
            /** Responde la aprobación pendiente de la llamada (como si tocara la tarjeta: la tarjeta se cierra sola) */
            const resolverAprobacion = (d: "approved" | "denied", porVoz?: string) => {
              const a = voz?.aprobacion;
              if (!a) return;
              voz!.aprobacion = null;
              const p = pendingApprovals.get(a.id);
              if (!p || p.ws !== ws || p.profileId !== profileId) return;
              if (porVoz != null) {
                console.log(`[Voz] ${a.tool}: ${d === "approved" ? "aprobada" : "rechazada"} por voz («${porVoz.slice(0, 40)}»)`);
                void audit.record({ event: "security", profileId, role: (ws.data as any).role, tool: a.tool, detail: `${d === "approved" ? "aprobado" : "rechazado"} por voz en la llamada: «${porVoz.slice(0, 40)}»`, ok: true });
              }
              p.finish(d, true);
            };
            if (data.type === "voz_cortar") {
              // Tocó «Cortar» con una pregunta pendiente: es un no
              resolverAprobacion("denied");
              voz?.sesion.cortar(); enviar({ type: "voz_cortado" }); return;
            }
            if (data.type === "voz_colgar") {
              resolverAprobacion("denied");
              voz?.sesion.cortar();
              (ws.data as any).voz = undefined;
              await voz?.cerrar().catch(() => {}); // J3: el resumen queda en la memoria de Hestia
              enviar({ type: "voz_colgada" });
              enviar({ type: "conversations_updated", conversations: convList(memory, ws) });
              return;
            }
            if (data.type === "voz_inicio") {
              if ((ws.data as any).role !== "ikaros" || data.axs !== true) { enviar({ type: "voz_error", mensaje: "La llamada de voz es solo con Hestia, en el Modo AXS Executive." }); return; }
              const engine = queryEngines.get(`${profileId}:${pin || ''}#voz`);
              if (!engine) { enviar({ type: "voz_error", mensaje: "Tu sesión cambió. Reconecta y vuelve a llamar." }); return; }
              voz?.sesion.cortar();
              void voz?.cerrar().catch(() => {});
              const sessionId = `voz_${Date.now()}`;
              const llamada = { sessionId, history: [] as any[], titulado: false, sesion: null as unknown as VozSesion, muletillas: [] as Array<{ wav: Buffer; texto: string }>, aprobacion: null as Pendiente | null, plata: false, muletillaLarga: null as { wav: Buffer; texto: string } | null, herramientasTurno: [] as string[],
                // J3: lo que pasó (para el resumen al colgar) y la llamada anterior (para «lo que hablamos ayer»)
                inicio: new Date(), eventos: [] as EventoLlamada[], anterior: null as string | null, cerrada: false,
                cerrar: async () => {} };
              llamada.anterior = llamadaReciente(await memory.get(CLAVE_LLAMADAS).catch(() => null), new Date())?.resumen ?? null;
              llamada.cerrar = async () => {
                if (llamada.cerrada) return;
                llamada.cerrada = true;
                const fin = new Date();
                const resumen = resumenLlamada({ inicio: llamada.inicio, fin, history: llamada.history, eventos: llamada.eventos });
                if (!resumen) return;
                const previas = await memory.get(CLAVE_LLAMADAS).catch(() => null);
                await memory.set(CLAVE_LLAMADAS, guardarLlamada(previas, { at: llamada.inicio.toISOString(), fin: fin.toISOString(), resumen }));
                console.log(`[Voz] ${profileId}: llamada guardada (${llamada.history.filter((m: any) => m.role === "user").length} turnos)`);
              };
              llamada.sesion = new VozSesion({
                enviar,
                log: (s) => console.log(s),
                // (J3: lo corto y repetido, «Claro,», «Mira,», del caché: suena apenas llega)
                sintetizar: (texto) => CACHE_VOZ.decir(texto, (t) => piperProvider.synthesize(t, "daniela")),
                muletilla: async () => (llamada.muletillas.length ? llamada.muletillas[Math.floor(Math.random() * llamada.muletillas.length)] : null),
                muletillaLarga: async () => llamada.muletillaLarga,
                generar: async (texto, onToken, signal) => {
                  const ahora = new Date();
                  // La hora y la fecha, por código y al instante (J2)
                  const directa = respuestaDirecta(texto, ahora);
                  if (directa) return { content: directa, quick: true };
                  const dia = ahora.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });
                  const hora = ahora.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
                  // Plata (J2): la respuesta entera y revisada antes de decirla. Por tokens, la guardia de cifras de dinero quitaba
                  // lo inventado cuando ya se había dicho («te sobran $797.000», banco «voz»). Mientras, la muletilla.
                  // (y lo que sigue a una respuesta de plata: «¿y eso alcanza?»)
                  const plata = PLATA_VOZ.test(texto) || llamada.plata;
                  llamada.plata = false;
                  if (plata) llamada.sesion.herramienta();
                  const r = await engine.query(
                    texto,
                    llamada.history.slice(-12),
                    {
                      onToken: plata ? undefined : onToken,
                      // Mientras corre una herramienta, una muletilla («Dame un segundo.») para que no quede en silencio
                      onToolCall: (tc) => {
                        enviar({ type: "voz_herramienta", name: tc.name }); llamada.sesion.herramienta();
                        llamada.plata = tc.name === "finance_tracker";
                        llamada.herramientasTurno.push(tc.name);
                        llamada.eventos.push({ tipo: "herramienta", nombre: tc.name });
                      },
                      // Acciones en el PC (J2): la misma tarjeta de siempre en el teléfono, y Hestia lo pregunta en voz alta.
                      // Lo seguro también se aprueba diciendo «sí» (lo interpreta el código, no el modelo); lo riesgoso, tocando;
                      // borrar o lo que no se deshace, nunca por voz.
                      onConfirm: async (req) => {
                        if (!(ws.data as any)?.canApprove) return askApproval(ws, profileId, req, signal); // app vieja: se deniega
                        const clase = claseAprobacion(req);
                        const decision = askApproval(ws, profileId, req, signal, {
                          extra: { voz: clase },
                          onId: (id) => { llamada.aprobacion = { id, clase, tool: req.tool, dudas: 0 }; },
                        });
                        enviar({ type: "voz_aprobacion", estado: "pendiente", clase, turno: llamada.sesion.turnoActual });
                        llamada.sesion.anunciar(preguntaHablada(req, clase));
                        const d = await decision;
                        llamada.aprobacion = null;
                        llamada.eventos.push({ tipo: "aprobacion", nombre: req.tool, decision: d, que: `${req.title} (${String(req.detail).split("\n")[0].slice(0, 60)})` });
                        enviar({ type: "voz_aprobacion", estado: "fin", decision: d, turno: llamada.sesion.turnoActual });
                        return d;
                      },
                    },
                    // La hora de AHORA en cada turno (el prompt del motor se arma una vez y su hora queda vieja). Como dato interno:
                    // escrita «Ahora: …», el modelo la leía en voz alta al comienzo de cada respuesta (prueba J1)
                    `(Dato interno, no lo repitas: hoy es ${dia} y son las ${hora}, hora de Chile.)` +
                      // (J3: solo si habla de algo anterior: son ~300 tokens que se leen en cada pasada)
                      (llamada.anterior && mencionaAntes(texto) ? `\n(La llamada anterior, por si la menciona; no la repitas si no:\n${llamada.anterior})` : ""),
                    "flash",
                    {
                      profileId, memory, role: (ws.data as any).role, wsClient: ws,
                      llm: { provider, model: THINKING_MODES.flash.model },
                      glucoService: activeGlucoServices.get(profileId) || null,
                      foodService: unifiedFood, axsMode: true, voz: true,
                    },
                    texto,
                    signal,
                  );
                  return { content: r.message.content, quick: r.quick, stopped: r.stopped };
                },
              });
              (ws.data as any).voz = llamada;
              // Precalentar: el modelo (J0: frío, el primer turno tardaba 8 s) y Piper
              void provider.warmup(THINKING_MODES.flash.model, THINKING_MODES.flash.contextLength).catch(() => false);
              // (y Piper, con las muletillas que se dicen mientras corre una herramienta: quedan listas para toda la llamada)
              void (async () => {
                for (const texto of ["Dame un segundo.", "Déjame ver.", "Ya, lo reviso."]) {
                  const wav = await piperProvider.synthesize(texto, "daniela").catch(() => null);
                  if (wav?.length) llamada.muletillas.push({ wav, texto });
                }
                const larga = "Sigo en eso, ya casi.";
                const wl = await piperProvider.synthesize(larga, "daniela").catch(() => null);
                if (wl?.length) llamada.muletillaLarga = { wav: wl, texto: larga };
                // J3: los arranques de siempre, una vez por servidor y solo mientras Piper esté libre (si habla, se dejan)
                for (const a of ARRANQUES) {
                  const h = paraHablar(a);
                  if (llamada.sesion.ocupada || llamada.cerrada) break;
                  if (!CACHE_VOZ.tiene(h)) await CACHE_VOZ.decir(h, (t) => piperProvider.synthesize(t, "daniela")).catch(() => null);
                }
              })();
              enviar({ type: "voz_lista", sessionId });
              console.log(`[Voz] ${profileId}: llamada iniciada (${sessionId})`);
              // J3: la primera llamada del día parte con un saludo armado por código: la agenda del día (la misma de «¿qué tengo
              // hoy?») y lo inmediato de AXS. Corto en voz, el día completo en la pantalla. saludo:false = sin saludo; true = igual
              // (las pruebas). Si alcanzó a hablar antes, no va.
              void (async () => {
                if (data.saludo === false) return;
                const hoy = new Date().toDateString();
                if (data.saludo !== true && (await memory.get("voz_saludo_dia").catch(() => null)) === hoy) return;
                const toolCtx = {
                  profileId, memory, role: (ws.data as any).role, wsClient: ws, glucoService: activeGlucoServices.get(profileId) || null,
                  foodService: unifiedFood, axsMode: true, voz: true,
                };
                const ag = await toolRegistry.get("day_agenda")?.run({}, toolCtx).catch(() => null);
                const agenda = ag && !ag.error ? String((ag.metadata as any)?.quickReply ?? ag.output ?? "") : null;
                const inmediatas = await VaultIndex.build(new VaultService().getVaultPath()).then(immediateRoadmap).catch(() => [] as string[]);
                const nombre = (await memory.getProfile().catch(() => null))?.displayName ?? null;
                if ((ws.data as any).voz !== llamada || llamada.cerrada || llamada.history.length || llamada.sesion.ocupada) return;
                const datos = { nombre, ahora: new Date(), agenda, inmediatas };
                const texto = armarSaludo(datos);
                await memory.set("voz_saludo_dia", hoy);
                llamada.history.push(createMessage("assistant", texto));
                await llamada.sesion.turno("", Date.now(), { respuesta: texto, detalle: detalleSaludo(datos) });
              })().catch((e) => console.warn("[Voz] no pude saludar:", e));
              return;
            }
            // voz_turno
            if (!voz) { enviar({ type: "voz_error", mensaje: "La llamada no está iniciada." }); return; }
            const texto = String(data.texto ?? "").trim().slice(0, 1000);
            if (!texto) return;
            // ¿Contesta la pregunta de una aprobación? (J2) Lo decide este código; el turno que espera sigue con la respuesta
            if (voz.aprobacion) {
              const a = voz.aprobacion;
              const r = respuestaSiNo(texto);
              if (r === "no") { resolverAprobacion("denied", texto); return; }
              if (r === "si") {
                if (a.clase === "voz") { resolverAprobacion("approved", texto); return; }
                voz.sesion.anunciar(a.clase === "nunca_voz" ? "Eso no lo apruebo por voz: toca Aprobar en la pantalla, o dime que no." : "Esa la apruebas tocando la pantalla.");
                return;
              }
              // No se entendió: una vez se vuelve a preguntar; si dice otra cosa (más larga), cambió de tema y lo pendiente queda en no
              if (texto.split(/\s+/).length <= 3 && a.dudas === 0) { a.dudas++; voz.sesion.anunciar("¿Sí o no?"); return; }
              resolverAprobacion("denied", texto);
            }
            ctxUso.tipo = "voz";
            voz.history.push(createMessage("user", texto));
            voz.herramientasTurno = [];
            const r = await voz.sesion.turno(texto, Date.now());
            // con las herramientas del turno (trace): así «¿y eso alcanza?» sigue el hilo con las mismas (ToolRouter.seguimiento)
            if (r) voz.history.push({ ...createMessage("assistant", r.respuesta), trace: { tools: [...new Set(voz.herramientasTurno)] } });
            // La llamada queda como su propia conversación de Hestia (la transcripción): no aparece en vivo en el chat
            try {
              await memory.saveConversation(voz.sessionId, voz.history, "hestia");
              if (!voz.titulado) {
                const d = new Date();
                await memory.renameConversation(voz.sessionId, `Llamada · ${d.toLocaleDateString("es-CL", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}`);
                voz.titulado = true;
              }
            } catch (e) { console.warn("[Voz] no pude guardar la llamada:", e); }
            return;
          }

          if (data.type === "voice_message") {
            try {
              ctxUso.tipo = "voz"; // medición de la beta: entender el audio es trabajo de voz; la respuesta, del chat
              const audioBuffer = Buffer.from(data.audioBase64, "base64");
              // Dictado con contexto (stt/VoiceFix.ts): Whisper recibe el vocabulario de Eris y del usuario y lo último que
              // dijo Eris; lo que oyó con duda se corrige por sonido y, si hace falta, el modelo lo reinterpreta con la
              // conversación. Antes iba tal cual: "Registra … Chocapic … once" llegaba "Te distra … chocopiqui … donce".
              const sessionHistory = sessions.get((ws.data as any).sessionId) || [];
              const lastAssistant = [...sessionHistory].reverse().find((m: any) => m.role === "assistant" && m.content)?.content;
              const vocabulary = await voiceVocabulary(memory);
              const core = lexiconIndex(vocabulary);
              const busy = !!(ws.data as any).abortController;
              const v = await understandVoice({ lastAssistant, vocabulary }, {
                transcribe: (prompt) => whisperProvider.transcribeVerbose(audioBuffer, data.mimeType || "audio/m4a", prompt),
                indexes: [...unifiedFood.vocabularyIndexes(), core],
                core,
                // Con otra consulta en curso no se usa el modelo (quedaría en cola detrás de ella)
                llm: busy ? null : async (system, user) => (await provider.generate(
                  [{ role: "system", content: system }, { role: "user", content: user }], undefined,
                  { temperature: 0.1, maxTokens: 160, modelOverride: THINKING_MODES.flash.model, enableThinking: false },
                )).content || "",
              });
              const transcribed = v.text.trim();
              usoMedido(() => betaMetrics.voz(profileId, { whisperMs: v.ms.whisper }));
              if (v.heard) console.log(`[Voz] ${v.ms.whisper} ms + ${v.ms.fix} ms · oído: "${v.heard.slice(0, 80)}"${v.fixes.length ? ` → "${transcribed.slice(0, 80)}" (${v.fixes.join("; ")})` : ""}`);
              if (!transcribed) {
                ws.send(JSON.stringify({ type: "voice_transcribed", text: "" }));
                return;
              }
              ws.send(JSON.stringify({ type: "voice_transcribed", text: transcribed, ...(transcribed !== v.heard ? { heard: v.heard } : {}) }));
              await handleUserText(transcribed, data.mode || DEFAULT_CONFIG.defaultMode, true);
            } catch (err) {
              console.error("[Voz] No pude transcribir:", err);
              ws.send(JSON.stringify({ type: "error", message: "No pude transcribir el audio. Inténtalo de nuevo en un momento." }));
            }
            return;
          }

          // ─── Voz de respuesta (TTS) — el cliente pide esto explícitamente
          // cuando el usuario tiene el toggle de voz activado, no en cada
          // respuesta automáticamente (así no se bloquea la entrega del texto). ──
          if (data.type === "tts_request") {
            try {
              ctxUso.tipo = "voz";
              // La voz NO lee el texto de pantalla: dice una versión corta y
              // con la personalidad de Eris (canal distinto, complementa lo
              // escrito). Si el texto ya es breve se habla tal cual.
              const fullText = String(data.text || "").trim();
              const sessionHistory = sessions.get((ws.data as any).sessionId) || [];
              const lastUserMsg = [...sessionHistory].reverse().find((m) => m.role === "user")?.content ?? null;
              const busy = !!(ws.data as any).abortController; // hay una consulta en curso en esta conexión
              const spoken = await buildSpokenVersion(provider, fullText, lastUserMsg, THINKING_MODES.flash.model, { skipLLM: busy });
              if (!spoken) return;
              const tPiper = Date.now();
              const wav = await piperProvider.synthesize(spoken, "daniela");
              usoMedido(() => betaMetrics.voz(profileId, { piperMs: Date.now() - tPiper }));
              if (wav.length === 0) return;
              ws.send(JSON.stringify({
                type: "tts_audio",
                audioBase64: wav.toString("base64"),
                mimeType: "audio/wav",
              }));
            } catch (err) {
              console.error("[Voz] No pude generar la voz:", err);
              ws.send(JSON.stringify({ type: "error", message: "No pude generar la voz esta vez." }));
            }
            return;
          }

          if (data.type === "clear") {
            const currentSessionId = (ws.data as any).sessionId;
            sessions.set(currentSessionId, []);
            await memory.clearConversation(currentSessionId);
            ws.send(JSON.stringify({ type: "cleared" }));
            ws.send(JSON.stringify({
              type: "conversations_updated",
              conversations: convList(memory, ws),
            }));
          }
        } catch (err) {
          // El detalle (rutas, puertos, nombres internos) queda en el registro del servidor; al teléfono, algo que se entienda
          console.error(`[WS] Error en «${String((() => { try { return JSON.parse(String(message)).type; } catch { return "?"; } })())}»:`, err);
          ws.send(JSON.stringify({ type: "error", message: "Algo falló de mi lado. Inténtalo de nuevo en un momento." }));
        }
        }); // contextoUso.run
      },

      close(ws) {
        const pid = (ws.data as any)?.profileId;
        void (ws.data as any)?.voz?.cerrar?.().catch(() => {}); // J3: una llamada cortada igual queda resumida
        denyApprovals({ ws }); // lo que esperaba respuesta en esta conexión ya no se puede aprobar
        if (pid) unregisterClient(pid, ws);
      },
    },
  });

  console.log(`
  ███████╗██████╗ ██╗███████╗
  ██╔════╝██╔══██╗██║██╔════╝
  █████╗  ██████╔╝██║███████╗
  ██╔══╝  ██╔══██╗██║╚════██║
  ███████╗██║  ██║██║███████║
  ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝

  🌐 Eris GUI corriendo en: http://localhost:${PORT}
  🛡️  Zero-Knowledge Multi-Profile Activo
  🧠 Modelos: ⚡ ${THINKING_MODES.flash.model} | 🧠 ${THINKING_MODES.deep.model}
  🔮 Modo default: ${DEFAULT_CONFIG.defaultMode}
  `);
}

function getContentType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    json: "application/json",
    png: "image/png",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    woff2: "font/woff2",
  };
  return types[ext || ""] || "application/octet-stream";
}

startServer();
