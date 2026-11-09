import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { indexReadings } from '../src/data/reading-audio.js';

const catalog = JSON.parse(await fs.readFile('resources/reading-audio-catalog.json', 'utf8'));
const published = JSON.parse(await fs.readFile('public/audio/readings/v1/manifest.json', 'utf8'));
if (JSON.stringify(catalog) !== JSON.stringify(published)) throw new Error('读音清单与公开清单不一致');
if (catalog.source?.commit !== 'f759a0f18f27690742957619e1248ed91e9b3f2c' || catalog.source?.license !== 'CC-BY-SA-3.0' || catalog.items.length !== 13) throw new Error('读音来源或样本范围变化，需重新核验');
const entries = indexReadings(catalog);
const urls = new Set();
for (const item of entries.values()) {
    if (urls.has(item.url)) throw new Error('读音文件重复');
    urls.add(item.url);
    const expectedSource = `https://raw.githubusercontent.com/hugolpz/audio-cmn/${catalog.source.commit}/64k/syllabs/cmn-${item.token}.mp3`;
    if (item.upstream !== expectedSource || !['pending-listening', 'reviewed'].includes(item.reviewStatus)) throw new Error('读音来源或试听状态变化，需重新核验');
    const bytes = await fs.readFile('public' + item.url);
    if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`读音文件校验失败：${item.reading}`);
}
if (catalog.items.some(item => item.reviewStatus === 'reviewed') &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(catalog.listeningReview?.date || '') || catalog.listeningReview?.confirmedBy !== 'user' || !catalog.listeningReview?.evidence)) throw new Error('缺少人工试听确认记录');
const notice = await fs.readFile('public/audio/readings/v1/SOURCE.html', 'utf8');
if (!notice.includes(catalog.source.commit) || !notice.includes(catalog.source.licenseUrl) || !notice.includes('王琛')) throw new Error('缺少读音署名或许可');
console.log(`13 reading samples verified: local hashes, pinned provenance and attribution; pending listening: ${catalog.items.filter(item => item.reviewStatus !== 'reviewed').length}.`);
