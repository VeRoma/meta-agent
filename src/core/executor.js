import { ask, translateToRussianIfEnglish } from './llm.js';
import { parseModelJson } from './json-utils.js';

async function askJson(prompt, tier) {
    // json: 'object' — ai-core проверяет ответ и при мусоре сам переходит к запасной модели
    return parseModelJson(await ask(prompt, { tier, json: 'object' }));
}

/** JSON от исполнителя выбранного уровня; если все модели ответили мусором — ОДНА повторная попытка с подсказкой. */
export async function askForJson(prompt, tier) {
    try {
        return await askJson(prompt, tier);
    } catch (firstError) {
        console.log(`⚠️ Модель вернула невалидный JSON (${firstError.message}). Повторный запрос...`);
        const retryPrompt = `${prompt}\n\nYour previous reply was NOT valid JSON (${firstError.message}). Reply again with ONLY one valid raw JSON object: no markdown, no commentary, all strings properly escaped, and make sure the reply is not truncated.`;
        return askJson(retryPrompt, tier);
    }
}

/** Ответ агента: разобранный JSON, сообщение при необходимости переведено на русский. */
export async function askAgent(prompt, tier) {
    const parsed = await askForJson(prompt, tier);
    if (typeof parsed.message === 'string') parsed.message = await translateToRussianIfEnglish(parsed.message);
    return parsed;
}
