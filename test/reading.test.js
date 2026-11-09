import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadingPlayer } from '../src/playback/reading-player.js';
import { readingRecording, indexReadings } from '../src/data/reading-audio.js';
import { PlaybackController } from '../src/playback/controller.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
    const starts = [];
    const audio = { unlock: async () => {}, prepareRecording: async item => item, start: async item => { starts.push(item.reading); }, cancel() {} };
    const player = new ReadingPlayer({ audio, lookup: readingRecording });
    return { audio, player, starts };
}
test('sample lookup is NFC normalized, exact and preserves distinct polyphonic assets', () => {
    assert.equal(readingRecording('mu\u0300'), readingRecording('mù'));
    assert.equal(readingRecording('mu'), null);
    assert.equal(readingRecording('wǒ'), null);
    assert.notEqual(readingRecording('cháng').url, readingRecording('zhǎng').url);
    const one = readingRecording('mù');
    assert.throws(() => indexReadings({ schemaVersion:1,version:'v1',items:[one,one] }), /无效/);
    assert.throws(() => indexReadings({ schemaVersion:1,version:'v1',items:[{...one,url:'https://example.org/a.mp3'}] }), /无效/);
});
test('reading playback is opt-in, unlocks synchronously and finishes without auto-resume', async () => {
    const { player, audio, starts } = setup();
    let unlocked = false;
    audio.unlock = async () => { unlocked = true; };
    assert.deepEqual(starts, []);
    const pending = player.play('mù');
    assert.equal(unlocked, true);
    await pending;
    assert.deepEqual(starts, ['mù']);
    assert.equal(player.status, 'idle');
});
test('cancelling while unlocking prevents late audio preparation or playback', async () => {
    const { player, audio, starts } = setup();
    const unlock = deferred(); let prepared = false;
    audio.unlock = () => unlock.promise;
    audio.prepareRecording = async () => { prepared = true; };
    const pending = player.play('mù'); player.cancel(); unlock.resolve(); await pending;
    assert.equal(prepared, false); assert.deepEqual(starts, []); assert.equal(player.status, 'idle');
});
test('rapid reading replacement cannot play or publish a stale prepared sample', async () => {
    const { player, audio, starts } = setup(); const load = deferred();
    audio.prepareRecording = item => item.reading === 'cháng' ? load.promise : item;
    const old = player.play('cháng'); await tick();
    await player.play('zhǎng'); load.resolve(readingRecording('cháng')); await old;
    assert.deepEqual(starts, ['zhǎng']); assert.equal(player.status, 'idle');
});
test('stroke cancellation interrupts reading preparation even while strokes are paused', async () => {
    const { player, audio, starts } = setup(); const load = deferred();
    audio.prepareRecording = () => load.promise;
    const strokes = new PlaybackController({ audio, animation:{cancel(){}}, onInterrupt:()=>player.cancel(), onChange(){} });
    const pending = player.play('mù'); await tick(); strokes.cancel(); load.resolve(readingRecording('mù')); await pending;
    assert.deepEqual(starts, []); assert.equal(player.status, 'idle');
});
test('active voice cancellation stops audio and ignores its late completion', async () => {
    const { player, audio } = setup(); const voice = deferred(); let stopped = 0;
    audio.start = () => voice.promise; audio.cancel = () => { stopped++; };
    const pending = player.play('mù'); await tick(); assert.equal(player.status,'playing');
    player.cancel(); voice.resolve(); await pending;
    assert.equal(stopped,1); assert.equal(player.status,'idle'); assert.equal(player.reading,'');
});
test('audio errors are actionable, cleared on navigation and retry succeeds', async () => {
    const { player, audio, starts } = setup(); audio.unlock = async () => { throw new Error('blocked'); };
    await player.play('mù'); assert.equal(player.status,'error'); assert.match(player.message,/重试/);
    player.cancel(); assert.equal(player.message,'');
    audio.unlock = async () => {}; await player.play('mù'); assert.deepEqual(starts,['mù']);
});
