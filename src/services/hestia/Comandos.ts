// ============================================================
// Hestia como JARVIS · L0 (2026-11-17): lo que se le dice a Hestia sobre ella y el equipo, por código (al instante, sin el
// modelo, y funciona aunque esté en pausa): «estado de los sistemas», «¿cómo está el PC?», «pausa», «pausa por 30 minutos»,
// «reanuda». Lo usan el chat de AXS y la llamada. Solo Hestia (lo llama el servidor solo para ikaros en Modo AXS).
// ============================================================
import { agregarImportante, clavePersona, leerEstado, pausaVigente, pausar, quitarImportante, reanudar, type EstadoHestia, type Pausa, type QuienPausa } from "./Estado.js";
import { pideImportantes } from "./Avisos.js";
import { agregarTrabajo, cancelarTrabajos, leerTrabajos, pideTrabajo, queEs, textoEstado, COMPILADORES, VIGIA_HORAS } from "./Trabajos.js";
import { medir, type Medicion } from "./Equipo.js";
import { ultimaMedicion } from "./Vigia.js";

const fold = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;:«»"]+/g, " ").replace(/\s+/g, " ").trim()
  .replace(/^(?:(?:oye|ok|okey|hey|ya|hola) )?(?:hestia|eris) /, "");

const ESTADO = /\b(estado de (los |tus )?sistemas|como (estan|andan|van) (los |tus )?sistemas|(como|que tal) (esta|anda|va) (el |mi )?(pc|equipo|computador|notebook|servidor)|diagnostico( del (pc|equipo|sistema))?|informe del (pc|equipo|sistema)|reporte del (pc|equipo|sistema)|chequeo del (pc|equipo)|revisa(me)? el (pc|equipo)|como esta(s)? de (ram|memoria|disco))\b/;
const PAUSA = /^(?:(?:te |)pausa(?:te)?|ponte en pausa|pausar(?: a)? hestia|pausa hestia|descansa(?: un rato)?|toma(?:te)? una pausa)(?: (?:por|durante|unos?|una) (\d{1,3}|una|un|media|dos|tres|cinco|diez|quince|veinte|treinta) (minutos?|mins?|horas?|hrs?|h))?$/;
const REANUDA = /^(?:reanuda(?:te)?|vuelve|despierta|sal de la pausa|quita(?:te)? la pausa|ya puedes seguir|continua|sigue activa|activate|vuelve a funcionar)$/;
const NUM: Record<string, number> = { una: 1, un: 1, media: 0.5, dos: 2, tres: 3, cinco: 5, diez: 10, quince: 15, veinte: 20, treinta: 30 };

export function pideEstadoSistemas(texto: string): boolean { const t = fold(texto); return t.length <= 90 && ESTADO.test(t); }
/** «pausa» → {minutos: null}; «pausa por 30 minutos» → {minutos: 30}; null si no es eso */
export function pidePausa(texto: string): { minutos: number | null } | null {
  const m = PAUSA.exec(fold(texto));
  if (!m) return null;
  // «pausa» a secas es la música (TelefonoParse); para Hestia: con su nombre («Hestia, pausa»), «ponte en pausa» o con tiempo
  const conNombre = /^\s*(?:(?:oye|ok|okey|hey|ya|hola)[\s,]+)?(?:hestia|eris)\b/i.test(String(texto ?? ""));
  if (/^pausa$/.test(fold(texto)) && !conNombre) return null;
  if (!m[1]) return { minutos: null };
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1]] ?? 1;
  return { minutos: Math.max(1, Math.round(/^h/.test(m[2]) ? n * 60 : n)) };
}
export function pideReanudar(texto: string): boolean { return REANUDA.test(fold(texto)); }

const coma = (n: number) => n.toLocaleString("es-CL", { maximumFractionDigits: 1 });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" });
const conTrato = (t?: string | null) => (t ? `, ${t}` : "");

/** «Estoy en pausa para revisar el equipo, Alesito (hasta las 15:30). Dime «reanuda» cuando quieras.» */
export function textoPausa(p: Pausa, trato?: string | null): string {
  const por = p.por === "vigia" ? `me puse en pausa sola: ${p.motivo}` : "estoy en pausa para revisar el equipo";
  return `${por.charAt(0).toUpperCase() + por.slice(1)}${conTrato(trato)}${p.hasta ? ` (hasta las ${hhmm(p.hasta)})` : ""}. Lo de siempre sigue (la hora, las alarmas, la linterna); para lo demás, dime «reanuda».`;
}

