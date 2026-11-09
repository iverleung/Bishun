import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { textbookBooks,validateTextbook } from '../src/data/textbooks.js';
const expectedBooks = {'g1-first':{title:'一年级上册',tasks:38,read:284,write:100,applied:141},'g1-second':{title:'一年级下册',tasks:36,read:419,write:200,applied:214}};
if (textbookBooks.length !== 2 || new Set(textbookBooks.map(book=>book.id)).size !== 2) throw new Error('教材索引不完整');
for (const entry of textbookBooks) {
    const expected = expectedBooks[entry.id];
    if (!expected) throw new Error('教材尚未核验');
    if (!/^\/textbooks\/pilot-v1\/g1-(first|second)-[a-f0-9]{12}\.json$/.test(entry.url) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('教材索引无效');
    const bytes = await fs.readFile('public'+entry.url);
    if (!entry.url.endsWith(`${entry.id}-${entry.sha256.slice(0,12)}.json`)) throw new Error('教材地址与资源版本不一致');
    if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('教材资源校验失败');
    const book = validateTextbook(JSON.parse(bytes),entry.id);
    if (entry.title !== expected.title || book.title !== expected.title) throw new Error('教材册名不一致');
    const resource = JSON.parse(await fs.readFile(`resources/textbooks/pilot-v1/${entry.id}.json`,'utf8'));
    if (JSON.stringify(book) !== JSON.stringify(resource)) throw new Error('教材公开资源与源数据不一致');
    if (book.source.correctionsSha256 !== createHash('sha256').update(await fs.readFile('resources/textbooks/proofread-corrections.json')).digest('hex')) throw new Error('教材校正版本已变更，请重新准备');
    const tasks = book.units.flatMap(unit => unit.tasks);
    if (tasks.length !== expected.tasks || tasks.filter(task => task.kind === 'garden').length !== 8 || tasks.reduce((sum,task)=>sum+task.read.length,0)!==expected.read || tasks.reduce((sum,task)=>sum+task.write.length,0)!==expected.write) throw new Error('教材内容不完整');
    if (book.source.appliedCells !== expected.applied) throw new Error('教材校正数量不一致');
    console.log(`${entry.title}：${expected.tasks} 项任务、${expected.read} 条会认／${expected.write} 条会写，本地资源与校正版本校验通过。`);
}
