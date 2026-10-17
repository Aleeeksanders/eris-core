/**
 * financeCore — las reglas de Finanzas, puras: el mismo estado y la misma hora dan siempre lo mismo.
 *
 * 2026-10-15 (Finanzas 2.0, F1): se portaron TAL CUAL las reglas que vivían dentro de assets/hunter-wallet.html (libro
 * único, saldos calculados, cuotas, sueldo con «¿Llegó?», fijos, préstamos, operaciones del chat). La app nativa y el
 * servidor usan este mismo archivo: eris/src/services/FinanceCore.ts es COPIA EXACTA (scripts/sync_finance_core.ts) y
 * scripts/finance_parity_test.ts revisa que sigan iguales. Sin imports: nada del teléfono ni del servidor.
 *
 * El estado es lo que antes eran las claves hw* del localStorage (fromHwKeys / toHwKeys convierten en los dos sentidos),
 * así el respaldo cifrado del PC (FinanceBackup) sirve igual para la versión web y la nativa.
 *
 * LIBRO ÚNICO: un libro de movimientos (tx) y cada cuenta guarda solo su saldo inicial; los saldos se CALCULAN.
 *   movimiento: {id, tipo, fecha, monto, desde?, hacia?, desc, cat?, fuente?, prestamoId?, devolucion?, recurId?, via?}
 *     gasto (desde) · ingreso (hacia; fuente sueldo|extra|pasivo) · abono (hacia; plata que entra y NO es ingreso)
 *     giro / transfer (desde → hacia) · ajuste (hacia, ±) · prestamo (desde) · cobro (prestamoId → hacia) · ahorro
 *   cuenta: {id, nombre, banco, tipo: efectivo|debito|credito|ahorro, saldoInicial, cupo?, archivada?}
 *   Tarjeta de crédito: "saldo" = cupo disponible (saldoInicial = cupo − deuda inicial); deuda = cupo − saldo.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────

export type Ref = string | number;
export type TipoCuenta = 'efectivo' | 'debito' | 'credito' | 'ahorro';
export type Fuente = 'sueldo' | 'extra' | 'pasivo';
export type TipoTx = 'gasto' | 'ingreso' | 'abono' | 'giro' | 'transfer' | 'ajuste' | 'prestamo' | 'cobro' | 'ahorro';

export interface CuentaDef { id: Ref; nombre: string; banco?: string; tipo: TipoCuenta; saldoInicial: number; cupo?: number; archivada?: boolean }
export interface Tx {
  id: number | string; tipo: TipoTx; fecha: string; monto: number; desc: string;
  desde?: Ref | null; hacia?: Ref | null; cat?: string; fuente?: Fuente | string; prestamoId?: number | string;
  devolucion?: string; recurId?: number | string; progId?: number | string; progMes?: string; via?: string; cuotas?: number;
  [k: string]: unknown;
}
export interface Prog { id: number | string; tipo: 'gasto' | 'ingreso'; desc: string; monto: number; dia: number; cuenta?: Ref | null; cat?: string; fuente?: Fuente | string; parte?: string }
export interface Meta { id: number | string; desc: string; target: number; fecha?: string }
export interface SueldoHist { id: number | string; monto: number; fecha: string; desc?: string }
export interface ChatLogEntry { tipo: string; id: number | string; at: number }

export interface FinanceState {
  cuentas: CuentaDef[];          // hw2_cuentas
  tx: Tx[];                      // hw2_tx
  prog: Prog[];                  // hw2_prog
  rec: string[];                 // hw2_rec_applied ("idProg:AAAA-MM" resueltos)
  sueldo: SueldoHist[];          // hw2_sueldo
  presup: Record<string, number>; // hw_presup
  metas: Meta[];                 // hw_metas
  sm: number;                    // hw_sm (sueldo mínimo)
  lastCuenta: Ref | null;        // hw_last_cuenta
  chatLog: ChatLogEntry[];       // hw_chat_log
  setupDone: boolean;            // hw_setup_done
  /** las demás claves hw* tal cual (respaldos de migraciones, versión del libro…): se conservan al convertir */
  extra: Record<string, string>;
}

/** Lo que necesita una operación que escribe: la hora y cómo crear ids nuevos. */
export interface Ctx { now: Date; newId: () => number }

export const CASH = 'cash';
export const CASH_DEF: CuentaDef = { id: CASH, nombre: 'Efectivo', banco: '', tipo: 'efectivo', saldoInicial: 0 };
export const FUENTES: Record<Fuente, { icon: string; label: string }> = { sueldo: { icon: '💼', label: 'Sueldo' }, extra: { icon: '⚡', label: 'Extra' }, pasivo: { icon: '🌱', label: 'Pasivo' } };
/** Las de la web + Hogar/aseo (2026-10-15: lo pide la boleta del súper: detergente, papel, limpieza) */
export const CATEGORIAS = ['vivienda', 'alimentacion', 'transporte', 'salud', 'entretenimiento', 'deuda', 'educacion', 'hogar', 'otros'] as const;
export const SM_DEFAULT = 510000;

export function emptyState(): FinanceState {
  return { cuentas: [], tx: [], prog: [], rec: [], sueldo: [], presup: {}, metas: [], sm: SM_DEFAULT, lastCuenta: null, chatLog: [], setupDone: false, extra: {} };
}

// ─── Fechas y textos ──────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
/** Fecha LOCAL (toISOString es UTC: en Chile, pasadas las 20-21 h, fechaba al día siguiente). */
export const todayStr = (now: Date) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
export const mesStr = (m: number, a: number) => `${a}-${pad(m + 1)}`;
export const mesActual = (now: Date) => mesStr(now.getMonth(), now.getFullYear());
export const foldTxt = (s: unknown) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** $1.234.567 (a mano: el motor de JavaScript del teléfono no siempre trae el formato es-CL) */
export const clp = (n: number) => '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** "me llegó el sueldo / el bono / los dividendos": plata que entra y SÍ es ingreso (cuenta para el mes) */
const FUENTE_RX: Array<[RegExp, Fuente]> = [
  [/\b(sueldo|quincena|anticipo|remuneracion|liquidacion)\b/, 'sueldo'],
  [/\b(dividendos?|intereses?|arriendo|rentabilidad|cupones?|renta)\b/, 'pasivo'],
  [/\b(bono|aguinaldo|gratificacion|honorarios?|boleta|freelance|pololo|pega extra|venta|vendi|propinas?|comision(es)?)\b/, 'extra'],
];
export const fuenteDe = (txt: unknown): Fuente | null => { const f = foldTxt(txt); for (const [re, k] of FUENTE_RX) if (re.test(f)) return k; return null; };

export const diaEnMes = (dia: unknown, ms: string) => { const [y, m] = ms.split('-').map(Number); return Math.min(Number(dia) || 1, new Date(y, m, 0).getDate()); };
export const fechaProg = (p: Prog, ms: string) => `${ms}-${pad(diaEnMes(p.dia, ms))}`;
export const mesesEntre = (fecha: string, ms: string) => { const [y1, m1] = String(fecha).slice(0, 7).split('-').map(Number), [y2, m2] = ms.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };
export const valorCuota = (g: { monto: number; cuotas: number }, k: number) => { const base = Math.floor(g.monto / g.cuotas); return k === g.cuotas ? g.monto - base * (g.cuotas - 1) : base; };
export const mesSiguiente = (ms: string) => { const [y, m] = ms.split('-').map(Number); return mesStr(m % 12, y + (m === 12 ? 1 : 0)); };
export const deudaDe = (c: { tipo: string; cupo?: number; saldo: number } | null | undefined) => (c && c.tipo === 'credito' ? Math.max(0, (c.cupo || 0) - c.saldo) : 0);

// ─── El libro ─────────────────────────────────────────────────────────────

export const defsAll = (S: FinanceState): CuentaDef[] => (S.cuentas.some((c) => c.id === CASH) ? S.cuentas : [CASH_DEF, ...S.cuentas]);

export interface Estado {
  defs: CuentaDef[]; tx: Tx[]; bal: Record<string, number>;
  def: (ref: Ref | null | undefined) => CuentaDef | undefined;
  activa: (ref: Ref | null | undefined) => boolean;
  nombre: (ref: Ref | null | undefined) => string;
  tipo: (ref: Ref | null | undefined) => TipoCuenta;
  cuentas: Array<CuentaDef & { saldo: number }>;
  efectivo: number;
}

/** Foto calculada del libro: saldos y cuentas visibles. */
export function estado(S: FinanceState): Estado {
  const defs = defsAll(S), tx = S.tx, bal: Record<string, number> = {};
  defs.forEach((c) => { bal[String(c.id)] = Number(c.saldoInicial) || 0; });
  for (const t of tx) {
    if (t.desde != null && String(t.desde) in bal) bal[String(t.desde)] -= t.monto;
    if (t.hacia != null && String(t.hacia) in bal) bal[String(t.hacia)] += t.monto;
  }
  const def = (ref: Ref | null | undefined) => (ref == null ? undefined : defs.find((c) => c.id === ref));
  const activa = (ref: Ref | null | undefined) => { const c = def(ref); return !!c && !c.archivada; };
  const nombre = (ref: Ref | null | undefined) => (def(ref) || ({} as CuentaDef)).nombre || 'cuenta eliminada';
  const tipo = (ref: Ref | null | undefined) => ((def(ref) || ({} as CuentaDef)).tipo || 'debito') as TipoCuenta;
  const cuentas = defs.filter((c) => c.id !== CASH && !c.archivada).map((c) => ({ ...c, saldo: bal[String(c.id)] || 0 }));
  return { defs, tx, bal, def, activa, nombre, tipo, cuentas, efectivo: bal[CASH] || 0 };
}

export interface GastoVista { id: number | string; desc: string; monto: number; cat?: string; fecha: string; via?: string; progId?: unknown; cuotas?: number; cuenta?: Ref; cuentaNombre?: string; cuentaTipo?: TipoCuenta; compraCuotas?: boolean; compraTotal?: number; cuotaN?: number }
export interface DeudaVista { id: number | string; desc: string; fecha: string; devolucion?: string; original: number; cobrado: boolean; monto: number; cuenta?: Ref; cuentaNombre?: string }

/** Las listas que muestra la app, sacadas del libro. */
export function vistas(E: Estado) {
  const { tx, nombre, tipo } = E;
  const gastos: GastoVista[] = tx.filter((t) => t.tipo === 'gasto').map((t) => ({
    id: t.id, desc: t.desc, monto: t.monto, cat: t.cat, fecha: t.fecha, via: t.via, progId: t.progId ?? t.recurId, ...(Number(t.cuotas) > 1 ? { cuotas: t.cuotas } : {}),
    ...(t.desde != null ? { cuenta: t.desde, cuentaNombre: nombre(t.desde), cuentaTipo: tipo(t.desde) } : {}),
  }));
  const movs = tx.filter((t) => ['giro', 'abono', 'transfer', 'ajuste', 'ingreso'].includes(t.tipo)).map((t) => ({
    ...t, ...(t.desde != null ? { desdeNombre: nombre(t.desde) } : {}), haciaNombre: t.hacia != null ? nombre(t.hacia) : 'sin cuenta',
  }));
  const cobrado: Record<string, number> = {};
  tx.forEach((t) => { if (t.tipo === 'cobro') cobrado[String(t.prestamoId)] = (cobrado[String(t.prestamoId)] || 0) + t.monto; });
  const meDeban: DeudaVista[] = tx.filter((t) => t.tipo === 'prestamo').map((t) => {
    const pend = t.monto - (cobrado[String(t.id)] || 0);
    return { id: t.id, desc: t.desc, fecha: t.fecha, devolucion: t.devolucion, original: t.monto, cobrado: pend <= 0, monto: pend <= 0 ? t.monto : pend,
      ...(t.desde != null ? { cuenta: t.desde, cuentaNombre: nombre(t.desde) } : {}) };
  });
  const ahorros = tx.filter((t) => t.tipo === 'ahorro').map((t) => ({ id: t.id, desc: t.desc, monto: t.monto, fecha: t.fecha, desde: t.desde,
    ...(t.desde != null ? { desdeNombre: nombre(t.desde) } : {}), haciaNombre: nombre(t.hacia) }));
  const ahorroAcum = E.defs.filter((c) => c.tipo === 'ahorro' && !c.archivada).reduce((a, c) => a + (E.bal[String(c.id)] || 0), 0);
  return { gastos, movs, meDeban, ahorros, ahorroAcum };
}

// ─── Sueldo y fijos ───────────────────────────────────────────────────────

/** Historial de cambios de sueldo (solo registro; el que se usa sale de lo programado, ver sueldoEsperado). */
export function sueldoVigente(S: FinanceState, now: Date): number {
  const hoy = todayStr(now), s = [...S.sueldo].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return Number((s.find((x) => String(x.fecha) <= hoy) || s[s.length - 1] || ({} as SueldoHist)).monto) || 0;
}
/** Sueldo esperado del mes = lo programado como sueldo (sueldo + anticipo); sin programar, el del onboarding. */
export function sueldoEsperado(S: FinanceState, now: Date): number {
  const s = S.prog.filter((p) => p.tipo === 'ingreso' && p.fuente === 'sueldo').reduce((a, p) => a + (Number(p.monto) || 0), 0);
  return s > 0 ? s : sueldoVigente(S, now);
}
/** Ingresos fijos cuyo día ya llegó este mes y que todavía no se confirman (ni se marcaron "no llegó"). */
export function ingresosPendientes(S: FinanceState, now: Date) {
  const ms = mesActual(now), hoy = now.getDate(), hechos = new Set(S.rec);
  return S.prog.filter((p) => p.tipo === 'ingreso' && diaEnMes(p.dia, ms) <= hoy && !hechos.has(`${p.id}:${ms}`)).map((p) => ({ ...p, fecha: fechaProg(p, ms) }));
}
/** Próximos fijos (gastos e ingresos) de los siguientes `dias` días. */
export function proximosProgramados(S: FinanceState, now: Date, dias = 10) {
  const out: Array<Prog & { fecha: string; enDias: number }> = [], hechos = new Set(S.rec);
  for (let i = 0; i <= dias; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i), ms = mesStr(d.getMonth(), d.getFullYear());
    for (const p of S.prog) if (diaEnMes(p.dia, ms) === d.getDate() && !hechos.has(`${p.id}:${ms}`)) out.push({ ...p, fecha: fechaProg(p, ms), enDias: i });
  }
  return out;
}

