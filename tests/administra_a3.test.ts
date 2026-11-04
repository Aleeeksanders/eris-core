// Eris administra (A3): «Así manejo tu…» — lo que se va a acabar a la lista, el sueldo que se propone, el Plan que respeta
// los interruptores y «¿qué haces sola?» por chat
process.env.TZ = "America/Santiago";
import { test, expect } from "bun:test";
import { emptyState as invEmpty, agregar, faltantes, listaCompras, ajustarPrevision, extract as invExtract, ritmoConsumo, type InventoryState } from "C:/Proyectos/eris-mobile/src/services/inventory/inventoryCore.ts";
import { decidir, AUTO_DEFAULT } from "C:/Proyectos/eris-mobile/src/services/finance/bankAuto.ts";
import { emptyState } from "C:/Proyectos/eris-mobile/src/services/finance/financeCore.ts";
import { autoPrefsDe, administraTexto } from "C:/Proyectos/eris/src/services/AutoPrefs.ts";
import { gatherDayPlanInput, buildDayPlan } from "C:/Proyectos/eris/src/services/DayPlan.ts";
import { DayPlanTool, ADMIN_ASK } from "C:/Proyectos/eris/src/tools/DayPlanTool.ts";

const NOW = new Date(2026, 9, 30, 12, 0);
let nid = 1;
const ctx = (d = NOW) => ({ now: d, newId: () => nid++ });
/** Café: 1 paquete de 250 g; se consumen 40 g al día los últimos 5 días (quedan 50 g → ~1 día) */
function conCafe(): InventoryState {
  const S = invEmpty();
  expect(agregar(S, { nombre: "Café", area: "despensa", cantidad: 250, unidad: "g" } as any, ctx(new Date(2026, 9, 24))).ok).toBe(true);
  const it = S.items[0];
  for (let d = 25; d <= 29; d++) S.movs.push({ id: nid++, itemId: it.id, tipo: "consumo", delta: -40, at: new Date(2026, 9, d, 8).toISOString(), via: "nutricion" });
  it.cantidad = 50;
  return S;
}

test("Casa: lo que se va a acabar a tu ritmo entra solo a la lista (y se puede apagar)", () => {
  const S = conCafe();
  const r = ritmoConsumo(S, S.items[0], NOW)!;
  expect(Math.round(r)).toBe(39); // 200 g en ~5,2 días (desde el primer consumo)
  const f = faltantes(S, NOW);
  expect(f.map((x) => [x.item.nombre, x.estado, x.dias])).toEqual([["Café", "pronto", 1]]);
  expect(listaCompras(S, NOW).auto.length).toBe(1);
  const X = invExtract(S, NOW);
  expect(X.context).toContain("Se acaba pronto a su ritmo (ya está en su lista de compras): Café (~1 día)");
  expect(X.summary.pronto).toEqual([{ nombre: "Café", dias: 1 }]);
  expect(ajustarPrevision(S, false).ok).toBe(true);
  expect(faltantes(S, NOW).length).toBe(0);
  // Con un solo consumo no hay ritmo (no se inventa)
  const S2 = conCafe();
  S2.movs = S2.movs.slice(0, 1);
  expect(ritmoConsumo(S2, S2.items[0], NOW)).toBeNull();
});

test("Plata: con «confirmo tu sueldo» apagado, el sueldo que llega se propone (no se confirma solo)", () => {
  const S = emptyState();
  S.setupDone = true;
  S.cuentas = [{ id: 1, nombre: "Cuenta corriente", banco: "BCI", tipo: "debito", saldoInicial: 100_000 }] as any;
  S.prog.push({ id: 77, tipo: "ingreso", fuente: "sueldo", desc: "Sueldo", monto: 1_000_000, dia: 30, cuenta: 1 } as any);
  const av = { pkg: "cl.bci.app.personas", app: "BCI", title: "", text: "Te depositaron $1.000.000", at: NOW.getTime(), key: "s1" };
  expect(decidir(av, S, {}, { ...AUTO_DEFAULT, on: true, allowed: true }).accion).toBe("anotar");
  const d = decidir(av, S, {}, { ...AUTO_DEFAULT, on: true, allowed: true, sueldo: false });
  expect(d.accion === "proponer" && d.razon).toBe("Parece tu sueldo (esperabas $1.000.000): confírmalo tú.");
});

