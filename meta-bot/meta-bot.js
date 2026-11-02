const path = require('path');
// Секреты берём из корневого .env (того же, что использует сам агент)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TelegramBot = require('node-telegram-bot-api');
const { execFile } = require('child_process');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MY_CHAT_ID = Number(process.env.TELEGRAM_CHAT_ID);

if (!TOKEN || !MY_CHAT_ID) {
    console.error('❌ Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env (см. .env.example)');
    process.exit(1);
}

const agentDir = path.join(__dirname, '..'); // Корневая папка meta-agent
const bot = new TelegramBot(TOKEN, { polling: true });

// Одна задача за раз: два агента на одном проекте перезаписывали бы файлы друг друга.
// Если агент уже открыт в терминале, его откажет запускать lock-файл в .meta-agent.
let taskRunning = false;

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

    if (taskRunning) {
        bot.sendMessage(chatId, '⏳ Предыдущая директива ещё выполняется. Дождитесь ответа.');
        return;
    }

    // === СТАНДАРТНОЕ ТЗ ДЛЯ META-AGENT ===
    taskRunning = true;
    bot.sendMessage(chatId, `⏳ Принял директиву. Запускаю Аудитора...`);

    // Задача — в окружение только этого процесса (не в общий файл), без shell.
    // В этом режиме нет терминала для подтверждений: команды вне белого списка отклоняются.
    execFile(process.execPath, ['meta-agent.js'], {
        cwd: agentDir,
        env: { ...process.env, META_TASK: taskText },
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
        taskRunning = false;
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
