import readline from "readline";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import { getProjectFiles, readFilesContent, generateProjectTree } from "../fs/file-manager.js";
import {
    initSession,
    appendToSession,
    getSession,
    clearSession,
    compressSessionIfNeeded,
} from "../core/session.js";
import { askModel } from "../core/llm.js";
import { determineRelevantFiles } from "../core/routing.js";
import { generateDocumentation, generateIndexes } from '../fs/docs-generator.js';
import { applyPatches, abortSessionPatches, clearSessionBackups, applyRedoPatches } from '../fs/patcher.js';
import { runLinter } from '../core/linter.js';
import { runDevServer, stopDevServer } from './runner.js';

const configPath = path.join(process.cwd(), "agent.config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

export async function startCLI(initialTask = null) {
    console.log(`\n🚀 Dev-Agent initialized!`);
    console.log(`🧠 Executor: ${config.llm.executorModel}`);
    console.log(`📂 Working directory: ${config.workspace.targetProject}`);

    initSession("Current development (General)");
    
    // Если нам передали ТЗ извне (от Telegram-бота)
    if (initialTask) {
        console.log("📥 Обрабатываю внешнюю задачу...\n");
        await processAgentTask(initialTask);
        // Завершаем процесс после выполнения задачи (чтобы освободить память Telegram-бота)
        process.exit(0); 
    } else {
        // Иначе запускаем обычный ручной чат
        chatLoop();
    }
}

async function handleCommand(command) {
    switch (command.toLowerCase()) {
        case '/save':
            console.log('\n💾 Starting save process...');
            const currentSession = getSession();
            await generateDocumentation(config.workspace.targetProject, currentSession);
            await generateIndexes(config.workspace.targetProject);
            clearSession();
            clearSessionBackups();
            initSession('New task (waiting...)');
            console.log('🧹 Temporary session and backups cleared. Ready for a new task!');
            break;
            
        case "/index":
            await generateIndexes(config.workspace.targetProject);
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

// === НОВАЯ ФУНКЦИЯ: Основной цикл Агента ===
export async function processAgentTask(text) {
    console.log("🤖 Agent is gathering context...");
    appendToSession("user", text);

    try {
        const mentionRegex = /@([a-zA-Z0-9_.\-\/]+)/g;
        const mentions = [...text.matchAll(mentionRegex)].map(m => m[1]);
        const allProjectFiles = getProjectFiles(config.workspace.targetProject);
        let forcedFiles = [];

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
                    console.log(`⚠️ Mentioned file not found in project: ${mention}`);
                }
            }
        }

        let relevantFiles = await determineRelevantFiles(text, config.workspace.targetProject);
        relevantFiles = [...new Set([...forcedFiles, ...relevantFiles])];

        if (relevantFiles.length > 0) {
            console.log(`📂 Files selected for analysis: ${relevantFiles.length}`);
            relevantFiles.forEach((f) => console.log(`   - ${path.basename(f)}`));
        }

        let healingAttempts = 0;
        const maxHealingAttempts = 3;

        while (healingAttempts <= maxHealingAttempts) {
            const targetAbsolute = path.resolve(process.cwd(), config.workspace.targetProject);
            const filesContext = readFilesContent(relevantFiles, targetAbsolute);
            const sessionContext = getSession();
            const projectTree = generateProjectTree(config.workspace.targetProject);

            const prompt = `
PROJECT STRUCTURE (Use this to understand architecture and import paths):
${projectTree}

CODE CONTEXT:
${filesContext || "No files required."}

CURRENT SESSION:
${sessionContext}

CRITICAL INSTRUCTIONS (READ CAREFULLY):
1. You are an autonomous Senior Software Architect and Developer.
2. You MUST respond ONLY with a valid JSON object. Do not use markdown wrappers like \`\`\`json.
3. AUTONOMOUS FILE READING: If you need to read a file that is not in the CODE CONTEXT, DO NOT ask the user to copy-paste it! Instead, use "chat" mode and mention the file with an @ prefix (e.g., "@vite.config.ts"). The system will automatically fetch it for you in the next turn.
4. THE "DO NO HARM" RULE FOR PATCHING: When updating a file, you MUST preserve 100% of the original formatting, indentation, styling (e.g. Tailwind classes), comments, and unrelated logic. NEVER hallucinate, truncate, or simplify existing code. If a file is too complex or monolithic to patch safely without losing formatting, DO NOT offload the mechanical work to the user (e.g., do not ask them to copy-paste snippets). Instead, use "chat" mode to warn the user about the complexity and propose a refactoring plan (e.g., decomposing the file) before implementing the requested feature.
5. TERMINAL AUTONOMY: Commands in "commandsToRun" are executed AUTOMATICALLY and SYNCHRONOUSLY. DO NOT tell the user to run commands and DO NOT tell them to wait. You handle it automatically.
6. SERVER MANAGEMENT: To restart the server autonomously, you MUST strictly set "restartServer": true in your JSON response. The system will handle the safe background restart automatically. DO NOT add any terminal commands for server restart to "commandsToRun".
7. SECURITY & SECRETS MANAGEMENT: NEVER hardcode secrets, API keys, tokens, or passwords in the source code. ALWAYS use environment variables. If a project requires secrets, you MUST autonomously create an empty \`.env\` file for local development and a \`.env.example\` file with safe placeholder values for version control. CRITICAL: Before creating or modifying a \`.env\` file, you MUST verify that \`.env\` and \`.env.*\` are explicitly listed in the project's \`.gitignore\`. If they are not, add them immediately.
8. The "plan" and "message" fields MUST be written in Russian.

Expected JSON format:
{
  "mode": "chat" | "patch",
  "plan": [
    "1. Анализирую архитектуру и нахожу нужный компонент...",
    "2. Формирую логику для новой функции...",
    "3. Пишу безопасный патч для файла..."
  ],
  "message": "Detailed response (for chat) OR short action summary (for patch) in Russian.",
  "filesToUpdate": [
    {
      "path": "app/components/FileName.tsx",
      "content": "// ... entire file content here (not just diff, the FULL file) ..."
    }
  ],
  "filesToDelete": [
    {
      "path": "app/components/OldFile.tsx"
    }
  ],
  "commandsToRun": [
    "npm install three"
  ],
  "restartServer": false
}

Answer the developer's last message:
`;

            console.log(healingAttempts > 0 ? `🤖 Executor is fixing errors (Attempt ${healingAttempts}/${maxHealingAttempts})...` : "🤖 Executor (Pro) is thinking/coding...");
            
            const rawResponse = await askModel(prompt, false);
            const cleanJson = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedResponse = JSON.parse(cleanJson);

            const triggerRestartIfNeeded = () => {
                if (parsedResponse.restartServer) {
                    console.log("\n🔄 Агент автономно перезапускает dev-сервер...");
                    stopDevServer();
                    runDevServer(config.workspace.targetProject, async (errorLog) => {
                        console.log(`\n🚨 ВНИМАНИЕ: Сервер выкинул ошибку! Передаю Агенту на авто-исправление...`);
                        const errorPrompt = `[SYSTEM ERROR] Локальный dev-сервер упал с ошибками компиляции. Проанализируй этот лог, найди проблемный файл и сгенерируй патч с исправлением кода:\n\n${errorLog}`;
                        await processAgentTask(errorPrompt);
                        console.log('\n✅ Попытка исправления завершена. Посмотрите логи сервера выше.');
                        rl.prompt();
                    });
                }
            };

            if (parsedResponse.plan && Array.isArray(parsedResponse.plan) && parsedResponse.plan.length > 0) {
                console.log(`\n🧠 Agent's Logic & Plan:`);
                parsedResponse.plan.forEach(step => console.log(`   🔸 ${step}`));
            }

            if (parsedResponse.mode === 'chat') {
                console.log(`\n================ AGENT RESPONSE [CHAT] ================`);
                console.log(parsedResponse.message);
                console.log("========================================================\n");
                appendToSession("agent", parsedResponse.message);
                
                const agentMentions = [...parsedResponse.message.matchAll(/@([a-zA-Z0-9_.\-\/]+)/g)].map(m => m[1]);
                if (agentMentions.length > 0) {
                    console.log(`\n⚙️ Система автономно загружает запрошенные файлы для Агента...`);
                    const autoPrompt = `[SYSTEM] Содержимое запрошенных файлов загружено: ${agentMentions.map(m => `@${m}`).join(' ')}. Изучи их и продолжай задачу (используй mode: "patch", если готов писать код).`;
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
                    console.log(`\n⚙️ Agent is executing ${commandsToRun.length} command(s) autonomously:`);
                    for (const cmd of commandsToRun) {
                        console.log(`\n   > ${cmd}`);
                        console.log(`⏳ Running (Auto-approved)...`);
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
                    console.log("\n🔍 Checking code quality...");
                    const lintResult = await runLinter(config.workspace.targetProject, toUpdate);

                    if (lintResult.success) {
                        console.log("✨ Code is clean! No errors found.");
                        appendToSession("agent", `[PATCH APPLIED SUCCESSFULLY]: ${parsedResponse.message}`);
                        triggerRestartIfNeeded();
                        break; 
                    } else {
                        healingAttempts++;
                        
                        if (healingAttempts > maxHealingAttempts) {
                            console.log("❌ Auto-healing failed. Too many attempts. Manual fix required.");
                            console.log(`\nLinter Output:\n${lintResult.error}\n`);
                            appendToSession("agent", `[PATCH APPLIED BUT LINTER FAILED]: ${parsedResponse.message}`);
                            break;
                        }

                        console.log(`⚠️ Linter found errors. Initiating Auto-Healing...`);
                        
                        const absoluteUpdatedPaths = toUpdate.map(f => path.resolve(process.cwd(), config.workspace.targetProject, f.path));
                        relevantFiles = [...new Set([...relevantFiles, ...absoluteUpdatedPaths])];

                        appendToSession("agent", `[PATCH APPLIED WITH ERRORS]: ${parsedResponse.message}`);
                        const errorPrompt = `[SYSTEM ERROR] Linter failed on the code you just wrote. Fix these errors and return the corrected files in "patch" mode:\n\n${lintResult.error}`;
                        appendToSession("user", errorPrompt);
                    }
                } else {
                    console.log("✨ Task completed.");
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
        console.error("\n❌ Processing error (model might not have returned valid JSON):", error.message);
    }

    await compressSessionIfNeeded();
}

function chatLoop() {
    rl.question('\n>> ', async (answer) => {
        let text = answer.trim();

        if (text.toLowerCase() === "exit" || text.toLowerCase() === "quit") {
            console.log("👋 Shutting down. See you!");
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
                console.log(`\n🚨 ВНИМАНИЕ: Сервер выкинул ошибку! Передаю Агенту на авто-исправление...`);
                const errorPrompt = `[SYSTEM ERROR] Локальный dev-сервер упал с ошибками компиляции. Проанализируй этот лог, найди проблемный файл и сгенерируй патч с исправлением кода:\n\n${errorLog}`;
                
                await processAgentTask(errorPrompt);
                
                console.log('\n✅ Попытка исправления завершена. Посмотрите логи сервера выше.');
                rl.prompt();
            });
            chatLoop();
            return;
        }

        if (text === "/editor") {
            const tempPromptFile = path.join(process.cwd(), '.agent_prompt.tmp');
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