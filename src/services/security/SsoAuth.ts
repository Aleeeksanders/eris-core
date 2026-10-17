// ============================================================
// Eris — Inicio de sesión con Google (SSO): de qué cuenta eres → a qué perfil entras
//
//  auth_google   { idToken, link?, forceNew? }   primera vez o sesión perdida: el servidor verifica con Google
//  auth_session  { token }                        reconexiones: token de sesión al azar (no vuelve a pasar por Google)
//
// Perfiles que ya existían (creados con ID + PIN): la PRIMERA vez el celular manda ese PIN (o la llave de recuperación)
// como `link`; el servidor lo verifica UNA vez, re-cifra el perfil con su llave interna y lo liga a tu cuenta de Google.
// Desde ahí el PIN viejo ya no abre nada (nadie más puede entrar por ahí).
// ============================================================

import { access, readFile, writeFile } from "fs/promises";
import { join } from "path";
import * as os from "os";
import { CryptoService } from "./CryptoService.js";
import { authRateLimiter } from "./AuthRateLimiter.js";
import { accountStore, type AccountStore } from "./AccountStore.js";
import { verifyGoogleIdToken, type GoogleVerifier } from "./GoogleAuth.js";
import { roleManager } from "./RoleManager.js";

const PROFILES_DIR = join(os.homedir(), ".eris", "profiles");
/** Ids que nadie puede reclamar con Google (el rol y la PIN de administración de 'ikaros' se manejan aparte). */
const RESERVED_IDS = new Set(["ikaros", "default", "admin", "root", "system", "eris"]);

export class SsoError extends Error {
  constructor(message: string, public code: "invalid_token" | "session_expired" | "link_required" | "link_failed" | "reserved" | "forbidden" | "account_disabled" = "forbidden", public extra?: Record<string, unknown>) {
    super(message);
  }
}

export interface SsoRequest {
  type: "auth_google" | "auth_session";
  idToken?: string;
  token?: string;
  link?: { profileId: string; pin: string };
  /** Ignorar cualquier perfil anterior y crear uno nuevo (el usuario lo eligió a propósito). */
  forceNew?: boolean;
}

export interface SsoResult {
  profileId: string;
  /** Llave interna con la que el servidor abre el perfil. NUNCA se manda al celular. */
  pin: string;
  /** Token de sesión para reconexiones. Solo viene cuando se acaba de iniciar con Google. */
  sessionToken?: string;
  isNew: boolean;
  email?: string;
}

export interface SsoDeps {
  store: AccountStore;
  verify: GoogleVerifier;
  profilesDir: string;
  /** ¿Ese id ya está "reservado" por otra vía (p. ej. ya tiene un rol en roles.json)? Nadie puede reclamarlo. */
  isTaken?: (profileId: string) => Promise<boolean>;
}

const defaultDeps = (): SsoDeps => ({
  store: accountStore, verify: verifyGoogleIdToken, profilesDir: PROFILES_DIR,
  isTaken: (id) => roleManager.hasAssignment(id),
});

export const isSafeProfileId = (id: string) => /^[a-z0-9._-]{1,64}$/.test(id) && id !== "." && id !== "..";

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

/** Alias de perfil a partir del correo: solo la parte antes de @, limpia y sin chocar con perfiles existentes. */
export async function freshProfileId(email: string, profilesDir: string, store?: AccountStore, isTaken?: (id: string) => Promise<boolean>): Promise<string> {
  let base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+/, "").slice(0, 40);
  if (base.length < 3 || RESERVED_IDS.has(base)) base = `usuario${base}`.slice(0, 40);
  let id = base, n = 2;
  // También cuenta lo ya ligado a una cuenta aunque su carpeta aún no exista (dos altas casi simultáneas),
  // y los ids que ya tienen un rol asignado (si no, registrarse con ese nombre daría los privilegios de ese rol)
  while (
    RESERVED_IDS.has(id) || await exists(join(profilesDir, id)) ||
    (store && await store.findByProfile(id)) || (isTaken && await isTaken(id))
  ) id = `${base}-${n++}`;
  return id;
}

