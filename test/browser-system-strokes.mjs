import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openBrowser} from './helpers/cdp.mjs';
import {v3} from '../src/engine/recognition/v3.js';
const [cdp='http://127.0.0.1:9224',url='http://127.0.0.1:5189/']=process.argv.slice(2);
const review=JSON.parse(await fs.readFile('resources/textbooks/textbook-stroke-review.json','utf8'));
const browser=await openBrowser(cdp,url);
try{
    const {command,evaluate,click,fill,wait}=browser;
    await command('Page.addScriptToEvaluateOnNewDocument',{source:`window.voices=[];const create=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(...args){const source=create.apply(this,args),start=source.start;source.start=function(...args){voices.push({name:document.querySelector('#strokeName').textContent,position:document.querySelector('#strokePosition').textContent,word:document.querySelector('#wordPosition').textContent});return start.apply(this,args);};return source;};`});
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent==='请输入汉字'");
    async function query(text){await fill('#query',text);await click('#searchForm [type=submit]');await wait("!document.querySelector('#playBtn').disabled");}
    let positions=0;
    for(let offset=0;offset<review.characters.length;offset+=20){
        const entries=review.characters.slice(offset,offset+20);await query(entries.map(e=>e.character).join(''));
        for(const [index,entry] of entries.entries()){
            if(index){await click('#nextCharBtn');await wait(`document.querySelector('#wordPosition').textContent==='${index+1} / ${entries.length}' && !document.querySelector('#playBtn').disabled`);}
            const names=await evaluate(`(()=>{const names=[];for(let i=0;i<${entry.strokeCount};i++){document.querySelector('#nextStrokeBtn').click();names.push(document.querySelector('#strokeName').textContent);}return names;})()`);
            assert.deepEqual(names,v3.getStrokeNames(entry.character),entry.character);
            for(const stroke of entry.strokes){assert.equal(names[stroke.index],stroke.name);positions++;}
        }
    }
    assert.equal(positions,819);assert.deepEqual(await evaluate('voices'),[]);
    const sample='宇代忍乃队役传鼎互';await query(sample);await click('#playBtn');
    await wait(`document.querySelector('#wordPosition').textContent==='9 / 9' && document.querySelector('#playBtn').textContent==='重播'`,120000);
    const expected=Array.from(sample).flatMap((c,word)=>{const names=v3.getStrokeNames(c);return names.map((name,index)=>({name,position:`${index+1} / ${names.length} 笔`,word:`${word+1} / 9`}));});
    assert.deepEqual(await evaluate('voices'),expected);
    assert.equal(await evaluate("document.querySelector('#status').textContent"),'播放完成');
    await query('戋');await evaluate('voices=[]');await click('#playBtn');
    await wait("document.querySelector('#playBtn').textContent==='重播'",15000);
    assert.deepEqual(await evaluate('voices.map(item=>item.name)'),['横','横','撇','点']);
    assert.match(await evaluate("document.querySelector('#status').textContent"),/第 3 笔.*名称待核验/);
    await evaluate(`window.originalFetch=window.fetch;window.fetch=async(...args)=>{const response=await originalFetch(...args);if(String(args[0]).endsWith('/audio/strokes/v1/manifest.json')){const data=await response.json();data.items=data.items.filter(item=>item.text!=='横钩');return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});}return response;};`);
    // A fresh page gets a fresh audio catalog; keep this fault scoped to that page.
    const injected=await command('Page.addScriptToEvaluateOnNewDocument',{source:`const fetchOriginal=window.fetch;window.fetch=async(...args)=>{const response=await fetchOriginal(...args);if(String(args[0]).endsWith('/audio/strokes/v1/manifest.json')){const data=await response.json();data.items=data.items.filter(item=>item.text!=='横钩');return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});}return response;};`});
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent==='请输入汉字'");
    await query('宇');await click('#playBtn');await wait("document.querySelector('#playBtn').textContent==='重播'",15000);
    assert.deepEqual(await evaluate('voices.map(item=>item.name)'),['点','点','横','横','竖钩']);
    assert.match(await evaluate("document.querySelector('#status').textContent"),/第 3 笔.*录音暂缺/);
    await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:injected.identifier});
    assert.deepEqual(browser.exceptions,[]);
    console.log(JSON.stringify({browser:browser.version,characters:review.characters.length,reviewedPositions:positions,realVoiceStrokes:expected.length,checks:['all reviewed names render from production bundle','ten resolved name types including new 竖折折 play in order','unreviewed name warns and later strokes still speak','missing catalog entry warns and later strokes still speak'],exceptions:browser.exceptions},null,2));
}finally{await browser.close();}