// ─── Escribir (copia de trabajo) ─────────────────────────────────────────
// Las funciones que cambian algo trabajan sobre una copia (draft) y la devuelven: el estado original no se toca.

export function draft(S: FinanceState): FinanceState {
  return { ...S, cuentas: [...S.cuentas], tx: [...S.tx], prog: [...S.prog], rec: [...S.rec], sueldo: [...S.sueldo], presup: { ...S.presup },
    metas: [...S.metas], chatLog: [...S.chatLog], extra: { ...S.extra } };
}
export function addTx(W: FinanceState, t: Partial<Tx> & { tipo: TipoTx; monto: number; desc: string }, ctx: Ctx): Tx {
  const n = { id: ctx.newId(), fecha: todayStr(ctx.now), ...t } as Tx;
  W.tx = [...W.tx, n];
  return n;
}
const marcarMes = (W: FinanceState, key: string, on = true) => { const s = new Set(W.rec); if (on) s.add(key); else s.delete(key); W.rec = [...s]; };

/** "Llegó": entra a su cuenta (o a la que digas) y queda como ingreso de su fuente. */
export function confirmarIngreso(W: FinanceState, p: Prog, opts: { monto?: number; hacia?: Ref | null; via?: string }, ctx: Ctx): Tx {
  const ms = mesActual(ctx.now), E = estado(W);
  const dst = opts.hacia !== undefined ? opts.hacia : (p.cuenta != null && E.activa(p.cuenta) ? p.cuenta : null);
  const t = addTx(W, { tipo: 'ingreso', fuente: p.fuente || 'extra', monto: Math.round(Number(opts.monto ?? p.monto) || 0), hacia: dst, desc: p.desc, progId: p.id, progMes: ms, ...(opts.via ? { via: opts.via } : {}) }, ctx);
  marcarMes(W, `${p.id}:${ms}`);
  return t;
}
export const descartarIngreso = (W: FinanceState, p: Prog, now: Date) => marcarMes(W, `${p.id}:${mesActual(now)}`);

/** Borra del libro con lo que cuelga: un préstamo se lleva sus cobros; un ingreso fijo confirmado vuelve a "¿llegó?". */
export function borrarTx(W: FinanceState, id: Tx['id']): Tx | null {
  const t = W.tx.find((x) => x.id === id);
  if (!t) return null;
  W.tx = W.tx.filter((x) => !(x.id === id || (t.tipo === 'prestamo' && x.tipo === 'cobro' && x.prestamoId === id)));
  if (t.tipo === 'ingreso' && t.progId != null && t.progMes) marcarMes(W, `${t.progId}:${t.progMes}`, false);
  return t;
}

/** Ingreso de un mes = sueldo + extras + pasivos. Mes en curso: lo esperado si solo llegó el anticipo. */
export function ingresoDelMes(tx: Tx[], ms: string, sueldo: number, now: Date) {
  const ing = tx.filter((t) => t.tipo === 'ingreso' && String(t.fecha).startsWith(ms));
  const sum = (f: (t: Tx) => boolean) => ing.filter(f).reduce((a, t) => a + t.monto, 0);
  const recibido = sum((t) => t.fuente === 'sueldo'), pasivo = sum((t) => t.fuente === 'pasivo'), extra = sum((t) => t.fuente !== 'sueldo' && t.fuente !== 'pasivo');
  const sueldoMes = ms >= mesActual(now) ? Math.max(recibido, sueldo) : (recibido || sueldo);
  return { total: sueldoMes + extra + pasivo, sueldo: sueldoMes, recibido, otros: extra + pasivo, extra, pasivo, sueldoLlego: recibido > 0 };
}

/** La cuenta de ahorro donde va lo que se ahorra (se crea "Ahorro" la primera vez). */
export function cuentaAhorro(W: FinanceState, ctx: Ctx): Ref {
  const d = defsAll(W), a = d.find((c) => c.tipo === 'ahorro' && !c.archivada);
  if (a) return a.id;
  const id = ctx.newId();
  W.cuentas = [...d, { id, nombre: 'Ahorro', banco: '', tipo: 'ahorro', saldoInicial: 0 }];
  return id;
}

/** Gastos fijos: cada uno se anota cuando llega SU día (no antes) y descuenta de su cuenta, si tiene una. */
export function aplicarProgramados(W: FinanceState, ctx: Ctx): number {
  const progs = W.prog.filter((p) => p.tipo === 'gasto');
  if (!progs.length) return 0;
  const ms = mesActual(ctx.now), hoy = ctx.now.getDate(), hechos = new Set(W.rec), E = estado(W), nuevos: Tx[] = [];
  for (const p of progs) {
    const key = `${p.id}:${ms}`;
    if (diaEnMes(p.dia, ms) > hoy || hechos.has(key)) continue;
    hechos.add(key);
    nuevos.push({ id: ctx.newId(), tipo: 'gasto', fecha: fechaProg(p, ms), monto: Number(p.monto) || 0, desde: p.cuenta != null && E.activa(p.cuenta) ? p.cuenta : null,
      cat: p.cat || 'otros', desc: `${p.desc} ↻`, progId: p.id, progMes: ms });
  }
  if (!nuevos.length) return 0;
  W.tx = [...E.tx, ...nuevos];
  W.rec = [...hechos];
  return nuevos.length;
}

// ─── Cuotas (tarjeta de crédito) ──────────────────────────────────────────
// La compra usa el cupo completo al tiro, pero como GASTO del mes cuenta una cuota por mes desde el mes siguiente.

/** Lo que pesa cada gasto en un mes: completo en su mes, o la cuota que le toca (la compra aparece en su mes con $0). */
export function gastosDelMes(gastos: GastoVista[], ms: string): GastoVista[] {
  const out: GastoVista[] = [];
  for (const g of gastos) {
    if (Number(g.cuotas) > 1) {
      const k = mesesEntre(g.fecha, ms), c = Number(g.cuotas);
      if (k === 0) out.push({ ...g, monto: 0, compraCuotas: true, compraTotal: g.monto });
      else if (k >= 1 && k <= c) out.push({ ...g, monto: valorCuota({ monto: g.monto, cuotas: c }, k), cuotaN: k, compraTotal: g.monto });
    } else if (String(g.fecha).startsWith(ms)) out.push(g);
  }
  return out;
}
/** Cuotas que faltan por cobrar DESPUÉS de este mes (de una tarjeta o de todas) */
export function cuotasPorCobrar(gastos: GastoVista[], cuenta: Ref | null | undefined, now: Date) {
  const ms = mesActual(now);
  let total = 0, compras = 0, proxMes = 0;
  for (const g of gastos) {
    const c = Number(g.cuotas);
    if (!(c > 1) || (cuenta != null && g.cuenta !== cuenta)) continue;
    const k = mesesEntre(g.fecha, ms);
    if (k >= c) continue;
    compras++;
    for (let i = Math.max(k + 1, 1); i <= c; i++) total += valorCuota({ monto: g.monto, cuotas: c }, i);
    if (k + 1 >= 1 && k + 1 <= c) proxMes += valorCuota({ monto: g.monto, cuotas: c }, k + 1);
  }
  return { total, compras, proxMes };
}

// ─── Tramos de sueldo y ahorro (Rango Hunter: lo usa el contexto de Eris y la respuesta al ahorrar) ──────
// (Finanzas 2.0 lo reemplaza por un rating de conducta; mientras, queda igual que en la web)
export const mkSalaryTiers = (SM: number) => [
  { id: 'F', min: 0, label: '< Mínimo' }, { id: 'E', min: SM, label: '1–2× SM' }, { id: 'D', min: SM * 2, label: '2–3.5× SM' },
  { id: 'C', min: SM * 3.5, label: '3.5–5× SM' }, { id: 'B', min: SM * 5, label: '5–6× SM' }, { id: 'A', min: SM * 6, label: '6–8× SM' },
  { id: 'S', min: SM * 8, label: '8–10× SM' }, { id: 'SS', min: SM * 10, label: '10× SM+' },
];
const TIER_IDS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS'];
export const hunterRankFor = (SM: number, inc: number, sav: number) => {
  const sal = mkSalaryTiers(SM), ahr = mkSavingsTiers(SM);
  const si = sal.indexOf(getTier(sal, inc)), vi = ahr.indexOf(getTier(ahr, sav));
  return TIER_IDS[Math.min(7, Math.floor(si * 0.35 + vi * 0.65 + 0.1))];
};
export const mkSavingsTiers = (SM: number) => [
  { id: 'F', min: 0, label: 'Sin ahorro' }, { id: 'E', min: 1, label: 'Inicio' }, { id: 'D', min: SM * 0.5, label: '0.5–2× SM' },
  { id: 'C', min: SM * 2, label: '2–6× SM' }, { id: 'B', min: SM * 6, label: '6–15× SM' }, { id: 'A', min: SM * 15, label: '15–30× SM' },
  { id: 'S', min: SM * 30, label: '30–50× SM' }, { id: 'SS', min: SM * 50, label: '50× SM+' },
];
export const getTier = <T extends { min: number }>(tiers: T[], val: number): T => [...tiers].reverse().find((t) => val >= t.min) || tiers[0];

// ─── El resumen (pantalla, chat y avisos) ─────────────────────────────────

export function resumen(S: FinanceState, now: Date) {
  const E = estado(S), V = vistas(E), ms = mesActual(now);
  const sueldo = sueldoEsperado(S, now);
  const ing = ingresoDelMes(E.tx, ms, sueldo, now);
  const gastosMes = gastosDelMes(V.gastos, ms);
  const gastoMes = gastosMes.reduce((a, g) => a + g.monto, 0);
  const porCat: Record<string, number> = {};
  gastosMes.forEach((g) => { if (g.monto) porCat[String(g.cat)] = (porCat[String(g.cat)] || 0) + g.monto; });
  const liquidez = E.efectivo + E.cuentas.filter((c) => c.tipo === 'debito').reduce((a, c) => a + c.saldo, 0);
  const deudaTC = E.cuentas.reduce((a, c) => a + deudaDe(c), 0);
  const pendienteCobro = V.meDeban.filter((d) => !d.cobrado).reduce((a, d) => a + d.monto, 0);
  const savingsRate = ing.total > 0 ? Math.max(0, Math.min(100, ((ing.total - gastoMes) / ing.total) * 100)) : 0;
  const pasivoFijo = S.prog.filter((p) => p.tipo === 'ingreso' && p.fuente === 'pasivo').reduce((a, p) => a + (Number(p.monto) || 0), 0);
  const gastoFijo = S.prog.filter((p) => p.tipo === 'gasto').reduce((a, p) => a + (Number(p.monto) || 0), 0);
  return {
    E, V, SM: Number(S.sm) || SM_DEFAULT, sueldo, ing, gastosMes, gastoMes, porCat, liquidez, deudaTC, pendienteCobro, savingsRate,
    disponible: Math.max(0, ing.total - gastoMes),
    hayBoveda: E.cuentas.some((c) => c.tipo !== 'ahorro') || E.efectivo !== 0,
    pendientes: ingresosPendientes(S, now), proximos: proximosProgramados(S, now, 10), cuotas: cuotasPorCobrar(V.gastos, null, now),
    pasivoFijo, gastoFijo, sueldoProgramado: S.prog.some((p) => p.tipo === 'ingreso' && p.fuente === 'sueldo'),
  };
}

/**
 * EXACTAMENTE lo que armaba window.__hwExtract en la web (texto + números). Se usa para comparar al migrar
 * (financeMigrate) y en la prueba de paridad con la web; lo que lee Eris es `extract` (puede evolucionar).
 * Ojo: el backend (parseFoodBudget) toma la PRIMERA línea "Disponible: $X" como disponible del mes.
 */
