import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { v3 } from '../src/engine/recognition/v3.js';

const manifest = JSON.parse(await fs.readFile(new URL('../public/characters/2.0.1/manifest.json', import.meta.url), 'utf8'));
const names = new Set();
for (const char of manifest.characters) {
    for (const name of v3.getStrokeNames(char)) if (name) names.add(name);
}
const items = [...names].sort().map(text => ({ id: `stroke-${createHash('sha256').update(text).digest('hex').slice(0, 12)}`, text }));
if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('音频 ID 冲突');
await fs.writeFile(new URL('../resources/stroke-audio-catalog.json', import.meta.url), JSON.stringify({ version: 'v1', source: 'Resolved stroke names; unresolved alternatives excluded', items }, null, 2) + '\n');
console.log(`✅ ${items.length} 个独立笔画名称，待生成并试听`);
