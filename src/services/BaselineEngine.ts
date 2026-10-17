// ============================================================
// Eris — BaselineEngine
// Calcula el patrón histórico personal de un usuario (no umbrales
// genéricos de industria) y detecta qué variable se desvía HOY.
// Aritmética pura en TS — el LLM solo redacta, nunca calcula.
//
// Mientras no hay historial suficiente, algunas métricas caen a un
// valor de referencia general (genericFallback) — pero SIEMPRE
// marcadas como tales (confidence:'generic'), nunca presentadas
// como si fueran el patrón personal del usuario.
// ============================================================

import type { DailyRollupEntry, MedicalProfile } from "../memory.js";
import { getNumericAdjustment } from "./MedicalKnowledgeBase.js";
import { waterRule } from "./DailyTargets.js";
import { normDayHour, isoDayKey, nutritionDayOf, wakeHourFor, type DayCtx } from "./MealSchedule.js";

const hasCondition = (m: MedicalProfile | null | undefined, id: string) => !!(m as any)?.conditions?.some((c: any) => c.id === id);

type MetricKey = 'hydrationL' | 'sleepHours' | 'proteinG' | 'steps' | 'restingHR' | 'disponible' | 'savingsRate' | 'moodScore';

interface MetricSpec {
  key: MetricKey;
  label: string;
  unit: string;
  cumulative: boolean; // true => el valor se acumula durante el día, se prorratea por hora
  concerningDirection: 'below' | 'above';
  consequenceHint: string;
  /** Valor de referencia general (industria) a usar SOLO mientras no hay historial personal suficiente. */
  genericFallback?: number;
  /** Referencia general más precisa cuando hay datos del usuario disponibles (ej. peso para proteína). Si devuelve undefined, se usa genericFallback. */
  dynamicFallback?: (ctx: DiagnosisContext) => number | undefined;
  /**
   * false = no se buscan tendencias de semana a semana. Un saldo no es un hábito: "Disponible" pasó de $16.428 a $816.258
   * de promedio porque entró el sueldo, y la tarjeta del día lo contó como "mejora sostenida del 4869 %" (2026-10-10).
   */
  trend?: boolean;
  /**
   * true = el valor sale de lo que el usuario ANOTA de comida. Un día con menos de FOOD_LOGGED_MIN_KCAL anotadas está a
   * medio anotar: hoy no se compara (la tarjeta decía "proteína 0 g, −100 %" a media tarde solo porque aún no había
   * anotado nada, 2026-10-10) y los días pasados así no entran al promedio (lo bajarían). Mismo umbral que el relleno
   * desde Health Connect (backfill_rollup en server.ts).
   */
  needsFoodLog?: boolean;
  /**
   * true = esta métrica no se comenta para este perfil. El agua, con enfermedad renal o insuficiencia cardíaca: el límite
   * de líquidos lo pone el médico y "tomaste menos que tu patrón" empujaría a tomar más.
   */
  skip?: (ctx: DiagnosisContext) => boolean;
}

/** Menos que esto en un día = comida a medio anotar (ver needsFoodLog). */
export const FOOD_LOGGED_MIN_KCAL = 300;

