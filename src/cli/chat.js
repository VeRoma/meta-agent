import readline from "readline";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { buildProjectMap } from '../fs/map-builder.js';

// УБРАНЫ ТЯЖЕЛЫЕ ФУНКЦИИ (getProjectFiles, generateProjectTree)
import { readFilesContent } from "../fs/file-manager.js";
import {
    initSession,
    appendToSession,
    getSession,
    clearSession,
    compressSessionIfNeeded,
} from "../core/session.js";
import { askModel } from "../core/llm.js";
import { determineRelevantFiles } from "../core/routing.js";
import { generateDocumentation } from '../fs/docs-generator.js';
import { applyPatches, abortSessionPatches, clearSessionBackups, applyRedoPatches } from '../fs/patcher.js';
import { runLinter } from '../core/linter.js';
import { runTests } from '../core/tester.js';
import { runDevServer, stopDevServer } from './runner.js';

const configPath = path.join(process.cwd(), "meta.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

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
    switch (command.toLowerCase()) {
        case '/save':
            console.log('\n💾 Starting save process...');
            const currentSession = getSession();
            await generateDocumentation(config.workspace.targetProject, currentSession);
            
            clearSession();
            clearSessionBackups();
            initSession('New audit task (waiting...)');
            console.log('🧹 Temporary session and backups cleared. Ready for a new task!');
            break;
            
        case "/index":
            console.log("\n🗺️ Генерация карты проекта (мгновенно, без LLM)...");
            buildProjectMap();
            break;
            
        case "/abort":
            console.log("\n🗑️ Aborting current task...");
            await abortSessionPatches(config.workspace.targetProject);
            clearSession();
            initSession('Task aborted (waiting...)');
            console.log("🛑 Task aborted. AI memory erased. Files reverted.");
            break;

        case "/redo":
            console.log("\n🔄 Restoring aborted task...");
            const isRedone = await applyRedoPatches(config.workspace.targetProject);
            if (isRedone) {
                console.log("⏩ Task restored. AI memory reloaded. Files reverted to modified state.");
            }
            break;

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
            console.log("\n⚠️ Unknown command. Available: /run, /stop, /save, /index, /abort, /redo, /clear, /editor, /push");
    }
}

