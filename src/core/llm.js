// core/llm.js — адаптер ai-core для Meta-Agent: один AI-фасад на весь процесс.
// createAI хранит ссылку на config.llm, поэтому изменения конфига в рантайме (тесты) видны сразу.
import {
    createAI,
    pickProvider,
    isLocalModel,
    parseModelJson,
    parseModelJsonObject,
    parseModelJsonArray,
} from '@veroma/ai-core';
import { config } from '../config.js';

export const ai = createAI({
    llm: config.llm,
    systemRole: config.prompts.systemRole,
    logPrefix: 'Meta-Agent',
});

export const {
    ask,
    askModel,
    askLocal,
    orchestrate,
    fallbackChain,
    modelForTier,
    translateToEnglish,
    translateToRussianIfEnglish,
} = ai;

export {
    pickProvider,
    isLocalModel,
    parseModelJson,
    parseModelJsonObject,
    parseModelJsonArray,
};
