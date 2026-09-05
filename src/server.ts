// ============================================================
// Eris — Web Server
// Servidor HTTP + WebSocket con proyectos + compresión de contexto
// Soporta perfiles múltiples aislados (Zero-Knowledge)
// ============================================================

import { QueryEngine } from "./QueryEngine.js";
import { ToolRegistry } from "./tools.js";
import { OllamaProvider } from "./services/llm/OllamaProvider.js";
import { ContextCompressor } from "./services/ContextCompressor.js";
import { loadSystemPrompt } from "./context.js";
import { DEFAULT_CONFIG, THINKING_MODES } from "./types/config.js";
import type { ThinkingMode } from "./types/config.js";
import { FileSystemAdapter, type MemoryAdapter } from "./memory.js";
import { join } from "path";
import type { Message } from "./types/message.js";
import { createMessage } from "./types/message.js";
import { roleManager } from "./services/security/RoleManager.js";
import { ROLES, canUseTool, type Role } from "./services/security/RoleSystem.js";
import { authRateLimiter } from "./services/security/AuthRateLimiter.js";
import { GlucoService } from "./services/gluco/GlucoService.js";
import { UnifiedFoodService } from "./services/gluco/UnifiedFoodService.js";
import { GlucoTool } from "./tools/GlucoTool.js";
import { NutritionTool } from "./tools/NutritionTool.js";
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

const PORT = 3000;
const CONTEXT_RECENT = 12;
const COMPRESS_THRESHOLD = 16;

// ─── PIN ejecutivo Ikaros ───────────────────────────────────
// El acceso remoto a 'ikaros' está protegido por el PIN en .env

