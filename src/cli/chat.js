import readline from "readline";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { buildProjectMap } from '../fs/map-builder.js';

import { readFilesContent } from "../fs/file-manager.js";
import {
    initSession,
    appendToSession,
    getSession,
    clearSession,
    compressSessionIfNeeded,
} from "../core/session.js";
import { askModel, translateToEnglish } from "../core/llm.js";
import { askLocalModel } from "../core/llm/ollama.js";
import { determineRelevantFiles } from "../core/routing.js";
import { generateDocumentation } from '../fs/docs-generator.js';
import { applyPatches, abortSessionPatches, clearSessionBackups, applyRedoPatches } from '../fs/patcher.js';
import { runLinter } from '../core/linter.js';
import { runTests } from '../core/tester.js';
import { classifyCommand } from '../core/command-guard.js';
import { parseModelJson } from '../core/json-utils.js';
import { runDevServer, stopDevServer } from './runner.js';

const configPath = path.join(process.cwd(), "meta.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const MAX_AUTO_DEPTH = 3;
const MODEL_TAGS = new Set(['7b', 'ds', 'deepseek', 'claude']);

function askConfirm(question) {
    if (!process.stdin.isTTY) {
        console.log('⛔ Нет интерактивного терминала — действие отклонено автоматически.');
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(/^(y|yes|д|да)$/i.test(answer.trim())));
    });
}

function extractMentions(text) {
    return [...String(text).matchAll(/(?<![\w.])@([a-zA-Z0-9_.\-\/]+)/g)]
        .map(m => m[1].replace(/[.,;:]+$/, ''))
        .filter(m => m && !MODEL_TAGS.has(m.toLowerCase()));
}

function resolveMention(mention, allProjectFiles) {
    const cleanMention = mention.replace(/^(\.\.\/)+/, '').replace(/^[a-zA-Z0-9_-]+\//, (match) => {
        // Если упомянули @dev-agent/src/..., пробуем также путь внутри целевого проекта
        return match;
    });

    return allProjectFiles.find(f => {
        const normalizedPath = f.replace(/\\/g, '/');
        const base = path.basename(normalizedPath);
        const nameWithoutExt = base.replace(/\.[^/.]+$/, "");
        return (
            base === mention ||
            nameWithoutExt === mention ||
            normalizedPath === mention ||
            normalizedPath.endsWith(mention) ||
            normalizedPath.endsWith(cleanMention)
        );
    });
}

async function askForJson(prompt) {
    const raw = await askModel(prompt, false);
    try {
        return parseModelJson(raw);
    } catch (firstError) {
        console.log(`⚠️ Модель вернула невалидный JSON (${firstError.message}). Повторный запрос...`);
        const retryPrompt = `${prompt}\n\nYour previous reply was NOT valid JSON (${firstError.message}). Reply again with ONLY one valid raw JSON object: no markdown, no commentary, all strings properly escaped, and make sure the reply is not truncated.`;
        const retryRaw = await askModel(retryPrompt, false);
        return parseModelJson(retryRaw);
    }
}

let autoFixInProgress = false;

function makeTargetErrorHandler(promptPrefix) {
    return async (errorLog) => {
        if (autoFixInProgress) return;
        autoFixInProgress = true;
        try {
            console.log(`\n🚨 ВНИМАНИЕ: Целевой процесс упал с ошибкой! Передаю на авто-исправление...`);
            await processAgentTask(`${promptPrefix}\n\n${String(errorLog).slice(-4000)}`);
            console.log('\n✅ Попытка исправления завершена.');
        } finally {
            autoFixInProgress = false;
            rl.prompt();
        }
    };
}

const TARGET_CRASH_PROMPT = "[SYSTEM ERROR] Целевой процесс упал с ошибкой. Проанализируй лог, найди проблемный файл и сгенерируй патч:";

export async function startCLI(initialTask = null) {
    console.log(`\n🚀 Meta-Agent CLI initialized!`);
    console.log(`🧠 Executor: ${config.llm.executorModel}`);
    console.log(`🎯 Target Project: ${config.workspace.targetProject}`);

    initSession("Meta-Agent Operation (General)");

    if (initialTask) {
        console.log("📥 Обрабатываю внешнюю задачу...\n");
        await processAgentTask(initialTask);
        process.exit(0);
    } else {
        chatLoop();
    }
}