export function extractLegacy(S: FinanceState, now: Date) {
  const R = resumen(S, now), { E, V } = R;
  const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const CATS: Record<string, string> = { vivienda: 'Vivienda', alimentacion: 'Alimentacion', transporte: 'Transporte', salud: 'Salud', entretenimiento: 'Entretenimiento', deuda: 'Deuda', educacion: 'Educacion', hogar: 'Hogar', otros: 'Otros' };
  const presup = S.presup || {};
  const salT = getTier(mkSalaryTiers(R.SM), R.sueldo), savT = getTier(mkSavingsTiers(R.SM), V.ahorroAcum);
  const rank = hunterRankFor(R.SM, R.sueldo, V.ahorroAcum);
  let ctx = '\n\n## Finanzas del Usuario (Hunter Wallet):\n';
  ctx += `- Sueldo esperado: ${clp(R.sueldo)} líquido (${(R.sueldo / R.SM).toFixed(1)}x SM)${R.ing.sueldoLlego ? ` — este mes llegaron ${clp(R.ing.recibido)}` : ' — este mes aún no llega'}${R.sueldoProgramado ? '' : ' (sin día de pago configurado)'}\n`;
  if (R.ing.extra > 0) ctx += `- Ingresos extra este mes: ${clp(R.ing.extra)}\n`;
  if (R.ing.pasivo > 0 || R.pasivoFijo > 0) ctx += `- Ingreso pasivo: ${clp(R.ing.pasivo)} este mes${R.pasivoFijo > 0 ? ` (fijo ${clp(R.pasivoFijo)}/mes; gastos fijos ${clp(R.gastoFijo)}/mes)` : ''}\n`;
  for (const p of R.pendientes) ctx += `- POR CONFIRMAR: ¿llegó ${p.desc} (${clp(p.monto)}, debía llegar el ${p.fecha})?\n`;
  const prox = R.proximos.filter((p) => p.enDias > 0).slice(0, 5);
  if (prox.length) ctx += `- Próximos fijos: ${prox.map((p) => `${p.desc} ${p.tipo === 'ingreso' ? '+' : '-'}${clp(p.monto)} el ${p.fecha}`).join('; ')}\n`;
  if (R.cuotas.total > 0) ctx += `- Cuotas por cobrar en tarjetas: ${clp(R.cuotas.total)} (${R.cuotas.compras} compra${R.cuotas.compras !== 1 ? 's' : ''}; el próximo mes ${clp(R.cuotas.proxMes)})\n`;
  ctx += `- Hunter Rank: ${rank} | Sueldo: R.${salT.id} | Ahorro: R.${savT.id}\n`;
  ctx += `- Gastos ${MESES_ES[now.getMonth()]} ${now.getFullYear()}: ${clp(R.gastoMes)}\n`;
  // También las categorías con presupuesto aunque este mes no tengan gastos
  [...new Set([...Object.keys(R.porCat), ...Object.keys(presup).filter((c) => (presup[c] || 0) > 0)])]
    .sort((a, b) => (R.porCat[b] || 0) - (R.porCat[a] || 0)).forEach((cat) => {
      const m = R.porCat[cat] || 0, p = presup[cat] || 0;
      ctx += `  · ${CATS[cat] || cat}: ${clp(m)}${p > 0 ? ` / ${clp(p)} presup (${Math.round((m / p) * 100)}%)` : ''}\n`;
    });
  ctx += `- Disponible: ${clp(R.disponible)}\n`;
  ctx += `- Tasa ahorro: ${R.savingsRate.toFixed(0)}%\n`;
  ctx += `- Ahorro acumulado: ${clp(V.ahorroAcum)}\n`;
  if (R.pendienteCobro > 0) {
    ctx += `- Me deben (pendiente): ${clp(R.pendienteCobro)}\n`;
    V.meDeban.filter((d) => !d.cobrado && d.devolucion).sort((a, b) => (String(a.devolucion) < String(b.devolucion) ? -1 : 1)).slice(0, 3)
      .forEach((d) => { ctx += `  · ${d.desc}: ${clp(d.monto)}, devuelve el ${d.devolucion}\n`; });
  }
  if (R.hayBoveda || E.cuentas.length) {
    ctx += '- Cuentas y efectivo (Bóveda):\n';
    ctx += `  · Efectivo: ${clp(E.efectivo)}\n`;
    for (const c of E.cuentas) {
      if (c.tipo === 'credito') { const deuda = deudaDe(c); ctx += `  · ${c.nombre} (tarjeta de crédito): cupo libre ${clp(c.saldo)} de ${clp(c.cupo || 0)}${deuda > 0 ? `, deuda ${clp(deuda)}` : ', sin deuda'}\n`; }
      else ctx += `  · ${c.nombre} (${c.tipo === 'ahorro' ? 'cuenta de ahorro' : 'débito'}): ${clp(c.saldo)}\n`;
    }
    ctx += `- Plata a mano (efectivo + débito): ${clp(R.liquidez)}\n`;
    if (R.deudaTC > 0) ctx += `- Deuda total en tarjetas de crédito: ${clp(R.deudaTC)}\n`;
  }
  return { context: ctx, summary: { hunterRank: rank, disponible: R.disponible, ahorroAcum: V.ahorroAcum, savingsRate: Math.round(R.savingsRate),
    liquidez: R.hayBoveda ? R.liquidez : null, deudaTC: R.deudaTC, sueldo: R.sueldo, ingresoMes: R.ing.total, ingresoExtra: R.ing.extra, ingresoPasivo: R.ing.pasivo,
    porConfirmar: R.pendientes.length, cuotasPorCobrar: R.cuotas.total,
    ultimoMovimiento: E.tx.filter((t) => t.progId == null && t.recurId == null && typeof t.fecha === 'string').reduce((m, t) => (t.fecha > m ? t.fecha : m), '') || null,
    proximos: R.proximos.slice(0, 8).map((p) => ({ desc: p.desc, monto: Number(p.monto) || 0, fecha: p.fecha, tipo: p.tipo, enDias: p.enDias })),
    pendientes: R.pendientes.slice(0, 3).map((p) => ({ desc: p.desc, monto: Number(p.monto) || 0, fecha: p.fecha })),
    comida: (presup.alimentacion || 0) > 0 ? { gastado: R.porCat.alimentacion || 0, presup: presup.alimentacion } : null } };
}

/**
 * Lo que lee Eris (contexto) y el Dashboard/avisos (números). Finanzas 2.0: sin el Rango Hunter ni "x SM" (juzgaban por
 * ingreso); con el rating por conducta, lo que puede gastar hasta el ingreso, su ritmo, patrimonio y presupuesto al día.
 * La línea "- Disponible:" sigue igual (MetabolicAnalysis.parseFoodBudget toma la primera).
 */
export function extract(S: FinanceState, now: Date) {
  const L = extractLegacy(S, now), T = tablero(S, now), Rt = rating(S, now);
  const pres = presupuestoAlDia(S, now).filter((l) => l.presup > 0);
  const CATN = CAT_NOMBRE;
  let ctx = L.context.replace(/ \(\d+(?:\.\d+)?x SM\)/, '').replace(/- Hunter Rank:[^\n]*\n/, '');
  const extra: string[] = [];
  if (T.porDiaHastaIngreso != null) extra.push(`- Para gastar hasta ${T.proximo ? `el próximo ingreso (${T.proximo.desc}, en ${T.proximo.enDias} días)` : 'fin de mes'}: ${clp(T.libre)} (~${clp(T.porDiaHastaIngreso)} por día)${T.comprometido > 0 ? `; ya descontados ${clp(T.comprometido)} de fijos que vienen antes` : ''}`);
  if (T.burnDiario > 0) extra.push(`- Ritmo de gasto variable: ${clp(T.burnDiario)} por día${T.runwayDias != null ? ` (a ese ritmo le alcanza para ${T.runwayDias} días)` : ''}`);
  extra.push(`- Patrimonio neto: ${clp(T.patrimonio)} (cuentas + ahorro + le deben − tarjetas)`);
  if (pres.length) extra.push(`- Presupuesto al día: ${pres.map((l) => `${CATN[l.cat] ?? l.cat}: ${l.texto}`).join('; ')}`);
  if (Rt) extra.push(`- Rating de sus finanzas: ${Rt.nota} (${Rt.score}/100; mide cómo maneja la plata, no cuánto gana)${Rt.mejoras.length ? `. Lo que más lo sube: ${Rt.mejoras.join(' ')}` : ''}`);
  // Cruce con la comida (F5): dato neutral, sin juicio; Eris lo usa si la persona pregunta por su comida o su plata
  const fuera = comidaFuera(S, now);
  if (fuera.veces > 0) extra.push(`- Comida fuera y delivery este mes: ${clp(fuera.monto)} en ${fuera.veces} compra${fuera.veces === 1 ? '' : 's'} (dato, no juicio)`);
  ctx += extra.join('\n') + '\n';
  const { hunterRank: _h, ...summary } = L.summary;
  return { context: ctx, summary: { ...summary, rating: Rt ? { nota: Rt.nota, score: Rt.score } : null, libre: T.libre, porDia: T.porDiaHastaIngreso, runwayDias: T.runwayDias, patrimonio: T.patrimonio,
    proximoIngreso: T.proximo, presupuesto: pres.map((l) => ({ cat: l.cat, estado: l.estado, queda: Math.round(l.queda), porDia: Math.round(l.porDia), presup: l.presup, gastado: l.gastado })) } };
}

// ─── Cuentas por pista de texto ───────────────────────────────────────────

const BANK_ALIAS: Array<[RegExp, string]> = [[/\bcuenta ?rut\b|\brut\b/, 'banco estado'], [/\bestado\b/, 'banco estado'], [/\bchile\b/, 'banco de chile'], [/\bcmr\b/, 'banco falabella'], [/\bscotia\w*/, 'scotiabank'], [/\bmp\b|\bmercado ?pago\b/, 'mercado pago']];
export interface VistaCuenta { ref: Ref; nombre: string; tipo: TipoCuenta; saldo: number; cupo?: number }
export const vistaCuenta = (E: Estado, ref: Ref | null | undefined): VistaCuenta | null => {
  const c = E.def(ref); if (!c || c.archivada) return null;
  return { ref: c.id, nombre: c.nombre, tipo: c.tipo, saldo: E.bal[String(c.id)] || 0, ...(c.tipo === 'credito' ? { cupo: c.cupo || 0 } : {}) };
};
export const publica = (v: VistaCuenta | null) => (v ? { nombre: v.nombre, tipo: v.tipo, saldo: v.saldo, ...(v.cupo != null ? { cupo: v.cupo } : {}) } : null);
const activas = (E: Estado) => E.defs.filter((c) => !c.archivada).map((c) => ({ ref: c.id, nombre: c.nombre, tipo: c.tipo, banco: c.banco || '', saldo: E.bal[String(c.id)] || 0 }));
type Filtro = 'credito' | 'sinCredito' | 'sinEfectivo' | null;
const pasaFiltro = (o: { tipo: string; ref: Ref }, filtro: Filtro) => (filtro === 'credito' ? o.tipo === 'credito' : filtro === 'sinCredito' ? o.tipo !== 'credito' : filtro === 'sinEfectivo' ? o.ref !== CASH : true);

/** Pista de texto ("bci", "tarjeta de credito", "efectivo", "BCI · Cuenta corriente") → cuenta. */
export function hwResolve(E: Estado, hint: unknown, filtro: Filtro): { ref?: Ref; error?: string; msg?: string; opciones?: string[] } {
  const todas = activas(E).filter((o) => pasaFiltro(o, filtro));
  const opciones = todas.map((o) => o.nombre);
  const h = foldTxt(hint);
  if (!h) return { error: 'falta_cuenta', opciones };
  const exact = todas.filter((o) => foldTxt(o.nombre) === h);
  if (exact.length === 1) return { ref: exact[0].ref };
  if (/\b(efectivo|cash|billetes?|sencillo|contado)\b/.test(h)) return todas.some((o) => o.ref === CASH) ? { ref: CASH } : { error: 'cuenta_no_encontrada', msg: 'Eso no puede salir del efectivo', opciones };
  const wantCred = /\b(credito|tc|visa|master\w*)\b/.test(h), wantDeb = /\b(debito|redcompra|vista|corriente|prepago)\b/.test(h);
  let hx = h; for (const [re, b] of BANK_ALIAS) if (re.test(h)) hx += ' ' + b;
  const STOP = new Set(['la', 'el', 'mi', 'mis', 'de', 'del', 'con', 'desde', 'tarjeta', 'cuenta', 'banco', 'en', 'a', 'al', 'debito', 'credito', 'tc', 'visa', 'redcompra', 'y', 'que', 'fue']);
  const toks = [...new Set(hx.split(/[^a-z0-9ñ]+/).filter((w) => w.length > 1 && !STOP.has(w)))];
  let cands = todas.filter((o) => o.ref !== CASH);
  if (wantCred) cands = cands.filter((o) => o.tipo === 'credito'); else if (wantDeb) cands = cands.filter((o) => o.tipo !== 'credito');
  if (toks.length) {
    const score = (o: { nombre: string; banco: string }) => { const t = ' ' + foldTxt(o.nombre + ' ' + o.banco).replace(/[^a-z0-9ñ]+/g, ' ') + ' '; return toks.filter((w) => t.includes(' ' + w + ' ')).length; };
    const best = Math.max(0, ...cands.map(score));
    cands = best > 0 ? cands.filter((o) => score(o) === best) : [];
  }
  if (cands.length === 1) return { ref: cands[0].ref };
  if (!cands.length) return { error: 'cuenta_no_encontrada', msg: `No encontré la cuenta "${String(hint)}" en tu Bóveda`, opciones };
  return { error: 'cuenta_ambigua', msg: `"${String(hint)}" calza con ${cands.length} cuentas`, opciones: cands.map((o) => o.nombre) };
}

// ─── Operaciones del chat ─────────────────────────────────────────────────
// El servidor (finance_tracker) manda {action, monto, cuenta:"bci", …}; se aplican con las MISMAS reglas que los
// formularios (saldo insuficiente, cupo, deuda de la tarjeta…) y se contesta con los saldos reales.

export interface OpResult { ok: boolean; code?: string; msg?: string; opciones?: string[]; data?: any }
const SKILL_LABEL: Record<string, { label: string; icon: string }> = {
  vivienda: { label: 'Fortaleza', icon: '🏰' }, alimentacion: { label: 'Provisiones', icon: '⚔️' }, transporte: { label: 'Desplazam.', icon: '🐉' },
  salud: { label: 'Curación', icon: '💊' }, entretenimiento: { label: 'Ocio', icon: '🎮' }, deuda: { label: 'Penalización', icon: '💀' },
  educacion: { label: 'Habilidades', icon: '📜' }, hogar: { label: 'Hogar', icon: '🧺' }, otros: { label: 'Misceláneos', icon: '🎒' },
};
const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Aplica una operación sobre una copia y la devuelve (como en la web, lo que alcanzó a cambiar queda: p. ej. «resumen» aplica los fijos del día). */
export function applyOp(S: FinanceState, opIn: any, ctx: Ctx): { state: FinanceState; result: OpResult } {
  const W = draft(S);
  const result = applyOpOn(W, opIn || {}, ctx);
  return { state: W, result };
}

