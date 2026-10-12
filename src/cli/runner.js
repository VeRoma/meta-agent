import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

let currentProcess = null;
let logTailInterval = null;

export function runDevServer(targetPath, onErrorCallback) {
    if (currentProcess) {
        console.log("\n⚠️ Процесс уже запущен. Введите /stop для остановки.");
        return;
    }

    let runPath = path.resolve(process.cwd(), targetPath);
    let isJava = false;

    // Автопоиск скриптов PowerShell для Java/Spring Boot
    if (fs.existsSync(path.join(runPath, 'backend', 'start.ps1'))) {
        runPath = path.join(runPath, 'backend');
        isJava = true;
    } else if (fs.existsSync(path.join(runPath, 'start.ps1'))) {
        isJava = true;
    } else if (!fs.existsSync(path.join(runPath, 'package.json'))) {
        const items = fs.readdirSync(runPath);
        for (const item of items) {
            const subPath = path.join(runPath, item);
            if (fs.statSync(subPath).isDirectory() && fs.existsSync(path.join(subPath, 'package.json'))) {
                runPath = subPath;
                break;
            }
        }
    }

    console.log(`\n🚀 Запускаю процесс в: ${runPath}`);

    const processOutput = (data) => {
        const output = data.toString();
        process.stdout.write(`[TARGET] ${output}`);
        
        const lowerOutput = output.toLowerCase();
        if ((lowerOutput.includes('error') && !lowerOutput.includes('0 errors')) || 
            lowerOutput.includes('failed') || 
            lowerOutput.includes('exception') || 
            lowerOutput.includes('build failure')) {
            
            onErrorCallback(output);
        }
    };

    if (isJava) {
        // --- РЕЖИМ JAVA (SPRING BOOT) ---
        try {
            execSync('powershell -ExecutionPolicy Bypass -File .\\stop.ps1', { cwd: runPath, stdio: 'ignore' });
        } catch(e) {}

        console.log("⚙️ Выполняю start.ps1...");
        execSync('powershell -ExecutionPolicy Bypass -File .\\start.ps1', { cwd: runPath });
        
        currentProcess = { isJava: true, runPath };

        // Ищем свежий лог-файл (server_*.log)
        setTimeout(() => {
            const files = fs.readdirSync(runPath).filter(f => f.startsWith('server_') && f.endsWith('.log'));
            if (files.length > 0) {
                const latestLog = path.join(runPath, files.sort().reverse()[0]);
                let lastSize = fs.statSync(latestLog).size;
                
                logTailInterval = setInterval(() => {
                    if (!fs.existsSync(latestLog)) return;
                    const currentSize = fs.statSync(latestLog).size;
                    
                    if (currentSize > lastSize) {
                        const stream = fs.createReadStream(latestLog, { start: lastSize, end: currentSize });
                        stream.on('data', (chunk) => processOutput(chunk));
                        lastSize = currentSize;
                    }
                }, 1000);
            }
        }, 2000);

    } else {
        // --- РЕЖИМ NODE.JS ---
        let runCmd = 'dev'; // Значение по умолчанию
        
        const pkgPath = path.join(runPath, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                if (pkg.scripts) {
                    // Ищем доступные скрипты в порядке приоритета
                    if (pkg.scripts.dev) runCmd = 'dev';
                    else if (pkg.scripts.start) runCmd = 'start';
                    else if (pkg.scripts.agent) runCmd = 'agent';
                }
            } catch(e) {
                console.log("⚠️ Ошибка чтения package.json целевого проекта");
            }
        }
        
        console.log(`⚙️ Выполняю npm run ${runCmd}...`);
        
        currentProcess = spawn('npm', ['run', runCmd], { cwd: runPath, shell: true });
        currentProcess.stdout.on('data', processOutput);
        currentProcess.stderr.on('data', processOutput);
        currentProcess.on('close', () => { currentProcess = null; });
    }
}

export function stopDevServer() {
    if (currentProcess) {
        console.log("\n🛑 Убиваю целевой процесс...");
        if (currentProcess.isJava) {
            try {
                execSync('powershell -ExecutionPolicy Bypass -File .\\stop.ps1', { cwd: currentProcess.runPath, stdio: 'ignore' });
            } catch(e) {}
            if (logTailInterval) { clearInterval(logTailInterval); logTailInterval = null; }
        } else {
            if (process.platform === 'win32') {
                spawn("taskkill", ["/pid", currentProcess.pid, '/f', '/t']);
            } else {
                currentProcess.kill();
            }
        }
        currentProcess = null;
    } else {
        console.log("\n⚠️ Нет запущенных процессов.");
    }
}