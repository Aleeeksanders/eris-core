// ============================================================
// Eris — Cuentas de Google, sesiones y llave del servidor
//
// Con SSO de Google nadie escribe un PIN: el servidor cifra cada perfil con una llave que solo él puede
// calcular (HMAC de un secreto del servidor + el id del perfil) y liga cada cuenta de Google (`sub`, el id
// estable de Google, NO el correo) a UN perfil. Así:
//   · nadie puede "adivinar" el perfil de otro: para entrar hay que ser esa cuenta de Google, verificada por el servidor;
//   · dos personas no comparten datos aunque escojan el mismo alias;
//   · el celular guarda un token de sesión al azar, no una clave de cifrado.
//
// Archivos (en ~/.eris, junto a roles.json):
//   server_secret   32 bytes al azar (hex). SI SE PIERDE, los perfiles ligados a Google no se pueden abrir: respaldarlo.
//   accounts.json   sub → { profileId, email, name, createdAt, lastLoginAt }
//   sessions.json   sha256(token) → { sub, profileId, createdAt, expiresAt }   (el token en claro nunca se guarda)
// ============================================================

import { createHash, createHmac, randomBytes } from "crypto";
import { mkdir, readFile, writeFile, chmod } from "fs/promises";
import { join } from "path";
import * as os from "os";

const DEFAULT_DIR = join(os.homedir(), ".eris");
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 días

export interface AccountRecord {
  profileId: string;
  email: string;
  name?: string;
  createdAt: string;
  lastLoginAt: string;
  /** Suspendida por el administrador: no puede iniciar sesión ni reconectar. */
  disabled?: boolean;
}

/** Sesión sin el hash del token (lo único que sale hacia el panel de administración). */
export interface SessionInfo {
  profileId: string;
  createdAt: string;
  expiresAt: string;
}

export interface SessionRecord {
  sub: string;
  profileId: string;
  createdAt: string;
  expiresAt: string;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, "utf-8")) as T; } catch { return fallback; }
}

export class AccountStore {
  private secret: Buffer | null = null;
  private chain: Promise<unknown> = Promise.resolve(); // serializa escrituras (un solo proceso, varios eventos)

  constructor(private dir: string = DEFAULT_DIR) {}

  private file(name: string) { return join(this.dir, name); }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  // ─── Llave del servidor ────────────────────────────────────────────────────
  async getSecret(): Promise<Buffer> {
    if (this.secret) return this.secret;
    await mkdir(this.dir, { recursive: true });
    const f = this.file("server_secret");
    try {
      const hex = (await readFile(f, "utf-8")).trim();
      if (/^[a-f0-9]{64}$/i.test(hex)) { this.secret = Buffer.from(hex, "hex"); return this.secret; }
      throw new Error("server_secret con formato inválido");
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e; // existe pero está dañado: NO lo pisamos (se perderían todos los perfiles ligados)
    }
    const fresh = randomBytes(32);
    await writeFile(f, fresh.toString("hex"), { encoding: "utf-8", flag: "wx" });
    await chmod(f, 0o600).catch(() => {}); // en Windows es un no-op
    this.secret = fresh;
    return fresh;
  }

  /** Clave con la que el servidor cifra/abre el perfil (equivale al "PIN" del sistema anterior, pero nadie lo ve). */
  async derivePin(profileId: string): Promise<string> {
    const secret = await this.getSecret();
    return createHmac("sha256", secret).update(`eris-profile-key:v1:${profileId}`).digest("hex").toUpperCase();
  }

  // ─── Cuentas ───────────────────────────────────────────────────────────────
  private async readAccounts(): Promise<Record<string, AccountRecord>> {
    return (await readJson<{ accounts?: Record<string, AccountRecord> }>(this.file("accounts.json"), {})).accounts ?? {};
  }

  async findBySub(sub: string): Promise<AccountRecord | undefined> {
    return (await this.readAccounts())[sub];
  }

  async findByProfile(profileId: string): Promise<{ sub: string; account: AccountRecord } | undefined> {
    const all = await this.readAccounts();
    const hit = Object.entries(all).find(([, a]) => a.profileId === profileId);
    return hit ? { sub: hit[0], account: hit[1] } : undefined;
  }

