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
    assert.equal(readingRecording('yíng'), null);
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

test('expanded basic-character readings are covered without borrowing a tone for missing neutral de', async () => {
    const { characterReadings } = await import('../src/web/character-info.js');
    const { default: plan } = await import('../resources/reading-audio-plan.json', { with: { type:'json' } });
    const batch = plan.batches.find(batch => batch.id === 'basics');
    const missing = new Set(batch.unavailableReadings.map(item => item.reading));
    const covered = new Set();
    for (const char of batch.sampleQueries.join('')) {
        for (const reading of characterReadings(char)) {
            if (missing.has(reading)) { assert.equal(readingRecording(reading), null); continue; }
            const item = readingRecording(reading);
            assert.ok(item, `${char}: ${reading}`);
            covered.add(reading);
        }
    }
    assert.equal(Object.keys(batch.items).length,34);
    assert.equal(covered.size,37); // Includes previously available mù, yuè and zhòng.
    assert.equal(readingRecording('dì').token,'di4');
    assert.equal(readingRecording('de'),null);
});

test('listening confirmations remain bound to exact files while reported and new recordings await review', async () => {
    const { default: catalog } = await import('../resources/reading-audio-catalog.json', { with: { type:'json' } });
    const approved = catalog.items.filter(item => item.reviewStatus === 'reviewed');
    const pending = catalog.items.filter(item => item.reviewStatus === 'pending-listening');
    assert.equal(approved.length,106);
    assert.deepEqual(pending.filter(item=>!item.batch.startsWith('grade1-')).map(item => item.reading),['tián','hé']);
    assert.equal(pending.filter(item=>item.batch==='grade1-1').length,0);
    assert.equal(pending.filter(item=>item.batch==='grade1-2').length,0);
    assert.equal(catalog.listeningReview.batchConfirmations['grade1-2'].date,'2026-11-10');
    assert.equal(catalog.listeningReview.batchConfirmations['grade1-1'].date,'2026-11-10');
    assert.equal(approved.filter(item => item.batch === 'initial').length,13);
    assert.equal(approved.filter(item => item.batch === 'basics').length,33);
    assert.ok(approved.every(item => catalog.listeningReview.items[item.id] === item.sha256));
});

test('textbook 禾 has its own he2 recording without borrowing heng or another tone', async () => {
    const { characterReadings } = await import('../src/web/character-info.js');
    assert.deepEqual(characterReadings('禾'),['hé']);
    const item=readingRecording(characterReadings('禾')[0]);
    assert.equal(item.token,'he2');
    assert.equal(item.reviewStatus,'pending-listening');
    assert.notEqual(item.url,readingRecording('héng').url);
    assert.deepEqual(characterReadings('田'),['tián']);
    assert.equal(readingRecording('tián').token,'tian2');
});

test('reported tián audio is replaced with a fresh content-bound URL and requires new listening', async () => {
    const {createHash}=await import('node:crypto');
    const {default:catalog}=await import('../resources/reading-audio-catalog.json',{with:{type:'json'}});
    const item=readingRecording('tián');
    const oldId='reading-16e6e7372e8f';
    assert.notEqual(item.id,oldId);
    assert.equal(item.id,'reading-'+createHash('sha256').update('tián:'+item.sha256).digest('hex').slice(0,12));
    assert.equal(item.synthesis.text,'田');
    assert.equal(item.synthesis.voice,'zh-CN-XiaoxiaoNeural');
    assert.equal(item.upstream,undefined);
    assert.equal(item.reviewStatus,'pending-listening');
    assert.notEqual(catalog.listeningReview.items[item.id],item.sha256);
    assert.notEqual(item.sha256,'ec5a7c95487f089a2c6db4436e3ad25ca7c797fb33451a55608129c5fe0998d0');
});

test('first grade reading batch adds thirty exact syllables while preserving other polyphonic candidates', async () => {
    const {characterReadings}=await import('../src/web/character-info.js');
    const {default:plan}=await import('../resources/reading-audio-plan.json',{with:{type:'json'}});
    const batch=plan.batches.find(item=>item.id==='grade1-1');
    const readings=new Set(Array.from(batch.sampleQueries.join('')).flatMap(char=>characterReadings(char)));
    assert.equal(Object.keys(batch.items).length,30);
    for(const [reading,token] of Object.entries(batch.items)){
        assert.ok(readings.has(reading),reading+' is missing from sample characters');
        const item=readingRecording(reading);
        assert.equal(item.token,token);assert.equal(item.batch,'grade1-1');
        assert.equal(item.reviewStatus,'reviewed');
    }
    assert.equal(readingRecording('mā').token,'ma1');
    assert.equal(readingRecording('mǎ').token,'ma3');
    assert.notEqual(readingRecording('mā').url,readingRecording('mǎ').url);
    assert.deepEqual(characterReadings('校'),['xiào','jiào']);
    assert.equal(readingRecording('xiào').token,'xiao4');
    assert.equal(readingRecording('jiào'),null);
    assert.deepEqual(characterReadings('雨'),['yù','yǔ']);
    assert.equal(readingRecording('yǔ').token,'yu3');
    assert.equal(readingRecording('yù'),null);
});

test('second grade-one batch is bound to source writing entries and preserves nǚ and neutral-tone boundaries', async () => {
    const {default:plan}=await import('../resources/reading-audio-plan.json',{with:{type:'json'}});
    const {default:book}=await import('../resources/textbooks/pilot-v1/g1-first.json',{with:{type:'json'}});
    const {characterReadings}=await import('../src/web/character-info.js');
    const batch=plan.batches.find(item=>item.id==='grade1-2');
    assert.equal(Object.keys(batch.items).length,30);assert.equal(batch.sampleEntries.length,30);
    assert.equal(batch.sampleQueries.join(''),batch.sampleEntries.map(entry=>entry.character).join(''));
    for(const sample of batch.sampleEntries){
        assert.equal(sample.bookId,book.id);
        const task=book.units.flatMap(unit=>unit.tasks).find(task=>task.id===sample.taskId);
        const entry=task.write.find(entry=>entry.id===sample.rowId);
        assert.equal(entry.character,sample.character);assert.equal(entry.reading,sample.reading);
        assert.ok(characterReadings(sample.character).includes(sample.reading));
        const recording=readingRecording(sample.reading);
        assert.equal(recording.token,batch.items[sample.reading]);
        assert.equal(recording.batch,'grade1-2');assert.equal(recording.reviewStatus,'reviewed');
    }
    assert.equal(readingRecording('nǚ').token,'nv3');
    assert.equal(readingRecording('nu\u0308\u030c'),readingRecording('nǚ'));
    assert.equal(readingRecording('nǔ'),null);
    assert.equal(readingRecording('ér').token,'er2');
    assert.notEqual(readingRecording('ér').url,readingRecording('èr').url);
    assert.equal(readingRecording('le'),null);
    assert.deepEqual(characterReadings('了'),['le','liǎo']);
});