async function handleCommand(command) {
    const cmdLower = command.trim().toLowerCase();

    if (cmdLower === '/audit' || cmdLower.startsWith('/audit ')) {
        const customAuditTask = command.trim().slice(6).trim();
        const auditPrompt = customAuditTask ||
            "Проведи полный архитектурный и security-аудит целевого проекта. Найди мёртвые файлы ([ORPHAN]), сломанные импорты ([BROKEN IMPORT]), несовместимость модулей ([CJS IN ESM]), дыры в безопасности и рассинхрон логики. Выдай подробный структурный отчёт.";
        console.log("\n🔭 Запуск глубокого аудита всего проекта (Full Project Audit)...");
        buildProjectMap();
        await processAgentTask(auditPrompt, 0, [], { forceFullAudit: true });
        return;
    }

    switch (cmdLower) {
        case '/save': {
            console.log('\n💾 Starting save process...');
            const currentSession = getSession();
            await generateDocumentation(config.workspace.targetProject, currentSession);

            clearSession();
            clearSessionBackups();
            initSession('New audit task (waiting...)');
            console.log('🧹 Temporary session and backups cleared. Ready for a new task!');
            break;
        }

        case "/index":
            console.log("\n🗺️ Генерация умной карты проекта (мгновенно, без LLM)...");
            buildProjectMap();
            break;

        case "/abort":
            console.log("\n🗑️ Aborting current task...");
            await abortSessionPatches(config.workspace.targetProject);
            clearSession();
            initSession('Task aborted (waiting...)');
            console.log("🛑 Task aborted. AI memory erased. Files reverted.");
            break;

        case "/redo": {
            console.log("\n🔄 Restoring aborted task...");
            const isRedone = await applyRedoPatches(config.workspace.targetProject);
            if (isRedone) {
                console.log("⏩ Task restored. AI memory reloaded. Files reverted to modified state.");
            }
            break;
        }

        case "/clear":
            clearSession();
            initSession('Context cleared');
            console.log("\n🧹 AI memory cleared. Let's start a fresh topic!");
            break;

        case "/push":
            console.log("\n🚀 Preparing release...");
            console.log("   [To be implemented: generate commit message -> git add, commit, push]");
            break;

        default:
            console.log("\n⚠️ Unknown command. Available: /audit, /run, /stop, /save, /index, /abort, /redo, /clear, /editor, /push");
    }
}

async function runProjectChecks(toUpdate) {
    const lintResult = await runLinter(config.workspace.targetProject, toUpdate);
    (lintResult.warnings || []).forEach(w => console.log(`⚠️ ${w}`));

    if (!lintResult.success) {
        return { success: false, kind: 'Linter', output: lintResult.error };
    }

    console.log("✅ Линтер: ошибок кода нет. Запуск юнит-тестов...");
    const testResult = await runTests(config.workspace.targetProject);
    (testResult.warnings || []).forEach(w => console.log(`⚠️ ${w}`));

    if (!testResult.success) {
        return { success: false, kind: 'Tests', output: testResult.output };
    }
    return { success: true };
}