/** Perfil anterior (ID + PIN) que coincide con el correo, si lo hay y nadie lo ha ligado. Sirve para ofrecer vincularlo. */
async function legacyCandidate(email: string, deps: SsoDeps): Promise<string | null> {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (!isSafeProfileId(base) || RESERVED_IDS.has(base)) return null;
  if (!(await exists(join(deps.profilesDir, base, "key.json")))) return null;
  return (await deps.store.findByProfile(base)) ? null : base;
}

async function linkLegacy(link: { profileId: string; pin: string }, deps: SsoDeps): Promise<string> {
  const profileId = String(link.profileId || "").toLowerCase();
  if (!isSafeProfileId(profileId) || RESERVED_IDS.has(profileId)) throw new SsoError("Ese perfil no se puede vincular.", "reserved");
  const keyFile = join(deps.profilesDir, profileId, "key.json");
  if (!(await exists(keyFile))) throw new SsoError("No encontré ese perfil.", "link_failed");
  if (await deps.store.findByProfile(profileId)) throw new SsoError("Ese perfil ya pertenece a otra cuenta de Google.", "forbidden");

  const rate = await authRateLimiter.check(profileId, false);
  if (!rate.allowed) throw new SsoError(rate.message || "Demasiados intentos. Espera un rato.", "link_failed");

  const km = JSON.parse(await readFile(keyFile, "utf-8"));
  const crypto = new CryptoService();
  if (!crypto.unlock(String(link.pin || "").trim().toUpperCase(), km) && !crypto.unlock(String(link.pin || "").trim(), km)) {
    await authRateLimiter.recordFailure(profileId);
    throw new SsoError("El PIN o la llave de recuperación no coincide con ese perfil.", "link_failed");
  }
  await authRateLimiter.reset(profileId);
  // Re-cifrar con la llave del servidor: desde ahora el PIN viejo ya no abre este perfil.
  const nkm = crypto.changePin(await deps.store.derivePin(profileId), km);
  await writeFile(keyFile, JSON.stringify(nkm), "utf-8");
  return profileId;
}

export async function resolveSso(req: SsoRequest, deps: SsoDeps = defaultDeps()): Promise<SsoResult> {
  const { store } = deps;

  // ── Reconexión con token de sesión ──
  if (req.type === "auth_session") {
    const s = await store.resolveSession(String(req.token || ""));
    const acct = s ? await store.findBySub(s.sub) : undefined;
    if (!s || !acct || acct.profileId !== s.profileId) throw new SsoError("Tu sesión venció. Inicia sesión con Google.", "session_expired");
    if (acct.disabled) throw new SsoError("Esta cuenta está suspendida por el administrador.", "account_disabled");
    await store.touch(s.sub);
    return { profileId: s.profileId, pin: await store.derivePin(s.profileId), isNew: false, email: acct.email };
  }

  // ── Inicio con Google ──
  let identity;
  try { identity = await deps.verify(String(req.idToken || "")); }
  catch (e: any) { throw new SsoError(e?.message || "Token de Google inválido.", "invalid_token"); }

  let acct = await store.findBySub(identity.sub);
  let isNew = false;
  if (acct?.disabled) throw new SsoError("Esta cuenta está suspendida por el administrador.", "account_disabled");

  if (!acct) {
    let profileId: string;
    if (req.link && !req.forceNew) {
      profileId = await linkLegacy(req.link, deps);
    } else {
      if (!req.forceNew) {
        // ¿Hay un perfil anterior con este alias sin dueño? Antes de crear uno vacío se lo ofrecemos (evita "perdí mis datos").
        const candidate = await legacyCandidate(identity.email, deps);
        if (candidate) throw new SsoError("Encontré un perfil anterior con tu nombre. Vincúlalo con su PIN o crea uno nuevo.", "link_required", { candidate });
      }
      profileId = await freshProfileId(identity.email, deps.profilesDir, store, deps.isTaken);
      isNew = true;
    }
    acct = await store.bind(identity.sub, profileId, identity.email, identity.name);
  } else {
    await store.touch(identity.sub);
  }

  const sessionToken = await store.createSession(identity.sub, acct.profileId);
  return { profileId: acct.profileId, pin: await store.derivePin(acct.profileId), sessionToken, isNew, email: identity.email };
}
