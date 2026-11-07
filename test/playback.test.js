import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackController } from '../src/playback/controller.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function setup(options = {}) {
    const calls = [];
    const store = options.store || { async load(character) {
        if (character === '未') throw Object.assign(new Error('missing'), { code: 'UNSUPPORTED' });
        const count = character === '一' ? 1 : 4;
        return { character, data: { strokes: Array(count).fill('path') }, strokeNames: Array(count).fill('横') };
    } };
    const animation = options.animation || { cancel() {}, async animate(record, index, settings) { calls.push({ char: record.character, index, speed: settings.speed }); } };
    const audio = options.audio || { cancel() {}, async prepare() { return {}; }, async start() {} };
    const player = new PlaybackController({ store, animation, audio, onChange() {}, wait: async () => {} });
    player.query('木水');
    return { player, calls };
}

test('query snapshots preserve duplicates, filter input and support Unicode Han', async () => {
    const { player } = setup();
    const flags = player.query('木，木 abc𠮷' + '心'.repeat(25));
    await player.ready;
    assert.deepEqual(player.entries.slice(0, 3), ['木', '木', '𠮷']);
    assert.equal(player.entries.length, 20);
    assert.deepEqual(flags, { filtered: true, truncated: true });
});

test('an old load cannot replace a new query', async () => {
    const old = deferred();
    const record = character => ({ character, data: { strokes: ['path'] }, strokeNames: ['横'] });
    const { player } = setup({ store: { load: char => char === '木' ? old.promise : Promise.resolve(record(char)) } });
    const pending = player.ready;
    player.query('水');
    await player.ready;
    old.resolve(record('木'));
    await pending;
    assert.equal(player.entry, '水');
    assert.equal(player.record.character, '水');
    assert.equal(player.status, 'ready');
});

test('pause keeps completed strokes and resume restarts only the interrupted one', async () => {
    const current = deferred();
    let first = true;
    const seen = [];
    const { player } = setup({ animation: { cancel() {}, animate(record, index) {
        seen.push(index);
        if (first) { first = false; return current.promise; }
        return Promise.resolve();
    } } });
    await player.ready;
    player.seek(1);
    const old = player.play();
    await flush();
    assert.equal(player.active, 1);
    player.pause();
    assert.equal(player.completed, 1);
    current.resolve();
    await old;
    assert.equal(player.completed, 1);
    await player.play();
    assert.deepEqual(seen, [1, 1, 2, 3]);
});

test('late completion after switching or clearing cannot advance another character', async () => {
    const stroke = deferred();
    const { player } = setup({ animation: { cancel() {}, animate: () => stroke.promise } });
    await player.ready;
    const old = player.play();
    await flush();
    await player.select(1);
    stroke.resolve();
    await old;
    assert.equal(player.entry, '水');
    assert.equal(player.status, 'ready');
    assert.equal(player.completed, 0);
    player.query('');
    assert.equal(player.status, 'empty');
});

test('single-stroke replay stops and single-character playback never advances', async () => {
    const { player, calls } = setup();
    await player.ready;
    player.seek(3);
    await player.play({ oneStroke: true });
    assert.deepEqual(calls.map(call => call.index), [2]);
    assert.equal(player.completed, 3);
    assert.equal(player.status, 'paused');
    await player.play();
    assert.equal(player.entry, '木');
    assert.equal(player.status, 'complete');
});

test('group playback skips failures and retains the final successful character', async () => {
    const { player } = setup();
    player.query('未一未一未');
    await player.ready;
    await player.restartGroup();
    assert.equal(player.skipped, 3);
    assert.equal(player.index, 3);
    assert.equal(player.completed, 1);
    assert.equal(player.groupComplete, true);
    assert.equal(player.status, 'complete');
});

test('an entirely failed group remains a visible error', async () => {
    const { player } = setup();
    player.query('未未');
    await player.ready;
    await player.restartGroup();
    assert.equal(player.status, 'error');
    assert.equal(player.skipped, 2);
});

