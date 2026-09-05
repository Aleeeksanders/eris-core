import fs from "node:fs/promises";
import path from "node:path";

export class VaultService {
  private readonly vaultPath: string;

  constructor(vaultPath?: string) {
    // Permite sobreescribir la ruta mediante variable de entorno, con fallback al default
    this.vaultPath = vaultPath || process.env.AXS_VAULT_PATH || "c:\\Proyectos\\AXS";
  }

  public getVaultPath(): string {
    return this.vaultPath;
  }

  /**
   * Obtiene todos los archivos recursivamente ignorando carpetas internas de git y obsidian
   */
  public async getAllFiles(dir: string = this.vaultPath): Promise<string[]> {
    let results: string[] = [];
    try {
      const list = await fs.readdir(dir);
      for (const file of list) {
        if (file === ".obsidian" || file === ".git" || file === "node_modules") continue;
        const fullPath = path.join(dir, file);
        const stat = await fs.stat(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(await this.getAllFiles(fullPath));
        } else {
          results.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`[VaultService] Error leyendo directorio ${dir}:`, error);
    }
    return results;
  }

  /**
   * Obtiene todos los archivos Markdown de la bóveda
   */
  public async getAllMarkdownFiles(): Promise<string[]> {
    const allFiles = await this.getAllFiles();
    return allFiles.filter(f => f.endsWith(".md"));
  }

  /**
   * Lee un archivo de la bóveda usando una ruta relativa o absoluta
   */
  public async readVaultFile(filePath: string): Promise<string> {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.vaultPath, filePath);
    let content = await fs.readFile(absolutePath, "utf-8");
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }
    return content;
  }

  /**
   * Escribe en un archivo de la bóveda (asegurando que el directorio exista)
   */
  public async writeVaultFile(filePath: string, content: string): Promise<void> {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.vaultPath, filePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf-8");
  }

  /**
   * Verifica si un archivo existe
   */
  public async fileExists(filePath: string): Promise<boolean> {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.vaultPath, filePath);
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Busca texto dentro de los archivos de la bóveda de forma nativa en Node.js
   * @param query El texto a buscar
   * @param limit Límite de resultados a devolver
   * @param directory Directorio específico dentro de la bóveda (opcional)
   */
  public async searchInVault(query: string, limit: number = 15, directory?: string): Promise<string[]> {
    const targetDir = directory ? path.join(this.vaultPath, directory) : this.vaultPath;
    const files = await this.getAllFiles(targetDir);
    const searchFiles = files.filter(f => f.endsWith(".md") || f.endsWith(".ts") || f.endsWith(".tsx"));
    
    const results: string[] = [];
    const lowerQuery = query.toLowerCase();

    for (const file of searchFiles) {
      if (results.length >= limit) break;
      try {
        const content = await fs.readFile(file, "utf-8");
        if (content.toLowerCase().includes(lowerQuery)) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
             if (lines[i].toLowerCase().includes(lowerQuery)) {
               results.push(`${path.relative(this.vaultPath, file)}:${i+1}: ${lines[i].trim()}`);
               if (results.length >= limit) break;
             }
          }
        }
      } catch (err) {
        // Ignorar archivos que no se puedan leer
      }
    }
    return results;
  }
}
