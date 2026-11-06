// ============================================================
// Eris — WebSearchTool
// Búsqueda web via DuckDuckGo HTML
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import { isGeneralAsk, groupsFor } from "../services/ToolRouter.js";

const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Preguntas que mejoran con la web: qué conviene usar/comprar, lo mejor, precios, dónde, fechas y noticias. */
const WEB_WORTHY = /\b(que|cual(es)?)\b[^?]{0,60}\b(debo|deberia|conviene|me recomiendas|recomiendas|sirve|usar|comprar|elegir)\b|\b(mejor(es)?|recomendad[oa]s?|recomiend\w*|precio\w*|cuesta\w*|cuanto (vale|sale)|donde (compro|comprar|venden|queda|hay)|noticia\w*|ultim[oa]s?|este ano|horario\w*|resultado\w*|quien gano|ingredientes|que contiene|composicion)\b/; // + ingredientes de un producto (banco 2026-11-05: «Coca-Cola Zero» de memoria y mal)
/** «Busca en internet…», «googlea…», «averigua…» */
const EXPLICIT = /\b(busca(me|lo|la)?|buscar|googlea\w*|investiga\w*|averigua\w*)\b[^?]{0,40}\b(internet|web|google|en linea|online)\b|^(busca(me)?|googlea|averigua)\b/;
/** «Sí porfa», «dale», «claro, gracias»: un sí sin nada más */
const YES = /^(si|sip|dale|ya|ok|okey|bueno|perfecto|claro|obvio|de una|porfa\w*|por favor)([\s,.!]+(si|porfa\w*|por favor|dale|claro|gracias|po|nomas))*[\s.!]*$/;
/** La consulta: sin «Eris,» ni signos de pregunta. */
const cleanQuery = (t: string) => t.replace(/^\s*eris[,:]?\s*/i, "").replace(/[¿?¡!]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);

const WebSearchInputSchema = z.object({
  query: z.string().describe("La consulta de búsqueda web"),
  maxResults: z
    .number()
    .optional()
    .describe("Número máximo de resultados (default: 5)"),
});

type WebSearchInput = z.infer<typeof WebSearchInputSchema>;

/** Lo que se le dice al modelo cuando no se pudo buscar: que no invente ni diga «no encontré» (no se buscó). */
export const BLOCKED = "No pude buscar en internet ahora (el buscador bloqueó la consulta automática). Dile a la persona que no pudiste buscar, sin decir que no existe ni inventar datos.";

/** Los resultados web de la respuesta JSON de Brave Search (título, enlace y descripción sin etiquetas). */
export function braveResults(json: any, maxResults: number): { title: string; url: string; snippet: string }[] {
  const strip = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
  const list: any[] = Array.isArray(json?.web?.results) ? json.web.results : [];
  return list.slice(0, maxResults).map((r) => ({ title: strip(r.title) || "Sin título", url: String(r.url ?? ""), snippet: strip(r.description) || "Sin descripción" }));
}

export class WebSearchTool extends Tool<WebSearchInput> {
  readonly name = "web_search";
  readonly untrustedOutput = true;
  readonly description =
    "Busca información en la web usando DuckDuckGo. " +
    "Retorna títulos, URLs y fragmentos de los resultados.";
  readonly inputSchema = WebSearchInputSchema;

  /**
   * La búsqueda la decide el código (2026-10-23): con la clave de Brave puesta, el modelo de 4B igual contestaba de memoria
   * «¿qué zapatillas uso para básquet?» (y otra vez tras «sí porfa»), sin llamar a la herramienta. Ahora, si la pregunta es
   * general (nada de lo tuyo: comida, plata, salud…) y de las que mejoran con la web (qué conviene usar o comprar, lo mejor,
   * precios, fechas, noticias) o pide buscar, se busca primero y el modelo redacta con los resultados. «Sí porfa» después
   * de una de esas busca esa pregunta.
   */
  async preroute(userMessage: string, context?: any): Promise<Record<string, unknown> | null> {
    const msg = String(userMessage || "").trim();
    if (!msg || msg.length > 300) return null;
    const pide = EXPLICIT.test(fold(msg));
    if ((isGeneralAsk(msg) && WEB_WORTHY.test(fold(msg))) || (pide && !groupsFor(msg).size)) return { query: cleanQuery(msg), maxResults: 5 };
    const prev = String(context?.lastUserMessage ?? "").trim();
    // (Eris no siempre cierra con una pregunta: «sí porfa» después de una pregunta así igual pide más de lo mismo)
    if (fold(msg).length <= 30 && YES.test(fold(msg)) && prev && isGeneralAsk(prev) && WEB_WORTHY.test(fold(prev))) {
      return { query: cleanQuery(prev), maxResults: 5 };
    }
    return null;
  }

  async execute(input: WebSearchInput): Promise<ToolExecutionResult> {
    const { query, maxResults = 5 } = input;
    // Con clave de Brave Search (plan gratis: https://brave.com/search/api/), su API; si no, DuckDuckGo
    const braveKey = process.env.BRAVE_SEARCH_API_KEY;
    if (braveKey) return this.brave(query, maxResults, braveKey);

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
      // 2026-10-21: DuckDuckGo responde 202 con su página anti-bots a todas las consultas del PC. Antes eso salía como
      // «No se encontraron resultados» y Eris decía «no encontré datos confiables en la web» (no había buscado nada).
      if (response.status === 202 || /anomaly-modal|class="anomaly|challenge-form/.test(html)) {
        return { output: "", error: BLOCKED };
      }
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

  /** Brave Search API (JSON): https://api.search.brave.com/res/v1/web/search, clave en BRAVE_SEARCH_API_KEY. */
  private async brave(query: string, maxResults: number, key: string): Promise<ToolExecutionResult> {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(10, maxResults)}&country=CL&search_lang=es`;
      const res = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": key } });
      if (!res.ok) return { output: "", error: res.status === 401 || res.status === 403 ? `${BLOCKED} (la clave de Brave no fue aceptada: HTTP ${res.status})` : `Error en búsqueda web: HTTP ${res.status}` };
      const results = braveResults(await res.json(), maxResults);
      if (!results.length) return { output: `No se encontraron resultados para: "${query}"` };
      return {
        output: `Resultados de búsqueda para "${query}":\n\n${results.map((r, i) => `### ${i + 1}. ${r.title}\n🔗 ${r.url}\n${r.snippet}`).join("\n\n")}`,
        metadata: { resultCount: results.length, provider: "brave" },
      };
    } catch (err) {
      return { output: "", error: `Error en búsqueda web: ${err instanceof Error ? err.message : String(err)}` };
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
