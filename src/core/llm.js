import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import { askLocalModel } from './llm/ollama.js';
import { askDeepSeek } from './llm/deepseek.js';
import { initClaude, askClaude } from './llm/claude.js';

dotenv.config();

const configPath = path.join(process.cwd(), 'meta.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Инициализируем Claude (SDK)
initClaude(process.env.CLAUDE_API_KEY);

export async function askModel(prompt, useDispatcher = false) {
    let targetModel = useDispatcher ? config.llm.dispatcherModel : config.llm.executorModel;
    const systemRole = !useDispatcher && config.prompts?.systemRole ? config.prompts.systemRole : null;

    if (!useDispatcher) {
        const lowerPrompt = prompt.toLowerCase();
        if (lowerPrompt.includes('@7b') || lowerPrompt.includes('используй 7b')) {
            targetModel = 'qwen2.5-coder:7b-instruct';
            console.log('🔄 Переопределение: принудительно выбран Qwen-7B');
        } else if (lowerPrompt.includes('@ds') || lowerPrompt.includes('используй ds') || lowerPrompt.includes('@deepseek')) {
            targetModel = 'deepseek-chat';
            console.log('🔄 Переопределение: принудительно выбран DeepSeek');
        } else if (lowerPrompt.includes('@claude') || lowerPrompt.includes('используй claude')) {
            targetModel = 'claude-sonnet-5-5';
            console.log('🔄 Переопределение: принудительно выбран Claude');
        }
    }

    try {
        if (targetModel.includes('qwen') || targetModel.includes('llama')) {
            return await askLocalModel(prompt, targetModel);
        } else if (targetModel.includes('deepseek')) {
            return await askDeepSeek(prompt, systemRole, targetModel);
        } else if (targetModel.includes('claude')) {
            return await askClaude(prompt, systemRole, targetModel, "high");
        } else {
            throw new Error(`Неизвестное семейство моделей: ${targetModel}`);
        }
    } catch (error) {
        console.error(`\n❌ [ОШИБКА LLM | ${targetModel}]:`, error.message);
        console.warn(`🚨 Переключаюсь на локальный фоллбек...`);
        return await askLocalModel(prompt, config.llm.heavyFallbackModel || "qwen2.5-coder:7b-instruct");
    }
}

export async function translateToEnglish(russianText) {
    const prompt = `Translate to clear technical English. Return ONLY English text, no explanations, no quotes.\n\nText:\n${russianText}`;
    try {
        return await askLocalModel(prompt, config.llm.fallbackModel);
    } catch {
        return russianText; 
    }
}