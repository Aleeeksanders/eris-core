// ============================================================
// Eris — AdminOverviewTool (solo Ikaros, solo lectura)
//
// Le permite al administrador preguntar "¿quién está registrado?", "¿qué se ejecutó hoy?", "¿alguien intentó algo raro?".
// Devuelve METADATOS (nunca chats, salud ni finanzas). Cambiar roles, cerrar sesiones o suspender cuentas NO se puede
// desde acá a propósito: eso solo lo hace la persona desde el panel de la app.
// ============================================================

import { z } from "zod";
import { Tool, type ToolExecutionResult } from "../Tool.js";
import type { AdminService } from "../services/security/AdminService.js";
import type { AuditLog, AuditEntry } from "../services/security/AuditLog.js";

const Schema = z.object({
  section: z.enum(["perfiles", "actividad", "seguridad"]).default("perfiles")
    .describe("perfiles = quién está registrado y su estado; actividad = últimas acciones sensibles y accesos; seguridad = intentos bloqueados/rechazados e integridad de la bitácora"),
  profile: z.string().optional().describe("Filtrar la actividad por un perfil (opcional)"),
  limit: z.number().optional().describe("Cuántas entradas mostrar (máx. 50, por defecto 15)"),
});
type Input = z.infer<typeof Schema>;

const ago = (iso?: string) => {
  if (!iso) return "nunca";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "hace un momento";
  if (s < 5400) return `hace ${Math.round(s / 60)} min`;
  if (s < 129600) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} días`;
};
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function line(e: AuditEntry): string {
  const what = e.event === "tool" ? `${e.tool} → ${e.decision}${e.ok === false && e.error ? ` (${e.error.slice(0, 80)})` : ""}` : e.event === "admin" ? "admin" : e.event;
  return `- ${ago(e.ts)} · ${e.profileId} · ${what}${e.detail ? ` · ${e.detail.slice(0, 120)}` : ""}`;
}

export class AdminOverviewTool extends Tool<Input> {
  readonly name = "admin_overview";
  readonly audited = true;
  // La bitácora y la lista de perfiles traen texto que un tercero puede influir (comandos pedidos, correos): se trata como dato
  readonly untrustedOutput = true;
  readonly description =
    "SOLO ADMINISTRADOR. Consulta metadatos del sistema: qué perfiles están registrados (correo, rol, último ingreso, sesiones), " +
    "la actividad reciente de acciones sensibles y los intentos bloqueados. Es de solo lectura y no muestra contenido de los usuarios.";
  readonly inputSchema = Schema;

  constructor(private admin: AdminService, private audit: AuditLog) { super(); }

  async execute(input: Input, context?: any): Promise<ToolExecutionResult> {
    if (context?.role !== "ikaros") return { output: "", error: "Permiso denegado: solo el administrador puede consultar esto." };
    const limit = Math.min(Math.max(Math.round(input.limit ?? 15), 1), 50);

    if (input.section === "perfiles") {
      const rows = await this.admin.overview();
      const google = rows.filter((r) => r.kind === "google");
      const legacy = rows.filter((r) => r.kind === "legacy");
      const out = [`Perfiles con cuenta de Google (${google.length}):`];
      for (const r of google) {
        out.push(
          `- ${r.profileId} · ${r.email} · rol ${r.role}${r.disabled ? " · SUSPENDIDO" : ""} · último ingreso ${ago(r.lastLoginAt)}` +
          ` · ${r.activeSessions} sesión(es)${r.online ? ` · conectado ahora (${r.online})` : ""} · ${kb(r.sizeBytes)}`,
        );
      }
      out.push("", `Perfiles anteriores sin vincular (${legacy.length}) — nadie puede entrar a ellos hasta que su dueño inicie con Google y los vincule con su PIN:`);
      out.push(legacy.map((r) => `${r.profileId} (${kb(r.sizeBytes)}, última actividad ${ago(r.lastActivityAt)})`).join(", ") || "(ninguno)");
      return { output: out.join("\n") };
    }

    if (input.section === "actividad") {
      const es = await this.audit.tail({ limit, profileId: input.profile });
      return { output: es.length ? es.map(line).join("\n") : "Sin actividad registrada." };
    }

    // seguridad
    const [blocked, v] = await Promise.all([this.audit.tail({ limit: 200 }), this.audit.verify()]);
    const bad = blocked.filter((e) =>
      e.event === "login_failed" || (e.event === "tool" && e.decision !== "approved" && e.decision !== "auto") || e.event === "security").slice(0, limit);
    return {
      output:
        `Integridad de la bitácora: ${v.ok ? `íntegra (${v.entries} entradas)` : `ALTERADA en la línea ${v.brokenAt}`}\n` +
        (bad.length ? `Incidentes recientes:\n${bad.map(line).join("\n")}` : "Sin incidentes recientes."),
    };
  }
}