/**
 * «Todo en línea, Alesito. La tarjeta al 35 % y a 58 °C, 2,2 GB de RAM libres, 28 GB de disco: ojo con el disco. El modelo
 * está cargado. Nada en pausa.» — por código, con lo medido.
 */
export function informeSistemas(m: Medicion, e: EstadoHestia, trato?: string | null, ahora = new Date()): string {
  const L = e.limites;
  const ojo: string[] = [];
  if (L.discoLibreGb.aviso != null && m.discoLibreGb != null && m.discoLibreGb <= L.discoLibreGb.aviso) ojo.push("el disco");
  if (L.ramLibreGb.aviso != null && m.ramLibreGb <= L.ramLibreGb.aviso) ojo.push("la RAM");
  if (m.gpu && L.gpuTempC.aviso != null && m.gpu.tempC >= L.gpuTempC.aviso) ojo.push("la temperatura de la tarjeta");
  const partes: string[] = [];
  if (m.gpu) partes.push(`la tarjeta al ${Math.round(m.gpu.usoPct)} % y a ${Math.round(m.gpu.tempC)} °C`);
  partes.push(`${coma(m.ramLibreGb)} GB de RAM libres`);
  if (m.discoLibreGb != null) partes.push(`${Math.round(m.discoLibreGb)} GB de disco`);
  partes.push(`la CPU al ${Math.round(m.cpuPct)} %`);
  if (m.bateria && !m.bateria.enchufado) partes.push(`batería al ${Math.round(m.bateria.pct)} % sin cargador`);
  const cab = ojo.length ? `Todo en línea${conTrato(trato)}, pero ojo con ${juntar(ojo)}.` : `Todo en línea${conTrato(trato)}.`;
  const modelo = m.modelo ? `El modelo está cargado (${coma(m.modelo.enGpuGb)} GB en la tarjeta).` : "El modelo está descargado: la próxima respuesta tarda un poco más.";
  const p = pausaVigente(e, ahora);
  const estado = p ? (p.por === "vigia" ? `Estoy en pausa: ${p.motivo}.` : "Estoy en pausa.") : e.fondoPausado ? `Lo de fondo está en espera: ${e.fondoPausado}.` : e.fondoQuieto ? `Lo de fondo está quieto: ${e.fondoQuieto}.` : "Nada en pausa.";
  return `${cab} ${cap(juntar(partes))}. ${modelo} ${estado}`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);

export interface CtxComando {
  trato?: string | null; por: QuienPausa; ahora?: Date;
  /** L4: los procesos del PC ahora (para «avísame cuando termine de compilar»: qué está compilando) */
  procesos?: () => Promise<Record<string, number>>;
  /** L4: un trabajo nuevo (para que el reloj lo tome al tiro si el PC está libre) */
  alAgregar?: () => void;
}

/**
 * Si el texto es un comando de Hestia (estado, pausa, reanuda), lo hace y devuelve qué decir; si no, null. La pausa no se
 * revisa acá (eso lo hace quien llama, para dejar pasar los atajos seguros).
 */
