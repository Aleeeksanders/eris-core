// ============================================================
// Eris — GlucoService
// Polling client para FreeStyle Libre vía LibreLinkUp API no oficial
// AVISO: Esta integración usa una API reverse-engineered.
//        No está soportada oficialmente por Abbott.
// ============================================================

import { createHash } from "crypto";

export interface GlucoseReading {
  timestamp: Date;
  value: number;          // mg/dL
  valueInMmol: number;    // mmol/L
  trend: GlucoseTrend;
  trendArrow: string;
  isHigh: boolean;
  isLow: boolean;
}

export type GlucoseTrend =
  | "rapidly_rising"    // ↑↑
  | "rising"            // ↑
  | "slowly_rising"     // ↗
  | "stable"            // →
  | "slowly_falling"    // ↘
  | "falling"           // ↓
  | "rapidly_falling"   // ↓↓
  | "unknown";

export interface GlucoSnapshot {
  current: GlucoseReading | null;
  history: GlucoseReading[];     // últimas 24h
  lastFetched: Date;
  sensorInfo?: {
    serialNumber: string;
    activationTime: Date;
    minutesWorn: number;
  };
}

export interface GlucoConfig {
  email: string;
  password: string;
  /** Región del servidor LibreLinkUp. Default: "eu" */
  region?: "us" | "eu" | "ae" | "ap" | "au" | "ca" | "de" | "fr" | "jp" | "la";
  /** Intervalo de polling en ms. Default: 5 min */
  pollIntervalMs?: number;
  /** Umbral bajo en mg/dL. Default: 70 */
  lowThreshold?: number;
  /** Umbral alto en mg/dL. Default: 180 */
  highThreshold?: number;
}

// Trend mapping desde el valor numérico de la API de LibreLinkUp
const TREND_MAP: Record<number, { trend: GlucoseTrend; arrow: string }> = {
  1: { trend: "rapidly_falling", arrow: "↓↓" },
  2: { trend: "falling", arrow: "↓" },
  3: { trend: "slowly_falling", arrow: "↘" },
  4: { trend: "stable", arrow: "→" },
  5: { trend: "slowly_rising", arrow: "↗" },
  6: { trend: "rising", arrow: "↑" },
  7: { trend: "rapidly_rising", arrow: "↑↑" },
};

const REGION_URLS: Record<string, string> = {
  us: "https://api-us.libreview.io",
  eu: "https://api-eu.libreview.io",
  ae: "https://api-ae.libreview.io",
  ap: "https://api-ap.libreview.io",
  au: "https://api-au.libreview.io",
  ca: "https://api-ca.libreview.io",
  de: "https://api-de.libreview.io",
  fr: "https://api-fr.libreview.io",
  jp: "https://api-jp.libreview.io",
  la: "https://api-la.libreview.io",
};

// Orden de prueba para autodiscovery: más probable primero
const DISCOVERY_ORDER = ["la", "eu", "us", "ap", "au", "ca", "de", "fr", "jp", "ae"];

export class GlucoService {
  private config: Required<GlucoConfig>;
  private baseUrl: string;
  private token: string | null = null;
  private accountIdHash: string | null = null;
  private patientId: string | null = null;

  /** Región detectada tras un login exitoso (útil para guardarla en el perfil) */
  discoveredRegion: string | null = null;

  /**
   * Intenta login en todas las regiones secuencialmente hasta encontrar la correcta.
   * Devuelve el servicio ya autenticado y la región descubierta.
   */
  static async discover(email: string, password: string): Promise<{ service: GlucoService; region: string }> {
    const errors: string[] = [];
    for (const region of DISCOVERY_ORDER) {
      const svc = new GlucoService({ email, password, region: region as any });
      try {
        await svc.login();
        console.log(`[GlucoService] 🌍 Región autodiscovered: ${region}`);
        return { service: svc, region };
      } catch (e: any) {
        // ToS pendiente: región correcta, pero el usuario debe aceptar ToS primero
        if (e.message?.includes("Términos") || e.message?.includes("tou") || e.message?.includes("ToS")) {
          return { service: svc, region };
        }
        errors.push(`${region}: ${e.message}`);
      }
    }
    throw new Error(
      `No se encontró servidor para estas credenciales. ` +
      `Verifica que el email y contraseña sean correctos en la app FreeStyle LibreLinkUp.\n` +
      `Detalles: ${errors.slice(0, 3).join(' | ')}`
    );
  }

  private snapshot: GlucoSnapshot = {
    current: null,
    history: [],
    lastFetched: new Date(0),
  };

