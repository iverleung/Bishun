import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';
import { practiceStroke } from './helpers/practice-input.mjs';
import readingPlan from '../resources/reading-audio-plan.json' with { type: 'json' };
import { readingRecording } from '../src/data/reading-audio.js';

const [cdpUrl='http://127.0.0.1:9224',pageUrl='http://127.0.0.1:5189/']=process.argv.slice(2);
const browser=await openBrowser(cdpUrl,pageUrl);
const checks=[];
try {
    const {evaluate,command,wait,click,fill}=browser;
    // Observe real Web Audio sources; do not replace decoding or playback.
    await command('Page.addScriptToEvaluateOnNewDocument',{source:`
        window.audioEvents=[];
        const create=AudioContext.prototype.createBufferSource;
        AudioContext.prototype.createBufferSource=function(...args){
            const source=create.apply(this,args);
            for(const type of ['start','stop']){const original=source[type];source[type]=function(...args){window.audioEvents.push(type);return original.apply(this,args);};}
            return source;
        };
    `});
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    async function query(text){await fill('#query',text);await click('#searchForm [type="submit"]');await wait("!document.querySelector('#playBtn').disabled");}
    const button=reading=>`[data-reading="${reading}"]`;
    const busy="Boolean(document.querySelector('.reading-button.is-speaking'))";
    const starts=()=>evaluate("audioEvents.filter(type=>type==='start').length");
    await query('长行我');
    assert.equal(await starts(),0);
    assert.equal(await evaluate("document.querySelectorAll('.reading-button').length"),2);
    await click(button('cháng'));await wait(busy);await wait("audioEvents.includes('start')");
    await click(button('zhǎng'));await wait("audioEvents.filter(type=>type==='start').length===2");
    await wait(`!(${busy})`);
    for(const reading of ['cháng','zhǎng'])assert.ok(browser.responses.some(item=>item.url.endsWith(readingRecording(reading).url) && item.status===200));
    assert.equal(await evaluate("document.querySelector('#readingFeedback').classList.contains('sr-only')"),true);
    checks.push('distinct polyphonic samples decode and play only on click; replacing an active sample cancels it');

    await click('#playBtn');await wait("document.querySelector('#playBtn').textContent === '暂停'");
    await click(button('cháng'));await wait("audioEvents.filter(type=>type==='start').length===3");
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"),'继续');
    await click('#nextCharBtn');await wait("document.querySelector('[data-reading=\"xíng\"]') !== null");
    assert.equal(await evaluate(busy),false);
    checks.push('listening pauses stroke playback; changing character immediately clears the reading session');

    // Hold an uncached syllable request, then resume strokes before it arrives.
    await evaluate(`window.originalFetch=window.fetch; window.fetch=(input,options)=>String(input).includes('/audio/readings/')?new Promise(resolve=>{window.releaseReading=()=>originalFetch(input,options).then(resolve);}):originalFetch(input,options);`);
    const before=await starts();
    await click(button('xíng'));await wait("typeof releaseReading === 'function'");
    await click('#playBtn');await evaluate('releaseReading();window.fetch=originalFetch');
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(await starts(),before);
    assert.equal(await evaluate(busy),false);
    await click('#playBtn');
    checks.push('resuming strokes while a reading loads prevents late voice playback');

    await evaluate(`window.fetch=(input,options)=>String(input).includes('/audio/readings/')?Promise.reject(new TypeError('network')):originalFetch(input,options);`);
    await click(button('háng'));await wait("document.querySelector('#readingFeedback').textContent.includes('重试')");
    assert.equal(await evaluate("document.querySelector('#readingFeedback').classList.contains('sr-only')"),false);
    await evaluate('window.fetch=originalFetch');await click(button('háng'));await wait(busy);await wait(`!(${busy})`);
    await click('#nextCharBtn');await wait("document.querySelector('#characterReadings').textContent==='wǒ'");
    assert.equal(await evaluate("document.querySelectorAll('.reading-button').length"),0);
    checks.push('failed recording has a Chinese retry state; uncovered syllables remain plain text');

    await query('木水');await click('#menuBtn');await click('#practiceBtn');
    await wait("document.querySelector('#practiceHintBtn').textContent==='提示下一笔'");
    await practiceStroke(browser,'木',0);await wait("document.querySelector('#practiceProgress').textContent==='1 / 4 笔'");
    await click(button('mù'));await wait(busy);
    assert.equal(await evaluate("document.querySelector('#practiceHintBtn').textContent"),'继续练习');
    assert.equal(await evaluate("document.querySelector('#practiceProgress').textContent"),'1 / 4 笔');
    await click('#practiceHintBtn');
    assert.equal(await evaluate(busy),false);
    await wait("document.querySelector('#practiceHintBtn').textContent==='提示下一笔'");
    assert.equal(await evaluate("document.querySelector('#practiceProgress').textContent"),'1 / 4 笔');
    await click(button('mù'));await wait(busy);
    await click('#menuBtn');assert.equal(await evaluate(busy),false);await click('#closeMenuBtn');
    checks.push('listening pauses handwriting without losing accepted strokes; resuming handwriting and opening the menu cancel voice');

    await query('行');
    await command('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    assert.equal(await evaluate("Array.from(document.querySelectorAll('.reading-button')).every(button=>button.getBoundingClientRect().height>=44)"),true);
    await browser.screenshot('/private/tmp/bishun-reading-mobile.png');
    await command('Emulation.clearDeviceMetricsOverride');
    checks.push('four readings fit a 320px viewport with 44px touch targets');

    await evaluate(`window.fetch=(input,options)=>String(input).includes('/audio/readings/')?new Promise(resolve=>{window.releaseReading=()=>originalFetch(input,options).then(resolve);}):originalFetch(input,options);window.releaseReading=null;`);
    const beforeBackground=await starts();
    await click(button('héng'));await wait("typeof releaseReading==='function'");
    const {targetInfo}=await command('Target.getTargetInfo');
    const {targetId}=await command('Target.createTarget',{url:'about:blank',browserContextId:targetInfo.browserContextId});
    await command('Target.activateTarget',{targetId});
    try {
        await wait("document.visibilityState==='hidden'");
        await evaluate('releaseReading();window.fetch=originalFetch');
        await new Promise(resolve=>setTimeout(resolve,200));
        assert.equal(await starts(),beforeBackground);
    } finally {await command('Target.closeTarget',{targetId});await browser.activate();}
    assert.equal(await evaluate(busy),false);
    checks.push('a real background tab cancels pending voice and returning does not resume it');
    await query('禾');
    assert.equal(await evaluate("document.querySelector('#characterReadings').textContent"),'hé');
    const beforeHe=await starts();
    await click(button('hé'));await wait(`audioEvents.filter(type=>type==='start').length===${beforeHe+1}`);
    await wait(`!(${busy})`);
    assert.ok(browser.responses.some(item=>item.url.endsWith(readingRecording('hé').url) && item.status===200));
    checks.push('禾 exposes hé and fetches/decodes/plays its exact he2 recording; phonetic correctness remains pending listening');
    await evaluate("fetch('/audio/readings/v1/reading-16e6e7372e8f.mp3',{cache:'force-cache'}).then(response=>response.arrayBuffer())");
    const replacementStart=browser.requests.length;
    await query('田');
    assert.equal(await evaluate("document.querySelector('#characterReadings').textContent"),'tián');
    const beforeTian=await starts();
    await click(button('tián'));await wait(`audioEvents.filter(type=>type==='start').length===${beforeTian+1}`);
    await wait(`!(${busy})`);
    assert.ok(browser.requests.slice(replacementStart).some(url=>url.endsWith(readingRecording('tián').url)));
    assert.ok(!browser.requests.slice(replacementStart).some(url=>url.endsWith('/reading-16e6e7372e8f.mp3')));
    checks.push('田 plays the replacement file from its new URL even with the rejected URL already cached; annotation stays tián');
    const batch = readingPlan.batches.find(batch => batch.id === 'basics');
    const played = new Set();
    for (const group of batch.sampleQueries) {
        await query(group);
        for (let index = 0; index < Array.from(group).length; index++) {
            if (index) { await click('#nextCharBtn');await wait('!document.querySelector("#playBtn").disabled'); }
            const readings = await evaluate('Array.from(document.querySelectorAll(".reading-button"), button=>button.dataset.reading)');
            for (const reading of readings) {
                if (!Object.hasOwn(batch.items, reading) || played.has(reading)) continue;
                const count = await starts();
                await click(button(reading));await wait(`audioEvents.filter(type=>type==='start').length===${count+1}`);
                await wait(`!(${busy})`);
                assert.equal(await evaluate('document.querySelector("#readingFeedback").textContent'),'');
                played.add(reading);
            }
            if (Array.from(group)[index] === '地') {
                assert.equal(await evaluate('document.querySelector("#characterReadings").textContent'),'dì / de');
                assert.equal(await evaluate('document.querySelector("[data-reading=de]")'),null);
            }
        }
    }
    assert.deepEqual([...played].sort(), Object.keys(batch.items).sort());
    for (const reading of played) assert.ok(browser.responses.some(item=>item.url.endsWith(readingRecording(reading).url) && item.status===200));
    checks.push('all 34 new syllables decode/start/end through the real UI; missing neutral de stays text');
    assert.deepEqual(browser.exceptions,[]);
    console.log(JSON.stringify({browser:browser.version,checks,exceptions:browser.exceptions},null,2));
} finally {await browser.close();}
