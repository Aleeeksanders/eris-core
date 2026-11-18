// Hestia como JARVIS · L4 (2026-11-18): los trabajos de fondo. Lo que se pide (por código), la cola en disco, cuándo puede usar el
// modelo (Presupuesto), cada trabajo paso a paso (con la web, la bóveda y el modelo falsos) y los vigías del PC.
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import { pideTrabajo, agregarTrabajo, leerTrabajos, cancelarTrabajos, siguiente, textoEstado, queEs, _olvidarTrabajos, type Trabajo } from "C:/Proyectos/eris/src/services/hestia/Trabajos.ts";
import { puedeFondo, QUIETO_MS, type CtxPresupuesto } from "C:/Proyectos/eris/src/services/hestia/Presupuesto.ts";
import { avanzar, revisarVigia, leerInforme, fuentesDeBusqueda, CPU_OCUPADO, type DepsTrabajo } from "C:/Proyectos/eris/src/services/hestia/Fondo.ts";
import { LIMITES_INICIALES, _olvidarEstado } from "C:/Proyectos/eris/src/services/hestia/Estado.ts";
import { comandoHestia } from "C:/Proyectos/eris/src/services/hestia/Comandos.ts";
import { parseTelefono } from "C:/Proyectos/eris/src/services/TelefonoParse.ts";

beforeEach(() => {
  const h = mkdtempSync(join(os.tmpdir(), "erishome_l4_"));
  process.env.USERPROFILE = h; process.env.HOME = h;
  _olvidarTrabajos(); _olvidarEstado();
});

test("lo que se pide: investigar, comparar, resumen de la bóveda, vigías del PC, estado y cancelar (con el tema como lo dijo)", () => {
  expect(pideTrabajo("Hestia, investiga los mejores audífonos con cancelación de ruido y me avisas")).toEqual({ tipo: "investigar", tema: "los mejores audífonos con cancelación de ruido" });
  expect(pideTrabajo("averigua qué onda con el Pixel 10")).toEqual({ tipo: "investigar", tema: "el Pixel 10" });
  expect(pideTrabajo("búscame info sobre creatina monohidratada con calma")).toEqual({ tipo: "investigar", tema: "creatina monohidratada" });
  expect(pideTrabajo("busca vuelos a Puerto Montt y me avisas")).toEqual({ tipo: "investigar", tema: "vuelos a Puerto Montt" });
  expect(pideTrabajo("compárame el Pixel 9 con el Galaxy S24")).toEqual({ tipo: "comparar", tema: "el Pixel 9", b: "el Galaxy S24" });
  expect(pideTrabajo("arma un resumen de la bóveda sobre Hunter Wallet")).toEqual({ tipo: "resumen_boveda", tema: "Hunter Wallet" });
  expect(pideTrabajo("avísame cuando termine de compilar")).toMatchObject({ tipo: "vigia_proceso", tema: "compilar", procesos: null });
  expect(pideTrabajo("avísame cuando termine el proceso ffmpeg")).toMatchObject({ tipo: "vigia_proceso", procesos: ["ffmpeg"] });
  expect(pideTrabajo("avísame si se cae Ollama")).toMatchObject({ tipo: "vigia_servicio", servicio: "ollama" });
  expect(pideTrabajo("avísame cuando aparezca el archivo informe.pdf en descargas")).toMatchObject({ tipo: "vigia_archivo", carpeta: "Downloads", archivo: "informe.pdf" });
  expect(pideTrabajo("¿en qué estás trabajando?")).toEqual({ estado: true });
  expect(pideTrabajo("cancela lo de los audífonos")).toEqual({ cancelar: "los audífonos" });
  expect(pideTrabajo("cancela todos los trabajos")).toEqual({ cancelar: null, todos: true });
  // lo de AHORA no es de fondo
  for (const t of ["busca una farmacia cerca", "revisa mis mensajes", "busca mis mensajes y me avisas", "¿qué hora es?", "investigación", "compra pan"]) expect([t, pideTrabajo(t)]).toEqual([t, null]);
  // y nada de esto es del teléfono
  for (const t of ["investiga los mejores audífonos y me avisas", "avísame cuando termine de compilar"]) expect([t, parseTelefono(t, [])]).toEqual([t, null]);
});

