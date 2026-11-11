import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { textbookBooks,validateTextbook } from '../src/data/textbooks.js';
const expectedBooks = {
    'g1-first':{title:'一年级上册',tasks:38,gardens:8,read:284,write:100,applied:141},
    'g1-second':{title:'一年级下册',tasks:36,gardens:8,read:419,write:200,applied:214},
    'g2-first':{title:'二年级上册',tasks:35,gardens:8,read:482,write:250,applied:284},
    'g2-second':{title:'二年级下册',tasks:36,gardens:8,read:465,write:250,applied:1},
    'g3-first':{title:'三年级上册',tasks:30,gardens:4,read:277,write:250,applied:0},
    'g3-second':{title:'三年级下册',tasks:31,gardens:4,read:275,write:250,applied:37},
    'g4-first':{title:'四年级上册',tasks:31,gardens:4,read:265,write:250,applied:0},
    'g4-second':{title:'四年级下册',tasks:32,gardens:4,read:269,write:250,applied:210},
    'g5-first':{title:'五年级上册',tasks:27,gardens:2,read:209,write:220,applied:0},
    'g5-second':{title:'五年级下册',tasks:23,gardens:0,read:212,write:180,applied:0,units:[1,2,4,5,6,7,8]},
    'g6-first':{title:'六年级上册',tasks:19,gardens:0,read:0,write:180,applied:0},
    'g6-second':{title:'六年级下册',tasks:12,gardens:0,read:0,write:120,applied:182,units:[1,2,3,4,5]}
};
const wordCounts = [0,0,236,240,250,271,220,213,213,142,215,162];
if (textbookBooks.length !== 12 || new Set(textbookBooks.map(book=>book.id)).size !== 12) throw new Error('教材索引不完整');
const correctionsBytes = await fs.readFile('resources/textbooks/proofread-corrections.json');
const correctionHash = createHash('sha256').update(correctionsBytes).digest('hex');
const sourceHashes = JSON.parse(correctionsBytes).sourceHashes;
const workbookHash = sourceHashes[Object.keys(sourceHashes).find(path=>path.endsWith('.xlsx'))];
for (const entry of textbookBooks) {
    const expected = expectedBooks[entry.id];
    if (!expected) throw new Error('教材尚未核验');
    if (!/^\/textbooks\/pilot-v1\/g[1-6]-(first|second)-[a-f0-9]{12}\.json$/.test(entry.url) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('教材索引无效');
    const bytes = await fs.readFile('public'+entry.url);
    if (!entry.url.endsWith(`${entry.id}-${entry.sha256.slice(0,12)}.json`)) throw new Error('教材地址与资源版本不一致');
    if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('教材资源校验失败');
    const book = validateTextbook(JSON.parse(bytes),entry.id);
    if (entry.title !== expected.title || book.title !== expected.title) throw new Error('教材册名不一致');
    const resource = JSON.parse(await fs.readFile(`resources/textbooks/pilot-v1/${entry.id}.json`,'utf8'));
    if (JSON.stringify(book) !== JSON.stringify(resource)) throw new Error('教材公开资源与源数据不一致');
    if (book.source.correctionsSha256 !== correctionHash) throw new Error('教材校正版本已变更，请重新准备');
    const tasks = book.units.flatMap(unit => unit.tasks);
    if (tasks.reduce((sum,task)=>sum+(task.words?.length || 0),0) !== wordCounts[textbookBooks.indexOf(entry)]) throw new Error('教材词语数量不一致');
    if (tasks.length !== expected.tasks || tasks.filter(task => task.kind === 'garden').length !== expected.gardens || tasks.reduce((sum,task)=>sum+task.read.length,0)!==expected.read || tasks.reduce((sum,task)=>sum+task.write.length,0)!==expected.write) throw new Error('教材内容不完整');
    if (JSON.stringify(book.units.map(unit=>Number(unit.id.slice(5)))) !== JSON.stringify(expected.units || [1,2,3,4,5,6,7,8])) throw new Error('教材单元编号不一致');
    if (book.source.workbookSha256 !== workbookHash || book.source.pdfSha256 !== sourceHashes[`refs/${expected.title}.pdf`]) throw new Error('教材原件版本不一致');
    if (book.source.appliedCells !== expected.applied) throw new Error('教材校正数量不一致');
    console.log(`${entry.title}：${expected.tasks} 项任务、${expected.read} 条会认／${expected.write} 条会写，本地资源与校正版本校验通过。`);
}