export async function processAgentTask(text, depth = 0, inheritedFiles = [], options = {}) {
    console.log("👁️ Meta-Agent is gathering context...");
    appendToSession("user", text);

    try {
        const targetAbsolute = path.resolve(process.cwd(), config.workspace.targetProject);
        const mapPath = path.join(targetAbsolute, 'PROJECT_MAP.md');

        // Если карты ещё нет — создаём её автоматически
        if (!fs.existsSync(mapPath)) {
            buildProjectMap();
        }

        let projectMapContent = "PROJECT MAP UNAVAILABLE.";
        let allProjectFiles = [];

        if (fs.existsSync(mapPath)) {
            projectMapContent = fs.readFileSync(mapPath, 'utf-8');
            allProjectFiles = projectMapContent
                .split('\n')
                .filter(line => line.startsWith('### 📄 '))
                .map(line => line.replace('### 📄 ', '').trim());
        }

        const mentions = extractMentions(text);
        const forcedFiles = [];

        for (const mention of mentions) {
            const matched = resolveMention(mention, allProjectFiles);
            if (matched) {
                forcedFiles.push(matched);
                console.log(`📌 Explicitly included: ${matched}`);
            } else {
                console.log(`⚠️ Mentioned file not found in PROJECT_MAP: ${mention}`);
            }
        }

        // 1. Переводим пользовательский запрос на английский ОДИН раз (только на 0-м уровне глубины)
        let translatedTask = text;
        if (depth === 0 && !text.startsWith('[SYSTEM')) {
            console.log('🌐 Перевод задачи на технический английский (Qwen-7B)...');
            translatedTask = await translateToEnglish(text);
        }

        // 2. Определяем список файлов:
        // Если это авто-дозагрузка (@файлов) на depth > 0, НЕ вызываем Диспетчер повторно!
        let relevantFiles = [];
        if (depth > 0) {
            console.log('⚡ Пропуск Диспетчера: используем накопленный контекст + запрошенные @файлы.');
            relevantFiles = [...new Set([...inheritedFiles, ...forcedFiles])];
        } else {
            const routedFiles = await determineRelevantFiles(text, config.workspace.targetProject, {
                preTranslatedQuery: translatedTask,
                forceFullAudit: Boolean(options.forceFullAudit)
            });
            relevantFiles = [...new Set([...inheritedFiles, ...forcedFiles, ...routedFiles])];
        }

        if (relevantFiles.length > 0) {
            console.log(`📂 Files selected for audit/modification: ${relevantFiles.length}`);
            relevantFiles.forEach((f) => console.log(`   - ${f}`));
        }

        let healingAttempts = 0;
        const maxHealingAttempts = 3;

        while (healingAttempts <= maxHealingAttempts) {
            const filesContext = readFilesContent(relevantFiles, targetAbsolute);
            const sessionContext = getSession();

            const systemRole = config.prompts ? config.prompts.systemRole : "You are Meta-Agent, an autonomous AI Overseer.";

            const prompt = `
PROJECT MAP & DEPENDENCY GRAPH (Architectural Overview for ${config.workspace.targetProject}):${projectMapContent}

CODE CONTEXT (Files loaded for this task):
${filesContext || "No files loaded yet."}

CURRENT SESSION HISTORY:
${sessionContext}

LATEST DEVELOPER TASK (English Technical Translation):
${translatedTask}

CRITICAL INSTRUCTIONS (READ CAREFULLY):
1. ${systemRole}
2. You MUST respond ONLY with a valid JSON object. Do not use markdown wrappers like \`\`\`json.
3. AUTONOMOUS FILE READING: If you need to inspect a file listed in PROJECT_MAP that is not in CODE CONTEXT, use "chat" mode and mention the file with an @ prefix (e.g., "@src/cli/chat.js" or "@package.json"). The system will immediately fetch it without losing current files.
4. STATIC HEALTH FLAGS: Pay close attention to ⚠️ [ORPHAN], ⚠️ [BROKEN IMPORT], and ⚠️ [CJS IN ESM] markers in PROJECT_MAP.
5. THE "DO NO HARM" RULE: Preserve original formatting, logic, and comments when patching active modules. DO NOT modify files in the .meta-agent directory.
6. TERMINAL AUTONOMY: Only simple commands (npm install, npm test, git status/diff/add/commit) run automatically; anything else needs the developer's confirmation.
7. SERVER MANAGEMENT: Set "restartServer": true to autonomously restart the target project's server.
8. The "plan" and "message" fields MUST be written in natural Russian.
9. FULL FILES ONLY: every "content" in "filesToUpdate" must be the COMPLETE file. Never use placeholders such as "// ... rest of the code unchanged" — such patches are rejected. Use project-relative paths only.

Expected JSON format:
{
  "mode": "chat" | "patch",
  "plan": [
    "1. Анализирую архитектуру целевого агента...",
    "2. Пишу безопасный патч для файла..."
  ],
  "message": "Detailed response (for chat) OR short action summary (for patch) in Russian.",
  "filesToUpdate": [
    {
      "path": "src/core/example.js",
      "content": "// ... entire file content here ..."
    }
  ],
  "filesToDelete": [
    {
      "path": "src/old_file.js"
    }
  ],
  "commandsToRun": [
    "npm install"
  ],
  "restartServer": false
}

Answer the developer's last message:
`;

            console.log(healingAttempts > 0 ? `🤖 Executor is fixing errors (Attempt ${healingAttempts}/${maxHealingAttempts})...` : "🤖 Executor (Pro) is thinking/coding...");

            const parsedResponse = await askForJson(prompt);

            if (parsedResponse.message && /^[A-Za-z0-9\s.,!?;:'"()-]+$/.test(parsedResponse.message.slice(0, 50))) {
                try {
                    const fallbackModel = config.llm.dispatcherModel || "qwen2.5-coder:7b-instruct";
                    const translationPrompt = `Translate the following technical agent response into natural Russian. Keep code snippets, file paths, and technical terms intact:\n\n${parsedResponse.message}`;
                    const translatedMsg = await askLocalModel(translationPrompt, fallbackModel);
                    if (translatedMsg && translatedMsg.trim()) {
                        parsedResponse.message = translatedMsg.trim();
                    }
                } catch {
                    // Оставляем оригинальное сообщение при ошибке перевода
                }
            }

            const triggerRestartIfNeeded = () => {
                if (parsedResponse.restartServer) {
                    console.log("\n🔄 Meta-Agent запускает процесс тестирования целевого агента...");
                    stopDevServer();
                    runDevServer(config.workspace.targetProject, makeTargetErrorHandler(TARGET_CRASH_PROMPT));
                }
            };

            if (parsedResponse.plan && Array.isArray(parsedResponse.plan) && parsedResponse.plan.length > 0) {
                console.log(`\n🧠 Meta-Agent's Plan:`);
                parsedResponse.plan.forEach(step => console.log(`   🔸 ${step}`));
            }

            if (parsedResponse.mode === 'chat') {
                console.log(`\n================ AGENT RESPONSE [CHAT] ================`);
                console.log(parsedResponse.message);
                console.log("========================================================\n");
                appendToSession("agent", parsedResponse.message);

                const newFiles = extractMentions(parsedResponse.message || '')
                    .map(m => resolveMention(m, allProjectFiles))
                    .filter(Boolean)
                    .filter(f => !relevantFiles.includes(f));

                if (newFiles.length > 0) {
                    if (depth >= MAX_AUTO_DEPTH) {
                        console.log(`\n⚠️ Достигнут лимит автоматической подгрузки файлов (${MAX_AUTO_DEPTH}). Уточните запрос или упомяните нужные файлы через @.`);
                    } else {
                        console.log(`\n⚙️ Система мгновенно подтягивает файлы для Meta-Agent (без перезапуска Диспетчера)...`);
                        const autoPrompt = `[SYSTEM] Дополнительно загружены файлы: ${newFiles.map(f => `@${f}`).join(' ')}. Продолжай выполнение исходной задачи (используй mode: "patch", если готов выдать изменения, или заверши отчёт).`;
                        await processAgentTask(autoPrompt, depth + 1, relevantFiles, options);
                        return;
                    }
                }

                triggerRestartIfNeeded();
                break;

            } else if (parsedResponse.mode === 'patch') {
                console.log(`\n================ AGENT RESPONSE [PATCH] ================`);
                console.log(`💡 ${parsedResponse.message}`);
                console.log("========================================================\n");

                const toUpdate = parsedResponse.filesToUpdate || [];
                const toDelete = parsedResponse.filesToDelete || [];
                const commandsToRun = parsedResponse.commandsToRun || [];

                if (toUpdate.length === 0 && toDelete.length === 0 && commandsToRun.length === 0) {
                    triggerRestartIfNeeded();
                    break;
                }

                if (toUpdate.length > 0 || toDelete.length > 0) {
                    const patchResult = await applyPatches(config.workspace.targetProject, toUpdate, toDelete);

                    if (patchResult.rejected.length > 0) {
                        healingAttempts++;
                        appendToSession("agent", `[PATCH REJECTED]: ${parsedResponse.message}`);

                        if (healingAttempts > maxHealingAttempts) {
                            console.log("❌ Не удалось получить корректный патч. Требуется ручное вмешательство.");
                            break;
                        }

                        const reasons = patchResult.rejected.map(r => `- ${r.path}: ${r.reason}`).join('\n');
                        console.log(`⚠️ Патч отклонён защитой. Запрашиваю исправленный вариант (Attempt ${healingAttempts}/${maxHealingAttempts})...`);
                        appendToSession("user", `[SYSTEM ERROR] Your patch was rejected and NOTHING was written to disk:\n${reasons}\nReturn the COMPLETE content of every file (no placeholders like "rest of code unchanged") using project-relative paths inside the project.`);
                        continue;
                    }

                    // Перестраиваем умную карту после успешного патча
                    buildProjectMap();
                }

                if (commandsToRun.length > 0) {
                    console.log(`\n⚙️ Meta-Agent выполняет команды в целевой директории:`);
                    for (let cmd of commandsToRun) {
                        if (typeof cmd !== 'string') continue;
                        cmd = cmd.replace(/git commit -m '([^']+)'/g, 'git commit -m "$1"');
                        console.log(`\n   > ${cmd}`);

                        const verdict = classifyCommand(cmd);
                        if (verdict.level !== 'safe') {
                            const warn = verdict.warning ? `   ⚠️ Риск: ${verdict.warning}\n` : '';
                            const approved = await askConfirm(`🛡️ Команда вне белого списка.\n${warn}   Разрешить выполнение? (y/N): `);
                            if (!approved) {
                                console.log(`⛔ Команда пропущена.`);
                                appendToSession("agent", `[COMMAND DENIED]: ${cmd}`);
                                continue;
                            }
                        }

                        console.log(`⏳ Running...`);
                        try {
                            execSync(cmd, {
                                stdio: 'inherit',
                                cwd: path.resolve(process.cwd(), config.workspace.targetProject)
                            });
                            console.log(`✅ Done.`);
                            appendToSession("agent", `[COMMAND EXECUTED]: ${cmd}`);
                        } catch (err) {
                            console.log(`❌ Command failed.`);
                            appendToSession("agent", `[COMMAND FAILED]: ${cmd}\nError: ${err.message}`);
                            break;
                        }
                    }
                }

                if (toUpdate.length > 0) {
                    console.log("\n🔍 Запуск проверки кода целевого агента...");
                    const check = await runProjectChecks(toUpdate);

                    if (check.success) {
                        console.log("✨ Проверки пройдены. Код чист.");
                        appendToSession("agent", `[PATCH APPLIED SUCCESSFULLY]: ${parsedResponse.message}`);
                        triggerRestartIfNeeded();
                        break;
                    }

                    healingAttempts++;

                    if (healingAttempts > maxHealingAttempts) {
                        console.log("❌ Авто-исправление не удалось. Требуется ручное вмешательство.");
                        console.log(`\n${check.kind} Output:\n${check.output}\n`);
                        appendToSession("agent", `[PATCH APPLIED BUT ${check.kind.toUpperCase()} FAILED]: ${parsedResponse.message}`);
                        break;
                    }

                    console.log(`⚠️ ${check.kind}: обнаружены ошибки. Запуск модуля исправления...`);

                    const normalizedUpdatedPaths = toUpdate.map(f => f.path.replace(/\\/g, '/'));
                    relevantFiles = [...new Set([...relevantFiles, ...normalizedUpdatedPaths])];

                    appendToSession("agent", `[PATCH APPLIED WITH ERRORS]: ${parsedResponse.message}`);
                    appendToSession("user", `[SYSTEM ERROR] ${check.kind} failed on the code you just wrote. Fix these errors in "patch" mode:\n\n${check.output}`);
                } else {
                    console.log("✨ Аудит завершен.");
                    appendToSession("agent", `[TASK COMPLETED]: ${parsedResponse.message}`);
                    triggerRestartIfNeeded();
                    break;
                }

            } else {
                console.log(parsedResponse.message || "No message provided.");
                appendToSession("agent", JSON.stringify(parsedResponse));
                break;
            }
        }

    } catch (error) {
        console.error("\n❌ Ошибка обработки задачи:", error.message);
    }

    await compressSessionIfNeeded();
}

