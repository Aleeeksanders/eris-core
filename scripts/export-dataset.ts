// ============================================================
// Eris — Exportador de Dataset
// Combina seed + conversaciones reales → JSONL para Unsloth
// ============================================================

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import * as os from "os";

const SEED_FILE = join(import.meta.dir, "..", "data", "training", "seed-dataset.jsonl");
const REAL_FILE = join(os.homedir(), ".eris", "training", "conversations.jsonl");
const OUTPUT_FILE = join(import.meta.dir, "..", "data", "training", "eris-training.jsonl");

interface TrainingEntry {
  id: string;
  approved?: boolean;
  messages: Array<{ role: string; content: string }>;
}

async function exportDataset() {
  await mkdir(join(import.meta.dir, "..", "data", "training"), { recursive: true });

  let seedEntries: TrainingEntry[] = [];
  let realEntries: TrainingEntry[] = [];

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

    // Solo las aprobadas manualmente (approved: true)
    realEntries = allReal.filter((e: TrainingEntry) => e.approved === true);
    console.log(`  💬 Real: ${realEntries.length} aprobadas de ${allReal.length} totales`);
  } catch {
    console.log("  ℹ️ No hay conversaciones reales capturadas aún");
  }

  // Combinar
  const combined = [...seedEntries, ...realEntries];

  // Convertir a formato ChatML plano para Unsloth
  const chatmlLines = combined.map((entry) => {
    // Formato esperado por Unsloth: {"messages": [{"role": "...", "content": "..."}]}
    return JSON.stringify({
      messages: entry.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });
  });

  await writeFile(OUTPUT_FILE, chatmlLines.join("\n") + "\n", "utf-8");

  // Estadísticas
  const totalTokensEstimate = combined.reduce(
    (sum, e) => sum + e.messages.reduce((s, m) => s + m.content.length / 4, 0),
    0
  );

  console.log(`
  ✅ Dataset exportado exitosamente
  📁 ${OUTPUT_FILE}
  📊 Estadísticas:
     - Total conversaciones: ${combined.length}
     - Desde seed: ${seedEntries.length}
     - Desde real (aprobadas): ${realEntries.length}
     - Tokens estimados: ~${Math.round(totalTokensEstimate)}
     - Tamaño: ${Math.round(chatmlLines.join("\n").length / 1024)}KB

  📋 Para aprobar conversaciones reales:
     Edita: ${REAL_FILE}
     Cambia "approved": false → "approved": true

  🚀 Para entrenar con Unsloth:
     1. Sube eris-training.jsonl a Google Drive o Colab
     2. Usa el notebook de Unsloth para Qwen 2.5
     3. Configura: model = "unsloth/Qwen2.5-3B-Instruct"
     4. Dataset format: "chatml"
  `);
}

exportDataset().catch(console.error);
