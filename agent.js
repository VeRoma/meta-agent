import fs from 'fs';
import path from 'path';
import readline from 'readline';
import dotenv from 'dotenv';

dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const configPath = path.join(process.cwd(), 'agent.config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e) {
    console.error("❌ Ошибка чтения agent.config.json");
    process.exit(1);
}

// Ищем проекты в родительской папке (на уровень выше Агента)
const baseDir = path.resolve(process.cwd(), '..');
const items = fs.readdirSync(baseDir);
const projects = [];

const agentFolderName = path.basename(process.cwd());

for (const item of items) {
    const fullPath = path.join(baseDir, item);
    const isDir = fs.statSync(fullPath).isDirectory();
    
    // Пропускаем саму папку агента и скрытые папки (вроде .git или .vscode)
    if (isDir && item !== agentFolderName && !item.startsWith('.')) {
        projects.push(item);
    }
}

// Выводим баннер и список только при ручном запуске из консоли
if (!process.env.AUTO_PROJECT) {
    console.log('\n========================================');
    console.log('🤖 DEV-AGENT CLI - СИСТЕМА ИНИЦИАЛИЗАЦИИ');
    console.log('========================================\n');
    console.log('📂 Найдены проекты в рабочей директории:');

    projects.forEach((proj, idx) => {
        console.log(`   [${idx + 1}] ${proj}`);
    });
}

// === ВЫНОСИМ ЛОГИКУ ЗАПУСКА В ОТДЕЛЬНУЮ ФУНКЦИЮ ===
async function initProject(index) {
    if (isNaN(index) || index < 0 || index >= projects.length) {
        console.log('❌ Неверный выбор. Запуск отменен.');
        process.exit(1);
    }

    const selectedProject = projects[index];
    const targetPath = `../${selectedProject}`;

    // Обновляем конфиг Агента, чтобы он знал, куда смотреть
    config.workspace.targetProject = targetPath;
    config.workspace.backupDir = '.dev-agent/backups'; // Бэкапы теперь живут внутри проекта
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    const absoluteTargetPath = path.resolve(process.cwd(), targetPath);
    const devAgentDir = path.join(absoluteTargetPath, '.dev-agent');

    // Проверяем, работал ли Агент с этим проектом раньше
    if (!fs.existsSync(devAgentDir)) {
        console.log(`\n✨ Инициализация нового проекта: ${selectedProject}`);
        fs.mkdirSync(devAgentDir, { recursive: true });
        
        console.log('📚 Создаю ячейки памяти и подготавливаю контекст...');
        try {
            // Если у нас есть генератор индексов - запускаем его
            const { generateIndexes } = await import('./src/fs/docs-generator.js');
            await generateIndexes(targetPath);
            console.log('✅ Индексация завершена!');
        } catch(e) {
            // Если файла генератора пока нет, просто пропускаем
            console.log('⚠️ Модуль авто-индексации пока не подключен. Пропускаю.');
        }
    } else {
        console.log(`\n🔄 Загружаю память проекта: ${selectedProject}`);
    }

    rl.close();

    // Передаем управление в Chat Loop
    const { startCLI } = await import('./src/cli/chat.js');
    
    // 💡 МАГИЯ ДЛЯ TELEGRAM-БОТА: Читаем файл с ТЗ, если он есть
    const taskFilePath = path.join(process.cwd(), 'agent_task.txt');
    if (fs.existsSync(taskFilePath)) {
        const taskText = fs.readFileSync(taskFilePath, 'utf-8').trim();
        if (taskText) {
            console.log('📥 Обнаружено ТЗ от Telegram-бота! Передаю Агенту...');
            // Удаляем файл, чтобы при следующем ручном запуске он не сработал снова
            fs.unlinkSync(taskFilePath); 
            
            // Запускаем CLI, передавая ему текст первого сообщения!
            startCLI(taskText); 
            return;
        }
    }

    // Если файла нет — обычный ручной режим
    startCLI();
}

// === ПРОВЕРЯЕМ РЕЖИМ ЗАПУСКА (АВТО ИЛИ РУЧНОЙ) ===
if (process.env.AUTO_PROJECT) {
    console.log(`🤖 Режим Telegram-бота. Авто-выбор проекта: ${process.env.AUTO_PROJECT}`);
    initProject(parseInt(process.env.AUTO_PROJECT) - 1);
} else {
    rl.question('\n❓ С каким проектом работаем сегодня? (введи цифру): ', (answer) => {
        initProject(parseInt(answer.trim()) - 1);
    });
}