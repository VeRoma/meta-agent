import { parseModelJsonObject, parseModelJsonArray } from '@veroma/ai-core/json';

// Исполнитель обязан вернуть именно ОБЪЕКТ ({mode, plan, ...}). Массив или число в ответе — ошибка формата:
// её нужно отловить и повторить запрос, а не пропустить дальше. Гибкий парсер остаётся в ai-core.
export const parseModelJson = parseModelJsonObject;

// Для диспетчера, которому нужен массив путей
export { parseModelJsonArray };
