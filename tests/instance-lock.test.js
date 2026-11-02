import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { acquireProjectLock } from '../src/core/instance-lock.js';

const tmpState = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'meta-agent-lock-')), '.meta-agent');

test('lock: a second agent on the same project is refused while the first is alive', async () => {
    const dir = tmpState();
    fs.mkdirSync(dir, { recursive: true });
    // «Первый агент» — живой процесс, записавший свой pid
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']);
    try {
        fs.writeFileSync(path.join(dir, 'agent.lock'), String(other.pid));
        const result = acquireProjectLock(dir);
        assert.equal(result.ok, false);
        assert.equal(result.pid, other.pid);
    } finally {
        other.kill();
    }
});

test('lock: a stale lock (owner is dead) is taken over; release removes only our own lock', async () => {
    const dir = tmpState();
    const dead = spawn(process.execPath, ['-e', '']);
    await new Promise(resolve => dead.on('close', resolve));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'agent.lock'), String(dead.pid));

    const lock = acquireProjectLock(dir);
    assert.equal(lock.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'agent.lock'), 'utf-8'), String(process.pid));

    lock.release();
    assert.ok(!fs.existsSync(path.join(dir, 'agent.lock')));
});
