// ============================================================
// Bootstrap de Roles — Ejecutar una sola vez para configurar
// los roles del sistema Eris.
//
// Uso:   bun run scripts/setup-roles.ts
// ============================================================

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import * as os from 'os';
import * as readline from 'readline';

const ROLES_FILE = join(os.homedir(), '.eris', 'roles.json');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║   ERIS — CONFIGURACIÓN INICIAL DE ROLES   ║');
  console.log('╚═══════════════════════════════════════════╝\n');
  console.log('Roles disponibles:');
  console.log('  🔱 ikaros   → Administrador soberano (VIP, acceso total)');
  console.log('  ⚡ eris     → Usuario estándar (público, app por defecto)\n');

  const assignments: Record<string, string> = {};

  console.log('─── Asignación de Ikaros (Admin) ───');
  const ikarosProfile = await ask('ID del perfil VIP (Ikaros): ');
  if (ikarosProfile.trim()) {
    assignments[ikarosProfile.trim()] = 'ikaros';
    console.log(`  ✅ ${ikarosProfile.trim()} → Ikaros\n`);
  }



  const roleMap = {
    version: 1,
    assignments,
    updatedAt: new Date().toISOString(),
  };

  await mkdir(join(os.homedir(), '.eris'), { recursive: true });
  await writeFile(ROLES_FILE, JSON.stringify(roleMap, null, 2), 'utf-8');

  console.log('\n╔═══════════════════════════════════════════╗');
  console.log('║        CONFIGURACIÓN COMPLETADA ✅         ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log(`\nArchivo de roles: ${ROLES_FILE}`);
  console.log('\nAsignaciones guardadas:');
  for (const [profile, role] of Object.entries(assignments)) {
    const icon = role === 'ikaros' ? '🔱' : '⚡';
    console.log(`  ${icon}  ${profile} → ${role}`);
  }
  console.log('\nReinicia el servidor de Eris para aplicar los cambios.\n');

  rl.close();
}

main().catch(e => {
  console.error('Error:', e);
  rl.close();
  process.exit(1);
});