const METRICS: MetricSpec[] = [
  {
    // Lo BEBIDO (el historial no tiene el agua de la comida: ver WaterToday)
    key: 'hydrationL', label: 'Agua bebida', unit: 'L', cumulative: true, concerningDirection: 'below',
    skip: (ctx) => waterRule(ctx.medical).off,
    consequenceHint: 'la deshidratación reduce el volumen sanguíneo y dificulta el transporte de oxígeno; puede causar dolores de cabeza, fatiga y peor toma de decisiones.',
    genericFallback: 2.5,
  },
  {
    key: 'sleepHours', label: 'Sueño', unit: 'h', cumulative: false, concerningDirection: 'below',
    consequenceHint: 'dormir menos que tu patrón habitual reduce la consolidación de memoria y la recuperación física; puede afectar tu concentración y ánimo hoy.',
    genericFallback: 8,
  },
  {
    key: 'proteinG', label: 'Proteína', unit: 'g', cumulative: true, concerningDirection: 'below', needsFoodLog: true,
    consequenceHint: 'consumir menos proteína que tu patrón habitual puede afectar tu energía y recuperación muscular, sobre todo si entrenaste.',
    // Mismo criterio que DailyTargets.proteinRule y dailyLimits() (1,6 g/kg; 0,8 como tope con enfermedad renal;
    // 60 g sin peso conocido): la fuente única de metas, para no mostrar cifras distintas en cada pantalla.
    genericFallback: 60,
    dynamicFallback: (ctx) => ctx.weightKg
      ? Math.round(ctx.weightKg * (hasCondition(ctx.medical, 'ckd') ? 0.8 : 1.6))
      : undefined,
  },
  {
    key: 'steps', label: 'Actividad', unit: 'pasos', cumulative: true, concerningDirection: 'below',
    consequenceHint: 'moverte menos que tu patrón habitual puede afectar tu energía, tu sueño de esta noche y tu ánimo.',
    genericFallback: 10000,
  },
  {
    key: 'restingHR', label: 'FC en reposo', unit: 'bpm', cumulative: false, concerningDirection: 'above',
    consequenceHint: 'una FC en reposo más alta que tu patrón habitual puede indicar estrés, fatiga acumulada, deshidratación o un cuadro viral iniciando.',
    // Sin fallback genérico: la FC en reposo "normal" varía demasiado entre personas
    // (condición física, edad, medicación) como para dar un número universal responsable.
  },
  {
    key: 'disponible', label: 'Saldo disponible en Finanzas (pesos)', unit: ' pesos', cumulative: false, concerningDirection: 'below', trend: false,
    consequenceHint: 'tu disponible está por debajo de tu patrón habitual este período — puede valer la pena revisar gastos inusuales.',
    // Sin fallback genérico: es un monto absoluto, no tiene sentido un "genérico" entre usuarios.
  },
  {
    key: 'savingsRate', label: 'Tasa de ahorro en Finanzas', unit: '%', cumulative: false, concerningDirection: 'below', trend: false, // depende de cuántos gastos se anotan
    consequenceHint: 'tu tasa de ahorro está por debajo de tu patrón habitual — nada urgente, pero vale la pena mirar el mes.',
    genericFallback: 20, // regla general de finanzas personales (20% del ingreso)
  },
  {
    key: 'moodScore', label: 'Ánimo', unit: '/5', cumulative: false, concerningDirection: 'below',
    consequenceHint: 'un ánimo sostenidamente más bajo que tu propio patrón puede reflejar estrés, sobrecarga o cambios que vale la pena revisar — no es un diagnóstico, es una señal para prestarle atención.',
    // Sin fallback genérico: no existe un "ánimo normal" universal — es puramente personal, igual que la FC en reposo.
  },
];

const MIN_DAYS_ALL = 7;
const MIN_DAYS_WORKDAY = 5;
const MIN_DAYS_WEEKEND = 3;
const MATERIALITY_PCT = 20;
const WAKE_HOUR = 7, SLEEP_HOUR = 23;

const TREND_WINDOW_DAYS = 7;   // semana "reciente" vs. semana "anterior"
const MIN_TREND_DAYS = 4;      // mínimo de muestras en CADA ventana para no fiarse de 1-2 datos
const TREND_MATERIALITY_PCT = 20;

export type Confidence = 'insufficient' | 'generic' | 'verified' | 'workday' | 'weekend' | 'all_days';

/** Un número que el usuario confirmó viene de una fuente real (médico, especialista) — reemplaza la referencia genérica, nunca el promedio personal. */
export interface VerifiedTarget { value: number; source: string; setAt: string }

/** Contexto opcional para el diagnóstico: perfil médico (ajustes KB), objetivos verificados por el usuario, y métricas silenciadas temporalmente (feedback tipo "esto no aplica"). */
export interface DiagnosisContext {
  medical?: MedicalProfile | null;
  overrides?: Partial<Record<MetricKey, VerifiedTarget>>;
  dismissals?: Partial<Record<MetricKey, string>>; // metricKey -> ISO "silenciado hasta"
  /** Peso más reciente conocido (health_snapshot_latest) — habilita dynamicFallback para métricas como proteína. */
  weightKg?: number;
  /**
   * El sueño de la persona (dayCtxFrom del snapshot). Con esto "hoy" es el día de COMIDA (a las 2 AM sin haber dormido sigue
   * siendo ayer) y lo esperable a esta hora se corre para quien trasnocha.
   */
  day?: DayCtx;
}

