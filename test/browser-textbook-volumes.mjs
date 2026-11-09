import assert from 'node:assert/strict';
import {openBrowser} from './helpers/cdp.mjs';
import {textbookBooks} from '../src/data/textbooks.js';
import second from '../resources/textbooks/pilot-v1/g1-second.json' with {type:'json'};
const [cdp='http://127.0.0.1:9224',url='http://127.0.0.1:5189/']=process.argv.slice(2);
const browser=await openBrowser(cdp,url);const checks=[];
try {
    const {command,evaluate,wait,click,fill}=browser;
    const available="!document.querySelector('#openTextbookTaskBtn').disabled";
    const preview="Array.from(document.querySelectorAll('#textbookCharacters strong'),el=>el.textContent).join('')";
    async function select(selector,value){await evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)};document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('change',{bubbles:true}));`);}
    async function open(){await click('#menuBtn');await click('#openTextbookBtn');await wait(available);}
    async function book(id,title){await select('#textbookBook',id);await wait(`${available} && document.querySelector('#textbookTaskTitle').textContent===${JSON.stringify(title)}`);}
    async function query(value){await fill('#query',value);await click('#searchForm [type=submit]');await wait("!document.querySelector('#playBtn').disabled");}
    assert.equal(browser.requests.some(value=>value.includes('/textbooks/')),false);
    await query('木水');await open();
    assert.equal(await evaluate("document.querySelector('#textbookBook').options.length"),2);
    assert.equal(await evaluate("document.querySelector('#textbookBook').value"),'g1-first');
    assert.equal(await evaluate(preview),'天地人你我他');
    assert.equal(browser.requests.some(value=>value.endsWith(textbookBooks[1].url)),false);
    checks.push('opening textbooks requests only the selected first volume; exactly the two available semester options appear');

    await evaluate(`window.volumeFetch=window.fetch;window.fetch=(input,options)=>String(input).endsWith(${JSON.stringify(textbookBooks[1].url)})?new Promise(resolve=>{window.releaseVolume=()=>volumeFetch(input).then(resolve);}):volumeFetch(input,options);`);
    await select('#textbookBook','g1-second');await wait("typeof releaseVolume==='function'");
    assert.equal(await evaluate("document.querySelector('#openTextbookTaskBtn').disabled"),true);
    await book('g1-first','天地人');await evaluate('releaseVolume();window.fetch=volumeFetch');
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(await evaluate("document.querySelector('#textbookBook').value"),'g1-first');
    assert.equal(await evaluate(preview),'天地人你我他');
    assert.equal(await evaluate("document.querySelector('#textbookMessage').textContent"),'');
    checks.push('switching back while the second volume loads cancels the pending draft; a response ignoring abort cannot replace first-volume content');

    await evaluate(`window.fetch=(input,options)=>String(input).endsWith(${JSON.stringify(textbookBooks[1].url)})?Promise.reject(new TypeError('network')):volumeFetch(input,options);`);
    await select('#textbookBook','g1-second');await wait("!document.querySelector('#retryTextbookBtn').hidden");
    assert.equal(await evaluate("document.querySelector('#textbookBook').value"),'g1-second');
    assert.equal(await evaluate("document.querySelector('#openTextbookTaskBtn').disabled"),true);
    assert.equal(await evaluate("document.querySelector('#currentQuery').textContent"),'木水');
    await evaluate('window.fetch=volumeFetch');await click('#retryTextbookBtn');await wait(`${available} && document.querySelector('#textbookTaskTitle').textContent==='春夏秋冬'`);
    assert.equal(await evaluate(preview),'春冬吹花飞入');
    await click('#closeTextbookBtn');await open();
    assert.equal(await evaluate("document.querySelector('#textbookBook').value"),'g1-first');
    checks.push('failure and retry stay scoped to the requested volume; cancelling a new-volume draft neither changes the query nor persists it');

    await click('[data-task="literacy-2"]');await click('#openTextbookTaskBtn');await wait("document.querySelector('#currentQuery').textContent==='一二三上' && !document.querySelector('#playBtn').disabled");
    await open();await book('g1-second','春夏秋冬');
    assert.equal(await evaluate("document.querySelector('#textbookLessons [aria-pressed=true]').dataset.task"),'literacy-1');
    assert.equal(await evaluate(preview),'春冬吹花飞入');
    await click('#textbookCharacters button:nth-child(3)');await wait("document.querySelector('#wordPosition').textContent==='3 / 6' && !document.querySelector('#playBtn').disabled");
    assert.equal(await evaluate("document.querySelector('#currentQuery').textContent"),'春冬吹花飞入');
    assert.match(await evaluate("document.querySelector('#textbookCurrent').textContent"),/一年级下册.*春夏秋冬/);
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"),'播放');
    assert.equal(await evaluate("localStorage.getItem('bishun-saved-queries-v2')"),null);
    checks.push('a shared task ID never inherits another volume’s task position; confirming a second-volume character selects its full group/index without autoplay or collection');

    await open();let seen=0;
    for(const unit of second.units){
        await select('#textbookUnit',unit.id);
        for(const task of unit.tasks){
            await click(`[data-task="${task.id}"]`);
            for(const [mode,id] of [['write','textbookWriteBtn'],['read','textbookReadBtn']]){
                if(!task[mode].length){assert.equal(await evaluate(`document.querySelector('#${id}').disabled`),true);continue;}
                await click('#'+id);
                assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#textbookCharacters button'),button=>({id:button.dataset.entry,character:button.querySelector('strong').textContent,reading:button.querySelector('span').textContent,polyphonic:button.classList.contains('is-polyphonic')}))"),task[mode].map(entry=>({id:entry.id,character:entry.character,reading:entry.reading,polyphonic:entry.polyphonic})));
                seen+=task[mode].length;
            }
        }
    }
    assert.equal(seen,619);
    checks.push('all 36 second-volume tasks display the exact 619 source occurrences with source readings, blue flags and independent gardens');

    await command('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    assert.equal(await evaluate("document.querySelector('#textbookDialog').scrollWidth<=document.querySelector('#textbookDialog').clientWidth"),true);
    await browser.screenshot('/private/tmp/bishun-textbook-second-mobile.png');
    await click('#closeTextbookBtn');await wait("document.activeElement.id==='menuBtn'");
    await command('Emulation.clearDeviceMetricsOverride');
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent==='请输入汉字'");await open();
    assert.equal(await evaluate("document.querySelector('#textbookBook').value"),'g1-second');
    assert.equal(await evaluate(preview),'春冬吹花飞入');
    assert.equal(await evaluate("document.querySelector('#lesson').hidden"),true);
    checks.push('320px layout fits both selectors; reload restores only the last confirmed book/task, without restoring a query or starting playback');
    assert.deepEqual(browser.exceptions,[]);console.log(JSON.stringify({browser:browser.version,checks,exceptions:browser.exceptions},null,2));
}finally{await browser.close();}
