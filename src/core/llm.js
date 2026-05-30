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
 * Временно отключаем нестабильную локальную модель (Ollama)
 * и принудительно используем безотказного облачного Диспетчера (Flash)
 */
export async function askLocalModel(prompt) {
    return await askModel(prompt, true);
}