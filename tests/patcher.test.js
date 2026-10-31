import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.META_AGENT_NO_EDITOR = '1'; // do not open VS Code from tests

const { applyPatches, abortSessionPatches, applyRedoPatches } = await import('../src/fs/patcher.js');
const { readFilesContent } = await import('../src/fs/file-manager.js');

function makeProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-agent-test-'));
    fs.mkdirSync(path.join(dir, 'src', '__tests__'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(dir, 'src', '__tests__', 't.js'), 'export const t = 1;\n');
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n');
    return dir;
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf-8');

test('patcher: path traversal is rejected and NOTHING is written (all-or-nothing)', async () => {
    const dir = makeProject();
    const outside = path.join(path.dirname(dir), 'evil-' + path.basename(dir) + '.js');

    const result = await applyPatches(dir, [
        { path: 'src/a.js', content: 'export const a = 2;\n' },   // valid
        { path: '../evil-' + path.basename(dir) + '.js', content: 'export const x = 1;\n' },
    ]);

    assert.equal(result.rejected.length, 1);
    assert.equal(result.applied.length, 0);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');   // valid file untouched too
    assert.ok(!fs.existsSync(outside));
});

test('patcher: protects .env, .git and .meta-agent', async () => {
    const dir = makeProject();
    for (const p of ['.env', '.git/config', '.meta-agent/session.md']) {
        const r = await applyPatches(dir, [{ path: p, content: 'x' }]);
        assert.equal(r.rejected.length, 1, p);
    }
    const d = await applyPatches(dir, [], [{ path: '.env' }]);
    assert.equal(d.rejected.length, 1);
    assert.ok(fs.existsSync(path.join(dir, '.env')));
});

test('patcher: placeholder and broken JS are rejected, file stays intact', async () => {
    const dir = makeProject();
    const r1 = await applyPatches(dir, [{ path: 'src/a.js', content: '// ... (остальной код остается без изменений) ...\n' }]);
    const r2 = await applyPatches(dir, [{ path: 'src/a.js', content: 'export const = ;' }]);
    assert.equal(r1.rejected.length, 1);
    assert.equal(r2.rejected.length, 1);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
});

test('patcher: abort restores edited files (incl. "__tests__" paths), removes created ones; redo brings them back; second abort works', async () => {
    const dir = makeProject();

    const r = await applyPatches(dir, [
        { path: 'src/a.js', content: 'export const a = 2;\n' },
        { path: 'src/__tests__/t.js', content: 'export const t = 2;\n' },
        { path: 'src/new.js', content: 'export const n = 1;\n' },
    ]);
    assert.equal(r.rejected.length, 0);
    // a second edit of a file created in the same session must not "resurrect" it on abort
    await applyPatches(dir, [{ path: 'src/new.js', content: 'export const n = 2;\n' }]);

    await abortSessionPatches(dir);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
    assert.equal(read(dir, 'src/__tests__/t.js'), 'export const t = 1;\n');   // old code mangled this path
    assert.ok(!fs.existsSync(path.join(dir, 'src/new.js')));

    assert.equal(await applyRedoPatches(dir), true);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 2;\n');
    assert.equal(read(dir, 'src/__tests__/t.js'), 'export const t = 2;\n');
    assert.equal(read(dir, 'src/new.js'), 'export const n = 2;\n');

    await abortSessionPatches(dir);                                           // abort after redo still possible
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
    assert.ok(!fs.existsSync(path.join(dir, 'src/new.js')));
});

test('patcher: a file deleted and re-created in one session is restored (not deleted) on abort', async () => {
    const dir = makeProject();
    await applyPatches(dir, [], [{ path: 'src/a.js' }]);
    assert.ok(!fs.existsSync(path.join(dir, 'src/a.js')));
    await applyPatches(dir, [{ path: 'src/a.js', content: 'export const a = 9;\n' }]);
    await abortSessionPatches(dir);
    assert.equal(read(dir, 'src/a.js'), 'export const a = 1;\n');
});

test('file-manager: relative paths resolve against the TARGET project, secrets and outsiders are skipped, duplicates merged', () => {
    const dir = makeProject();
    const ctx = readFilesContent(
        ['src/a.js', path.join(dir, 'src', 'a.js'), '.env', '../outside.js', 'missing.js'],
        dir
    );
    assert.equal((ctx.match(/--- Файл: src\/a\.js ---/g) || []).length, 1);
    assert.ok(ctx.includes('export const a = 1;'));
    assert.ok(!ctx.includes('SECRET'));
});