function applyOpOn(W: FinanceState, op: any, ctx: Ctx): OpResult {
  const fail = (code: string, msg: string, extra?: Record<string, unknown>): OpResult => ({ ok: false, code, msg, ...(extra || {}) });
  if (!W.setupDone && !W.sueldo.length) return fail('sin_finanzas', 'Todavía no configuras Finanzas: ábrela una vez y completa tu sueldo y ahorro');
  const monto = Math.round(Number(op.monto) || 0);
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(op.fecha || '') ? op.fecha : todayStr(ctx.now);
  const E = estado(W), cuentas = E.cuentas;
  const vc = (ref: Ref | null | undefined) => vistaCuenta(estado(W), ref); // con los saldos DESPUÉS de anotar
  const chatLog = (e: { tipo: string; id: Tx['id'] }) => { W.chatLog = [...W.chatLog, { ...e, at: ctx.now.getTime() }].slice(-40); };
  type Sel = { ref?: Ref | null; asumida?: boolean; fail?: OpResult };
  /* Cuenta: la que dijo, o la última usada (se avisa que se asumió); sin Bóveda, no se descuenta de ningún lado. */
  const elegir = (hint: unknown, campo: string, filtro: Filtro, defecto?: () => Sel): Sel => {
    if (hint) { const r = hwResolve(E, hint, filtro); return r.error ? { fail: fail(r.error, r.msg || 'Falta elegir la cuenta', { opciones: r.opciones, data: { campo } }) } : { ref: r.ref }; }
    if (defecto) return defecto();
    return { fail: fail('falta_cuenta', '¿Cuál cuenta?', { opciones: hwResolve(E, '', filtro).opciones, data: { campo } }) };
  };
  const ultimaUsada = (filtro: Filtro, pregunta?: string) => (): Sel => {
    if (!cuentas.length && !E.efectivo) return { ref: null };
    const ok = (o: VistaCuenta | null) => !!o && pasaFiltro(o, filtro);
    const l = W.lastCuenta, lv = l != null ? vistaCuenta(E, l) : null;
    if (ok(lv)) return { ref: l, asumida: true };
    const cand = activas(E).filter((o) => pasaFiltro(o, filtro)).filter((o) => o.ref !== CASH || o.saldo > 0);
    if (cand.length === 1) return { ref: cand[0].ref, asumida: true };
    return { fail: fail('falta_cuenta', pregunta || '¿Con qué pagaste?', { opciones: hwResolve(E, '', filtro).opciones, data: { campo: 'cuenta' } }) };
  };
  const sinFondos = (ref: Ref | null | undefined, m: number, campo?: string, filtro: Filtro = null): OpResult | null => {
    if (ref == null) return null;
    const v = vistaCuenta(E, ref); if (!v || v.saldo >= m) return null;
    return fail('sin_fondos', v.tipo === 'credito' ? `Cupo insuficiente en ${v.nombre} (quedan ${clp(Math.max(0, v.saldo))})` : `Saldo insuficiente en ${v.nombre} (tiene ${clp(Math.max(0, v.saldo))})`,
      { opciones: activas(E).filter((o) => o.saldo >= m && pasaFiltro(o, filtro)).map((o) => o.nombre), data: { campo: campo || 'cuenta' } });
  };
  const necesitaMonto = () => (monto > 0 ? null : fail('invalido', 'Falta el monto'));
  const unaNoCredito = (pregunta: string) => (): Sel => { const d = cuentas.filter((c) => c.tipo !== 'credito'); return d.length === 1 ? { ref: d[0].id } : { fail: fail('falta_cuenta', pregunta, { opciones: hwResolve(E, '', null).opciones, data: { campo: 'cuenta' } }) }; };

  switch (op.action) {
    case 'gasto': {
      const e = necesitaMonto(); if (e) return e;
      // En cuotas: solo con tarjeta de crédito (la única tarjeta, o la que diga)
      const cuotas = Math.round(Number(op.cuotas) || 1);
      if (cuotas > 48) return fail('invalido', 'Más de 48 cuotas no lo puedo anotar');
      const unaTC = (): Sel => { const t = cuentas.filter((c) => c.tipo === 'credito'); return t.length === 1 ? { ref: t[0].id } : { fail: fail(t.length ? 'falta_cuenta' : 'cuenta_no_encontrada', t.length ? '¿Con qué tarjeta de crédito?' : 'Para cuotas necesito una tarjeta de crédito en tu Bóveda', { opciones: t.map((c) => c.nombre), data: { campo: 'cuenta' } }) }; };
      if (cuotas > 1 && op.cuenta) { // "en 3 cuotas con la BCI" (débito): las cuotas son solo con tarjeta de crédito
        const r = hwResolve(E, op.cuenta, null);
        if (!r.error && E.tipo(r.ref) !== 'credito') return fail('falta_cuenta', `Las cuotas son con tarjeta de crédito y ${E.nombre(r.ref)} no lo es. ¿Con qué tarjeta fue? (o dime «al contado»)`, { opciones: cuentas.filter((c) => c.tipo === 'credito').map((c) => c.nombre), data: { campo: 'cuenta' } });
      }
      const sel = cuotas > 1 ? elegir(op.cuenta, 'cuenta', 'credito', unaTC) : elegir(op.cuenta, 'cuenta', null, ultimaUsada(null)); if (sel.fail) return sel.fail;
      const f = sinFondos(sel.ref, monto); if (f) return f;
      const cat = (CATEGORIAS as readonly string[]).includes(op.categoria) ? op.categoria : 'otros';
      const desc = String(op.descripcion || 'Gasto').slice(0, 60);
      const t = addTx(W, { tipo: 'gasto', fecha, monto, desde: sel.ref ?? null, cat, desc, ...(cuotas > 1 ? { cuotas } : {}), via: 'eris' }, ctx);
      if (sel.ref != null) W.lastCuenta = sel.ref;
      chatLog({ tipo: 'gasto', id: t.id });
      const s = SKILL_LABEL[cat], ms = fecha.slice(0, 7);
      const gastado = gastosDelMes(vistas(estado(W)).gastos, ms).filter((g) => g.cat === cat).reduce((a, g) => a + g.monto, 0);
      return { ok: true, data: { desc, monto, cat, catLabel: s.label === 'Desplazam.' ? 'Desplazamiento' : s.label, catIcon: s.icon, fecha, cuenta: publica(sel.ref != null ? vc(sel.ref) : null), asumida: !!sel.asumida,
        ...(cuotas > 1 ? { cuotas, valorCuota: valorCuota({ monto, cuotas }, 1), primeraCuota: MESES_L[Number(mesSiguiente(ms).slice(5)) - 1] } : {}),
        mesCat: { gastado, presup: (W.presup || {})[cat] || 0 } } };
    }
    case 'prestamo': {
      const e = necesitaMonto(); if (e) return e;
      const persona = String(op.persona || '').trim(); if (!persona) return fail('invalido', 'Falta a quién le prestaste');
      const sel = elegir(op.cuenta, 'cuenta', 'sinCredito', ultimaUsada('sinCredito', '¿De dónde salió la plata?')); if (sel.fail) return sel.fail;
      const f = sinFondos(sel.ref, monto, 'cuenta', 'sinCredito'); if (f) return f;
      const devolucion = /^\d{4}-\d{2}-\d{2}$/.test(op.devolucion || '') ? op.devolucion : null;
      const t = addTx(W, { tipo: 'prestamo', fecha, monto, desde: sel.ref ?? null, desc: persona + (op.descripcion ? ' — ' + op.descripcion : ''), ...(devolucion ? { devolucion } : {}), via: 'eris' }, ctx);
      if (sel.ref != null) W.lastCuenta = sel.ref;
      chatLog({ tipo: 'prestamo', id: t.id });
      return { ok: true, data: { persona, monto, devolucion, cuenta: publica(sel.ref != null ? vc(sel.ref) : null), asumida: !!sel.asumida } };
    }
    case 'cobro': {
      const toks = foldTxt(op.persona).split(/\s+/).filter((w) => w.length > 1 && !['mi', 'la', 'el', 'al', 'los', 'las'].includes(w));
      if (!toks.length) return fail('invalido', 'Falta quién te devolvió');
      const pend = vistas(E).meDeban.filter((d) => !d.cobrado);
      let m = pend.filter((d) => { const f = foldTxt(d.desc); return toks.every((w) => f.includes(w)); });
      if (m.length > 1 && monto) { const ex = m.filter((d) => d.monto === monto); if (ex.length) m = ex; }
      if (!m.length) return fail('sin_prestamo', `No tengo un préstamo pendiente a ${op.persona}`, pend.length ? { opciones: [...new Set(pend.map((d) => d.desc.split(' — ')[0]))].slice(0, 6), data: { campo: 'persona' } } : {});
      if (m.length > 1) m = [m.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))[0]]; // el más antiguo primero
      const d = m[0], hacia = d.cuenta != null && E.activa(d.cuenta) ? d.cuenta : null;
      const pago = monto > 0 && monto < d.monto ? monto : d.monto, parcial = pago < d.monto;
      const t = addTx(W, { tipo: 'cobro', prestamoId: d.id, fecha, monto: pago, hacia, desc: 'Cobro', via: 'eris' }, ctx);
      chatLog({ tipo: 'cobro', id: t.id });
      return { ok: true, data: { persona: d.desc.split(' — ')[0], monto: pago, parcial, restante: parcial ? d.monto - pago : 0, cuenta: hacia != null ? publica(vc(hacia)) : null } };
    }
    case 'abono': {
      // Si es sueldo, un bono, honorarios, dividendos…, es un INGRESO (cuenta para el mes); si no, solo entra plata
      const fuenteDicha: Fuente | null = (op.fuente in FUENTES) ? op.fuente : fuenteDe(`${op.descripcion || ''} ${op.fuente || ''}`);
      const quincena = /\b(quincena|anticipo)\b/.test(foldTxt(op.descripcion));
      const yaResueltos = new Set(W.rec), ms0 = mesActual(ctx.now);
      const delaFuente = fuenteDicha ? W.prog.filter((p) => p.tipo === 'ingreso' && p.fuente === fuenteDicha) : [];
      const pend = delaFuente.filter((p) => !yaResueltos.has(`${p.id}:${ms0}`)).sort((a, b) => (Number(a.dia) || 0) - (Number(b.dia) || 0));
      const prog = fuenteDicha === 'sueldo' ? (pend.find((p) => (quincena ? p.parte === 'anticipo' : p.parte !== 'anticipo')) || null) : (pend.length === 1 ? pend[0] : null);
      const m = monto > 0 ? monto : prog ? Number(prog.monto) || 0 : 0;
      if (!(m > 0)) return fail('invalido', fuenteDicha !== 'sueldo' ? 'Falta el monto'
        : !delaFuente.length ? '¿Cuánto te llegó? (si configuras tu sueldo en Finanzas → Mi sueldo, la próxima vez basta con decirme «me llegó el sueldo»)'
          : 'Tu sueldo de este mes ya está anotado. Si te llegó otra plata, dime cuánto fue.');
      const porDefecto = prog && prog.cuenta != null && E.activa(prog.cuenta) ? (): Sel => ({ ref: prog.cuenta }) : unaNoCredito('¿A qué cuenta te llegó?');
      const sel = elegir(op.cuenta, 'cuenta', null, porDefecto); if (sel.fail) return sel.fail;
      const v = vistaCuenta(E, sel.ref)!;
      if (v.tipo === 'credito') { const deuda = deudaDe(v); if (m > deuda) return fail('sin_deuda', deuda === 0 ? `${v.nombre} no tiene deuda` : `${v.nombre} debe ${clp(deuda)}: no le puedes abonar más que eso`); }
      const fuente = v.tipo === 'credito' ? null : fuenteDicha;
      const desc = String(op.descripcion || (fuente ? FUENTES[fuente].label : 'Abono')).slice(0, 60);
      const t = fuente && prog ? confirmarIngreso(W, prog, { monto: m, hacia: sel.ref ?? null, via: 'eris' }, ctx)
        : addTx(W, fuente ? { tipo: 'ingreso', fuente, fecha, monto: m, hacia: sel.ref ?? null, desc, via: 'eris' } : { tipo: 'abono', fecha, monto: m, hacia: sel.ref ?? null, desc, via: 'eris' }, ctx);
      chatLog({ tipo: 'mov', id: t.id });
      return { ok: true, data: { monto: m, desc: prog ? prog.desc : (op.descripcion || null), fuente, fuenteLabel: fuente ? FUENTES[fuente].label : null,
        programado: prog ? { desc: prog.desc, esperado: Number(prog.monto) || 0 } : null, hacia: publica(vc(sel.ref)) } };
    }
    case 'giro': {
      const e = necesitaMonto(); if (e) return e;
      const sel = elegir(op.cuenta, 'cuenta', 'sinEfectivo', unaNoCredito('¿De qué cuenta giraste?')); if (sel.fail) return sel.fail;
      const f = sinFondos(sel.ref, monto, 'cuenta', 'sinEfectivo'); if (f) return f;
      const t = addTx(W, { tipo: 'giro', fecha, monto, desde: sel.ref ?? null, hacia: CASH, desc: 'Giro', via: 'eris' }, ctx);
      chatLog({ tipo: 'mov', id: t.id });
      return { ok: true, data: { monto, desde: publica(vc(sel.ref)), hacia: publica(vc(CASH)) } };
    }
    case 'transferencia': case 'pago_tarjeta': {
      const pago = op.action === 'pago_tarjeta';
      const unaTC = (): Sel => { const t = cuentas.filter((c) => c.tipo === 'credito'); return t.length === 1 ? { ref: t[0].id } : { fail: fail(t.length ? 'falta_cuenta' : 'cuenta_no_encontrada', t.length ? '¿Qué tarjeta pagaste?' : 'No tienes tarjetas de crédito en tu Bóveda', { opciones: t.map((c) => c.nombre), data: { campo: 'hacia' } }) }; };
      const dst = elegir(op.hacia, 'hacia', pago ? 'credito' : null, pago ? unaTC : undefined); if (dst.fail) return dst.fail;
      // Sin origen dicho: una cuenta que no sea de crédito (la última usada, o la única); pagar la tarjeta con efectivo hay que decirlo
      const unaDebito = (): Sel => {
        const deb = cuentas.filter((c) => c.tipo !== 'credito' && c.id !== dst.ref), l = W.lastCuenta;
        if (deb.some((c) => c.id === l)) return { ref: l, asumida: true };
        if (deb.length === 1) return { ref: deb[0].id, asumida: true };
        return { fail: fail('falta_cuenta', '¿Desde qué cuenta?', { opciones: (hwResolve(E, '', 'sinCredito').opciones || []).filter((n) => n !== E.nombre(dst.ref)), data: { campo: 'cuenta' } }) };
      };
      const src = elegir(op.cuenta, 'cuenta', 'sinCredito', unaDebito); if (src.fail) return src.fail;
      if (src.ref == null) return fail('falta_cuenta', '¿Desde qué cuenta?', { opciones: hwResolve(E, '', 'sinCredito').opciones, data: { campo: 'cuenta' } });
      if (src.ref === dst.ref) return fail('invalido', 'Origen y destino son la misma cuenta');
      const tcv = vistaCuenta(E, dst.ref), deuda = tcv && tcv.tipo === 'credito' ? deudaDe(tcv) : null;
      if (deuda != null && deuda <= 0) return fail('sin_deuda', `${tcv!.nombre} no tiene deuda`);
      const m = monto > 0 ? monto : (pago ? (deuda || 0) : 0);
      if (!(m > 0)) return fail('invalido', 'Falta el monto');
      if (deuda != null && m > deuda) return fail('sin_deuda', `${tcv!.nombre} debe ${clp(deuda)}: no le puedes abonar más que eso`);
      const f = sinFondos(src.ref, m, 'cuenta', 'sinCredito'); if (f) return f;
      const t = addTx(W, { tipo: 'transfer', fecha, monto: m, desde: src.ref, hacia: dst.ref ?? null, desc: pago || (tcv && tcv.tipo === 'credito') ? 'Pago de tarjeta' : 'Transferencia', via: 'eris' }, ctx);
      chatLog({ tipo: 'mov', id: t.id });
      const vd = vc(dst.ref)!;
      return { ok: true, data: { monto: m, desde: publica(vc(src.ref)), hacia: publica(vd), deuda: vd.tipo === 'credito' ? Math.max(0, (vd.cupo || 0) - vd.saldo) : 0 } };
    }
    case 'ahorro': {
      const e = necesitaMonto(); if (e) return e;
      // Si dice de dónde salió, sale de esa cuenta; si no, entra al ahorro como antes (plata de fuera de la Bóveda)
      let desde: Ref | null = null;
      if (op.cuenta) {
        const r = hwResolve(E, op.cuenta, 'sinCredito');
        if (r.error) return fail(r.error, r.msg || 'Falta elegir la cuenta', { opciones: r.opciones, data: { campo: 'cuenta' } });
        desde = r.ref ?? null;
        const f = sinFondos(desde, monto, 'cuenta', 'sinCredito'); if (f) return f;
      }
      const hacia = cuentaAhorro(W, ctx);
      if (desde === hacia) return fail('invalido', 'Esa ya es tu cuenta de ahorro');
      const desc = String(op.descripcion || 'Ahorro').slice(0, 60);
      const t = addTx(W, { tipo: 'ahorro', fecha, monto, desde, hacia, desc, via: 'eris' }, ctx);
      chatLog({ tipo: 'ahorro', id: t.id });
      const acum = vistas(estado(W)).ahorroAcum, tiers = mkSavingsTiers(Number(W.sm) || SM_DEFAULT);
      const ti = getTier(tiers, acum), next = tiers[tiers.indexOf(ti) + 1];
      return { ok: true, data: { desc, monto, ahorroAcum: acum, ...(desde != null ? { desde: publica(vc(desde)) } : {}), tier: { id: ti.id, siguiente: next ? next.id : null, falta: next ? next.min - acum : 0 } } };
    }
    case 'deshacer': {
      const TIPO: Record<string, string> = { gasto: 'gasto', prestamo: 'prestamo', ahorro: 'ahorro', giro: 'mov', abono: 'mov', ingreso: 'mov', sueldo: 'mov', transferencia: 'mov', pago: 'mov', movimiento: 'mov' };
      const want = TIPO[foldTxt(op.objeto)] || null, busca = foldTxt(op.descripcion);
      const log = W.chatLog;
      let idx = -1, entry: { tipo: string; id: Tx['id'] } | null = null;
      if (busca && want === 'gasto') {
        // "borra el gasto del uber": el más reciente con esa descripción, aunque se haya anotado a mano
        const g = [...E.tx].reverse().find((x) => x.tipo === 'gasto' && foldTxt(x.desc).includes(busca));
        if (g) { entry = { tipo: 'gasto', id: g.id }; idx = log.findIndex((l) => l.tipo === 'gasto' && l.id === g.id); }
      } else {
        for (let i = log.length - 1; i >= 0; i--) { const l = log[i]; if (!want || l.tipo === want || (want === 'prestamo' && l.tipo === 'cobro')) { idx = i; entry = l; break; } }
      }
      if (!entry) return fail('nada_que_deshacer', busca ? `No encontré un gasto «${op.descripcion}»` : 'No tengo registros hechos por chat para borrar');
      const ent = entry;
      const t = E.tx.find((x) => x.id === ent.id)
        // registros de antes del libro único: el cobro se guardaba con el id del préstamo
        || (ent.tipo === 'cobro' ? [...E.tx].reverse().find((x) => x.tipo === 'cobro' && x.prestamoId === ent.id) : undefined);
      let out: any = null;
      if (t) {
        const cta = (ref: Ref | null | undefined) => (ref != null && E.activa(ref) ? E.nombre(ref) : null);
        const d = t.tipo === 'prestamo' ? vistas(E).meDeban.find((x) => x.id === t.id) : null;
        borrarTx(W, t.id); // con lo que cuelga: cobros del préstamo; un ingreso fijo vuelve a "¿llegó?"
        if (t.tipo === 'gasto') out = { tipo: 'el gasto', desc: t.desc, monto: t.monto, cuenta: cta(t.desde) };
        else if (t.tipo === 'prestamo') out = { tipo: 'el préstamo', desc: t.desc, monto: t.monto, cuenta: d && !d.cobrado ? cta(t.desde) : null };
        else if (t.tipo === 'cobro') { const p = E.tx.find((x) => x.id === t.prestamoId); out = { tipo: 'el cobro', desc: p ? p.desc : 'Préstamo', monto: t.monto, cuenta: null }; }
        else if (t.tipo === 'ahorro') out = { tipo: 'el ahorro', desc: t.desc, monto: t.monto, cuenta: cta(t.desde) };
        else out = { tipo: t.tipo === 'ingreso' ? 'el ingreso' : 'el movimiento', desc: t.desc, monto: t.monto, cuenta: null };
      }
      if (idx >= 0) W.chatLog = log.filter((_, i) => i !== idx);
      return out ? { ok: true, data: out } : fail('nada_que_deshacer', 'Ese registro ya no existe (quizás lo borraste a mano)');
    }
    case 'resumen': {
      aplicarProgramados(W, ctx);
      const R = resumen(W, ctx.now);
      return { ok: true, data: { hayBoveda: R.hayBoveda, efectivo: R.E.efectivo, cuentas: R.E.cuentas.map((c) => publica(vistaCuenta(R.E, c.id))),
        liquidez: R.liquidez, deudaTC: R.deudaTC,
        mes: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][ctx.now.getMonth()],
        gastoMes: R.gastoMes, ingreso: R.ing.total, ingresoExtra: R.ing.otros, disponible: R.disponible,
        pendienteCobro: R.pendienteCobro, ahorroAcum: R.V.ahorroAcum,
        porConfirmar: R.pendientes.map((p) => ({ desc: p.desc, monto: Number(p.monto) || 0, fecha: p.fecha })),
        proximos: R.proximos.filter((p) => p.enDias > 0).slice(0, 4).map((p) => ({ desc: p.desc, monto: Number(p.monto) || 0, fecha: p.fecha, tipo: p.tipo })),
        cuotasProxMes: R.cuotas.proxMes } };
    }
    default: return fail('invalido', 'Operación desconocida');
  }
}

