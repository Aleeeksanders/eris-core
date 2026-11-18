// Hestia como JARVIS · L0 (2026-11-17): el panel de control y la protección del equipo. Solo Hestia (Ikaros en Modo AXS).
// El estado (pausa, límites), el vigía (evaluar, función pura), los comandos por código y las lecturas del equipo.
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import { leerEstado, pausar, reanudar, pausaVigente, guardarLimites, _olvidarEstado, LIMITES_INICIALES, type EstadoHestia } from "C:/Proyectos/eris/src/services/hestia/Estado.ts";
import { evaluar, type Memoria } from "C:/Proyectos/eris/src/services/hestia/Vigia.ts";
import { pideEstadoSistemas, pidePausa, pideReanudar, informeSistemas, textoPausa, comandoHestia } from "C:/Proyectos/eris/src/services/hestia/Comandos.ts";
import { leerNvidiaSmi, leerOllamaPs, leerBateria, type Medicion } from "C:/Proyectos/eris/src/services/hestia/Equipo.ts";
import { conexionesIkaros, esHestia } from "C:/Proyectos/eris/src/services/hestia/Puerta.ts";

beforeEach(() => {
  const h = mkdtempSync(join(os.tmpdir(), "erishome_l0_"));
  process.env.USERPROFILE = h; process.env.HOME = h;
  _olvidarEstado();
});

const med = (p: Partial<Medicion> = {}): Medicion => ({
  t: new Date().toISOString(), cpuPct: 30, ramLibreGb: 5, ramTotalGb: 16.8, discoLibreGb: 120, discoTotalGb: 480,
  gpu: { nombre: "RTX 3050", usoPct: 35, vramUsadaGb: 4.2, vramTotalGb: 6, tempC: 58, potenciaW: 10 },
  modelo: { nombre: "qwen3.5:4b", tamanoGb: 6.8, enGpuGb: 4.1, vence: null }, bateria: { pct: 100, enchufado: true }, ...p,
});
const memNueva = (): Memoria => ({ cpuAltaDesde: null, ultimoAviso: {} });
const est = (p: Partial<EstadoHestia> = {}): EstadoHestia => ({ version: 1, pausa: null, limites: structuredClone(LIMITES_INICIALES), fondoPausado: null, sinArchivos: null, ...p });

test("el estado: pausa con y sin hora de término, reanudar, límites saneados y guardados", async () => {
  expect(pausaVigente(await leerEstado())).toBeNull();
  const ahora = new Date(2026, 10, 17, 15, 0);
  await pausar("la pediste en el panel", "panel", 30, ahora);
  const e = await leerEstado();
  expect(pausaVigente(e, new Date(2026, 10, 17, 15, 10))?.por).toBe("panel");
  expect(pausaVigente(e, new Date(2026, 10, 17, 15, 31))).toBeNull(); // venció
  await pausar("voz", "voz", null, ahora);
  expect(pausaVigente(await leerEstado(), new Date(2027, 0, 1))?.por).toBe("voz"); // sin término: hasta reanudar
  await reanudar();
  expect(pausaVigente(await leerEstado())).toBeNull();
  await guardarLimites({ discoLibreGb: { aviso: 30 }, gpuTempC: { que: "solo_aviso" }, ramLibreGb: { aviso: "mucho" as any } });
  _olvidarEstado(); // se lee del disco
  const e2 = await leerEstado();
  expect(e2.limites.discoLibreGb).toEqual({ aviso: 30, accion: 10, que: "sin_archivos" });
  expect(e2.limites.gpuTempC.que).toBe("solo_aviso");
  expect(e2.limites.ramLibreGb.aviso).toBe(2); // lo inválido no entra
});

