// ============================================================
// El núcleo de Suplementos del servidor (src/services/SupplementCore.ts) es COPIA EXACTA del de la app. Revisa el archivo y
// que los dos den lo mismo: recomendaciones diarias, fichas y cuidados, «Mis suplementos», lo que aportan y el chat.
//   bun scripts/supplement_parity_test.ts    (sale con 1 si algo difiere)
// ============================================================

import { readFileSync } from "fs";
import { APP_SUPPLEMENT_CORE, SRV_SUPPLEMENT_CORE } from "./sync_supplement_core.ts";

const app = await import(APP_SUPPLEMENT_CORE);
const srv = await import(SRV_SUPPLEMENT_CORE);
let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`  ${ok ? "✓" : "✗"} ${msg}`); };

check(readFileSync(SRV_SUPPLEMENT_CORE, "utf-8") === readFileSync(APP_SUPPLEMENT_CORE, "utf-8"), "SupplementCore.ts: el del servidor es copia del de la app");

const run = (X: any) => {
  const now = new Date(2026, 9, 23, 21);
  let id = 0;
  const ctx = { now, newId: () => `s${++id}` };
  const S = X.emptySupState();
  const perfil = { conditions: [{ id: "ckd" }], medications: [{ name: "Metformina 850", active: true }, { name: "Losartán 50" }], allergies: "mariscos" };
  const avisos = [
    X.agregarSup(S, { nombre: "Vitamina D3", cantidad: 5000, unidad: "UI" }, ctx, { sex: "m", age: 40 }),
    X.agregarSup(S, { nombre: "Creatina", cantidad: 5 }, ctx),
    X.agregarSup(S, { nombre: "Magnesio bisglicinato", cantidad: 200, unidad: "mg", tomasDia: 2 }, ctx),
  ];
  const dia = X.diaKey(now);
  X.tomar(S, "s1", dia); X.tomar(S, "s3", dia);
  let W = S;
  const ops = [{ action: "tomar", sup: "la creatina" }, { action: "estado" }, { action: "deshacer", sup: "magnesio" }, { action: "tomar", sup: "omega" }];
  const results = ops.map((op) => { const r = X.applyOp(W, op, ctx); W = r.state; return r.result; });
  return {
    avisos, results, extract: X.extract(W, now), aporte: X.aporteDelDia(W, dia), constancia: X.constancia(W, now), estado: X.estadoHoy(W, dia, 21),
    dri: X.MICRO_KEYS.map((k: string) => [X.dri(k, { sex: "m", age: 40 }), X.dri(k, { sex: "h", age: 75 }), X.ul(k, { age: 60 })]),
    fichas: X.FICHAS.map((f: any) => [f.id, X.cuidadosPara(f, perfil)]), buscar: ["omega 3 1000", "whey isolate", "nada"].map((t) => X.fichaPara(t)?.id ?? null),
    micros: X.addMicros(X.scaleMicros({ vC: 53.2, ca: 40 }, 150), { vC: 10 }),
  };
};
check(JSON.stringify(run(app)) === JSON.stringify(run(srv)), "mismas recomendaciones, fichas y cuidados, «Mis suplementos», aporte y respuestas del chat");

if (fails) { console.error(`\n${fails} diferencia(s)`); process.exit(1); }
