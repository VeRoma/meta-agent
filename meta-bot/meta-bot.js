const path = require('path');
// Секреты берём из корневого .env (того же, что использует сам агент)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MY_CHAT_ID = Number(process.env.TELEGRAM_CHAT_ID);

if (!TOKEN || !MY_CHAT_ID) {
    console.error('❌ Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env (см. .env.example)');
    process.exit(1);
}

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
    bot.sendMessage(chatId, `⏳ Принял директиву. Запускаю Аудитора...`);
    
    const taskFilePath = path.join(agentDir, 'meta_task.txt');
    fs.writeFileSync(taskFilePath, taskText);

    // Запускаем Агента (он сам прочитает meta_task.txt и свою цель из meta.config.json).
    // В этом режиме нет терминала для подтверждений: команды вне белого списка отклоняются.
    const command = `node meta-agent.js`;

    exec(command, { cwd: agentDir, timeout: 10 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        let response = '';

        if (error) response += `❌ Ошибка:\n${error.message}\n\n`;
        if (stderr) response += `⚠️ System Info:\n${stderr}\n\n`;
        if (stdout) response += `✅ Лог Meta-Agent:\n${stdout}`;

        if (response.length > 4000) {
            response = "..." + response.substring(response.length - 3900); 
        }

        bot.sendMessage(chatId, response || 'Аудит завершен, логов нет.');
    });
});