test("el vigía: avisa una vez por hora, actúa al cruzar la acción y deshace lo suyo cuando todo vuelve a estar bien", () => {
  const mem = memNueva();
  const t0 = Date.parse("2026-11-17T18:00:00Z");
  // todo bien: nada
  expect(evaluar(med(), est(), mem, t0)).toEqual({ alertas: [], cambios: {} });
  // RAM baja (aviso), una sola vez por hora
  const r1 = evaluar(med({ ramLibreGb: 1.8 }), est(), mem, t0);
  expect(r1.alertas.map((a) => [a.clave, a.nivel])).toEqual([["ramLibreGb", "aviso"]]);
  expect(evaluar(med({ ramLibreGb: 1.8 }), est(), mem, t0 + 60_000).alertas).toEqual([]);
  expect(evaluar(med({ ramLibreGb: 1.8 }), est(), mem, t0 + 3601_000).alertas.length).toBe(1);
  // la tarjeta a 88 °C: Hestia se pausa sola (solo Hestia)
  const r2 = evaluar(med({ gpu: { ...med().gpu!, tempC: 88 } }), est(), memNueva(), t0);
  expect(r2.cambios.pausaVigia).toContain("tarjeta de video en 88 °C");
  expect(r2.alertas[0].texto).toContain("me pongo en pausa");
  // baja a 78 °C: todavía no vuelve (margen hasta 75 °C)
  const enPausa = est({ pausa: { desde: new Date(t0).toISOString(), hasta: null, motivo: "x", por: "vigia" } });
  expect(evaluar(med({ gpu: { ...med().gpu!, tempC: 78 } }), enPausa, memNueva(), t0).cambios.pausaVigia).toBeUndefined();
  // a 70 °C vuelve, y lo dice
  const r3 = evaluar(med({ gpu: { ...med().gpu!, tempC: 70 } }), enPausa, memNueva(), t0);
  expect(r3.cambios.pausaVigia).toBeNull();
  expect(r3.alertas.some((a) => a.nivel === "vuelve")).toBe(true);
  // una pausa que puso él (panel o voz) el vigía NO la quita
  const suya = est({ pausa: { desde: new Date(t0).toISOString(), hasta: null, motivo: "x", por: "panel" } });
  expect(evaluar(med(), suya, memNueva(), t0).cambios.pausaVigia).toBeUndefined();
  // disco bajo 10 GB: sin archivos grandes; y el aviso del disco, una vez al día
  const m4 = memNueva();
  const r4 = evaluar(med({ discoLibreGb: 8 }), est(), m4, t0);
  expect(r4.cambios.sinArchivos).toContain("disco en 8 GB");
  const m6 = memNueva();
  expect(evaluar(med({ discoLibreGb: 15 }), est(), m6, t0).alertas.map((a) => a.nivel)).toEqual(["aviso"]);
  expect(evaluar(med({ discoLibreGb: 15 }), est(), m6, t0 + 2 * 3600_000).alertas).toEqual([]); // el disco: una vez al día
  expect(evaluar(med({ discoLibreGb: 15 }), est(), m6, t0 + 25 * 3600_000).alertas.length).toBe(1);
  // la CPU cuenta solo si lleva 5 minutos alta
  const m5 = memNueva();
  expect(evaluar(med({ cpuPct: 97 }), est(), m5, t0).alertas).toEqual([]);
  expect(evaluar(med({ cpuPct: 97 }), est(), m5, t0 + 4 * 60_000).alertas).toEqual([]);
  expect(evaluar(med({ cpuPct: 97 }), est(), m5, t0 + 5 * 60_000).alertas.map((a) => a.clave)).toEqual(["cpuPct"]);
  // la batería solo cuenta sin cargador
  expect(evaluar(med({ bateria: { pct: 12, enchufado: true } }), est(), memNueva(), t0).alertas).toEqual([]);
  expect(evaluar(med({ bateria: { pct: 8, enchufado: false } }), est(), memNueva(), t0).cambios.fondoPausado).toContain("batería en 8 %");
});

