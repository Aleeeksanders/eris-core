// ============================================================
// AuthRateLimiter — Límite de intentos fallidos de autenticación
// Persiste en ~/.eris/profiles/<id>/security.json
// ============================================================

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import * as os from 'os';

interface SecurityRecord {
  failedAttempts: number;
  lastFailAt: string | null;
  lockedUntil: string | null;
}

const MAX_PIN_ATTEMPTS = 10;          // Intentos de PIN antes de bloqueo
const MAX_RECOVERY_ATTEMPTS = 5;      // Intentos de Recovery Key antes de bloqueo
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutos de bloqueo
const WINDOW_MS = 60 * 60 * 1000;    // Ventana de 1 hora

class AuthRateLimiter {
  private getSecurityFile(profileId: string): string {
    return join(os.homedir(), '.eris', 'profiles', profileId, 'security.json');
  }

  private async load(profileId: string): Promise<SecurityRecord> {
    try {
      const raw = await readFile(this.getSecurityFile(profileId), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { failedAttempts: 0, lastFailAt: null, lockedUntil: null };
    }
  }

  private async save(profileId: string, record: SecurityRecord): Promise<void> {
    const dir = join(os.homedir(), '.eris', 'profiles', profileId);
    await mkdir(dir, { recursive: true });
    await writeFile(this.getSecurityFile(profileId), JSON.stringify(record, null, 2), 'utf-8');
  }

  /**
   * Verificar si el perfil está bloqueado.
   * @returns null si puede intentar, o mensaje de error si está bloqueado.
   */
  async check(profileId: string, isRecoveryKey: boolean): Promise<{ allowed: boolean; message?: string; remainingMs?: number }> {
    const record = await this.load(profileId);
    const now = Date.now();

    // Verificar bloqueo activo
    if (record.lockedUntil) {
      const lockedUntil = new Date(record.lockedUntil).getTime();
      if (now < lockedUntil) {
        const remainingMs = lockedUntil - now;
        const remainingMin = Math.ceil(remainingMs / 60000);
        return {
          allowed: false,
          message: `Perfil bloqueado por demasiados intentos fallidos. Intenta en ${remainingMin} minuto${remainingMin !== 1 ? 's' : ''}.`,
          remainingMs,
        };
      } else {
        // Bloqueo expirado — resetear
        await this.reset(profileId);
        return { allowed: true };
      }
    }

    // Resetear contador si la ventana de tiempo pasó
    if (record.lastFailAt) {
      const lastFail = new Date(record.lastFailAt).getTime();
      if (now - lastFail > WINDOW_MS) {
        await this.reset(profileId);
        return { allowed: true };
      }
    }

    const maxAttempts = isRecoveryKey ? MAX_RECOVERY_ATTEMPTS : MAX_PIN_ATTEMPTS;
    if (record.failedAttempts >= maxAttempts) {
      // Bloquear
      const lockedUntil = new Date(now + LOCK_DURATION_MS).toISOString();
      await this.save(profileId, { ...record, lockedUntil });
      return {
        allowed: false,
        message: `Demasiados intentos fallidos. Perfil bloqueado por 15 minutos.`,
        remainingMs: LOCK_DURATION_MS,
      };
    }

    return { allowed: true };
  }

  /**
   * Registrar un intento fallido.
   */
  async recordFailure(profileId: string): Promise<void> {
    const record = await this.load(profileId);
    const updated: SecurityRecord = {
      failedAttempts: record.failedAttempts + 1,
      lastFailAt: new Date().toISOString(),
      lockedUntil: record.lockedUntil,
    };

    const maxAttempts = Math.max(MAX_PIN_ATTEMPTS, MAX_RECOVERY_ATTEMPTS);
    if (updated.failedAttempts >= maxAttempts) {
      updated.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
    }

    await this.save(profileId, updated);
  }

  /**
   * Resetear contador tras autenticación exitosa.
   */
  async reset(profileId: string): Promise<void> {
    await this.save(profileId, { failedAttempts: 0, lastFailAt: null, lockedUntil: null });
  }
}

export const authRateLimiter = new AuthRateLimiter();
