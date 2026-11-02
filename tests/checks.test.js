import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runLinter } from '../src/core/linter.js';
import { runTests } from '../src/core/tester.js';
import { tierFromTags, extractMentions, keepKnownFiles } from '../src/core/context.js';

function makeProject({ eslintExitCode = null, eslintConfig = true, scripts = {} } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-agent-checks-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't', scripts }));
    if (eslintConfig) fs.writeFileSync(path.join(dir, 'eslint.config.js'), 'export default [];\n');
    if (eslintExitCode !== null) {
        // Поддельный ESLint: записывает полученные аргументы и выходит с заданным кодом
        const bin = path.join(dir, 'node_modules', 'eslint', 'bin');
        fs.mkdirSync(bin, { recursive: true });
        fs.writeFileSync(path.join(bin, 'eslint.js'),
            `require('fs').writeFileSync(${JSON.stringify(path.join(dir, 'argv.json'))}, JSON.stringify(process.argv.slice(2)));\n` +
            `console.log('lint output');\nprocess.exit(${eslintExitCode});\n`);
    }
    return dir;
}

test('linter: missing ESLint or its config is a warning, not a code error', async () => {
    const noEslint = await runLinter(makeProject(), [{ path: 'a.js' }]);
    assert.equal(noEslint.success, true);
    assert.match(noEslint.warnings.join(), /ESLint не установлен/);

    const noConfig = await runLinter(makeProject({ eslintExitCode: 0, eslintConfig: false }), [{ path: 'a.js' }]);
    assert.equal(noConfig.success, true);
    assert.match(noConfig.warnings.join(), /нет конфига ESLint/);

    const nonJs = await runLinter(makeProject(), [{ path: 'README.md' }]);
    assert.deepEqual(nonJs, { success: true, warnings: [] });
});

test('linter: exit 1 = code errors; exit 2 = ESLint failure, reported as a warning', async () => {
    const errors = await runLinter(makeProject({ eslintExitCode: 1 }), [{ path: 'a.js' }]);
    assert.equal(errors.success, false);
    assert.match(errors.error, /\[ESLint Error\]/);

    const crashed = await runLinter(makeProject({ eslintExitCode: 2 }), [{ path: 'a.js' }]);
    assert.equal(crashed.success, true);
    assert.match(crashed.warnings.join(), /кодом 2/);
});

test('linter: file names from the model are passed as arguments, never through a shell', async () => {
    const dir = makeProject({ eslintExitCode: 0 });
    const evil = 'src/a" & echo pwned > pwned.txt & ".js';

    await runLinter(dir, [{ path: evil }, { path: '-rf.js' }]);

    const argv = JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf-8'));
    assert.ok(argv.includes(path.resolve(dir, evil)), 'the name arrives intact as one argument');
    assert.ok(argv.slice(1).every(a => path.isAbsolute(a)), 'no file name can look like an option');
    assert.ok(!fs.existsSync(path.join(dir, 'pwned.txt')), 'nothing was executed');
});

test('tester: no real "test" script is a warning', async () => {
    for (const scripts of [{}, { test: 'echo "Error: no test specified" && exit 1' }]) {
        const result = await runTests(makeProject({ scripts }));
        assert.equal(result.success, true);
        assert.match(result.warnings.join(), /нет скрипта "test"/);
    }
});

test('context: model tags vs file mentions', () => {
    assert.equal(tierFromTags('@claude fix it'), 'arch');
    assert.equal(tierFromTags('use @ds.'), 'fast');
    assert.equal(tierFromTags('@ds then @gemini'), 'pro', 'the last tag wins');
    assert.equal(tierFromTags('look at @ds.js and @claude/x.js'), null, 'files are not tags');
    assert.equal(tierFromTags('mail me at a@claude.com'), null);
    assert.deepEqual(extractMentions('@claude fix @src/a.js, and @ds.js'), ['src/a.js', 'ds.js']);
});

test('context: only files from PROJECT_MAP survive', () => {
    const known = ['src/a.js', 'b.js'];
    assert.deepEqual(keepKnownFiles(['./src/a.js', 'src\\a.js', '../../etc/passwd', 'ghost.js', 'b.js'], known),
        ['src/a.js', 'src/a.js', 'b.js']);
});
