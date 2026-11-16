// ============================================================
// Eris — DayAgendaTool (day_agenda) · 2026-10-23, «Eris como Jarvis»
//
// «Buenos días, ¿qué tengo para hoy?», «planifícame el resto del día»: el día cruzando los módulos, por código y con sus
// datos reales. Antes el modelo contestaba «necesito revisar tu agenda» o inventaba («11 kcal»), y la persona tenía que ir
// a buscar cada cosa a su módulo. Junta:
//   - Forge: lo que toca hoy (proyección del teléfono: forgeRoutine.routineToday) o el descanso; lo que dijo («hoy entreno a las 7»);
//   - Nutrición: lo que lleva y su meta, la próxima comida a su hora (MealSchedule, desde SU despertar);
//   - agua A ESTA HORA (WaterToday, la misma frase de siempre), sueño de anoche y la hora para acostarse;
//   - suplementos que faltan, lo que vence en la casa (Inventario) y los pagos de los próximos días (Finanzas).
// Lo que no tiene datos no se nombra. Sin culpa: «medir sin obsesión».
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { gatherMetabolicContext, analyze } from "../services/MetabolicAnalysis.js";
import { getProjection, intentFor } from "../services/TrainingIntent.js";
import { intentPhrase } from "../services/forge/forgeTrain.js";
import { waterToday, catchUpText } from "../services/WaterToday.js";
import { slotIsPast, typicalTimeOf, slotAt, hhmm, MEAL_NAME, hourOf } from "../services/MealSchedule.js";
import { estadoHoy, type SupState } from "../services/SupplementCore.js";
import { porVencer, listaCompras } from "../services/InventoryCore.js";
import { lastInventoryState } from "../services/InventoryBackup.js";
import { tratoDeHoy, tratoLinea } from "../services/Antojo.js";
import { todayIsoOf } from "../services/NutritionDay.js";
import { asksToLog } from "../services/FoodParse.js";
import { loadTargets } from "../services/DailyTargets.js";
import { sleepSummaryText, sleepReading, hhmmOf, sleepReadiness, sleepDayTip, trainingTimeNote, fmtSleep } from "../services/SleepCore.js";
import { moduloOn } from "../services/AutoPrefs.js";
import { canTelefono, requestTelefonoOp } from "../services/TelefonoBridge.js";

const Schema = z.object({
  resto: z.boolean().optional().describe("true si pide planificar el RESTO del día («planifícame el resto del día»): lo que sigue, en orden."),
  semana: z.boolean().optional().describe("true si pide cómo viene su SEMANA («resúmeme cómo vengo esta semana»): los últimos 7 días."),
  remedios: z.boolean().optional().describe("true si pregunta si ya se tomó sus remedios hoy."),
});
type Input = z.infer<typeof Schema>;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[¿?¡!.,;:]+/g, " ").replace(/\s+/g, " ").trim();
/** «¿Qué tengo para hoy?», «mi día de hoy», «planifícame el resto del día», «organízame el día» */
export const DAY_ASK = /\b(que (tengo|hay|hago) (para |pa )?hoy|que tengo hoy|mi (agenda|dia|plan) (de|para) hoy|planifica\w* (el |mi )?(resto del |resto de mi )?dia|planifica\w* (el )?resto|organiza\w* (el |mi )?(resto del )?dia|(arma\w*|haz\w*|dame) (un |el )?plan (para|del) (el |mi )?(resto del |dia|hoy)|como organizo (el |mi )?(resto del )?dia|resto del dia|como (viene|se ve) (mi |el )?dia)\b/;
/** «Resúmeme cómo vengo esta semana», «¿cómo me fue esta semana?», «mi semana» */
export const WEEK_ASK = /\b(como (vengo|voy|ando|me fue|me va|va|estuvo|viene)( yo)? (esta|la|en la|en esta) semana|resum\w* (de |como (vengo|voy|me fue) )?(mi |la |esta )?semana|resumen semanal|balance (de )?(la |mi )?semana|mi semana|que tal (mi |la )?semana)\b/;
/** «¿Ya me tomé los remedios hoy?», «¿me tomé las pastillas?» */
export const REMEDIOS_ASK = /\b(me tome|tome|ya tome|me falta tomar|me toca tomar|tengo que tomar)\b[^?]{0,25}\b(los |las |mis )?(remedios?|pastillas?|medicamentos?|medicinas?)\b/;
/** «¿Qué me toca hoy?» y «qué hago hoy en el gym» son de Forge (training_plan), no la agenda entera */
const SOLO_ENTRENO = /\b(gym|gimnasio|entren\w*|rutina|forge|ejercicio)\b/;

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const dec = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
const corto = (name: string) => name.replace(/\s*\([^)]*\)\s*/g, " ").trim();

