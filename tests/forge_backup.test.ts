// Respaldo de Forge (F0): servidor (ForgeBackup.ts) + el JS que lee/escribe el localStorage del WebView (forgeBackup.ts).
import { test, expect, mock } from "bun:test";

mock.module("react-native", () => ({ DeviceEventEmitter: { emit() {}, addListener() { return { remove() {} }; } } }));
mock.module("C:/Proyectos/eris-mobile/src/services/WebSocketManager", () => ({ wsManager: { subscribeMessage() { return () => {}; }, getStatus: () => "disconnected", sendMessage() {} } }));

const S = await import("C:/Proyectos/eris/src/services/ForgeBackup.ts");
const A = await import("C:/Proyectos/eris-mobile/src/services/forgeBackup.ts");

const state = (over: any = {}) => JSON.stringify({ version: 4, bankedXp: 0, streak: 0, skills: {}, training: {}, ...over });
const full = state({ bankedXp: 1234, streak: 3, training: { "2026-10-10": { sentadilla: 4 }, "2026-10-12": { flexiones: 3 }, "2026-10-13": {} }, skills: { pullup: { steps: [true, false] }, muscleup: { steps: [false] } } });
const routine = JSON.stringify({ md: "# Día A\n- Sentadilla 4x8", name: "Mi rutina" });

function memory() {
  const m = new Map<string, any>();
  return { m, get: async (k: string) => (m.has(k) ? structuredClone(m.get(k)) : null), set: async (k: string, v: any) => { if (v === null) m.delete(k); else m.set(k, structuredClone(v)); } };
}

test("sanitize: solo claves de Forge, solo del mismo perfil, JSON válido", () => {
  const raw = { v: 1, profile: "alex", at: "2026-10-17T10:00:00Z", keys: { "toji-rpg-v1": full, "toji-routine-md": routine, "hw2_tx": "[]", "otra": "x" } };
  const d = S.sanitizeForgeDump(raw, "alex")!;
  expect(Object.keys(d.keys).sort()).toEqual(["toji-routine-md", "toji-rpg-v1"]);
  expect(d.stats).toEqual({ dias: 2, habilidades: 1, xp: 1234, rutina: true, ultimo: "2026-10-12", claves: 2 });
  expect(S.sanitizeForgeDump(raw, "otro")).toBeNull();
  expect(S.sanitizeForgeDump({ ...raw, keys: { "toji-rpg-v1": "{roto" } }, "alex")).toBeNull();
  // el teléfono y el servidor cuentan igual y la huella es la misma
  expect(A.forgeStatsOf(raw.keys as any)).toEqual({ ...d.stats, claves: 4 });
  expect(A.forgeHashOf(d)).toBe(S.forgeHashOf(d));
});

test("un Forge vacío no pisa un respaldo con datos; igual = sin cambios; quedan 7 días", async () => {
  const mem = memory();
  const mk = (keys: any, at = "2026-10-17T10:00:00Z") => S.sanitizeForgeDump({ v: 1, profile: "alex", at, keys }, "alex")!;
  const r1 = await S.saveForgeBackup(mem, mk({ "toji-rpg-v1": full }), new Date(2026, 9, 10, 12));
  expect(r1.saved).toBe(true);
  const empty = await S.saveForgeBackup(mem, mk({ "toji-rpg-v1": state() }), new Date(2026, 9, 11, 12));
  expect(empty.saved).toBe(false);
  expect(empty.kept).toBe("previous");
  expect(empty.restore?.stats.dias).toBe(2);
  expect((await S.saveForgeBackup(mem, mk({ "toji-rpg-v1": full }), new Date(2026, 9, 10, 18))).unchanged).toBe(true);
  for (let d = 11; d <= 20; d++) await S.saveForgeBackup(mem, mk({ "toji-rpg-v1": state({ bankedXp: d, training: { "2026-10-01": { a: 1 } } }) }), new Date(2026, 9, d, 12));
  const list = await S.listForgeBackups(mem);
  expect(list.length).toBe(7);
  expect(list[0].day).toBe("2026-10-20");
  expect([...mem.m.keys()].filter((k) => k.startsWith("forge_backup_d_")).length).toBe(7);
  const pulled = await S.pullForgeBackup(mem, "2026-10-15");
  expect(JSON.parse(pulled!.keys["toji-rpg-v1"]).bankedXp).toBe(15);
});