test("la cola: en disco, uno a la vez (los vigías aparte), cancelar por tema o todos, «¿en qué estás?»", async () => {
  const a = await agregarTrabajo({ tipo: "investigar", tema: "audífonos", pedido: "x" });
  await agregarTrabajo({ tipo: "vigia_servicio", tema: "ollama", pedido: "x", vigia: { servicio: "ollama", hasta: new Date(Date.now() + 3600e3).toISOString() } });
  const b = await agregarTrabajo({ tipo: "comparar", tema: "Pixel 9", b: "Galaxy S24", pedido: "x" });
  _olvidarTrabajos(); // (se lee de nuevo del disco)
  const xs = await leerTrabajos();
  expect(xs.map((t) => t.tema)).toEqual(["audífonos", "ollama", "Pixel 9"]);
  expect(siguiente(xs)?.id).toBe(a.id);
  expect(textoEstado(xs)).toMatch(/^En cola: investigar audífonos; avisarte si se cae ollama; comparar Pixel 9 con Galaxy S24\./);
  expect((await cancelarTrabajos({ tema: "galaxy" })).map((t) => t.id)).toEqual([b.id]);
  expect((await cancelarTrabajos({ todos: true })).length).toBe(2);
  expect(siguiente(await leerTrabajos())).toBeNull();
  expect(textoEstado(await leerTrabajos())).toMatch(/^No tengo nada de fondo/);
});

const ctx = (p: Partial<CtxPresupuesto> = {}): CtxPresupuesto => ({ pausada: false, fondoPausado: null, llamada: false, consultaEnCurso: false, msDesdeUltima: 10 * 60_000,
  medicion: { t: "", cpuPct: 20, ramLibreGb: 3, ramTotalGb: 15.6, discoLibreGb: 30, discoTotalGb: 448, gpu: { tempC: 55 } as any, modelo: null, bateria: { pct: 90, enchufado: true } }, limites: structuredClone(LIMITES_INICIALES), ...p });

test("el presupuesto: nunca le quita el modelo a nadie ni aprieta el equipo", () => {
  expect(puedeFondo(ctx())).toEqual({ ok: true, motivo: "el PC está libre" });
  expect(puedeFondo(ctx({ pausada: true })).ok).toBe(false);
  expect(puedeFondo(ctx({ fondoPausado: "poca RAM" })).motivo).toMatch(/en espera/);
  expect(puedeFondo(ctx({ llamada: true })).ok).toBe(false);
  expect(puedeFondo(ctx({ consultaEnCurso: true })).ok).toBe(false);
  expect(puedeFondo(ctx({ msDesdeUltima: QUIETO_MS - 1 })).ok).toBe(false);
  expect(puedeFondo(ctx({ medicion: { ...ctx().medicion!, ramLibreGb: 1.1 } })).motivo).toMatch(/poca RAM/);
  expect(puedeFondo(ctx({ medicion: { ...ctx().medicion!, gpu: { tempC: 83 } as any } })).ok).toBe(false);
  expect(puedeFondo(ctx({ medicion: { ...ctx().medicion!, bateria: { pct: 12, enchufado: false } } })).ok).toBe(false);
});

const WEB = [{ titulo: "Los 5 mejores audífonos 2026", url: "https://a.cl/1", resumen: "Sony WH-1000XM6 lidera; Bose QC Ultra segundo." }, { titulo: "Reseña Sony XM6", url: "https://b.cl/2", resumen: "Batería de 30 horas." }];
function deps(p: Partial<DepsTrabajo> & { modeloTexto?: string } = {}) {
  const llamadas: string[] = [];
  const d: DepsTrabajo = {
    web: async (q) => { llamadas.push(`web:${q}`); return WEB; },
    boveda: async (q, n) => { llamadas.push(`boveda:${q}:${n}`); return []; },
    modelo: async (_s, u) => { llamadas.push(`modelo:${u.slice(0, 20)}`); return p.modeloTexto ?? "En corto: los Sony WH-1000XM6 son la mejor compra [1].\n- Lideran el ranking [1].\n- 30 horas de batería [2]."; },
    puede: async () => ({ ok: true, motivo: "" }),
    ...p,
  };
  return { d, llamadas };
}
async function hastaElFinal(t: Trabajo, d: DepsTrabajo) {
  for (let i = 0; i < 10; i++) { const a = await avanzar(t, d); if (a.tipo !== "paso") return { a, t }; t = { ...t, ...a.patch }; }
  throw new Error("no terminó");
}
const trabajo = (p: Partial<Trabajo>): Trabajo => ({ id: "t1", tipo: "investigar", tema: "audífonos", pedido: "", estado: "corriendo", creado: new Date().toISOString(), actualizado: "", progreso: 0, intentos: 0, ...p });

