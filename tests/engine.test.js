import test from 'node:test';
import assert from 'node:assert';
import { fallbackChain } from '../src/core/llm.js';

test('llm router: provider by model name; local models are excluded from the code-execution chain', () => {
    const chain = fallbackChain('pro');
    assert.ok(Array.isArray(chain));
    assert.ok(chain.length > 0);
    assert.equal(chain.includes('qwen2.5-coder:7b-instruct'), false);
});

test('llm router: tier fallback returns correct structure', () => {
    const archChain = fallbackChain('arch');
    assert.ok(archChain.length > 0);
});
