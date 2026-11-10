import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { OfflinePacks,packPrefix,maxBytes } from '../src/offline/packs.js';
import { createHash } from 'node:crypto';

const origin='https://bishun.test';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
class MemoryCache {
    constructor(owner){this.owner=owner;this.items=new Map();}
    async put(key,response){this.owner.beforePut?.(key);this.items.set(key,response.clone());}
    async match(key){return this.items.get(typeof key==='string'?key:key.url)?.clone();}
}
class MemoryStorage {
    constructor(){this.items=new Map();}
    async keys(){return [...this.items.keys()];}
    async open(key){if(!this.items.has(key))this.items.set(key,new MemoryCache(this));return this.items.get(key);}
    async delete(key){return this.items.delete(key);}
}
async function fixture(characters=['木','水']) {
    const files=new Map();
    const json=(path,value)=>files.set(path,{body:Buffer.from(JSON.stringify(value)),type:'application/json'});
    const checksums={};
    for(const char of characters) {
        const bytes=await fs.readFile(new URL(`./data/${char}.json`,import.meta.url));
        checksums[`${char}.json`]=hash(bytes);
        files.set(`/characters/2.0.1/${encodeURIComponent(char)}.json`,{body:bytes,type:'application/json'});
    }
    json('/characters/2.0.1/manifest.json',{schemaVersion:1,version:'2.0.1',count:characters.length,characters:characters.join(''),strokeCounts:characters.map(char=>JSON.parse(files.get(`/characters/2.0.1/${encodeURIComponent(char)}.json`).body).strokes.length),resourceSetSha256:hash(JSON.stringify(checksums))});
    json('/characters/2.0.1/checksums.json',checksums);
    const catalog=JSON.parse(await fs.readFile(new URL('../public/audio/strokes/v1/manifest.json',import.meta.url),'utf8'));
    json('/audio/strokes/v1/manifest.json',catalog);
    for(const item of catalog.items)files.set(item.url,{body:await fs.readFile(new URL('../public'+item.url,import.meta.url)),type:'audio/mpeg'});
    const readings=JSON.parse(await fs.readFile(new URL('../resources/reading-audio-catalog.json',import.meta.url),'utf8'));
    for(const item of readings.items) files.set(item.url,{body:await fs.readFile(new URL('../public'+item.url,import.meta.url)),type:'audio/mpeg'});
    files.set('/',{body:Buffer.from('<!doctype html>offline fixture'),type:'text/html'});
    json('/offline-build.json',{schema:1,id:'build-A',files:Object.fromEntries(['/','/characters/2.0.1/manifest.json','/audio/strokes/v1/manifest.json'].map(path=>[path,hash(files.get(path).body)]))});
    const calls=[];
    const fetchImpl=async url=>{
        const path=new URL(url).pathname;calls.push(path);
        const item=files.get(path);
        return item?new Response(item.body,{headers:{'content-type':item.type,'content-length':String(item.body.length)}}):new Response('missing',{status:404});
    };
    const storage=new MemoryStorage();
    const packs=new OfflinePacks({storage,origin,buildId:'build-A',fetchImpl,timeoutMs:100});
    const save=(query,options)=>packs.save({query,expectedBuild:'build-A'},options);
    return {files,calls,storage,packs,save,fetchImpl};
}

test('offline save commits only selected unique glyphs and needed audio, preserving query order and repeats',async()=>{
    const f=await fixture();const saved=await f.save('木水木');
    assert.equal(saved.query,'木水木');assert.equal(saved.unknownNames,0);
    const glyphs=f.calls.filter(path=>/^\/characters\/.*\.json$/.test(path) && !/manifest|checksums/.test(path));
    assert.equal(glyphs.length,2);
    assert.equal(f.calls.filter(path=>path.startsWith('/audio/strokes/') && path.endsWith('.mp3')).length,6);
    assert.equal(f.calls.filter(path=>path.startsWith('/audio/readings/') && path.endsWith('.mp3')).length,2);
    assert.ok(saved.files.every(path=>!path.includes('checksums')));
    assert.equal((await f.packs.list({verify:true}))[0].broken,undefined);
    assert.equal((await f.packs.match(new Request(origin+'/?any=1'))).status,200);
});

