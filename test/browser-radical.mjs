import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl='http://127.0.0.1:9223',pageUrl='http://192.168.6.169:5188/']=process.argv.slice(2);
const browser=await openBrowser(cdpUrl,pageUrl);
try {
    const {command,click,fill,wait,evaluate}=browser;
    for (const character of ['和','河']) {
        await fill('#query',character);
        await click('#searchForm [type="submit"]');
        await wait(`!document.querySelector('#playBtn').disabled && document.querySelector('#lessonActionsHeading').textContent === '当前字 · ${character}'`);
        assert.equal(await evaluate("document.querySelector('#characterStrokeCount').textContent"),'8 笔');
        assert.equal(await evaluate("document.querySelector('#characterRadical, .character-radical')"),null);
        assert.equal(await evaluate("document.querySelector('#basicInfo').textContent.includes('部首')"),false);
        assert.equal(await evaluate("document.querySelector('#basicInfo').getAttribute('aria-label').includes('部首')"),false);
        await click('#menuBtn');
        assert.equal(await evaluate("document.querySelector('#settings').textContent.includes('部首')"),false);
        await click('#closeMenuBtn');
    }
    await command('Emulation.setDeviceMetricsOverride',{width:320,height:820,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
    assert.equal(browser.requests.some(url=>/cnchar\.radical\.min-.*\.js/.test(url)),false);
    await browser.screenshot('/private/tmp/bishun-radical-hidden.png');
    assert.deepEqual(browser.exceptions,[]);
    console.log(JSON.stringify({browser:browser.version,checks:['radical absent from main view, menu and accessibility label','query and stroke counts remain available at 320px','no radical dictionary chunk requested'],exceptions:browser.exceptions},null,2));
} finally { await browser.close(); }
