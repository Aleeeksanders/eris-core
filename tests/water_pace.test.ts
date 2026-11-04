// El agua A ESTA HORA, no contra la meta del día (2026-10-18). Caso real: despertó 7:13, a las 10:54 llevaba 0,5 de 4 L
// y Eris le dijo «tu prioridad es reponer esos 3,5 litros». Perfil de PRUEBA «ikaros» del HOME aislado (erishome).
import { test, expect } from "bun:test";
import * as os from "os";
if (!/erishome/i.test(os.homedir())) throw new Error("usa USERPROFILE = erishome");
const { waterLine, waterPace, paceText } = await import("C:/Proyectos/eris/src/services/WaterToday.ts");
const { FileSystemAdapter } = await import("C:/Proyectos/eris/src/memory.ts");
const { AccountStore } = await import("C:/Proyectos/eris/src/services/security/AccountStore.ts");
const { gatherMetabolicContext, analyze } = await import("C:/Proyectos/eris/src/services/MetabolicAnalysis.ts");

const at = (h: number, m: number) => new Date(2026, 9, 18, h, m);
const WAKE = 7 + 13 / 60;
const w = (totalL: number, now: Date) => ({ totalL, drinksL: totalL, foodL: 0, chatL: 0, phoneL: totalL, goalL: 4, goalNote: "", pace: waterPace(totalL, 4, now, WAKE) });

test("10:54 con 0,5 de 4 L: 2 vasos atrás para la hora, no «3,5 L por reponer»", () => {
  const line = waterLine(w(0.5, at(10, 54)));
  console.log(line);
  expect(line).toContain("a esta hora lo esperable es ~1,1 L");
  expect(line).toContain("para ir al día te faltan 2 vasos (~0,5 L)");
  expect(line).toContain("para la meta de 4 L quedan 3,5 L, repartidos hasta la noche");
  expect(line).not.toMatch(/te faltan 3,5/);
});

test("recién despierto, al día, adelantado y meta cumplida", () => {
  expect(waterLine(w(0.1, at(7, 50)))).toContain("recién empieza tu día");
  const alDia = waterLine(w(2, at(14, 0)));
  console.log(alDia);
  expect(alDia).toContain("vas al día (a esta hora lo esperable es ~1,9 L)");
  expect(waterLine(w(2.6, at(14, 0)))).toContain("vas adelantado");
  expect(waterLine(w(4.1, at(16, 0)))).toContain("meta del día (4 L) cumplida");
  // sin pace (sin meta o sin datos): la frase de antes
  expect(waterLine({ ...w(1, at(12, 0)), pace: undefined })).toBe("Hoy llevas 1 L de tu meta de 4 L (te faltan 3 L).");
  expect(waterLine({ ...w(1, at(12, 0)), goalL: null, pace: undefined, offReason: "la define su médico" })).toContain("No te fijo meta");
});

test("el despertar corre la pauta: a las 10:54 recién levantado (9:45) no está atrás", () => {
  const p = waterPace(0.3, 4, at(10, 54), 9.75);
  expect(["temprano", "al_dia", "adelantado"]).toContain(p.state);
  expect(paceText(p, 4, 0.3)).not.toContain("para ir al día te faltan");
});

test("el análisis (asesor y «Así vas hoy») habla del agua a esta hora", async () => {
  const mem: any = new FileSystemAdapter("ikaros", await new AccountStore().derivePin("ikaros"));
  await mem.load();
  const ctx: any = await gatherMetabolicContext(mem, {});
  const run = (have: number, now: Date) => analyze({ ...ctx, now, wakeHour: WAKE, hydrationEffectiveL: have, hydrationRawL: have, goals: { ...ctx.goals, hydrationL: 4 } }).findings.filter((f: any) => f.area === "agua");
  const behind = run(0.5, at(10, 54))[0];
  console.log(JSON.stringify(behind));
  expect(behind.severity).toBe(1);
  expect(behind.headline).toBe("Agua: 0,5 L (a esta hora lo esperable es ~1,1 L)");
  expect(behind.detail).toContain("Para ir al día: +2 vasos (~0,5 L)");
  expect(behind.action).toBe("Toma 2 vasos de agua en la próxima hora: así vas al día."); // 2026-10-23: el modelo leía «meta» y decía «para llegar a tu meta»
  expect(JSON.stringify(behind)).not.toMatch(/reparte ~3/);
  // tarde y muy atrás: sube la prioridad
  expect(run(0.8, at(16, 30))[0].severity).toBe(2);
  // casi al día (un vaso): se dice, pero no es «lo más importante de hoy»
  const casi = run(0.85, at(10, 54))[0];
  expect(casi.severity).toBe(0);
  expect(casi.headline).toBe("Agua: 0,9 L, casi al día (te falta 1 vaso)");
  // al día
  const ok = run(2, at(14, 0))[0];
  expect(ok.severity).toBe(0);
  expect(ok.detail).toContain("Vas al día para esta hora");
});