test("los comandos por código: estado de los sistemas, pausa (con tiempo) y reanuda", async () => {
  for (const f of ["Hestia, estado de los sistemas", "¿cómo está el PC?", "¿cómo andan los sistemas?", "diagnóstico del equipo", "¿cómo estás de RAM?"]) expect([f, pideEstadoSistemas(f)]).toEqual([f, true]);
  for (const f of ["¿cómo estás?", "¿qué tengo hoy?", "abre el PC", "pon una alarma"]) expect([f, pideEstadoSistemas(f)]).toEqual([f, false]);
  expect(pidePausa("Hestia, pausa")).toEqual({ minutos: null });
  expect(pidePausa("ponte en pausa por 30 minutos")).toEqual({ minutos: 30 });
  expect(pidePausa("pausa por una hora")).toEqual({ minutos: 60 });
  expect(pidePausa("pausa por media hora")).toEqual({ minutos: 30 });
  for (const f of ["pausa la música", "pon pausa", "¿qué es una pausa activa?", "pausa"]) expect([f, pidePausa(f)]).toEqual([f, null]); // «pausa» a secas: la música
  expect(pidePausa("ponte en pausa")).toEqual({ minutos: null });
  expect(pidePausa("pausa por 10 minutos")).toEqual({ minutos: 10 });
  expect(pideReanudar("Hestia, reanuda")).toBe(true);
  expect(pideReanudar("vuelve")).toBe(true);
  expect(pideReanudar("vuelve a llamar a mi mamá")).toBe(false);
  // el flujo: pausa → reanuda
  expect(await comandoHestia("reanuda", { trato: "Alesito", por: "voz" })).toBe("Ya estoy activa, Alesito.");
  expect(await comandoHestia("Hestia, pausa por 30 minutos", { trato: "Alesito", por: "voz" })).toBe("Listo, Alesito: me pongo en pausa por 30 minutos. Mientras, no uso el modelo; dime «reanuda» cuando quieras.");
  expect(pausaVigente(await leerEstado())?.por).toBe("voz");
  expect(await comandoHestia("reanuda", { trato: "Alesito", por: "voz" })).toBe("De vuelta, Alesito. Todo en línea.");
  expect(pausaVigente(await leerEstado())).toBeNull();
  expect(await comandoHestia("¿cuánta agua llevo?", { por: "chat" })).toBeNull();
});

test("el informe de sistemas y el texto de la pausa", () => {
  const t = informeSistemas(med({ discoLibreGb: 18, ramLibreGb: 4.2 }), est(), "Alesito");
  expect(t).toBe("Todo en línea, Alesito, pero ojo con el disco. La tarjeta al 35 % y a 58 °C, 4,2 GB de RAM libres, 18 GB de disco y la CPU al 30 %. El modelo está cargado (4,1 GB en la tarjeta). Nada en pausa.");
  expect(informeSistemas(med({ modelo: null, bateria: { pct: 40, enchufado: false } }), est(), null)).toContain("batería al 40 % sin cargador");
  expect(informeSistemas(med({ modelo: null }), est(), null)).toContain("El modelo está descargado");
  const vig = textoPausa({ desde: "", hasta: null, motivo: "la tarjeta de video en 88 °C", por: "vigia" }, "Alesito");
  expect(vig).toBe("Me puse en pausa sola: la tarjeta de video en 88 °C, Alesito. Lo de siempre sigue (la hora, las alarmas, la linterna); para lo demás, dime «reanuda».");
});

test("las lecturas del equipo (nvidia-smi, Ollama, WMI)", () => {
  expect(leerNvidiaSmi("NVIDIA GeForce RTX 3050 6GB Laptop GPU, 40, 1395, 6144, 53, 9.85\n")).toEqual({ nombre: "NVIDIA GeForce RTX 3050 6GB Laptop GPU", usoPct: 40, vramUsadaGb: 1.36, vramTotalGb: 6, tempC: 53, potenciaW: 9.85 });
  expect(leerNvidiaSmi(null)).toBeNull();
  expect(leerNvidiaSmi("[Not Supported]")).toBeNull();
  expect(leerOllamaPs({ models: [{ name: "qwen3.5:4b", size: 6.8e9, size_vram: 4.11e9, expires_at: "x" }] })).toEqual({ nombre: "qwen3.5:4b", tamanoGb: 6.8, enGpuGb: 4.11, vence: "x" });
  expect(leerOllamaPs({ models: [] })).toBeNull();
  expect(leerBateria("85;2")).toEqual({ pct: 85, enchufado: true });
  expect(leerBateria("40;1")).toEqual({ pct: 40, enchufado: false });
  expect(leerBateria("")).toBeNull();
});

test("la puerta: los avisos van solo a Ikaros, nunca a un usuario de Eris", () => {
  const ik = { data: { role: "ikaros", persona: "hestia" } }, ikEris = { data: { role: "ikaros", persona: "eris" } }, otro = { data: { role: "eris", persona: "eris" } };
  const clientes = new Map<string, Set<any>>([["ikaros-prueba", new Set([ik, ikEris])], ["maria", new Set([otro])]]);
  expect(conexionesIkaros(clientes)).toEqual([ik, ikEris]);
  expect(esHestia(ik)).toBe(true);
  expect(esHestia(ikEris)).toBe(false);
  expect(esHestia(otro)).toBe(false);
});
