import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl='http://127.0.0.1:9223',pageUrl='http://192.168.6.169:5188/']=process.argv.slice(2);
const checks=[];
async function run(scenario) {
    const browser=await openBrowser(cdpUrl,pageUrl);
    try { await scenario(browser); assert.deepEqual(browser.exceptions,[]); }
    catch (error) {
        console.error(await browser.evaluate("JSON.stringify({visibility:document.visibilityState,query:document.querySelector('#query').value,heading:document.querySelector('#lessonActionsHeading').textContent,radical:document.querySelector('#characterRadical').textContent,menu:document.querySelector('#settings').open,status:document.querySelector('#status').textContent})"));
        throw error;
    }
    finally { await browser.close(); }
}
async function query(browser,text) {
    await browser.fill('#query',text);
    await browser.click('#searchForm [type="submit"]');
    await browser.wait(`!document.querySelector('#playBtn').disabled && document.querySelector('#lessonActionsHeading').textContent === ${JSON.stringify(`当前字 · ${Array.from(text)[0]}`)}`);
}
const radicalIs = text => `document.querySelector('#characterRadical').textContent === '${text}'`;
const radicalRequests = browser => browser.requests.filter(url=>/cnchar\.radical\.min-.*\.js/.test(url));

await run(async browser=>{
    const {command,click,wait,evaluate}=browser;
    await query(browser,'河水學');
    assert.equal(radicalRequests(browser).length,0);
    await command('Network.setCacheDisabled',{cacheDisabled:true});
    await command('Fetch.enable',{patterns:[{urlPattern:'*cnchar.radical.min-*.js',requestStage:'Request'}]});
    await click('#menuBtn');
    assert.equal(await evaluate("document.querySelector('#characterRadical').textContent"),'加载中');
    await click('#closeMenuBtn');
    await query(browser,'水');
    await click('#menuBtn');
    await command('Fetch.disable');
    await wait(radicalIs('水'));
    assert.equal(await evaluate("document.querySelector('#lessonActionsHeading').textContent"),'当前字 · 水');
    assert.equal(radicalRequests(browser).length,1);
    checks.push('dictionary loads only on opening menu, shares one request and cannot overwrite a newer query');
    await click('#closeMenuBtn');
    for(const [character,radical,count] of [['河','氵',8],['打','扌',5],['学','子',8],['學','暂缺',16]]) {
        await query(browser,character);await click('#menuBtn');await wait(radicalIs(radical));
        assert.equal(await evaluate("document.querySelector('#characterStrokeCount').textContent"),`${count} 笔`);
        await click('#closeMenuBtn');
    }
    assert.equal(radicalRequests(browser).length,1);
    checks.push('semantic radical forms and unknown traditional data display correctly, without replacing total stroke count');
    await command('Emulation.setDeviceMetricsOverride',{width:320,height:820,deviceScaleFactor:1,mobile:true});
    await query(browser,'河');await click('#menuBtn');await wait(radicalIs('氵'));
    assert.equal(await evaluate("document.querySelector('main #characterRadical')"),null);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
    await browser.screenshot('/private/tmp/bishun-radical-drawer.png');
    assert.ok(browser.requests.filter(url=>/^https?:/.test(url)).every(url=>new URL(url).origin===new URL(pageUrl).origin));
    checks.push('320px drawer fits and main canvas remains unchanged; all requests same-origin');
});

await run(async browser=>{
    const {command,click,wait,evaluate}=browser;
    await query(browser,'木');
    await command('Network.setCacheDisabled',{cacheDisabled:true});
    await command('Network.setBlockedURLs',{urls:['*cnchar.radical.min-*.js']});
    await click('#menuBtn');await wait(radicalIs('暂不可用'));
    await click('#closeMenuBtn');await click('#nextStrokeBtn');
    assert.equal(await evaluate("document.querySelector('#strokePosition').textContent"),'1 / 4 笔');
    await command('Network.setBlockedURLs',{urls:[]});
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    await query(browser,'木');await click('#menuBtn');await wait(radicalIs('木'));
    checks.push('failed optional chunk degrades without blocking stroke controls; reload after network recovery succeeds');
});

await run(async browser=>{
    const {command,click,wait,evaluate}=browser;
    await query(browser,'木');
    await command('Network.setCacheDisabled',{cacheDisabled:true});
    await command('Fetch.enable',{patterns:[{urlPattern:'*cnchar.radical.min-*.js',requestStage:'Request'}]});
    await click('#menuBtn');await wait(radicalIs('暂不可用'));
    await command('Fetch.disable');
    await wait("performance.getEntriesByType('resource').some(entry => /cnchar\\.radical\\.min-/.test(entry.name) && entry.responseEnd > 0)");
    assert.equal(await evaluate("document.querySelector('#characterRadical').textContent"),'暂不可用');
    await click('#closeMenuBtn');await click('#menuBtn');await wait(radicalIs('木'));
    checks.push('slow dictionary import has a bounded wait; late result stays hidden until a new request');
});
console.log(JSON.stringify({checks,scope:'Isolated Chrome CDP contexts, injected network faults and viewport sizing; not a full dictionary content audit'},null,2));
