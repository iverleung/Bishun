import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { characterVersion, validateCharacterData } from '../src/data/character-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules/hanzi-writer-data');
const target = path.join(root, 'public/characters', characterVersion);
const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
if (pkg.version !== characterVersion) throw new Error('字形依赖版本与资源版本不一致');
const checkOnly = process.argv.includes('--check');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = (await fs.readdir(source)).filter(file => file.endsWith('.json') && Array.from(file.slice(0, -5)).length === 1).sort();
const checksums = {};
const strokeCounts = [];
let rawBytes = 0;
let gzipBytes = 0;
if (!checkOnly) await fs.mkdir(target, { recursive: true });
for (const file of files) {
    const bytes = await fs.readFile(path.join(source, file));
    const data = validateCharacterData(JSON.parse(bytes));
    strokeCounts.push(data.strokes.length);
    checksums[file] = hash(bytes);
    rawBytes += bytes.length;
    gzipBytes += gzipSync(bytes).length;
    const destination = path.join(target, file);
    const existing = await fs.readFile(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!existing || hash(existing) !== checksums[file]) {
        if (checkOnly) throw new Error(`资源缺失或校验失败：${file}`);
        await fs.writeFile(destination, bytes);
    }
}
const resourceSetSha256 = hash(JSON.stringify(checksums));
const manifest = {
    schemaVersion: 1, version: characterVersion, source: `hanzi-writer-data@${characterVersion}`,
    count: files.length, characters: files.map(file => file.slice(0, -5)).join(''), strokeCounts,
    rawBytes, gzipBytes, resourceSetSha256, contentReview: 'not-fully-reviewed', license: 'ARPHICPL.TXT'
};
const outputs = {
    'manifest.json': JSON.stringify(manifest),
    'checksums.json': JSON.stringify(checksums),
    'ARPHICPL.TXT': await fs.readFile(path.join(source, 'ARPHICPL.TXT'), 'utf8'),
    'SOURCE.txt': `Unmodified single-character JSON from hanzi-writer-data@${characterVersion}.\nDerived from Make Me a Hanzi and Arphic fonts; see ARPHICPL.TXT.\nhttps://github.com/chanind/hanzi-writer-data\nResource set SHA-256: ${resourceSetSha256}\n`
};
for (const [file, text] of Object.entries(outputs)) {
    if (checkOnly) {
        if (await fs.readFile(path.join(target, file), 'utf8') !== text) throw new Error(`清单或许可不匹配：${file}`);
    } else await fs.writeFile(path.join(target, file), text);
}
console.log(`✅ ${checkOnly ? '校验' : '准备'} ${files.length} 字，原始 ${rawBytes} bytes，逐字 gzip ${gzipBytes} bytes；按字加载。`);
