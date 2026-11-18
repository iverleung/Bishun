import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { indexReadings } from '../src/data/reading-audio.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const reading = JSON.parse(await fs.readFile('resources/reading-audio-v2-catalog.json', 'utf8'));
const strokes = JSON.parse(await fs.readFile('resources/stroke-audio-v2-catalog.json', 'utf8'));
const canonicalReadings = JSON.parse(await fs.readFile('docs/拼音音节合成列表.json', 'utf8'));
const canonicalStrokes = JSON.parse(await fs.readFile('resources/stroke-audio-catalog.json', 'utf8'));

for (const [catalog, kind] of [[reading, 'readings'], [strokes, 'strokes']]) {
  const published = JSON.parse(await fs.readFile(`public/audio/${kind}/v2/manifest.json`, 'utf8'));
  if (JSON.stringify(catalog) !== JSON.stringify(published)) throw new Error(`${kind} v2 清单不一致`);
  if (catalog.schemaVersion !== 1 || catalog.version !== 'v2' || catalog.source?.type !== 'user-recording' || !/^[a-f0-9]{64}$/.test(catalog.source.exportManifestSha256)) throw new Error(`${kind} v2 来源无效`);
  const notice = await fs.readFile(`public/audio/${kind}/v2/SOURCE.html`, 'utf8');
  if (!notice.includes(catalog.source.exportManifestSha256) || !notice.includes('pending-listening')) throw new Error(`${kind} v2 来源说明缺失`);
  const ids = new Set();
  for (const item of catalog.items) {
    if (ids.has(item.id) || !/^[a-f0-9]{64}$/.test(item.sourceSha256) || !Number.isFinite(item.durationMs) || item.durationMs < 100 || item.durationMs > 10000 || !['pending-listening', 'reviewed'].includes(item.reviewStatus)) throw new Error(`${kind} v2 条目无效`);
    ids.add(item.id);
    if (item.reviewStatus === 'reviewed' && catalog.listeningReview?.items?.[item.id] !== item.sha256) throw new Error(`${kind} v2 试听记录与文件不匹配`);
    const bytes = await fs.readFile(`public/audio/${kind}/v2/${item.id}.mp3`);
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw new Error(`${kind} v2 文件校验失败：${item.id}`);
  }
}

indexReadings(reading);
const excluded = new Set(reading.excluded?.map(item => item.reading));
const unrecorded = new Set(reading.unrecorded?.map(item => item.reading));
if (excluded.size !== 17 || unrecorded.size !== 9 || reading.items.length + excluded.size + unrecorded.size !== canonicalReadings.length) throw new Error('拼音 v2 覆盖、排除项与未录项不完整');
for (const item of reading.items) {
  if (excluded.has(item.reading) || item.id !== `reading-${createHash('sha256').update(`${item.reading}:${item.sha256}`).digest('hex').slice(0, 12)}`) throw new Error(`拼音 v2 内容身份无效：${item.reading}`);
}
for (const item of canonicalReadings) {
  if (!excluded.has(item.reading) && !unrecorded.has(item.reading) && !reading.items.some(candidate => candidate.reading === item.reading)) throw new Error(`拼音 v2 缺少：${item.reading}`);
}
const expectedStrokes = new Map(canonicalStrokes.items.map(item => [item.id, item.text]));
if (strokes.items.length !== expectedStrokes.size || strokes.items.some(item => expectedStrokes.get(item.id) !== item.text)) throw new Error('笔画 v2 名称或 ID 不匹配');
console.log(`User audio v2 verified: ${reading.items.length} readings (${excluded.size} excluded), ${strokes.items.length} strokes; all files and identities match.`);