  async bind(sub: string, profileId: string, email: string, name?: string): Promise<AccountRecord> {
    return this.serial(async () => {
      const all = await this.readAccounts();
      const clash = Object.entries(all).find(([s, a]) => a.profileId === profileId && s !== sub);
      if (clash) throw new Error("Ese perfil ya pertenece a otra cuenta de Google.");
      const now = new Date().toISOString();
      const rec: AccountRecord = { profileId, email, name, createdAt: all[sub]?.createdAt ?? now, lastLoginAt: now, ...(all[sub]?.disabled ? { disabled: true } : {}) };
      all[sub] = rec;
      await mkdir(this.dir, { recursive: true });
      await writeFile(this.file("accounts.json"), JSON.stringify({ version: 1, accounts: all }, null, 2), "utf-8");
      return rec;
    });
  }

  /** Todas las cuentas (para el panel de administración). No incluye el `sub` de Google. */
  async listAccounts(): Promise<AccountRecord[]> {
    return Object.values(await this.readAccounts());
  }

  /** Suspende o reactiva la cuenta ligada a un perfil. Devuelve false si ese perfil no tiene cuenta de Google. */
  async setDisabled(profileId: string, disabled: boolean): Promise<boolean> {
    return this.serial(async () => {
      const all = await this.readAccounts();
      const hit = Object.entries(all).find(([, a]) => a.profileId === profileId);
      if (!hit) return false;
      if (disabled) all[hit[0]].disabled = true; else delete all[hit[0]].disabled;
      await writeFile(this.file("accounts.json"), JSON.stringify({ version: 1, accounts: all }, null, 2), "utf-8");
      return true;
    });
  }

  /** Sesiones vigentes, sin el hash del token. */
  async listSessions(): Promise<SessionInfo[]> {
    return Object.values(await this.readSessions()).map((s) => ({ profileId: s.profileId, createdAt: s.createdAt, expiresAt: s.expiresAt }));
  }

  async touch(sub: string): Promise<void> {
    await this.serial(async () => {
      const all = await this.readAccounts();
      if (!all[sub]) return;
      all[sub].lastLoginAt = new Date().toISOString();
      await writeFile(this.file("accounts.json"), JSON.stringify({ version: 1, accounts: all }, null, 2), "utf-8");
    });
  }

  // ─── Sesiones ──────────────────────────────────────────────────────────────
  private hash(token: string) { return createHash("sha256").update(token).digest("hex"); }

  private async readSessions(): Promise<Record<string, SessionRecord>> {
    const all = (await readJson<{ sessions?: Record<string, SessionRecord> }>(this.file("sessions.json"), {})).sessions ?? {};
    const now = Date.now();
    for (const [h, s] of Object.entries(all)) if (new Date(s.expiresAt).getTime() < now) delete all[h]; // limpia vencidas
    return all;
  }

  private async writeSessions(all: Record<string, SessionRecord>) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file("sessions.json"), JSON.stringify({ version: 1, sessions: all }, null, 2), "utf-8");
  }

  /** Crea una sesión y devuelve el token EN CLARO (solo se muestra una vez; en disco queda su hash). */
  async createSession(sub: string, profileId: string): Promise<string> {
    return this.serial(async () => {
      const token = randomBytes(32).toString("base64url");
      const all = await this.readSessions();
      const now = Date.now();
      all[this.hash(token)] = { sub, profileId, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_TTL_MS).toISOString() };
      await this.writeSessions(all);
      return token;
    });
  }

  async resolveSession(token: string): Promise<SessionRecord | null> {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
    const s = (await this.readSessions())[this.hash(token)];
    return s ?? null;
  }

  async revokeSession(token: string): Promise<void> {
    await this.serial(async () => {
      const all = await this.readSessions();
      delete all[this.hash(token)];
      await this.writeSessions(all);
    });
  }

  /** Cierra TODAS las sesiones de un perfil (por si se perdió un celular). */
  async revokeProfileSessions(profileId: string): Promise<number> {
    return this.serial(async () => {
      const all = await this.readSessions();
      let n = 0;
      for (const [h, s] of Object.entries(all)) if (s.profileId === profileId) { delete all[h]; n++; }
      await this.writeSessions(all);
      return n;
    });
  }
}

export const accountStore = new AccountStore();