export class DayAgendaTool extends Tool<Input> {
  readonly name = "day_agenda";
  readonly description =
    "El día del usuario cruzando todos sus módulos (entreno de hoy, comida y próxima comida, agua a esta hora, sueño, suplementos que faltan, " +
    "lo que vence en su casa y pagos cercanos). USAR con 'qué tengo para hoy', 'buenos días, ¿qué hay hoy?', 'planifícame el resto del día'. " +
    "Presenta lo que devuelve tal cual; no inventes compromisos ni cifras.";
  readonly inputSchema = Schema;

  async preroute(userMessage: string): Promise<Record<string, unknown> | null> {
    const t = fold(userMessage || "");
    if (!t || t.length > 180 || asksToLog(userMessage)) return null;
    // «¿Ya me tomé los remedios?»: Eris no registra tomas de remedios; lo dice, con su lista (sin dosis nuevas ni «tómalo doble»)
    if (REMEDIOS_ASK.test(t) && /[?¿]/.test(userMessage)) return { remedios: true };
    // «¿Cómo vengo esta semana?» (sin hablar de plata: eso es Finanzas)
    // «Mi semana fue horrible» cuenta cómo se siente, no pide el resumen (revisión 2026-11-04, C2): eso lo conversa el modelo
    const desahogo = !/[?¿]/.test(userMessage) && /\b(mi|la|esta) semana (fue|estuvo|ha sido|esta siendo|viene siendo|anda|va|me tiene|se me hizo)\b/.test(t)
      && !/^(como|que tal|resum\w*|dame|muestra\w*|balance)\b/.test(t);
    if (WEEK_ASK.test(t) && !desahogo && !/\b(plata|gast\w*|finanzas|presupuesto|sueldo)\b/.test(t)) return { semana: true };
    if (!DAY_ASK.test(t)) return null;
    if (SOLO_ENTRENO.test(t) && !/\b(dia|agenda|resto)\b/.test(t)) return null;
    return { resto: /\b(resto|lo que queda|planifica\w*|organiza\w*|plan)\b/.test(t) };
  }