  private pollingTimer: Timer | null = null;
  private onAlertCallbacks: Array<(reading: GlucoseReading, type: "low" | "high") => void> = [];

  constructor(config: GlucoConfig) {
    this.config = {
      region: "eu",
      pollIntervalMs: 5 * 60 * 1000, // 5 minutos
      lowThreshold: 70,
      highThreshold: 180,
      ...config,
    };
    this.baseUrl = REGION_URLS[this.config.region] || REGION_URLS.eu;
  }

  // ─── API Requests ─────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "version": "4.16.0",
      "product": "llu.android",
      "Accept": "application/json",
      "accept-encoding": "gzip",
      "cache-control": "no-cache",
      "connection": "Keep-Alive",
      ...extraHeaders,
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    if (this.accountIdHash) {
      headers["account-id"] = this.accountIdHash;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      throw new Error(`LibreLinkUp API error: ${res.status} ${res.statusText} → ${path}`);
    }

    const json = await res.json() as any;

    // Redirect de región: status=2 (viejo) o status=0 con data.redirect=true (nuevo)
    const isRegionRedirect =
      (json?.status === 2 || (json?.status === 0 && json?.data?.redirect === true)) &&
      json?.data?.region;
    if (isRegionRedirect) {
      const newRegion = json.data.region as string;
      const newUrl = REGION_URLS[newRegion];
      if (newUrl && newUrl !== this.baseUrl) {
        console.log(`[GlucoService] 🌍 Redirigiendo a región: ${newRegion} (${newUrl})`);
        this.baseUrl = newUrl;
        this.config.region = newRegion as any;
        this.discoveredRegion = newRegion;
        return this.request<T>(method, path, body, extraHeaders);
      }
    }

