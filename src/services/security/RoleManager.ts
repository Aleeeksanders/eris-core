// ============================================================
// RoleManager — Gestor de asignación de roles por perfil
// Solo el perfil Ikaros puede modificar asignaciones
// ============================================================

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import * as os from 'os';
import type { Role } from './RoleSystem.js';

const ROLES_FILE = join(os.homedir(), '.eris', 'roles.json');

interface RoleMap {
  version: number;
  assignments: Record<string, Role>; // profileId → role
  updatedAt: string;
}

class RoleManager {
  private cache: RoleMap | null = null;

  private async load(): Promise<RoleMap> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(ROLES_FILE, 'utf-8');
      this.cache = JSON.parse(raw);
      return this.cache!;
    } catch {
      // Primera vez — crear con asignaciones vacías
      const initial: RoleMap = {
        version: 1,
        assignments: {},
        updatedAt: new Date().toISOString(),
      };
      await this.save(initial);
      this.cache = initial;
      return initial;
    }
  }

  private async save(map: RoleMap): Promise<void> {
    await mkdir(join(os.homedir(), '.eris'), { recursive: true });
    map.updatedAt = new Date().toISOString();
    await writeFile(ROLES_FILE, JSON.stringify(map, null, 2), 'utf-8');
    this.cache = map;
  }

  /**
   * Obtener el rol de un perfil.
   * Si no tiene asignación explícita, retorna 'eris' (usuario estándar).
   */
  async getRole(profileId: string): Promise<Role> {
    if (profileId === 'ikaros') return 'ikaros';
    const map = await this.load();
    return map.assignments[profileId] || 'eris';
  }

  /**
   * Asignar un rol a un perfil.
   * Solo se puede llamar si el solicitante tiene rol 'hestia'.
   */
  async assignRole(profileId: string, role: Role, requestingRole: Role): Promise<void> {
    if (requestingRole !== 'ikaros') {
      throw new Error('Permiso denegado: solo Ikaros puede gestionar roles.');
    }
    const map = await this.load();
    map.assignments[profileId] = role;
    await this.save(map);
  }

  /**
   * Listar todas las asignaciones (solo para Hestia).
   */
  async listAssignments(requestingRole: Role): Promise<Record<string, Role>> {
    if (requestingRole !== 'ikaros') {
      throw new Error('Permiso denegado: solo Ikaros puede ver los roles.');
    }
    const map = await this.load();
    return map.assignments;
  }

  /**
   * Revocar el rol de un perfil (vuelve a 'eris').
   */
  async revokeRole(profileId: string, requestingRole: Role): Promise<void> {
    if (requestingRole !== 'ikaros') {
      throw new Error('Permiso denegado: solo Ikaros puede revocar roles.');
    }
    const map = await this.load();
    delete map.assignments[profileId];
    await this.save(map);
  }

  /**
   * Bootstrap del perfil Ikaros al arrancar el servidor.
   * No requiere autenticación — se llama solo en startup desde el proceso servidor.
   * Garantiza que el ID reservado siempre tenga rol ikaros en roles.json.
   */
  async bootstrapIkaros(profileId: string): Promise<void> {
    const map = await this.load();
    map.assignments[profileId] = 'ikaros';
    await this.save(map);
  }

  /** Invalidar caché para forzar recarga */
  invalidate() {
    this.cache = null;
  }
}

export const roleManager = new RoleManager();
