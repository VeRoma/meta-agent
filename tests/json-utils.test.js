import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelJson, parseModelJsonArray } from '../src/core/json-utils.js';

test('json-utils: executor reply must be an object (array / number / string are format errors)', () => {
    for (const bad of ['[{"mode":"chat"}]', '42', '"hello"', 'null', 'true']) {
        assert.throws(() => parseModelJson(bad), undefined, bad);
    }
});

test('json-utils: array parser is for the dispatcher and rejects objects', () => {
    assert.deepEqual(parseModelJsonArray('Вот файлы: ["src/a.js","src/b.js"] — готово'), ['src/a.js', 'src/b.js']);
    assert.deepEqual(parseModelJsonArray('```json\n["a"]\n```'), ['a']);
    assert.deepEqual(parseModelJsonArray('[]'), []);
    assert.throws(() => parseModelJsonArray('{"files":["a"]}'));
    assert.throws(() => parseModelJsonArray('нет списка'));
});

test('json-utils: object extraction ignores an array that appears earlier in the chatter', () => {
    assert.deepEqual(parseModelJson('Файлы [a.js, b.js] изменены. {"mode":"chat","message":"ok"} Конец'), { mode: 'chat', message: 'ok' });
});