// ─── Formularios de la app (las mismas reglas y mensajes que tenían en la web) ─────────────────────────────
// Trabajan sobre la copia de trabajo (draft) y devuelven {ok, msg}. Los mensajes son los que se muestran.

export interface FormResult { ok: boolean; msg: string }
const OK = (msg: string): FormResult => ({ ok: true, msg });
const NO = (msg: string): FormResult => ({ ok: false, msg });
const num = (v: unknown) => Number(v) || 0;
const refValida = (W: FinanceState, ref: Ref | null | undefined) => (ref != null && (ref === CASH || estado(W).activa(ref)) ? ref : null);
function sinFondosForm(W: FinanceState, ref: Ref | null, monto: number): string | null {
  if (ref == null) return null;
  const E = estado(W), v = vistaCuenta(E, ref);
  if (!v || v.saldo >= monto) return null;
  return v.tipo === 'credito' ? `Cupo insuficiente en ${v.nombre} (quedan ${clp(Math.max(0, v.saldo))})` : `Saldo insuficiente en ${v.nombre} (tiene ${clp(Math.max(0, v.saldo))})`;
}
function tapaCredito(W: FinanceState, ref: Ref | null, monto: number): string | null {
  const v = vistaCuenta(estado(W), ref);
  if (!v || v.tipo !== 'credito') return null;
  const d = deudaDe(v);
  if (monto <= d) return null;
  return d === 0 ? `${v.nombre} no tiene deuda` : `${v.nombre} debe ${clp(d)}: no le puedes abonar más que eso`;
}

/** Gasto desde la app. En cuotas (solo crédito): si pusiste el valor de la cuota (con interés), el total es cuota × N. */
export function formGasto(W: FinanceState, f: { desc: string; monto: number; cat: string; fecha?: string; cuenta?: Ref | null; cuotas?: number; cuotaValor?: number; via?: string; extra?: Record<string, unknown> }, ctx: Ctx): FormResult & { tx?: Tx } {
  if (!String(f.desc || '').trim() || !(num(f.monto) > 0)) return NO('¡Datos incompletos!');
  const ref = refValida(W, f.cuenta);
  const credito = ref != null && estado(W).tipo(ref) === 'credito';
  const cuotas = credito ? Math.max(1, Math.min(48, Math.round(num(f.cuotas) || 1))) : 1;
  const cv = num(f.cuotaValor);
  const monto = cuotas > 1 && cv > 0 ? cv * cuotas : num(f.monto);
  const err = sinFondosForm(W, ref, monto); if (err) return NO(err);
  const cat = (CATEGORIAS as readonly string[]).includes(f.cat) ? f.cat : 'otros';
  const tx = addTx(W, { tipo: 'gasto', fecha: f.fecha || todayStr(ctx.now), monto, desde: ref, cat, desc: String(f.desc).trim(), ...(cuotas > 1 ? { cuotas } : {}), ...(f.via ? { via: f.via } : {}), ...(f.extra || {}) }, ctx);
  if (ref != null) W.lastCuenta = ref;
  return { ...OK(cuotas > 1 ? `Compra en ${cuotas} cuotas de ${clp(valorCuota({ monto, cuotas }, 1))}` : 'Gasto anotado'), tx };
}

export function formCuenta(W: FinanceState, f: { banco: string; alias?: string; tipo: TipoCuenta; saldo?: number; cupo?: number; deuda?: number; origen?: Ref | 'nuevo' | null }, ctx: Ctx): FormResult & { id?: Ref } {
  const banco = String(f.banco || ''), alias = String(f.alias || '').trim(), tipo = f.tipo;
  if (!banco) return NO('Elige el banco');
  if (banco === 'Otro' && !alias) return NO('Ponle un nombre a la cuenta');
  const nombre = banco === 'Otro' ? alias : (alias ? `${banco} · ${alias}` : banco);
  if (estado(W).cuentas.some((c) => c.nombre.toLowerCase() === nombre.toLowerCase())) return NO('Ya tienes una cuenta con ese nombre');
  const id = ctx.newId();
  if (tipo === 'credito') {
    const cupo = num(f.cupo), deuda = Math.max(0, num(f.deuda));
    if (cupo <= 0) return NO('Indica el cupo total de la tarjeta');
    W.cuentas = [...defsAll(W), { id, nombre, banco, tipo, cupo, saldoInicial: Math.max(0, cupo - deuda) }];
  } else {
    const saldo = Math.max(0, num(f.saldo)), origen = f.origen === 'nuevo' || f.origen == null ? null : refValida(W, f.origen);
    if (origen != null && saldo > 0) {
      const err = sinFondosForm(W, origen, saldo); if (err) return NO(err);
      W.cuentas = [...defsAll(W), { id, nombre, banco, tipo, saldoInicial: 0 }];
      addTx(W, { tipo: 'transfer', monto: saldo, desde: origen, hacia: id, desc: 'Saldo inicial' }, ctx);
    } else W.cuentas = [...defsAll(W), { id, nombre, banco, tipo, saldoInicial: saldo }];
  }
  if (W.lastCuenta == null && tipo !== 'ahorro') W.lastCuenta = id;
  return { ...OK(`${nombre} agregada`), id };
}

/** Giro, entrada de plata (ingreso o abono), transferencia, pago de tarjeta y ajuste de saldo. */
export function formMov(W: FinanceState, f: { tipo: 'giro' | 'abono' | 'transfer' | 'pago' | 'ajuste'; desde?: Ref | null; hacia?: Ref | null; monto: number | string; desc?: string; fuente?: string }, ctx: Ctx): FormResult {
  const { tipo } = f, desc = String(f.desc || '').trim(), m = Number(f.monto);
  const desde = refValida(W, f.desde), hacia = refValida(W, f.hacia);
  if (tipo === 'ajuste') {
    if (f.monto === '' || Number.isNaN(m)) return NO('Ingresa el saldo real');
    if (hacia == null) return NO('Elige la cuenta');
    const delta = m - (vistaCuenta(estado(W), hacia)?.saldo ?? 0);
    if (delta !== 0) addTx(W, { tipo: 'ajuste', monto: delta, hacia, desc: desc || 'Ajuste de saldo' }, ctx);
    return OK('Saldo ajustado');
  }
  if (!m || m <= 0) return NO('¡Ingresa un monto!');
  if (tipo !== 'abono' && desde == null) return NO('Elige de dónde sale');
  if (hacia == null) return NO('Elige a dónde va');
  if (desde != null && desde === hacia) return NO('Origen y destino son la misma cuenta');
  const err = (desde != null && sinFondosForm(W, desde, m)) || tapaCredito(W, hacia, m); if (err) return NO(err);
  if (tipo === 'abono') {
    // Sueldo, extra o pasivo: es un INGRESO (cuenta para el mes). "Otro" (devolución, traspaso…): solo entra plata.
    const fuente = (f.fuente && f.fuente in FUENTES && estado(W).tipo(hacia) !== 'credito') ? f.fuente as Fuente : null;
    addTx(W, fuente ? { tipo: 'ingreso', fuente, monto: m, hacia, desc: desc || FUENTES[fuente].label } : { tipo: 'abono', monto: m, hacia, desc: desc || 'Abono' }, ctx);
    return OK(fuente ? 'Ingreso anotado' : 'Abono anotado');
  }
  const defDesc = { giro: 'Giro', transfer: 'Transferencia', pago: 'Pago de tarjeta' }[tipo];
  addTx(W, { tipo: tipo === 'giro' ? 'giro' : 'transfer', monto: m, desde, hacia, desc: desc || defDesc }, ctx);
  return OK({ giro: 'Giro anotado', transfer: 'Transferencia lista', pago: 'Tarjeta pagada' }[tipo]);
}

