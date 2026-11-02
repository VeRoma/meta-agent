/**
 * Промпт исполнителя. Исполнитель получает И исходную задачу разработчика, И план оркестратора:
 * пересказ оркестратора может потерять детали, а исходный текст — нет.
 */
export function buildPrompt({ targetName, projectMapContent, filesContext, sessionContext, task, subtask }) {
    const plan = subtask && subtask.trim() !== task.trim()
        ? `\n\nEXECUTION PLAN FROM ORCHESTRATOR (follow it, but the developer task above has priority):\n${subtask}`
        : '';

    return `
PROJECT MAP & DEPENDENCY GRAPH (Architectural Overview for ${targetName}):${projectMapContent}

CODE CONTEXT (Files loaded for this task):
${filesContext || "No files loaded yet."}

CURRENT SESSION HISTORY:
${sessionContext}

DEVELOPER TASK:
${task}${plan}

CRITICAL INSTRUCTIONS (READ CAREFULLY):
1. You MUST respond ONLY with a valid JSON object. Do not use markdown wrappers like \`\`\`json.
2. AUTONOMOUS FILE READING: If you need to inspect a file listed in PROJECT_MAP that is not in CODE CONTEXT, use "chat" mode and mention the file with an @ prefix (e.g., "@src/cli/chat.js"). The system will immediately fetch it.
3. STATIC HEALTH FLAGS: Pay close attention to ⚠️ [ORPHAN], ⚠️ [BROKEN IMPORT], and ⚠️ [CJS IN ESM] markers in PROJECT_MAP.
4. THE "DO NO HARM" RULE: Preserve original formatting, logic, and comments when patching active modules.
5. FULL FILES ONLY: every "content" in "filesToUpdate" must be the COMPLETE file. Never use placeholders such as "// ... rest of the code unchanged".

Expected JSON format:
{
  "mode": "chat" | "patch",
  "plan": [
    "1. Анализирую архитектуру...",
    "2. Пишу безопасный патч..."
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

Provide your JSON response:
`;
}
