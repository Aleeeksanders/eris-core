#!/usr/bin/env bun
// ============================================================
// Eris — Entrypoint Principal
// La Diosa del Caos despierta aquí
// ============================================================

import { Command } from "commander";
import { OllamaProvider } from "./services/llm/OllamaProvider.js";
import { QueryEngine } from "./QueryEngine.js";
import { ToolRegistry } from "./tools.js";
import { loadSystemPrompt } from "./context.js";
import { DEFAULT_CONFIG } from "./types/config.js";
import { join } from "path";
import { startInkUI } from "./ui-ink.js";
import { startReadlineUI } from "./ui-readline.js";

const program = new Command();

program
  .name("eris")
  .description("Eris — La Diosa del Caos. Asistente de IA personal.")
  .version("0.1.0")
  .option("-m, --model <model>", "Modelo de Ollama a usar", DEFAULT_CONFIG.llm.model)
  .option("-u, --url <url>", "URL de Ollama", DEFAULT_CONFIG.llm.baseUrl)
  .option("-v, --verbose", "Modo verbose", false)
  .option("--no-ui", "Usar modo readline en lugar de Ink UI", false)
  .action(async (options) => {
    await startEris(options);
  });

async function startEris(options: {
  model: string;
  url: string;
  verbose: boolean;
  ui: boolean;
}) {
  // 1. Inicializar el proveedor de LLM
  const provider = new OllamaProvider(options.url, options.model);

  // 2. Verificar conexión con Ollama
  const isAvailable = await provider.isAvailable();

  if (!isAvailable) {
    console.log("\n");
    console.log("  ⚠️  Ollama no está disponible en", options.url);
    console.log("");
    console.log("  Para iniciar Ollama:");
    console.log("    1. Abre Ollama (debería estar en tu bandeja del sistema)");
    console.log("    2. O ejecuta: ollama serve");
    console.log("");
    console.log("  Para descargar el modelo:");
    console.log(`    ollama pull ${options.model}`);
    console.log("");
    console.log("  Luego vuelve a ejecutar: bun run dev");
    console.log("");
    process.exit(1);
  }

  // 3. Cargar system prompt
  const promptPath = join((import.meta as any).dir, "..", "data", "system-prompt.md");
  const systemPrompt = await loadSystemPrompt(promptPath);

  // 4. Inicializar el registro de herramientas
  const toolRegistry = new ToolRegistry();

  if (options.verbose) {
    console.log("  🔧 Herramientas:", toolRegistry.listNames().join(", "));
    console.log("  🧠 Modelo:", options.model);
    console.log("  📡 Proveedor:", provider.name);
  }

  // 5. Crear el motor de consultas
  const queryEngine = new QueryEngine(provider, toolRegistry, systemPrompt);

  // 6. Elegir interfaz
  const isTTY = process.stdin.isTTY;

  if (isTTY && options.ui) {
    // Interfaz Ink (Rich UI)
    await startInkUI(queryEngine);
  } else {
    // Interfaz readline (fallback)
    await startReadlineUI(queryEngine);
  }
}

program.parse();
