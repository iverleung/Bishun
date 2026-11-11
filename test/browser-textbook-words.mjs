import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openBrowser} from './helpers/cdp.mjs';
import {textbookBooks} from '../src/data/textbooks.js';
const [cdp='http://127.0.0.1:9224',url='http://127.0.0.1:5189/']=process.argv.slice(2);
const browser=await openBrowser(cdp,url);
try {
    const {command,evaluate,wait,click}=browser;
    const select=async(selector,value)=>evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)};document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}));`);
    const open=async()=>{await click('#menuBtn');await click('#openTextbookBtn');await wait("!document.querySelector('#openTextbookTaskBtn').disabled");};
    await open();
    let count=0,chosen;
    for(const entry of textbookBooks){
        const book=JSON.parse(await fs.readFile(`resources/textbooks/pilot-v1/${entry.id}.json`,'utf8'));
        await select('#textbookBook',entry.id);
        await wait(`document.querySelector('#textbookUnit').dataset.book===${JSON.stringify(entry.id)} && !document.querySelector('#textbookBody').hidden`);
        for(const unit of book.units){
            await select('#textbookUnit',unit.id);
            for(const task of unit.tasks){
                await click(`[data-task="${task.id}"]`);
                const words=task.words||[];
                assert.equal(await evaluate("document.querySelector('#textbookWordsBtn').disabled"),!words.length);
                if(!words.length)continue;
                await click('#textbookWordsBtn');
                assert.equal(await evaluate("document.querySelector('.textbook-footer').hidden"),true);
                assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#textbookCharacters button'),el=>({id:el.dataset.entry,text:el.querySelector('strong').textContent}))"),words.map(({id,text})=>({id,text})));
                assert.equal(await evaluate("document.querySelectorAll('#textbookCharacters span').length"),0);
                count+=words.length;
                if(words.some(word=>word.text.length===4))chosen={book,unit,task,index:words.findIndex(word=>word.text.length===4)};
            }
        }
    }
    assert.equal(count,2162);
    assert.equal(await evaluate("localStorage.getItem('bishun-textbook-last-v1')"),null);
    await select('#textbookBook',chosen.book.id);
    await wait(`document.querySelector('#textbookUnit').dataset.book===${JSON.stringify(chosen.book.id)} && !document.querySelector('#textbookBody').hidden`);
    await select('#textbookUnit',chosen.unit.id);await click(`[data-task="${chosen.task.id}"]`);await click('#textbookWordsBtn');
    await command('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate("document.querySelector('#textbookDialog').scrollWidth<=document.querySelector('#textbookDialog').clientWidth"),true);
    await browser.screenshot('/private/tmp/bishun-textbook-words-mobile.png');
    await click(`#textbookCharacters button:nth-child(${chosen.index+1})`);
    const word=chosen.task.words[chosen.index].text;
    await wait(`document.querySelector('#currentQuery').textContent===${JSON.stringify(word)} && !document.querySelector('#playBtn').disabled`);
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"),'1 / 4');
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"),'播放');
    assert.equal(await evaluate("localStorage.getItem('bishun-saved-queries-v2')"),null);
    await open();assert.equal(await evaluate("document.querySelector('#textbookWordsBtn').getAttribute('aria-pressed')"),'true');
    await click('#textbookWriteBtn');assert.equal(await evaluate("document.querySelector('.textbook-footer').hidden"),false);
    await click('#closeTextbookBtn');
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent==='请输入汉字'");
    await open();assert.equal(await evaluate("document.querySelector('#textbookWordsBtn').getAttribute('aria-pressed')"),'true');
    assert.equal(await evaluate("document.querySelector('#lesson').hidden"),true);
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await wait("!document.querySelector('#textbookDialog').open && document.activeElement.id==='menuBtn'");
    assert.deepEqual(browser.exceptions,[]);
    console.log(JSON.stringify({browser:browser.version,wordRecords:count,selected:word,checks:['12 books and all word cards match source; absent tables disabled','320px layout; whole four-character term opens at first character without autoplay or saving','footer restored for writing; confirmed word mode survives reopening/reload; Escape focus restored'],exceptions:browser.exceptions},null,2));
} finally {await browser.close();}
