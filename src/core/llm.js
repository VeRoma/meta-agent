import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const configPath = path.join(process.cwd(), 'agent.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const executorModel = genAI.getGenerativeModel({ 
    model: config.llm.executorModel,
    systemInstruction: config.prompts ? config.prompts.systemRole : "You are an AI assistant."
});

const dispatcherModel = genAI.getGenerativeModel({ 
    model: config.llm.dispatcherModel 
});

/**
 * Отправляет запрос к облачной LLM (Gemini)
 */
export async function askModel(prompt, useDispatcher = false) {
    const model = useDispatcher ? dispatcherModel : executorModel;
    
    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error('\n❌ Ошибка API Gemini:', error.message);
        throw error;
    }
}

/**
 * Отправляет запрос к ЛОКАЛЬНОЙ модели через Ollama
 * Если Ollama недоступна, бесшовно переключается на облачного Диспетчера (Flash)
 */
export async function askLocalModel(prompt) {
    const localModelName = config.llm.localModel || 'gemma3:4b';
    
    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: localModelName,
                prompt: prompt,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.response;
        
    } catch (error) {
        console.log(`\n⚠️ Локальная модель недоступна (${error.message}). Переключаюсь на облако (Flash)...`);
        return await askModel(prompt, true);
    }
}