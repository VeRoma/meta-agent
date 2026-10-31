// meta-agent/src/fs/map-builder.js — Прокси к единому генератору карты в ai-core
import { fileURLToPath } from 'url';
import { buildProjectMap } from '../../../ai-core/map-builder.js';

export { buildProjectMap };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    buildProjectMap(process.argv[2] || null);
}