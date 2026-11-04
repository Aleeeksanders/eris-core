// ============================================================
// Todas las pruebas de Eris con un solo comando (revisión exhaustiva, 2026-11-04). Antes vivían en carpetas temporales
// de las sesiones de trabajo (fuera de los repositorios) y se corrían con un script a mano.
//
//   bun run pruebas            (desde eris/ o eris-mobile/)
//   bun run pruebas finanzas   (solo los archivos cuyo nombre calce con «finanzas»)
//
// - eris/tests (servidor y lo que cruza app ↔ servidor) y eris-mobile/tests (la app, con React Native simulado).
// - Cada archivo corre aparte: los `mock.module` de una prueba no se cuelan en otra.
// - HOME aislado y nuevo en cada corrida (con «erishome» en la ruta: varias pruebas lo exigen para no tocar datos reales),
//   con las cuentas de prueba del banco de chat (scripts/chat_eval/setup.ts).
// - Reloj de Chile (TZ=America/Santiago). Sale con 1 si algo falla.
// Lo que dice el modelo se prueba aparte, con Ollama arriba: scripts/chat_eval. El enrutamiento, rápido: scripts/rutas.
// ============================================================
import * as os from "os";
import { join, basename } from "path";
import { readdirSync, existsSync, rmSync, mkdirSync } from "fs";

const ERIS = join(import.meta.dir, "..");
const CARPETAS = [join(ERIS, "tests"), join(ERIS, "..", "eris-mobile", "tests")].filter((d) => existsSync(d));
const filtro = process.argv[2] ? new RegExp(process.argv[2], "i") : null;

const HOME = join(os.tmpdir(), "eris_pruebas", "erishome");
rmSync(HOME, { recursive: true, force: true });
mkdirSync(HOME, { recursive: true });
const env = { ...process.env, HOME, USERPROFILE: HOME, TZ: "America/Santiago" };

const setup = Bun.spawnSync(["bun", join(ERIS, "scripts", "chat_eval", "setup.ts")], { cwd: ERIS, env, stdout: "pipe", stderr: "pipe" });
if (setup.exitCode !== 0) { console.error("No pude preparar el HOME de prueba:\n" + setup.stderr.toString()); process.exit(1); }

const archivos = CARPETAS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".test.ts")).map((f) => join(d, f)))
  .filter((f) => !filtro || filtro.test(basename(f)));
const t0 = Date.now();
let pasan = 0, fallan = 0;
const malos: string[] = [];
for (const f of archivos) {
  const r = Bun.spawnSync(["bun", "test", f], { cwd: join(f, ".."), env, stdout: "pipe", stderr: "pipe", timeout: 300_000 });
  const out = r.stdout.toString() + r.stderr.toString();
  const p = Number(out.match(/^\s*(\d+) pass$/m)?.[1] ?? 0), x = Number(out.match(/^\s*(\d+) fail$/m)?.[1] ?? 0);
  const error = /# Unhandled error|error: /.test(out) && x === 0 && p === 0;
  pasan += p; fallan += x;
  const ok = x === 0 && p > 0 && !error && r.exitCode === 0;
  const nombre = `${basename(join(f, "..", ".."))}/tests/${basename(f)}`;
  console.log(`${ok ? "✅" : "❌"} ${nombre.padEnd(52)} ${p} ok${x ? ` · ${x} fallan` : ""}${error || (!ok && !x) ? " · no corrió (mira el error)" : ""}`);
  if (!ok) malos.push(nombre);
}
console.log(`\n══ ${archivos.length - malos.length}/${archivos.length} archivos · ${pasan} pruebas en verde${fallan ? ` · ${fallan} fallan` : ""} · ${Math.round((Date.now() - t0) / 1000)} s ══`);
if (malos.length) console.log(`Para ver el detalle: bun run pruebas "${basename(malos[0]).replace(/\.test\.ts$/, "")}" (o bun test ese archivo con el mismo HOME)`);
process.exit(malos.length ? 1 : 0);