export interface MetricDiagnosis {
  key: MetricKey;
  label: string;
  unit: string;
  todayValue: number | null;
  expected: number | null;
  deltaPct: number | null;
  confidence: Confidence;
  samples: number;
  consequenceHint: string;
  flagged: boolean;
  /** Presente solo si el valor genérico fue ajustado por una condición médica conocida. */
  genericAdjustmentReason?: string;
  /** Hoy casi no hay comida anotada: el valor no dice cuánto comió, así que no se compara (ver needsFoodLog). */
  unlogged?: boolean;
}

export type TrendDirection = 'improving' | 'worsening' | 'stable';

export interface MetricTrend {
  key: MetricKey;
  label: string;
  unit: string;
  direction: TrendDirection;
  recentAvg: number | null;   // promedio de los últimos 7 días completos (sin contar hoy, que puede estar a medias)
  priorAvg: number | null;    // promedio de los 7 días antes de esos
  changePct: number | null;
  daysAnalyzed: number;       // mínimo de muestras entre ambas ventanas
  consequenceHint: string;
  significant: boolean;       // suficientes datos + cambio relevante en la dirección que importa (para cualquiera de los dos sentidos)
}

export interface BaselineReadiness {
  /** true una vez que hay suficiente historial para que el análisis sea 100% personal (no genérico). */
  unlocked: boolean;
  daysTracked: number;
  minDays: number;
  daysRemaining: number;
}

export interface BaselineDiagnosis {
  daysTracked: number;
  readiness: BaselineReadiness;
  primary: MetricDiagnosis | null;
  all: MetricDiagnosis[];
  /** La tendencia multi-semana más significativa (si hay alguna) — distinta del desvío de hoy: una sí implica un patrón sostenido, la otra puede ser un día atípico. */
  primaryTrend: MetricTrend | null;
  trends: MetricTrend[];
}

function isWorkday(dateKey: string): boolean {
  const [y, m, d] = dateKey.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay(); // 0=domingo, 6=sábado
  return day >= 1 && day <= 5;
}

