import fs from 'fs';
import path from 'path';
import { askModel } from './llm.js';

// Функция, которая динамически вычисляет путь к памяти текущего проекта
function getSessionFile() {
    const configPath = path.join(process.cwd(), 'meta.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const targetProjectAbs = path.resolve(process.cwd(), config.workspace.targetProject);
    
    // Меняем папку на .meta-agent для независимой памяти
    const metaAgentDir = path.join(targetProjectAbs, '.meta-agent');
    
    if (!fs.existsSync(metaAgentDir)) {
        fs.mkdirSync(metaAgentDir, { recursive: true });
    }
    
    // Сохраняем как markdown для красивого отображения в Git
    return path.join(metaAgentDir, 'session.md');
}

const MAX_SESSION_LENGTH = 150000;

export function initSession(taskName) {
    const sessionFile = getSessionFile();
    if (fs.existsSync(sessionFile)) {
        const restartNote = `\n\n--- 🔄 СЕРВЕР ПЕРЕЗАПУЩЕН: ${taskName} ---\n`;
        fs.appendFileSync(sessionFile, restartNote, 'utf-8');
        return fs.readFileSync(sessionFile, 'utf-8');
    }

    const initialContent = `# Сессия: ${taskName}\n**Статус:** В работе\n\n## 🔄 Журнал попыток и диалог\n`;
    fs.writeFileSync(sessionFile, initialContent, 'utf-8');
    return initialContent;
}

export function getSession() {
    const sessionFile = getSessionFile();
    if (!fs.existsSync(sessionFile)) return null;
    return fs.readFileSync(sessionFile, 'utf-8');
}

export function appendToSession(role, text) {
    const sessionFile = getSessionFile();
    if (!fs.existsSync(sessionFile)) return;
    
    // Даем Агенту новое имя в логах
    const prefix = role === 'user' ? '\n🧑 **Разработчик:** ' : '\n🤖 **Meta-Agent:** ';
    fs.appendFileSync(sessionFile, `${prefix}${text}\n`, 'utf-8');
}

export function clearSession() {
    const sessionFile = getSessionFile();
    if (fs.existsSync(sessionFile)) {
        fs.unlinkSync(sessionFile);
    }
}

export async function compressSessionIfNeeded() {
    const sessionFile = getSessionFile();
    if (!fs.existsSync(sessionFile)) return;

    const content = fs.readFileSync(sessionFile, 'utf-8');
    if (content.length <= MAX_SESSION_LENGTH) return;

    console.log('\n🧹 Память переполнена. Запускаю быстрое сжатие контекста (Gemini Flash)...');
    
    const prompt = `You are an AI assistant summarizing a development session.
Read the following chat history between a Developer and an AI Agent.
Create a highly concise, structured summary in Russian.
Include:
1. The main goal of the current session.
2. What has been successfully implemented so far.
3. The current unresolved problem or the last action taken.

Keep it strictly factual and under 1500 characters. DO NOT write code blocks.

CHAT HISTORY:
${content}
`;

    try {
        const summary = await askModel(prompt, true);
        const newContent = `# Сжатая сессия\n**Статус:** Контекст был сжат для экономии памяти и защиты от галлюцинаций.\n\n## 📝 Краткое содержание предыдущих действий:\n${summary}\n\n## 🔄 Продолжение диалога:\n`;
        fs.writeFileSync(sessionFile, newContent, 'utf-8');
        console.log('✅ Контекст успешно сжат! Продолжаем работу.');
    } catch (error) {
        console.error('⚠️ Ошибка при сжатии контекста:', error.message);
    }
}