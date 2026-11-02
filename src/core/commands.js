import { execSync } from 'child_process';
import { classifyCommand } from '@veroma/ai-core/safety';
import { confirm } from './io.js';
import { appendToSession } from './session.js';

/**
 * Выполняет команды от модели в целевой директории.
 * Белый список — автоматически, остальное — только с подтверждением. Упавшая команда останавливает пакет.
 */
export async function runCommands(commands, cwd) {
    console.log(`\n⚙️ Meta-Agent выполняет команды в целевой директории:`);
    for (let cmd of commands) {
        if (typeof cmd !== 'string') continue;
        cmd = cmd.replace(/git commit -m '([^']+)'/g, 'git commit -m "$1"');
        console.log(`\n   > ${cmd}`);

        const verdict = classifyCommand(cmd);
        if (verdict.level !== 'safe') {
            const warn = verdict.warning ? `   ⚠️ Риск: ${verdict.warning}\n` : '';
            const approved = await confirm(`🛡️ Команда вне белого списка.\n${warn}   Разрешить выполнение? (y/N): `);
            if (!approved) {
                console.log(`⛔ Команда пропущена.`);
                appendToSession('agent', `[COMMAND DENIED]: ${cmd}`);
                continue;
            }
        }

        console.log(`⏳ Running...`);
        try {
            execSync(cmd, { stdio: 'inherit', cwd });
            console.log(`✅ Done.`);
            appendToSession('agent', `[COMMAND EXECUTED]: ${cmd}`);
        } catch (err) {
            console.log(`❌ Command failed.`);
            appendToSession('agent', `[COMMAND FAILED]: ${cmd}\nError: ${err.message}`);
            break;
        }
    }
}