test('failed checksum or incomplete update rolls back staging and preserves the previous usable pack',async()=>{
    const f=await fixture();const old=await f.save('木');
    const path='/characters/2.0.1/'+encodeURIComponent('木')+'.json';
    f.files.get(path).body=Buffer.from('{"bad":true}');
    await assert.rejects(f.save('木'),/校验失败/);
    assert.equal((await f.packs.list())[0].cacheName,old.cacheName);
    assert.equal((await f.storage.keys()).filter(key=>key.startsWith(packPrefix)).length,1);
});

test('cancel and storage quota errors never publish a partial pack or remove an old pack',async()=>{
    const f=await fixture();const old=await f.save('木');
    const controller=new AbortController();
    await assert.rejects(f.save('木',{signal:controller.signal,progress:()=>controller.abort()}),{name:'AbortError'});
    f.storage.beforePut=key=>{if(key.endsWith('.mp3'))throw new DOMException('quota','QuotaExceededError');};
    await assert.rejects(f.save('木'),/空间不足/);
    f.storage.beforePut=null;
    assert.deepEqual((await f.packs.list()).map(item=>item.cacheName),[old.cacheName]);
});

test('unsupported characters and stale builds cannot produce successful offline metadata',async()=>{
    const f=await fixture();
    await assert.rejects(f.save('木𠮷'),/𠮷.*未收录/);
    await assert.rejects(f.packs.save({query:'木',expectedBuild:'build-B'}),/版本已变化/);
    assert.equal((await f.packs.list()).length,0);
    assert.equal((await f.storage.keys()).filter(key=>key.startsWith(packPrefix)).length,0);
});

test('offline pack count and total byte limits reject extra saves without silently evicting old queries',async()=>{
    const f=await fixture();
    for(let count=1;count<=10;count++)await f.save('木'.repeat(count));
    await assert.rejects(f.save('水'),/最多保存 10/);
    assert.equal((await f.packs.list()).length,10);
    const g=await fixture();const saved=await g.save('木');
    const cache=await g.storage.open(saved.cacheName);
    await cache.put(origin+'/__bishun_offline_pack__',new Response(JSON.stringify({...saved,bytes:maxBytes})));
    await assert.rejects(g.save('水'),/超过 20 MB/);
    assert.equal((await g.packs.list()).length,1);
});

test('evicted files mark packs incomplete and cannot provide a false offline navigation; deletion is scoped',async()=>{
    const f=await fixture();const saved=await f.save('木');
    (await f.storage.open(saved.cacheName)).items.delete(origin+'/');
    assert.equal((await f.packs.list({verify:true}))[0].broken,true);
    assert.equal(await f.packs.match(new Request(origin+'/')),null);
    await f.storage.open('another-app-cache');
    await assert.rejects(f.packs.remove('another-app-cache'),/无效/);
    await f.packs.remove(saved.cacheName);
    assert.deepEqual(await f.storage.keys(),['another-app-cache']);
});

test('timed-out resource bodies and late replies cannot commit an offline pack',async()=>{
    const f=await fixture();const old=await f.save('木');
    const original=f.packs.fetch;let release;
    f.packs.timeoutMs=5;
    f.packs.fetch=async(url,options)=>url.endsWith(encodeURIComponent('木')+'.json')?new Response(new ReadableStream({start(controller){release=()=>controller.close();}}),{headers:{'content-type':'application/json'}}):original(url,options);
    await assert.rejects(f.save('木'),/超时/);
    release();await new Promise(resolve=>setTimeout(resolve,10));
    assert.deepEqual((await f.packs.list()).map(item=>item.cacheName),[old.cacheName]);
});


