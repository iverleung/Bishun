import test from 'node:test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import secondBook from '../resources/textbooks/pilot-v1/g1-second.json' with { type:'json' };
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
    await assert.rejects(store.load('g7-first'),/暂未开放/);
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

test('second volume preserves all corrected source records and independent gardens',()=>{
    validateTextbook(secondBook,'g1-second');
    assert.equal(secondBook.title,'一年级下册');
    const tasks=secondBook.units.flatMap(unit=>unit.tasks);
    assert.equal(tasks.length,36);assert.equal(tasks.filter(task=>task.kind==='garden').length,8);
    assert.equal(tasks.reduce((sum,task)=>sum+task.read.length,0),419);
    assert.equal(tasks.reduce((sum,task)=>sum+task.write.length,0),200);
    assert.equal(tasks.flatMap(task=>task.read).filter(entry=>entry.polyphonic).length,9);
    assert.equal(secondBook.source.appliedCells,214);
    assert.equal(textbookSelection(secondBook,'literacy-1','write').query,'春冬吹花飞入');
    assert.equal(tasks.find(task=>task.id==='literacy-1').title,'春夏秋冬');
    assert.equal(textbookSelection(secondBook,'literacy-1','read').query,'霜吹落降飘游池入');
    assert.equal(textbookSelection(secondBook,'garden-1','write').query,'文卡片合');
    assert.notEqual(textbookSelection(book,'literacy-1').query,textbookSelection(secondBook,'literacy-1').query);
});
test('volume caches and identity validation cannot substitute the same lesson ID from another book',async()=>{
    const calls=[];
    const store=new TextbookStore({fetchImpl:async url=>{calls.push(url);return json(url===textbookBooks[0].url?book:secondBook);}});
    const first=await store.load('g1-first');const second=await store.load('g1-second');
    assert.equal(await store.load('g1-first'),first);assert.equal(await store.load('g1-second'),second);
    assert.equal(calls.length,2);assert.notEqual(first,second);
    assert.throws(()=>validateTextbook(book,'g1-second'),/无效/);
    const swapped=new TextbookStore({fetchImpl:async()=>json(book)});
    await assert.rejects(swapped.load('g1-second'),/无效/);
    assert.equal(swapped.books.size,0);
});

test('all twelve books preserve every recognition and writing occurrence within the query limit',async()=>{
    assert.equal(textbookBooks.length,12);
    assert.deepEqual(textbookBooks.map(book=>book.id),[1,2,3,4,5,6].flatMap(g=>[`g${g}-first`,`g${g}-second`]));
    let tasks=0,read=0,write=0;
    for(const entry of textbookBooks){
        const book=validateTextbook(JSON.parse(await fs.readFile(`resources/textbooks/pilot-v1/${entry.id}.json`,'utf8')),entry.id);
        for(const task of book.units.flatMap(unit=>unit.tasks)){
            tasks++;read+=task.read.length;write+=task.write.length;
            for(const mode of ['read','write'])if(task[mode].length){
                const last=task[mode].length-1;
                const selection=textbookSelection(book,task.id,mode,last);
                assert.equal(selection.query,task[mode].map(entry=>entry.character).join(''));
                assert.equal(selection.index,last);assert.equal(selection.bookId,book.id);
            }
        }
    }
    assert.deepEqual({tasks,read,write},{tasks:350,read:3157,write:2500});
});

test('upper grades retain absent reading tables, real unit numbering and independent unnumbered gardens',async()=>{
    const load=async id=>JSON.parse(await fs.readFile(`resources/textbooks/pilot-v1/${id}.json`,'utf8'));
    const third=await load('g3-first');const garden=third.units[2].tasks.find(task=>task.id==='garden-3');
    assert.equal(garden.sourceLabel,'语文园地');assert.equal(garden.title,'语文园地三');
    assert.equal(garden.read.length,8);assert.equal(garden.write.length,8);
    assert.ok(garden.write.every(entry=>entry.reading===null));
    const fifth=await load('g5-second');assert.deepEqual(fifth.units.map(unit=>unit.id),['unit-1','unit-2','unit-4','unit-5','unit-6','unit-7','unit-8']);
    const sixth=await load('g6-second');validateTextbook(sixth,sixth.id);
    assert.equal(sixth.units.length,5);assert.ok(sixth.units.every(unit=>unit.tasks.every(task=>!task.read.length)));
    const selection=textbookSelection(sixth,'reading-5','read');assert.equal(selection.mode,'write');
    assert.match(selection.name,/鲁滨逊漂流记/);assert.equal(selection.query,'惧凄寞宴霉籍聊乏控贷剔毙抵袭覆');
    assert.equal(sixth.units.flatMap(unit=>unit.tasks).find(task=>task.id==='reading-8').title,'匆匆');
    const invalid=structuredClone(sixth);invalid.units=[];assert.throws(()=>validateTextbook(invalid,invalid.id),/无效/);
    const missing=clone();missing.units[0].tasks[0].read[0].reading=null;assert.throws(()=>validateTextbook(missing,missing.id),/无效/);
});

test('every newly available volume loads on demand into its own immutable cache',async()=>{
    const calls=[];const store=new TextbookStore({fetchImpl:async url=>{
        const entry=textbookBooks.find(entry=>entry.url===url);calls.push(entry.id);
        return json(JSON.parse(await fs.readFile(`resources/textbooks/pilot-v1/${entry.id}.json`,'utf8')));
    }});
    for(const entry of textbookBooks){const book=await store.load(entry.id);assert.equal(book.id,entry.id);assert.equal(await store.load(entry.id),book);assert.ok(Object.isFrozen(book));}
    assert.deepEqual(calls,textbookBooks.map(entry=>entry.id));
});


test('all source words open one complete term and preserve duplicate occurrences without class concatenation',async()=>{
    let count=0;const terms=new Set();let longClass=false;
    for(const entry of textbookBooks){
        const book=validateTextbook(JSON.parse(await fs.readFile(`resources/textbooks/pilot-v1/${entry.id}.json`,'utf8')),entry.id);
        for(const task of book.units.flatMap(unit=>unit.tasks)){
            const words=task.words||[];
            if(words.map(word=>word.text).join('').length>20)longClass=true;
            for(const [index,word] of words.entries()){
                const selected=textbookSelection(book,task.id,'words',index);
                assert.equal(selected.query,word.text);assert.equal(selected.index,0);assert.equal(selected.mode,'words');
                assert.match(selected.name,/词语/);count++;terms.add(word.text);
            }
            assert.throws(()=>textbookSelection(book,task.id,'words',words.length),/请选择/);
        }
    }
    assert.equal(count,2162);assert.equal(terms.size,2108);assert.equal(longClass,true);
});
test('optional word records reject malformed terms and duplicate source IDs',()=>{
    const valid=clone();valid.units[0].tasks[0].words=[{id:'row-9999',text:'天地',sourceRow:9999,pdfPage:100}];
    validateTextbook(valid,valid.id);
    for(const text of ['', '天地，', '天'.repeat(21), '<script>']){
        const data=structuredClone(valid);data.units[0].tasks[0].words[0].text=text;
        assert.throws(()=>validateTextbook(data,data.id),/无效/);
    }
    const data=structuredClone(valid);data.units[0].tasks[0].words=null;assert.throws(()=>validateTextbook(data,data.id),/无效/);
    valid.units[0].tasks[0].words.push({...valid.units[0].tasks[0].words[0]});assert.throws(()=>validateTextbook(valid,valid.id),/无效/);
});
