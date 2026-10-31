// core/llm.js — Универсальный адаптер ai-core для Meta-Agent и Dev-Agent
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
    createAI,
    pickProvider,
    isLocalModel,
    parseModelJson,
    parseModelJsonObject,
    parseModelJsonArray,
} from '../../../ai-core/index.js';

dotenv.config();

// Автоматически ищем конфиг текущего агента (meta.config.json для MA или agent.config.json для DA)
const cwd = process.cwd();
const isMeta = fs.existsSync(path.join(cwd, 'meta.config.json'));
const configFile = isMeta ? 'meta.config.json' : 'agent.config.json';
const logPrefix = isMeta ? 'Meta-Agent' : 'Dev-Agent';

const config = JSON.parse(fs.readFileSync(path.join(cwd, configFile), 'utf-8'));

export const ai = createAI({
    llm: config.llm,
    systemRole: config.prompts?.systemRole,
    logPrefix,
});

export const {
    ask,
    askModel,
    askLocal,
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