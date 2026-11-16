// ============================================================
// Eris — VaultNoteTool
//
// Crea una nota NUEVA en la bóveda AXS siguiendo las reglas de su CLAUDE.md, decididas por código y no por el modelo:
//   · carpeta según el área (Johnny.Decimal), nombre único en todo el vault, sin snake_case/kebab-case
//   · frontmatter owner/tier/status válido, tag del vocabulario controlado
//   · enlaces SIEMPRE con ruta completa y que existan (si el modelo escribe uno malo, se rechaza y se le dice cuál)
//   · opcionalmente la enlaza desde una nota-hub, para que no nazca huérfana (con respaldo previo de esa nota)
// Nunca sobrescribe. Pide aprobación en la app mostrando exactamente lo que va a escribir.
// ============================================================

import { z } from "zod";
import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { Tool, type ToolExecutionResult, type PreflightResult } from "../Tool.js";
import { VaultService } from "../services/vault/VaultService.js";
import { VaultIndex, maskCode } from "../services/vault/VaultIndex.js";
import { addRelatedLink, backupFile, keepEol } from "../services/vault/VaultEdit.js";
import { checkPath } from "../services/security/PathPolicy.js";
import { isPure } from "../services/Intent.js";

const AREAS = {
  gobernanza: { dir: "00-09 Management & Governance", tier: "Directivo" },
  estrategia: { dir: "10-19 Strategic Vision", tier: "Estratégico" },
  tecnica: { dir: "20-29 R&D (The Forge)", tier: "Técnico" },
  negocio: { dir: "30-39 GTM & Business Operations", tier: "Operativo" },
  estandares: { dir: "40-49 Standards & SOPs", tier: "Operativo" },
} as const;
const SUBAREAS = ["Administración", "Comercial", "Finanzas", "Marketing"] as const;
// Secciones de 20-29 (y los runbooks de 40-49), cada una con su mapa "2X - …" (reorganización del 2026-10-12: la bóveda es
// jerárquica, Dashboard → mapas por rango → mapas por área → notas; nada suelto en la raíz de 20-29).
const SECTIONS = {
  nucleo: { area: "tecnica", dir: "21 Núcleo de Eris" },
  modulos: { area: "tecnica", dir: "22 Módulos de la App" },
  plataforma: { area: "tecnica", dir: "23 Plataforma e Infraestructura" },
  laboratorio: { area: "tecnica", dir: "25 Laboratorio e I+D" },
  // Lo que aún no existe en el código va a Visión de Producto (10-19), no a 20-29: 20-29 es "lo que tenemos"
  vision: { area: "estrategia", dir: "11 Visión de Producto" },
  runbooks: { area: "estandares", dir: "41 Runbooks" },
} as const;
type Section = keyof typeof SECTIONS;
/** El mapa de una carpeta numerada: "21 Núcleo de Eris" → "21 - Núcleo de Eris" */
const mapOf = (dir: string) => `${dir.slice(0, 2)} - ${dir.slice(3)}`;
/** El mapa de cada rango, cuando la nota no va en una sección */
const AREA_MAP: Partial<Record<keyof typeof AREAS, string>> = {
  estrategia: "10 - Visión Estratégica", negocio: "30 - Negocio", estandares: "40 - Estándares y Procedimientos",
};
const TAGS = ["Producto", "Core", "Salud", "Finanzas", "Comercial", "Marketing", "Administración", "TI", "Infraestructura", "Seguridad", "Hardware", "TSN", "Dashboard", "Roadmap"] as const;

/**
 * Un valor de una lista dicho de otra forma («activo», «#AXS/Infraestructura», «técnica»): se acepta el de la lista. (2026-11-16, banco
 * «voz»: con «Gobernanza» como tag la nota se rechazaba y Hestia terminó explicándole a Alex el formato de los tags.) Si no calza con
 * ninguno: en lo opcional se descarta (la nota igual se crea), en lo obligatorio queda tal cual y la validación lo explica.
 */
