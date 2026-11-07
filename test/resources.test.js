import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CharacterStore } from '../src/data/character-store.js';
import { validateCharacterData } from '../src/data/character-data.js';

const data = JSON.parse(fs.readFileSync(new URL('./data/木.json', import.meta.url)));
const manifest = { schemaVersion: 1, version: '2.0.1', count: 2, characters: '木水', strokeCounts: [4, 4] };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const names = () => ['横', '竖', '撇', '捺'];

test('same-origin requests are deduplicated and successful records cached', async () => {
    const calls = [];
    const store = new CharacterStore({ getNames: names, fetchImpl: async url => { calls.push(url); return json(url.endsWith('manifest.json') ? manifest : data); } });
    const [one, two] = await Promise.all([store.load('木'), store.load('木')]);
    assert.equal(one, two);
    assert.equal(await store.load('木'), one);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(url => url.startsWith('/characters/2.0.1/')));
    assert.equal(one.contentReviewed, false);
});

test('unsupported characters do not attempt an external fallback', async () => {
    const calls = [];
    const store = new CharacterStore({ fetchImpl: async url => { calls.push(url); return json(manifest); } });
    await assert.rejects(store.load('未'), error => error.code === 'UNSUPPORTED');
    assert.equal(calls.length, 1);
});

test('an already-cancelled lookup starts no network work', async () => {
    const controller = new AbortController();
    controller.abort();
    const store = new CharacterStore({ fetchImpl: () => { throw new Error('Unexpected request'); } });
    await assert.rejects(store.load('木', { signal: controller.signal }), { name: 'AbortError' });
});

test('one aborted consumer does not cancel a shared request for another', async () => {
    const controller = new AbortController();
    let calls = 0;
    const store = new CharacterStore({ getNames: names, fetchImpl: async url => { calls++; return json(url.endsWith('manifest.json') ? manifest : data); } });
    const cancelled = assert.rejects(store.load('木', { signal: controller.signal }), { name: 'AbortError' });
    const other = store.load('木');
    controller.abort();
    await cancelled;
    assert.equal((await other).character, '木');
    assert.equal(calls, 2);
});

test('timeouts are bounded even if the fetch implementation ignores abort', async () => {
    const store = new CharacterStore({ timeoutMs: 15, fetchImpl: () => new Promise(() => {}) });
    await assert.rejects(store.load('木'), error => error.code === 'TIMEOUT');
    store.fetch = async url => json(url.endsWith('manifest.json') ? manifest : data);
    assert.equal((await store.load('木')).character, '木');
});

test('a SPA HTML fallback is not accepted as character JSON', async () => {
    const store = new CharacterStore({ fetchImpl: async url => url.endsWith('manifest.json') ? json(manifest) : new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) });
    await assert.rejects(store.load('木'), error => error.code === 'FORMAT');
});

test('bad versions, path counts, coordinates and name counts are rejected', async () => {
    const wrongVersion = new CharacterStore({ fetchImpl: async () => json({ ...manifest, version: 'next' }) });
    await assert.rejects(wrongVersion.load('木'), /版本/);
    assert.throws(() => validateCharacterData({ ...data, medians: [] }), /无效/);
    assert.throws(() => validateCharacterData({ strokes: ['M0 0'], medians: [[[0, 0], [NaN, 3]]] }), /无效/);
    const wrongNames = new CharacterStore({ getNames: () => ['横'], fetchImpl: async url => json(url.endsWith('manifest.json') ? manifest : data) });
    await assert.rejects(wrongNames.load('木'), error => error.code === 'NAME_COUNT');
});

test('missing names remain null and never become dots', async () => {
    const store = new CharacterStore({ getNames: () => [], fetchImpl: async url => json(url.endsWith('manifest.json') ? manifest : data) });
    const record = await store.load('木');
    assert.deepEqual(record.strokeNames, [null, null, null, null]);
    assert.equal(record.nameStatus, 'partial');
});
