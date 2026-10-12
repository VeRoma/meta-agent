const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Твои реальные ключи доступа
const TOKEN = '8424663562:AAHqoMdtaVv9PlpjwmyfxVdWikUbGnQ4OlQ';
const MY_CHAT_ID = 933701082;

const bot = new TelegramBot(TOKEN, { polling: true });

console.log('🤖 Meta-Bot запущен и слушает Telegram...');

bot.on('message', (msg) => {
    const chatId = msg.chat.id;

    // СЕКЬЮРИТИ: Отшиваем всех чужаков
    if (chatId !== MY_CHAT_ID) {
        bot.sendMessage(chatId, '⛔ Доступ к Управляющему Центру запрещен.');
        return;
    }

    const taskText = msg.text;
    if (!taskText) return;

    const devBotDir = __dirname;
    const agentDir = path.join(devBotDir, '..'); // Корневая папка meta-agent

    // === СТАНДАРТНОЕ ТЗ ДЛЯ META-AGENT ===
    bot.sendMessage(chatId, `⏳ Принял директиву. Запускаю Аудитора...`, { parse_mode: 'Markdown' });
    
    const taskFilePath = path.join(agentDir, 'meta_task.txt');
    fs.writeFileSync(taskFilePath, taskText);

    // Запускаем Агента (он сам прочитает agent_task.txt и свою цель из agent.config.json)
    const command = `node meta-agent.js`;

    exec(command, { cwd: agentDir }, (error, stdout, stderr) => {
        let response = '';

        if (error) response += `❌ **Ошибка:**\n${error.message}\n\n`;
        if (stderr) response += `⚠️ **System Info:**\n${stderr}\n\n`;
        if (stdout) response += `✅ **Лог Meta-Agent:**\n${stdout}`;

        if (response.length > 4000) {
            response = "..." + response.substring(response.length - 3900); 
        }

        bot.sendMessage(chatId, response || 'Аудит завершен, логов нет.');
    });
});