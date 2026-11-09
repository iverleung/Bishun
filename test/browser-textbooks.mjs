import assert from 'node:assert/strict';
import {openBrowser} from './helpers/cdp.mjs';
import {practiceStroke} from './helpers/practice-input.mjs';
import {textbookBooks} from '../src/data/textbooks.js';
const [cdp='http://127.0.0.1:9224',url='http://127.0.0.1:5189/']=process.argv.slice(2);
const browser=await openBrowser(cdp,url);const checks=[];
try {
    const {evaluate,command,wait,click,fill}=browser;
    const ready="!document.querySelector('#playBtn').disabled";
    async function query(value){await fill('#query',value);await click('#searchForm [type=submit]');await wait(ready);}
    async function open(){if(!await evaluate("document.querySelector('#settings').open"))await click('#menuBtn');await click('#openTextbookBtn');await wait("document.querySelector('#textbookDialog').open && !document.querySelector('#openTextbookTaskBtn').disabled");}
    async function unit(id){await evaluate(`document.querySelector('#textbookUnit').value=${JSON.stringify(id)};document.querySelector('#textbookUnit').dispatchEvent(new Event('change',{bubbles:true}));`);}
    const preview="Array.from(document.querySelectorAll('#textbookCharacters strong'),el=>el.textContent).join('')";
    assert.equal(browser.requests.some(url=>url.includes('/textbooks/')),false);
    await query('木水');await click('#nextStrokeBtn');
    const progress=await evaluate("document.querySelector('#strokePosition').textContent");
    await open();
    assert.equal(await evaluate("document.querySelector('#settings').open"),false);
    assert.equal(await evaluate("document.activeElement.id"),'closeTextbookBtn');
    assert.equal(await evaluate(preview),'天地人你我他');
    assert.equal(await evaluate("document.querySelector('#textbookWriteBtn').disabled"),true);
    await click('[data-task="literacy-2"]');assert.equal(await evaluate(preview),'一二三上');
    assert.equal(await evaluate("document.activeElement.dataset.task"),'literacy-2');
    await click('#closeTextbookBtn');await wait("!document.querySelector('#textbookDialog').open && document.activeElement.id==='menuBtn'");
    assert.equal(await evaluate("document.querySelector('#currentQuery').textContent"),'木水');
    assert.equal(await evaluate("document.querySelector('#strokePosition').textContent"),progress);
    assert.equal(await evaluate("document.documentElement.classList.contains('drawer-open')"),false);
    checks.push('textbook JSON loads only on explicit entry; absent writing falls back to recognition; cancelling retains query/progress and restores visible focus');

    await open();await click('[data-task="literacy-2"]');await click('#textbookCharacters button:nth-child(3)');
    await wait("document.querySelector('#wordPosition').textContent==='3 / 4' && !document.querySelector('#playBtn').disabled");
    assert.equal(await evaluate("document.querySelector('#currentQuery').textContent"),'一二三上');
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"),'播放');
    assert.match(await evaluate("document.querySelector('#textbookCurrent').textContent"),/金木水火土.*会写/);
    assert.equal(await evaluate("localStorage.getItem('bishun-saved-queries-v2')"),null);
    await open();assert.equal(await evaluate(preview),'一二三上');
    await click('#textbookReadBtn');assert.equal(await evaluate(preview),'一二三四五上下');
    await click('#closeTextbookBtn');await click('#menuBtn');await click('#saveQueryBtn');
    assert.match(await evaluate("localStorage.getItem('bishun-saved-queries-v2')"),/一二三上/);await click('#closeMenuBtn');
    checks.push('character click opens the full source group at the exact position without autoplay; last course restores; only explicit collection creates a personal copy');

    await open();await unit('unit-2');await click('[data-task="garden-2"]');
    assert.equal(await evaluate(preview),'九王');await click('#textbookReadBtn');
    assert.equal(await evaluate(preview),'本学校班级姓名王');
    await unit('unit-4');await click('[data-task="pinyin-13"]');
    assert.equal(await evaluate(preview),'蓝云草原');
    await unit('unit-8');await click('[data-task="reading-10"]');assert.equal(await evaluate(preview),'来半你有');
    await click('#openTextbookTaskBtn');await wait("document.querySelector('#currentQuery').textContent==='来半你有' && !document.querySelector('#playBtn').disabled");
    checks.push('gardens are independent tasks; corrected right-column pinyin lesson and last writing lesson retain exact source content');

    await query('木水');assert.equal(await evaluate("document.querySelector('#textbookCurrent').hidden"),true);
    await click('.reading-button');await wait("Boolean(document.querySelector('.reading-button.is-speaking'))");await open();
    assert.equal(await evaluate("Boolean(document.querySelector('.reading-button.is-speaking'))"),false);
    await click('#closeTextbookBtn');await click('#playBtn');await wait("document.querySelector('#playBtn').textContent==='暂停'");
    await open();assert.equal(await evaluate("document.querySelector('#playBtn').textContent"),'继续');await click('#closeTextbookBtn');
    await click('#menuBtn');await click('#practiceBtn');await wait("document.querySelector('#practiceHintBtn').textContent==='提示下一笔'");
    await practiceStroke(browser,'木',0);await wait("document.querySelector('#practiceProgress').textContent==='1 / 4 笔'");
    await open();await click('#closeTextbookBtn');
    assert.equal(await evaluate("document.querySelector('#practiceProgress').textContent"),'1 / 4 笔');
    assert.equal(await evaluate("document.querySelector('#practiceHintBtn').textContent"),'继续练习');
    await open();await unit('unit-1');await click('[data-task="literacy-2"]');await click('#openTextbookTaskBtn');
    await wait("document.querySelector('#practicePanel').hidden && !document.querySelector('#playBtn').disabled");
    checks.push('entry stops voice and animation, pauses handwriting without losing accepted strokes; confirming a new lesson cancels practice');

    await command('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
    await open();await unit('unit-3');await click('[data-task="pinyin-8"]');
    assert.equal(await evaluate(preview),'桌纸读书');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    assert.equal(await evaluate("document.querySelector('#textbookDialog').scrollWidth<=document.querySelector('#textbookDialog').clientWidth"),true);
    await browser.screenshot('/private/tmp/bishun-textbook-pilot-mobile.png');
    for(const type of ['keyDown','keyUp'])await command('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await wait("!document.querySelector('#textbookDialog').open && document.activeElement.id==='menuBtn'");
    await command('Emulation.clearDeviceMetricsOverride');
    checks.push('320px full-height picker fits without horizontal overflow; Escape unlocks scrolling and restores menu focus');

    await open();await unit('unit-6');await click('[data-task="literacy-6"]');
    await evaluate("window.beforeLessonFetch=window.fetch;window.fetch=(input,options)=>decodeURI(String(input)).endsWith('/力.json')?new Promise(resolve=>{window.releaseLesson=()=>beforeLessonFetch(input).then(resolve);}):beforeLessonFetch(input,options);");
    await click('#textbookCharacters button:nth-child(5)');await wait("typeof window.releaseLesson==='function'");
    await query('木');await evaluate('releaseLesson();window.fetch=beforeLessonFetch');await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(await evaluate("document.querySelector('#currentQuery').textContent"),'木');
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"),'1 / 1');
    assert.equal(await evaluate("document.querySelector('#textbookCurrent').hidden"),true);
    checks.push('a manual query during pending textbook character loading invalidates the old selected-index callback and course label');

    // Fresh app memory, then inject a failed request and a cancelled late response.
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent==='请输入汉字'");
    await query('木水');await command('Network.setBlockedURLs',{urls:['*'+textbookBooks[0].url]});
    await click('#menuBtn');await click('#openTextbookBtn');await wait("!document.querySelector('#retryTextbookBtn').hidden");
    assert.equal(await evaluate("document.querySelector('#openTextbookTaskBtn').disabled"),true);
    assert.equal(await evaluate("document.querySelector('#currentQuery').textContent"),'木水');
    await command('Network.setBlockedURLs',{urls:[]});await click('#retryTextbookBtn');await wait("!document.querySelector('#openTextbookTaskBtn').disabled");
    await click('#closeTextbookBtn');
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent==='请输入汉字'");await query('木水');
    await evaluate("window.originalFetch=window.fetch;window.fetch=(input,options)=>String(input).includes('/textbooks/')?new Promise(resolve=>{window.releaseTextbook=()=>originalFetch(input).then(resolve);}):originalFetch(input,options);");
    await click('#menuBtn');await click('#openTextbookBtn');await wait("typeof window.releaseTextbook==='function'");await click('#closeTextbookBtn');
    await evaluate('releaseTextbook();window.fetch=originalFetch');await new Promise(resolve=>setTimeout(resolve,250));
    assert.equal(await evaluate("document.querySelector('#textbookDialog').open"),false);
    assert.equal(await evaluate("document.querySelector('#currentQuery').textContent"),'木水');
    await open();await click('#closeTextbookBtn');
    checks.push('failed catalog fetch supports retry without changing the query; closing during an ignored-abort response cannot reopen or commit the picker');
    assert.deepEqual(browser.exceptions,[]);
    console.log(JSON.stringify({browser:browser.version,checks,exceptions:browser.exceptions},null,2));
} finally {await browser.close();}