export function formAhorro(W: FinanceState, f: { desc: string; monto: number; fecha?: string; desde?: Ref | null }, ctx: Ctx): FormResult {
  if (!String(f.desc || '').trim() || !(num(f.monto) > 0)) return NO('¡Datos incompletos!');
  const monto = num(f.monto), desde = refValida(W, f.desde);
  const err = sinFondosForm(W, desde, monto); if (err) return NO(err);
  const hacia = cuentaAhorro(W, ctx);
  if (desde === hacia) return NO('Esa ya es tu cuenta de ahorro');
  addTx(W, { tipo: 'ahorro', fecha: f.fecha || todayStr(ctx.now), monto, desde, hacia, desc: String(f.desc).trim() }, ctx);
  return OK('Ahorro anotado');
}

export function formPrestamo(W: FinanceState, f: { desc: string; monto: number; fecha?: string; devolucion?: string; cuenta?: Ref | null }, ctx: Ctx): FormResult {
  if (!String(f.desc || '').trim() || !(num(f.monto) > 0)) return NO('¡Datos incompletos!');
  const monto = num(f.monto), ref = refValida(W, f.cuenta);
  const err = sinFondosForm(W, ref, monto); if (err) return NO(err);
  addTx(W, { tipo: 'prestamo', fecha: f.fecha || todayStr(ctx.now), monto, desde: ref, desc: String(f.desc).trim(), ...(f.devolucion ? { devolucion: f.devolucion } : {}) }, ctx);
  return OK('Préstamo anotado');
}

/** El sueldo se configura UNA vez (líquido, día de pago, cuenta, quincena) y cada mes se confirma. Mismos ids si ya existía. */
export function formSueldo(W: FinanceState, f: { monto: number; dia: number; cuenta?: Ref | null; quincena?: boolean; antMonto?: number; antDia?: number }, ctx: Ctx): FormResult {
  const total = num(f.monto), ant = f.quincena ? num(f.antMonto) : 0;
  if (total <= 0) return NO('Pon tu sueldo líquido (lo que te llega)');
  if (f.quincena && (ant <= 0 || ant >= total)) return NO('El anticipo tiene que ser menor que el sueldo total');
  const cuenta = refValida(W, f.cuenta), dia = Math.min(Math.max(num(f.dia) || 30, 1), 31), antDia = Math.min(Math.max(num(f.antDia) || 15, 1), 31);
  const sueldoProg = W.prog.filter((p) => p.tipo === 'ingreso' && p.fuente === 'sueldo');
  const viejoSal = sueldoProg.find((p) => p.parte !== 'anticipo'), viejoAnt = sueldoProg.find((p) => p.parte === 'anticipo');
  const nuevos: Prog[] = [{ id: viejoSal ? viejoSal.id : ctx.newId(), tipo: 'ingreso', fuente: 'sueldo', parte: 'saldo', desc: f.quincena ? 'Sueldo (saldo)' : 'Sueldo', monto: total - ant, dia, ...(cuenta != null ? { cuenta } : {}) }];
  if (f.quincena) nuevos.unshift({ id: viejoAnt ? viejoAnt.id : ctx.newId(), tipo: 'ingreso', fuente: 'sueldo', parte: 'anticipo', desc: 'Anticipo (quincena)', monto: ant, dia: antDia, ...(cuenta != null ? { cuenta } : {}) });
  W.prog = [...W.prog.filter((x) => !(x.tipo === 'ingreso' && x.fuente === 'sueldo')), ...nuevos];
  if (total !== sueldoVigente(W, ctx.now)) W.sueldo = [...W.sueldo, { id: ctx.newId(), desc: W.sueldo.length ? 'Cambio de sueldo' : 'Sueldo', monto: total, fecha: todayStr(ctx.now) }];
  return OK(`Listo: el día ${dia} te pregunto si llegó${f.quincena ? ` (y el ${antDia} la quincena)` : ''}`);
}

/** Fijos: gastos que se anotan solos en su día, o ingresos que en su día preguntan «¿llegó?». */
export function formProg(W: FinanceState, f: { tipo: 'gasto' | 'ingreso'; desc: string; monto: number; dia: number; cat?: string; fuente?: string; cuenta?: Ref | null }, ctx: Ctx): FormResult {
  if (!String(f.desc || '').trim() || !(num(f.monto) > 0)) return NO('¡Datos incompletos!');
  const cuenta = refValida(W, f.cuenta), dia = Math.min(Math.max(num(f.dia) || 1, 1), 31);
  W.prog = [...W.prog, { id: ctx.newId(), tipo: f.tipo, desc: String(f.desc).trim(), monto: num(f.monto), dia,
    ...(f.tipo === 'gasto' ? { cat: f.cat || 'otros' } : { fuente: f.fuente || 'pasivo' }), ...(cuenta != null ? { cuenta } : {}) }];
  return OK(f.tipo === 'gasto' ? 'Gasto fijo guardado: se anota solo en su día' : 'Ingreso fijo guardado: en su día te pregunto si llegó');
}

export function formMeta(W: FinanceState, f: { desc: string; target: number; fecha?: string }, ctx: Ctx): FormResult {
  if (!String(f.desc || '').trim() || !(num(f.target) > 0)) return NO('¡Datos incompletos!');
  W.metas = [...W.metas, { id: ctx.newId(), desc: String(f.desc).trim(), target: num(f.target), ...(f.fecha ? { fecha: f.fecha } : {}) }];
  return OK('Meta guardada');
}

/** Cobrar un préstamo devuelve la plata a la cuenta de donde salió; desmarcarlo borra el cobro. */
export function marcarCobrado(W: FinanceState, id: Tx['id'], ctx: Ctx): FormResult {
  const E = estado(W), d = vistas(E).meDeban.find((x) => x.id === id);
  if (!d) return NO('No encontré ese préstamo');
  if (d.cobrado) { W.tx = W.tx.filter((t) => !(t.tipo === 'cobro' && t.prestamoId === id)); return OK('Vuelve a estar pendiente'); }
  const vuelve = d.cuenta != null && (d.cuenta === CASH || E.activa(d.cuenta)) ? d.cuenta : null;
  addTx(W, { tipo: 'cobro', prestamoId: id, monto: d.monto, hacia: vuelve, desc: 'Cobro' }, ctx);
  return OK(vuelve != null ? `Cobrado · +${clp(d.monto)} a ${E.nombre(vuelve)}` : 'Cobrado');
}

export type BorrarTipo = 'tx' | 'cuenta' | 'prog' | 'meta' | 'ingreso_hist';
/** Lo que pasa si se borra (para confirmar antes). */
export function avisoBorrar(S: FinanceState, tipo: BorrarTipo, id: unknown): string {
  const E = estado(S), V = vistas(E);
  if (tipo === 'tx') {
    const t = S.tx.find((x) => x.id === id); if (!t) return 'No se puede deshacer';
    if (t.tipo === 'gasto' && t.desde != null && E.activa(t.desde)) return Number(t.cuotas) > 1 ? `Se borra la compra completa (${t.cuotas} cuotas) y vuelven ${clp(t.monto)} al cupo de ${E.nombre(t.desde)}` : `Se devuelven ${clp(t.monto)} a ${E.nombre(t.desde)}`;
    if (t.tipo === 'prestamo') { const d = V.meDeban.find((x) => x.id === id); if (d && !d.cobrado && d.cuenta != null && E.activa(d.cuenta)) return `Se devuelven ${clp(d.monto)} a ${E.nombre(d.cuenta)}`; }
    if (t.tipo === 'ahorro') return t.desde != null && E.activa(t.desde) ? `Vuelven ${clp(t.monto)} a ${E.nombre(t.desde)}` : `Se descuentan ${clp(t.monto)} del ahorro`;
    return 'Se revierte el movimiento en los saldos';
  }
  if (tipo === 'prog') { const x = S.prog.find((q) => q.id === id); if (x) return x.fuente === 'sueldo' ? 'Se quita tu sueldo programado (lo ya registrado se mantiene)' : 'Deja de repetirse. Lo ya registrado se mantiene.'; }
  if (tipo === 'cuenta') { const c = E.cuentas.find((q) => q.id === id); if (c) return c.tipo === 'credito' ? `Se quita ${c.nombre}${deudaDe(c) > 0 ? ` (con deuda de ${clp(deudaDe(c))})` : ''}. Lo registrado se mantiene.` : `Se quita ${c.nombre} y su saldo de ${clp(c.saldo)} deja de contar. Lo registrado se mantiene.`; }
  return 'No se puede deshacer';
}
export function borrar(W: FinanceState, tipo: BorrarTipo, id: unknown): FormResult {
  if (tipo === 'tx') return borrarTx(W, id as Tx['id']) ? OK('Eliminado') : NO('Ya no existe');
  // La cuenta se archiva (no se borra): lo anotado con ella sigue mostrando su nombre
  if (tipo === 'cuenta') { W.cuentas = defsAll(W).map((c) => (c.id === id ? { ...c, archivada: true } : c)); if (W.lastCuenta === id) W.lastCuenta = null; return OK('Cuenta quitada'); }
  if (tipo === 'prog') { W.prog = W.prog.filter((p) => p.id !== id); return OK('Eliminado'); }
  if (tipo === 'meta') { W.metas = W.metas.filter((m) => m.id !== id); return OK('Eliminado'); }
  if (tipo === 'ingreso_hist') { W.sueldo = W.sueldo.filter((s) => s.id !== id); return OK('Eliminado'); }
  return NO('No sé borrar eso');
}

/** Primer uso: sueldo líquido, ahorro que ya tienes y (opcional) presupuesto por categoría. */
export function onboarding(f: { sueldo: number; ahorro?: number; presup?: Record<string, number>; sm?: number }, ctx: Ctx): FinanceState {
  const W = emptyState();
  W.sm = num(f.sm) || SM_DEFAULT;
  W.sueldo = num(f.sueldo) > 0 ? [{ id: ctx.newId(), desc: 'Sueldo inicial', monto: num(f.sueldo), fecha: todayStr(ctx.now) }] : [];
  W.cuentas = [{ ...CASH_DEF }];
  if (num(f.ahorro) > 0) addTx(W, { tipo: 'ahorro', monto: num(f.ahorro), desde: null, hacia: cuentaAhorro(W, ctx), desc: 'Ahorro inicial' }, ctx);
  W.presup = f.presup && typeof f.presup === 'object' ? Object.fromEntries(Object.entries(f.presup).filter(([, v]) => num(v) > 0).map(([k, v]) => [k, num(v)])) : {};
  W.extra = { hw_ledger_v: '3' };
  W.setupDone = true;
  return W;
}

// ─── El tablero (Finanzas 2.0): runway, ritmo, patrimonio, tickers ────────────────────────────────────────

const diasDelMes = (now: Date) => new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
const mesAnterior = (ms: string) => { const [y, m] = ms.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; };

/** El próximo ingreso fijo que todavía no llega (sueldo primero): de ahí sale "hasta el sueldo". */
export function proximoIngreso(S: FinanceState, now: Date): { desc: string; monto: number; fecha: string; enDias: number } | null {
  const prox = proximosProgramados(S, now, 45).filter((p) => p.tipo === 'ingreso' && p.enDias >= 0);
  const p = prox.find((x) => x.fuente === 'sueldo') ?? prox[0];
  return p ? { desc: p.desc, monto: Number(p.monto) || 0, fecha: p.fecha, enDias: p.enDias } : null;
}

export interface Tablero {
  disponible: number; ingreso: number; gasto: number; resultado: number;
  /** lo que puedes gastar hasta el próximo ingreso: lo que hay a mano menos los fijos que vienen antes (puede ser negativo) */
  libre: number;
  /** fijos que se cobran antes del próximo ingreso (ya descontados de `libre`) */
  comprometido: number;
  /** gasto variable (sin fijos ↻ ni cuotas) por día en lo que va del mes */
  burnDiario: number;
  /** cuánto puedes gastar por día hasta el próximo ingreso para no quedar en rojo */
  porDiaHastaIngreso: number | null;
  /** días que te alcanza la plata a tu ritmo actual (null si no gastas nada variable aún) */
  runwayDias: number | null;
  proximo: ReturnType<typeof proximoIngreso>;
  diasAlIngreso: number;
  patrimonio: number; liquidez: number; ahorro: number; deudaTC: number; meDeben: number;
  tasaAhorro: number;
  tickers: Array<{ cat: string; monto: number; antes: number; cambio: number | null; presup: number }>;
  /** últimos 6 meses (el actual al final): gasto e ingreso de cada uno */
  tendencia: Array<{ ms: string; gasto: number; ingreso: number }>;
  /** gasto acumulado día a día este mes, para la curva */
  curva: number[];
}

