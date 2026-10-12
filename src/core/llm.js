import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const configPath = path.join(process.cwd(), 'meta.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const executorModel = genAI.getGenerativeModel({ 
    model: config.llm.executorModel,
    systemInstruction: config.prompts ? config.prompts.systemRole : "You are an AI assistant."
});

const dispatcherModel = genAI.getGenerativeModel({ 
    model: config.llm.dispatcherModel 
});

// Настройки локального сервера Ollama
const OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/api/generate';
const LOCAL_MODEL = config.llm.fallbackModel; 

/**
 * Отправляет запрос к облачной LLM (Gemini) с автоматическим фоллбэком на Ollama
 */
export async function askModel(prompt, useDispatcher = false) {
    const model = useDispatcher ? dispatcherModel : executorModel;
    
    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        const errorMessage = error.message.toLowerCase();
        
        // Если ловим 429 (лимиты) или ошибки нагрузки — переключаемся на локалку
        if (error.status === 429 || errorMessage.includes('429') || errorMessage.includes('resource_exhausted') || errorMessage.includes('overloaded')) {
            console.warn(`\n⚠️ [Meta-Agent] Облако Gemini недоступно (Rate Limit). Переключаюсь на локальную модель ${LOCAL_MODEL}...`);
            return await askLocalModel(prompt);
        }
        
        console.error('\n❌ Ошибка API Gemini:', error.message);
        throw error; // Если ошибка не связана с лимитами (например, неверный API ключ), выбрасываем её дальше
    }
}

/**
 * Прямой запрос к рабочей локальной модели через Ollama
 */
export async function askLocalModel(prompt) {
    try {
        console.log(`[Meta-Agent] Отправка запроса в Ollama (${LOCAL_MODEL})...`);
        
        const response = await fetch(OLLAMA_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: LOCAL_MODEL,
                prompt: prompt,
                stream: false,
                options: {
                    num_ctx: 8192 // Увеличиваем контекст до 8192 токенов
                }
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP статус ${response.status}`);
        }

        const data = await response.json();
        return data.response || '';
        
    } catch (error) {
        console.error('\n❌ Ошибка локальной модели Ollama:', error.message);
        throw new Error(`Критический сбой: Облако недоступно, а локальная модель вернула ошибку (${error.message})`);
    }
}