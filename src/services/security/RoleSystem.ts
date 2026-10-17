// ============================================================
// Sistema de Roles — Eris Sovereign Platform
// Hestia (Admin Soberano) > Eris (Dashboard User)
// ============================================================

export type Role = 'ikaros' | 'eris';

export interface RoleDefinition {
  id: Role;
  displayName: string;
  description: string;
  // Qué herramientas tiene disponibles
  allowedTools: string[];
  // Puede usar archivos del sistema?
  systemAccess: boolean;
  // Puede leer/escribir la bóveda Obsidian?
  vaultAccess: boolean;
  // Puede gestionar roles de otros usuarios?
  canManageRoles: boolean;
  // Puede ver métricas de todos los usuarios?
  globalMetrics: boolean;
}

export const ROLES: Record<Role, RoleDefinition> = {

  // ─── IKAROS — Administrador Soberano (VIP / App) ────────────
  ikaros: {
    id: 'ikaros',
    displayName: 'Ikaros',
    description: 'Perfil VIP personal. Bajo este perfil opera Hestia como Soberana. Acceso total a archivos, Obsidian y métricas ejecutivas.',
    allowedTools: ['*'], // Wildcard — todas las herramientas
    systemAccess: true,
    vaultAccess: true,
    canManageRoles: true,
    globalMetrics: true,
  },

  // ─── ERIS — Usuario Estándar / App Móvil Pública ──────────
  eris: {
    id: 'eris',
    displayName: 'Eris',
    description: 'Perfil público/masivo. Sin acceso a AXS ni al sistema. Solo herramientas de salud y búsqueda web.',
    allowedTools: [
      'web_search',  // búsqueda web general
      'gluco_tracker',       // seguimiento de glucosa
      'nutrition_tracker',   // seguimiento nutricional
      'carb_options',        // convierte gramos de carbos en alimentos concretos
      'metabolic_advisor',   // análisis metabólico + qué comer (respeta restricciones)
      'symptom_guide',       // orientación ante síntomas, según el perfil médico (detecta emergencias)
      'finance_tracker',     // anota gastos/préstamos/giros en SU Finanzas (vive en su teléfono) y resume saldos
      'manage_user_profile', // Control total de perfil de usuario
      'sleep_log',           // horas dormidas de una noche (cuando el reloj no las midió)
      'lab_results',         // exámenes que cuenta el usuario (HbA1c, colesterol…), con fecha
      // AXS explícitamente excluido: knowledge_search, log_management,
      // vault_audit, vault_healer, executive_report, crystallize,
      // file_read, file_write, bash, system_info, open
    ],
    systemAccess: false,
    vaultAccess: false,
    canManageRoles: false,
    globalMetrics: false,
  },
};

// ─── Helpers ────────────────────────────────────────────────

export function getRoleForProfile(
  profileId: string,
  roleMap: Record<string, Role>
): Role {
  // Buscar asignación explícita
  if (roleMap[profileId]) return roleMap[profileId];
  // Por defecto, todos son usuarios estándar
  return 'eris';
}

export function canUseTool(role: RoleDefinition, toolName: string): boolean {
  if (role.allowedTools.includes('*')) return true;
  return role.allowedTools.includes(toolName);
}

export function isIkaros(role: Role): boolean {
  return role === 'ikaros';
}
