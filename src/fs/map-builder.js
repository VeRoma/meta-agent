import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; // Добавили специальный конвертер путей

// Игнорируем тяжелые и служебные папки/файлы
const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', 'meta-bot'];
const IGNORE_FILES = ['.env', 'package-lock.json', 'package.json', '.meta_prompt.tmp', '.gitignore', '.metaignore'];

// Очистка JSDoc комментариев от звездочек и переносов строк
// Очистка JSDoc: убираем звездочки, отсекаем @param/@returns и БЛОКИРУЕМ РУССКИЙ ЯЗЫК
function cleanJSDoc(rawComment) {
    if (!rawComment) return '';
    const cleaned = rawComment
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, '').trim()) // Убираем начальные звездочки
        .filter(line => line.length > 0 && !line.startsWith('@')) // Убиваем @param и @returns
        .join(' - '); 

    // Если находим хоть одну русскую букву — возвращаем пустую строку
    if (/[а-яА-ЯЁё]/.test(cleaned)) {
        return ''; 
    }

    return cleaned;
}

// Рекурсивный обход директорий
function walkDirectory(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        if (IGNORE_DIRS.includes(file) || IGNORE_FILES.includes(file)) continue;

        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            walkDirectory(filePath, fileList);
        } else if (file.endsWith('.js')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

// Анализ файла на наличие экспортов и JSDoc
function analyzeFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const nodes = [];

    // Ищет JSDoc перед экпортами функций, констант и классов
    const exportRegex = /(?:\/\*\*([\s\S]*?)\*\/\s*)?export\s+(async\s+)?(function|const|class)\s+([a-zA-Z0-9_]+)/g;
    let match;

    while ((match = exportRegex.exec(content)) !== null) {
        const rawComment = match[1];
        const isAsync = match[2] ? 'async ' : '';
        const nodeType = match[3]; 
        const nodeName = match[4]; 

        const description = cleanJSDoc(rawComment);
        
        let nodeString = `- **${nodeName}** (${isAsync}${nodeType})`;
        if (description) {
            nodeString += `: ${description}`;
        }
        
        nodes.push(nodeString);
    }

    return nodes;
}

// Главная функция сборки
export function buildProjectMap() {
    const rootDir = process.cwd();
    const jsFiles = walkDirectory(rootDir);
    
    let markdown = `# META-AGENT Project Map\n\n`;
    markdown += `> This map contains the structural overview of exported modules to help the LLM navigate the codebase efficiently.\n\n`;

    for (const file of jsFiles) {
        const relativePath = path.relative(rootDir, file).replace(/\\/g, '/');
        const nodes = analyzeFile(file);

        markdown += `### 📄 ${relativePath}\n`;
        if (nodes.length > 0) {
            markdown += nodes.join('\n') + '\n\n';
        } else {
            markdown += `- (Internal logic / No exported modules)\n\n`;
        }
    }

    const outputPath = path.join(rootDir, 'PROJECT_MAP.md');
    fs.writeFileSync(outputPath, markdown);
    console.log(`✅ Project map successfully generated at ${outputPath}`);
}

// Правильная проверка для Windows
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    buildProjectMap();
}