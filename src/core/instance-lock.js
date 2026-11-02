import fs from 'fs';
import path from 'path';

function isAlive(pid) {
    try {
        process.kill(pid, 0); // сигнал 0 ничего не делает, только проверяет, что процесс существует
        return true;
    } catch (error) {
        return error.code === 'EPERM'; // процесс есть, но чужой
    }
}

/**
 * Не даёт двум экземплярам Meta-Agent одновременно править один проект
 * (например, задача из Telegram, пока открыт терминал).
 * Lock-файл умершего процесса (агент убит, ПК перезагружен) перехватывается.
 * @param {string} stateDir папка состояния агента внутри проекта (.meta-agent)
 * @returns {{ok: true, release: () => void} | {ok: false, pid: number}}
 */
export function acquireProjectLock(stateDir) {
    const lockPath = path.join(stateDir, 'agent.lock');
    fs.mkdirSync(stateDir, { recursive: true });

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
            const release = () => {
                try {
                    if (fs.readFileSync(lockPath, 'utf-8') === String(process.pid)) fs.unlinkSync(lockPath);
                } catch { /* уже удалён */ }
            };
            process.once('exit', release);
            return { ok: true, release };
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }

        const pid = Number(fs.readFileSync(lockPath, 'utf-8'));
        if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) return { ok: false, pid };
        fs.rmSync(lockPath, { force: true }); // хозяин lock-файла умер — забираем
    }
    throw new Error(`Не удалось захватить ${lockPath}`);
}
