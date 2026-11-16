// ============================================================
// Hestia por voz (J3, 2026-11-16): el saludo de la primera llamada del día. Lo arma el CÓDIGO con lo que ya calcula la agenda del
// día (DayAgendaTool: entreno, comidas, agua, sueño, casa, plata) y lo inmediato de AXS (MEMORY.md de la bóveda): corto en voz
// (hasta ~40 palabras, lo más importante primero) y el día completo en la pantalla. Sin el modelo: no inventa ni tarda.
// ============================================================

/** «Buenos días» de 5 a 12, «Buenas tardes» hasta las 20, si no «Buenas noches» */
export function saludoHora(h: number): string {
  return h >= 5 && h < 12 ? "Buenos días" : h >= 12 && h < 20 ? "Buenas tardes" : "Buenas noches";
}

const MAX_PALABRAS = 40;
const palabras = (t: string) => t.split(/\s+/).filter(Boolean).length;
const mayus = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
/** Una línea de la agenda como frase dicha: sin negritas, «~13:30» → «a eso de las 13:30», con punto final */
function frase(t: string): string {
  const s = t.replace(/\*\*/g, "").replace(/~\s?(\d{1,2}:\d{2})/g, "a eso de las $1").replace(/\s*\(ya es su hora\)/, ", ya es su hora")
    .replace(/\s+/g, " ").trim().replace(/[.;:,]+$/, "");
  return s ? `${mayus(s)}.` : "";
}
/** Las primeras palabras de un pendiente largo de MEMORY.md */
const recorte = (t: string, n = 9) => { const w = t.replace(/\*\*|`/g, "").split(/\s+/); return w.length > n ? `${w.slice(0, n).join(" ")}…` : w.join(" "); };

export interface DatosSaludo {
  nombre?: string | null;
  ahora: Date;
  /** el texto de la agenda del día (DayAgendaTool) */
  agenda?: string | null;
  /** lo inmediato de AXS (MEMORY.md → Tareas pendientes) */
  inmediatas?: string[];
}

/** Lo que se dice al saludar (lo más importante primero, hasta ~40 palabras) */
export function armarSaludo(d: DatosSaludo): string {
  const nombre = d.nombre?.trim().split(/\s+/)[0];
  const partes: string[] = [`${saludoHora(d.ahora.getHours())}${nombre ? `, ${nombre}` : ""}.`];
  const ag = d.agenda ?? "";
  const linea = (re: RegExp) => ag.split("\n").map((l) => re.exec(l)).find(Boolean) ?? null;

  // Entreno
  const en = linea(/🏋️\s*\*\*Entreno(?: a las (\d{1,2}:\d{2}))?:\*\*\s*(.+)/);
  if (en) {
    const toca = /toca \*\*([^*]+)\*\*/.exec(en[2]);
    if (/descansas|descanso/i.test(en[2])) partes.push("Hoy descansas del gym.");
    else if (toca) partes.push(`Hoy toca ${toca[1].trim()}${en[1] ? ` a las ${en[1]}` : ""}.`);
  }
  // El calendario del teléfono (K2): cuántas cosas y la próxima (sus títulos van entre «»: pueden ser de otros)
  const cal = linea(/📅\s*\*\*Calendario:\*\*\s*(.+)/);
  let primeraCal = "";
  if (cal) {
    const evs = [...cal[1].matchAll(/(?:(\d{1,2}):(\d{2}) )?(«[^»]*»)( \(todo el día\))?/g)]
      .map((m) => ({ min: m[1] ? Number(m[1]) * 60 + Number(m[2]) : null, hora: m[1] ? `${m[1]}:${m[2]}` : "", titulo: m[3] }));
    const ahoraMin = d.ahora.getHours() * 60 + d.ahora.getMinutes();
    // la próxima: la primera con hora que no haya pasado (hasta 30 min de gracia); si no, una de todo el día
    const p = evs.find((e) => e.min != null && e.min >= ahoraMin - 30) ?? (evs.every((e) => e.min == null) ? evs[0] : undefined);
    if (p) {
      primeraCal = p.titulo;
      const dicho = p.min != null ? `${p.titulo} a las ${p.hora}` : `${p.titulo}, todo el día`;
      partes.push(evs.length === 1 ? `En tu calendario tienes ${dicho}.` : `En tu calendario tienes ${evs.length} cosas; la próxima, ${dicho}.`);
    }
  }
  // Lo próximo (lo primero de «Lo que sigue» que no sea el entreno, ya dicho)
  const i = ag.split("\n").findIndex((l) => /\*\*Lo que sigue:\*\*/.test(l));
  if (i >= 0) {
    const sig = ag.split("\n").slice(i + 1).map((l) => /^•\s*(.+)/.exec(l)?.[1]).filter((x): x is string => !!x)
      .find((x) => !/^Entreno/.test(x) && !(primeraCal && x.includes(primeraCal))); // (el evento del calendario ya se dijo)
    if (sig) partes.push(`Lo próximo: ${frase(sig).replace(/^(.)/, (c) => c.toLowerCase())}`);
  }
  // Plata: un pago o un ingreso cercano
  const pl = linea(/💸\s*\*\*Plata:\*\*\s*(.+)/);
  if (pl) partes.push(frase(pl[1].split(";")[0]));
  // AXS: lo inmediato
  const n = d.inmediatas?.length ?? 0;
  if (n) partes.push(`En AXS tienes ${n === 1 ? "1 pendiente inmediato" : `${n} pendientes inmediatos`}; el primero: ${recorte(d.inmediatas![0])}.`);
  // Sueño (solo si la agenda lo destaca: noche corta o partida)
  const su = linea(/😴\s*\*\*Sueño:\*\*\s*(.+)/);
  if (su) partes.push(frase(su[1].split(/(?<=[.!?])\s/)[0]));

  const dicho: string[] = [];
  for (const p of partes) {
    if (!p) continue;
    if (dicho.length && palabras([...dicho, p].join(" ")) > MAX_PALABRAS) continue;
    dicho.push(p);
  }
  return dicho.join(" ");
}

/** El día completo para la pantalla (la agenda tal cual + lo inmediato de AXS) */
export function detalleSaludo(d: DatosSaludo): string | null {
  const bloques: string[] = [];
  if (d.agenda?.trim()) bloques.push(d.agenda.trim());
  if (d.inmediatas?.length) bloques.push(["**AXS · lo inmediato:**", ...d.inmediatas.slice(0, 5).map((x) => `- ${x}`)].join("\n"));
  return bloques.length ? bloques.join("\n\n") : null;
}
