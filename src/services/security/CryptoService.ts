import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';

export interface KeyMaterial {
  encryptedMK_PIN: string;
  encryptedMK_RK: string;
}

export class CryptoService {
  private masterKey: Buffer | null = null;
  private readonly salt = "eris-sovereign-zero-knowledge-salt";

  constructor() {}

  /**
   * Inicializa un nuevo perfil generando una Llave Maestra (MK) aleatoria.
   * Cifra la MK usando el PIN y usando una Llave de Recuperación generada.
   * @returns { keyMaterial, recoveryKey }
   */
  initNewProfile(pin: string): { keyMaterial: KeyMaterial; recoveryKey: string } {
    this.masterKey = randomBytes(32);
    
    // Derivar llave del PIN
    const pinKey = scryptSync(pin, this.salt, 32);
    const encryptedMK_PIN = this._encryptBuffer(this.masterKey, pinKey);

    // Generar Recovery Key (RK) - Formato seguro: XXXX-XXXX-XXXX
    const rkRaw = randomBytes(6).toString('hex').toUpperCase();
    const recoveryKey = `${rkRaw.slice(0,4)}-${rkRaw.slice(4,8)}-${rkRaw.slice(8,12)}`;
    
    const rkKey = scryptSync(recoveryKey, this.salt, 32);
    const encryptedMK_RK = this._encryptBuffer(this.masterKey, rkKey);

    return {
      keyMaterial: { encryptedMK_PIN, encryptedMK_RK },
      recoveryKey
    };
  }

  /**
   * Desbloquea la Llave Maestra usando el PIN o la Llave de Recuperación.
   */
  unlock(credential: string, keyMaterial: KeyMaterial): boolean {
    const key = scryptSync(credential, this.salt, 32);
    
    // Intentar como PIN
    try {
      this.masterKey = this._decryptBuffer(keyMaterial.encryptedMK_PIN, key);
      return true;
    } catch {}

    // Intentar como Recovery Key
    try {
      this.masterKey = this._decryptBuffer(keyMaterial.encryptedMK_RK, key);
      return true;
    } catch {}

    return false;
  }

  /**
   * Cambia el PIN y devuelve el nuevo KeyMaterial (requiere estar desbloqueado)
   */
  changePin(newPin: string, oldKeyMaterial: KeyMaterial): KeyMaterial {
    if (!this.masterKey) throw new Error("Debe desbloquear el perfil primero");
    const pinKey = scryptSync(newPin, this.salt, 32);
    return {
      encryptedMK_PIN: this._encryptBuffer(this.masterKey, pinKey),
      encryptedMK_RK: oldKeyMaterial.encryptedMK_RK // La llave de recuperación no cambia
    };
  }

  // --- Funciones para cifrar DATOS usando la Master Key ---

  encrypt(text: string): string {
    if (!this.masterKey) return text; 
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt(encryptedText: string): string {
    const t = encryptedText.trim();
    if (t.startsWith('{') || t.startsWith('[')) return t; 
    if (!this.masterKey) throw new Error('Perfil bloqueado. Se requiere PIN o Llave de Recuperación.');

    try {
      const parts = t.split(':');
      if (parts.length !== 3) throw new Error('Formato inválido');
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];
      
      const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (e) {
      throw new Error('Fallo de descifrado (datos corruptos).');
    }
  }

  // Helpers
  private _encryptBuffer(data: Buffer, key: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(data).toString('hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private _decryptBuffer(encryptedHex: string, key: Buffer): Buffer {
    const parts = encryptedHex.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(parts[2], 'hex');
    const final = decipher.final();
    return Buffer.concat([decrypted, final]);
  }
}