// Un WebView de mentira: localStorage + window.storage (como toji.html) + ReactNativeWebView
function fakeWebView(pid: string) {
  const ls = new Map<string, string>();
  const posted: any[] = [];
  const localStorage = { getItem: (k: string) => (ls.has(k) ? ls.get(k)! : null), setItem: (k: string, v: string) => { ls.set(k, String(v)); }, removeItem: (k: string) => { ls.delete(k); } };
  const window: any = { __ERIS_PROFILE_ID__: pid, ReactNativeWebView: { postMessage: (m: string) => posted.push(JSON.parse(m)) } };
  window.storage = { set: (k: string, v: string) => { localStorage.setItem(k, v); return Promise.resolve({ key: k, value: v }); } };
  const run = (js: string) => new Function("window", "localStorage", js)(window, localStorage);
  return { ls, posted, window, run };
}

test("volcado y restauración en el WebView: con el perfil, guarda lo de antes y bloquea que la página pise lo restaurado", async () => {
  const wv = fakeWebView("alex");
  wv.ls.set("toji-rpg-v1-alex", state({ bankedXp: 5 }));
  wv.ls.set("toji-rpg-v1-otro", full); // otra cuenta en el mismo teléfono: no se toca
  wv.run(A.forgeDumpJS());
  const dump = wv.posted.pop();
  expect(dump.type).toBe("toji_backup");
  expect(dump.dump.profile).toBe("alex");
  expect(Object.keys(dump.dump.keys)).toEqual(["toji-rpg-v1"]);
  expect(JSON.parse(dump.dump.keys["toji-rpg-v1"]).bankedXp).toBe(5);

  wv.run(A.forgeRestoreJS("r1", { v: 1, profile: "alex", at: "x", keys: { "toji-rpg-v1": full, "toji-routine-md": routine } }));
  const res = wv.posted.pop();
  expect(res).toEqual({ type: "toji_restored", requestId: "r1", result: { ok: true } });
  expect(wv.ls.get("toji-rpg-v1-alex")).toBe(full);
  expect(wv.ls.get("toji-routine-md-alex")).toBe(routine);
  expect(wv.ls.get("toji-rpg-v1-otro")).toBe(full);
  expect(JSON.parse(wv.ls.get("toji-before-restore-alex")!).keys["toji-rpg-v1"]).toBe(state({ bankedXp: 5 }));
  // la página todavía tiene el estado viejo en memoria: si guarda, no debe pisar lo restaurado
  await wv.window.storage.set("toji-rpg-v1-alex", state({ bankedXp: 5 }));
  expect(wv.ls.get("toji-rpg-v1-alex")).toBe(full);
  // una segunda restauración no envuelve dos veces
  wv.run(A.forgeRestoreJS("r2", { v: 1, profile: "alex", at: "x", keys: { "toji-rpg-v1": state({ bankedXp: 9 }) } }));
  expect(wv.posted.pop().result.ok).toBe(true);
  expect(JSON.parse(wv.ls.get("toji-rpg-v1-alex")!).bankedXp).toBe(9);
  expect(wv.ls.has("toji-routine-md-alex")).toBe(false); // la copia no traía rutina
});

test("sin perfil (anon) usa las claves sin sufijo", () => {
  const wv = fakeWebView("anon");
  wv.ls.set("toji-rpg-v1", full);
  wv.run(A.forgeDumpJS());
  expect(Object.keys(wv.posted.pop().dump.keys)).toEqual(["toji-rpg-v1"]);
});
