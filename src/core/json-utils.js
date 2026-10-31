import { parseModelJsonObject, parseModelJsonArray } from '../../../ai-core/json.js';

// Исполнитель обязан вернуть именно ОБЪЕКТ ({mode, plan, ...}). Массив или число в ответе — ошибка формата:
// её нужно отловить и повторить запрос, а не пропустить дальше. Гибкий парсер остаётся в ai-core.
export const parseModelJson = parseModelJsonObject;

// Для диспетчера, которому нужен массив путей
export { parseModelJsonArray };
