// ============================================================
// Informe de la beta en la terminal (2026-11-11)
//
//   bun scripts/beta/informe.ts             → texto
//   bun scripts/beta/informe.ts --json      → el informe completo, para el simulador o la lámina de cohorte
//   bun scripts/beta/informe.ts --dir <carpeta> --hoy 2026-12-01
//
// Lee ~/.eris/metricas (lo que anota services/BetaMetrics.ts). Los archivos van con alias: no hace falta la llave del
// servidor y no aparece nadie por su nombre. Solo lee: no cambia nada.
// ============================================================

import { homedir } from "os";
import { join } from "path";
import { leerMetricas, diaLocal } from "../../src/services/BetaMetrics";
import { armarInforme, informeEnTexto } from "../../src/services/BetaReport";

const args = process.argv.slice(2);
const valor = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const dir = valor("--dir") ?? join(homedir(), ".eris", "metricas");
const hoy = valor("--hoy") ?? diaLocal(new Date());

const informe = armarInforme(await leerMetricas(dir), hoy);
console.log(args.includes("--json") ? JSON.stringify(informe, null, 2) : informeEnTexto(informe));
