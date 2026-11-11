import assert from 'node:assert/strict';
import {openBrowser} from './helpers/cdp.mjs';
const [cdp='http://127.0.0.1:9224',url='http://127.0.0.1:5189/']=process.argv.slice(2);
const browser=await openBrowser(cdp,url);
try{
    const {command,evaluate,click,fill,wait}=browser;
    await command('Page.addScriptToEvaluateOnNewDocument',{source:`window.strokeVoices=[];const create=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(...args){const source=create.apply(this,args);const start=source.start;source.start=function(...args){strokeVoices.push({name:document.querySelector('#strokeName').textContent,position:document.querySelector('#strokePosition').textContent,word:document.querySelector('#wordPosition').textContent});return start.apply(this,args);};return source;};`});
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent==='请输入汉字'");
    await fill('#query','婆饼');await click('#searchForm [type=submit]');await wait("!document.querySelector('#playBtn').disabled");
    await click('#playBtn');await wait("document.querySelector('#playBtn').textContent==='重播' && document.querySelector('#wordPosition').textContent==='2 / 2'",45000);
    const names=[['点','点','提','横钩','撇','竖','横撇','捺','撇点','撇','横'],['撇','横钩','竖提','点','撇','横','横','撇','竖']];
    const expected=names.flatMap((list,word)=>list.map((name,index)=>({name,position:`${index+1} / ${list.length} 笔`,word:`${word+1} / 2`})));
    assert.deepEqual(await evaluate('strokeVoices'),expected);
    assert.equal(await evaluate("document.querySelector('#status').textContent"),'播放完成');
    assert.deepEqual(browser.exceptions,[]);
    console.log('PASS: all 20 strokes in 婆饼 start real audio in exact order; 婆4/7 and 饼2 resolve; no silent gaps or runtime exceptions');
}finally{await browser.close();}
