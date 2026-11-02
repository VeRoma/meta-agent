import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { orchestrate, translateToEnglish } from './llm.js';
import { buildProjectMap } from '../fs/map-builder.js';

// Теги в тексте задачи, которые принудительно выбирают исполнителя (уровень из llm.tiers)
const MODEL_TAGS = {
    ds: 'fast', deepseek: 'fast',
    ge: 'pro', gemini: 'pro',
    cl: 'arch', claude: 'arch',
};

export function extractMentions(text) {
    return [...String(text).matchAll(/(?<![\w.])@([a-zA-Z0-9_.\-\/]+)/g)]
        .map(m => m[1].replace(/[.,;:]+$/, ''))
        .filter(m => m && !(m.toLowerCase() in MODEL_TAGS));
}

/** Последний тег модели в тексте («@claude»), или null. */
export function tierFromTags(text) {
    // «@ds.js» или «@ds/x» — это файл, а не тег; точка в конце предложения («@claude.») — тег
    const tags = [...String(text).matchAll(/(?<![\w.])@([a-zA-Z]+)(?![\w\/-]|\.\w)/g)]
        .map(m => m[1].toLowerCase())
        .filter(tag => tag in MODEL_TAGS);
    return tags.length > 0 ? MODEL_TAGS[tags.at(-1)] : null;
}

export function resolveMention(mention, allProjectFiles) {
    const cleanMention = mention.replace(/^(\.\.\/)+/, '');
    return allProjectFiles.find(f => {
        const normalizedPath = f.replace(/\\/g, '/');
        const base = path.basename(normalizedPath);
        const nameWithoutExt = base.replace(/\.[^/.]+$/, '');
        return (
            base === mention ||
            nameWithoutExt === mention ||
            normalizedPath === mention ||
            normalizedPath.endsWith(mention) ||
            normalizedPath.endsWith(cleanMention)
        );
    });
}

/** Читает PROJECT_MAP.md целевого проекта (строит, если его нет) и список известных файлов. */
export function readProjectMap(targetAbsolute) {
    const mapPath = path.join(targetAbsolute, 'PROJECT_MAP.md');
    if (!fs.existsSync(mapPath)) buildProjectMap(targetAbsolute);
    if (!fs.existsSync(mapPath)) return { projectMapContent: 'PROJECT MAP UNAVAILABLE.', allProjectFiles: [] };

    const projectMapContent = fs.readFileSync(mapPath, 'utf-8');
    const allProjectFiles = projectMapContent
        .split('\n')
        .filter(line => line.startsWith('### 📄 '))
        // Заголовок кода: "### 📄 src/a.js (42 lines)" — счётчик строк не часть пути
        .map(line => line.replace('### 📄 ', '').replace(/\s+\(\d+ lines\)\s*$/, '').trim());
    return { projectMapContent, allProjectFiles };
}

/** Оставляет только файлы из карты проекта: выдуманные моделью пути отбрасываются с предупреждением. */
export function keepKnownFiles(files, allProjectFiles) {
    const known = new Set(allProjectFiles);
    const kept = [];
    for (const raw of files) {
        const file = String(raw).replace(/\\/g, '/').replace(/^\.\//, '');
        if (known.has(file)) kept.push(file);
        else console.log(`⚠️ Оркестратор предложил файл, которого нет в PROJECT_MAP: ${raw} — пропускаю`);
    }
    return kept;
}

/**
 * Собирает контекст задачи: карта, файлы, исполнитель и формулировка.
 * На depth > 0 (авто-подгрузка файлов) оркестратор не вызывается: продолжаем с тем же исполнителем.
 */
export async function selectContext(text, { depth = 0, inheritedFiles = [], tier = null, forceFullAudit = false } = {}) {
    const targetAbsolute = config.workspace.targetProject;
    const { projectMapContent, allProjectFiles } = readProjectMap(targetAbsolute);

    const forcedFiles = [];
    for (const mention of extractMentions(text)) {
        const matched = resolveMention(mention, allProjectFiles);
        if (matched) {
            forcedFiles.push(matched);
            console.log(`📌 Explicitly included: ${matched}`);
        } else {
            console.log(`⚠️ Mentioned file not found in PROJECT_MAP: ${mention}`);
        }
    }

    const base = { projectMapContent, allProjectFiles };
    const tagTier = tierFromTags(text);

    if (depth > 0) {
        console.log('⚡ Пропуск Оркестратора: используем накопленный контекст + запрошенные @файлы.');
        return {
            ...base,
            relevantFiles: [...new Set([...inheritedFiles, ...forcedFiles])],
            tier: tagTier ?? tier ?? 'fast',
            task: text,
            subtask: null,
        };
    }

    // Перевод нужен только для текста разработчика; системные сообщения уже на английском
    const task = text.startsWith('[SYSTEM') ? text : await translateToEnglish(text);

    console.log('✨ [GE Orchestrator] Анализирую задачу и выбираю оптимальную модель...');
    let decision;
    try {
        decision = await orchestrate({ task, projectMap: projectMapContent });
    } catch (error) {
        console.log(`⚠️ Оркестратор недоступен (${error.message}). Продолжаю без него: только @файлы, исполнитель по умолчанию.`);
        decision = { files: [], tier: 'fast', delegateTo: 'ds', reason: 'orchestrator unavailable', subtaskPrompt: null };
    }

    let selectedTier = decision.tier;
    if (tagTier) {
        selectedTier = tagTier;
    } else if (forceFullAudit && selectedTier === 'fast') {
        selectedTier = 'pro'; // полный аудит не помещается в ответ быстрой модели
    }

    const routedFiles = keepKnownFiles(decision.files, allProjectFiles);

    console.log(`\n========================================`);
    console.log(`🎯 ВЕРДИКТ ОРКЕСТРАТОРА (GE):`);
    console.log(`- Исполнитель          : [${selectedTier.toUpperCase()}]${tagTier ? ' (задан тегом в задаче)' : ''}`);
    console.log(`- Рекомендация файлов  : ${routedFiles.join(', ') || 'нет'}`);
    console.log(`- Причина выбора       : ${decision.reason}`);
    console.log(`========================================\n`);

    return {
        ...base,
        relevantFiles: [...new Set([...inheritedFiles, ...forcedFiles, ...routedFiles])],
        tier: selectedTier,
        task,
        subtask: decision.subtaskPrompt,
    };
}
