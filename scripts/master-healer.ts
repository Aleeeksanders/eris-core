import * as fs from 'fs';
import * as path from 'path';

const VAULT_ROOT = 'C:\\Proyectos\\AXS';

function getAllFiles(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        if (file === '.obsidian' || file === '.git') return;
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
const fileMap = new Map<string, string>(); // name -> relative_path

allFiles.forEach(f => {
    const name = path.basename(f, '.md');
    const relative = path.relative(VAULT_ROOT, f).replace(/\\/g, '/');
    fileMap.set(name, relative);
});

function getTier(relPath: string): string {
    if (relPath.startsWith('00-09')) return 'Directivo';
    if (relPath.startsWith('10-19')) return 'Estratégico';
    if (relPath.startsWith('20-29')) return 'Técnico';
    if (relPath.startsWith('30-39')) return 'Operativo';
    if (relPath.startsWith('40-49')) return 'Operativo';
    if (relPath.startsWith('50-59')) return 'Técnico';
    return 'Por clasificar';
}

// Procesamiento
allFiles.filter(f => f.endsWith('.md')).forEach(filePath => {
    let content = fs.readFileSync(filePath, 'utf8');
    const relPath = path.relative(VAULT_ROOT, filePath).replace(/\\/g, '/');
    const originalContent = content;

    // 1. Inyectar Metadatos (YAML)
    if (!content.trim().startsWith('---')) {
        const tier = getTier(relPath);
        const yaml = `---\nowner: Eris\ntier: ${tier}\nstatus: Activo\n---\n\n`;
        content = yaml + content;
    } else {
        // Asegurar campos si el YAML ya existe pero está incompleto
        if (!content.includes('owner:')) {
            content = content.replace('---', `---\nowner: Eris`);
        }
        if (!content.includes('tier:')) {
            const tier = getTier(relPath);
            content = content.replace('---', `---\ntier: ${tier}`);
        }
    }

    // 2. Sanar Enlaces
    const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    content = content.replace(linkRegex, (match, linkTarget, alias) => {
        const cleanTarget = linkTarget.trim();
        // Si el target es solo el nombre de un archivo que conocemos
        if (fileMap.has(cleanTarget)) {
            const newPath = fileMap.get(cleanTarget);
            return `[[${newPath}${alias ? '|' + alias : ''}]]`;
        }
        return match;
    });

    if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Sanado: ${relPath}`);
    }
});
