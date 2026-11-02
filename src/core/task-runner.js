import path from 'path';
import { config } from '../config.js';
import { readFilesContent } from '../fs/file-manager.js';
import { applyPatches } from '../fs/patcher.js';
import { runDevServer, stopDevServer } from '../cli/runner.js';
import { appendToSession, getSession, compressSessionIfNeeded } from './session.js';
import { selectContext, extractMentions, resolveMention } from './context.js';
import { buildPrompt } from './prompt.js';
import { askAgent } from './executor.js';
import { runCommands } from './commands.js';
import { runProjectChecks } from './checks.js';
import { confirm, runExclusive } from './io.js';

const MAX_HEALING_ATTEMPTS = 3; // сколько раз агент может исправлять собственные ошибки
const MAX_AUTO_DEPTH = 3;       // сколько раз подряд система сама подгружает файлы по просьбе агента

const TARGET_CRASH_PROMPT = "[SYSTEM ERROR] Целевой процесс упал с ошибкой. Проанализируй лог, найди проблемный файл и сгенерируй патч:";

/** Падение целевого процесса: с согласия разработчика (без терминала — сразу) агент пытается исправить код. */
export async function onTargetCrash(errorLog) {
    const started = await runExclusive(async () => {
        console.log(`\n🚨 ВНИМАНИЕ: Целевой процесс упал с ошибкой!`);
        const approved = await confirm('🔧 Передать лог агенту на авто-исправление? (y/N): ', { whenNoTerminal: true });
        if (!approved) {
            console.log('⏭️ Авто-исправление пропущено.');
            return;
        }
        await processAgentTask(`${TARGET_CRASH_PROMPT}\n\n${String(errorLog).slice(-4000)}`);
        console.log('\n✅ Попытка исправления завершена.');
    });
    if (!started) console.log('\n⚠️ Целевой процесс упал, но агент занят другой задачей — авто-исправление пропущено.');
}

/** Запускает целевой проект под надзором: при падении агент пытается исправить код. */
export function startTargetServer() {
    runDevServer(config.workspace.targetProject, onTargetCrash);
}

export function stopTargetServer() {
    stopDevServer();
}

function restartIfRequested(parsed) {
    if (parsed.restartServer) {
        console.log("\n🔄 Meta-Agent запускает процесс тестирования целевого агента...");
        stopTargetServer();
        startTargetServer();
    }
}

function printPlan(plan) {
    if (!Array.isArray(plan) || plan.length === 0) return;
    console.log(`\n🧠 Meta-Agent's Plan:`);
    plan.forEach(step => console.log(`   🔸 ${step}`));
}

/**
 * Режим «chat»: показать ответ; если агент просит файлы через @ — подгрузить и продолжить.
 * @returns {Promise<boolean>} true, если продолжение выполнено рекурсивным вызовом
 */
async function handleChat(parsed, { allProjectFiles, relevantFiles, depth, tier, options }) {
    console.log(`\n================ AGENT RESPONSE [CHAT] ================`);
    console.log(parsed.message);
    console.log("========================================================\n");
    appendToSession("agent", parsed.message);

    const newFiles = extractMentions(parsed.message || '')
        .map(m => resolveMention(m, allProjectFiles))
        .filter(Boolean)
        .filter(f => !relevantFiles.includes(f));

    if (newFiles.length > 0 && depth < MAX_AUTO_DEPTH) {
        console.log(`\n⚙️ Система мгновенно подтягивает файлы для Meta-Agent (без повторного вызова Оркестратора)...`);
        const autoPrompt = `[SYSTEM] Дополнительно загружены файлы: ${newFiles.map(f => `@${f}`).join(' ')}. Продолжай выполнение исходной задачи (используй mode: "patch", если готов выдать изменения, или заверши отчёт).`;
        // Тот же исполнитель, что выбрал оркестратор: иначе задача для Claude продолжилась бы на DeepSeek
        await processAgentTask(autoPrompt, depth + 1, relevantFiles, { ...options, tier });
        return true;
    }
    if (newFiles.length > 0) {
        console.log(`\n⚠️ Достигнут лимит автоматической подгрузки файлов (${MAX_AUTO_DEPTH}). Уточните запрос или упомяните нужные файлы через @.`);
    }
    restartIfRequested(parsed);
    return false;
}

/**
 * Режим «patch»: применить файлы -> выполнить команды -> проверить код.
 * @returns {Promise<{done: boolean, extraFiles?: string[]}>} done=false — нужен ещё один круг исправления
 */
