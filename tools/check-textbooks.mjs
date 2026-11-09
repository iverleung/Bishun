import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { textbookBooks,validateTextbook } from '../src/data/textbooks.js';
for (const entry of textbookBooks) {
    if (!/^\/textbooks\/pilot-v1\/g1-first-[a-f0-9]{12}\.json$/.test(entry.url) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('教材索引无效');
    const bytes = await fs.readFile('public'+entry.url);
    if (!entry.url.endsWith(`g1-first-${entry.sha256.slice(0,12)}.json`)) throw new Error('教材地址与资源版本不一致');
    if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('教材资源校验失败');
    const book = validateTextbook(JSON.parse(bytes),entry.id);
    const resource = JSON.parse(await fs.readFile(`resources/textbooks/pilot-v1/${entry.id}.json`,'utf8'));
    if (JSON.stringify(book) !== JSON.stringify(resource)) throw new Error('教材公开资源与源数据不一致');
    if (book.source.correctionsSha256 !== createHash('sha256').update(await fs.readFile('resources/textbooks/proofread-corrections.json')).digest('hex')) throw new Error('教材校正版本已变更，请重新准备');
    const tasks = book.units.flatMap(unit => unit.tasks);
    if (tasks.length !== 38 || tasks.filter(task => task.kind === 'garden').length !== 8 || tasks.reduce((sum,task)=>sum+task.read.length,0)!==284 || tasks.reduce((sum,task)=>sum+task.write.length,0)!==100) throw new Error('一上教材内容不完整');
    console.log('一年级上册：38 项独立任务、284 条会认／100 条会写，本地资源与校正版本校验通过。');
}