const mem = (extra: Record<string, any>) => {
  const m = new Map<string, any>(Object.entries(extra));
  return { get: async (k: string) => (m.has(k) ? m.get(k) : null), set: async (k: string, v: any) => { m.set(k, v); }, getProfile: async () => ({ name: "Alex", medical: { conditions: [] } }) };
};

test("el Plan de Eris respeta «te pongo un tope para hoy» (apagado: sin tope)", async () => {
  const fin = { at: NOW.toISOString(), libre: 300_000, porDia: 15_000 };
  const con = buildDayPlan(await gatherDayPlanInput(mem({ financial_summary_latest: fin }), NOW), "optimo");
  expect(con.pasos.some((p) => p.id === "plata")).toBe(true);
  const sin = await gatherDayPlanInput(mem({ financial_summary_latest: fin, pref_auto_prefs: { topeDia: false } }), NOW);
  expect(sin.prefs).toEqual({ topeDia: false, segunSueno: true });
  expect(buildDayPlan(sin, "optimo").pasos.some((p) => p.id === "plata")).toBe(false);
});

test("el Plan de Eris respeta «ajusto la carga según cómo dormiste» (apagado: la rutina tal cual)", async () => {
  const training = { rest: false, name: "Día A: Empuje", items: [{ name: "Press de banca", text: "3×6" }, { name: "Fondos", text: "3×8" }], doneSets: 0 };
  const ready = { level: "liviano", why: "Dormiste poco.", tip: "Hoy liviano." };
  const base = await gatherDayPlanInput(mem({}), NOW);
  const con = buildDayPlan({ ...base, training, ready } as any, "flexible");
  expect(con.pasos.find((p) => p.modulo === "entreno")!.titulo).toContain("Caminata");
  const sin = buildDayPlan({ ...base, training, ready, prefs: { topeDia: true, segunSueno: false } } as any, "flexible");
  expect(sin.pasos.find((p) => p.modulo === "entreno")!.titulo).toContain("Empuje");
});

test("«¿qué haces sola?»: por código, con lo que está encendido y apagado", async () => {
  const p = autoPrefsDe({ topeDia: false, plata: { anota: true, sueldo: false, cuadre: true, tope: 50_000 }, casa: { comidas: true, prevision: true }, piloto: true, sueno: false, domingo: true });
  const t = administraTexto(p);
  expect(t).toContain("✓ anoto lo que te avisa tu banco");
  expect(t).toContain("✕ (apagado) confirmo tu sueldo cuando llega");
  expect(t).toContain("✕ (apagado) te pongo un tope para gastar hoy");
  expect(t).toContain("por más de $50.000");
  expect(t).toContain("✓ armo tu día cada mañana");
  expect(t).toContain("Nunca muevo tu plata ni pago nada");
  expect(administraTexto(autoPrefsDe(null))).toContain("actualiza la app");
  for (const q of ["¿qué haces sola?", "¿Qué cosas decides tú sola?", "¿cómo manejas mi plata?", "qué haces en automático"]) {
    expect(await new DayPlanTool().preroute(q, { memory: mem({}), role: "ikaros" })).toEqual({ action: "administra" });
  }
  for (const q of ["¿qué me recomiendas hoy?", "¿mis finanzas calzan?", "¿qué comí hoy?"]) expect(ADMIN_ASK.test(q.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase())).toBe(false);
  const out = await new DayPlanTool().execute({ action: "administra" } as any, { memory: mem({ pref_auto_prefs: { plata: { anota: true } } }), role: "ikaros" });
  expect(out.output).toContain("💸 Plata: ✓ anoto lo que te avisa tu banco");
});
