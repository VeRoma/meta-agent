import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

function hasRealTestScript(cwd) {
    try {
        const script = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')).scripts?.test;
        return Boolean(script) && !/no test specified/i.test(script);
    } catch {
        return false;
    }
}

/** Запускает `npm test` целевого проекта. Нет скрипта test — предупреждение, а не ошибка кода. */
export function runTests(targetProjectFolder) {
    const targetAbsolute = path.resolve(process.cwd(), targetProjectFolder);

    if (!hasRealTestScript(targetAbsolute)) {
        return Promise.resolve({ success: true, output: '', warnings: ['в целевом проекте нет скрипта "test" — тесты пропущены'] });
    }

    return new Promise((resolve) => {
        // Команда фиксированная, без данных от модели — shell здесь безопасен
        exec('npm test', { cwd: targetAbsolute, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                // Хвост вывода — самое важное (итоги и упавшие тесты), лишнее режем
                return resolve({ success: false, output: (stdout + '\n' + stderr).slice(-4000) });
            }
            resolve({ success: true, output: stdout });
        });
    });
}