test('prefetch preserves the selected failure until an explicit retry', async () => {
    let attempts = 0;
    const { player } = setup({ store: { async load(character) {
        attempts++;
        if (attempts === 1) throw new Error('HTTP 404');
        return { character, data: { strokes: ['path'] }, strokeNames: ['横'] };
    } } });
    // setup starts 木水; use a new single-character query to isolate prefetch.
    await player.ready;
    await flush();
    attempts = 0;
    player.query('木');
    await player.ready;
    await flush();
    assert.equal(attempts, 1);
    assert.equal(player.status, 'error');
    assert.equal(player.errors.get('木')?.message, 'HTTP 404');
    await player.select(0);
    assert.equal(player.status, 'ready');
    assert.equal(attempts, 2);
});

test('pausing while a group loads its next character prevents automatic restart', async () => {
    const water = deferred();
    const record = character => ({ character, data: { strokes: ['path'] }, strokeNames: ['横'] });
    const { player, calls } = setup({ store: { load: char => char === '水' ? water.promise : Promise.resolve(record(char)) } });
    player.query('一水');
    await player.ready;
    const run = player.restartGroup();
    await flush();
    assert.equal(player.status, 'loading');
    player.pause();
    assert.equal(player.status, 'paused');
    water.resolve(record('水'));
    await run;
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(player.status, 'paused');
    await player.play();
    assert.equal(calls.length, 2);
    assert.equal(player.status, 'complete');
});

test('follow mode waits at every stroke and character boundary', async () => {
    const { player } = setup();
    player.query('一一');
    await player.ready;
    player.setMode('follow');
    player.group = true;
    await player.play();
    assert.equal(player.index, 0);
    assert.equal(player.status, 'paused');
    await player.play();
    assert.equal(player.index, 1);
    assert.equal(player.status, 'paused');
    await player.play();
    assert.equal(player.status, 'complete');
});

test('seeking after pausing a group load replaces its saved resume position', async () => {
    const water = deferred();
    const record = character => ({ character, data: { strokes: Array(4).fill('path') }, strokeNames: Array(4).fill('横') });
    const { player, calls } = setup({ store: { load: char => char === '水' ? water.promise : Promise.resolve(record(char)) } });
    await player.ready;
    const run = player.restartGroup();
    await flush();
    player.pause();
    water.resolve(record('水'));
    await run;
    await flush();
    player.seek(2);
    calls.length = 0;
    await player.play();
    assert.deepEqual(calls.map(call => call.index), [2, 3]);
});

test('audio failure degrades to silence without blocking animation', async () => {
    let attempts = 0;
    const { player, calls } = setup({ audio: { cancel() {}, async prepare() { attempts++; throw new Error('bad audio'); }, async start() {} } });
    await player.ready;
    player.setSpeech(true);
    await player.play();
    assert.equal(player.status, 'complete');
    assert.equal(calls.length, 4);
    assert.equal(attempts, 1);
    assert.equal(player.audioWarning, 'bad audio');
});

test('completion waits for both the animation and the matching recording', async () => {
    const sound = deferred();
    const { player } = setup({ audio: { cancel() {}, async prepare() { return {}; }, start: () => sound.promise } });
    player.query('一');
    await player.ready;
    player.setSpeech(true);
    const run = player.play();
    await flush();
    assert.equal(player.completed, 0);
    assert.equal(player.active, 0);
    sound.resolve();
    await run;
    assert.equal(player.completed, 1);
});

test('turning sound off cancels preparation and continues the same animation session', async () => {
    const { player } = setup({ audio: { cancel() {}, prepare(name, { signal }) { return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError')), { once: true })); }, async start() {} } });
    await player.ready;
    player.setSpeech(true);
    const run = player.play();
    await flush();
    player.setSpeech(false);
    await run;
    assert.equal(player.status, 'complete');
    assert.equal(player.audioWarning, '');
});

test('speed changes apply only to the next stroke', async () => {
    const stroke = deferred();
    const seen = [];
    const { player } = setup({ animation: { cancel() {}, animate(record, index, { speed }) { seen.push(speed); return index === 0 ? stroke.promise : Promise.resolve(); } } });
    await player.ready;
    const run = player.play();
    await flush();
    player.speed = 5;
    stroke.resolve();
    await run;
    assert.deepEqual(seen, [1, 4, 4, 4]);
});
