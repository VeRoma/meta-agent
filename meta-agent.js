import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const configPath = path.join(process.cwd(), 'meta.config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e) {
    console.error("❌ Ошибка чтения meta.config.json");
    process.exit(1);
}

console.log('\n========================================');
console.log('👁️ META-AGENT CLI - УПРАВЛЯЮЩИЙ ЦЕНТР');
console.log('========================================\n');

async function initMetaAgent() {
    // Берем целевой проект строго из конфига (там сейчас "../dev-agent")
    const targetPath = config.workspace.targetProject; 
    
    if (!targetPath) {
        console.error("❌ В agent.config.json не указан targetProject!");
        process.exit(1);
    }

    const absoluteTargetPath = path.resolve(process.cwd(), targetPath);
    
    if (!fs.existsSync(absoluteTargetPath)) {
        console.error(`❌ Целевой проект не найден по пути: ${absoluteTargetPath}`);
        process.exit(1);
    }

    // Папка для памяти самого Meta-Agent (чтобы не конфликтовать с логами dev-agent)
    const metaAgentDir = path.join(absoluteTargetPath, '.meta-agent');

    // Проверяем, работал ли Meta-Agent с этим проектом раньше
    if (!fs.existsSync(metaAgentDir)) {
        console.log(`\n✨ Инициализация надзора за проектом: ${path.basename(targetPath)}`);
        fs.mkdirSync(metaAgentDir, { recursive: true });
        
        console.log('📚 Подготавливаю аналитический контекст...');
        try {
            const { generateIndexes } = await import('./src/fs/docs-generator.js');
            await generateIndexes(targetPath);
            console.log('✅ Первичная индексация завершена!');
        } catch(e) {
            console.log('⚠️ Модуль авто-индексации пока не подключен. Пропускаю.');
        }
    } else {
        console.log(`\n🔄 Загружаю аналитическую базу проекта: ${path.basename(targetPath)}`);
    }

    // Передаем управление в Chat Loop
    const { startCLI } = await import('./src/cli/chat.js');
    
    // Оставляем ТЗ для Telegram-бота (если захочешь управлять Надзирателем с телефона)
    const taskFilePath = path.join(process.cwd(), 'meta_task.txt');
    if (fs.existsSync(taskFilePath)) {
        const taskText = fs.readFileSync(taskFilePath, 'utf-8').trim();
        if (taskText) {
            console.log('📥 Обнаружена директива от Telegram-бота! Передаю Meta-Agent...');
            fs.unlinkSync(taskFilePath); 
            startCLI(taskText); 
            return;
        }
    }

    // Запуск обычного ручного режима
    startCLI();
}

initMetaAgent();