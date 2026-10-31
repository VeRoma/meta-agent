import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { buildProjectMap } from './map-builder.js';
import { resolveInside, resolveProjectFile } from './safe-path.js';
import { validateFileUpdate } from './patch-guard.js';

// Функция для получения динамических путей бэкапов
function getPaths(targetProject) {
    const targetAbsolute = path.resolve(process.cwd(), targetProject);
    const metaAgentDir = path.join(targetAbsolute, '.meta-agent');
    return {
        backupDir: path.join(metaAgentDir, 'backups'),
        sessionPath: path.join(metaAgentDir, 'session.md'),
        targetAbsolute
    };
}

// --- Имена бэкапов -----------------------------------------------------------
// v2: encodeURIComponent, чтобы пути вроде "__tests__/a.js" восстанавливались
// однозначно. Старый формат ("src__core__llm.js") читается как legacy.
const BACKUP_PREFIX = 'v2~';
const BACKUP_NAME_RE = /^(.*)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.bak$/;

function encodeBackupName(relativePath) {
    return BACKUP_PREFIX + encodeURIComponent(relativePath.replace(/\\/g, '/'));
}

function decodeBackupName(name) {
    if (name.startsWith(BACKUP_PREFIX)) {
        return decodeURIComponent(name.slice(BACKUP_PREFIX.length));
    }
    return name.replace(/__/g, '/'); // legacy
}

function backupTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

// --- Журнал файлов, созданных в рамках сессии (их при откате нужно удалять) ---
function readCreated(backupDir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(backupDir, 'created.json'), 'utf-8'));
    } catch {
        return [];
    }
}

function writeCreated(backupDir, list) {
    fs.writeFileSync(path.join(backupDir, 'created.json'), JSON.stringify(list, null, 2), 'utf-8');
}

function hasBackup(backupDir, relativePath) {
    const prefix = encodeBackupName(relativePath) + '_';
    return fs.readdirSync(backupDir).some(f => f.startsWith(prefix) && f.endsWith('.bak'));
}

