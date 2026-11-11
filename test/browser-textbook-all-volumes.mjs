import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openBrowser} from './helpers/cdp.mjs';
import {textbookBooks} from '../src/data/textbooks.js';

const [cdp='http://127.0.0.1:9224',url='http://127.0.0.1:5189/']=process.argv.slice(2);
const books=new Map(await Promise.all(textbookBooks.map(async entry=>[entry.id,JSON.parse(await fs.readFile(`resources/textbooks/pilot-v1/${entry.id}.json`,'utf8'))])));
const browser=await openBrowser(cdp,url);
const checks=[];
try {
    const {command,evaluate,wait,click,fill}=browser;
    async function select(selector,value){await evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)};document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}));`);}
    async function open(){await click('#menuBtn');await click('#openTextbookBtn');await wait("!document.querySelector('#openTextbookTaskBtn').disabled");}
    async function volume(id){await select('#textbookBook',id);await wait(`document.querySelector('#textbookUnit').dataset.book===${JSON.stringify(id)} && !document.querySelector('#textbookBody').hidden && !document.querySelector('#openTextbookTaskBtn').disabled`);}
    await command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    assert.equal(browser.requests.some(url=>url.includes('/textbooks/')),false);
    await fill('#query','木水');await click('#searchForm [type=submit]');await wait("!document.querySelector('#playBtn').disabled");
    await open();
    assert.deepEqual(await evaluate("Array.from(document.querySelector('#textbookBook').options,option=>option.textContent)"),textbookBooks.map(book=>book.title));
    assert.equal(browser.requests.filter(url=>url.includes('/textbooks/')).length,1);
    checks.push('all twelve volumes appear in grade/semester order and only the explicitly opened first volume loads');

    let tasks=0,occurrences=0;
    for(const entry of textbookBooks){
        await volume(entry.id);const book=books.get(entry.id);
        assert.deepEqual(await evaluate("Array.from(document.querySelector('#textbookUnit').options,option=>option.value)"),book.units.map(unit=>unit.id));
        for(const unit of book.units){
            await select('#textbookUnit',unit.id);
            for(const task of unit.tasks){
                tasks++;await click(`[data-task="${task.id}"]`);
                assert.equal(await evaluate("document.querySelector('#textbookTaskTitle').textContent"),task.title);
                for(const [mode,button] of [['write','textbookWriteBtn'],['read','textbookReadBtn']]){
                    if(!task[mode].length){assert.equal(await evaluate(`document.querySelector('#${button}').disabled`),true);continue;}
                    await click('#'+button);
                    const cards=await evaluate("Array.from(document.querySelectorAll('#textbookCharacters button'),button=>({id:button.dataset.entry,character:button.querySelector('strong').textContent,reading:button.querySelector('span')?.textContent||null,polyphonic:button.classList.contains('is-polyphonic')}))");
                    assert.deepEqual(cards,task[mode].map(entry=>({id:entry.id,character:entry.character,reading:entry.reading,polyphonic:entry.polyphonic})));
                    assert.equal(await evaluate("Array.from(document.querySelectorAll('#textbookCharacters button')).some(button=>button.getAttribute('aria-label').includes('null'))"),false);
                    occurrences+=cards.length;
                }
            }
        }
    }
    assert.equal(tasks,350);assert.equal(occurrences,5657);
    assert.equal(await evaluate("document.querySelector('#currentQuery').textContent"),'木水');
    assert.equal(await evaluate("localStorage.getItem('bishun-textbook-last-v1')"),null);
    checks.push('all 350 tasks and 5657 source occurrences render with exact readings/nulls/blue flags; browsing every course does not submit or persist a draft');

    const sixth=books.get('g6-second');const task=sixth.units.at(-1).tasks.at(-1);
    assert.equal(await evaluate("document.querySelector('#textbookReadBtn').disabled"),true);
    assert.equal(await evaluate("document.querySelectorAll('#textbookCharacters span').length"),0);
    await browser.screenshot('/private/tmp/bishun-twelve-textbooks-desktop.png');
    await click('#textbookCharacters button:nth-child(3)');
    const query=task.write.map(entry=>entry.character).join('');
    await wait(`document.querySelector('#currentQuery').textContent===${JSON.stringify(query)} && document.querySelector('#wordPosition').textContent==='3 / ${task.write.length}' && !document.querySelector('#playBtn').disabled`);
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"),'播放');
    assert.match(await evaluate("document.querySelector('#textbookCurrent').textContent"),/六年级下册/);
    assert.equal(await evaluate("localStorage.getItem('bishun-saved-queries-v2')"),null);
    checks.push('sixth-grade writing-only content has no invented pinyin; clicking a character opens its full group at the correct index without autoplay or collection');

    await open();await volume('g5-second');
    assert.deepEqual(await evaluate("Array.from(document.querySelector('#textbookUnit').options,option=>option.value)"),['unit-1','unit-2','unit-4','unit-5','unit-6','unit-7','unit-8']);
    await click('#closeTextbookBtn');await open();
    assert.equal(await evaluate("document.querySelector('#textbookBook').value"),'g6-second');
    assert.equal(await evaluate("document.querySelector('#textbookLessons [aria-pressed=true]').dataset.task"),task.id);
    checks.push('fifth-grade comprehensive units do not create empty tasks; cancelling another volume returns to the last confirmed sixth-grade course');

    await command('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    assert.equal(await evaluate("document.querySelector('#textbookDialog').scrollWidth<=document.querySelector('#textbookDialog').clientWidth"),true);
    await browser.screenshot('/private/tmp/bishun-twelve-textbooks-mobile.png');
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await wait("!document.querySelector('#textbookDialog').open && document.activeElement.id==='menuBtn'");
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent==='请输入汉字'");
    await open();assert.equal(await evaluate("document.querySelector('#textbookBook').value"),'g6-second');
    assert.equal(await evaluate("document.querySelector('#textbookLessons [aria-pressed=true]').dataset.task"),task.id);
    assert.equal(await evaluate("document.querySelector('#lesson').hidden"),true);
    checks.push('320px layout fits the twelve-volume selector; Escape restores visible focus and refresh restores only the confirmed browsing location');
    assert.deepEqual(browser.exceptions,[]);
    console.log(JSON.stringify({browser:browser.version,checks,exceptions:browser.exceptions},null,2));
} finally {await browser.close();}
