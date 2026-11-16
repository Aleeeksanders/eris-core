// ============================================================
// Eris — «tu plato» (2026-11-15): cómo es el plato de la persona y la proteína con lo que hay en su casa
//
// El usuario: «las divisiones suelen ser porciones que varían bastante, en las casas de bajos recursos la cantidad de
// carbohidratos suele ser mucho mayor… y la prote suele ser muy acotada, y viceversa». Y sobre guiar: «es necesario la plata;
// lo que puede hacer es mejorar la trazabilidad de los datos entre módulos, inventario y todas esas cosas».
//   - Se pregunta UNA vez cómo es su plato; cada corrección («fue más fideos») rearma ese plato y vota; con dos seguidas
//     iguales, ese pasa a ser su plato de siempre (PlatoChat lo usa para repartir).
//   - Un plato con poca proteína: la que ya tiene en la casa (Inventario), con lo que le costó (el precio de sus boletas),
//     la más barata por gramo de proteína primero. Si no tiene nada, ideas baratas y el botón para la lista de compras.
// ============================================================

import type { PerfilPlato } from "./PlatoChat.js";
import type { InventoryState } from "./InventoryCore.js";

type Mem = { get: (k: string) => Promise<any>; set: (k: string, v: any) => Promise<void> };

export interface DatosPlato {
  tipo: PerfilPlato | null;
  /** cuándo se preguntó (una sola vez) */
  preguntado?: string;
  /** las correcciones («fue más fideos»), la más nueva al final */
  votos: Array<{ at: string; tipo: PerfilPlato }>;
  /** el último plato anotado con porciones supuestas: para rearmarlo si lo corrige */
  ultimo?: { at: string; frase: string; mealType?: string; input?: any };
  /** el día (YYYY-MM-DD) en que ya se sugirió proteína (una vez al día) */
  sugeridoDia?: string;
}

const KEY = "plato_perfil";
const esTipo = (x: unknown): x is PerfilPlato => x === "carbo" || x === "mitad" || x === "proteina";

export async function leerPlato(memory: Mem | null | undefined): Promise<DatosPlato> {
  const v: any = memory ? await memory.get(KEY).catch(() => null) : null;
  return {
    tipo: esTipo(v?.tipo) ? v.tipo : null,
    ...(typeof v?.preguntado === "string" ? { preguntado: v.preguntado } : {}),
    votos: Array.isArray(v?.votos) ? v.votos.filter((x: any) => esTipo(x?.tipo)).slice(-10) : [],
    ...(v?.ultimo && typeof v.ultimo.frase === "string" ? { ultimo: v.ultimo } : {}),
    ...(typeof v?.sugeridoDia === "string" ? { sugeridoDia: v.sugeridoDia } : {}),
  };
}
export async function guardarPlato(memory: Mem | null | undefined, d: DatosPlato): Promise<void> {
  if (memory) await memory.set(KEY, d).catch(() => {});
}

/**
 * Una corrección: se anota el voto y, si las dos últimas dicen lo mismo y no es lo que ya tenía, cambia su plato de siempre.
 * Devuelve si cambió.
 */
export function votar(d: DatosPlato, tipo: PerfilPlato, ahora = new Date()): boolean {
  d.votos = [...d.votos, { at: ahora.toISOString(), tipo }].slice(-10);
  const [a, b] = d.votos.slice(-2);
  if (a && b && a.tipo === b.tipo && d.tipo !== tipo) { d.tipo = tipo; return true; }
  return false;
}

// ─── La proteína con lo que hay en la casa ───────────────────────────────────────────────────────────────────────
interface FuenteProteina { re: RegExp; nombre: string; porcion: string; gramos: number; proteina: number; icono: string; /** cómo se dice («1 huevo», «½ lata de jurel») */ dicho?: string }
/** Porción típica y su proteína (bases de alimentos de Eris, redondeado) */
const FUENTES: FuenteProteina[] = [
  { re: /\bhuevos?\b/, nombre: "huevo", porcion: "1 huevo", dicho: "1 huevo", gramos: 55, proteina: 7, icono: "🥚" },
  { re: /\bjurel\b/, nombre: "jurel en lata", porcion: "½ lata", dicho: "½ lata de jurel", gramos: 105, proteina: 21, icono: "🐟" },
  { re: /\batun\b/, nombre: "atún en lata", porcion: "1 lata", dicho: "1 lata de atún", gramos: 120, proteina: 26, icono: "🐟" },
  { re: /\bsardinas?\b/, nombre: "sardinas", porcion: "½ lata", dicho: "½ lata de sardinas", gramos: 60, proteina: 15, icono: "🐟" },
  { re: /\b(pechuga|pollo|trutro)\b/, nombre: "pollo", porcion: "1 presa chica", gramos: 100, proteina: 27, icono: "🍗" },
  { re: /\b(carne molida|posta|vacuno|bistec|carne)\b/, nombre: "carne", porcion: "100 g", gramos: 100, proteina: 26, icono: "🥩" },
  { re: /\blentejas?\b/, nombre: "lentejas", porcion: "1 taza cocida", dicho: "1 taza de lentejas cocidas", gramos: 200, proteina: 18, icono: "🫘" },
  { re: /\bporotos?\b/, nombre: "porotos", porcion: "1 taza cocida", dicho: "1 taza de porotos cocidos", gramos: 180, proteina: 15, icono: "🫘" },
  { re: /\bgarbanzos?\b/, nombre: "garbanzos", porcion: "1 taza cocida", dicho: "1 taza de garbanzos cocidos", gramos: 165, proteina: 14, icono: "🫘" },
  { re: /\bquesillo\b/, nombre: "quesillo", porcion: "1 tajada", gramos: 50, proteina: 7, icono: "🧀" },
  { re: /\bleche\b/, nombre: "leche", porcion: "1 vaso", gramos: 200, proteina: 6, icono: "🥛" },
  { re: /\byogh?ur/, nombre: "yogur", porcion: "1 pote", gramos: 125, proteina: 5, icono: "🥛" },
  { re: /\b(tofu|soya)\b/, nombre: "tofu", porcion: "100 g", gramos: 100, proteina: 12, icono: "🫘" },
];
const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const clp = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