/** `h`: la hora del día de la persona (normDayHour: 7,5 + horas despierta; sin despertar conocido, el reloj). */
function fractionOfDayElapsed(h: number): number {
  return Math.min(1, Math.max(0, (h - WAKE_HOUR) / (SLEEP_HOUR - WAKE_HOUR)));
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function diagnoseMetric(spec: MetricSpec, log: DailyRollupEntry[], todayKey: string, now: Date, ctx: DiagnosisContext): MetricDiagnosis {
  const foodLogged = (e: DailyRollupEntry | undefined) => (e?.calories ?? 0) >= FOOD_LOGGED_MIN_KCAL;
  const historical = log.filter(e => e.date !== todayKey && typeof e[spec.key] === 'number' && (!spec.needsFoodLog || foodLogged(e)));
  const todayEntry = log.find(e => e.date === todayKey);
  const unlogged = !!spec.needsFoodLog && !foodLogged(todayEntry);
  const todayValueRaw = todayEntry && typeof todayEntry[spec.key] === 'number' ? (todayEntry[spec.key] as number) : null;

  const todayIsWorkday = isWorkday(todayKey);
  const sameBucket = historical.filter(e => isWorkday(e.date) === todayIsWorkday);
  const minBucket = todayIsWorkday ? MIN_DAYS_WORKDAY : MIN_DAYS_WEEKEND;

  let confidence: Confidence = 'insufficient';
  let baselineAvg: number | null = null;
  let samples = 0;
  let genericAdjustmentReason: string | undefined;

  if (sameBucket.length >= minBucket) {
    baselineAvg = mean(sameBucket.map(e => e[spec.key] as number));
    confidence = todayIsWorkday ? 'workday' : 'weekend';
    samples = sameBucket.length;
  } else if (historical.length >= MIN_DAYS_ALL) {
    baselineAvg = mean(historical.map(e => e[spec.key] as number));
    confidence = 'all_days';
    samples = historical.length;
  } else {
    samples = historical.length;
    const verified = ctx.overrides?.[spec.key];
    if (verified) {
      // El usuario aportó un número real de una fuente concreta (ej. su médico) —
      // pesa más que cualquier referencia genérica, pero nunca reemplaza el
      // promedio personal real una vez que exista suficiente historial.
      baselineAvg = verified.value;
      genericAdjustmentReason = `un valor indicado por el usuario (fuente: ${verified.source}), no una estimación de Eris`;
      confidence = 'verified';
    } else {
      const base = spec.dynamicFallback?.(ctx) ?? spec.genericFallback;
      if (base !== undefined) {
        // Sin historial personal suficiente todavía: usar la referencia general
        // (o una más precisa si hay datos como peso, ver dynamicFallback) en
        // vez de quedarnos sin poder decir nada — ajustada por condiciones
        // médicas conocidas cuando aplica (nunca el promedio personal: ese ya
        // refleja la realidad real del usuario).
        const kbAdj = getNumericAdjustment(ctx.medical, spec.key);
        baselineAvg = kbAdj ? Math.round(base * kbAdj.multiplier * 100) / 100 : base;
        genericAdjustmentReason = kbAdj?.reason;
        confidence = 'generic';
      }
    }
  }

  let expected: number | null = null;
  if (baselineAvg !== null) {
    expected = spec.cumulative ? baselineAvg * fractionOfDayElapsed(normDayHour(now, ctx.day ? wakeHourFor(ctx.day, now) : undefined)) : baselineAvg;
  }

  let deltaPct: number | null = null;
  let flagged = false;
  if (expected !== null && expected > 0 && todayValueRaw !== null && confidence !== 'insufficient' && !unlogged && !spec.skip?.(ctx)) {
    deltaPct = Math.round(((todayValueRaw - expected) / expected) * 100);
    const deviatesInConcerningDirection = spec.concerningDirection === 'below' ? deltaPct < 0 : deltaPct > 0;
    flagged = deviatesInConcerningDirection && Math.abs(deltaPct) >= MATERIALITY_PCT;
  }

  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    todayValue: todayValueRaw,
    expected: expected !== null ? Math.round(expected * 100) / 100 : null,
    deltaPct,
    confidence,
    samples,
    consequenceHint: spec.consequenceHint,
    flagged,
    genericAdjustmentReason,
    ...(unlogged ? { unlogged: true } : {}),
  };
}

/**
 * Compara la última semana completa (sin contar hoy, que puede estar a medias)
 * contra la semana anterior, para distinguir una tendencia sostenida de un
 * desvío de un solo día — algo que diagnoseMetric() no puede ver porque solo
 * mira hoy contra un promedio histórico plano.
 */
function detectTrend(spec: MetricSpec, log: DailyRollupEntry[], todayKey: string, ctx: DiagnosisContext = {}): MetricTrend {
  const dated = log
    .filter(e => e.date !== todayKey && typeof e[spec.key] === 'number')
    .map(e => ({ date: e.date, value: e[spec.key] as number }))
    .sort((a, b) => b.date.localeCompare(a.date)); // más reciente primero

  const recent = dated.slice(0, TREND_WINDOW_DAYS);
  const prior = dated.slice(TREND_WINDOW_DAYS, TREND_WINDOW_DAYS * 2);
  const daysAnalyzed = Math.min(recent.length, prior.length);

  const base = {
    key: spec.key, label: spec.label, unit: spec.unit,
    consequenceHint: spec.consequenceHint, daysAnalyzed,
  };

  if (daysAnalyzed < MIN_TREND_DAYS || spec.trend === false || spec.skip?.(ctx)) {
    return { ...base, direction: 'stable', recentAvg: null, priorAvg: null, changePct: null, significant: false };
  }

  const recentAvg = mean(recent.map(d => d.value));
  const priorAvg = mean(prior.map(d => d.value));
  const changePct = priorAvg > 0 ? Math.round(((recentAvg - priorAvg) / priorAvg) * 100) : null;

  let direction: TrendDirection = 'stable';
  let significant = false;
  if (changePct !== null && Math.abs(changePct) >= TREND_MATERIALITY_PCT) {
    const worsens = spec.concerningDirection === 'below' ? changePct < 0 : changePct > 0;
    direction = worsens ? 'worsening' : 'improving';
    significant = true;
  }

  return {
    ...base,
    direction,
    recentAvg: Math.round(recentAvg * 100) / 100,
    priorAvg: Math.round(priorAvg * 100) / 100,
    changePct,
    significant,
  };
}

