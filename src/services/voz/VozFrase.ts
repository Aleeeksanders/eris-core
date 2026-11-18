// ============================================================
// Hestia como JARVIS · L6 (2026-11-18): en la llamada, solo tu voz, frase por frase. Con cada frase, Eris manda lo que Hestia
// Manos dijo del audio de ESA frase (VozPropia.frase: el clasificador de tus frases, aprendido en el teléfono con tus «Hestia» y
// trozos de tu habla). Con una frase entera acierta mucho más que con la sola palabra al despertar (K5): en el PC
// (entrenamiento/voz_frase.py), tus frases pasan como tuyas el 98–100 % y ninguna de 814 frases de 27 hombres que no vio.
//  - «tuya»: sobre el umbral alto (nadie más pasó en el PC);
//  - «otra»: bajo el umbral bajo (ahí cae ~1 de cada 1.000 frases tuyas y el 96 % de las de otros; la voz de Hestia, toda);
//  - «dudosa» (entre medio), «corta» (menos de medio segundo con voz: «sí», «no»), «sin» (no se pudo revisar: Hestia Manos vieja,
//    falta aprender, el reconocimiento en otra forma).
// Qué se hace, por código (nunca el modelo):
//  - «Solo tu voz» (en el panel; encendido de fábrica): lo que dice otra voz no se toma («(otra voz)» en la pantalla).
//  - Otra voz nunca contesta una aprobación (aunque «solo tu voz» esté apagado).
//  - Con el teléfono bloqueado, el nivel «tu voz» (K5) se revisa EN CADA FRASE: vale si esa frase es tuya; una corta («sí»,
//    «dale»), si hace menos de 60 s hubo una tuya y ninguna otra voz entre medio. Si no se puede revisar, sigue lo de K5.
// ============================================================

export type ClaseVoz = "tuya" | "dudosa" | "otra" | "corta" | "sin";
export const CLASES_VOZ: readonly ClaseVoz[] = ["tuya", "dudosa", "otra", "corta", "sin"];

export interface VozDeFrase { clase: ClaseVoz; puntaje: number | null; ms: number | null }

/** Lo que mandó la app con la frase (`voz_turno.voz`), revisado */
export function vozDeTurno(raw: unknown): VozDeFrase | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const clase = CLASES_VOZ.includes(r.clase as ClaseVoz) ? (r.clase as ClaseVoz) : null;
  if (!clase) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  return { clase, puntaje: num(r.puntaje), ms: num(r.ms) };
}

/** Lo de esta llamada: cuándo fue la última frase tuya y cuántas de cada una */
export interface EstadoVoz { ultimaTuya: number | null; cuenta: Record<ClaseVoz, number> }

/** `tuVozInicio`: K5 reconoció tu voz al despertar con «Hestia» (cuenta como una frase tuya en ese momento) */
export function nuevoEstadoVoz(tuVozInicio: boolean, ahora: number): EstadoVoz {
  return { ultimaTuya: tuVozInicio ? ahora : null, cuenta: { tuya: 0, dudosa: 0, otra: 0, corta: 0, sin: 0 } };
}

/** Una frase corta vale como tuya hasta este tiempo después de la última tuya (sin otra voz entre medio) */
export const CONTINUIDAD_MS = 60_000;

export interface DecisionVoz {
  /** ¿se toma la frase? (false = «(otra voz)») */
  tomar: boolean;
  /** con el teléfono bloqueado, ¿vale como tu voz? */
  tuVoz: boolean;
  /** ¿se pudo revisar? (false = sin revisión: vale lo de K5) */
  revisada: boolean;
  /** por qué no se tomó */
  motivo?: "otra_voz";
}

/**
 * Qué se hace con la frase. `soloTuya`: el interruptor del panel. `tuVozInicio`: K5 al despertar. `aprobando`: Hestia espera un
 * «sí» o un «no» a una aprobación (otra voz nunca la contesta).
 */
export function decidirFrase(v: VozDeFrase | null, est: EstadoVoz,
  o: { soloTuya: boolean; tuVozInicio: boolean; ahora: number; aprobando?: boolean }): DecisionVoz {
  const clase: ClaseVoz = v?.clase ?? "sin";
  est.cuenta[clase]++;
  switch (clase) {
    case "sin":
      return { tomar: true, tuVoz: o.tuVozInicio, revisada: false };
    case "tuya":
      est.ultimaTuya = o.ahora;
      return { tomar: true, tuVoz: true, revisada: true };
    case "otra":
      est.ultimaTuya = null; // (lo que siga corto ya no se apoya en la tuya de antes)
      return o.soloTuya || o.aprobando ? { tomar: false, tuVoz: false, revisada: true, motivo: "otra_voz" } : { tomar: true, tuVoz: false, revisada: true };
    case "corta": {
      const sigue = est.ultimaTuya != null && o.ahora - est.ultimaTuya <= CONTINUIDAD_MS;
      return { tomar: true, tuVoz: sigue, revisada: true };
    }
    default: // dudosa
      return { tomar: true, tuVoz: false, revisada: true };
  }
}

/** Bloqueado, la frase no se reconoció como tuya pero lo pedido valdría con tu voz: se dice eso (y que lo repita o desbloquee) */
export function textoNoSegura(trato?: string | null): string {
  return `No estoy segura de que seas tú${trato ? `, ${trato}` : ""}: dilo de nuevo, o desbloquea el teléfono y sigo.`;
}

/** «12 frases: 9 tuyas, 2 dudosas y 1 de otra voz» (para el panel) */
export function resumenVoz(c: Record<ClaseVoz, number>): string {
  const revisadas = c.tuya + c.dudosa + c.otra + c.corta;
  const total = revisadas + c.sin;
  if (!total) return "Sin frases.";
  if (!revisadas) return `${total} ${total === 1 ? "frase" : "frases"}, sin revisar tu voz.`;
  const partes = [
    c.tuya ? `${c.tuya} ${c.tuya === 1 ? "tuya" : "tuyas"}` : "",
    c.dudosa ? `${c.dudosa} ${c.dudosa === 1 ? "dudosa" : "dudosas"}` : "",
    c.corta ? `${c.corta} ${c.corta === 1 ? "corta" : "cortas"}` : "",
    c.otra ? `${c.otra} de otra voz` : "",
    c.sin ? `${c.sin} sin revisar` : "",
  ].filter(Boolean);
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}` : partes[0];
  return `${total} ${total === 1 ? "frase" : "frases"}: ${lista}.`;
}
