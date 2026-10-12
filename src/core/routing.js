import fs from 'fs';
import path from 'path';
import { askLocalModel } from './llm.js';
import { getSession } from './session.js';

/**
 * Запрашивает у диспетчера список релевантных файлов для задачи
 */
export async function determineRelevantFiles(userQuery, targetPath) {
    console.log('⚡ Диспетчер (Локальная сеть / Gemma 3) анализирует PROJECT_MAP.md...');
    
    const targetAbsolute = path.resolve(process.cwd(), targetPath);
    const mapPath = path.join(targetAbsolute, 'PROJECT_MAP.md');
    
    // 1. Читаем единую карту проекта вместо сотен meta.json
    let projectMapContext = "PROJECT MAP UNAVAILABLE. NO FILES INDEXED.";
    
    if (fs.existsSync(mapPath)) {
        projectMapContext = fs.readFileSync(mapPath, 'utf-8');
    } else {
        console.warn('⚠️ Внимание: PROJECT_MAP.md не найден. Убедитесь, что карта сгенерирована.');
    }

    // 2. Достаем историю текущей сессии
    const sessionContext = getSession();

    // 3. Строгий англоязычный промпт для Диспетчера
    const prompt = `
You are a smart file router for a codebase.
Based on the USER PROMPT and the CURRENT CHAT SESSION, identify which files from the PROJECT MAP need to be analyzed or modified.

PROJECT MAP:
${projectMapContext}

CURRENT CHAT SESSION (Context for the request):
${sessionContext || "No previous context."}

USER PROMPT:
${userQuery}

CRITICAL INSTRUCTIONS:
1. Return ONLY a valid JSON array of strings representing the exact file paths.
2. Only select files that are explicitly listed in the PROJECT MAP.
3. Do not use markdown wrappers like \`\`\`json or add any conversational text.
4. If no files are needed or relevant, return an empty array [].
`;

    try {
        // === ВАЖНО: Вызываем ЛОКАЛЬНУЮ модель (Gemma 3) ===
        const response = await askLocalModel(prompt); 
        
        // Очищаем ответ от возможного маркдауна
        const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
        
        // Дополнительная защита: вытаскиваем только массив, если модель добавила лишний текст
        const arrayMatch = cleanJson.match(/\[.*\]/s);
        const finalJsonString = arrayMatch ? arrayMatch[0] : cleanJson;

        const selectedFiles = JSON.parse(finalJsonString);
        
        if (Array.isArray(selectedFiles)) {
            return selectedFiles;
        }
        return [];
    } catch (error) {
        console.error('❌ Ошибка диспетчера (сбой парсинга JSON или таймаут):', error.message);
        // Возвращаем пустой массив при ошибке, чтобы не переполнять контекст Executor'а
        return []; 
    }
}