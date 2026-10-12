import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { buildProjectMap } from './map-builder.js'; // 👈 Добавлен импорт генератора карты

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

export async function applyPatches(targetProject, filesToUpdate = [], filesToDelete = []) {
    const { backupDir, targetAbsolute } = getPaths(targetProject);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    // 1. Обработка обновлений/созданий файлов
    for (const file of filesToUpdate) {
        const absolutePath = path.join(targetAbsolute, file.path);
        const safeRelativePath = file.path.replace(/[\/\\]/g, '__');

        if (fs.existsSync(absolutePath)) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(backupDir, `${safeRelativePath}_${timestamp}.bak`);
            
            fs.copyFileSync(absolutePath, backupPath);
            console.log(`💾 Backup saved: .meta-agent/backups/${path.basename(backupPath)}`);
        } else {
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        }

        fs.writeFileSync(absolutePath, file.content, 'utf-8');
        console.log(`✅ File updated: ${file.path}`);

        try { exec(`code "${absolutePath}"`); } catch (error) {}
    }

    // 2. Обработка удалений
    for (const file of filesToDelete) {
        const absolutePath = path.join(targetAbsolute, file.path);
        const safeRelativePath = file.path.replace(/[\/\\]/g, '__');

        if (fs.existsSync(absolutePath)) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(backupDir, `${safeRelativePath}_${timestamp}.bak`);
            
            fs.copyFileSync(absolutePath, backupPath);
            console.log(`💾 Backup saved (before delete): .meta-agent/backups/${path.basename(backupPath)}`);
            
            fs.unlinkSync(absolutePath);
            console.log(`🗑️ File deleted: ${file.path}`);
        } else {
            console.log(`⚠️ Skip deletion: File not found ${file.path}`);
        }
    }

    // 3. Автоматическое обновление карты проекта (ДОБАВЛЕНО)
    if (filesToUpdate.length > 0 || filesToDelete.length > 0) {
        try {
            console.log('[Meta-Agent] 🔄 Обновление карты проекта (PROJECT_MAP.md)...');
            buildProjectMap();
        } catch (err) {
            console.error('⚠️ Ошибка при обновлении карты проекта:', err.message);
        }
    }
}

export async function abortSessionPatches(targetProject) {
    const { backupDir, sessionPath, targetAbsolute } = getPaths(targetProject);
    
    if (!fs.existsSync(backupDir)) {
        console.log('⚠️ No backups found for rollback.');
        return;
    }

    const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.bak'));
    if (backups.length === 0) {
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

    const fileGroups = {};
    for (const backup of backups) {
        const match = backup.match(/^(.*)_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.bak$/);
        if (!match) continue;
        
        const safeRelativePath = match[1];
        if (!fileGroups[safeRelativePath]) fileGroups[safeRelativePath] = [];
        fileGroups[safeRelativePath].push(backup);
    }

    for (const [safeRelativePath, backupFiles] of Object.entries(fileGroups)) {
        backupFiles.sort(); 
        const oldestBackup = backupFiles[0];

        const relativePath = safeRelativePath.replace(/__/g, '/');
        const absolutePath = path.resolve(targetAbsolute, relativePath);
        const oldestBackupPath = path.join(backupDir, oldestBackup);

        // Прячем измененный файл для функции redo
        if (fs.existsSync(absolutePath)) {
            fs.copyFileSync(absolutePath, path.join(redoDir, `${safeRelativePath}.redo`));
        }

        fs.copyFileSync(oldestBackupPath, absolutePath);
        console.log(`⏪ Restored original file: ${relativePath}`);
        
        try { exec(`code "${absolutePath}"`); } catch (e) {}
    }

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
            const safeRelativePath = file.replace('.redo', '');
            const relativePath = safeRelativePath.replace(/__/g, '/');
            const absolutePath = path.resolve(targetAbsolute, relativePath);

            fs.copyFileSync(path.join(redoDir, file), absolutePath);
            console.log(`⏩ Redo applied: ${relativePath}`);
            try { exec(`code "${absolutePath}"`); } catch (e) {}
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
    
    const archiveDir = path.join(backupDir, 'archive');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

    const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.bak'));
    for (const backup of backups) {
        fs.renameSync(path.join(backupDir, backup), path.join(archiveDir, backup));
    }
}