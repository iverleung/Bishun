import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryHistory } from '../src/web/history.js';
import { defaultPreferences, loadPreferences, savePreferences } from '../src/web/preferences.js';
import { SavedQueries } from '../src/web/saved-queries.js';

test('saved queries preserve order and duplicates within a query, survive reload and stay separate from history', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const history = new QueryHistory(storage);
    const saved = new SavedQueries(storage);
    history.remember('木木水');
    assert.deepEqual(saved.save('木木水'), { status: 'saved', persisted: true });
    saved.save('𠮷');
    assert.equal(saved.save('木木水').status, 'exists');
    history.clear();
    assert.deepEqual(new SavedQueries(storage).items, ['𠮷', '木木水']);
    saved.remove('𠮷');
    assert.deepEqual(new SavedQueries(storage).items, ['木木水']);
    assert.deepEqual(saved.items, ['木木水']);
});

test('saved query capacity never silently evicts an existing item', () => {
    const saved = new SavedQueries(null);
    for (let index = 1; index <= 30; index++) saved.save(String.fromCodePoint(0x4e00 + index));
    assert.equal(saved.items.length, 30);
    const before = [...saved.items];
    assert.equal(saved.save('木水心').status, 'full');
    assert.deepEqual(saved.items, before);
    saved.remove(before[0]);
    assert.equal(saved.save('木水心').status, 'saved');
    assert.equal(saved.items[0], '木水心');
});

test('saved queries ignore invalid stored entries and report in-memory fallback', () => {
    const saved = new SavedQueries({ getItem: () => '["木",null,1,"abc","木","𠮷"]' });
    assert.deepEqual(saved.items, ['木', '𠮷']);
    for (const value of ['', '<script>', '木'.repeat(21), null]) assert.equal(saved.save(value).status, 'invalid');
    assert.deepEqual(new SavedQueries({ getItem: () => '{' }).items, []);
    const blocked = new SavedQueries({ getItem() { throw new Error(); }, setItem() { throw new Error(); } });
    assert.deepEqual(blocked.save('心'), { status: 'saved', persisted: false });
    assert.equal(blocked.remove('心'), false);
    assert.deepEqual(blocked.items, []);
});

test('preferences persist only validated settings and reset without changing history', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const history = new QueryHistory(storage);
    history.remember('木水');
    const settings = { mode: 'follow', speed: 5, group: true, speechEnabled: true, grid: false, outline: false };
    savePreferences(storage, { ...settings, autoplay: true });
    assert.deepEqual(loadPreferences(storage), settings);
    savePreferences(storage, defaultPreferences);
    assert.deepEqual(loadPreferences(storage), defaultPreferences);
    assert.deepEqual(new QueryHistory(storage).items, ['木水']);
});

test('invalid or inaccessible preference storage falls back safely', () => {
    const broken = { getItem: () => '{' };
    assert.deepEqual(loadPreferences(broken), defaultPreferences);
    const invalid = { getItem: () => JSON.stringify({ mode: 'other', speed: '5', speechEnabled: 'yes', group: false, grid: false, outline: null }) };
    assert.deepEqual(loadPreferences(invalid), { ...defaultPreferences, grid: false });
    const blocked = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
    assert.deepEqual(loadPreferences(blocked), defaultPreferences);
    assert.doesNotThrow(() => savePreferences(blocked, defaultPreferences));
    const changed = loadPreferences(null);
    changed.speed = 5;
    assert.equal(loadPreferences(null).speed, 3);
});

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
