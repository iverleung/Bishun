import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryHistory } from '../src/web/history.js';

test('history persists newest first, deduplicates, and limits its size', () => {
    const saved = new Map();
    const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
    const history = new QueryHistory(storage);
    for (const char of '木水心我山田人日月火土') history.remember(char);
    history.remember('木');
    assert.equal(history.items.length, 10);
    assert.deepEqual(history.items.slice(0, 3), ['木', '土', '火']);
    assert.equal(history.items.filter(item => item === '木').length, 1);
    const reloaded = new QueryHistory(storage);
    assert.deepEqual(reloaded.items, history.items);
    reloaded.clear();
    assert.deepEqual(new QueryHistory(storage).items, []);
});

test('history ignores malformed entries and works when storage is unavailable', () => {
    const history = new QueryHistory({ getItem: () => '["木",null,1,"木","abc","水"]' });
    assert.deepEqual(history.items, ['木', '水']);
    history.remember('');
    history.remember('木'.repeat(21));
    assert.deepEqual(history.items, ['木', '水']);
    const unavailable = new QueryHistory({ getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } });
    unavailable.remember('心');
    assert.deepEqual(unavailable.items, ['心']);
    unavailable.clear();
    assert.deepEqual(unavailable.items, []);
    assert.deepEqual(new QueryHistory({ getItem: () => '{broken' }).items, []);
});
