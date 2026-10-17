// ============================================================
// Eris — Piper Provider (TTS)
// Voz de respuesta vía Piper (motor neuronal local, corre como servicio
// HTTP por voz — mismo patrón que Ollama/Whisper: proceso local externo,
// el backend le pega por HTTP, nada de texto sale de la máquina.
// ============================================================

export type PiperVoiceId = "daniela";

interface VoiceConfig {
  port: number;
  label: string;
}

// Eris es la diosa del caos — una sola voz, femenina, sin selector.
// (Se probó agregar una segunda voz en español mexicano ["claude"] pero
// sonaba masculina y no encajaba con el personaje — se descartó.)
const VOICES: Record<PiperVoiceId, VoiceConfig> = {
  daniela: { port: 5001, label: "Daniela (Argentina)" },
};

// Un poco más de vida sin cambiar de voz ni de motor: Piper no tiene "modos" de ánimo (no es un motor
// expresivo), pero acepta estos tres parámetros por síntesis. Valores por defecto de Daniela: length_scale=1,
// noise_scale=0.667, noise_w=0.8 (ver piper/voices/es_AR-daniela-high.onnx.json). Bajar length_scale la hace
// hablar un poco más rápido/con más energía; subir noise_scale/noise_w le da algo más de variación natural
// (menos plana). Ajustable por env sin tocar código si hace falta afinar más.
const LENGTH_SCALE = Number(process.env.ERIS_TTS_LENGTH_SCALE) || 0.92;
const NOISE_SCALE = Number(process.env.ERIS_TTS_NOISE_SCALE) || 0.75;
const NOISE_W_SCALE = Number(process.env.ERIS_TTS_NOISE_W_SCALE) || 0.9;

export class PiperProvider {
  private host: string;

  constructor(host = "http://localhost") {
    this.host = host;
  }

  async isAvailable(voice: PiperVoiceId = "daniela"): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}:${VOICES[voice].port}/`, { signal: AbortSignal.timeout(3000) });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async synthesize(text: string, voice: PiperVoiceId): Promise<Buffer> {
    const cfg = VOICES[voice];
    if (!cfg) throw new Error(`Voz de Piper desconocida: ${voice}`);

    const res = await fetch(`${this.host}:${cfg.port}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        length_scale: LENGTH_SCALE,
        noise_scale: NOISE_SCALE,
        noise_w_scale: NOISE_W_SCALE,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`Piper HTTP ${res.status} (${cfg.label}): ${errorText}`);
    }

    return Buffer.from(await res.arrayBuffer());
  }
}
