import { KnowledgeTool } from "../src/tools/KnowledgeTool.js";

async function run() {
  console.log("🔍 Buscando conocimiento sobre 'Roadmap' en AXS y Eris...");
  const searcher = new KnowledgeTool();
  const result = await searcher.execute({ query: "Roadmap", scope: "all" });
  console.log(result.output);
}

run();