test("investigar: la web, sus notas, el informe del modelo; las fuentes las pone el código; «En corto» es el aviso", async () => {
  const { d, llamadas } = deps();
  const { a } = await hastaElFinal(trabajo({}), d);
  expect(a.tipo).toBe("listo");
  if (a.tipo !== "listo") return;
  expect(a.patch.resultado!.corto).toBe("los Sony WH-1000XM6 son la mejor compra [1].");
  expect(a.patch.resultado!.fuentes).toEqual([{ titulo: "Los 5 mejores audífonos 2026", url: "https://a.cl/1" }, { titulo: "Reseña Sony XM6", url: "https://b.cl/2" }]);
  expect(llamadas).toEqual(["web:audífonos", "boveda:audífonos:4", "modelo:Tema: audífonos\n\nFue"]);
});

test("si no se puede usar el modelo, espera (lo hecho queda); comparar busca A, B y «A vs B»; el resumen sin notas no usa el modelo", async () => {
  const { d } = deps({ puede: async () => ({ ok: false, motivo: "estás en una llamada con Hestia" }) });
  const r = await hastaElFinal(trabajo({}), d);
  expect(r.a).toEqual({ tipo: "espera", motivo: "estás en una llamada con Hestia" });
  expect(r.t.datos?.web?.length).toBe(2); // ya no se vuelve a buscar
  const c = deps();
  const rc = await hastaElFinal(trabajo({ tipo: "comparar", tema: "Pixel 9", b: "Galaxy S24" }), c.d);
  expect(c.llamadas.slice(0, 3)).toEqual(["web:Pixel 9", "web:Galaxy S24", "web:Pixel 9 vs Galaxy S24"]);
  expect(rc.a.tipo).toBe("listo");
  const s = deps();
  const rs = await hastaElFinal(trabajo({ tipo: "resumen_boveda", tema: "Lander" }), s.d);
  expect(rs.a).toMatchObject({ tipo: "listo", patch: { resultado: { corto: "No encontré notas sobre Lander en la bóveda." } } });
  expect(s.llamadas.some((x) => x.startsWith("modelo"))).toBe(false);
  // nada en la web ni en la bóveda: falla sin inventar
  const v = deps({ web: async () => [] });
  expect((await hastaElFinal(trabajo({}), v.d)).a).toMatchObject({ tipo: "fallo" });
  // el modelo devolvió basura: reintenta una vez y después falla
  const m = deps({ modeloTexto: "ok" });
  const r1 = await avanzar(trabajo({ datos: { web: WEB, boveda: [] } }), m.d);
  expect(r1).toMatchObject({ tipo: "paso", patch: { intentos: 1 } });
  expect((await avanzar(trabajo({ datos: { web: WEB, boveda: [] }, intentos: 1 }), m.d)).tipo).toBe("fallo");
});

test("leer lo que devuelve el buscador y el modelo", () => {
  const salida = 'Resultados de búsqueda para "x":\n\n### 1. Título uno\n🔗 https://uno.cl\nResumen uno\n\n### 2. Título dos\n🔗 https://dos.cl/a?b=1\nResumen   dos';
  expect(fuentesDeBusqueda(salida)).toEqual([{ titulo: "Título uno", url: "https://uno.cl", resumen: "Resumen uno" }, { titulo: "Título dos", url: "https://dos.cl/a?b=1", resumen: "Resumen dos" }]);
  expect(fuentesDeBusqueda("No se encontraron resultados")).toEqual([]);
  expect(leerInforme("<think>hmm</think>\n**En corto:** conviene el A. Por precio.\n- uno")?.corto).toBe("conviene el A.");
  expect(leerInforme("corto")).toBeNull();
});

