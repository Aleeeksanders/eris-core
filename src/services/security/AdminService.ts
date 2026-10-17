// ============================================================
// Eris — Servicio de administración (panel de Ikaros)
//
// Regla de diseño: el administrador ve METADATOS de cada perfil (quién es, cuándo entró, cuánto pesa, cuántas
// sesiones tiene, qué acciones sensibles disparó). NUNCA abre ni descifra el contenido de otro perfil (chats,
// salud, finanzas): este módulo ni siquiera importa la memoria de los perfiles.
//
// Las acciones que cambian cosas (rol, sesiones, suspensión) se validan acá y quedan en la bitácora. Solo las
// atiende el servidor a quien YA se autenticó como Ikaros con Google; el modelo de lenguaje no puede invocarlas.
// ============================================================

import { readdir, stat } from "fs/promises";
import { join } from "path";
import type { AccountStore } from "./AccountStore.js";
import type { AuditLog } from "./AuditLog.js";
import type { Role } from "./RoleSystem.js";

export interface RoleAPI {
  getRole(profileId: string): Promise<Role>;
  /** Asigna 'ikaros', o quita el rol especial si es 'eris'. */
  setRole(profileId: string, role: Role): Promise<void>;
}

export interface AdminDeps {
  store: AccountStore;
  profilesDir: string;
  roles: RoleAPI;
  audit: AuditLog;
  /** Conexiones abiertas ahora de ese perfil. */
  online: (profileId: string) => number;
}

export interface AdminProfileRow {
  profileId: string;
  /** google = ligado a una cuenta de Google; legacy = perfil anterior (ID+PIN) que nadie ha vinculado aún */
  kind: "google" | "legacy";
  email?: string;
  name?: string;
  role: Role;
  createdAt?: string;
  lastLoginAt?: string;
  activeSessions: number;
  online: number;
  sizeBytes: number;
  files: number;
  /** Última modificación de cualquiera de sus archivos (≈ última actividad; sin leer nada). */
  lastActivityAt?: string;
  disabled?: boolean;
  /** Últimos 7 días, de la bitácora. */
  stats: { tools: number; approved: number; denied: number; blocked: number; logins: number };
}

export interface AdminResult { ok: boolean; message: string }

const SAFE_ID = /^[a-z0-9._-]{1,64}$/;
const MAX_FILES_SCANNED = 3000;

async function scanDir(dir: string, depth = 0, acc = { size: 0, files: 0, mtime: 0 }): Promise<{ size: number; files: number; mtime: number }> {
  if (depth > 3 || acc.files > MAX_FILES_SCANNED) return acc;
  let names: string[] = [];
  try { names = await readdir(dir); } catch { return acc; }
  for (const n of names) {
    const p = join(dir, n);
    try {
      const st = await stat(p);
      if (st.isDirectory()) await scanDir(p, depth + 1, acc);
      else { acc.size += st.size; acc.files++; acc.mtime = Math.max(acc.mtime, st.mtimeMs); }
    } catch {}
  }
  return acc;
}

export class AdminService {
  constructor(private d: AdminDeps) {}

  async overview(): Promise<AdminProfileRow[]> {
    const { store, profilesDir, roles, audit, online } = this.d;
    const [accounts, sessions, stats] = await Promise.all([store.listAccounts(), store.listSessions(), audit.statsByProfile(7)]);

    const sessionCount = new Map<string, number>();
    for (const s of sessions) sessionCount.set(s.profileId, (sessionCount.get(s.profileId) ?? 0) + 1);

    let dirs: string[] = [];
    try { dirs = (await readdir(profilesDir, { withFileTypes: true })).filter((e) => e.isDirectory() && SAFE_ID.test(e.name)).map((e) => e.name); } catch {}

    const byProfile = new Map(accounts.map((a) => [a.profileId, a]));
    const ids = new Set<string>([...dirs, ...accounts.map((a) => a.profileId)]);

    const rows: AdminProfileRow[] = [];
    for (const id of ids) {
      const acct = byProfile.get(id);
      const sc = dirs.includes(id) ? await scanDir(join(profilesDir, id)) : { size: 0, files: 0, mtime: 0 };
      rows.push({
        profileId: id,
        kind: acct ? "google" : "legacy",
        email: acct?.email,
        name: acct?.name,
        role: await roles.getRole(id),
        createdAt: acct?.createdAt,
        lastLoginAt: acct?.lastLoginAt,
        activeSessions: sessionCount.get(id) ?? 0,
        online: online(id),
        sizeBytes: sc.size,
        files: sc.files,
        lastActivityAt: sc.mtime ? new Date(sc.mtime).toISOString() : undefined,
        disabled: acct?.disabled || undefined,
        stats: {
          tools: stats[id]?.tools ?? 0, approved: stats[id]?.approved ?? 0, denied: stats[id]?.denied ?? 0,
          blocked: stats[id]?.blocked ?? 0, logins: stats[id]?.logins ?? 0,
        },
      });
    }
    // Google primero (los que realmente pueden entrar), luego por actividad reciente
    rows.sort((a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "google" ? -1 : 1) ||
      String(b.lastLoginAt ?? b.lastActivityAt ?? "").localeCompare(String(a.lastLoginAt ?? a.lastActivityAt ?? "")));
    return rows;
  }

