import test from 'node:test';
import assert from 'node:assert/strict';
import book from '../resources/textbooks/pilot-v1/g1-first.json' with { type:'json' };
import {TextbookStore,validateTextbook,textbookSelection,textbookBooks} from '../src/data/textbooks.js';
const clone = () => structuredClone(book);
const json = value => new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('pilot keeps 384 source occurrences and eight independent gardens, with corrected right-column courses',()=>{
    validateTextbook(book,'g1-first');
    const tasks=book.units.flatMap(unit=>unit.tasks);
    assert.equal(tasks.length,38);assert.equal(tasks.filter(task=>task.kind==='garden').length,8);
    assert.equal(tasks.reduce((n,task)=>n+task.read.length,0),284);assert.equal(tasks.reduce((n,task)=>n+task.write.length,0),100);
    assert.equal(book.source.appliedCells,141);
    assert.equal(textbookSelection(book,'pinyin-4','read').query,'大马路土');
    assert.equal(textbookSelection(book,'pinyin-13','read').query,'蓝云草原');
    assert.equal(textbookSelection(book,'garden-2','write').query,'九王');
    const green=tasks.flatMap(task=>task.read).find(entry=>entry.character==='绿');assert.equal(green.reading,'lǜ');
});
test('default writing falls back to recognition only when absent and selecting a character preserves the whole group',()=>{
    const first=textbookSelection(book,'literacy-1');assert.equal(first.mode,'read');assert.equal(first.query,'天地人你我他');
    const writing=textbookSelection(book,'literacy-2','write',2);assert.equal(writing.query,'一二三上');assert.equal(writing.index,2);
    assert.throws(()=>textbookSelection(book,'literacy-2','write',4),/请选择/);
    const data=clone();const task=data.units[0].tasks[0];task.read.push({...task.read[0],id:'row-999',reading:'tiǎn',sourceRow:999});
    assert.equal(textbookSelection(data,'literacy-1','read',6).query,'天地人你我他天');
});
test('invalid, oversized or duplicated source entries cannot silently become a truncated lesson',()=>{
    let data=clone();data.units[0].tasks[0].read[0].character='<script>';assert.throws(()=>validateTextbook(data,'g1-first'),/无效/);
    data=clone();data.units[0].tasks[0].read[0].reading='lC';assert.throws(()=>validateTextbook(data,'g1-first'),/无效/);
    data=clone();data.units[0].tasks[0].read=Array(21).fill(data.units[0].tasks[0].read[0]);assert.throws(()=>validateTextbook(data,'g1-first'),/无效/);
    data=clone();data.units[0].tasks[0].read.push(data.units[0].tasks[0].read[0]);assert.throws(()=>validateTextbook(data,'g1-first'),/无效/);
});
test('textbook fetch is opt-in, local and successful immutable data is reused',async()=>{
    const calls=[];const store=new TextbookStore({fetchImpl:async url=>{calls.push(url);return json(book);}});
    assert.deepEqual(calls,[]);const one=await store.load('g1-first');assert.equal(await store.load('g1-first'),one);
    assert.deepEqual(calls,[textbookBooks[0].url]);assert.ok(calls[0].startsWith('/textbooks/pilot-v1/'));
    assert.throws(()=>one.units[0].tasks[0].read.pop(),TypeError);
    await assert.rejects(store.load('g2-first'),/暂未开放/);
});
test('cancelling a slow response rejects promptly and never caches its late value',async()=>{
    let resolve;let calls=0;const store=new TextbookStore({fetchImpl:()=>{calls++;return new Promise(done=>{resolve=done;});}});
    const controller=new AbortController();const cancelled=assert.rejects(store.load('g1-first',{signal:controller.signal}),{name:'AbortError'});
    controller.abort();await cancelled;resolve(json(book));await new Promise(done=>setImmediate(done));assert.equal(store.books.size,0);
    store.fetch=async()=>{calls++;return json(book);};await store.load('g1-first');assert.equal(calls,2);
});
test('bounded loads and invalid HTML/JSON responses are recoverable without altering the current query',async()=>{
    const slow=new TextbookStore({timeoutMs:5,fetchImpl:()=>new Promise(()=>{})});await assert.rejects(slow.load('g1-first'),/超时/);
    const store=new TextbookStore({fetchImpl:async()=>new Response('<html>fallback</html>',{headers:{'content-type':'text/html'}})});
    await assert.rejects(store.load('g1-first'),/暂不可用/);assert.equal(store.books.size,0);
    store.fetch=async()=>new Response('{bad',{headers:{'content-type':'application/json'}});await assert.rejects(store.load('g1-first'),/重试/);
    store.fetch=async()=>json(book);assert.equal((await store.load('g1-first')).id,'g1-first');
});
