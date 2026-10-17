// ============================================================
// Eris — Verificación de la identidad de Google (lado servidor)
//
// Antes, "entrar con Google" solo pasaba por el celular: el servidor nunca veía a Google, así que cualquiera que
// hablara directo con el servidor se saltaba el SSO. Ahora el celular manda el ID token de Google y el SERVIDOR
// lo verifica con Google antes de dejar pasar a nadie.
//
// Se usa el endpoint `tokeninfo` de Google (valida firma y vencimiento por nosotros). Además se exige:
//   · aud = el Web Client ID de la app (un token de OTRA app de Google no sirve)
//   · iss = Google
//   · email verificado
// ============================================================

/** Web Client ID de la app (el mismo con que el celular pide el token). Es público. */
const DEFAULT_CLIENT_ID = "860030727214-nqc6sm8o3v1fl5d2l2h63932an47r6dv.apps.googleusercontent.com";

export interface GoogleIdentity {
  /** Id estable de la cuenta de Google. Es lo que se liga al perfil (el correo puede cambiar). */
  sub: string;
  email: string;
  name?: string;
}

export function allowedAudiences(): string[] {
  const fromEnv = (process.env.GOOGLE_CLIENT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : [DEFAULT_CLIENT_ID];
}

/** Comprueba los campos de la respuesta de Google. Separado para poder probarlo sin red. */
export function checkTokenInfo(info: any, now = Date.now()): GoogleIdentity {
  if (!info || typeof info !== "object") throw new Error("Token de Google inválido.");
  if (!allowedAudiences().includes(String(info.aud))) throw new Error("El token no fue emitido para esta app.");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(String(info.iss))) throw new Error("Emisor del token inválido.");
  if (!(Number(info.exp) * 1000 > now)) throw new Error("El token de Google venció. Vuelve a iniciar sesión.");
  if (String(info.email_verified) !== "true") throw new Error("Tu correo de Google no está verificado.");
  if (!info.sub || !info.email) throw new Error("El token no trae la identidad de la cuenta.");
  return { sub: String(info.sub), email: String(info.email).toLowerCase(), name: info.name ? String(info.name) : undefined };
}

/** Sustituible en pruebas: (idToken) → identidad verificada. */
export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity>;

export const verifyGoogleIdToken: GoogleVerifier = async (idToken) => {
  if (typeof idToken !== "string" || idToken.length < 100 || idToken.length > 4096 || idToken.split(".").length !== 3) {
    throw new Error("Token de Google inválido.");
  }
  let res: Response;
  try {
    res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Error("No pude verificar tu cuenta con Google (sin conexión desde el servidor).");
  }
  if (!res.ok) throw new Error("Google rechazó el token. Vuelve a iniciar sesión.");
  return checkTokenInfo(await res.json());
};
