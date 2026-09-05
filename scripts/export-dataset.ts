// ============================================================
// Eris — Exportador de Dataset
// Combina seed + conversaciones reales → JSONL para Unsloth
// Uso: bun run scripts/export-dataset.ts [--all]
//   --all: exporta todas las conversaciones (sin filtro de aprobación)
// ============================================================

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import * as os from "os";

const SEED_FILE = join(import.meta.dir, "..", "data", "training", "seed-dataset.jsonl");
const REAL_FILE = join(os.homedir(), ".eris", "training", "conversations.jsonl");
const OUTPUT_FILE = join(import.meta.dir, "..", "data", "training", "eris-training.jsonl");

const EXPORT_ALL = process.argv.includes("--all");

interface TrainingEntry {
  id: string;
  approved?: boolean;
  messages: Array<{ role: string; content: string }>;
}

async function exportDataset() {
  await mkdir(join(import.meta.dir, "..", "data", "training"), { recursive: true });

  let seedEntries: TrainingEntry[] = [];
  let realEntries: TrainingEntry[] = [];
  let totalReal = 0;

  // Cargar dataset semilla
  try {
    const seedData = await readFile(SEED_FILE, "utf-8");
    seedEntries = seedData
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    console.log(`  📦 Seed: ${seedEntries.length} conversaciones`);
  } catch {
    console.log("  ⚠️ No se encontró seed-dataset.jsonl");
  }

  // Cargar conversaciones reales
  try {
    const realData = await readFile(REAL_FILE, "utf-8");
    const allReal = realData
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));

    totalReal = allReal.length;

    if (EXPORT_ALL) {
      // Exportar todas sin filtro de aprobación
      realEntries = allReal.filter((e: TrainingEntry) =>
        e.messages && e.messages.length >= 2
      );
      console.log(`  💬 Real: ${realEntries.length} conversaciones (modo --all)`);
    } else {
      // Solo las aprobadas manualmente
      realEntries = allReal.filter((e: TrainingEntry) => e.approved === true);
      console.log(`  💬 Real: ${realEntries.length} aprobadas de ${totalReal} totales`);
    }
  } catch {
    console.log("  ℹ️ No hay conversaciones reales capturadas aún");
  }

  // Combinar y filtrar conversaciones con al menos 2 mensajes
  const combined = [...seedEntries, ...realEntries].filter(
    (e) => e.messages && e.messages.length >= 2
  );

  // Convertir a formato ChatML plano para Unsloth
  const chatmlLines = combined.map((entry) => {
    return JSON.stringify({
      messages: entry.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });
  });

  await writeFile(OUTPUT_FILE, chatmlLines.join("\n") + "\n", "utf-8");

  // Estadísticas
  const totalMessages = combined.reduce((sum, e) => sum + e.messages.length, 0);
  const totalChars = combined.reduce(
    (sum, e) => sum + e.messages.reduce((s, m) => s + m.content.length, 0),
    0
  );

  console.log(`
  ✅ Dataset exportado
  📁 ${OUTPUT_FILE}
  📊 Estadísticas:
     - Conversaciones: ${combined.length} (seed: ${seedEntries.length}, real: ${realEntries.length})
     - Mensajes totales: ${totalMessages}
     - Tokens estimados: ~${Math.round(totalChars / 4).toLocaleString()}
     - Tamaño: ${Math.round(chatmlLines.join("\\n").length / 1024)} KB

  💡 Consejo: con ${combined.length} conversaciones ya puedes hacer un dry-run en Colab.
     Meta recomendada para fine-tune real: 100+ conversaciones.

  🚀 Próximos pasos:
     1. Sube eris-training.jsonl a Google Colab
     2. Usa Unsloth con: model = "unsloth/Qwen3-8B-Instruct"
     3. Descarga el .gguf resultante (~4.5 GB)
     4. Colócalo en data/ y actualiza Modelfile
     5. ollama create eris-sovereign -f data/Modelfile
  `);
}

exportDataset().catch(console.error);
