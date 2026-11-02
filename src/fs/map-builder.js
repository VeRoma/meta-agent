// meta-agent/src/fs/map-builder.js — адаптер к генератору карты из ai-core.
// Ядро не знает о meta.config.json: целевой проект по умолчанию подставляем здесь.
import { fileURLToPath } from 'url';
import { buildProjectMap as buildMap } from '@veroma/ai-core/map';
import { config } from '../config.js';

export function buildProjectMap(targetDir = null) {
    return buildMap(targetDir || config.workspace.targetProject);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    buildProjectMap(process.argv[2] || null);
}
