import fs from 'fs';
import path from 'path';
import { resolveInside, isSecretPath } from './safe-path.js';

/**
 * Читает содержимое переданных файлов и формирует единый текстовый контекст.
 * Принимает и относительные (из PROJECT_MAP.md), и абсолютные пути; относительные
 * разрешаются от корня ЦЕЛЕВОГО проекта, а не от текущей рабочей директории.
 * @param {Array<string>} filePaths Массив путей к файлам
 * @param {string} targetAbsolute Абсолютный путь к корню проекта
 * @returns {string} Текст с содержимым всех файлов
 */
export function readFilesContent(filePaths, targetAbsolute) {
    const root = path.resolve(targetAbsolute || process.cwd());
    const seen = new Set();
    let context = '';

    for (const filePath of filePaths) {
        const candidate = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);

        let absolutePath;
        try {
            absolutePath = resolveInside(root, path.relative(root, candidate));
        } catch {
            console.log(`⚠️ Пропускаю файл вне проекта: ${filePath}`);
            continue;
        }

        if (seen.has(absolutePath)) continue; // один и тот же файл мог прийти и как относительный, и как абсолютный
        seen.add(absolutePath);

        // Единообразные прямые слэши (Windows -> POSIX) для JSON и промптов
        const cleanPath = path.relative(root, absolutePath).replace(/\\/g, '/');

        if (isSecretPath(cleanPath)) {
            console.log(`🔒 Файл с секретами не отправляется в LLM: ${cleanPath}`);
            continue;
        }

        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;

        const content = fs.readFileSync(absolutePath, 'utf-8');
        context += `\n--- Файл: ${cleanPath} ---\n${content}\n`;
    }
    return context;
}