export function tablero(S: FinanceState, now: Date): Tablero {
  const R = resumen(S, now), ms = mesActual(now), hoy = now.getDate(), dm = diasDelMes(now);
  const variables = R.gastosMes.filter((g) => !g.progId && !g.cuotaN && !g.compraCuotas);
  const gastoVar = variables.reduce((a, g) => a + g.monto, 0);
  const burnDiario = gastoVar / Math.max(1, hoy);
  const proximo = proximoIngreso(S, now);
  const diasAlIngreso = proximo ? Math.max(1, proximo.enDias) : Math.max(1, dm - hoy + 1);
  // Lo que queda para gastar = lo que hay a mano, menos los fijos y cuotas que vienen antes del ingreso
  const comprometido = proximosProgramados(S, now, diasAlIngreso).filter((p) => p.tipo === 'gasto' && p.enDias > 0).reduce((a, p) => a + (Number(p.monto) || 0), 0);
  const base = R.hayBoveda ? R.liquidez : R.disponible;
  const libre = base - comprometido;
  const porDiaHastaIngreso = R.hayBoveda || R.disponible > 0 ? Math.max(0, libre) / diasAlIngreso : null;
  const runwayDias = burnDiario > 0 ? Math.floor(Math.max(0, libre) / burnDiario) : null;
  // Tickers: lo de este mes contra el mes pasado HASTA EL MISMO DÍA (comparar con el mes completo engaña)
  const prev = mesAnterior(ms);
  const antes: Record<string, number> = {};
  gastosDelMes(R.V.gastos, prev).filter((g) => Number(String(g.fecha).slice(8, 10)) <= hoy || g.cuotaN).forEach((g) => { antes[String(g.cat)] = (antes[String(g.cat)] || 0) + g.monto; });
  const cats = [...new Set([...Object.keys(R.porCat), ...Object.keys(S.presup || {}).filter((c) => (S.presup[c] || 0) > 0)])];
  const tickers = cats.map((cat) => {
    const monto = R.porCat[cat] || 0, a = antes[cat] || 0;
    return { cat, monto, antes: a, cambio: a > 0 ? Math.round(((monto - a) / a) * 100) : null, presup: (S.presup || {})[cat] || 0 };
  }).sort((x, y) => y.monto - x.monto);
  const tendencia: Tablero['tendencia'] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1), m = mesStr(d.getMonth(), d.getFullYear());
    tendencia.push({ ms: m, gasto: gastosDelMes(R.V.gastos, m).reduce((a, g) => a + g.monto, 0), ingreso: ingresoDelMes(R.E.tx, m, R.sueldo, now).total });
  }
  const curva: number[] = [];
  let acc = 0;
  for (let d = 1; d <= hoy; d++) { const f = `${ms}-${pad(d)}`; acc += R.gastosMes.filter((g) => g.fecha === f).reduce((a, g) => a + g.monto, 0); curva.push(acc); }
  return {
    disponible: R.disponible, ingreso: R.ing.total, gasto: R.gastoMes, resultado: R.ing.total - R.gastoMes,
    libre, comprometido, burnDiario, porDiaHastaIngreso, runwayDias, proximo, diasAlIngreso,
    patrimonio: R.liquidez + R.V.ahorroAcum + R.pendienteCobro - R.deudaTC, liquidez: R.liquidez, ahorro: R.V.ahorroAcum, deudaTC: R.deudaTC, meDeben: R.pendienteCobro,
    tasaAhorro: Math.round(R.savingsRate), tickers, tendencia, curva,
  };
}

export interface PresupLinea {
  cat: string; presup: number; gastado: number;
  /** lo esperable a hoy: los fijos de la categoría que ya llegaron a su día + el resto repartido por día */
  esperado: number;
  /** lo que queda del mes y cuánto por día para cerrar dentro del presupuesto */
  queda: number; porDia: number;
  estado: 'al_dia' | 'apurado' | 'sobre' | 'sin_presupuesto';
  texto: string;
}

/** El presupuesto de cada categoría «al día del mes» (como los cuadros de Nutrición «a la hora»). */
export function presupuestoAlDia(S: FinanceState, now: Date): PresupLinea[] {
  const R = resumen(S, now), ms = mesActual(now), hoy = now.getDate(), dm = diasDelMes(now), quedan = Math.max(1, dm - hoy + 1);
  const cats = [...new Set([...Object.keys(S.presup || {}).filter((c) => (S.presup[c] || 0) > 0), ...Object.keys(R.porCat)])];
  return cats.map((cat) => {
    const presup = Number(S.presup?.[cat]) || 0, gastado = R.porCat[cat] || 0;
    if (!(presup > 0)) return { cat, presup: 0, gastado, esperado: 0, queda: 0, porDia: 0, estado: 'sin_presupuesto' as const, texto: 'Sin presupuesto' };
    const fijos = S.prog.filter((p) => p.tipo === 'gasto' && (p.cat || 'otros') === cat);
    const fijosTotal = Math.min(presup, fijos.reduce((a, p) => a + (Number(p.monto) || 0), 0));
    const fijosYa = Math.min(fijosTotal, fijos.filter((p) => diaEnMes(p.dia, ms) <= hoy).reduce((a, p) => a + (Number(p.monto) || 0), 0));
    const esperado = fijosYa + (presup - fijosTotal) * (hoy / dm);
    const queda = presup - gastado, porDia = Math.max(0, queda - (fijosTotal - fijosYa)) / quedan;
    if (gastado > presup) return { cat, presup, gastado, esperado, queda, porDia: 0, estado: 'sobre' as const, texto: `Sobre el presupuesto por ${clp(gastado - presup)}` };
    if (gastado <= esperado * 1.05) return { cat, presup, gastado, esperado, queda, porDia, estado: 'al_dia' as const, texto: `Al día ✓ · quedan ${clp(queda)} (~${clp(porDia)}/día)` };
    return { cat, presup, gastado, esperado, queda, porDia, estado: 'apurado' as const, texto: `Para cerrar en presupuesto: ≤ ${clp(porDia)}/día` };
  }).sort((a, b) => (b.presup > 0 ? 1 : 0) - (a.presup > 0 ? 1 : 0) || b.gastado - a.gastado);
}

// ─── Rating financiero (reemplaza al Rango Hunter) ───────────────────────────────────────────────────────
// Califica CÓMO manejas la plata, no cuánto ganas (el rango por múltiplos del sueldo mínimo juzgaba: «medir sin
// obsesión»). Estilo agencia (AAA … CCC) y siempre dice qué lo sube.

export interface RatingParte { id: string; label: string; valor: number; texto: string }
export interface Rating { nota: string; score: number; partes: RatingParte[]; mejoras: string[] }
const NOTAS: Array<[number, string]> = [[90, 'AAA'], [80, 'AA'], [70, 'A'], [60, 'BBB'], [50, 'BB'], [40, 'B'], [0, 'CCC']];
const lerp = (x: number, pts: Array<[number, number]>) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); }
  return pts[pts.length - 1][1];
};

export function rating(S: FinanceState, now: Date): Rating | null {
  const T = tablero(S, now), R = resumen(S, now);
  const meses = T.tendencia.slice(0, 5).filter((t) => t.gasto > 0); // los meses cerrados con datos
  const gastoMes = meses.length ? meses.reduce((a, t) => a + t.gasto, 0) / meses.length : T.gasto;
  const ingresoMes = T.ingreso || R.sueldo;
  if (!(ingresoMes > 0) && !(gastoMes > 0)) return null; // sin datos no se califica
  const tasa = ingresoMes > 0 ? (ingresoMes - T.gasto) / ingresoMes : 0;
  const colchon = gastoMes > 0 ? T.ahorro / gastoMes : (T.ahorro > 0 ? 6 : 0);
  const tieneTC = R.E.cuentas.some((c) => c.tipo === 'credito');
  const deudaRel = ingresoMes > 0 ? T.deudaTC / ingresoMes : (T.deudaTC > 0 ? 2 : 0);
  const pres = presupuestoAlDia(S, now).filter((l) => l.presup > 0);
  const sobre = pres.filter((l) => l.estado === 'sobre').length;
  const runwayOk = T.runwayDias == null ? null : T.runwayDias / Math.max(1, T.diasAlIngreso);
  const partes: Array<RatingParte & { w: number }> = [
    { id: 'ahorro', label: 'Tasa de ahorro', w: 0.3, valor: lerp(tasa, [[-0.2, 0], [0, 0.3], [0.1, 0.6], [0.2, 1]]), texto: `${Math.round(tasa * 100)} % de lo que entra este mes` },
    { id: 'colchon', label: 'Colchón', w: 0.25, valor: lerp(colchon, [[0, 0], [1, 0.4], [3, 0.75], [6, 1]]), texto: `${colchon.toFixed(1).replace('.', ',')} meses de gastos ahorrados` },
    { id: 'deuda', label: 'Deuda de tarjetas', w: 0.2, valor: tieneTC || T.deudaTC > 0 ? lerp(deudaRel, [[0, 1], [0.3, 0.8], [0.6, 0.5], [1, 0]]) : 1, texto: T.deudaTC > 0 ? `${Math.round(deudaRel * 100)} % de tu ingreso del mes` : 'Sin deuda' },
    { id: 'presup', label: 'Presupuesto', w: 0.15, valor: pres.length ? 1 - sobre / pres.length : 0.6, texto: pres.length ? (sobre ? `${sobre} de ${pres.length} categorías sobre el tope` : 'Todas dentro del tope') : 'Sin topes por categoría' },
    { id: 'runway', label: 'Te alcanza', w: 0.1, valor: runwayOk == null ? 0.7 : Math.min(1, runwayOk), texto: T.runwayDias == null ? 'Sin gasto variable este mes' : `${T.runwayDias} días a tu ritmo (${T.diasAlIngreso} hasta el ingreso)` },
  ];
  const score = Math.round(partes.reduce((a, p) => a + p.w * Math.max(0, Math.min(1, p.valor)), 0) * 100);
  const nota = NOTAS.find(([min]) => score >= min)![1];
  // Qué lo sube: lo que más puntos deja sobre la mesa, dicho en concreto
  const ideas: Record<string, string> = {
    ahorro: ingresoMes > 0 ? `Aparta el 10 % de lo que entra apenas llegue (~${clp(ingresoMes * 0.1)} al mes).` : 'Anota lo que te entra para medir cuánto ahorras.',
    colchon: gastoMes > 0 ? `Junta un colchón de 3 meses de gastos (~${clp(gastoMes * 3)}); vas en ${clp(T.ahorro)}.` : 'Empieza un ahorro de emergencia, aunque sea chico.',
    deuda: `Baja la deuda de tarjetas bajo el 30 % de tu ingreso (hoy ${clp(T.deudaTC)}): evita compras nuevas en cuotas este mes.`,
    presup: pres.length ? 'Revisa las categorías sobre el tope en Plan → Topes por categoría.' : 'Ponle tope a tus categorías principales (comida, transporte): te aviso antes de pasarte.',
    runway: T.porDiaHastaIngreso != null ? `A tu ritmo no llegas al ingreso: apunta a ≤ ${clp(T.porDiaHastaIngreso)} por día.` : 'Baja el gasto diario hasta el próximo ingreso.',
  };
  const mejoras = [...partes].filter((p) => p.valor < 0.85).sort((a, b) => b.w * (1 - b.valor) - a.w * (1 - a.valor)).slice(0, 2).map((p) => ideas[p.id]);
  return { nota, score, partes: partes.map(({ w: _w, ...p }) => p), mejoras };
}

// ─── «¿Y si me compro…?» ─────────────────────────────────────────────────────────────────────────────────
// La compra se anota en una COPIA y se recalcula todo (tablero, presupuesto al día, rating): lo mismo que verías después
// de anotarla de verdad. No escribe nada. La usan el chat (servidor, sobre el último respaldo) y la app.

export const CAT_NOMBRE: Record<string, string> = { vivienda: 'Vivienda', alimentacion: 'Comida', transporte: 'Transporte', salud: 'Salud', entretenimiento: 'Ocio', deuda: 'Deudas', educacion: 'Educación', hogar: 'Hogar', otros: 'Otros' };

export interface Compra { monto: number; cat?: string; cuotas?: number; cuenta?: Ref | null; desc?: string }
export interface Simulacion {
  monto: number; cat: string; cuotas: number; valorCuota: number;
  cuenta: { nombre: string; tipo: TipoCuenta } | null;
  /** "hasta el sueldo (en 12 días)" / "hasta fin de mes" */
  hasta: string;
  antes: { libre: number; porDia: number | null; burnDiario: number; deudaTC: number; nota: string | null };
  despues: { libre: number; porDia: number | null; deudaTC: number; nota: string | null; cuotasProxMes: number };
  presup: { cat: string; presup: number; queda: number; porDia: number; sobre: number } | null;
  veredicto: 'holgado' | 'justo' | 'no_alcanza';
  lineas: string[];
}

