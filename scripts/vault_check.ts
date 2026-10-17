// ============================================================
// Revisa la bóveda AXS: el linter de Hestia (VaultLint), enlaces rotos y notas huérfanas.
//
// Uso:  bun scripts/vault_check.ts [ruta de la bóveda]      (por defecto C:\Proyectos\AXS)
//
// Huérfanas aceptadas por diseño: CLAUDE.md (archivo de agentes) y MEMORY.md (índice de máquina).
// Los ejemplos de enlaces dentro de CLAUDE.md ("[[Nota]]") no cuentan como rotos.
// ============================================================
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { VaultIndex } from "../src/services/vault/VaultIndex.ts";
import { lintVault, summarize, formatLint } from "../src/services/vault/VaultLint.ts";

const root = (process.argv[2] ?? "C:/Proyectos/AXS").replace(/\\/g, "/");

const idx = await VaultIndex.build(root);
const issues = lintVault(idx);
console.log(formatLint(issues.filter((i) => i.severity !== "info"), { perCode: 30 }));

// Enlaces rotos y huérfanas, con la misma regla de la bóveda: [[ruta/completa(.md)|alias]] o una nota de la raíz por nombre
const files = [...new Glob("**/*.md").scanSync({ cwd: root })]
  .map((f) => f.replace(/\\/g, "/"))
  .filter((f) => !f.startsWith(".obsidian/") && !f.startsWith(".trash/"));
const paths = new Set(files);
const rootNames = new Map(files.filter((f) => !f.includes("/")).map((f) => [f.replace(/\.md$/, ""), f] as const));
const incoming = new Map(files.map((f) => [f, 0] as const));
const broken: string[] = [];
for (const f of files) {
  const text = readFileSync(`${root}/${f}`, "utf-8").replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const t = m[1].trim();
    const target = paths.has(t) ? t : paths.has(`${t}.md`) ? `${t}.md` : rootNames.get(t);
    if (!target) { if (f !== "CLAUDE.md") broken.push(`${f} → ${t}`); continue; }
    if (target !== f) incoming.set(target, (incoming.get(target) ?? 0) + 1);
  }
}
const orphans = [...incoming].filter(([f, n]) => n === 0 && f !== "CLAUDE.md" && f !== "MEMORY.md").map(([f]) => f);

const s = summarize(issues);
console.log(`\nNotas: ${files.length} · enlaces rotos: ${broken.length} · huérfanas: ${orphans.length}`);
for (const b of broken) console.log(`  ✗ roto: ${b}`);
for (const o of orphans) console.log(`  ✗ huérfana: ${o}`);
const ok = s.errors === 0 && broken.length === 0 && orphans.length === 0;
console.log(ok ? "\n🟢 Bóveda en orden." : "\n🔴 Hay que corregir lo de arriba.");
process.exit(ok ? 0 : 1);