/** Lo que una porción le cuesta según lo que pagó (precio por unidad del ítem); null si no se sabe */
function costoPorcion(it: InventoryState["items"][number], f: FuenteProteina): number | null {
  const p = Number(it.precio);
  if (!(p > 0)) return null;
  const u = String(it.unidad);
  if (u === "kg") return (p * f.gramos) / 1000;
  if (u === "g") return p * f.gramos;
  if (u === "L") return (p * f.gramos) / 1000;
  if (u === "ml") return p * f.gramos;
  // por unidad o paquete: un huevo es una unidad; una lata, media o una; un paquete con su contenido
  const c: any = (it as any).contenido;
  if (c && Number(c.cant) > 0 && /^(g|ml)$/.test(String(c.unidad))) return (p * f.gramos) / Number(c.cant);
  if (c && Number(c.cant) > 0 && /^(kg|L)$/.test(String(c.unidad))) return (p * f.gramos) / (Number(c.cant) * 1000);
  if (f.nombre === "huevo") return p;
  if (/lata/.test(f.porcion)) return f.porcion.startsWith("½") ? p / 2 : p;
  return null;
}

export interface SugerenciaProteina { texto: string; botones: string }

/**
 * Para un plato con poca proteína: lo que tiene en la casa, la más barata por gramo de proteína primero (con su precio si
 * lo sabemos por sus boletas). Sin nada en la casa: ideas baratas y el botón para anotarlas en la lista de compras.
 * `diabetes`: se dice por qué ayuda (cuida, no trata: sin dosis ni metas de glucosa).
 */
export function sugerenciaProteina(o: { proteina: number; inventario: InventoryState | null; diabetes: boolean }): SugerenciaProteina {
  const enCasa: Array<{ f: FuenteProteina; cant: string; costo: number | null }> = [];
  for (const it of o.inventario?.items ?? []) {
    if (!(Number(it.cantidad) > 0) || (it as any).archivado) continue;
    if (!["alimentos", "despensa"].includes(String(it.area))) continue;
    const n = fold(it.nombre);
    const f = FUENTES.find((x) => x.re.test(n));
    if (!f || enCasa.some((x) => x.f.nombre === f.nombre)) continue;
    const cant = String(it.unidad) === "u" ? `${Math.round(Number(it.cantidad))}` : "";
    enCasa.push({ f, cant, costo: costoPorcion(it, f) });
  }
  // la más barata por gramo de proteína primero (sin precio, al final)
  enCasa.sort((a, b) => (a.costo == null ? 1 : 0) - (b.costo == null ? 1 : 0) || ((a.costo ?? 0) / a.f.proteina) - ((b.costo ?? 0) / b.f.proteina) || b.f.proteina - a.f.proteina);
  const porque = o.diabetes
    ? "Con tu diabetes, sumarle proteína (y verdura) al arroz o los fideos ayuda a que la glucosa no suba tan rápido."
    : "Sumarle proteína al plato te deja más satisfecho y ayuda a llegar a tu meta del día.";
  const intro = `💪 Este plato trae ${Math.round(o.proteina)} g de proteína.`;
  if (enCasa.length) {
    const lineas = enCasa.slice(0, 3).map(({ f, cant, costo }) => `${f.icono} ${f.dicho ?? `${f.porcion} de ${f.nombre}`}${cant ? ` (tienes ${cant})` : ""}: +${f.proteina} g${costo != null ? ` · ~${clp(costo)}` : ""}`);
    return { texto: `${intro} ${porque} Con lo que hay en tu casa:\n${lineas.join("\n")}`, botones: "" };
  }
  return {
    texto: `${intro} ${porque} Lo que más rinde por la plata suele ser el huevo, el jurel en lata y las legumbres.`,
    botones: "[Opción: Agrega huevos a la lista de compras] [Opción: Agrega jurel a la lista de compras]",
  };
}
