// Единственный источник конфигурации Meta-Agent на весь процесс.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Корень агента — от расположения файла, а не от process.cwd():
// агент работает одинаково, откуда бы его ни запустили (терминал, Telegram-бот, тесты).
export const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(AGENT_ROOT, '.env'), quiet: true });

const CONFIG_PATH = path.join(AGENT_ROOT, 'meta.config.json');

function loadConfig() {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (error) {
        throw new Error(`Не удалось прочитать ${CONFIG_PATH}: ${error.message}`);
    }
    parsed.llm ??= {};
    parsed.workspace ??= {};
    parsed.prompts ??= {};
    if (parsed.workspace.targetProject) {
        // Дальше по коду путь всегда абсолютный — не зависит от текущей директории
        parsed.workspace.targetProject = path.resolve(AGENT_ROOT, parsed.workspace.targetProject);
    }
    return parsed;
}

export const config = loadConfig();

/** Меняет целевой проект только в памяти процесса (файл конфига не трогаем). */
export function setTargetProject(targetProject) {
    config.workspace.targetProject = path.resolve(AGENT_ROOT, targetProject);
}
