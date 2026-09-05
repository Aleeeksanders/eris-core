import { OllamaProvider } from "../src/services/llm/OllamaProvider.js";
import { ExecutiveReportTool } from "../src/tools/ExecutiveReportTool.js";

async function run() {
  console.log("Generando reporte de estatus... (esperando al modelo)");
  try {
    const provider = new OllamaProvider("http://localhost:11434", "qwen3:8b");
    const isAvail = await provider.isAvailable();
    if (!isAvail) {
      console.log("Ollama no está disponible. No se puede generar el reporte real.");
      return;
    }

    const reportTool = new ExecutiveReportTool(provider);
    const result = await reportTool.execute({ scope: "full_report" });
    
    console.log("\n================ REPORT ==================\n");
    console.log(result.output);
    console.log("\n==========================================\n");
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
