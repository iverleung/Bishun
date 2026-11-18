import test from 'node:test';
import assert from 'node:assert/strict';
import { StrokeAudio } from '../src/playback/stroke-audio.js';

const item = { id: 'stroke-f8c6e3e86baa', text: '横', url: '/audio/strokes/v1/stroke-f8c6e3e86baa.mp3', durationMs: 400 };
const manifest = { schemaVersion: 1, version: 'v1', items: [item] };
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
function setup() {
    const sources = [];
    const context = {
        state: 'running', destination: {}, resume: async () => {},
        decodeAudioData: async () => ({ duration: 0.4 }),
        createBufferSource() { const source = { connect() {}, disconnect() {}, start() {}, stop() {} }; sources.push(source); return source; }
    };
    const calls = [];
    const audio = new StrokeAudio({ version: 'v1', createContext: () => context, fetchImpl: async url => { calls.push(url); return url.endsWith('.json') ? json(manifest) : new Response(new Uint8Array([1, 2])); } });
    return { audio, context, calls, sources };
}

test('audio requests use local assets and decoded buffers are reused', async () => {
    const { audio, calls } = setup();
    await audio.unlock();
    const [one, two] = await Promise.all([audio.prepare('横'), audio.prepare('横')]);
    assert.equal(one, two);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(url => url.startsWith('/audio/strokes/v1/')));
    await assert.rejects(audio.prepare(null), {code:'STROKE_NAME_MISSING'});
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(audio.prepare(null,{signal:cancelled.signal}),{name:'AbortError'});
    await assert.rejects(audio.prepare('未收录'), {code:'STROKE_RECORDING_MISSING'});
});

test('preparation waits for user-triggered asynchronous audio resume and remains cancellable', async () => {
    const { audio, context, calls } = setup();
    context.state = 'suspended';
    let resume;
    context.resume = () => new Promise(resolve => { resume = () => { context.state = 'running'; resolve(); }; });
    const unlocking = audio.unlock();
    const controller = new AbortController();
    const cancelled = assert.rejects(audio.prepare('横', { signal: controller.signal }), { name: 'AbortError' });
    const prepared = audio.prepare('横');
    controller.abort();
    await cancelled;
    assert.equal(calls.length, 0);
    resume();
    await unlocking;
    assert.equal((await prepared).duration, 0.4);
});

test('playback session is selected before context creation and user-triggered resume', async () => {
    const { context } = setup();
    const events = [];
    context.state = 'suspended';
    context.resume = async () => { events.push('resume'); context.state = 'running'; };
    const session = { set type(value) { events.push(value); } };
    const audio = new StrokeAudio({ createContext: () => { events.push('context'); return context; }, getAudioSession: () => session });
    const unlock = audio.unlock();
    assert.deepEqual(events, ['playback', 'context', 'resume']);
    await unlock;
    await audio.unlock();
    assert.deepEqual(events, ['playback', 'context', 'resume', 'playback']);
});

test('an unsupported audio session API does not prevent enabling sound', async () => {
    const { context } = setup();
    const audio = new StrokeAudio({ createContext: () => context, getAudioSession() { throw new Error('unsupported'); } });
    await audio.unlock();
    assert.equal(audio.context.state, 'running');
});

test('a new recording cancels the previous source and cancellation settles waits', async () => {
    const { audio, sources } = setup();
    await audio.unlock();
    const buffer = await audio.prepare('横');
    const signal = new AbortController().signal;
    const first = audio.start(buffer, { signal });
    const second = audio.start(buffer, { signal });
    await first;
    assert.equal(sources[0].onended, null);
    audio.cancel();
    await second;
    assert.equal(sources[1].onended, null);
});

test('aborting preparation never starts a late recording', async () => {
    const { audio, sources } = setup();
    await audio.unlock();
    let finish;
    audio.fetch = () => new Promise(resolve => { finish = resolve; });
    const controller = new AbortController();
    const pending = assert.rejects(audio.prepare('横', { signal: controller.signal }), { name: 'AbortError' });
    controller.abort();
    await pending;
    finish(json(manifest));
    assert.equal(sources.length, 0);
});

test('invalid catalogs, decoding failures and a suspended context are explicit failures', async () => {
    const { audio, context } = setup();
    await audio.unlock();
    audio.fetch = async () => json({ ...manifest, version: 'other' });
    await assert.rejects(audio.prepare('横'), /版本/);
    audio.fetch = async url => url.endsWith('.json') ? json(manifest) : new Response(new Uint8Array([0]));
    context.decodeAudioData = async () => { throw new Error('bad decode'); };
    await assert.rejects(audio.prepare('横'), /录音无法播放/);
    context.state = 'suspended';
    await assert.rejects(audio.prepare('横'), /声音未启用/);
});

test('catalog and recording network failures use Chinese messages and can retry', async () => {
    for (const failure of ['catalog', 'recording']) {
        const { audio } = setup();
        await audio.unlock();
        const original = audio.fetch;
        audio.fetch = async url => {
            if (failure === 'catalog' || url.endsWith('.mp3')) throw new TypeError('Failed to fetch');
            return original(url);
        };
        await assert.rejects(audio.prepare('横'), /录音加载失败.*网络/);
        audio.fetch = original;
        assert.equal((await audio.prepare('横')).duration, 0.4);
    }
});