  private note(actor: string, detail: string, ok = true) {
    void this.d.audit.record({ event: "admin", profileId: actor, role: "ikaros", detail, ok });
  }

  private async requireAccount(target: string): Promise<{ email: string } | AdminResult> {
    if (!SAFE_ID.test(target)) return { ok: false, message: "Perfil inválido." };
    const hit = await this.d.store.findByProfile(target);
    if (!hit) return { ok: false, message: "Ese perfil no tiene cuenta de Google: no puede iniciar sesión, así que no hay nada que administrar." };
    return { email: hit.account.email };
  }

  /**
   * Validaciones de un cambio de rol, SIN aplicarlo. El servidor las corre antes de mostrar la tarjeta de aprobación
   * (no tiene sentido pedirle al administrador que apruebe algo que igual sería rechazado).
   */
  async checkSetRole(actor: string, target: string, role: Role): Promise<({ ok: true; email: string; current: Role; unchanged: boolean }) | AdminResult & { ok: false }> {
    if (role !== "ikaros" && role !== "eris") return { ok: false, message: "Rol inválido." };
    if (target === actor) return { ok: false, message: "No puedes cambiar tu propio rol (evita quedarte sin administrador)." };
    if (target === "ikaros") return { ok: false, message: "'ikaros' es un id reservado." };
    // Solo cuentas reales: un rol pre-asignado a un id sin dueño podría reclamarlo cualquiera que se registre con ese nombre
    const acct = await this.requireAccount(target);
    if (!("email" in acct)) return { ok: false, message: acct.message };
    const current = await this.d.roles.getRole(target);
    return { ok: true, email: acct.email, current, unchanged: current === role };
  }

  async setRole(actor: string, target: string, role: Role): Promise<AdminResult> {
    const c = await this.checkSetRole(actor, target, role);
    if (!c.ok) return c;
    if (c.unchanged) return { ok: true, message: `${target} ya tiene el rol ${role}.` };
    await this.d.roles.setRole(target, role);
    this.note(actor, `set_role ${target} (${c.email}): ${c.current} → ${role}`);
    return { ok: true, message: `${target} ahora es ${role}. Se reconecta solo para aplicarlo.` };
  }

  async revokeSessions(actor: string, target: string): Promise<AdminResult> {
    if (target === actor) return { ok: false, message: "Para cerrar tu propia sesión usa «Cerrar sesión» en Perfil." };
    const acct = await this.requireAccount(target);
    if (!("email" in acct)) return acct;
    const n = await this.d.store.revokeProfileSessions(target);
    this.note(actor, `revoke_sessions ${target} (${acct.email}): ${n} sesión(es)`);
    return { ok: true, message: n ? `Se cerraron ${n} sesión(es) de ${target}.` : `${target} no tenía sesiones abiertas.` };
  }

  async setDisabled(actor: string, target: string, disabled: boolean): Promise<AdminResult> {
    if (target === actor) return { ok: false, message: "No puedes suspender tu propia cuenta." };
    const acct = await this.requireAccount(target);
    if (!("email" in acct)) return acct;
    await this.d.store.setDisabled(target, disabled);
    if (disabled) await this.d.store.revokeProfileSessions(target);
    this.note(actor, `${disabled ? "suspend" : "unsuspend"} ${target} (${acct.email})`);
    return { ok: true, message: disabled ? `${target} quedó suspendido y sin sesiones.` : `${target} puede volver a iniciar sesión.` };
  }
}
