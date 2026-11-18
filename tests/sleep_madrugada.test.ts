// 2026-11-17: durmió de 21:10 a 02:28, estuvo en pie, volvió a dormir de 06:32 a 07:25 y a las 7:30 tocó «Parto mi día ahora».
// El día quedaba desde las 02:28 y lo de 06:32 como siesta. Si la noche termina de madrugada (antes de su rango de despertar) y
// sigue con otro sueño que termina ya en su rango, la noche siguió: el día parte en ese último despertar.
import { test, expect } from "bun:test";
import { sleepDay } from "C:/Proyectos/eris/src/services/SleepCore.ts";

const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const opts = { usualWake: 8, usualSleepH: 7.5 };

test("se despierta de madrugada y vuelve a dormir: el día parte en el último despertar, con «parto mi día» o sin respuesta", () => {
  const ses = [{ start: at(16, 21, 10), end: at(17, 2, 28) }, { start: at(17, 6, 32), end: at(17, 7, 25) }];
  for (const decisions of [{ [iso(at(17, 2, 28))]: "partir" as const }, { [iso(at(17, 2, 28))]: "dormir" as const }, {}]) {
    const d = sleepDay(ses, { ...opts, now: at(17, 10, 12), decisions })!;
    expect(d.dayWake).toBe(iso(at(17, 7, 25)));
    expect(d.episodes.map((e) => e.kind)).toEqual(["noche", "segundo"]);
    expect(d.pendingWake).toBeNull();
    expect(d.split).toBe(true); // estuvo 4 h despierto en medio
    expect(d.totalH).toBeCloseTo(6.18, 1);
  }
  // recién despierto a las 02:40 (todavía no vuelve a dormir): se pregunta cómo sigue
  const temprano = sleepDay([ses[0]], { ...opts, now: at(17, 2, 40) })!;
  expect(temprano.pendingWake).toBe(iso(at(17, 2, 28)));
});

test("una siesta de la tarde no mueve el día; tampoco un sueño que no llega a su rango de despertar", () => {
  const tarde = sleepDay([{ start: at(16, 21, 10), end: at(17, 2, 28) }, { start: at(17, 15, 0), end: at(17, 15, 40) }],
    { ...opts, now: at(17, 16, 0), decisions: { [iso(at(17, 2, 28))]: "partir" } })!;
  expect(tarde.dayWake).toBe(iso(at(17, 2, 28)));
  expect(tarde.episodes.map((e) => e.kind)).toEqual(["noche", "siesta"]);
  // una noche normal sigue igual
  const normal = sleepDay([{ start: at(16, 23, 30), end: at(17, 7, 40) }], { ...opts, now: at(17, 9, 0) })!;
  expect(normal.dayWake).toBe(iso(at(17, 7, 40)));
  expect(normal.episodes.map((e) => e.kind)).toEqual(["noche"]);
});

test("lo comido entre el despertar de madrugada y el segundo sueño es de HOY (Métricas mostraba solo el agua)", async () => {
  const { nutritionDayKey, nutritionDayStart, nutritionDayOf, wakeHourFor } = await import("C:/Proyectos/eris/src/services/MealSchedule.ts");
  const ses = [{ start: at(16, 21, 10), end: at(17, 2, 28) }, { start: at(17, 6, 32), end: at(17, 7, 25) }];
  const d = sleepDay(ses, { ...opts, now: at(17, 10, 28), decisions: { [iso(at(17, 2, 28))]: "partir" } })!;
  expect(d.dayOpen).toBe(iso(at(17, 2, 28)));
  expect(d.dayWake).toBe(iso(at(17, 7, 25)));
  const ctx = { wakeAt: d.dayWake, usualWake: 7.5, openAt: d.dayOpen };
  const ahora = new Date(at(17, 10, 28));
  const cereal = new Date(at(17, 3, 13));
  expect(nutritionDayKey(cereal, ctx)).toBe(nutritionDayKey(ahora, ctx));
  expect(nutritionDayKey(ahora, ctx)).toBe(new Date(at(17, 12, 0)).toDateString());
  // lo de hoy se lee desde las 02:28 (Health Connect), y el horario parte a las 7:25
  expect(nutritionDayStart(nutritionDayOf(ahora, ctx), ctx).getTime()).toBe(at(17, 2, 28));
  expect(wakeHourFor(ctx, ahora)).toBeCloseTo(7 + 25 / 60, 3);
  // sin openAt (una noche normal), igual que antes
  const normal = { wakeAt: iso(at(17, 7, 40)), usualWake: 7.5 };
  expect(nutritionDayStart(nutritionDayOf(ahora, normal), normal).getTime()).toBeLessThanOrEqual(at(17, 7, 40));
  // un openAt viejo (de otro día) no mueve nada
  const viejo = { ...normal, openAt: iso(at(15, 2, 0)) };
  expect(nutritionDayStart(nutritionDayOf(ahora, viejo), viejo).getTime()).toBe(nutritionDayStart(nutritionDayOf(ahora, normal), normal).getTime());
});
