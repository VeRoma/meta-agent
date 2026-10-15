import fs from 'fs';
import path from 'path';

/**
 * Читает содержимое переданных файлов и формирует единый текстовый контекст
 * @param {Array<string>} filePaths Массив путей к файлам
 * @param {string} targetAbsolute Абсолютный путь к корню проекта (чтобы вычислить относительные пути)
 * @returns {string} Текст с содержимым всех файлов
 */
export function readFilesContent(filePaths, targetAbsolute) {
    let context = '';
    for (const filePath of filePaths) {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            
            // Вычисляем путь относительно корня проекта
            const relativePath = targetAbsolute ? path.relative(targetAbsolute, filePath) : path.basename(filePath);
            
            // Заменяем обратные слэши Windows на прямые для единообразия в JSON
            const cleanPath = relativePath.replace(/\\/g, '/');
            
            context += `\n--- Файл: ${cleanPath} ---\n${content}\n`;
        }
    }
    return context;
}