  async execute(input: Input, context?: any): Promise<ToolExecutionResult> {
    const memory = context?.memory;
    if (!memory) return { output: "", error: "Sin acceso al perfil." };
    if (input.semana) return this.week(memory);
    if (input.remedios) {
      const prof = await memory.getProfile?.().catch(() => null);
      const meds = ((prof?.medical?.medications ?? []) as Array<{ name: string; dose?: string; schedule?: string; active?: boolean }>).filter((m) => m && m.active !== false && m.name);
      const lista = meds.map((m) => `• ${m.name}${m.schedule ? ` (${m.schedule})` : ""}`);
      const q = meds.length
        ? ["No llevo registro de cuándo tomas tus remedios, así que no sé si hoy ya te los tomaste. Los que tienes anotados:", ...lista,
          "", "En el Botiquín (Inventario) su stock baja solo según ese horario. Si se te pasó una toma, sigue lo que te indicó tu médico: no la dupliques por tu cuenta."].join("\n")
        : "No tienes remedios anotados en tu perfil. Si tomas alguno, agrégalo en Perfil › Salud (nombre y horario) y te ayudo a llevarlo.";
      return { output: q, metadata: { quickReply: q } };
    }
    const now = new Date();
    const ctx = await gatherMetabolicContext(memory, { glucoService: context?.glucoService });
    const a = analyze(ctx);
    const wake = ctx.wakeHour;
    const head: string[] = [];
    const sigue: Array<{ h: number; t: string }> = [];
    const hNow = hourOf(now);

    // ── Entreno (Forge) ──
    const [proj, intent] = await Promise.all([getProjection(memory).catch(() => null), intentFor(memory).catch(() => null)]);
    const tdKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const td = proj?.today && proj.today.day === tdKey ? proj.today : null;
    // Corto en total, o partido con poca noche (Sueño 2.0 · S0: 9 h 31 «en partes» con 5 h 29 de noche no es dormir bien)
    const parts = ctx.sleepParts;
    const sueñoCorto = ctx.sleepHours != null && (ctx.sleepHours < 6.5 || (!!parts?.split && (parts.nightH ?? 9) < 5.5));
    // Sueño 2.0 · S3: cómo llega a entrenar (3 noches + deuda) y la recomendación del día, las mismas de la app
    const lastSl = ctx.sleepHours != null ? { totalH: ctx.sleepHours, nightH: parts?.nightH ?? null, split: !!parts?.split, secondSleep: !!parts?.episodes.some((e) => e.kind === "segundo") } : null;
    const ready = sleepReadiness(ctx.sleepInsights, lastSl);
    const diabetic = (ctx.medical?.conditions ?? []).some((c: any) => ["diabetes_t1", "diabetes_t2", "prediabetes"].includes(c?.id));
    const sleepTip = sleepDayTip(ctx.sleepInsights, lastSl, { diabetic });
    if (intent?.answer === "no") head.push("🏋️ **Entreno:** hoy descansas (lo dijiste tú). El descanso también suma.");
    else if (td?.rest && intent?.answer !== "si") head.push("🏋️ **Entreno:** día de descanso en tu rutina. Si te sobran ganas, una caminata suave.");
    else if (td && td.items?.length) {
      const ej = td.items.slice(0, 3).map((x) => `${corto(x.name)} ${x.text.split(" · ").filter((p) => !/^RIR/.test(p)).join(" · ")}`).join("; ");
      const cuando = intent?.time ? ` a las ${intent.time}` : "";
      const lleva = td.doneSets > 0 ? ` Ya llevas ${td.doneSets} series: vas bien.` : "";
      head.push(`🏋️ **Entreno${cuando}:** toca **${(td.name ?? "").replace(/^\s*d[ií]a\s*\w+\s*[:—–-]\s*/i, "")}** — ${ej}${td.items.length > 3 ? "…" : ""}.${lleva}`);
      if (ready && ready.level !== "normal" && td.doneSets === 0) head.push(`   ${ready.why} ${ready.tip}`);
      else if (!ready && sueñoCorto && td.doneSets === 0) head.push(`   ${parts?.split ? `Tu noche fue corta y partida (${dec(parts.nightH ?? ctx.sleepHours!)} h)` : `Dormiste ${dec(ctx.sleepHours!)} h`}: entrena igual, pero si te sientes pesado deja una repetición más en reserva.`);
      const tn = intent?.time && td.doneSets === 0 ? trainingTimeNote(Number(intent.time.split(":")[0]) + Number(intent.time.split(":")[1] ?? 0) / 60, ctx.sleepInsights, 75 / 60) : null;
      if (tn) head.push(`   🌙 ${tn}`);
      if (td.doneSets === 0) sigue.push({ h: intent?.time ? Number(intent.time.split(":")[0]) + Number(intent.time.split(":")[1] ?? 0) / 60 : 99, t: `Entreno: ${(td.name ?? "").replace(/^\s*d[ií]a\s*\w+\s*[:—–-]\s*/i, "")}${intent?.time ? "" : " (cuando te acomode)"}` });
    } else if (intent?.answer === "si") head.push(`🏋️ **Entreno:** ${intentPhrase(intent)}${intent.time ? ` a las ${intent.time}` : ""}.`);

    // ── El calendario del teléfono (Hestia Manos, K2): solo Ikaros en Modo AXS, y sin esperar más de 4 s al teléfono ──
    // Los títulos pueden venir de invitaciones de otras personas: la respuesta queda marcada como contenido externo
    let externo = false;
    if (context?.role === "ikaros" && context?.axsMode === true && canTelefono(context?.wsClient)) {
      const desde = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const r = await requestTelefonoOp(context.wsClient, { accion: "eventos", desde, hasta: desde + 86_400_000 }, 4000).catch(() => null);
      const evs = (r?.ok && Array.isArray(r.data?.eventos) ? r.data.eventos : []) as Array<{ titulo: string; inicio: number; todoElDia: boolean }>;
      if (evs.length) {
        externo = true;
        const hm = (ms: number) => hhmm(new Date(ms));
        head.push(`📅 **Calendario:** ${evs.slice(0, 5).map((e) => (e.todoElDia ? `«${e.titulo}» (todo el día)` : `${hm(e.inicio)} «${e.titulo}»`)).join("; ")}.`);
        for (const e of evs) if (!e.todoElDia && e.inicio > now.getTime() - 30 * 60_000) sigue.push({ h: hourOf(new Date(e.inicio)), t: `«${e.titulo}» a las ${hm(e.inicio)}` });
      }
    }

    // ── Comida (Nutrición) ──
    const G = ctx.goals;
    if (G.kcal > 0) {
      const prot = G.protein ? ` y ${Math.round(ctx.eaten.protein)} de ${Math.round(G.protein)} g de proteína` : "";
      head.push(`🍽️ **Comida:** llevas ${Math.round(ctx.eaten.kcal).toLocaleString("es-CL")} de ${Math.round(G.kcal).toLocaleString("es-CL")} kcal${prot}.`);
    }
    // Las comidas que vienen, a su hora (desde su despertar); la de ahora no, si comió hace poco
    const comioHacePoco = ctx.lastMealAt && now.getTime() - ctx.lastMealAt.getTime() < 90 * 60_000;
    const ahora = slotAt(now, { wakeHour: wake });
    for (const slot of ["desayuno", "almuerzo", "once", "cena"]) {
      if (slotIsPast(slot, now, wake)) continue;
      if (slot === ahora && comioHacePoco) continue;
      const at = typicalTimeOf(slot, now, { wakeHour: wake });
      const h = Math.max(hourOf(at) + (at.getDate() !== now.getDate() ? 24 : 0), slot === ahora ? hNow : 0);
      sigue.push({ h, t: `${MEAL_NAME[slot][0].toUpperCase()}${MEAL_NAME[slot].slice(1)}${slot === ahora ? " (ya es su hora)" : ` ~${hhmm(at)}`}` });
    }

    // ── Agua, a esta hora ──
    const w = await waterToday(memory, now).catch(() => null);
    if (w && w.goalL != null) {
      if (w.pace && (w.pace.state === "algo_atras" || w.pace.state === "atras") && w.pace.toCatchUp > 0) {
        head.push(`💧 **Agua:** llevas ${dec(w.totalL)} de ${dec(w.goalL)} L; para ir al día te faltan ${catchUpText(w.pace)}.`);
        sigue.push({ h: hNow - 0.01, t: `Agua: ${catchUpText(w.pace)} para ir al día` });
      } else if (w.pace?.state === "cumplida") head.push(`💧 **Agua:** meta cumplida (${dec(w.totalL)} L). ¡Bien!`);
      else head.push(`💧 **Agua:** llevas ${dec(w.totalL)} de ${dec(w.goalL)} L: vas al día.`);
    }

    // ── Suplementos que faltan ──
    const sup: any = await memory.get("supplements_state").catch(() => null);
    if (sup?.state && Array.isArray(sup.state.items)) {
      const dia = await todayIsoOf(memory, now).catch(() => tdKey);
      const pend = estadoHoy(sup.state as SupState, dia, hNow).filter((e) => e.faltan > 0);
      if (pend.length) {
        head.push(`💊 **Suplementos:** te falta ${pend.map((e) => `${e.sup.nombre}${e.sup.tomasDia > 1 ? ` (${e.tomadas} de ${e.sup.tomasDia})` : ""}`).join(", ")}.`);
        for (const e of pend) if (e.proxima != null) sigue.push({ h: Math.max(e.proxima, hNow), t: `${e.sup.nombre}${e.atrasada ? " (ya pasó su hora)" : ""}` });
      }
    }

    // ── La casa (Inventario): lo que vence y la lista ──
    const inv = await lastInventoryState(memory).catch(() => null);
    if (inv?.state) {
      const pv = porVencer(inv.state, now, 2);
      const lc = listaCompras(inv.state);
      const n = lc.auto.length + lc.manual.length;
      const partes: string[] = [];
      if (pv.length) partes.push(`vence pronto ${pv.slice(0, 3).map((v) => `${v.item.nombre} (${v.dias < 0 ? "ya vencido" : v.dias === 0 ? "hoy" : v.dias === 1 ? "mañana" : `en ${v.dias} días`})`).join(", ")}: úsalo primero`);
      if (n) partes.push(`tu lista de compras tiene ${n} cosa${n > 1 ? "s" : ""}${lc.total > 0 ? ` (~${clp(lc.total)})` : ""}`);
      if (partes.length) head.push(`🏠 **Casa:** ${partes.join("; ")}.`);
    }

    // ── Plata (Finanzas): pagos de los próximos 3 días y el sueldo por confirmar ──
    const fin: any = (await moduloOn(memory, "finanzas")) ? await memory.get("financial_summary_latest").catch(() => null) : null; // A2
    const fs = fin?.summary ?? fin;
    if (fs && typeof fs === "object") {
      const partes: string[] = [];
      const prox = (Array.isArray(fs.proximos) ? fs.proximos : []).filter((p: any) => typeof p.enDias === "number" && p.enDias >= 0 && p.enDias <= 3);
      const gastos = prox.filter((p: any) => p.tipo !== "ingreso");
      const ingresos = prox.filter((p: any) => p.tipo === "ingreso");
      if (gastos.length) partes.push(`${gastos.length > 1 ? "pagos cercanos" : "pago cercano"}: ${gastos.slice(0, 3).map((p: any) => `${p.desc} ${clp(p.monto)} (${p.enDias === 0 ? "hoy" : p.enDias === 1 ? "mañana" : `en ${p.enDias} días`})`).join(", ")}`);
      if (ingresos.length) partes.push(`${ingresos[0].desc} llega ${ingresos[0].enDias === 0 ? "hoy" : ingresos[0].enDias === 1 ? "mañana" : `en ${ingresos[0].enDias} días`}`);
      if ((fs.porConfirmar ?? 0) > 0) partes.push("tienes un ingreso por confirmar («¿Llegó?» en Finanzas)");
      if (partes.length) head.push(`💸 **Plata:** ${partes.join("; ")}.`);
    }

    // ── El trato de un antojo ──
    const trato = await tratoDeHoy(memory, await todayIsoOf(memory, now).catch(() => tdKey)).catch(() => null);
    if (trato) head.push(`🤝 ${tratoLinea(trato)}`);

    // ── Dormir ──
    if (ctx.sleepHours != null) {
      const base = wake != null ? wake : 7.5;
      // La del teléfono (Sueño 2.0 · S1): su necesidad, su despertar habitual y corrida si durmió de día; si no, despertar − 8 h
      const insB = ctx.sleepInsights?.bedtime;
      const acostarse = insB ? insB.target % 24 : ((base - 8 + 24) % 24);
      const hh = `${Math.floor(acostarse)}:${String(Math.round((acostarse % 1) * 60)).padStart(2, "0")}`;
      if (parts?.split) {
        // Por partes, como el reloj; después de un segundo sueño cuesta dormirse temprano: sin forzar la hora
        const r = sleepReading(parts, parts.usualSleepH);
        head.push(`😴 **Sueño:** ${sleepSummaryText(parts)}${r ? ` ${r}` : ""}${parts.episodes.some((e) => e.kind === "segundo") ? " Esta noche acuéstate cuando te dé sueño, y mañana levántate a tu hora de siempre." : ""}`);
      } else if (sueñoCorto) head.push(`😴 **Sueño:** anoche dormiste ${fmtSleep(ctx.sleepHours)}. ${insB ? `Esta noche acuéstate entre las ${hhmmOf(insB.from)} y las ${hhmmOf(insB.to)}.` : `Para 8 h, apunta a acostarte ~${hh}.`}`);
      // La UNA recomendación del día por cómo dormiste (la comida primero; con diabetes, el azúcar)
      if (sleepTip && sleepTip.kind !== "partida") head.push(`   💡 ${sleepTip.sub}`);
      if (ctx.lateCaffeine) head.push(`   ☕ ${ctx.lateCaffeine}`);
      else if (ctx.sleepInsights && hNow < ctx.sleepInsights.caffeineUntil) sigue.push({ h: ctx.sleepInsights.caffeineUntil, t: `Último café (${hhmmOf(ctx.sleepInsights.caffeineUntil)})` });
      sigue.push({ h: acostarse < 12 ? acostarse + 24 : acostarse, t: `Acostarte ~${hh}` });
    }

    if (!head.length && !sigue.length) {
      const q = "Todavía no tengo datos de tu día: abre la app con conexión (Forge, Nutrición y Finanzas me mandan lo suyo) y te armo el día.";
      return { output: q, metadata: { quickReply: q } };
    }
    const orden = sigue.filter((x) => x.h >= hNow - 0.5).sort((x, y) => x.h - y.h).slice(0, 6).map((x) => `• ${x.t}`);
    // Lo más importante, si no está ya arriba (el agua y el sueño ya tienen su línea)
    const top = a.findings.find((f) => f.severity >= 2 && f.area !== "datos" && f.area !== "agua" && f.area !== "sueno" && f.tag !== "caution");
    const out = [
      input.resto ? "Tu resto del día:" : "Tu día:",
      ...head,
      ...(orden.length ? ["", "**Lo que sigue:**", ...orden] : []),
      ...(top?.action ? ["", `Lo más importante ahora: ${top.action}`] : []),
      "",
      "Pídeme «¿qué como?» y te lo armo con lo de tu casa.",
    ];
    const reply = out.join("\n");
    // Tono «brígida» (services/Brigida.ts): una línea de veredicto
    const veredicto = orden.length ? `Te ${orden.length === 1 ? "queda 1 cosa" : `quedan ${orden.length} cosas`} hoy. A darle.` : undefined;
    return { output: reply, metadata: { quickReply: reply, ...(veredicto ? { veredicto } : {}), ...(externo ? { untrusted: true } : {}) } };
  }