export async function processAgentTask(text) {
    console.log("👁️ Meta-Agent is gathering context...");
    appendToSession("user", text);

    try {
        const targetAbsolute = path.resolve(process.cwd(), config.workspace.targetProject);
        const mapPath = path.join(targetAbsolute, 'PROJECT_MAP.md');
        
        let projectMapContent = "PROJECT MAP UNAVAILABLE.";
        let allProjectFiles = [];

        // 1. Читаем легкую карту проекта вместо сканирования жесткого диска
        if (fs.existsSync(mapPath)) {
            projectMapContent = fs.readFileSync(mapPath, 'utf-8');
            // Парсим пути файлов прямо из карты для проверки @упоминаний
            allProjectFiles = projectMapContent
                .split('\n')
                .filter(line => line.startsWith('### 📄 '))
                .map(line => line.replace('### 📄 ', '').trim());
        }

        const mentionRegex = /@([a-zA-Z0-9_.\-\/]+)/g;
        const mentions = [...text.matchAll(mentionRegex)].map(m => m[1]);
        
        let forcedFiles = [];

        // 2. Обработка прямых упоминаний файлов
        if (mentions.length > 0) {
            for (const mention of mentions) {
                const matched = allProjectFiles.find(f => {
                    const normalizedPath = f.replace(/\\/g, '/');
                    const base = path.basename(normalizedPath);
                    const nameWithoutExt = base.replace(/\.[^/.]+$/, "");
                    return base === mention || nameWithoutExt === mention || normalizedPath === mention || normalizedPath.endsWith(mention);
                });
                
                if (matched) {
                    forcedFiles.push(matched);
                    console.log(`📌 Explicitly included: ${mention}`);
                } else {
                    console.log(`⚠️ Mentioned file not found in PROJECT_MAP: ${mention}`);
                }
            }
        }

        // 3. Вызов локального Диспетчера (Gemma 3)
        let relevantFiles = await determineRelevantFiles(text, config.workspace.targetProject);
        relevantFiles = [...new Set([...forcedFiles, ...relevantFiles])];

        if (relevantFiles.length > 0) {
            console.log(`📂 Files selected for audit/modification: ${relevantFiles.length}`);
            relevantFiles.forEach((f) => console.log(`   - ${path.basename(f)}`));
        }

        let healingAttempts = 0;
        const maxHealingAttempts = 3;

        while (healingAttempts <= maxHealingAttempts) {
            // 4. Загружаем ТОЛЬКО нужные файлы, выбранные диспетчером
            const filesContext = readFilesContent(relevantFiles, targetAbsolute);
            const sessionContext = getSession();

            const systemRole = config.prompts ? config.prompts.systemRole : "You are Meta-Agent, an autonomous AI Overseer.";

            // 5. Передаем карту проекта вместо тяжелого древовидного лога
            const prompt = `
PROJECT MAP (Architectural Overview for ${config.workspace.targetProject}):${projectMapContent}

CODE CONTEXT (Files selected for this task):
${filesContext || "No files required."}

CURRENT SESSION:
${sessionContext}

CRITICAL INSTRUCTIONS (READ CAREFULLY):
1. 
${systemRole}
2. You MUST respond ONLY with a valid JSON object. Do not use markdown wrappers like \`\`\`json.
3. AUTONOMOUS FILE READING: If you need to read a file that is not in the CODE CONTEXT, use "chat" mode and mention the file with an @ prefix (e.g., "@agent.js"). The system will fetch it.
4. THE "DO NO HARM" RULE: Preserve original formatting, logic, and comments. DO NOT modify files in the .meta-agent directory.
5. TERMINAL AUTONOMY: Commands in "commandsToRun" are executed AUTOMATICALLY. 
6. SERVER MANAGEMENT: Set "restartServer": true to autonomously restart the target project's server.
7. The "plan" and "message" fields MUST be written in Russian.

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
            
            const rawResponse = await askModel(prompt, false);
            const cleanJson = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedResponse = JSON.parse(cleanJson);

            if (parsedResponse.message && /^[A-Za-z0-9\s.,!?;:'"()-]+$/.test(parsedResponse.message.slice(0, 50))) {
                try {
                    const { askModel: _, askLocalModel } = await import('../core/llm.js');
                    const configPathLocal = path.join(process.cwd(), 'meta.config.json');
                    const cfgLocal = JSON.parse(fs.readFileSync(configPathLocal, 'utf-8'));
                    const heavyModel = cfgLocal.llm.heavyFallbackModel || cfgLocal.llm.fallbackModel;
                    
                    const translationPrompt = `Translate the following technical agent response into natural Russian. Keep code snippets, file paths, and technical terms intact:\n\n${parsedResponse.message}`;
                    const translatedMsg = await askLocalModel(translationPrompt, heavyModel);
                    if (translatedMsg && translatedMsg.trim()) {
                        parsedResponse.message = translatedMsg.trim();
                    }
                } catch (trErr) {
                    // Если локальный переводчик занят, оставляем оригинальное сообщение
                }
            }

            const triggerRestartIfNeeded = () => {
                if (parsedResponse.restartServer) {
                    console.log("\n🔄 Meta-Agent запускает процесс тестирования целевого агента...");
                    stopDevServer();
                    runDevServer(config.workspace.targetProject, async (errorLog) => {
                        console.log(`\n🚨 ВНИМАНИЕ: Целевой процесс упал с ошибкой! Передаю на авто-исправление...`);
                        const errorPrompt = `[SYSTEM ERROR] Процесс target-agent упал. Проанализируй этот лог, найди проблемный файл и сгенерируй патч:\n\n${errorLog}`;
                        await processAgentTask(errorPrompt);
                        console.log('\n✅ Попытка исправления завершена.');
                        rl.prompt();
                    });
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
                
                const agentMentions = [...parsedResponse.message.matchAll(/@([a-zA-Z0-9_.\-\/]+)/g)].map(m => m[1]);
                if (agentMentions.length > 0) {
                    console.log(`\n⚙️ Система подтягивает файлы для Meta-Agent...`);
                    const autoPrompt = `[SYSTEM] Файлы загружены: ${agentMentions.map(m => `@${m}`).join(' ')}. Продолжай задачу (используй mode: "patch", если готов).`;
                    await processAgentTask(autoPrompt);
                    return; 
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
                    await applyPatches(config.workspace.targetProject, toUpdate, toDelete);
                }

                if (commandsToRun.length > 0) {
                    console.log(`\n⚙️ Meta-Agent выполняет команды в целевой директории:`);
                    for (let cmd of commandsToRun) {
                        cmd = cmd.replace(/git commit -m '([^']+)'/g, 'git commit -m "$1"');
                        console.log(`\n   > ${cmd}`);
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
                    const lintResult = await runLinter(config.workspace.targetProject, toUpdate);

                    if (lintResult.success) {
                        console.log("✅ Линтер пройден. Запуск юнит-тестов...");
                        const testResult = await runTests(config.workspace.targetProject);

                        if (testResult.success) {
                            console.log("✨ Линтер и тесты пройдены успешно! Код чист.");
                            appendToSession("agent", `[PATCH APPLIED SUCCESSFULLY]: ${parsedResponse.message}`);
                            triggerRestartIfNeeded();
                            break; 
                        } else {
                            healingAttempts++;
                            
                            if (healingAttempts > maxHealingAttempts) {
                                console.log("❌ Авто-исправление не удалось. Требуется ручное вмешательство.");
                                console.log(`\nTest Output:\n${testResult.output}\n`);
                                appendToSession("agent", `[PATCH APPLIED BUT TESTS FAILED]: ${parsedResponse.message}`);
                                break;
                            }

                            console.log("⚠️ Линтер пройден, но юнит-тесты упали. Запуск модуля исправления...");
                            
                            const absoluteUpdatedPaths = toUpdate.map(f => path.resolve(process.cwd(), config.workspace.targetProject, f.path));
                            relevantFiles = [...new Set([...relevantFiles, ...absoluteUpdatedPaths])];

                            appendToSession("agent", `[PATCH APPLIED WITH ERRORS]: ${parsedResponse.message}`);
                            const errorPrompt = `[SYSTEM ERROR] Tests failed on the code you just wrote. Fix these errors in 'patch' mode:\n\n${testResult.output}`;
                            appendToSession("user", errorPrompt);
                        }
                    } else {
                        healingAttempts++;
                        
                        if (healingAttempts > maxHealingAttempts) {
                            console.log("❌ Авто-исправление не удалось. Требуется ручное вмешательство.");
                            console.log(`\nLinter Output:\n${lintResult.error}\n`);
                            appendToSession("agent", `[PATCH APPLIED BUT LINTER FAILED]: ${parsedResponse.message}`);
                            break;
                        }

                        console.log(`⚠️ Обнаружены ошибки. Запуск модуля исправления...`);
                        
                        const absoluteUpdatedPaths = toUpdate.map(f => path.resolve(process.cwd(), config.workspace.targetProject, f.path));
                        relevantFiles = [...new Set([...relevantFiles, ...absoluteUpdatedPaths])];

                        appendToSession("agent", `[PATCH APPLIED WITH ERRORS]: ${parsedResponse.message}`);
                        const errorPrompt = `[SYSTEM ERROR] Linter failed on the code you just wrote. Fix these errors in "patch" mode:\n\n${lintResult.error}`;
                        appendToSession("user", errorPrompt);
                    }
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
        console.error("\n❌ Ошибка обработки JSON от модели:", error.message);
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
            runDevServer(config.workspace.targetProject, async (errorLog) => {
                console.log(`\n🚨 ВНИМАНИЕ: Процесс target-agent упал! Передаю на авто-исправление...`);
                const errorPrompt = `[SYSTEM ERROR] Целевой процесс упал с ошибкой. Проанализируй лог, найди проблемный файл и исправь код:\n\n${errorLog}`;
                
                await processAgentTask(errorPrompt);
                
                console.log('\n✅ Попытка исправления завершена.');
                rl.prompt();
            });
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