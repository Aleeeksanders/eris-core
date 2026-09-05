// ============================================================
// Eris — Contexto del Sistema
// Recolecta información del entorno para el LLM
// ============================================================

import * as os from "os";
import { readFile, access } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";

/**
 * Detecta la ruta real del escritorio del usuario.
 * Maneja OneDrive, rutas redirigidas, y rutas clásicas.
 */
async function detectDesktopPath(): Promise<string> {
  const homeDir = os.homedir();

  // 1. Intentar obtener la ruta del sistema (más confiable)
  if (os.platform() === "win32") {
    try {
      const result = execSync(
        'powershell -NoProfile -Command "[Environment]::GetFolderPath(\'Desktop\')"',
        { encoding: "utf-8", timeout: 3000 }
      ).trim();
      if (result) return result;
    } catch {
      // Fallback si PowerShell falla
    }
  }

  // 2. Probar rutas conocidas con OneDrive
  const candidates = [
    join(homeDir, "OneDrive", "Desktop"),
    join(homeDir, "OneDrive", "Escritorio"),
    join(homeDir, "OneDrive - Personal", "Desktop"),
    join(homeDir, "OneDrive - Personal", "Escritorio"),
    join(homeDir, "Desktop"),
    join(homeDir, "Escritorio"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  // 3. Fallback
  return join(homeDir, "Desktop");
}

/**
 * Detecta la ruta real de Documentos del usuario.
 */
async function detectDocumentsPath(): Promise<string> {
  const homeDir = os.homedir();

  if (os.platform() === "win32") {
    try {
      const result = execSync(
        'powershell -NoProfile -Command "[Environment]::GetFolderPath(\'MyDocuments\')"',
        { encoding: "utf-8", timeout: 3000 }
      ).trim();
      if (result) return result;
    } catch {}
  }

  const candidates = [
    join(homeDir, "OneDrive", "Documents"),
    join(homeDir, "OneDrive", "Documentos"),
    join(homeDir, "Documents"),
    join(homeDir, "Documentos"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return join(homeDir, "Documents");
}

/**
 * Genera el contexto del sistema para incluir en el system prompt.
 * Le da a Eris conocimiento sobre su entorno.
 */
export async function getSystemContext(role?: string): Promise<string> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-ES", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("es-ES");

  if (role !== 'ikaros') {
    return `## Contexto Temporal\n- Fecha: ${dateStr}, ${timeStr}`;
  }
  const platform = os.platform();
  const arch = os.arch();
  const hostname = os.hostname();
  const user = os.userInfo().username;
  const cwd = process.cwd();
  const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
  const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
  const cpuModel = os.cpus()[0]?.model || "Desconocido";
  const cpuCores = os.cpus().length;

  const homeDir = os.homedir();
  const desktopPath = await detectDesktopPath();
  const documentsPath = await detectDocumentsPath();

  return `## Contexto del Sistema
- Fecha: ${dateStr}, ${timeStr}
- SO: ${platform} (${arch})
- Host: ${hostname}
- Usuario: ${user}
- Home: ${homeDir}
- Escritorio: ${desktopPath}
- Documentos: ${documentsPath}
- Directorio actual: ${cwd}
- CPU: ${cpuModel} (${cpuCores} cores)
- RAM: ${freeMem}GB libres de ${totalMem}GB total
- Shell: PowerShell

REGLAS IMPORTANTES:
1. Cuando crees archivos en el escritorio, usa EXACTAMENTE esta ruta: "${desktopPath}"
2. Cuando crees archivos en documentos, usa EXACTAMENTE esta ruta: "${documentsPath}"
3. Usa los datos REALES que devuelven las herramientas. NUNCA inventes números, rutas ni información.
4. Para cualquier ruta del usuario, usa "${homeDir}" como base.`;
}

/**
 * Carga el system prompt desde archivo y le agrega contexto del sistema.
 * @param promptPath Ruta al archivo de system prompt
 * @param userProfile Contexto personalizado del usuario (nombre, objetivos, rol, etc.)
 */
export async function loadSystemPrompt(
  promptPath?: string,
  userProfile?: string,
  role?: string
): Promise<string> {
  const defaultPath = join(
    (import.meta as any).dir || process.cwd(),
    "..",
    "data",
    "system-prompt.md"
  );

  const path = promptPath || defaultPath;

  try {
    let prompt = await readFile(path, "utf-8");
    const context = await getSystemContext(role);

    // Cargar archivos de memoria dinámica y configuración global SÓLO para Hestia
    let erisConfig = "";
    let memoryLayer1 = "";

    if (role === 'ikaros') {
      try {
        erisConfig = await readFile("c:/Proyectos/eris/ERIS.md", "utf-8");
      } catch { }

      try {
        memoryLayer1 = await readFile("c:/Proyectos/AXS/MEMORY.md", "utf-8");
      } catch { }
    }

    const profileBlock = userProfile
      ? `### Perfil del Usuario\n${userProfile}`
      : `### Perfil del Usuario\n*No configurado.*`;

    // Ensamblar el prompt modular
    const dynamicBoundary = `\n\n--- DYNAMIC SESSION CONTEXT ---\n\n`;
    
    // Si la etiqueta antigua sigue ahí, la limpiamos
    prompt = prompt.replace('{{USER_PROFILE_CONTEXT}}', '');

    return `${prompt}\n\n${erisConfig}\n\n${dynamicBoundary}${memoryLayer1}\n\n${profileBlock}\n\n${context}`;
  } catch (e) {
    console.error("Error loading prompt:", e);
    const context = await getSystemContext();
    return `Eres Eris, un sistema de inteligencia operativa personal. Responde en el idioma del usuario.\n\n${context}`;
  }
}
