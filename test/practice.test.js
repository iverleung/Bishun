import test from 'node:test';
import assert from 'node:assert/strict';
import { PracticeController } from '../src/practice/controller.js';

const record = { character: '十', data: { strokes: ['a', 'b'] }, strokeNames: ['横', '竖'] };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function setup(options = {}) {
    const calls = [];
    const adapter = {
        cancelCount: 0,
        cancel() { this.cancelCount++; },
        async start(data, settings) { calls.push({ data, ...settings }); },
        async hint() {},
        setEnabled() {},
        ...options
    };
    const session = new PracticeController({ adapter, timeoutMs: 30 });
    return { session, adapter, calls };
}

test('practice accepts each expected stroke once, never completes early, and mistakes keep position', async () => {
    const { session, calls } = setup();
    await session.start(record);
    const callbacks = calls[0];
    callbacks.onComplete();
    callbacks.onCorrect(1);
    assert.equal(session.completed, 0);
    callbacks.onMistake();
    assert.equal(session.message, '再试一次');
    assert.equal(session.completed, 0);
    callbacks.onCorrect(0);
    callbacks.onCorrect(0);
    assert.equal(session.completed, 1);
    callbacks.onComplete();
    assert.equal(session.status, 'active');
    callbacks.onCorrect(1);
    callbacks.onComplete();
    assert.equal(session.status, 'complete');
    assert.equal(session.completed, 2);
    callbacks.onMistake();
    assert.equal(session.message, '这一字写完了');
});

test('practice pause preserves accepted strokes, invalidates callbacks and resumes explicitly at next stroke', async () => {
    const { session, calls } = setup();
    await session.start(record);
    calls[0].onCorrect(0);
    session.pause();
    assert.equal(session.status, 'paused');
    assert.equal(calls[0].signal.aborted, true);
    calls[0].onCorrect(1);
    calls[0].onComplete();
    assert.equal(session.completed, 1);
    await session.resume();
    assert.equal(calls[1].completed, 1);
    assert.equal(session.status, 'active');
    calls[0].onCorrect(1);
    assert.equal(session.completed, 1);
});

test('exiting during preparation settles immediately and late preparation cannot resurrect practice', async () => {
    const load = deferred();
    const { session } = setup({ start: () => load.promise });
    const pending = session.start(record);
    session.exit();
    assert.equal(await pending, false);
    load.resolve();
    await Promise.resolve();
    assert.equal(session.status, 'idle');
    assert.equal(session.record, null);
});

test('changing practice target or mode rejects old callbacks and restarts the chosen mode', async () => {
    const { session, calls } = setup();
    await session.start(record);
    calls[0].onCorrect(0);
    await session.restart('independent');
    assert.equal(session.mode, 'independent');
    assert.equal(session.completed, 0);
    assert.equal(calls[1].mode, 'independent');
    await session.start({ ...record, character: '二' });
    calls[1].onCorrect(0);
    assert.equal(session.completed, 0);
    assert.equal(session.record.character, '二');
    assert.equal(await session.start(null), false);
    assert.equal(await session.restart('invalid'), false);
});

test('hint does not count as writing; exit cancels pending hint and late work cannot resume input', async () => {
    const hint = deferred();
    const { session, calls } = setup({ hint: () => hint.promise });
    await session.start(record);
    const pending = session.hint();
    assert.equal(session.status, 'hint');
    calls[0].onCorrect(0);
    assert.equal(session.completed, 0);
    session.exit();
    await pending;
    hint.resolve();
    await Promise.resolve();
    assert.equal(session.status, 'idle');
});

test('failed or timed-out setup is recoverable and invalidates its callbacks', async () => {
    const { session, adapter } = setup({ start: () => new Promise(() => {}) });
    session.timeoutMs = 5;
    assert.equal(await session.start(record), false);
    assert.equal(session.status, 'error');
    adapter.start = async () => {};
    assert.equal(await session.restart(), true);
    assert.equal(session.status, 'active');
});

test('failed hint pauses instead of leaving active input and can resume without adding a stroke', async () => {
    const { session, adapter, calls } = setup({ hint: async () => { throw new Error('failed'); } });
    await session.start(record);
    calls[0].onCorrect(0);
    await session.hint();
    assert.equal(session.status, 'paused');
    assert.equal(session.completed, 1);
    adapter.hint = async () => {};
    await session.resume();
    assert.equal(calls[1].completed, 1);
});
