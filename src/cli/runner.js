import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const OUTPUT_TAIL = 8000;   // сколько последнего вывода держать для модели
let currentProcess = null;
let lastErrorAt = 0;        // антиспам: не дёргаем авто-исправление чаще, чем раз в 5 секунд
let logTailInterval = null;

// Падение, а не просто слово «error» в логе: строка обработанной ошибки, «0 failed»
// или логгер с errorHandler не должны запускать правку кода.
const NODE_CRASH_RE = /\[nodemon\] app crashed/i;
const JAVA_STARTUP_FAILURE_RE = /APPLICATION FAILED TO START|BUILD FAILURE|Error starting ApplicationContext|Exception in thread "main"/;

/** nodemon и подобные не завершаются при падении приложения, а ждут изменений — это тоже падение. */
export function isNodeCrashOutput(text) {
    return NODE_CRASH_RE.test(text);
}

/** Spring Boot / Maven: только признаки того, что приложение не поднялось. */
export function isJavaStartupFailure(text) {
    return JAVA_STARTUP_FAILURE_RE.test(text);
}

function reportCrash(onErrorCallback, log) {
    const now = Date.now();
    if (now - lastErrorAt <= 5000) return;
    lastErrorAt = now;
    onErrorCallback(log.slice(-OUTPUT_TAIL));
}

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

    if (isJava) {
        // --- РЕЖИМ JAVA (SPRING BOOT) ---
        try {
            execSync('powershell -ExecutionPolicy Bypass -File .\\stop.ps1', { cwd: runPath, stdio: 'ignore' });
        } catch(e) {}

        console.log("⚙️ Выполняю start.ps1...");
        execSync('powershell -ExecutionPolicy Bypass -File .\\start.ps1', { cwd: runPath });

        currentProcess = { isJava: true, runPath };
        let log = '';

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
                        stream.on('data', (chunk) => {
                            const output = chunk.toString();
                            process.stdout.write(`[TARGET] ${output}`);
                            log = (log + output).slice(-OUTPUT_TAIL);
                            if (isJavaStartupFailure(output)) reportCrash(onErrorCallback, log);
                        });
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

        const child = spawn('npm', ['run', runCmd], { cwd: runPath, shell: true });
        currentProcess = child;
        let log = '';

        const onOutput = (data) => {
            const output = data.toString();
            process.stdout.write(`[TARGET] ${output}`);
            log = (log + output).slice(-OUTPUT_TAIL);
            if (isNodeCrashOutput(output)) reportCrash(onErrorCallback, log);
        };
        child.stdout.on('data', onOutput);
        child.stderr.on('data', onOutput);

        child.on('close', (code) => {
            // Обнуляем только если это всё ещё ТЕКУЩИЙ процесс (после рестарта старый закрывается позже нового)
            if (currentProcess === child) currentProcess = null;
            // Остановка через /stop или рестарт — не падение (taskkill тоже даёт ненулевой код)
            if (child.stoppedByAgent) return;
            if (code !== 0 && code !== null) {
                console.log(`\n💥 Целевой процесс завершился с кодом ${code}.`);
                reportCrash(onErrorCallback, log);
            }
        });
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
            currentProcess.stoppedByAgent = true;
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
