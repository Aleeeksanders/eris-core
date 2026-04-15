// ============================================================
// Eris — WebSearchTool
// Búsqueda web via DuckDuckGo HTML
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";

const WebSearchInputSchema = z.object({
  query: z.string().describe("La consulta de búsqueda web"),
  maxResults: z
    .number()
    .optional()
    .describe("Número máximo de resultados (default: 5)"),
});

type WebSearchInput = z.infer<typeof WebSearchInputSchema>;

export class WebSearchTool extends Tool<WebSearchInput> {
  readonly name = "web_search";
  readonly description =
    "Busca información en la web usando DuckDuckGo. " +
    "Retorna títulos, URLs y fragmentos de los resultados.";
  readonly inputSchema = WebSearchInputSchema;

  async execute(input: WebSearchInput): Promise<ToolExecutionResult> {
    const { query, maxResults = 5 } = input;

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        },
      });

      if (!response.ok) {
        return {
          output: "",
          error: `Error en búsqueda web: HTTP ${response.status}`,
        };
      }

      const html = await response.text();
      const results = this.parseResults(html, maxResults);

      if (results.length === 0) {
        return { output: `No se encontraron resultados para: "${query}"` };
      }

      const output = results
        .map(
          (r, i) =>
            `### ${i + 1}. ${r.title}\n🔗 ${r.url}\n${r.snippet}`
        )
        .join("\n\n");

      return {
        output: `Resultados de búsqueda para "${query}":\n\n${output}`,
        metadata: { resultCount: results.length },
      };
    } catch (err) {
      return {
        output: "",
        error: `Error en búsqueda web: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private parseResults(
    html: string,
    maxResults: number
  ): { title: string; url: string; snippet: string }[] {
    const results: { title: string; url: string; snippet: string }[] = [];

    // Extraer resultados del HTML de DuckDuckGo
    // Cada resultado está en una clase "result"
    const resultBlocks = html.split('class="result__body"');

    for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
      const block = resultBlocks[i];

      // Extraer título
      const titleMatch = block.match(
        /class="result__a"[^>]*>([^<]+)</
      );
      const title = titleMatch
        ? this.decodeHtml(titleMatch[1].trim())
        : "Sin título";

      // Extraer URL
      const urlMatch = block.match(
        /class="result__url"[^>]*href="([^"]*)"/ 
      ) || block.match(/href="\/\/duckduckgo\.com\/l\/\?uddg=([^&"]+)/);
      
      let url = "URL no disponible";
      if (urlMatch) {
        url = decodeURIComponent(urlMatch[1]).trim();
        if (!url.startsWith("http")) url = `https://${url}`;
      }

      // Extraer snippet
      const snippetMatch = block.match(
        /class="result__snippet"[^>]*>([\s\S]*?)<\//
      );
      const snippet = snippetMatch
        ? this.decodeHtml(snippetMatch[1].replace(/<[^>]+>/g, "").trim())
        : "Sin descripción";

      if (title !== "Sin título") {
        results.push({ title, url, snippet });
      }
    }

    return results;
  }

  private decodeHtml(html: string): string {
    return html
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
}
