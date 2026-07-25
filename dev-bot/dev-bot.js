const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Твои реальные ключи доступа
const TOKEN = '8424663562:AAHqoMdtaVv9PlpjwmyfxVdWikUbGnQ4OlQ';
const MY_CHAT_ID = 933701082;

const bot = new TelegramBot(TOKEN, { polling: true });

// Глобальная переменная для хранения текущего проекта (по умолчанию 5)
let activeProject = '5';

console.log('🤖 Dev-Bot запущен и слушает Telegram...');

bot.on('message', (msg) => {
    const chatId = msg.chat.id;

    // СЕКЬЮРИТИ: Отшиваем всех чужаков
    if (chatId !== MY_CHAT_ID) {
        bot.sendMessage(chatId, '⛔ Доступ к Агенту запрещен.');
        return;
    }

    const taskText = msg.text;
    if (!taskText) return;

    // Указываем пути
    const devBotDir = __dirname;
    const agentDir = path.join(devBotDir, '..');
    const workspaceDir = path.join(agentDir, '..'); // Папка со всеми проектами

    // === КОМАНДА: ПОКАЗАТЬ СПИСОК ПРОЕКТОВ ===
    if (taskText.toLowerCase() === '/list' || taskText.toLowerCase() === '/projects') {
        try {
            const items = fs.readdirSync(workspaceDir);
            let projectList = "📂 **Доступные проекты:**\n\n";
            let idx = 1;
            
            for (const item of items) {
                const fullPath = path.join(workspaceDir, item);
                if (fs.statSync(fullPath).isDirectory() && item !== 'dev-agent' && !item.startsWith('.')) {
                    // Отмечаем галочкой текущий проект
                    const isCurrent = (idx.toString() === activeProject) ? "✅ " : "   ";
                    projectList += `${isCurrent}[${idx}] ${item}\n`;
                    idx++;
                }
            }
            projectList += `\nТекущий проект: **№${activeProject}**\nЧтобы сменить, отправь: \`/p <номер>\``;
            bot.sendMessage(chatId, projectList, { parse_mode: 'Markdown' });
        } catch (e) {
            bot.sendMessage(chatId, `❌ Ошибка чтения папки проектов: ${e.message}`);
        }
        return;
    }

    // === КОМАНДА: СМЕНИТЬ ПРОЕКТ ===
    if (taskText.toLowerCase().startsWith('/p ')) {
        const match = taskText.match(/\d+/);
        if (match) {
            activeProject = match[0];
            bot.sendMessage(chatId, `🔄 Активный проект успешно изменен на **№${activeProject}**.\nТеперь все задачи будут улетать в него!`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `⚠️ Не понял номер. Пример использования: \`/p 3\``, { parse_mode: 'Markdown' });
        }
        return;
    }

    // === СТАНДАРТНОЕ ТЗ ДЛЯ АГЕНТА ===
    bot.sendMessage(chatId, `⏳ Принял задачу (Проект **№${activeProject}**). Запускаю Агента...`, { parse_mode: 'Markdown' });
    
    const taskFilePath = path.join(agentDir, 'agent_task.txt');
    fs.writeFileSync(taskFilePath, taskText);

    // Подставляем динамический номер проекта!
    const command = `powershell -Command "$env:AUTO_PROJECT='${activeProject}'; node agent.js"`;

    exec(command, { cwd: agentDir }, (error, stdout, stderr) => {
        let response = '';

        if (error) response += `❌ **Ошибка:**\n${error.message}\n\n`;
        if (stderr) response += `⚠️ **System Info:**\n${stderr}\n\n`;
        if (stdout) response += `✅ **Лог Агента:**\n${stdout}`;

        if (response.length > 4000) {
            response = "..." + response.substring(response.length - 3900); 
        }

        bot.sendMessage(chatId, response || 'Агент отработал тихо.');
    });
});