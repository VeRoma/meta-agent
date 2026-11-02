import readline from "readline";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { config, AGENT_ROOT } from '../config.js';
import { buildProjectMap } from '../fs/map-builder.js';
import { getSession, initSession, clearSession } from "../core/session.js";
import { generateDocumentation } from '../fs/docs-generator.js';
import { abortSessionPatches, clearSessionBackups, applyRedoPatches } from '../fs/patcher.js';
import { processAgentTask, startTargetServer, stopTargetServer } from '../core/task-runner.js';
import { setConfirmHandler, setIdleHandler } from '../core/io.js';

// Интерфейс: ввод, команды, подтверждения. Вся логика задачи — в core/task-runner.js.

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function askConfirm(question) {
    if (!process.stdin.isTTY) {
        console.log('⛔ Нет интерактивного терминала — действие отклонено автоматически.');
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        rl.question(question, (answer) => resolve(/^(y|yes|д|да)$/i.test(answer.trim())));
    });
}

setConfirmHandler(askConfirm);
setIdleHandler(() => rl.prompt());

const COMMANDS_HELP = "/audit, /run, /stop, /save, /index, /abort, /redo, /clear, /editor, /push";

export async function startCLI(initialTask = null) {
    const { tiers = {}, orchestratorModel } = config.llm;
    console.log(`\n🚀 Meta-Agent CLI initialized!`);
    console.log(`🧠 Orchestrator: ${orchestratorModel ?? tiers.pro}`);
    console.log(`🧠 Executors: fast=${tiers.fast}, pro=${tiers.pro}, arch=${tiers.arch} (теги в задаче: @ds, @ge, @claude)`);
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
    const targetProject = config.workspace.targetProject;

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
            await generateDocumentation(targetProject, getSession());
            clearSession();
            clearSessionBackups(targetProject);
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
            await abortSessionPatches(targetProject);
            clearSession();
            initSession('Task aborted (waiting...)');
            console.log("🛑 Task aborted. AI memory erased. Files reverted.");
            break;

        case "/redo": {
            console.log("\n🔄 Restoring aborted task...");
            if (await applyRedoPatches(targetProject)) {
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
            console.log(`\n⚠️ Unknown command. Available: ${COMMANDS_HELP}`);
    }
}

const EDITOR_HINT = '// Write your multi-line prompt here. Save and CLOSE the editor tab when done.\n';

/** Многострочный ввод через VS Code. @returns {string|null} текст или null, если ввод отменён */
function readFromEditor() {
    const tempPromptFile = path.join(AGENT_ROOT, '.meta_prompt.tmp');
    fs.writeFileSync(tempPromptFile, EDITOR_HINT, 'utf-8');
    console.log('📝 Opening VS Code for multi-line input (waiting for you to save and close the tab)...');
    try {
        execSync(`code --wait "${tempPromptFile}"`);
    } catch {
        console.log('⚠️ Could not open editor. Make sure "code" command is in your PATH.');
        return null;
    }
    const editorText = fs.readFileSync(tempPromptFile, 'utf-8').replace(EDITOR_HINT, '').trim();
    if (!editorText) {
        console.log('⚠️ Prompt is empty. Canceled.');
        return null;
    }
    console.log(`\n[Multiline Input Received]`);
    return editorText;
}

function chatLoop() {
    rl.question('\n>> ', async (answer) => {
        let text = answer.trim();

        if (text.toLowerCase() === "exit" || text.toLowerCase() === "quit") {
            console.log("👋 Надзиратель отключается. До связи!");
            stopTargetServer();
            rl.close();
            return;
        }

        if (text === "/stop") {
            stopTargetServer();
        } else if (text === "/run") {
            startTargetServer();
        } else if (text === "/editor") {
            const editorText = readFromEditor();
            if (editorText) await processAgentTask(editorText);
        } else if (text.startsWith("/")) {
            await handleCommand(text);
        } else if (text) {
            await processAgentTask(text);
        }

        chatLoop();
    });
}
