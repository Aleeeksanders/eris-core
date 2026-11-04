// El asesor reconoce que entrenaste (reloj ≥ 20 min, Forge con el día de hoy) y no pide caminar (2026-10-16).
// Perfil de PRUEBA «ikaros» del HOME aislado (erishome), con el servidor aislado detenido.
import { test, expect } from "bun:test";
import * as os from "os";
if (!/erishome/i.test(os.homedir())) throw new Error("usa USERPROFILE = erishome");
const { FileSystemAdapter } = await import("C:/Proyectos/eris/src/memory.ts");
const { AccountStore } = await import("C:/Proyectos/eris/src/services/security/AccountStore.ts");
const { gatherMetabolicContext, analyze } = await import("C:/Proyectos/eris/src/services/MetabolicAnalysis.ts");
const { inventedGlucose, stripGlucose } = await import("C:/Proyectos/eris/src/services/ReplyGuards.ts");
const { isoDayKey } = await import("C:/Proyectos/eris/src/services/MealSchedule.ts");
const mem: any = new FileSystemAdapter("ikaros", await new AccountStore().derivePin("ikaros"));
await mem.load();
const prevSnap = await mem.get("health_snapshot_latest");
const prevBody = await mem.get("body_profile");
const today = isoDayKey(new Date());
const snapWith = async (extra: Record<string, unknown>, body?: Record<string, unknown>) => {
  await mem.set("health_snapshot_latest", { lastUpdated: new Date().toISOString(), steps: 1500, calories: 120, sleep: { durationHours: 7 }, ...extra });
  await mem.set("body_profile", { ...(prevBody ?? {}), date: today, trainingSets: 0, trainingKcal: 0, ...(body ?? {}) });
  const ctx: any = await gatherMetabolicContext(mem, {});
  return { ctx, move: analyze(ctx).findings.filter((f: any) => f.area === "movimiento") };
};

test("básquet en el reloj (45 min) = entrenó: no se pide caminar", async () => {
  const { ctx, move } = await snapWith({ activeMinutes: 45 });
  expect(ctx.trainedToday).toBe(true);
  expect(ctx.exerciseMinutes).toBe(45);
  console.log(JSON.stringify(move.map((f: any) => [f.headline, f.detail, f.action])));
  expect(move.some((f: any) => /caminata/i.test(f.action ?? ""))).toBe(false);
  expect(move.some((f: any) => /Ya entrenaste hoy \(45 min\)/.test(f.headline))).toBe(true);
});
test("Forge con el día de hoy = entrenó; `trained` viejo y pegajoso no cuenta", async () => {
  expect((await snapWith({ trainedDay: today })).ctx.trainedToday).toBe(true);
  expect((await snapWith({ trained: true, trainedDay: "2026-01-01" })).ctx.trainedToday).toBeNull();
  expect((await snapWith({}, { trainingSets: 14 })).ctx.trainedToday).toBe(true);
  expect((await snapWith({ activeMinutes: 10 })).ctx.trainedToday).toBeNull();
});
test("«con esa glucosa estable» sin mediciones se saca", () => {
  const r = "Vas bien hoy. Con esa glucosa estable y ese sueldo, estás en el punto ideal.";
  expect(inventedGlucose(r, ["Comida: 1.993 kcal"], ["Si, busca"])).toBe(true);
  expect(stripGlucose(r)).not.toContain("glucosa estable");
  expect(inventedGlucose("La glucosa es el azúcar de la sangre.", [], ["¿qué es la glucosa?"])).toBe(false);
});
test("(se deja el perfil de prueba como estaba)", async () => {
  await mem.set("health_snapshot_latest", prevSnap);
  await mem.set("body_profile", prevBody);
});