async function handlePatch(parsed, attempt) {
    console.log(`\n================ AGENT RESPONSE [PATCH] ================`);
    console.log(`💡 ${parsed.message}`);
    console.log("========================================================\n");

    const targetProject = config.workspace.targetProject;
    const toUpdate = parsed.filesToUpdate || [];
    const toDelete = parsed.filesToDelete || [];
    const commandsToRun = parsed.commandsToRun || [];
    const canRetry = attempt < MAX_HEALING_ATTEMPTS;

    if (toUpdate.length === 0 && toDelete.length === 0 && commandsToRun.length === 0) {
        restartIfRequested(parsed);
        return { done: true };
    }

    if (toUpdate.length > 0 || toDelete.length > 0) {
        const patchResult = await applyPatches(targetProject, toUpdate, toDelete);

        if (patchResult.rejected.length > 0) {
            appendToSession("agent", `[PATCH REJECTED]: ${parsed.message}`);
            if (!canRetry) {
                console.log("❌ Не удалось получить корректный патч. Требуется ручное вмешательство.");
                return { done: true };
            }
            const reasons = patchResult.rejected.map(r => `- ${r.path}: ${r.reason}`).join('\n');
            console.log(`⚠️ Патч отклонён защитой. Запрашиваю исправленный вариант (Attempt ${attempt + 1}/${MAX_HEALING_ATTEMPTS})...`);
            appendToSession("user", `[SYSTEM ERROR] Your patch was rejected and NOTHING was written to disk:\n${reasons}\nReturn the COMPLETE content of every file (no placeholders like "rest of code unchanged") using project-relative paths inside the project.`);
            return { done: false };
        }
    }

    if (commandsToRun.length > 0) await runCommands(commandsToRun, targetProject);

    if (toUpdate.length === 0) {
        console.log("✨ Аудит завершен.");
        appendToSession("agent", `[TASK COMPLETED]: ${parsed.message}`);
        restartIfRequested(parsed);
        return { done: true };
    }

    console.log("\n🔍 Запуск проверки кода целевого агента...");
    const check = await runProjectChecks(targetProject, toUpdate);

    if (check.success) {
        console.log("✨ Проверки пройдены. Код чист.");
        appendToSession("agent", `[PATCH APPLIED SUCCESSFULLY]: ${parsed.message}`);
        restartIfRequested(parsed);
        return { done: true };
    }

    if (!canRetry) {
        console.log("❌ Авто-исправление не удалось. Требуется ручное вмешательство.");
        console.log(`\n${check.kind} Output:\n${check.output}\n`);
        appendToSession("agent", `[PATCH APPLIED BUT ${check.kind.toUpperCase()} FAILED]: ${parsed.message}`);
        return { done: true };
    }

    console.log(`⚠️ ${check.kind}: обнаружены ошибки. Запуск модуля исправления...`);
    appendToSession("agent", `[PATCH APPLIED WITH ERRORS]: ${parsed.message}`);
    appendToSession("user", `[SYSTEM ERROR] ${check.kind} failed on the code you just wrote. Fix these errors in "patch" mode:\n\n${check.output}`);
    return { done: false, extraFiles: toUpdate.map(f => path.posix.normalize(String(f.path).replace(/\\/g, '/'))) };
}

/**
 * Главный цикл задачи: оркестратор -> исполнитель -> (чат | патч -> проверки -> самолечение).
 * @param {object} [options] { forceFullAudit, tier } — tier передаётся в рекурсию, чтобы не терять исполнителя
 */
export async function processAgentTask(text, depth = 0, inheritedFiles = [], options = {}) {
    console.log("👁️ Meta-Agent is gathering context...");
    appendToSession("user", text);

    try {
        const ctx = await selectContext(text, { depth, inheritedFiles, ...options });
        let relevantFiles = ctx.relevantFiles;

        if (relevantFiles.length > 0) {
            console.log(`📂 Files selected for audit/modification: ${relevantFiles.length}`);
            relevantFiles.forEach((f) => console.log(`   - ${f}`));
        }

        for (let attempt = 0; attempt <= MAX_HEALING_ATTEMPTS; attempt++) {
            const prompt = buildPrompt({
                targetName: path.basename(config.workspace.targetProject),
                projectMapContent: ctx.projectMapContent,
                filesContext: readFilesContent(relevantFiles, config.workspace.targetProject),
                sessionContext: getSession(),
                task: ctx.task,
                subtask: ctx.subtask,
            });

            console.log(attempt > 0
                ? `🤖 Executor is fixing errors (Attempt ${attempt}/${MAX_HEALING_ATTEMPTS})...`
                : `🤖 Executor (${ctx.tier.toUpperCase()}) is thinking/coding...`);

            const parsed = await askAgent(prompt, ctx.tier);
            printPlan(parsed.plan);

            if (parsed.mode === 'chat') {
                const continued = await handleChat(parsed, {
                    allProjectFiles: ctx.allProjectFiles, relevantFiles, depth, tier: ctx.tier, options,
                });
                if (continued) return; // продолжение выполнил рекурсивный вызов (он сам сожмёт сессию)
                break;
            }

            if (parsed.mode === 'patch') {
                const step = await handlePatch(parsed, attempt);
                if (step.done) break;
                if (step.extraFiles) relevantFiles = [...new Set([...relevantFiles, ...step.extraFiles])];
                continue;
            }

            console.log(parsed.message || "No message provided.");
            appendToSession("agent", JSON.stringify(parsed));
            break;
        }
    } catch (error) {
        console.error("\n❌ Ошибка обработки задачи:", error.message);
    }

    await compressSessionIfNeeded();
}