export async function comandoHestia(texto: string, ctx: CtxComando): Promise<string | null> {
  const ahora = ctx.ahora ?? new Date();
  // L4: los trabajos de fondo («investiga X y me avisas», «compárame A con B», «¿en qué estás trabajando?», «cancela lo de X»)
  const tr = pideTrabajo(texto);
  if (tr) {
    if ("estado" in tr) return textoEstado(await leerTrabajos(), ahora);
    if ("cancelar" in tr) {
      const xs = await cancelarTrabajos(tr.todos ? { todos: true } : { tema: tr.cancelar ?? "" });
      return xs.length ? `Listo, dejé ${xs.length === 1 ? queEs(xs[0]) : `${xs.length} trabajos`}.` : "No tenía nada así pendiente.";
    }
    const hasta = new Date(ahora.getTime() + VIGIA_HORAS * 3_600_000).toISOString();
    if (tr.tipo === "vigia_proceso") {
      // compilar: lo que de verdad compila en su PC ahora (lo que está corriendo de los compiladores)
      let procesos = tr.procesos;
      if (!procesos) {
        const cpu = ctx.procesos ? await ctx.procesos().catch(() => ({} as Record<string, number>)) : {};
        procesos = COMPILADORES.filter((n) => cpu[n] != null);
      } else if (ctx.procesos) {
        const cpu = await ctx.procesos().catch(() => null);
        if (cpu && !procesos.some((p) => cpu[p] != null)) return `No veo «${tr.tema}» corriendo en el PC. Dime el nombre como aparece en el Administrador de tareas.`;
      }
      await agregarTrabajo({ tipo: "vigia_proceso", tema: tr.tema, pedido: texto, vigia: { procesos, hasta } }, ahora);
      ctx.alAgregar?.();
      return tr.tema === "compilar" ? `Listo${conTrato(ctx.trato)}: te aviso cuando termine de compilar en el PC.` : `Listo${conTrato(ctx.trato)}: te aviso cuando termine ${tr.tema} en el PC.`;
    }
    if (tr.tipo === "vigia_servicio") {
      await agregarTrabajo({ tipo: "vigia_servicio", tema: tr.tema, pedido: texto, vigia: { servicio: tr.servicio, hasta } }, ahora);
      ctx.alAgregar?.();
      return `Listo: si se cae ${tr.tema} en el PC, te aviso al tiro (durante las próximas ${VIGIA_HORAS} horas).`;
    }
    if (tr.tipo === "vigia_archivo") {
      await agregarTrabajo({ tipo: "vigia_archivo", tema: tr.tema, pedido: texto, vigia: { carpeta: tr.carpeta, archivo: tr.archivo, hasta } }, ahora);
      ctx.alAgregar?.();
      return `Listo: te aviso cuando aparezca «${tr.tema}» en el PC.`;
    }
    const t = await agregarTrabajo({ tipo: tr.tipo, tema: tr.tema, ...("b" in tr ? { b: tr.b } : {}), pedido: texto }, ahora);
    const enCola = (await leerTrabajos()).filter((x) => (x.estado === "pendiente" || x.estado === "corriendo") && !x.tipo.startsWith("vigia") && x.id !== t.id).length;
    ctx.alAgregar?.();
    return `Listo${conTrato(ctx.trato)}: me pongo con ${queEs(t)} cuando el PC esté libre${enCola ? ` (antes tengo ${enCola === 1 ? "otra cosa" : `${enCola} cosas`})` : ""}. Te aviso al terminar y te lo dejo en el chat «Trabajos de Hestia».`;
  }
  // L2: de quién te avisa cuando te escriben («avísame cuando me escriba Pedro», «deja de avisarme de Pedro»)
  const imp = pideImportantes(texto);
  if (imp) {
    if ("lista" in imp) {
      const xs = (await leerEstado()).importantes;
      return xs.length
        ? `Te aviso cuando te escriben ${juntar(xs)}${conTrato(ctx.trato)}: con audífonos, en voz alta, y solo de quién (el mensaje, si me lo pides).`
        : `Por ahora no te aviso de nadie${conTrato(ctx.trato)}. Dime, por ejemplo, «avísame cuando me escriba Mamá».`;
    }
    if ("agregar" in imp) {
      const nuevo = await agregarImportante(imp.agregar);
      return nuevo
        ? `Listo${conTrato(ctx.trato)}: cuando te escriba ${imp.agregar}, te aviso. Con audífonos te lo digo; solo de quién, nunca el mensaje en voz alta.`
        : `Ya te aviso cuando te escribe ${(await leerEstado()).importantes.find((x) => clavePersona(x) === clavePersona(imp.agregar)) ?? imp.agregar}${conTrato(ctx.trato)}.`;
    }
    const quitado = await quitarImportante(imp.quitar);
    return quitado ? `Listo, ya no te aviso de ${quitado}.` : `${imp.quitar} no estaba entre los que te aviso.`;
  }
  if (pideReanudar(texto)) {
    const e = await leerEstado();
    if (!pausaVigente(e, ahora)) return `Ya estoy activa${conTrato(ctx.trato)}.`;
    await reanudar();
    return `De vuelta${conTrato(ctx.trato)}. Todo en línea.`;
  }
  const p = pidePausa(texto);
  if (p) {
    await pausar(ctx.por === "voz" ? "la pediste por voz" : ctx.por === "chat" ? "la pediste en el chat" : "la pediste en el panel", ctx.por, p.minutos, ahora);
    const cuanto = p.minutos ? (p.minutos >= 60 && p.minutos % 60 === 0 ? ` por ${p.minutos / 60 === 1 ? "una hora" : `${p.minutos / 60} horas`}` : ` por ${p.minutos} minutos`) : "";
    return `Listo${conTrato(ctx.trato)}: me pongo en pausa${cuanto}. Mientras, no uso el modelo; dime «reanuda» cuando quieras.`;
  }
  if (pideEstadoSistemas(texto)) {
    const m = ultimaMedicion() && Date.now() - Date.parse(ultimaMedicion()!.t) < 90_000 ? ultimaMedicion()! : await medir();
    return informeSistemas(m, await leerEstado(), ctx.trato, ahora);
  }
  return null;
}