export function simularCompra(S: FinanceState, c: Compra, now: Date): Simulacion | null {
  const monto = Math.round(Number(c.monto) || 0);
  if (!(monto > 0)) return null;
  const E = estado(S);
  const cat = (CATEGORIAS as readonly string[]).includes(String(c.cat)) ? String(c.cat) : 'otros';
  let cuotas = Math.max(1, Math.min(48, Math.round(Number(c.cuotas) || 1)));
  const avisos: string[] = [];
  let ref: Ref | null = c.cuenta != null && (c.cuenta === CASH || E.activa(c.cuenta)) ? c.cuenta : null;
  if (cuotas > 1 && (ref == null || E.tipo(ref) !== 'credito')) {
    ref = [...E.cuentas].filter((x) => x.tipo === 'credito').sort((a, b) => b.saldo - a.saldo)[0]?.id ?? null;
    if (ref == null) { cuotas = 1; avisos.push('No tienes tarjeta de crédito anotada: lo calculé al contado.'); }
  }
  if (ref == null) {
    // Al contado sale de la plata a mano: la cuenta de la última vez si le alcanza; si no, la que más tiene
    const aMano: Array<{ id: Ref; saldo: number }> = [...(E.efectivo > 0 ? [{ id: CASH as Ref, saldo: E.efectivo }] : []), ...E.cuentas.filter((x) => x.tipo === 'debito')];
    const last = aMano.find((x) => x.id === S.lastCuenta && x.saldo >= monto);
    ref = last ? last.id : ([...aMano].sort((a, b) => b.saldo - a.saldo)[0]?.id ?? null);
  }
  const fondos = sinFondosForm(S, ref, monto);
  if (fondos) avisos.push(`${fondos}.`);
  const W = draft(S);
  addTx(W, { tipo: 'gasto', fecha: todayStr(now), monto, desde: ref, cat, desc: String(c.desc || 'Simulación'), ...(cuotas > 1 ? { cuotas } : {}) }, { now, newId: () => -1 });
  const T0 = tablero(S, now), T1 = tablero(W, now), R0 = rating(S, now), R1 = rating(W, now);
  const p1 = presupuestoAlDia(W, now).find((l) => l.cat === cat && l.presup > 0);
  const cuotasProxMes = cuotasPorCobrar(vistas(estado(W)).gastos, null, now).proxMes;
  const vc = valorCuota({ monto, cuotas }, 1);
  const hasta = T0.proximo ? `hasta tu ${T0.proximo.desc.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase()} (en ${T0.proximo.enDias} día${T0.proximo.enDias === 1 ? '' : 's'})` : 'hasta fin de mes';
  const ingreso = T0.ingreso || sueldoEsperado(S, now);
  const sobre = p1 && p1.gastado > p1.presup ? p1.gastado - p1.presup : 0;

  let veredicto: Simulacion['veredicto'];
  if (cuotas > 1) veredicto = fondos ? 'no_alcanza' : ingreso > 0 && cuotasProxMes / ingreso > 0.3 ? 'justo' : 'holgado';
  else if (T1.libre < 0) veredicto = 'no_alcanza';
  else if (sobre > 0 || p1?.estado === 'apurado' || (T0.burnDiario > 0 && T1.porDiaHastaIngreso != null && T1.porDiaHastaIngreso < T0.burnDiario)) veredicto = 'justo';
  else veredicto = 'holgado';

  const L: string[] = [];
  if (cuotas > 1) {
    L.push(`En ${cuotas} cuotas son ~${clp(vc)} al mes desde el próximo estado de cuenta (sin contar intereses): lo que tienes para gastar este mes no cambia.`);
    L.push(`Con las cuotas que ya tienes, el próximo mes pagarías ${clp(cuotasProxMes)} en cuotas${ingreso > 0 ? ` (${Math.round((cuotasProxMes / ingreso) * 100)} % de lo que te entra)` : ''}.`);
    L.push(`La deuda en tarjetas sube de ${clp(T0.deudaTC)} a ${clp(T1.deudaTC)}.`);
  } else {
    const fijos = T0.comprometido > 0 ? ` (ya descontados ${clp(T0.comprometido)} de fijos que vienen)` : '';
    if (T0.libre < 0) L.push(`Hoy ya te faltan ${clp(-T0.libre)} para llegar ${hasta}${fijos}.`);
    else L.push(`Hoy tienes ${clp(T0.libre)} para gastar ${hasta}${T0.porDiaHastaIngreso != null && T0.libre > 0 ? `, ~${clp(T0.porDiaHastaIngreso)} por día` : ''}${fijos}.`);
    L.push(T1.libre < 0 ? `Con la compra te faltarían ${clp(-T1.libre)}.` : `Con la compra te quedarían ${clp(T1.libre)}${T1.porDiaHastaIngreso != null && T1.libre > 0 ? ` (~${clp(T1.porDiaHastaIngreso)} por día)` : ''}.`);
    if (T0.burnDiario > 0 && T1.libre >= 0 && T1.porDiaHastaIngreso != null) {
      L.push(T1.porDiaHastaIngreso >= T0.burnDiario ? `A tu ritmo de ${clp(T0.burnDiario)} por día te sigue alcanzando.` : `Hoy gastas ~${clp(T0.burnDiario)} por día: para llegar tendrías que bajar a ${clp(T1.porDiaHastaIngreso)}.`);
    }
    if (p1) L.push(sobre > 0 ? `${CAT_NOMBRE[cat] ?? cat}: te pasarías del presupuesto del mes por ${clp(sobre)}.` : `${CAT_NOMBRE[cat] ?? cat}: te quedarían ${clp(p1.queda)} del presupuesto del mes (~${clp(p1.porDia)} por día).`);
  }
  if (R0 && R1 && R0.nota !== R1.nota) L.push(`Tu rating pasaría de ${R0.nota} a ${R1.nota}.`);
  L.push(...avisos);
  const cv = ref != null ? vistaCuenta(estado(S), ref) : null;
  return {
    monto, cat, cuotas, valorCuota: cuotas > 1 ? vc : monto, cuenta: cv ? { nombre: cv.nombre, tipo: cv.tipo } : null, hasta,
    antes: { libre: T0.libre, porDia: T0.porDiaHastaIngreso, burnDiario: T0.burnDiario, deudaTC: T0.deudaTC, nota: R0?.nota ?? null },
    despues: { libre: T1.libre, porDia: T1.porDiaHastaIngreso, deudaTC: T1.deudaTC, nota: R1?.nota ?? null, cuotasProxMes },
    presup: p1 ? { cat, presup: p1.presup, queda: p1.queda, porDia: p1.porDia, sobre } : null,
    veredicto, lineas: L,
  };
}

// ─── Comida fuera y delivery (cruce con Nutrición, F5) ──────────────────────────────────────────────────────
const FUERA_RX = /\b(delivery|rappi|pedidos ?ya|uber ?eats|didi ?food|mcdonald\w*|mc ?donald\w*|burger ?king|kfc|wendy\w*|doggis|juan maestro|telepizza|domino\w*|papa john\w*|pizza hut|little caesars|starbucks|dunkin\w*|subway|completos?|sushi|pizzas?|hamburguesas?|restaurant\w*|picada|comida rapida|fuente de soda|shawarma|kebab)\b/;

/** Lo gastado este mes en comida fuera de casa y delivery (por descripción y categoría). */
export function comidaFuera(S: FinanceState, now: Date): { monto: number; veces: number } {
  const ms = mesActual(now);
  let monto = 0, veces = 0;
  for (const t of S.tx) {
    if (t.tipo !== 'gasto' || !String(t.fecha).startsWith(ms) || (t.cat && t.cat !== 'alimentacion')) continue;
    if (!FUERA_RX.test(foldTxt(t.desc))) continue;
    monto += t.monto; veces++;
  }
  return { monto, veces };
}

// ─── Conciliar la cartola (Finanzas 2.0, F4) ──────────────────────────────────────────────────────────────
// La cartola del banco contra lo anotado: mismo monto y fecha a ±2 días (el banco contabiliza después). Cada movimiento
// anotado calza con uno solo. Lo que falta se PROPONE (la persona confirma); nada se anota solo.

export interface MovExterno { fecha: string; desc: string; monto: number }
export interface Conciliacion {
  coinciden: Array<{ mov: MovExterno; tx: { id: Tx['id']; desc: string; fecha: string; monto: number } }>;
  /** cargos de la cartola que no están anotados */
  faltan: MovExterno[];
  /** abonos de la cartola que no están anotados */
  abonosFaltan: MovExterno[];
}

const SALIDA = new Set(['gasto', 'giro', 'transfer', 'ahorro', 'prestamo']);
const ENTRADA = new Set(['ingreso', 'abono', 'transfer', 'cobro', 'giro']);

export function conciliarCartola(S: FinanceState, movs: MovExterno[], opts: { cuenta?: Ref | null; dias?: number } = {}): Conciliacion {
  const dias = opts.dias ?? 2, cuenta = opts.cuenta ?? null;
  const dia = (f: string) => Date.parse(`${String(f).slice(0, 10)}T12:00:00`);
  const usados = new Set<Tx['id']>();
  const coinciden: Conciliacion['coinciden'] = [], faltan: MovExterno[] = [], abonosFaltan: MovExterno[] = [];
  // Primero los de fecha más cercana: así un gasto repetido (2 almuerzos iguales) calza con el día correcto
  const orden = [...movs].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  for (const m of orden) {
    const salida = m.monto < 0, monto = Math.abs(Math.round(m.monto));
    const cands = S.tx.filter((t) => !usados.has(t.id) && Math.round(t.monto) === monto
      && (salida ? SALIDA.has(t.tipo) && (cuenta == null || t.desde === cuenta || t.desde == null)
                 : ENTRADA.has(t.tipo) && (cuenta == null || t.hacia === cuenta || t.hacia == null))
      && Math.abs(dia(t.fecha) - dia(m.fecha)) <= dias * 86_400_000);
    const best = cands.sort((a, b) => Math.abs(dia(a.fecha) - dia(m.fecha)) - Math.abs(dia(b.fecha) - dia(m.fecha))
      || (a.desde === cuenta ? -1 : 0) - (b.desde === cuenta ? -1 : 0))[0];
    if (best) { usados.add(best.id); coinciden.push({ mov: m, tx: { id: best.id, desc: best.desc, fecha: best.fecha, monto: best.monto } }); }
    else (salida ? faltan : abonosFaltan).push(m);
  }
  return { coinciden, faltan, abonosFaltan };
}

/** Atajos: lo que más repites (descripción + categoría + cuenta), de los últimos 90 días. */
export function atajos(S: FinanceState, now: Date, max = 6): Array<{ desc: string; cat: string; cuenta: Ref | null; monto: number; veces: number }> {
  const desde = new Date(now.getTime() - 90 * 86400000), lim = todayStr(desde);
  const grupos = new Map<string, { desc: string; cat: string; cuenta: Ref | null; montos: number[]; veces: number; ultimo: string }>();
  for (const t of S.tx) {
    if (t.tipo !== 'gasto' || t.progId != null || t.recurId != null || Number(t.cuotas) > 1 || String(t.fecha) < lim) continue;
    const desc = String(t.desc || '').replace(/\s*↻$/, '').trim();
    if (!desc) continue;
    const k = `${foldTxt(desc)}|${t.cat}|${t.desde ?? ''}`;
    const g = grupos.get(k) ?? { desc, cat: String(t.cat || 'otros'), cuenta: t.desde ?? null, montos: [], veces: 0, ultimo: '' };
    g.montos.push(t.monto); g.veces++; if (t.fecha > g.ultimo) g.ultimo = t.fecha;
    grupos.set(k, g);
  }
  return [...grupos.values()].filter((g) => g.veces >= 2)
    .sort((a, b) => b.veces - a.veces || (a.ultimo < b.ultimo ? 1 : -1)).slice(0, max)
    .map((g) => { const s = [...g.montos].sort((a, b) => a - b); return { desc: g.desc, cat: g.cat, cuenta: g.cuenta, monto: s[Math.floor(s.length / 2)], veces: g.veces }; });
}

// ─── hw* ↔ estado ─────────────────────────────────────────────────────────
// Las claves que usaba hunter-wallet.html (localStorage, y el respaldo del PC). Mismos valores por defecto que ls.get.

const KEYMAP = { cuentas: 'hw2_cuentas', tx: 'hw2_tx', prog: 'hw2_prog', rec: 'hw2_rec_applied', sueldo: 'hw2_sueldo', presup: 'hw_presup', metas: 'hw_metas', sm: 'hw_sm', lastCuenta: 'hw_last_cuenta', chatLog: 'hw_chat_log', setupDone: 'hw_setup_done' } as const;

function parse<T>(raw: string | undefined, def: T): T {
  if (raw == null) return def;
  try { const v = JSON.parse(raw); return v == null ? def : (v as T); } catch { return def; }
}

export function fromHwKeys(keys: Record<string, string>): FinanceState {
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const known = new Set<string>(Object.values(KEYMAP));
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(keys)) if (!known.has(k) && typeof v === 'string') extra[k] = v;
  const presup = parse<Record<string, number>>(keys[KEYMAP.presup], {});
  return {
    cuentas: arr<CuentaDef>(parse(keys[KEYMAP.cuentas], [])),
    tx: arr<Tx>(parse(keys[KEYMAP.tx], [])),
    prog: arr<Prog>(parse(keys[KEYMAP.prog], [])),
    rec: arr<string>(parse(keys[KEYMAP.rec], [])).map(String),
    sueldo: arr<SueldoHist>(parse(keys[KEYMAP.sueldo], [])),
    presup: presup && typeof presup === 'object' && !Array.isArray(presup) ? presup : {},
    metas: arr<Meta>(parse(keys[KEYMAP.metas], [])),
    sm: Number(parse(keys[KEYMAP.sm], SM_DEFAULT)) || SM_DEFAULT,
    lastCuenta: parse<Ref | null>(keys[KEYMAP.lastCuenta], null),
    chatLog: arr<ChatLogEntry>(parse(keys[KEYMAP.chatLog], [])),
    setupDone: parse<boolean>(keys[KEYMAP.setupDone], false) === true,
    extra,
  };
}

/** El estado como claves hw* (lo que guardaría hunter-wallet.html): para el respaldo del PC y para volver a la web. */
export function toHwKeys(S: FinanceState): Record<string, string> {
  const out: Record<string, string> = { ...S.extra };
  out[KEYMAP.cuentas] = JSON.stringify(S.cuentas);
  out[KEYMAP.tx] = JSON.stringify(S.tx);
  out[KEYMAP.prog] = JSON.stringify(S.prog);
  out[KEYMAP.rec] = JSON.stringify(S.rec);
  out[KEYMAP.sueldo] = JSON.stringify(S.sueldo);
  out[KEYMAP.presup] = JSON.stringify(S.presup);
  out[KEYMAP.metas] = JSON.stringify(S.metas);
  out[KEYMAP.sm] = JSON.stringify(S.sm);
  out[KEYMAP.lastCuenta] = JSON.stringify(S.lastCuenta);
  out[KEYMAP.chatLog] = JSON.stringify(S.chatLog);
  out[KEYMAP.setupDone] = JSON.stringify(S.setupDone);
  return out;
}
