import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// До импорта модулей: ключи-заглушки (dotenv не перезаписывает заданные), без VS Code
process.env.META_AGENT_NO_EDITOR = '1';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DEEPSEEK_API_KEY = 'test-key';
process.env.CLAUDE_API_KEY = 'test-key';

const { config, setTargetProject } = await import('../src/config.js');
const { processAgentTask } = await import('../src/core/task-runner.js');
const { initSession, getSession } = await import('../src/core/session.js');
const { setConfirmHandler } = await import('../src/core/io.js');

const realFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = realFetch; });

const TEST_LLM = {
    orchestratorModel: 'gemini-orchestrator',
    tiers: { local: 'qwen-test', fast: 'deepseek-test', pro: 'gemini-executor', arch: 'claude-test' },
    cloudFallbacks: [], // детерминированно: без перехода на запасные модели
};

function makeProject(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-agent-e2e-'));
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
    }
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t","scripts":{}}');
    setTargetProject(dir);
    for (const key of Object.keys(config.llm)) delete config.llm[key]; // AI-фасад держит ссылку на этот объект
    Object.assign(config.llm, structuredClone(TEST_LLM));
    initSession('e2e');
    setConfirmHandler(async () => false);
    return dir;
}

/**
 * Подменяет сеть. orchestrator(n) и executor(n, prompt) возвращают текст ответа модели или Error.
 * Лог: какие провайдеры вызывались исполнителем и с какими промптами.
 */
function mockNetwork({ orchestrator, executor }) {
    const log = { executor: [], orchestratorCalls: 0 };
    const ok = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
    const fail = (error) => ({ ok: false, status: 500, text: async () => error.message });

    globalThis.fetch = async (url, opts) => {
        url = String(url);
        const body = JSON.parse(opts.body);

        if (url.includes('11434')) { // локальный переводчик: возвращаем текст как есть
            return ok({ response: body.prompt.split('\n').pop() });
        }

        let provider, prompt;
        if (url.includes('generativelanguage')) {
            if (body.systemInstruction?.parts[0].text.includes('Task Orchestrator')) {
                const reply = orchestrator(++log.orchestratorCalls);
                return reply instanceof Error ? fail(reply) : ok({ candidates: [{ content: { parts: [{ text: reply }] } }] });
            }
            provider = 'gemini';
            prompt = body.contents[0].parts[0].text;
        } else if (url.includes('deepseek')) {
            provider = 'deepseek';
            prompt = body.messages.at(-1).content;
        } else if (url.includes('anthropic')) {
            provider = 'claude';
            prompt = body.messages.at(-1).content;
        } else {
            throw new Error(`unexpected request: ${url}`);
        }

        log.executor.push({ provider, prompt });
        const reply = executor(log.executor.length, prompt);
        if (reply instanceof Error) return fail(reply);
        if (provider === 'gemini') return ok({ candidates: [{ content: { parts: [{ text: reply }] } }] });
        if (provider === 'claude') return ok({ content: [{ type: 'text', text: reply }] });
        return ok({ choices: [{ message: { content: reply } }] });
    };
    return log;
}

const decision = (obj) => () => JSON.stringify({ files: [], delegateTo: 'ds', reason: 'test', subtaskPrompt: 'do it', ...obj });

