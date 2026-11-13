import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { audioExtension, createZip, recordingFileName } from '../src/recorder/archive.js';
import { analyzePcm, analyzeRecording, recordingIdentity } from '../src/recorder/quality.js';

const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

test('recording filenames preserve pinyin and select the actual container extension', () => {
  assert.equal(recordingFileName('ā', 1, 'audio/mp4;codecs=mp4a.40.2'), '0001_ā.m4a');
  assert.equal(recordingFileName('lǜ', 23, 'audio/webm;codecs=opus'), '0023_lǜ.webm');
  assert.equal(recordingFileName('a/b', 4, 'audio/mpeg'), '0004_a_b.mp3');
  assert.equal(audioExtension('audio/ogg'), 'ogg');
});

test('ZIP export stores uncompressed UTF-8 files with valid sizes, counts and checksums', async () => {
  const archive = new Uint8Array(await (await createZip([
    { name: 'manifest.json', data: '{"reading":"ā"}' },
    { name: '0001_ā.webm', data: new Blob(['audio-data']) },
  ], new Date(2026, 10, 12, 10, 20, 30))).arrayBuffer());
  const view = viewOf(archive);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true), 0x0800);
  const nameLength = view.getUint16(26, true);
  const size = view.getUint32(18, true);
  assert.equal(new TextDecoder().decode(archive.subarray(30 + nameLength, 30 + nameLength + size)), '{"reading":"ā"}');
  const secondOffset = 30 + nameLength + size;
  assert.equal(view.getUint32(secondOffset, true), 0x04034b50);
  assert.equal(view.getUint32(secondOffset + 14, true), crc32(Buffer.from('audio-data')));
  const endOffset = archive.length - 22;
  assert.equal(view.getUint32(endOffset, true), 0x06054b50);
  assert.equal(view.getUint16(endOffset + 8, true), 2);
  assert.equal(view.getUint16(endOffset + 10, true), 2);
  assert.equal(view.getUint32(endOffset + 16, true), endOffset - view.getUint32(endOffset + 12, true));
});

test('empty ZIP is valid and oversized entry counts are rejected', async () => {
  const archive = new Uint8Array(await (await createZip([])).arrayBuffer());
  assert.equal(archive.length, 22);
  assert.equal(viewOf(archive).getUint32(0, true), 0x06054b50);
  await assert.rejects(createZip(Array.from({ length: 65536 }, () => ({ name: 'a', data: '' }))), /分批导出/);
});

function tone(seconds, amplitude = 0.5, startSeconds = 0, endSeconds = seconds) {
  const sampleRate = 1000;
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = Math.round(startSeconds * sampleRate); index < Math.min(samples.length, Math.round(endSeconds * sampleRate)); index++) {
    samples[index] = Math.sin(index / sampleRate * Math.PI * 20) * amplitude;
  }
  return analyzePcm([samples], sampleRate);
}

test('PCM analysis accepts ordinary speech and detects empty or short recordings', () => {
  assert.deepEqual(tone(1, 0.5, 0.2, 0.8).flags, []);
  assert.ok(tone(1, 0).flags.includes('silent'));
  assert.ok(tone(0.3).flags.includes('short'));
  assert.equal(tone(1, 0).metrics.activeRmsDb, null);
});

test('PCM analysis flags boundary silence, quiet speech and possible clipping', () => {
  assert.deepEqual(tone(2, 0.5, 0.9, 1.1).flags.sort(), ['leadingSilence', 'trailingSilence']);
  assert.ok(tone(1, 0.01).flags.includes('quiet'));
  const loud = analyzePcm([new Float32Array(1000).fill(1)], 1000);
  assert.ok(loud.flags.includes('loud'));
  assert.ok(loud.flags.includes('clipping'));
});

test('analysis failures stay attached to the original recording identity', async () => {
  const record = { reading: 'ā', createdAt: '2026-11-14T00:00:00.000Z', blob: new Blob(['invalid']) };
  const result = await analyzeRecording(record, { decodeAudioData: async () => { throw new Error('invalid'); } });
  assert.equal(result.identity, recordingIdentity(record));
  assert.deepEqual(result.flags, ['decode']);
  assert.equal(result.metrics, null);
});
