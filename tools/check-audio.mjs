import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await fs.readFile(new URL('resources/stroke-audio-catalog.json', root), 'utf8'));
const manifest = JSON.parse(await fs.readFile(new URL(`public/audio/strokes/${catalog.version}/manifest.json`, root), 'utf8'));
if (manifest.schemaVersion !== 1 || manifest.version !== catalog.version || manifest.items.length !== catalog.items.length ||
    new Set(manifest.items.map(item => item.id)).size !== catalog.items.length) throw new Error('音频清单不完整');
for (const expected of catalog.items) {
    const item = manifest.items.find(entry => entry.id === expected.id);
    if (!item || !/^stroke-[a-f0-9]{12}$/.test(item.id) || item.text !== expected.text ||
        item.url !== `/audio/strokes/${catalog.version}/${item.id}.mp3` ||
        !Number.isFinite(item.durationMs) || item.durationMs < 100 || item.durationMs > 10000 ||
        !['pending-listening', 'reviewed'].includes(item.reviewStatus)) throw new Error('音频元数据无效');
    const bytes = await fs.readFile(new URL(`public${item.url}`, root));
    if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`音频校验失败：${item.text}`);
}
console.log(`✅ ${catalog.items.length} 份录音文件和清单技术校验通过；待试听 ${manifest.items.filter(item => item.reviewStatus !== 'reviewed').length} 份。`);
