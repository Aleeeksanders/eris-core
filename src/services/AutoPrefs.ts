// ============================================================
// Eris — «Así manejo tu…» (Eris administra, A3): lo que Eris hace sola en cada módulo
//
// La app manda la foto de sus interruptores (`save_preference` → `pref_auto_prefs`); acá se lee con valores seguros (lo que
// falta = como viene de fábrica), el Plan de Eris la respeta (el tope de gasto del día, el entreno según el sueño) y el
// chat la cuenta por código («¿qué haces sola?»).
// ============================================================

export interface AutoPrefsServer {
  topeDia: boolean; segunSueno: boolean; domingo: boolean;
  plata: { anota: boolean; sueldo: boolean; cuadre: boolean; tope: number };
  casa: { comidas: boolean; prevision: boolean };
  piloto: boolean | null; sueno: boolean;
  /** los módulos encendidos en Perfil (null = la app no los mandó: todo encendido). Revisión A2 */
  modulos: string[] | null;
  /** la app todavía no la mandó (versión anterior): se cuenta lo de fábrica */
  sinDato: boolean;
}

const b = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);

export function autoPrefsDe(raw: any): AutoPrefsServer {
  const r = raw && typeof raw === "object" ? raw : {};
  const pl = r.plata && typeof r.plata === "object" ? r.plata : {};
  const ca = r.casa && typeof r.casa === "object" ? r.casa : {};
  const tope = Number(pl.tope);
  return {
    topeDia: b(r.topeDia, true), segunSueno: b(r.segunSueno, true), domingo: b(r.domingo, true),
    plata: { anota: b(pl.anota, false), sueldo: b(pl.sueldo, true), cuadre: b(pl.cuadre, true), tope: Number.isFinite(tope) && tope >= 0 ? Math.round(tope) : 100_000 },
    casa: { comidas: b(ca.comidas, true), prevision: b(ca.prevision, true) },
    piloto: typeof r.piloto === "boolean" ? r.piloto : null, sueno: b(r.sueno, true),
    modulos: Array.isArray(r.modulos) ? r.modulos.filter((m: unknown) => typeof m === "string" && m.length <= 30).slice(0, 20) : null,
    sinDato: !raw || typeof raw !== "object",
  };
}

/**
 * Revisión A2 (2026-11-04): apagar un módulo en Perfil solo escondía la pestaña; el chat igual leía y anotaba en Finanzas o
 * el Inventario. Lo que cada módulo apagado le quita al chat (id del módulo en la app → herramientas).
 */
export const MODULO_HERRAMIENTAS: Record<string, { nombre: string; tools: string[]; intent: "finance" | "inventory" | "train" }> = {
  finanzas: { nombre: "Finanzas", tools: ["finance_tracker"], intent: "finance" },
  inventario: { nombre: "Inventario", tools: ["inventory_tracker"], intent: "inventory" },
  toji: { nombre: "Forge", tools: ["training_plan", "training_today"], intent: "train" },
};

/** Los módulos apagados (en Modo AXS se ven todos, como en la app) */
export function modulosApagados(p: AutoPrefsServer, axsMode?: boolean): string[] {
  if (!p.modulos || axsMode) return [];
  return Object.keys(MODULO_HERRAMIENTAS).filter((m) => !p.modulos!.includes(m));
}

/** ¿Ese módulo está encendido? (sin dato de la app: sí). Lo que viene de un módulo apagado no entra a lo que lee Eris. */
export async function moduloOn(memory: any, id: string): Promise<boolean> {
  const p = await leerAutoPrefs(memory).catch(() => null);
  return !p || !p.modulos || p.modulos.includes(id);
}

export async function leerAutoPrefs(memory: any): Promise<AutoPrefsServer> {
  return autoPrefsDe(memory ? await memory.get("pref_auto_prefs").catch(() => null) : null);
}

const clp = (n: number) => "$" + Math.round(n).toLocaleString("es-CL");
const si = (on: boolean, txt: string) => `${on ? "✓" : "✕ (apagado)"} ${txt}`;

/** «¿Qué haces sola?»: lo que Eris hace sola en cada módulo, lo que pregunta y lo que no toca nunca. */
export function administraTexto(p: AutoPrefsServer): string {
  const l = [
    "Esto es lo que hago sola (lo cambias en la app: 🧭 en cada módulo → «Así manejo tu…»):",
    `💸 Plata: ${[si(p.plata.anota, "anoto lo que te avisa tu banco"), si(p.plata.anota && p.plata.sueldo, "confirmo tu sueldo cuando llega"), si(p.plata.anota && p.plata.cuadre, "cuadro con tu banco y arreglo lo exacto"), si(p.topeDia, "te pongo un tope para gastar hoy")].join(" · ")}. Te pregunto: un comercio o una persona nueva por más de ${clp(p.plata.tope || 100_000)} y las cuentas que no conozco. Nunca muevo tu plata ni pago nada.`,
    `🏠 Casa: ${[si(p.casa.comidas, "descuento lo que comes de la despensa"), si(p.casa.prevision, "lo que se va a acabar entra a tu lista de compras")].join(" · ")}. La boleta pasa a la despensa cuando la revisas.`,
    `🍽 Comida: ${si(p.piloto === true, "armo tu día cada mañana (piloto automático)")}. Nunca anoto una comida sin tu «Lo comí».`,
    `🏋️ Entreno: ${si(p.segunSueno, "ajusto la carga según cómo dormiste")}. Tu rutina la cargas tú.`,
    `😴 Sueño: ${si(p.sueno, "te aviso la hora de acostarte")}.`,
    `📊 ${p.domingo ? "Los domingos te cuento lo que hice sola en la semana." : "El resumen del domingo está apagado."}`,
  ];
  if (p.sinDato) l.push("(Así viene de fábrica: actualiza la app para que vea tus interruptores.)");
  return l.join("\n");
}
