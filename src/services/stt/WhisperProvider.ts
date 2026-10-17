// ============================================================
// Eris — Whisper Local Provider (STT)
// Transcripción de voz vía whisper-server (whisper.cpp en modo HTTP),
// corriendo como proceso local externo — mismo patrón que Ollama:
// un binario/servicio local al que el backend le pega por HTTP, nada
// de audio sale de la máquina.
// ============================================================

export interface TranscribeResult {
  text: string;
}

export class WhisperProvider {
  private baseUrl: string;

  constructor(baseUrl = "http://localhost:8081") {
    this.baseUrl = baseUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/`, { signal: AbortSignal.timeout(3000) });
      // whisper-server responde con su UI HTML en "/" incluso sin audio —
      // cualquier respuesta (2xx-4xx) confirma que el proceso está vivo.
      return res.status < 500;
    } catch {
      return false;
    }
  }

  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<TranscribeResult> {
    const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp3") ? "mp3" : "m4a";
    const form = new FormData();
    form.append("file", new Blob([audioBuffer as unknown as BlobPart], { type: mimeType }), `audio.${ext}`);
    form.append("response_format", "json");

    const res = await fetch(`${this.baseUrl}/inference`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`whisper-server HTTP ${res.status}: ${errorText}`);
    }

    const data = (await res.json()) as any;
    return { text: data.text || "" };
  }

  /**
   * Con contexto (`prompt`: vocabulario y lo último de la conversación, ver stt/VoiceFix.ts) y con la probabilidad de
   * cada palabra (verbose_json), para corregir solo lo que Whisper mismo oyó con duda.
   */
  async transcribeVerbose(audioBuffer: Buffer, mimeType: string, prompt = ""): Promise<any> {
    const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp3") ? "mp3" : "m4a";
    const form = new FormData();
    form.append("file", new Blob([audioBuffer as unknown as BlobPart], { type: mimeType }), `audio.${ext}`);
    form.append("response_format", "verbose_json");
    // Sin esto verbose_json corre la detección de idioma (otra pasada completa): 5,9 s en vez de 3,3 s por frase
    form.append("no_language_probabilities", "true");
    if (prompt) form.append("prompt", prompt);
    const res = await fetch(`${this.baseUrl}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(60000) });
    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`whisper-server HTTP ${res.status}: ${errorText}`);
    }
    return res.json();
  }
}
