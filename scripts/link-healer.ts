import * as fs from 'fs';
import * as path from 'path';

const VAULT_ROOT = 'C:\\Proyectos\\AXS';

function getAllFiles(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(getAllFiles(file));
        } else {
            results.push(file);
        }
    });
    return results;
}

const allFiles = getAllFiles(VAULT_ROOT);
const fileMap = new Map<string, string>();

allFiles.forEach(f => {
    const name = path.basename(f, '.md');
    // Guardamos la ruta relativa a la raiz de la boveda sin la extensión .md
    const relative = path.relative(VAULT_ROOT, f).replace(/\\/g, '/');
    fileMap.set(name, relative);
});

// Sanación
allFiles.filter(f => f.endsWith('.md')).forEach(filePath => {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;

    // Regex para encontrar [[Link]] o [[Link|Alias]]
    const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

    content = content.replace(linkRegex, (match, linkTarget, alias) => {
        const cleanTarget = linkTarget.trim();
        if (fileMap.has(cleanTarget)) {
            const newPath = fileMap.get(cleanTarget);
            // Si el alias existe lo mantenemos, si no usamos el nombre original
            return `[[${newPath}${alias ? '|' + alias : ''}]]`;
        }
        return match; // No se encontró coincidencia, dejar igual
    });

    if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Sanado: ${path.basename(filePath)}`);
    }
});
