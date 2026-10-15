import fs from 'fs';
import path from 'path';
import { askModel } from '../core/llm.js';

export async function generateDocumentation(targetPath, sessionContext) {
    if (!sessionContext || sessionContext.trim() === '') {
        console.log('⚠️ Session is empty, nothing to save.');
        return;
    }

    // ПОЛНОСТЬЮ АНГЛОЯЗЫЧНЫЙ ПРОМПТ
    const prompt = `
You are a technical writer and senior developer. Analyze the raw log of a working session between a developer and an AI.
Extract ONLY the final, successful decisions, solutions, and code modifications made to the project.
Completely ignore intermediate errors, non-working code drafts, and casual conversation.

Format the output as a concise, technical summary in a Markdown list (use bullet points, no top-level headers).

CRITICAL INSTRUCTION: Write the final summary STRICTLY IN ENGLISH, following Conventional Commits style where possible (e.g., feat, fix, refactor).

RAW SESSION LOG:
${sessionContext}
`;

    console.log('🤖 Analyzing session and generating documentation (Flash)...');
    
    try {
        // Используем быструю модель (true) для суммаризации текста
        const summary = await askModel(prompt, true);
        
        const historyFilePath = path.join(process.cwd(), targetPath, 'HISTORY.md');
        
        // Формируем красивый блок с датой (в формате YYYY-MM-DD)
        const date = new Date().toISOString().split('T')[0];
        const historyEntry = `\n### [${date}]\n${summary}\n`;

        // Дописываем в конец HISTORY.md (или создаем файл, если его нет)
        fs.appendFileSync(historyFilePath, historyEntry, 'utf-8');
        
        console.log('✅ Final solution successfully written to HISTORY.md!');
    } catch (error) {
        console.error('❌ Error generating documentation:', error.message);
    }
}