function openInEditor(absolutePath) {
    if (process.env.META_AGENT_NO_EDITOR) return;
    // Путь попадает в shell-строку: не открываем файлы со спецсимволами
    if (/["'`$&|;<>%^\r\n]/.test(absolutePath)) return;
    exec(`code "${absolutePath}"`, () => {});
}

/**
 * Применяет патч по принципу "всё или ничего": сначала валидация всех файлов,
 * и только если всё чисто — запись на диск.
 * @returns {Promise<{applied: string[], rejected: {path: string, reason: string}[]}>}
 */
export async function applyPatches(targetProject, filesToUpdate = [], filesToDelete = []) {
    const { backupDir, targetAbsolute } = getPaths(targetProject);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    // 0. Валидация (ничего не пишем, пока не проверили всё)
    const rejected = [];
    const updates = [];
    const deletions = [];

    for (const file of filesToUpdate) {
        try {
            const { absolutePath, relativePath } = resolveProjectFile(targetAbsolute, file?.path);
            const previous = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf-8') : null;
            const check = validateFileUpdate(relativePath, previous, file?.content);
            if (!check.ok) throw new Error(check.reason);
            updates.push({ absolutePath, relativePath, content: file.content, existed: previous !== null });
        } catch (error) {
            rejected.push({ path: file?.path ?? '(no path)', reason: error.message });
        }
    }

    for (const file of filesToDelete) {
        try {
            const { absolutePath, relativePath } = resolveProjectFile(targetAbsolute, file?.path);
            deletions.push({ absolutePath, relativePath });
        } catch (error) {
            rejected.push({ path: file?.path ?? '(no path)', reason: error.message });
        }
    }

    if (rejected.length > 0) {
        console.log('🛡️ Патч отклонён, ничего не записано:');
        rejected.forEach(r => console.log(`   ✖ ${r.path}: ${r.reason}`));
        return { applied: [], rejected };
    }

    const applied = [];
    const created = readCreated(backupDir);

    // 1. Обновления/создания
    for (const file of updates) {
        if (file.existed) {
            const backupPath = path.join(backupDir, `${encodeBackupName(file.relativePath)}_${backupTimestamp()}.bak`);
            fs.copyFileSync(file.absolutePath, backupPath);
            console.log(`💾 Backup saved: .meta-agent/backups/${path.basename(backupPath)}`);
        } else {
            fs.mkdirSync(path.dirname(file.absolutePath), { recursive: true });
            // Файл, удалённый ранее в этой сессии, имеет бэкап — его нужно восстановить, а не удалить
            if (!created.includes(file.relativePath) && !hasBackup(backupDir, file.relativePath)) {
                created.push(file.relativePath);
            }
        }

        fs.writeFileSync(file.absolutePath, file.content, 'utf-8');
        console.log(`✅ File updated: ${file.relativePath}`);
        applied.push(file.relativePath);
        openInEditor(file.absolutePath);
    }
    writeCreated(backupDir, created);

    // 2. Удаления
    for (const file of deletions) {
        if (fs.existsSync(file.absolutePath) && fs.statSync(file.absolutePath).isFile()) {
            const backupPath = path.join(backupDir, `${encodeBackupName(file.relativePath)}_${backupTimestamp()}.bak`);
            fs.copyFileSync(file.absolutePath, backupPath);
            console.log(`💾 Backup saved (before delete): .meta-agent/backups/${path.basename(backupPath)}`);

            fs.unlinkSync(file.absolutePath);
            console.log(`🗑️ File deleted: ${file.relativePath}`);
            applied.push(file.relativePath);
        } else {
            console.log(`⚠️ Skip deletion: File not found ${file.relativePath}`);
        }
    }

    // 3. Автоматическое обновление карты проекта (именно целевого проекта)
    if (updates.length > 0 || deletions.length > 0) {
        try {
            console.log('[Meta-Agent] 🔄 Обновление карты проекта (PROJECT_MAP.md)...');
            buildProjectMap(targetAbsolute);
        } catch (err) {
            console.error('⚠️ Ошибка при обновлении карты проекта:', err.message);
        }
    }

    return { applied, rejected: [] };
}

function moveBackupsTo(dir, backupDir) {
    fs.mkdirSync(dir, { recursive: true });
    for (const backup of fs.readdirSync(backupDir).filter(f => f.endsWith('.bak'))) {
        fs.renameSync(path.join(backupDir, backup), path.join(dir, backup));
    }
}

export async function abortSessionPatches(targetProject) {
    const { backupDir, sessionPath, targetAbsolute } = getPaths(targetProject);

    if (!fs.existsSync(backupDir)) {
        console.log('⚠️ No backups found for rollback.');
        return;
    }

    const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.bak'));
    const created = readCreated(backupDir);
    if (backups.length === 0 && created.length === 0) {
        console.log('⚠️ No backups found for rollback.');
        return;
    }

    const redoDir = path.join(backupDir, 'redo');
    if (fs.existsSync(redoDir)) fs.rmSync(redoDir, { recursive: true, force: true });
    fs.mkdirSync(redoDir, { recursive: true });

    // Прячем актуальную память ИИ перед откатом
    if (fs.existsSync(sessionPath)) {
        fs.copyFileSync(sessionPath, path.join(redoDir, 'session.bak'));
    }

    // 1. Файлы, созданные в этой сессии: удаляем (копию оставляем для redo)
    const createdSet = new Set(created);
    for (const relativePath of created) {
        let absolutePath;
        try { absolutePath = resolveInside(targetAbsolute, relativePath); } catch { continue; }
        if (!fs.existsSync(absolutePath)) continue;

        fs.copyFileSync(absolutePath, path.join(redoDir, `${encodeBackupName(relativePath)}.redo`));
        fs.unlinkSync(absolutePath);
        console.log(`🗑️ Removed file created in this session: ${relativePath}`);
    }

    // 2. Изменённые/удалённые файлы: восстанавливаем самую старую версию
    const fileGroups = {};
    for (const backup of backups) {
        const match = backup.match(BACKUP_NAME_RE);
        if (!match) continue;
        if (!fileGroups[match[1]]) fileGroups[match[1]] = [];
        fileGroups[match[1]].push(backup);
    }

    for (const [encodedName, backupFiles] of Object.entries(fileGroups)) {
        const relativePath = decodeBackupName(encodedName);
        if (createdSet.has(relativePath)) continue;

        let absolutePath;
        try { absolutePath = resolveInside(targetAbsolute, relativePath); } catch { continue; }

        backupFiles.sort();
        const oldestBackupPath = path.join(backupDir, backupFiles[0]);

        // Прячем изменённый файл для функции redo
        if (fs.existsSync(absolutePath)) {
            fs.copyFileSync(absolutePath, path.join(redoDir, `${encodeBackupName(relativePath)}.redo`));
        }

        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.copyFileSync(oldestBackupPath, absolutePath);
        console.log(`⏪ Restored original file: ${relativePath}`);
        openInEditor(absolutePath);
    }

    // 3. Бэкапы этой сессии переезжают в redo/state — иначе следующий /abort
    //    откатил бы файлы к состоянию до уже отменённой задачи
    moveBackupsTo(path.join(redoDir, 'state'), backupDir);
    writeCreated(path.join(redoDir, 'state'), created);
    writeCreated(backupDir, []);

    console.log('💡 Tip: You can type /redo to cancel this abort and get your changes back.');
}

export async function applyRedoPatches(targetProject) {
    const { backupDir, sessionPath, targetAbsolute } = getPaths(targetProject);
    const redoDir = path.join(backupDir, 'redo');

    if (!fs.existsSync(redoDir)) {
        console.log('⚠️ Nothing to redo.');
        return false;
    }

    const files = fs.readdirSync(redoDir);
    if (files.length === 0) {
        console.log('⚠️ Nothing to redo.');
        return false;
    }

    for (const file of files) {
        // Восстанавливаем память ИИ
        if (file === 'session.bak') {
            fs.copyFileSync(path.join(redoDir, file), sessionPath);
            continue;
        }

        if (file.endsWith('.redo')) {
            const relativePath = decodeBackupName(file.slice(0, -'.redo'.length));
            let absolutePath;
            try { absolutePath = resolveInside(targetAbsolute, relativePath); } catch { continue; }

            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.copyFileSync(path.join(redoDir, file), absolutePath);
            console.log(`⏩ Redo applied: ${relativePath}`);
            openInEditor(absolutePath);
        }
    }

    // Возвращаем бэкапы на место, чтобы после /redo снова можно было сделать /abort
    const stateDir = path.join(redoDir, 'state');
    if (fs.existsSync(stateDir)) {
        for (const f of fs.readdirSync(stateDir).filter(n => n.endsWith('.bak'))) {
            fs.renameSync(path.join(stateDir, f), path.join(backupDir, f));
        }
        const createdFile = path.join(stateDir, 'created.json');
        if (fs.existsSync(createdFile)) {
            fs.copyFileSync(createdFile, path.join(backupDir, 'created.json'));
        }
    }

    fs.rmSync(redoDir, { recursive: true, force: true });
    return true;
}

export function clearSessionBackups() {
    const configPath = path.join(process.cwd(), "meta.config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { backupDir } = getPaths(config.workspace.targetProject);

    if (!fs.existsSync(backupDir)) return;

    moveBackupsTo(path.join(backupDir, 'archive'), backupDir);
    writeCreated(backupDir, []);
}
