import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const OUTPUT_LIMIT = 2000; // не взрываем контекст ИИ длинными логами

const ESLINT_CONFIGS = [
    'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
    'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
    '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
];

/**
 * Запускает JS-скрипт инструмента через текущий node БЕЗ shell:
 * имена файлов от модели передаются аргументами и не могут стать командой.
 */
function runNodeScript(script, args, cwd) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [script, ...args], { cwd });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.on('error', (error) => resolve({ code: -1, output: error.message }));
        child.on('close', (code) => resolve({ code: code ?? -1, output }));
    });
}

function truncate(text) {
    return text.length > OUTPUT_LIMIT ? text.slice(0, OUTPUT_LIMIT) + '\n... [TRUNCATED]' : text;
}

function hasEslintConfig(cwd) {
    if (ESLINT_CONFIGS.some(name => fs.existsSync(path.join(cwd, name)))) return true;
    try {
        return Boolean(JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')).eslintConfig);
    } catch {
        return false;
    }
}

/**
 * Двухэтапная проверка изменённых файлов: ESLint -> TypeScript.
 * Отсутствие инструментов или их конфигов — предупреждение, а не «ошибка кода»:
 * иначе агент начинает «чинить» код, в котором ничего не сломано.
 * @returns {Promise<{success: boolean, error?: string, warnings: string[]}>}
 */
export async function runLinter(targetProject, filesToUpdate) {
    const warnings = [];
    const cwd = path.resolve(process.cwd(), targetProject);
    const jsFiles = filesToUpdate
        .filter(f => /\.(c|m)?(js|jsx|ts|tsx)$/.test(f.path))
        .map(f => path.resolve(cwd, f.path)); // абсолютный путь не может начинаться с "-" (не станет опцией)

    if (jsFiles.length === 0) return { success: true, warnings };

    // --- ЭТАП 1: ESLint ---
    const eslintBin = path.join(cwd, 'node_modules', 'eslint', 'bin', 'eslint.js');
    if (!fs.existsSync(eslintBin)) {
        warnings.push('ESLint не установлен в целевом проекте — линтер пропущен');
    } else if (!hasEslintConfig(cwd)) {
        warnings.push('нет конфига ESLint в целевом проекте — линтер пропущен');
    } else {
        const eslint = await runNodeScript(eslintBin, ['--max-warnings=0', ...jsFiles], cwd);
        // shortcut: код 1 — ошибки в коде; 2 и прочие — сбой самого ESLint (конфиг, плагины)
        if (eslint.code === 1) {
            return { success: false, error: `[ESLint Error]:\n${truncate(eslint.output)}`, warnings };
        }
        if (eslint.code !== 0) {
            warnings.push(`ESLint завершился с кодом ${eslint.code} (сбой конфигурации, не ошибка кода): ${truncate(eslint.output).split('\n')[0]}`);
        }
    }

    // --- ЭТАП 2: TypeScript (только если в проекте есть tsconfig и сам tsc) ---
    if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
        const tscBin = path.join(cwd, 'node_modules', 'typescript', 'bin', 'tsc');
        if (!fs.existsSync(tscBin)) {
            warnings.push('есть tsconfig.json, но TypeScript не установлен — проверка типов пропущена');
        } else {
            const tsc = await runNodeScript(tscBin, ['--noEmit'], cwd);
            if (tsc.code !== 0) {
                return { success: false, error: `[TypeScript Error]:\n${truncate(tsc.output)}`, warnings };
            }
        }
    }

    return { success: true, warnings };
}
