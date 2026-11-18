import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resourceUrl } from '../src/data/resource-url.js';
import { CharacterStore } from '../src/data/character-store.js';
import { TextbookStore, textbookBooks } from '../src/data/textbooks.js';
import { StrokeAudio } from '../src/playback/stroke-audio.js';
import { createShareUrl } from '../src/web/share.js';
import textbook from '../resources/textbooks/pilot-v1/g1-first.json' with { type: 'json' };

const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const glyph = JSON.parse(fs.readFileSync(new URL('./data/木.json', import.meta.url)));
const glyphManifest = { schemaVersion: 1, version: '2.0.1', count: 1, characters: '木', strokeCounts: [4] };
const stroke = { id: 'stroke-f8c6e3e86baa', text: '横', url: '/audio/strokes/v1/stroke-f8c6e3e86baa.mp3', durationMs: 400 };

for (const [basePath, prefix] of [['/', '/'], ['/bishun/', '/bishun/']]) {
    test(`resource requests include base path ${basePath}`, async () => {
        assert.equal(resourceUrl('/characters/2.0.1/manifest.json', basePath), `${prefix}characters/2.0.1/manifest.json`);
        assert.equal(resourceUrl('', basePath), prefix);
        const characterCalls = [];
        const store = new CharacterStore({ basePath, getNames: () => ['横', '竖', '撇', '捺'], fetchImpl: async url => {
            characterCalls.push(url);
            return json(url.endsWith('manifest.json') ? glyphManifest : glyph);
        } });
        await store.load('木');
        assert.deepEqual(characterCalls, [`${prefix}characters/2.0.1/manifest.json`, `${prefix}characters/2.0.1/${encodeURIComponent('木')}.json`]);

        const textbookCalls = [];
        const textbooks = new TextbookStore({ basePath, fetchImpl: async url => { textbookCalls.push(url); return json(textbook); } });
        await textbooks.load('g1-first');
        assert.deepEqual(textbookCalls, [`${prefix}${textbookBooks[0].url.replace(/^\//, '')}`]);

        const audioCalls = [];
        const context = { state: 'running', resume: async () => {}, decodeAudioData: async () => ({ duration: 0.4 }) };
        const audio = new StrokeAudio({ basePath, version: 'v1', createContext: () => context, fetchImpl: async url => {
            audioCalls.push(url);
            return url.endsWith('.json') ? json({ schemaVersion: 1, version: 'v1', items: [stroke] }) : new Response(new Uint8Array([1]));
        } });
        await audio.unlock();
        await audio.prepare('横');
        const reading = { reading: 'mù', url: '/audio/readings/v2/reading-test.mp3' };
        await audio.prepareRecording(reading);
        assert.deepEqual(audioCalls, [
            `${prefix}audio/strokes/v1/manifest.json`, `${prefix}${stroke.url.replace(/^\//, '')}`,
            `${prefix}audio/readings/v2/reading-test.mp3`,
        ]);
        const share = createShareUrl('https://example.com/some/page', '木', basePath);
        assert.equal(new URL(share).pathname, prefix);
        assert.equal(new URLSearchParams(new URL(share).hash.slice(1)).get('q'), '木');
    });
}