  /**
   * «¿Cómo vengo esta semana?»: los últimos 7 días (sin hoy, que va a medias) del registro diario (daily_rollup_log), los
   * entrenos de Forge y lo de Finanzas. Primero lo que va bien, y UNA cosa para la próxima semana, sin culpa.
   */
  private async week(memory: any): Promise<ToolExecutionResult> {
    const now = new Date();
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const hoy = key(now);
    const desde = key(new Date(now.getTime() - 7 * 86_400_000));
    const log: any[] = ((await memory.get("daily_rollup_log").catch(() => null)) ?? []).filter((e: any) => e && e.date >= desde && e.date < hoy);
    const [t, proj, fin] = await Promise.all([loadTargets(memory).catch(() => null), getProjection(memory).catch(() => null), memory.get("financial_summary_latest").catch(() => null)]);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);
    const nums = (k: string, ok: (e: any) => boolean = () => true) => log.filter((e) => typeof e[k] === "number" && e[k] > 0 && ok(e)).map((e) => e[k] as number);
    const bien: string[] = [];
    const lineas: string[] = [];
    const mejorar: Array<{ peso: number; t: string }> = [];

    // Entreno (Forge cuenta los días con series; si no, el registro diario)
    const p = proj?.progress;
    const ent = typeof p?.month?.week === "number" ? p.month.week : log.filter((e) => e.trained).length;
    const meta = proj?.routine?.daysPerWeek ?? null;
    if (ent > 0 || meta) {
      lineas.push(`🏋️ **Entreno:** ${ent} día${ent === 1 ? "" : "s"}${meta ? ` de los ${meta} de tu rutina` : ""}.`);
      if (meta && ent >= meta) bien.push("cumpliste tu rutina");
      else if (meta && ent < meta) mejorar.push({ peso: (meta - ent) / meta, t: `meter ${meta - ent === 1 ? "el entreno que faltó" : `los ${meta - ent} entrenos que faltaron`} (aunque sea una versión corta)` });
      const recs = (p?.records ?? []).filter((r: any) => r.day >= desde).slice(0, 2);
      if (recs.length) { lineas.push(`   Récords: ${recs.map((r: any) => `${r.name} ${r.text}`).join(" · ")}.`); bien.push("sacaste récords"); }
    }
    // Sueño
    const su = nums("sleepHours");
    const sAvg = avg(su);
    if (sAvg != null) {
      const snapW: any = await memory.get("health_snapshot_latest").catch(() => null);
      const insW: any = snapW?.sleepInsights;
      const extraW = insW && typeof insW.need === "number" && insW.nights >= 4
        ? `${insW.debtH >= 1 ? ` Deuda de ~${String(insW.debtH).replace(".", ",")} h.` : ""}${insW.regularity ? ` Horario ${insW.regularity}${insW.usualOnset != null ? ` (te duermes ~${hhmmOf(insW.usualOnset)})` : ""}.` : ""}`
        : "";
      // Sueño 2.0 · S3: los días partidos (la noche bastante menor que el total) y el plan de sueño en curso
      const partidos = log.filter((e) => typeof e.sleepHours === "number" && typeof e.sleepNightHours === "number" && e.sleepHours - e.sleepNightHours >= 1).length;
      const planW = snapW?.sleepPlan && typeof snapW.sleepPlan.title === "string" && !snapW.sleepPlan.done ? ` Tu meta: ${snapW.sleepPlan.title.toLowerCase()} (${snapW.sleepPlan.text.replace(/\.$/, "")}).` : "";
      lineas.push(`😴 **Sueño:** ${dec(sAvg)} h en promedio (${su.length} noche${su.length === 1 ? "" : "s"} con dato)${partidos ? `, ${partidos} ${partidos === 1 ? "día partido" : "días partidos"}` : ""}.${extraW}${planW}`);
      if (insW?.trendMinPerDay >= 20) mejorar.push({ peso: 0.9, t: "volver a tu horario de sueño: levántate a la misma hora y busca luz de mañana temprano" });
      if (sAvg >= 7) bien.push("dormiste bien"); else mejorar.push({ peso: (7 - sAvg) / 7 + 0.1, t: `dormir ~${Math.max(15, Math.round(((7 - sAvg) * 60) / 15) * 15)} min más por noche` });
    }
    // Comida (solo los días anotados)
    const kc = nums("calories", (e) => e.calories >= 300);
    if (kc.length) {
      const pr = nums("proteinG", (e) => (e.calories ?? 0) >= 300);
      const kAvg = avg(kc)!, pAvg = avg(pr);
      lineas.push(`🍽️ **Comida:** ${kc.length} de 7 días anotados; en esos días, ~${Math.round(kAvg).toLocaleString("es-CL")} kcal${t?.kcal ? ` (tu meta ~${Math.round(t.kcal).toLocaleString("es-CL")})` : ""}${pAvg != null ? ` y ~${Math.round(pAvg)} g de proteína${t?.proteinG && !t.proteinIsCap ? ` (meta ${Math.round(t.proteinG)})` : ""}` : ""}.`);
      if (pAvg != null && t?.proteinG && !t.proteinIsCap && pAvg < t.proteinG * 0.8) mejorar.push({ peso: (t.proteinG - pAvg) / t.proteinG, t: "sumar proteína (una porción más al día: huevos, yogur, legumbres, pollo)" });
      else if (pAvg != null && t?.proteinG && pAvg >= t.proteinG * 0.9) bien.push("llegaste a tu proteína");
      if (kc.length <= 3) mejorar.push({ peso: 0.2, t: "anotar lo que comes más días (así te puedo ayudar mejor)" });
    }
    // Agua
    const ag = nums("hydrationL");
    const aAvg = avg(ag);
    if (aAvg != null) {
      lineas.push(`💧 **Agua:** ~${dec(aAvg)} L al día${t?.waterL ? ` (meta ${dec(t.waterL)} L)` : ""}.`);
      if (t?.waterL && aAvg >= t.waterL * 0.9) bien.push("te hidrataste bien");
      else if (t?.waterL) mejorar.push({ peso: (t.waterL - aAvg) / t.waterL, t: `tomar ~${Math.max(1, Math.round((t.waterL - aAvg) / 0.25))} vasos más al día` });
    }
    // Pasos
    const pa = nums("steps");
    const pAvgSteps = avg(pa);
    if (pAvgSteps != null) {
      lineas.push(`👣 **Pasos:** ~${Math.round(pAvgSteps).toLocaleString("es-CL")} al día.`);
      if (pAvgSteps >= 7000) bien.push("te moviste harto");
    }
    // Plata (el mes, que es como lo lleva Finanzas)
    const fs = fin?.summary ?? fin;
    if (fs?.comida?.presup > 0) {
      const pct = Math.round((fs.comida.gastado / fs.comida.presup) * 100);
      lineas.push(`💸 **Comida en Finanzas:** llevas ${clp(fs.comida.gastado)} de ${clp(fs.comida.presup)} del mes (${pct} %).`);
    }

    if (!lineas.length) {
      const q = "Todavía no tengo días anotados de esta semana: con la app abierta (Forge, Nutrición, el reloj y Finanzas) te armo el resumen.";
      return { output: q, metadata: { quickReply: q } };
    }
    const top = mejorar.sort((x, y) => y.peso - x.peso)[0];
    const out = [
      "Tu semana (últimos 7 días):",
      ...lineas,
      ...(bien.length ? ["", `Lo bueno: ${bien.join(", ")}. 👏`] : []),
      ...(top ? ["", `Para la próxima semana, una sola cosa: ${top.t}.`] : []),
    ];
    const reply = out.join("\n");
    return { output: reply, metadata: { quickReply: reply } };
  }
}