test('cancellation while committing metadata still preserves the old complete pack',async()=>{
    const f=await fixture();const old=await f.save('木');
    const controller=new AbortController();
    f.storage.beforePut=key=>{if(key.endsWith('/__bishun_offline_pack__'))controller.abort();};
    await assert.rejects(f.save('木',{signal:controller.signal}),{name:'AbortError'});
    f.storage.beforePut=null;
    assert.deepEqual((await f.packs.list()).map(item=>item.cacheName),[old.cacheName]);
});

test('correct bytes with an unusable MIME type are not advertised as a usable offline shell',async()=>{
    const f=await fixture();f.files.get('/').type='text/plain';
    await assert.rejects(f.save('木'),/资源类型无效/);
    assert.equal((await f.packs.list()).length,0);
});


test('deleting a query removes old committed copies left behind by interrupted cleanup',async()=>{
    const f=await fixture();const old=await f.save('木');
    const remove=f.storage.delete.bind(f.storage);
    f.storage.delete=async key=>key===old.cacheName?false:remove(key);
    const current=await f.save('木');
    assert.equal((await f.packs.list()).length,2);
    f.storage.delete=remove;
    await f.packs.remove(current.cacheName);
    assert.equal((await f.packs.list()).length,0);
});


test('interrupted duplicate snapshots do not consume an extra logical query slot',async()=>{
    const f=await fixture();const old=await f.save('木');
    const remove=f.storage.delete.bind(f.storage);
    f.storage.delete=async key=>key===old.cacheName?false:remove(key);
    await f.save('木');f.storage.delete=remove;
    for(let count=2;count<=9;count++)await f.save('木'.repeat(count));
    await f.save('水');
    assert.equal(new Set((await f.packs.list()).map(item=>item.query)).size,10);
    await assert.rejects(f.save('水木'),/最多保存 10/);
});

test('saving 田 offline uses the replacement recording and never the rejected tian2 URL',async()=>{
    const {readingRecording}=await import('../src/data/reading-audio.js');
    const item=readingRecording('tián');
    const f=await fixture(['田']);const saved=await f.save('田');
    assert.ok(saved.files.includes(item.url));
    assert.ok(!saved.files.includes('/audio/readings/v1/reading-16e6e7372e8f.mp3'));
    assert.ok(!f.calls.includes('/audio/readings/v1/reading-16e6e7372e8f.mp3'));
    const cached=await f.packs.match(new Request(origin+item.url));
    assert.equal(hash(Buffer.from(await cached.arrayBuffer())),item.sha256);
});

test('new first-grade 我 reading is saved once for repeated characters and verified in its offline pack',async()=>{
    const {readingRecording}=await import('../src/data/reading-audio.js');
    const item=readingRecording('wǒ');
    const f=await fixture(['我']);const saved=await f.save('我我');
    assert.equal(saved.query,'我我');
    assert.equal(f.calls.filter(path=>path===item.url).length,1);
    assert.ok(saved.files.includes(item.url));
    const cached=await f.packs.match(new Request(origin+item.url));
    assert.equal(hash(Buffer.from(await cached.arrayBuffer())),item.sha256);
});

test('子子 saves new zǐ and approved zì as separate offline readings without duplicate downloads',async()=>{
    const {readingRecording}=await import('../src/data/reading-audio.js');
    const f=await fixture(['子']);const saved=await f.save('子子');
    assert.equal(saved.query,'子子');
    for(const reading of ['zǐ','zì']){
        const item=readingRecording(reading);
        assert.equal(f.calls.filter(path=>path===item.url).length,1);
        assert.ok(saved.files.includes(item.url));
        const cached=await f.packs.match(new Request(origin+item.url));
        assert.equal(hash(Buffer.from(await cached.arrayBuffer())),item.sha256);
    }
});