export function diagnoseBaseline(log: DailyRollupEntry[], now: Date = new Date(), ctx: DiagnosisContext = {}): BaselineDiagnosis {
  const todayKey = ctx.day ? isoDayKey(nutritionDayOf(now, ctx.day)) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const all = METRICS.map(spec => diagnoseMetric(spec, log, todayKey, now, ctx));
  const trends = METRICS.map(spec => detectTrend(spec, log, todayKey, ctx));

  // Una métrica "silenciada" (el usuario dijo "esto no me sirve") nunca vuelve a
  // computarse distinto — solo se excluye de ser LA que se comenta, por un tiempo.
  // Esto es deliberado: el usuario puede tener razón o no, así que la aritmética
  // no cambia, solo dejamos de insistir con ese tema mientras dure el silencio.
  const isDismissed = (key: MetricKey) => {
    const until = ctx.dismissals?.[key];
    return !!until && new Date(until).getTime() > now.getTime();
  };

  const significantTrends = trends.filter(t => t.significant && !isDismissed(t.key));
  const primaryTrend = significantTrends.length > 0
    ? significantTrends.reduce((worst, t) => Math.abs(t.changePct ?? 0) > Math.abs(worst.changePct ?? 0) ? t : worst)
    : null;

  // Preferir una variable con confianza PERSONAL (workday/weekend/all_days) por sobre
  // una genérica — si algo ya se desvía de tu propio patrón, eso pesa más que un
  // aviso basado en un valor de referencia general.
  const flaggedMetrics = all.filter(m => m.flagged && !isDismissed(m.key));
  const personalFlags = flaggedMetrics.filter(m => m.confidence !== 'generic');
  const pool = personalFlags.length > 0 ? personalFlags : flaggedMetrics;
  const primary = pool.length > 0
    ? pool.reduce((worst, m) => Math.abs(m.deltaPct ?? 0) > Math.abs(worst.deltaPct ?? 0) ? m : worst)
    : null;

  const daysTracked = new Set(log.map(e => e.date)).size;
  const readiness: BaselineReadiness = {
    unlocked: daysTracked >= MIN_DAYS_ALL,
    daysTracked,
    minDays: MIN_DAYS_ALL,
    daysRemaining: Math.max(0, MIN_DAYS_ALL - daysTracked),
  };

  return { daysTracked, readiness, primary, all, primaryTrend, trends };
}

function confidenceLabel(c: Confidence): string {
  switch (c) {
    case 'workday': return 'basado en TUS días laborales anteriores';
    case 'weekend': return 'basado en TUS fines de semana anteriores';
    case 'all_days': return 'basado en TODOS tus días registrados';
    case 'generic': return 'valor de REFERENCIA GENERAL (todavía no es tu patrón personal)';
    case 'verified': return 'un objetivo que TÚ confirmaste con una fuente real (no una estimación de Eris)';
    default: return 'sin base suficiente';
  }
}