test("los vigías: la compilación termina cuando deja de gastar CPU (no cuando el proceso muere); un proceso, un servicio, un archivo", async () => {
  const ahora = new Date();
  const hasta = new Date(ahora.getTime() + 3600e3).toISOString();
  let cpu: Record<string, number> = { java: 100, bun: 50 };
  const d = { procesos: async () => cpu, servicios: async () => [{ key: "ollama", name: "Modelo (Ollama)", up: true }], existe: async () => null as string | null };
  let t = trabajo({ tipo: "vigia_proceso", tema: "compilar", estado: "pendiente", vigia: { procesos: ["java"], hasta }, creado: ahora.toISOString() });
  const paso = async () => { const r = await revisarVigia(t, d, ahora); if (r.tipo === "sigue" && r.patch) t = { ...t, ...r.patch }; return r; };
  expect((await paso()).tipo).toBe("sigue"); // primera lectura
  cpu = { java: 100 + CPU_OCUPADO + 20 }; expect((await paso()).tipo).toBe("sigue"); // compilando
  expect((await paso()).tipo).toBe("sigue"); // quieto 1
  expect(await paso()).toEqual({ tipo: "listo", texto: "Ya terminó de compilar en el PC." }); // quieto 2
  // un proceso con nombre: termina cuando ya no está
  const p = trabajo({ tipo: "vigia_proceso", tema: "ffmpeg", vigia: { procesos: ["ffmpeg"], hasta } });
  expect((await revisarVigia(p, { ...d, procesos: async () => ({ ffmpeg: 3 }) }, ahora)).tipo).toBe("sigue");
  expect((await revisarVigia(p, { ...d, procesos: async () => ({}) }, ahora)).tipo).toBe("listo");
  // un servicio que se cae: urgente
  const s = trabajo({ tipo: "vigia_servicio", tema: "ollama", vigia: { servicio: "ollama", hasta } });
  expect(await revisarVigia(s, { ...d, servicios: async () => [{ key: "ollama", name: "Modelo (Ollama)", up: false }] }, ahora)).toEqual({ tipo: "listo", texto: "Ojo: se cayó Modelo (Ollama) en el PC.", urgente: true });
  // un archivo que aparece
  const f = trabajo({ tipo: "vigia_archivo", tema: "informe.pdf", vigia: { carpeta: "Downloads", archivo: "informe.pdf", hasta } });
  expect(await revisarVigia(f, { ...d, existe: async () => "informe.pdf" }, ahora)).toEqual({ tipo: "listo", texto: "Ya está «informe.pdf» en descargas." });
  // pasadas las horas, se deja
  expect((await revisarVigia(s, d, new Date(ahora.getTime() + 7 * 3600e3))).tipo).toBe("vencio");
});

test("comandoHestia: lo pone en la cola y lo dice; vigila lo que compila de verdad; «¿en qué estás?»; cancelar", async () => {
  let desperto = 0;
  const r = await comandoHestia("Hestia, investiga los mejores audífonos y me avisas", { por: "voz", trato: "Alesito", alAgregar: () => desperto++ });
  expect(r).toMatch(/^Listo, Alesito: me pongo con investigar los mejores audífonos cuando el PC esté libre\. Te aviso al terminar/);
  expect(desperto).toBe(1);
  expect(await comandoHestia("compárame el Pixel 9 con el Galaxy S24", { por: "chat" })).toMatch(/\(antes tengo otra cosa\)/);
  const v = await comandoHestia("avísame cuando termine de compilar", { por: "voz", procesos: async () => ({ java: 10, bun: 3, explorer: 1 }) });
  expect(v).toMatch(/te aviso cuando termine de compilar en el PC/);
  expect((await leerTrabajos()).find((t) => t.tipo === "vigia_proceso")?.vigia?.procesos).toEqual(["java", "bun"]);
  expect(await comandoHestia("avísame cuando termine el proceso ffmpeg", { por: "voz", procesos: async () => ({ java: 10 }) })).toMatch(/No veo «ffmpeg» corriendo/);
  expect(await comandoHestia("¿en qué estás trabajando?", { por: "voz" })).toMatch(/^En cola: investigar los mejores audífonos/);
  expect(await comandoHestia("cancela lo de los audífonos", { por: "voz" })).toBe("Listo, dejé investigar los mejores audífonos.");
  expect(queEs({ tipo: "resumen_boveda", tema: "Lander" })).toBe("el resumen de la bóveda sobre Lander");
});

test("el aviso corto: una oración, y si es larga se corta en una coma o un espacio (nunca a mitad de palabra)", () => {
  const largo = "En corto: La creatina monohidratada es un suplemento común que ayuda a los músculos a generar energía, aunque los estudios no confirman que reduzca el dolor muscular ni acelere la recuperación tras el ejercicio intenso.";
  const c = leerInforme(largo)!.corto;
  expect(c.length).toBeLessThanOrEqual(171);
  expect(c.endsWith("…")).toBe(true);
  expect(/\s\S{1,3}…$/.test(c) || /[a-záéíóú]…$/.test(c)).toBe(true);
  expect(c).not.toMatch(/recuperaci…/);
});
