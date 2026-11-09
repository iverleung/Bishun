import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';
import { practiceStroke } from './helpers/practice-input.mjs';

const [cdpUrl='http://127.0.0.1:9224',pageUrl='http://192.168.6.169:5188/']=process.argv.slice(2);
const browser=await openBrowser(cdpUrl,pageUrl);
const checks=[];
try {
    const {command,evaluate,wait,click,fill}=browser;
    const key=async key=>{
        for(const type of ['keyDown','keyUp']) await command('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:key==='Escape'?27:9,nativeVirtualKeyCode:key==='Escape'?27:9});
    };
    const ready="!document.querySelector('#playBtn').disabled";
    async function query(text) {
        await fill('#query',text);await click('#searchForm [type="submit"]');
        await wait(`${ready} && document.querySelector('#currentQuery').textContent === ${JSON.stringify(Array.from(text).filter(c=>/^\p{Script=Han}$/u.test(c)).slice(0,20).join(''))}`);
        await wait("!document.querySelector('#searchDialog').open && document.querySelector('#searchPanel').parentElement.id === 'searchHome'");
    }
    async function open() {
        await click('#openSearchBtn');await wait("document.querySelector('#searchDialog').open && document.activeElement.id === 'query'");
    }
    async function closed() { await wait("!document.querySelector('#searchDialog').open && document.activeElement.id === 'openSearchBtn'"); }
    assert.equal(await evaluate("document.querySelector('#query').getClientRects().length > 0"),true);
    assert.equal(await evaluate("document.querySelector('#openSearchBtn').hidden"),true);
    await command('Emulation.setDeviceMetricsOverride',{width:393,height:700,deviceScaleFactor:1,mobile:true});
    await query('木水心');
    assert.equal(await evaluate("document.querySelector('.brand').getClientRects().length"),0);
    assert.equal(await evaluate("document.querySelector('#query').getClientRects().length"),0);
    assert.equal(await evaluate("document.querySelector('#historyRow').getClientRects().length"),0);
    await click('#nextCharBtn');await wait("document.querySelector('#wordPosition').textContent === '2 / 3' && !document.querySelector('#playBtn').disabled");
    await click('#nextStrokeBtn');
    await wait("document.querySelector('#strokePosition').textContent === '1 / 4 笔'");
    const geometry=await evaluate("(() => {const r=document.querySelector('#writingGrid').getBoundingClientRect();return {left:r.left,width:r.width};})()");
    await open();
    assert.equal(await evaluate("document.querySelector('#historyRow').getClientRects().length > 0"),true);
    await fill('#query','火');
    assert.equal(await evaluate("document.querySelector('#currentQuery').textContent"),'木水心');
    await key('Escape');await closed();
    assert.equal(await evaluate("document.querySelector('#query').value"),'木水心');
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"),'2 / 3');
    assert.equal(await evaluate("document.querySelector('#strokePosition').textContent"),'1 / 4 笔');
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"),'继续');
    const restored=await evaluate("(() => {const r=document.querySelector('#writingGrid').getBoundingClientRect();return {left:r.left,width:r.width};})()");
    assert.deepEqual(restored,geometry);
    checks.push('result page has a compact toolbar and hidden input/history; cancelling a draft preserves selected character, completed strokes and grid geometry');

    await open();await click('#clearBtn');
    assert.equal(await evaluate("document.querySelector('#query').value"),'');
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"),'2 / 3');
    await click('#closeSearchBtn');await closed();
    await open();await fill('#query','abc');await click('#searchForm [type="submit"]');
    assert.equal(await evaluate("document.querySelector('#searchDialog').open && !document.querySelector('#searchError').hidden"),true);
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"),'2 / 3');
    await query('和');
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"),'播放');
    await open();await click('#historyList button[title="木水心"]');
    await wait("!document.querySelector('#searchDialog').open && document.querySelector('#wordPosition').textContent === '1 / 3' && !document.querySelector('#playBtn').disabled");
    checks.push('clear only edits the draft; invalid text keeps search open; valid submit and history selection collapse the panel without autoplay');

    await open();
    for(let index=0;index<10;index++) { await key('Tab');assert.equal(await evaluate("document.querySelector('#searchDialog').contains(document.activeElement)"),true); }
    const bounds=await evaluate("(() => {const r=document.querySelector('#searchDialog').getBoundingClientRect();return {bottom:r.bottom};})()");
    const point={x:4,y:Math.min(690,bounds.bottom+20)};
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    await closed();
    assert.equal(await evaluate("document.documentElement.classList.contains('drawer-open')"),false);
    checks.push('search traps keyboard focus, closes from Escape/cancel/backdrop and restores toolbar focus and page scrolling');

    await query('十木');await click('#menuBtn');await click('#practiceBtn');
    const active="!document.querySelector('#practiceHintBtn').disabled && document.querySelector('#practiceHintBtn').textContent === '提示下一笔'";
    await wait(active);await practiceStroke(browser,'十',0);
    await wait("document.querySelector('#practiceProgress').textContent === '1 / 2 笔'");
    await open();await click('#closeSearchBtn');await closed();
    assert.equal(await evaluate("document.querySelector('#practicePanel').hidden"),false);
    assert.equal(await evaluate("document.querySelector('#practiceProgress').textContent"),'1 / 2 笔');
    assert.equal(await evaluate("document.querySelector('#practiceHintBtn').textContent"),'继续练习');
    await click('#practiceHintBtn');await wait(active);await practiceStroke(browser,'十',1);
    await wait("document.querySelector('#practiceFeedback').textContent === '这一字写完了'");
    checks.push('opening search pauses handwriting; cancelling retains accepted strokes and requires explicit resume');

    await query('木');await click('#playBtn');
    await wait("document.querySelector('#animationLayer').children.length > 0");
    await open();
    assert.equal(await evaluate("document.querySelector('#animationLayer').children.length"),0);
    await key('Escape');await closed();
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"),'继续');
    await click('#playBtn');await wait("document.querySelector('#playBtn').textContent === '重播'",20000);
    checks.push('search interrupts an active animation and explicit playback resume finishes the character');

    await open();
    await evaluate("document.querySelector('#query').dispatchEvent(new CompositionEvent('compositionstart'))");
    await fill('#query','山');await click('#searchForm [type="submit"]');
    assert.equal(await evaluate("document.querySelector('#currentQuery').textContent"),'木');
    assert.equal(await evaluate("document.querySelector('#searchDialog').open"),true);
    await click('#closeSearchBtn');await closed();
    await query('山');
    checks.push('composition prevents premature submission; cancelling clears interrupted IME state for the next search');

    await query('木'.repeat(21));
    assert.match(await evaluate("document.querySelector('#queryNotice').textContent"),/前 20/);
    await query('木'.repeat(20));
    for(const [width,height] of [[320,568],[393,700],[768,1024],[1280,800]]) {
        await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<1000});
        const layout=await evaluate(`(() => {
            const header=document.querySelector('.site-header').getBoundingClientRect(),grid=document.querySelector('#writingGrid').getBoundingClientRect(),controls=document.querySelector('.transport').getBoundingClientRect();
            return {header:header.height,grid:grid.width,center:Math.abs((grid.left+grid.right)/2-document.documentElement.clientWidth/2),controls:controls.bottom,overflow:document.documentElement.scrollWidth>innerWidth};
        })()`);
        assert.ok(layout.header<=48.5,JSON.stringify(layout));
        assert.ok(layout.grid>=Math.min(width-96,440,height-264)-1,JSON.stringify(layout));
        assert.ok(layout.center<1,JSON.stringify(layout));
        assert.ok(layout.controls<=height,JSON.stringify(layout));
        assert.equal(layout.overflow,false);
        if(width===393)await browser.screenshot('/private/tmp/bishun-compact-search-mobile.png');
        if(width===1280)await browser.screenshot('/private/tmp/bishun-compact-search-desktop.png');
    }
    await open();await browser.screenshot('/private/tmp/bishun-compact-search-panel.png');
    await click('#clearBtn');await click('#searchForm [type="submit"]');
    await wait("document.querySelector('#lesson').hidden && document.activeElement.id === 'query' && !document.querySelector('#searchHome').hidden");
    assert.equal(await evaluate("document.querySelector('.brand').getClientRects().length > 0"),true);
    checks.push('long query truncates visibly with notice; 320/393/768/1280 layouts keep a centered larger grid and playback controls within viewport; empty submit restores the input-first page');
    assert.deepEqual(browser.exceptions,[]);
    console.log(JSON.stringify({browser:browser.version,checks,exceptions:browser.exceptions},null,2));
} catch(error) {
    console.error(await browser.evaluate("({phase:document.body.dataset.phase,search:document.querySelector('#searchDialog').open,focus:document.activeElement.id,query:document.querySelector('#query').value,status:document.querySelector('#status').textContent})"));
    throw error;
} finally { await browser.close(); }