    return json as T;
  }

  // ─── Autenticación ────────────────────────────────────────────────

  async login(): Promise<void> {
    const res = await this.request<any>("POST", "/llu/auth/login", {
      email: this.config.email,
      password: this.config.password,
    });

    // Status 4 → Términos de Servicio no aceptados en la app LibreLinkUp
    if (res?.status === 4 || res?.data?.step?.type === "tou") {
      throw new Error(
        "LibreLinkUp: Debes aceptar los Términos de Servicio. " +
        "Descarga la app 'FreeStyle LibreLinkUp', inicia sesión y acepta los términos."
      );
    }

    // Status 2 con error → credenciales incorrectas (respuesta explícita de la API)
    if (res?.status === 2 && res?.error?.message) {
      throw new Error(`Login fallido: ${res.error.message}. Verifica tu email y contraseña en la app FreeStyle LibreLinkUp.`);
    }

    // Sin token → credenciales incorrectas u otro error
    if (!res?.data?.authTicket?.token) {
      const hint = res?.status !== undefined ? ` (status API: ${res.status})` : "";
      throw new Error(`Login fallido: credenciales incorrectas o ToS pendientes en LibreLinkUp${hint}`);
    }

    this.token = res.data.authTicket.token;
    const userId: string = res.data.user?.id ?? "";
    this.accountIdHash = createHash("sha256").update(userId).digest("hex");
    // Registrar región final (puede haber cambiado por redirect)
    this.discoveredRegion = this.config.region;
    console.log(`[GlucoService] ✅ Autenticado como ${this.config.email} (región: ${this.config.region})`);

    // Obtener el ID del paciente (primera conexión)
    await this.fetchPatientId();
  }

  private async fetchPatientId(): Promise<void> {
    const res = await this.request<any>("GET", "/llu/connections");
    const connections: any[] = res?.data || [];

    if (connections.length === 0) {
      throw new Error(
        "Tu cuenta de LibreLinkUp no tiene conexiones de seguimiento. " +
        "Para que Eris acceda a tu glucosa: en la app LibreLinkUp ve a Perfil > Compartir datos, " +
        "crea una invitación y acéptala desde una segunda cuenta (tuya o de un familiar). " +
        "Luego ingresa las credenciales de esa segunda cuenta en la integración de Eris."
      );
    }

    // Usar la primera conexión (el propio usuario o un familiar)
    this.patientId = connections[0].patientId || connections[0].id;
    console.log(`[GlucoService] 👤 PatientId: ${this.patientId}`);
  }

  // ─── Lectura de datos ─────────────────────────────────────────────

  async fetchLatest(): Promise<GlucoSnapshot> {
    if (!this.token) await this.login();

    try {
      const res = await this.request<any>(
        "GET",
        `/llu/connections/${this.patientId}/graph`
      );

      const raw = res?.data;
      if (!raw) throw new Error("Respuesta vacía del sensor");

      const current = this.parseReading(raw.connection?.glucoseMeasurement);
      const history = (raw.graphData || [])
        .map((r: any) => this.parseReading(r))
        .filter(Boolean) as GlucoseReading[];

      this.snapshot = {
        current: current || null,
        history,
        lastFetched: new Date(),
        sensorInfo: raw.connection?.sensor
          ? {
              serialNumber: raw.connection.sensor.sn,
              activationTime: new Date(raw.connection.sensor.a * 1000),
              minutesWorn: raw.connection.sensor.lbt,
            }
          : undefined,
      };

      // Evaluar alertas
      if (current) this.checkAlerts(current);

      return this.snapshot;
    } catch (err: any) {
      // Token expirado → re-login automático
      if (err?.message?.includes("401") || err?.message?.includes("Unauthorized")) {
        this.token = null;
        await this.login();
        return this.fetchLatest();
      }
      throw err;
    }
  }

  private parseReading(raw: any): GlucoseReading | null {
    if (!raw) return null;

    const valueMgdl = raw.ValueInMgPerDl ?? raw.value;
    if (typeof valueMgdl !== "number") return null;

    const trendNum = raw.TrendArrow ?? raw.trendArrow ?? 4;
    const trendInfo = TREND_MAP[trendNum] || { trend: "unknown" as GlucoseTrend, arrow: "?" };

    // Timestamp: puede ser unix seconds o string ISO
    let ts: Date;
    if (typeof raw.Timestamp === "string") {
      ts = new Date(raw.Timestamp);
    } else if (typeof raw.FactoryTimestamp === "string") {
      ts = new Date(raw.FactoryTimestamp);
    } else {
      ts = new Date();
    }

    return {
      timestamp: ts,
      value: valueMgdl,
      valueInMmol: parseFloat((valueMgdl / 18.01559).toFixed(1)),
      trend: trendInfo.trend,
      trendArrow: trendInfo.arrow,
      isHigh: valueMgdl > this.config.highThreshold,
      isLow: valueMgdl < this.config.lowThreshold,
    };
  }

  // ─── Alertas ──────────────────────────────────────────────────────

  private checkAlerts(reading: GlucoseReading): void {
    if (reading.isLow || reading.isHigh) {
      const type = reading.isLow ? "low" : "high";
      this.onAlertCallbacks.forEach((cb) => cb(reading, type));
    }
  }

  onAlert(callback: (reading: GlucoseReading, type: "low" | "high") => void): void {
    this.onAlertCallbacks.push(callback);
  }

  // ─── Polling ──────────────────────────────────────────────────────

  startPolling(): void {
    if (this.pollingTimer) return;
    console.log(`[GlucoService] 🔄 Iniciando polling cada ${this.config.pollIntervalMs / 60000}min`);

    // Primera fetch inmediata
    this.fetchLatest().catch((e) =>
      console.error("[GlucoService] Error en fetch inicial:", e.message)
    );

    this.pollingTimer = setInterval(async () => {
      try {
        await this.fetchLatest();
        console.log(
          `[GlucoService] 📊 ${this.snapshot.current?.value ?? "?"} mg/dL ` +
          `${this.snapshot.current?.trendArrow ?? ""}`
        );
      } catch (e: any) {
        console.error("[GlucoService] Error en polling:", e.message);
      }
    }, this.config.pollIntervalMs);
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  // ─── Accesores públicos ───────────────────────────────────────────

  getSnapshot(): GlucoSnapshot {
    return this.snapshot;
  }

  getCurrent(): GlucoseReading | null {
    return this.snapshot.current;
  }

  getHistory(hours = 24): GlucoseReading[] {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.snapshot.history.filter((r) => r.timestamp > cutoff);
  }

  /** Retorna estadísticas del período seleccionado */
  getStats(hours = 24): {
    avg: number;
    min: number;
    max: number;
    timeInRange: number;   // % entre 70–180
    timeAbove: number;     // % > 180
    timeBelow: number;     // % < 70
  } | null {
    const readings = this.getHistory(hours);
    if (readings.length === 0) return null;

    const values = readings.map((r) => r.value);
    const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const inRange = readings.filter((r) => !r.isHigh && !r.isLow).length;
    const above = readings.filter((r) => r.isHigh).length;
    const below = readings.filter((r) => r.isLow).length;
    const total = readings.length;

    return {
      avg,
      min,
      max,
      timeInRange: Math.round((inRange / total) * 100),
      timeAbove: Math.round((above / total) * 100),
      timeBelow: Math.round((below / total) * 100),
    };
  }
}
