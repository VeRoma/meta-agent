import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

let currentProcess = null;

export function runDevServer(targetPath, onErrorCallback) {
    if (currentProcess) {
        console.log("\n⚠️ Сервер уже запущен. Введите /stop для остановки.");
        return;
    }

    let runPath = path.resolve(process.cwd(), targetPath);
    
    // Автопоиск папки с package.json (специально для твоего монорепозитория)
    if (!fs.existsSync(path.join(runPath, 'package.json'))) {
        const items = fs.readdirSync(runPath);
        for (const item of items) {
            const subPath = path.join(runPath, item);
            if (fs.statSync(subPath).isDirectory() && fs.existsSync(path.join(subPath, 'package.json'))) {
                runPath = subPath;
                break;
            }
        }
    }

    console.log(`\n🚀 Запускаю фоновый процесс в: ${runPath}`);
    
    // Запускаем сервер асинхронно
    currentProcess = spawn('npm', ['run', 'dev'], { 
        cwd: runPath, 
        shell: true 
    });

    let errorBuffer = "";
    let errorTimer = null;

    const processOutput = (data) => {
        const output = data.toString();
        process.stdout.write(`[SERVER] ${output}`);
        
        // Эвристика: ищем ошибки в логах терминала
        const lowerOutput = output.toLowerCase();
        if ((lowerOutput.includes('error') && !lowerOutput.includes('0 errors')) || lowerOutput.includes('failed')) {
            errorBuffer += output + "\n";
            
            // Собираем ошибки 2 секунды (чтобы не спамить Агента на каждую строчку лога)
            if (!errorTimer) {
                errorTimer = setTimeout(() => {
                    onErrorCallback(errorBuffer);
                    errorBuffer = "";
                    errorTimer = null;
                }, 2000);
            }
        }
    };

    currentProcess.stdout.on('data', processOutput);
    currentProcess.stderr.on('data', processOutput);

    currentProcess.on('close', (code) => {
        console.log(`\n🛑 Процесс завершен (код ${code}).`);
        currentProcess = null;
    });
}

export function stopDevServer() {
    if (currentProcess) {
        console.log("\n🛑 Убиваю процесс сервера...");
        // Жестко убиваем процесс на Windows, чтобы освободить порт 5173
        if (process.platform === 'win32') {
            spawn("taskkill", ["/pid", currentProcess.pid, '/f', '/t']);
        } else {
            currentProcess.kill();
        }
        currentProcess = null;
    } else {
        console.log("\n⚠️ Нет запущенных серверов.");
    }
}