export function formatDiagnosisForLLM(diag: BaselineDiagnosis): string {
  const readinessLine = diag.readiness.unlocked
    ? `Estado del perfil: DESBLOQUEADO — ya tienes ${diag.readiness.daysTracked} días de historial, suficiente para análisis 100% personal en la mayoría de las métricas.`
    : `Estado del perfil: EN APRENDIZAJE — llevas ${diag.readiness.daysTracked}/${diag.readiness.minDays} días de historial. Faltan ${diag.readiness.daysRemaining} días para desbloquear análisis 100% personalizado. Mientras tanto, algunas comparaciones usan valores de referencia general — sé SIEMPRE transparente cuando ese sea el caso, nunca los presentes como si fueran el patrón propio del usuario.`;

  if (diag.daysTracked === 0) {
    return `${readinessLine}\nHistorial: 0 días registrados aún. No hay patrón personal que calcular todavía — dile al usuario que estás empezando a aprender su rutina, que por ahora usarás referencias generales y que en unos días podrás darle análisis personalizados de verdad.`;
  }

  const lines: string[] = [readinessLine, `Historial disponible: ${diag.daysTracked} días.`];

  if (diag.primary) {
    const m = diag.primary;
    const isGeneric = m.confidence === 'generic';
    const isVerified = m.confidence === 'verified';
    const showsSamples = !isGeneric && !isVerified;
    let instruction: string;
    if (isGeneric) {
      instruction = `IMPORTANTE: esta comparación es contra un valor GENÉRICO de referencia, no contra el patrón personal del usuario — dilo explícitamente en tu respuesta (ej. "por ahora comparo con una referencia general, todavía no tengo suficiente historial tuyo"). Redacta 1-3 frases mencionando SOLO esta variable.`;
    } else if (isVerified) {
      instruction = `IMPORTANTE: este NO es un valor genérico ni una estimación de Eris — es un objetivo que el propio usuario confirmó con una fuente real. Compáralo con respeto a esa fuente (ej. "según lo que te indicó tu médico..."), nunca lo trates como un número inventado por ti. Redacta 1-3 frases mencionando SOLO esta variable.`;
    } else {
      instruction = `Redacta 1-3 frases mencionando SOLO esta variable, comparando explícitamente con "tu promedio habitual" (nunca un número genérico de industria).`;
    }
    lines.push(
      `VARIABLE PRINCIPAL A COMENTAR: ${m.label}.`,
      `- Valor de hoy: ${m.todayValue}${m.unit}`,
      `- Punto de comparación a esta hora (${confidenceLabel(m.confidence)}${showsSamples ? `, ${m.samples} muestras` : ''}): ${m.expected}${m.unit}`,
      `- Desviación: ${m.deltaPct}% respecto a ese punto de comparación`,
      `- Pista de consecuencia (usar solo si aplica, no inventar más): ${m.consequenceHint}`,
      instruction,
      ...(m.genericAdjustmentReason && isGeneric ? [`- Este valor de referencia fue ${m.genericAdjustmentReason} Menciónalo brevemente — es relevante para el usuario.`] : [])
    );
  } else {
    const insufficientCount = diag.all.filter(m => m.confidence === 'insufficient').length;
    if (insufficientCount === diag.all.length) {
      lines.push('Ninguna métrica tiene ni historial personal ni referencia genérica disponible todavía. Dile al usuario que sigues aprendiendo su patrón.');
    } else {
      lines.push('Nada se desvía de forma significativa (ni de tu patrón personal ni de las referencias generales) hoy. Coméntalo brevemente en tono positivo, sin alarmismo.');
    }
  }

  const unlogged = diag.all.filter(m => m.unlogged).map(m => m.label.toLowerCase());
  if (unlogged.length) {
    lines.push(`NOTA: hoy todavía casi no hay comida anotada, así que no sabes cuánta ${unlogged.join(' ni ')} lleva. NO digas que comió poco ni des porcentajes de eso; como mucho, recuérdale en una frase corta que anote lo que coma.`);
  }

  if (diag.primaryTrend) {
    const t = diag.primaryTrend;
    lines.push(
      `TENDENCIA SOSTENIDA DETECTADA (distinta de lo de hoy): ${t.label}.`,
      `- Promedio de esta última semana: ${t.recentAvg}${t.unit}`,
      `- Promedio de la semana anterior: ${t.priorAvg}${t.unit}`,
      `- Cambio: ${t.changePct}% (${t.direction === 'worsening' ? 'empeorando' : 'mejorando'}) a lo largo de ${t.daysAnalyzed}+ días por ventana`,
      t.direction === 'worsening'
        ? `- Pista de consecuencia (usar solo si aplica): ${t.consequenceHint}`
        : '',
      `IMPORTANTE: esto es una TENDENCIA de varios días, no el desvío de hoy — son dos cosas distintas, no las mezcles en una sola frase confusa. Un patrón sostenido de ${t.daysAnalyzed}+ días pesa más y merece más atención/urgencia que un día atípico puntual. Si es 'empeorando', dilo con más seriedad que un desvío diario; si es 'mejorando', reconoce el progreso sostenido explícitamente — eso también es información valiosa para el usuario.`
    );
  }

  return lines.filter(Boolean).join('\n');
}