function chatLoop() {
    rl.question('\n>> ', async (answer) => {
        let text = answer.trim();

        if (text.toLowerCase() === "exit" || text.toLowerCase() === "quit") {
            console.log("👋 Надзиратель отключается. До связи!");
            stopDevServer();
            rl.close();
            return;
        }

        if (text === "/stop") {
            stopDevServer();
            chatLoop();
            return;
        }

        if (text === "/run") {
            runDevServer(config.workspace.targetProject, makeTargetErrorHandler(TARGET_CRASH_PROMPT));
            chatLoop();
            return;
        }

        if (text === "/editor") {
            const tempPromptFile = path.join(process.cwd(), '.meta_prompt.tmp');
            fs.writeFileSync(tempPromptFile, '// Write your multi-line prompt here. Save and CLOSE the editor tab when done.\n', 'utf-8');
            console.log('📝 Opening VS Code for multi-line input (waiting for you to save and close the tab)...');
            try {
                execSync(`code --wait "${tempPromptFile}"`);
                const editorText = fs.readFileSync(tempPromptFile, 'utf-8')
                    .replace('// Write your multi-line prompt here. Save and CLOSE the editor tab when done.\n', '')
                    .trim();

                if (!editorText) {
                    console.log('⚠️ Prompt is empty. Canceled.');
                    chatLoop();
                    return;
                }
                text = editorText;
                console.log(`\n[Multiline Input Received]`);
            } catch (error) {
                console.log('⚠️ Could not open editor. Make sure "code" command is in your PATH.');
                chatLoop();
                return;
            }
        }

        if (!text) {
            chatLoop();
            return;
        }

        if (text.startsWith("/") && text !== "/editor" && text !== "/run" && text !== "/stop") {
            await handleCommand(text);
            chatLoop();
            return;
        }

        await processAgentTask(text);
        chatLoop();
    });
}