// Cache de memorias y query engines aislados por perfil
const memories = new Map<string, MemoryAdapter>();
const queryEngines = new Map<string, QueryEngine>(); // profileKey → QueryEngine
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

  const isAvailable = await provider.isAvailable();
  if (!isAvailable) {
    console.log("⚠️  Ollama no está disponible. Ejecuta: ollama serve");
    process.exit(1);
  }

  const promptPath = join((import.meta as any).dir, "..", "data", "system-prompt.md");
  const systemPrompt = await loadSystemPrompt(promptPath);
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
  toolRegistry.register(new GlucoTool());
  toolRegistry.register(new NutritionTool());

  // Mapa de health snapshots por sesión (profileId → snapshot serializado)
  const healthSnapshots = new Map<string, string>();

  // Mapa de contexto financiero por sesión (profileId → texto de contexto Hunter Wallet)
  const financialContexts = new Map<string, string>();

  const queryEngine = new QueryEngine(provider, toolRegistry, systemPrompt);
  const compressor = new ContextCompressor(provider);

  const sessions = new Map<string, Message[]>();
  const webDir = join((import.meta as any).dir, "..", "web");

  const server = Bun.serve({
    port: PORT,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const sessionId = url.searchParams.get("session") || crypto.randomUUID();
        const rawProfileId = url.searchParams.get("profile") || "default";
        const profileId = rawProfileId.toLowerCase();
        // PIN ya NO viaja en la URL — se envía como primer mensaje WebSocket

        const remoteAddress =
          req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
          server.requestIP(req)?.address ||
          '';

        const isLocal =
          remoteAddress === '127.0.0.1' ||
          remoteAddress === '::1' ||
          remoteAddress.startsWith('::ffff:127.');

        // Ya no bloqueamos la conexión remota por defecto si es ikaros, 
        // porque usará la app (Tailscale) y requiere PIN.

        const upgraded = server.upgrade(req, { data: { sessionId, profileId, remoteAddress, authenticated: false } as any });
        if (upgraded) return undefined as any;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      if (url.pathname === "/api/status") {
        const ollamaOk = await provider.isAvailable();
        return Response.json({
          status: "ok",
          ollama: ollamaOk,
          model: DEFAULT_CONFIG.llm.model,
          defaultMode: DEFAULT_CONFIG.defaultMode,
          tools: toolRegistry.listNames(),
          features: {
            glucoTrack: true,
            fatSecret: true,
          },
        });
      }

      // ─── Reset de PIN usando Recovery Key ────────────────────────────
      if (url.pathname === "/api/auth/reset-pin-with-rk" && req.method === "POST") {
        try {
          const body = await req.json() as { profileId: string; recoveryKey: string };
          if (!body.profileId || !body.recoveryKey) {
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
        const profileId = req.headers.get("x-profile-id");
        const pin = req.headers.get("x-pin");
        
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
        const { sessionId, profileId, remoteAddress } = ws.data as any;
        let data: any;
        try { data = JSON.parse(message as string); } catch { return; }

        // ─── Handshake de autenticación ──────────────────────────────────────
        if (!((ws.data as any).authenticated)) {
          if (data.type !== 'auth') {
            ws.send(JSON.stringify({ type: 'error', message: 'Autenticación requerida.' }));
            return;
          }

          const pin: string | undefined = data.pin;

          // ─── Hardcode de Ikaros en servidor ───────────────────────────────────
          if (profileId === 'ikaros') {
            const serverIkarosPin = process.env.IKAROS_PIN;
            if (serverIkarosPin && pin !== serverIkarosPin) {
              ws.send(JSON.stringify({ type: 'error', message: 'Credenciales administrativas incorrectas para Ikaros.' }));
              return;
            }
          }

          try {
            const { memory, recoveryKey } = await getOrCreateMemory(profileId, pin);
            (ws.data as any).pin = pin;
            (ws.data as any).authenticated = true;
            (ws.data as any).memory = memory;

            const userProfile = await memory.getProfile();

            let profileRole = await roleManager.getRole(profileId);
            // Se eliminó el downgrade remoto de ikaros, ya que ikaros está diseñado
            // para usarse en la app móvil. El PIN protege el acceso.
            (ws.data as any).role = profileRole;

            const roleDefinition = ROLES[profileRole];
            const rolPromptPath = ROLE_PROMPTS[profileRole];

            // Cargar archivos de contexto opcionales del perfil
            const profileDir = join(os.homedir(), ".eris", "profiles", profileId);
            let trainingPlanBlock = '';
            try {
              const tp = await readFile(join(profileDir, "training_plan.md"), "utf-8");
              trainingPlanBlock = `\n\n### Plan de Entrenamiento Actual\n${tp}`;
            } catch { /* sin plan registrado */ }

            let personalizedPrompt: string;
            if (userProfile) {
              const profileText = [
                userProfile.displayName ? `Nombre: ${userProfile.displayName}` : '',
                userProfile.role ? `Contexto: ${userProfile.role}` : '',
                userProfile.goals ? `Objetivos: ${userProfile.goals}` : '',
                userProfile.language ? `Idioma preferido: ${userProfile.language}` : '',
                userProfile.customContext || '',
              ].filter(Boolean).join('\n') + trainingPlanBlock;
              personalizedPrompt = await loadSystemPrompt(rolPromptPath, profileText, profileRole);
            } else {
              const profileText = trainingPlanBlock.trim() || undefined;
              personalizedPrompt = await loadSystemPrompt(rolPromptPath, profileText, profileRole);
            }

            const filteredRegistry = roleDefinition.allowedTools.includes('*')
              ? toolRegistry
              : new ToolRegistry(toolRegistry.getAll().filter(t => canUseTool(roleDefinition, t.name)));

            const profileKey = `${profileId}:${pin || ''}`;
            if (!queryEngines.has(profileKey)) {
              queryEngines.set(profileKey, new QueryEngine(provider, filteredRegistry, personalizedPrompt));
            }

            if (!sessions.has(sessionId)) sessions.set(sessionId, memory.getConversation(sessionId));
            const history = sessions.get(sessionId) || [];

            // Registrar cliente para recibir push de alertas CGM
            registerClient(profileId, ws);

            ws.send(JSON.stringify({
              type: 'connected',
              sessionId, profileId,
              role: profileRole,
              recoveryKey,
              userProfile,
              conversations: memory.listConversations(),
              projects: memory.listProjects(),
              history: history.map(m => ({ role: m.role, content: m.content, id: m.id })),
              defaultMode: DEFAULT_CONFIG.defaultMode,
              availableModes: Object.values(THINKING_MODES).map(m => ({ id: m.id, label: m.label, icon: m.icon, description: m.description })),
            }));
          } catch (err: any) {
            console.error('[WS] Error de autenticación/memoria:', err);
            ws.send(JSON.stringify({ type: 'error', message: err?.message || 'PIN incorrecto.' }));
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

          if (data.type === "change_pin") {
            const newPin = data.newPin;
            if (!newPin) throw new Error("Nuevo PIN inválido");
            await memory.changePin(newPin);
            
            const oldKey = `${profileId}:${pin || ''}`;
            const newKey = `${profileId}:${newPin}`;
            memories.delete(oldKey);
            memories.set(newKey, memory);
            (ws.data as any).pin = newPin;
            
            ws.send(JSON.stringify({ type: "pin_changed", success: true }));
            return;
          }

          if (data.type === "new_chat") {
            const newId = crypto.randomUUID();
            sessions.set(newId, []);
            (ws.data as any).sessionId = newId;
            
            if (data.projectId) {
              await memory.saveConversation(newId, []);
              await memory.assignConversationToProject(newId, data.projectId);
            }

            ws.send(JSON.stringify({
              type: "chat_switched",
              sessionId: newId,
              history: [],
              conversations: memory.listConversations(),
            }));
            return;
          }

          if (data.type === "switch_chat") {
            const targetId = data.conversationId;
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
              conversations: memory.listConversations(),
            }));
            return;
          }

          if (data.type === "delete_chat") {
            const targetId = data.conversationId;
            sessions.delete(targetId);
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
                conversations: memory.listConversations(),
              }));
            } else {
              ws.send(JSON.stringify({
                type: "conversations_updated",
                conversations: memory.listConversations(),
              }));
            }
            return;
          }

          if (data.type === "create_project") {
            const project = await memory.createProject(data.name || "Nuevo Proyecto", data.emoji || "📁");
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
              conversations: memory.listConversations(),
              projects: memory.listProjects(),
            }));
            return;
          }

          if (data.type === "assign_to_project") {
            await memory.assignConversationToProject(data.conversationId, data.projectId);
            ws.send(JSON.stringify({
              type: "conversations_updated",
              conversations: memory.listConversations(),
              projects: memory.listProjects(),
            }));
            return;
          }

          if (data.type === "rename_project") {
            await memory.renameProject(data.projectId, data.name, data.emoji);
            ws.send(JSON.stringify({
              type: "conversations_updated",
              conversations: memory.listConversations(),
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
              sessionId: currentSessionId,
              profileId,
              role: (ws.data as any).role,
              conversations: memory.listConversations(),
              projects: memory.listProjects(),
              history: history.map((m: any) => ({ role: m.role, content: m.content, id: m.id })),
              defaultMode: DEFAULT_CONFIG.defaultMode,
            }));
            return;
          }

          if (data.type === "save_preference") {
            if (data.key) {
              try {
                await memory.set(`pref_${data.key}`, data.value);
              } catch {}
              ws.send(JSON.stringify({ type: "preference_saved", key: data.key }));
            }
            return;
          }

          if (data.type === "save_profile") {
            await memory.saveProfile(data.profile);
            queryEngines.delete(`${profileId}:${pin || ''}`);
            const oldGluco = activeGlucoServices.get(profileId);
            if (oldGluco) { oldGluco.stopPolling(); activeGlucoServices.delete(profileId); }
            ws.send(JSON.stringify({ type: "profile_saved", profile: data.profile }));
            return;
          }

          // ─── Insulina ──────────────────────────────────────────────────────
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
              // Merge en lugar de reemplazar para que cada fuente (métricas, nutrición, etc.)
              // pueda actualizar su propia parte sin borrar las demás.
              const existing = healthSnapshots.get(profileId);
              const merged = existing ? { ...JSON.parse(existing), ...data.snapshot } : data.snapshot;
              healthSnapshots.set(profileId, JSON.stringify(merged));
              try {
                await memory.set('health_snapshot_latest', merged);
              } catch {}
              ws.send(JSON.stringify({ type: "health_snapshot_received" }));
            }
            return;
          }

          // ─── Contexto financiero desde Hunter Wallet ─────────────────────────
          if (data.type === "update_financial_context") {
            if (data.context) {
              financialContexts.set(profileId, data.context);
              ws.send(JSON.stringify({ type: "financial_context_received" }));
            }
            return;
          }

          // ─── Sync nutrición: el móvil pide el log del día al montar NutritionScreen ──
          if (data.type === "sync_nutrition_today") {
            try {
              const today = new Date().toDateString();
              const nutritionLog = await memory.get(`nutrition_log_${today}`).catch(() => []);
              const hydrationLog = await memory.get(`hydration_log_${today}`).catch(() => []);
              const totalWater = Array.isArray(hydrationLog)
                ? Math.round(hydrationLog.reduce((s: number, e: any) => s + (e.liters || 0), 0) * 100) / 100
                : 0;
              ws.send(JSON.stringify({
                type: "nutrition_today",
                entries: Array.isArray(nutritionLog) ? nutritionLog : [],
                waterLiters: totalWater,
              }));
            } catch {}
            return;
          }

          if (data.type === "message") {
            const currentSessionId = (ws.data as any).sessionId;
            const history = sessions.get(currentSessionId) || [];
            const userText = data.content;
            const requestedMode: ThinkingMode = data.mode || DEFAULT_CONFIG.defaultMode;

            console.log(`\n[MSG] ${profileId}: "${userText.substring(0, 30)}..." | Modo: ${requestedMode}`);
            const startTime = Date.now();

            const userMsg = createMessage("user", userText);
            history.push(userMsg);

            ws.send(JSON.stringify({ type: "thinking", status: "Pensando...", mode: requestedMode }));

            const ctx = memory.getConversationContext(currentSessionId, CONTEXT_RECENT);
            const recentHistory = history.slice(-CONTEXT_RECENT);

            // Usar el engine personalizado de este perfil
            const profileKey = `${profileId}:${pin || ''}`;
            const engine = queryEngines.get(profileKey) || queryEngine;

            // Inyectar snapshot de salud + historial médico en el contexto
            let healthContext = '';
            const cachedSnapshot = healthSnapshots.get(profileId);
            if (cachedSnapshot) {
              try {
                const snap = JSON.parse(cachedSnapshot);
                const parts: string[] = ['\n\n## 📊 Métricas de Salud Actuales (del dispositivo del usuario):'];
                if (snap.sleep)     parts.push(`- Sueño: ${snap.sleep.durationHours}h`);
                if (snap.heartRate) parts.push(`- FC: ${snap.heartRate.average} bpm (reposo: ${snap.heartRate.resting} bpm)`);
                if (snap.hrv)       parts.push(`- HRV: ${snap.hrv}ms`);
                if (snap.steps)     parts.push(`- Pasos hoy: ${snap.steps.toLocaleString()}`);
                if (snap.distance)  parts.push(`- Distancia: ${snap.distance} km`);
                if (snap.calories)  parts.push(`- Calorías activas: ${snap.calories.active} kcal`);
                if (snap.spo2)      parts.push(`- SpO2: ${snap.spo2}%`);
                if (snap.weight)    parts.push(`- Peso: ${snap.weight} kg`);
                if (snap.nutrition) parts.push(`- Nutrición: ${snap.nutrition.calories} kcal | Prot: ${snap.nutrition.protein}g | Carbos: ${snap.nutrition.carbs}g | Grasas: ${snap.nutrition.fat}g`);
                if (snap.hydration) parts.push(`- Hidratación: ${snap.hydration}L`);
                if (snap.workouts?.length) parts.push(`- Entrenamientos: ${snap.workouts.length} sesion(es)`);
                parts.push(`- Actualizado: ${new Date(snap.lastUpdated).toLocaleTimeString('es-ES')}`);
                healthContext = parts.join('\n');
              } catch {}
            }

            // Contexto médico: condiciones, medicamentos, insulina reciente
            let medicalContext = '';
            try {
              const userProf = await memory.getProfile();
              const med = userProf?.medical;
              if (med) {
                const mParts: string[] = ['\n\n## 🏥 Historial Médico del Usuario:'];
                if (med.conditions?.length) {
                  mParts.push('Condiciones: ' + med.conditions.map(c => c.id.replace(/_/g, ' ')).join(', '));
                }
                if (med.medications?.filter(m => m.active).length) {
                  const meds = med.medications.filter(m => m.active).map(m => `${m.name} ${m.dose || ''}`.trim());
                  mParts.push('Medicamentos activos: ' + meds.join(', '));
                }
                if (med.thresholds) {
                  const t = med.thresholds;
                  mParts.push(`Umbrales glucosa: bajo <${t.glucoseLow} · alto >${t.glucoseHigh} · urgente bajo <${t.glucoseUrgentLow} · urgente alto >${t.glucoseUrgentHigh} mg/dL`);
                }
                if (med.bloodType) mParts.push(`Grupo sanguíneo: ${med.bloodType}`);
                if (med.allergies) mParts.push(`Alergias: ${med.allergies}`);
                // Últimas dosis de insulina (si es diabético)
                const isDiabetic = med.conditions?.some(c => c.id.startsWith('diabetes'));
                if (isDiabetic) {
                  const recentInsulin = await memory.getInsulinLog(1);
                  if (recentInsulin.length > 0) {
                    const last = recentInsulin[0];
                    const ago = Math.round((Date.now() - new Date(last.timestamp).getTime()) / 60000);
                    mParts.push(`Última insulina: ${last.units}UI ${last.type === 'rapid' ? 'rápida' : last.type === 'long' ? 'lenta' : 'mixta'} hace ${ago} min${last.glucoseAtTime ? ` (glucosa ${last.glucoseAtTime} mg/dL entonces)` : ''}`);
                  }
                }
                medicalContext = mParts.join('\n');
              }
            } catch {}

            const financialContext = financialContexts.get(profileId) || '';
            const autoCtx = [healthContext, medicalContext, financialContext].filter(Boolean).join('');
            const enrichedUserText = autoCtx
              ? `${userText}\n\n[CONTEXTO AUTOMÁTICO - NO MOSTRAR AL USUARIO]${autoCtx}`
              : userText;

            const queryResult = await engine.query(
              enrichedUserText,
              recentHistory,
              {
                onToken: (token) => {
                  ws.send(JSON.stringify({ type: "token", content: token }));
                },
                onThinking: (text) => {
                  ws.send(JSON.stringify({ type: "thinking_token", content: text }));
                },
                onToolCall: (tc) => {
                  ws.send(JSON.stringify({
                    type: "tool_call",
                    name: tc.name,
                    input: tc.input,
                  }));
                },
                onToolResult: (result) => {
                  ws.send(JSON.stringify({
                    type: "tool_result",
                    name: result.name,
                    output: result.output,
                    error: result.error,
                    duration: result.duration,
                  }));
                },
                onModeResolved: (mode, model) => {
                  ws.send(JSON.stringify({
                    type: "mode_resolved",
                    mode,
                    model,
                  }));
                },
              },
              ctx.summary,
              requestedMode,
              {
                profileId,
                memory,
                role: (ws.data as any).role,
                wsClient: ws,
                glucoService: activeGlucoServices.get(profileId) || null,
                foodService: unifiedFood,
              }
            );

            const response = queryResult.message;
            history.push(response);
            sessions.set(currentSessionId, history);
            await memory.saveConversation(currentSessionId, history);

            // Guardar para training (en background)
            memory.saveTrainingData(currentSessionId, history).catch(() => {});

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[OK] ${profileId} Resp: "${response.content.substring(0, 50).replace(/\n/g, " ")}..."`);

            ws.send(JSON.stringify({
              type: "stream_end",
              content: response.content,
              id: response.id,
              modeUsed: queryResult.modeUsed,
              modelUsed: queryResult.modelUsed,
            }));

            ws.send(JSON.stringify({
              type: "conversations_updated",
              conversations: memory.listConversations(),
            }));

            // ─── Compresión en background ───
            if (history.length > COMPRESS_THRESHOLD) {
              const toSummarize = memory.getMessagesToSummarize(currentSessionId, 6);
              if (toSummarize && toSummarize.length > 0) {
                console.log(`  🗜️ [${profileId}] Comprimiendo ${toSummarize.length} mensajes...`);
                compressor
                  .compress(toSummarize, ctx.summary)
                  .then((summary) => {
                    const upTo = history.length - 6;
                    memory.updateSummary(currentSessionId, summary, upTo);
                  })
                  .catch((err) => {
                    console.error("  ❌ Error comprimiendo:", err);
                  });
              }
            }
          }

          if (data.type === "clear") {
            const currentSessionId = (ws.data as any).sessionId;
            sessions.set(currentSessionId, []);
            await memory.clearConversation(currentSessionId);
            ws.send(JSON.stringify({ type: "cleared" }));
            ws.send(JSON.stringify({
              type: "conversations_updated",
              conversations: memory.listConversations(),
            }));
          }
        } catch (err) {
          ws.send(JSON.stringify({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          }));
        }
      },

      close(ws) {
        const pid = (ws.data as any)?.profileId;
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
