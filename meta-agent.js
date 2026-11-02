import fs from 'fs';
import path from 'path';
import { listAvailableModels, pickProvider } from '@veroma/ai-core';
import { acquireProjectLock } from '@veroma/ai-core/lock';

let config;
try {
    ({ config } = await import('./src/config.js'));
} catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
}

console.log('\n========================================');
console.log('👁️ META-AGENT CLI - УПРАВЛЯЮЩИЙ ЦЕНТР');
console.log('========================================\n');

/**
 * Показывает, доступны ли модели из meta.config.json. Ничего не подменяет:
 * единственный источник выбора моделей — конфиг.
 * 🟢 модель есть у провайдера, 🟡 провайдер отвечает, но такой модели нет, 🔴 провайдер недоступен.
 */
async function reportModels(llm) {
    const tiers = llm.tiers ?? {};
    const roles = [
        ['Оркестратор', llm.orchestratorModel ?? tiers.pro],
        ['Локальная (local)', tiers.local],
        ['Исполнитель (fast)', tiers.fast],
        ['Хирург (pro)', tiers.pro],
        ['Архитектор (arch)', tiers.arch],
        ...(llm.cloudFallbacks ?? []).map(m => ['Запасная', m]),
    ].filter(([, model]) => model);

    const available = await listAvailableModels();

    console.log('🧠 Модели из meta.config.json:');
    for (const [role, model] of roles) {
        const provider = pickProvider(model, llm.defaultProvider);
        const status = available[provider];
        let mark;
        if (!status) mark = '🔴 неизвестный провайдер';
        else if (status.error) mark = `🔴 ${provider}: ${status.error}`;
        else if (status.models.includes(model)) mark = '🟢';
        else mark = `🟡 у ${provider} нет такой модели`;
        console.log(`   • ${role.padEnd(19)}: ${model} ${mark}`);
    }
}

async function initMetaAgent() {
    await reportModels(config.llm);

    const absoluteTargetPath = config.workspace.targetProject;
    if (!absoluteTargetPath) {
        console.error("❌ В meta.config.json не указан targetProject!");
        process.exit(1);
    }
    if (!fs.existsSync(absoluteTargetPath)) {
        console.error(`❌ Целевой проект не найден по пути: ${absoluteTargetPath}`);
        process.exit(1);
    }

    // Папка для памяти самого Meta-Agent (чтобы не конфликтовать с логами dev-agent)
    const metaAgentDir = path.join(absoluteTargetPath, '.meta-agent');
    const projectName = path.basename(absoluteTargetPath);
    const { buildProjectMap } = await import('./src/fs/map-builder.js');
    const isFirstRun = !fs.existsSync(metaAgentDir);

    const lock = acquireProjectLock(metaAgentDir);
    if (!lock.ok) {
        console.error(`❌ С проектом ${projectName} уже работает другой Meta-Agent (pid ${lock.pid}). Дождитесь его завершения.`);
        process.exit(1);
    }

    if (isFirstRun) {
        console.log(`\n✨ Инициализация надзора за проектом: ${projectName}`);

        console.log('📚 Подготавливаю аналитический контекст...');
        try {
            buildProjectMap(absoluteTargetPath);
            console.log('✅ Первичная индексация завершена!');
        } catch (e) {
            console.log(`⚠️ Не удалось построить карту проекта: ${e.message}`);
        }
    } else {
        console.log(`\n🔄 Загружаю аналитическую базу проекта: ${projectName}`);
        // Карта могла быть удалена вручную — без неё оркестратор слеп
        if (!fs.existsSync(path.join(absoluteTargetPath, 'PROJECT_MAP.md'))) {
            console.log('🗺️ PROJECT_MAP.md не найден, строю заново...');
            try { buildProjectMap(absoluteTargetPath); } catch (e) { console.log(`⚠️ ${e.message}`); }
        }
    }

    // Передаем управление в Chat Loop
    const { startCLI } = await import('./src/cli/chat.js');

    // Задача от Telegram-бота приходит в окружении только этого процесса:
    // ручной запуск никогда не подхватит чужую задачу
    const taskText = process.env.META_TASK?.trim();
    if (taskText) {
        console.log('📥 Обнаружена директива от Telegram-бота! Передаю Meta-Agent...');
        startCLI(taskText);
        return;
    }

    // Запуск обычного ручного режима
    startCLI();
}

initMetaAgent();
