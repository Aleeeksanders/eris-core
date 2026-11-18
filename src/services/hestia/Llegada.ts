// ============================================================
// Hestia como JARVIS · L1 (2026-11-17): lo que pasa cuando el teléfono manda sus sensores (hestia_sensor, solo Ikaros):
//  1. el Altavoz guarda la lectura (audífonos, casa, «no molestar», llamada, modo dirigido) para decidir cuándo puede hablar;
//  2. Presencia ve si volviste a casa o te pusiste los audífonos en la mañana;
//  3. la bienvenida o el saludo se arman por código (la agenda del día, quién te escribió, el equipo) y van al Altavoz.
// Lo de afuera (la agenda, los mensajes, el perfil) llega por `deps`: así se prueba con datos inventados.
// ============================================================
import { cambiarEstado, leerEstado, type Limites } from "./Estado.js";
import { alCambiar, armarBienvenida, type EventoPresencia } from "./Presencia.js";
import { sensoresDe, type Altavoz } from "./Altavoz.js";
import type { Via } from "./Interrupciones.js";
import type { Medicion } from "./Equipo.js";
import { armarSaludo } from "../voz/Saludo.js";
import { tratoDe } from "../voz/Escaner.js";

export interface DepsLlegada {
  altavoz: Altavoz;
  /** la conexión que mandó los sensores */
  ws: any;
  ahora?: Date;
  perfil(): Promise<any>;
  /** sexo de Forge (h/m), para «Bienvenido/a» */
  sexo(): Promise<"h" | "m" | null>;
  /** la agenda del día (DayAgendaTool) */
  agenda(): Promise<string | null>;
  /** lo inmediato de AXS (MEMORY.md de la bóveda) */
  inmediatas(): Promise<string[]>;
  /** quién te escribió desde `desde` (ms): nombres, sin los textos */
  remitentesDesde(desde: number): Promise<string[]>;
  /** un aviso corto del equipo, si lo hay */
  equipo(): Promise<string | null>;
  /** el día del último saludo (el mismo de la primera llamada: voz_saludo_dia) */
  saludoDia: { get(): Promise<string | null>; set(dia: string): Promise<void> };
  /** L5: lo que hace el protocolo «casa» al llegar (lo de fondo que dejaste quieto sigue…): lo hecho, para sumarlo a la bienvenida */
  alLlegar?(): Promise<string | null>;
}

/** Un ojo al equipo para la bienvenida: lo que ya cruzó su umbral de aviso (lo más importante, uno solo) */
export function ojoEquipo(m: Medicion | null | undefined, l: Limites): string | null {
  if (!m) return null;
  if (m.gpu && l.gpuTempC.aviso != null && m.gpu.tempC > l.gpuTempC.aviso) return `Ojo: la tarjeta de video está a ${Math.round(m.gpu.tempC)} grados`;
  if (l.ramLibreGb.aviso != null && m.ramLibreGb < l.ramLibreGb.aviso) return `Ojo: al PC le queda poca RAM, ${(Math.round(m.ramLibreGb * 10) / 10).toLocaleString("es-CL")} GB libres`;
  if (m.discoLibreGb != null && l.discoLibreGb.aviso != null && m.discoLibreGb < l.discoLibreGb.aviso) return `Ojo con el disco: quedan ${Math.round(m.discoLibreGb)} GB`;
  if (m.bateria && !m.bateria.enchufado && l.bateriaPct.aviso != null && m.bateria.pct < l.bateriaPct.aviso) return `Ojo: el notebook está al ${Math.round(m.bateria.pct)} % y sin cargador`;
  return null;
}

export interface ResultadoLlegada { eventos: EventoPresencia[]; vias: Partial<Record<EventoPresencia, Via>> }

export async function procesarSensores(raw: unknown, d: DepsLlegada): Promise<ResultadoLlegada | null> {
  const ahora = d.ahora ?? new Date();
  const s = sensoresDe(raw, ahora.getTime());
  if (!s) return null;
  const antes = d.altavoz.actualizar(s, d.ws);
  const e = await leerEstado();
  const fueraDesde = e.presencia.fueraDesde ? Date.parse(e.presencia.fueraDesde) : null;
  const r = alCambiar(e.presencia, antes, s, ahora);
  if (JSON.stringify(r.presencia) !== JSON.stringify(e.presencia)) await cambiarEstado((x) => { x.presencia = r.presencia; });
  const vias: ResultadoLlegada["vias"] = {};

  for (const ev of r.eventos) {
    if (ev === "bienvenida") {
      const [perfil, sexo, agenda, rem, eq] = await Promise.all([
        d.perfil().catch(() => null), d.sexo().catch(() => null), d.agenda().catch(() => null),
        fueraDesde ? d.remitentesDesde(fueraDesde).catch(() => [] as string[]) : Promise.resolve([] as string[]), d.equipo().catch(() => null),
      ]);
      const mujer = sexo === "m";
      const extra = d.alLlegar ? await d.alLlegar().catch(() => null) : null;
      const texto = [armarBienvenida({ trato: tratoDe(perfil), mujer, ahora, agenda, remitentes: rem, equipo: eq }), extra].filter(Boolean).join(" ");
      vias.bienvenida = await d.altavoz.avisar({ clave: "bienvenida", tipo: "bienvenida", prioridad: "normal", titulo: mujer ? "Bienvenida a casa" : "Bienvenido a casa", texto }, ahora);
    }
    if (ev === "saludo_audifonos") {
      const hoy = ahora.toDateString();
      if ((await d.saludoDia.get().catch(() => null)) === hoy) continue;
      const aviso = { clave: `saludo-${hoy}`, tipo: "saludo" as const, prioridad: "normal" as const, titulo: "Buenos días" };
      // (en una llamada con ella, el saludo lo da la llamada; sin poder hablar, el de la mañana no se escribe: sería ruido)
      if ((await d.altavoz.previa({ ...aviso, texto: "" }, ahora)) !== "voz") continue;
      const [perfil, agenda, inmediatas] = await Promise.all([d.perfil().catch(() => null), d.agenda().catch(() => null), d.inmediatas().catch(() => [] as string[])]);
      const texto = armarSaludo({ nombre: tratoDe(perfil) ?? perfil?.displayName ?? null, ahora, agenda, inmediatas });
      const via = await d.altavoz.avisar({ ...aviso, texto, soloVoz: true }, ahora);
      vias.saludo_audifonos = via;
      if (via === "voz") {
        await d.saludoDia.set(hoy).catch(() => {});
        await cambiarEstado((x) => { x.presencia.saludoAudifonos = hoy; });
      }
    }
  }
  return { eventos: r.eventos, vias };
}