test('e2e patch: junk paths dropped; executor sees task AND plan; placeholder rejected -> broken JSON retried -> valid patch; risky command denied; missing ESLint/tests are warnings', async () => {
    const dir = makeProject({ 'src/a.js': 'export const a = 1;\nexport function hello() { return "hi"; }\n' });
    const script = [
        { mode: 'patch', message: 'ленивый патч', filesToUpdate: [{ path: 'src/a.js', content: '// ... (остальной код остается без изменений) ...\n' }] },
        'Sure, here is the patch: {oops this is not json',
        { mode: 'patch', message: 'Добавил multiply', plan: ['1. добавляю функцию'],
          filesToUpdate: [{ path: 'src/a.js', content: 'export const a = 1;\nexport function hello() { return "hi"; }\nexport const multiply = (x, y) => x * y;\n' }],
          commandsToRun: ['rm -rf src', 'node --check src/a.js'] },
    ];
    const log = mockNetwork({
        orchestrator: decision({ files: ['src/a.js', '../../etc/passwd', 'ghost.js'], subtaskPrompt: 'ORCHESTRATOR PLAN: add multiply(x, y)' }),
        executor: (n) => (typeof script[n - 1] === 'string' ? script[n - 1] : JSON.stringify(script[n - 1])),
    });

    await processAgentTask('add a multiply function to the module');

    const prompts = log.executor.map(p => p.prompt);
    assert.equal(prompts.length, 3, '1) placeholder patch  2) broken JSON  3) retry returns the valid patch');
    assert.deepEqual([...new Set(log.executor.map(p => p.provider))], ['deepseek'], 'orchestrator chose ds');
    assert.ok(prompts[0].includes('export function hello()'), 'file content must reach the model');
    assert.ok(!prompts[0].includes('passwd') && !prompts[0].includes('--- Файл: ghost.js'), 'junk paths must be dropped');
    assert.ok(prompts[0].includes('add a multiply function to the module'), 'the original task must reach the executor');
    assert.ok(prompts[0].includes('ORCHESTRATOR PLAN'), 'the orchestrator plan must reach the executor');
    assert.ok(prompts[1].includes('NOTHING was written'), 'rejection reason must be fed back');
    assert.ok(prompts[2].includes('NOT valid JSON'), 'broken JSON must trigger one retry with a hint');

    assert.ok(fs.readFileSync(path.join(dir, 'src/a.js'), 'utf-8').includes('multiply'));
    const session = getSession();
    assert.ok(session.includes('[COMMAND DENIED]: rm -rf src'));
    assert.ok(fs.existsSync(path.join(dir, 'src/a.js')), 'rm -rf src must NOT have run');
    assert.ok(session.includes('[COMMAND EXECUTED]: node --check src/a.js'));
    assert.ok(session.includes('[PATCH APPLIED SUCCESSFULLY]'), 'missing ESLint/tests must not trigger self-healing');
    assert.ok(fs.readFileSync(path.join(dir, 'PROJECT_MAP.md'), 'utf-8').includes('multiply'), 'map is refreshed after the patch');
});

test('e2e tags: @claude overrides the orchestrator and the executor is kept when files are auto-loaded', async () => {
    makeProject({ 'f1.js': 'export const v1 = 1;\n', 'f2.js': 'export const v2 = 2;\n' });
    const log = mockNetwork({
        orchestrator: decision({ delegateTo: 'ds', tier: 'fast', files: ['f1.js'] }),
        executor: (n) => JSON.stringify(n === 1 ? { mode: 'chat', message: 'Нужен ещё @f2.js' } : { mode: 'chat', message: 'Готово' }),
    });

    await processAgentTask('@claude explain the code');

    assert.deepEqual(log.executor.map(p => p.provider), ['claude', 'claude'], 'tag wins, and depth 1 stays on Claude');
    assert.ok(log.executor[1].prompt.includes('export const v2'), 'requested file is loaded');
    assert.equal(log.orchestratorCalls, 1, 'the orchestrator is not called again on auto-loading');
});

test('e2e chat: automatic file loading is capped (no endless @-recursion)', async () => {
    const files = {};
    for (let i = 1; i <= 8; i++) files[`f${i}.js`] = `export const v${i} = ${i};\n`;
    makeProject(files);
    const log = mockNetwork({
        orchestrator: decision({ files: ['f1.js'] }),
        executor: (n) => JSON.stringify({ mode: 'chat', message: `Нужен ещё @f${n + 1}.js` }),
    });

    await processAgentTask('explain @f1.js');

    assert.equal(log.executor.length, 4, 'depth 0..3, then the limit stops the chain');
});

test('e2e orchestrator down: the task still runs on the default executor with @-mentioned files', async () => {
    makeProject({ 'a.js': 'export const a = 1;\n' });
    const log = mockNetwork({
        orchestrator: () => new Error('Gemini down'),
        executor: () => JSON.stringify({ mode: 'chat', message: 'Ответ' }),
    });

    await processAgentTask('explain @a.js');

    assert.deepEqual(log.executor.map(p => p.provider), ['deepseek']);
    assert.ok(log.executor[0].prompt.includes('export const a = 1;'));
});

test('e2e /audit: a full audit is never given to the fast tier', async () => {
    makeProject({ 'a.js': 'export const a = 1;\n' });
    const log = mockNetwork({
        orchestrator: decision({ delegateTo: 'ds', tier: 'fast' }),
        executor: () => JSON.stringify({ mode: 'chat', message: 'Отчёт' }),
    });

    await processAgentTask('audit everything', 0, [], { forceFullAudit: true });

    assert.deepEqual(log.executor.map(p => p.provider), ['gemini']);
});