function aLaLista(valores: readonly string[], v: unknown, opcional: boolean): unknown {
  const f = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (typeof v !== "string") return opcional ? undefined : v;
  const limpio = v.replace(/^#?\s*AXS\s*\//i, "");
  return valores.find((x) => f(x) === f(limpio)) ?? (opcional ? undefined : v);
}
function suave<T extends readonly [string, ...string[]]>(valores: T, opcional: true): z.ZodEffects<z.ZodOptional<z.ZodEnum<z.Writeable<T>>>>;
function suave<T extends readonly [string, ...string[]]>(valores: T, opcional: false): z.ZodEffects<z.ZodEnum<z.Writeable<T>>>;
function suave<T extends readonly [string, ...string[]]>(valores: T, opcional: boolean) {
  return opcional
    ? z.preprocess((v) => aLaLista(valores, v, true), z.enum(valores).optional())
    : z.preprocess((v) => aLaLista(valores, v, false), z.enum(valores));
}

const Schema = z.object({
  title: z.string().describe("Título de la nota, en español y con espacios (p. ej. «Plan de Backups»). Sin guiones bajos ni kebab-case."),
  area: suave(["gobernanza", "estrategia", "tecnica", "negocio", "estandares"] as const, false).describe(
    "Dónde va: tecnica = documentación técnica/módulos (20-29); estrategia = visión (10-19); negocio = comercial/finanzas/marketing/administración (30-39); estandares = procedimientos (40-49); gobernanza = gobierno y mapas (00-09)"),
  subarea: suave(SUBAREAS, true).describe("Solo con area=negocio: Administración, Comercial, Finanzas o Marketing"),
  seccion: suave(["nucleo", "modulos", "plataforma", "laboratorio", "vision", "runbooks"] as const, true).describe(
    "Con area=tecnica (SOLO lo que ya existe en el código): nucleo (motor, memoria, herramientas, voz), modulos (lo que se usa en la app), " +
    "plataforma (TI, seguridad, conectividad) o laboratorio (I+D; por defecto). Con area=estrategia: vision (módulos o productos que " +
    "AÚN NO existen: hardware, ideas, conceptos). Con area=estandares: runbooks (cómo operar)."),
  body: z.string().optional().describe("Contenido en markdown. Los enlaces a otras notas deben ser [[ruta/completa/Nota.md|Alias]]."),
  status: suave(["Concepto", "Planificado", "Activo"] as const, true).describe("Por defecto Concepto (lo que aún no está construido)"),
  tag: suave(TAGS, true).describe(`Etiqueta del área (#AXS/<tag>), una de: ${TAGS.join(", ")}`),
  related: z.string().optional().describe("Nombres de notas relacionadas, separados por coma (se enlazan con ruta completa)"),
  parent: z.string().optional().describe("Nota YA EXISTENTE que recibirá un enlace a la nueva (para que no quede huérfana). Si el usuario dice «enlázala desde Forge» / «cuélgala de Toji», ese nombre va AQUÍ (p. ej. «Forge»). No crea nada con ese nombre."),
});
type Input = z.infer<typeof Schema>;

const MAX_BODY = 6000;

interface Plan { path: string; abs: string; content: string; parent?: { abs: string; rel: string; newRaw: string }; warnings: string[] }

function cleanTitle(t: string): string {
  let s = t.replace(/[\\/:*?"<>|#^\[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (!/\s/.test(s) && /[-_]/.test(s)) s = s.replace(/[-_]+/g, " ").trim(); // kebab/snake → espacios (CLAUDE.md: nada de snake_case)
  else s = s.replace(/_/g, " ").replace(/\s+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export class VaultNoteTool extends Tool<Input> {
  readonly name = "vault_note";
  readonly dangerous = true;
  readonly requiresConfirmation = true;
  readonly description =
    "Crea UNA nota nueva en la bóveda AXS con el formato correcto (carpeta, frontmatter, tags, enlaces con ruta completa). " +
    "Escribe SOLO lo que el usuario dijo: no inventes responsables, fechas, frecuencias ni estados (lo que falte, déjalo como «_Pendiente de definir_»). " +
    "Nunca sobrescribe. Para decisiones usa crystallize; para logs, log_management.";
  readonly inputSchema = Schema;

  private vault = new VaultService();

  private async plan(input: Input): Promise<{ ok: true; plan: Plan } | { ok: false; reason: string }> {
    const root = this.vault.getVaultPath();
    const title = cleanTitle(input.title);
    if (title.length < 2 || title.length > 80) return { ok: false, reason: "El título debe tener entre 2 y 80 caracteres." };
    if (/^(claude|memory)$/i.test(title)) return { ok: false, reason: "Ese nombre está reservado para archivos de agente de la bóveda." };
    if (input.subarea && input.area !== "negocio") return { ok: false, reason: "subarea solo se usa con area=negocio." };
    if (input.seccion && !SECTIONS[input.seccion as Section]) return { ok: false, reason: `seccion «${input.seccion}» no existe (hardware y conceptos van en seccion=vision con area=estrategia).` };
    if (input.seccion && SECTIONS[input.seccion].area !== input.area) return { ok: false, reason: `seccion=${input.seccion} no corresponde a area=${input.area}.` };
    const rawBody = (input.body ?? "").replace(/\r\n/g, "\n").trim();
    if (rawBody.length > MAX_BODY) return { ok: false, reason: `El contenido es demasiado largo (${rawBody.length} caracteres; máximo ${MAX_BODY}). Crea la nota con lo esencial.` };

    const idx = await VaultIndex.build(root);
    const warnings: string[] = [];

    // Nombre único en todo el vault
    const clash = [...idx.notes.values()].find((n) => n.name.toLowerCase() === title.toLowerCase());
    if (clash) return { ok: false, reason: `Ya existe una nota llamada «${clash.name}» (${clash.path}). Los nombres deben ser únicos en el vault: elige otro título o edita esa.` };

    // Enlaces del cuerpo: siempre con ruta completa y que existan. Lo que se puede arreglar con certeza se arregla
    // (enlace corto → ruta completa); lo que no existe se deja como texto plano. Nunca se escribe un enlace roto.
    // (los bloques de código se ignoran: la máscara conserva los largos, así que los índices coinciden con el original)
    let body = rawBody;
    let fixed = 0;
    const removed: string[] = [];
    const matches = [...maskCode(rawBody).matchAll(/(!?)\[\[([^\]\n]+?)\]\]/g)].reverse();
    for (const m of matches) {
      const inner = m[2];
      const parts = inner.split(/\\?\|/);
      const alias = parts.length > 1 ? parts.slice(1).join("|").trim() : undefined;
      const target = parts[0].replace(/[#^].*$/, "").trim();
      if (!target) continue;
      const r = idx.resolve(target, m[1] === "!");
      let replacement: string | null = null;
      if (r.kind === "broken") {
        const plain = alias || target.replace(/\\/g, "/").split("/").pop()!.replace(/\.md$/i, "");
        replacement = plain;
        removed.push(target);
      } else if (r.kind === "short" || r.kind === "partial" || r.kind === "ambiguous") {
        replacement = `${m[1]}${idx.wikilink(r.resolved!, alias)}`;
        fixed++;
      }
      if (replacement !== null) body = body.slice(0, m.index!) + replacement + body.slice(m.index! + m[0].length);
    }
    if (fixed) warnings.push(`Corregí ${fixed} enlace(s) a ruta completa (regla del vault).`);
    if (removed.length) warnings.push(`Quité ${removed.length} enlace(s) a notas que no existen (quedaron como texto): ${[...new Set(removed)].slice(0, 4).join(", ")}.`);

    // Relacionadas
    const rel: string[] = [];
    for (const name of (input.related ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const f = idx.find(name, 1)[0];
      if (f) rel.push(idx.wikilink(f.path)); else warnings.push(`No encontré la nota relacionada «${name}» (no se enlazó).`);
    }

    // Ruta: la técnica nunca queda suelta en la raíz de 20-29 (sin sección → Laboratorio e I+D)
    const a = AREAS[input.area];
    const section: Section | undefined = input.seccion ?? (input.area === "tecnica" ? "laboratorio" : undefined);
    const dirParts = [a.dir, ...(section ? [SECTIONS[section].dir] : []), ...(input.subarea ? [input.subarea] : [])];
    const path = [...dirParts, `${title}.md`].join("/");
    const abs = join(root, ...dirParts, `${title}.md`);
    const pc = checkPath(abs, "write");
    if (!pc.ok) return { ok: false, reason: pc.reason };

    // Nota-hub (para que no nazca huérfana). Sin parent, cuelga del mapa de su carpeta o de su rango.
    const explicitParent = input.parent?.trim();
    const parentName = explicitParent || (section ? mapOf(SECTIONS[section].dir) : input.subarea ?? AREA_MAP[input.area]);
    let parent: Plan["parent"];
    let upLink = "";
    if (parentName) {
      const p = idx.find(parentName, 1)[0];
      if (!p && explicitParent) return { ok: false, reason: `No encontré la nota-hub «${input.parent}» para enlazar la nueva. Revisa el nombre o no uses parent.` };
      if (p) {
        if (p.path === "CLAUDE.md" || p.path === "MEMORY.md") return { ok: false, reason: "No se agregan enlaces en archivos de agente (CLAUDE.md / MEMORY.md)." };
        const pAbs = join(root, ...p.path.split("/"));
        const wc = checkPath(pAbs, "write");
        if (!wc.ok) return { ok: false, reason: wc.reason };
        const raw = await readFile(pAbs, "utf-8");
        const bullet = `- ${idx.wikilink(path, title)}`;
        parent = { abs: pAbs, rel: p.path, newRaw: keepEol(raw, (t) => addRelatedLink(t, bullet)) };
        upLink = `↑ ${idx.wikilink(p.path, p.name)}\n\n`;
      } else {
        warnings.push(`No encontré el mapa «${parentName}»: la nota quedará HUÉRFANA hasta que la enlaces desde otra.`);
      }
    } else {
      warnings.push("Sin nota-hub (parent): la nota quedará HUÉRFANA hasta que la enlaces desde otra. CLAUDE.md pide que todo esté conectado.");
    }

    const content =
      `---\nowner: Eris\ntier: ${a.tier}\nstatus: ${input.status ?? "Concepto"}\n${section === "vision" ? "estado: Visión\n" : ""}---\n\n` +
      `# 📄 ${title}\n\n` +
      upLink +
      (input.tag ? `#AXS/${input.tag}\n\n` : "") +
      (body ? `${body}\n` : "_Pendiente de desarrollo._\n") +
      (rel.length ? `\n## 🔗 Relacionados\n${rel.map((l) => `- ${l}`).join("\n")}\n` : "");

    return { ok: true, plan: { path, abs, content, parent, warnings } };
  }

  async preflight(input: Input): Promise<PreflightResult> {
    const r = await this.plan(input);
    if (!r.ok) return { ok: false, reason: r.reason };
    const p = r.plan;
    const preview = p.content.length > 900 ? p.content.slice(0, 900) + `\n… (+${p.content.length - 900} caracteres)` : p.content;
    return {
      ok: true,
      approval: {
        title: "Crear una nota en la bóveda AXS",
        detail:
          `Nueva nota: ${p.path}\n${p.parent ? `Además agrega un enlace en: ${p.parent.rel} (se guarda una copia antes)\n` : ""}` +
          (p.warnings.length ? `\nAvisos:\n- ${p.warnings.join("\n- ")}\n` : "") + `\n${preview}`,
        risk: "normal",
        flags: p.parent ? ["modifica otra nota"] : [],
      },
    };
  }

  async execute(input: Input, context?: any): Promise<ToolExecutionResult> {
    try {
      const r = await this.plan(input);
      if (!r.ok) return { output: "", error: r.reason };
      const p = r.plan;
      await mkdir(dirname(p.abs), { recursive: true });
      await writeFile(p.abs, p.content, { encoding: "utf-8", flag: "wx" }); // wx: jamás sobrescribe
      let linked = "";
      if (p.parent) {
        await backupFile(this.vault.getVaultPath(), p.parent.abs); // si no se puede respaldar, no se toca la nota-hub
        await writeFile(p.parent.abs, p.parent.newRaw, "utf-8");
        linked = ` Enlazada desde ${p.parent.rel}.`;
      }
      // El estado de la conexión lo dice el CÓDIGO (un modelo chico afirma «todo enlazado» sin haberlo hecho)
      const title = p.path.split("/").pop()!.replace(/\.md$/, "");
      const block =
        `# 📄 Nota creada\n` +
        `- Ruta: [[${p.path}|${title}]]\n` +
        `- Conexión: ${p.parent ? `🔗 enlazada desde [[${p.parent.rel}|${p.parent.rel.split("/").pop()!.replace(/\.md$/, "")}]] (copia de esa nota guardada antes de tocarla)` : "⚠ sin enlaces entrantes: quedó HUÉRFANA hasta que la cuelgues de otra nota (dime desde cuál)"}` +
        (p.warnings.filter((w) => !/^Sin nota-hub/.test(w)).map((w) => `\n- Aviso: ${w}`).join(""));
      return {
        output:
          `Nota creada: ${p.path}.${linked || " SIN enlace entrante (huérfana)."}${p.warnings.length ? ` Avisos: ${p.warnings.join(" ")}` : ""} ` +
          `LISTO: no vuelvas a llamar a vault_note para esta nota. [Cómo presentarlo: una frase corta; el detalle exacto (ruta y conexión) se muestra debajo. ` +
          `Di la verdad sobre si quedó enlazada o huérfana; no afirmes enlaces que no se hicieron.]`,
        metadata: {
          path: p.path,
          appendToReply: { text: block, marker: "# 📄 Nota creada" },
          quickReply: isPure(context?.userMessage, ["axs"])
            ? `Listo: creé «${title}»${p.parent ? ` y la enlacé desde ${p.parent.rel.split("/").pop()!.replace(/\.md$/, "")}` : ", pero quedó huérfana: dime desde qué nota colgarla"}.`
            : undefined,
        },
      };
    } catch (err) {
      return { output: "", error: `Error creando la nota: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
