import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl='http://127.0.0.1:9223',pageUrl='http://192.168.6.169:5188/']=process.argv.slice(2);
const browser=await openBrowser(cdpUrl,pageUrl);
const checks=[];
try {
    const {command,evaluate,click,fill,wait}=browser;
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await command('Emulation.setTouchEmulationEnabled',{enabled:true});
    await fill('#query','木水心');
    await click('#searchForm [type="submit"]');
    await wait("!document.querySelector('#playBtn').disabled");
    // Verify the fallback independently of Chrome's native fullscreen support.
    await evaluate("Object.defineProperty(document,'fullscreenEnabled',{configurable:true,get:()=>false})");
    await click('#menuBtn');
    await click('#fullscreenBtn');
    await wait("document.body.classList.contains('focus-mode') && !document.querySelector('#settings').open");
    assert.equal(await evaluate('document.fullscreenElement'),null);
    const layout=await evaluate(`(() => { const r=document.querySelector('#writingGrid').getBoundingClientRect(); const e=document.querySelector('#exitFocusBtn').getBoundingClientRect(); return {gridInside:r.left>=0&&r.right<=innerWidth,exitInside:e.top>=0&&e.bottom<=innerHeight,center:Math.abs((r.left+r.right)/2-innerWidth/2)}; })()`);
    assert.equal(layout.gridInside,true);
    assert.equal(layout.exitInside,true);
    assert.ok(layout.center<1);
    checks.push('unsupported native fullscreen keeps focus layout, centered grid and visible exit');

    async function swipe(dx,{resize=false,cancel=false}={}) {
        await browser.activate();
        await evaluate("document.querySelector('#writingGrid').scrollIntoView({block:'center'})");
        const p=await evaluate(`(() => {const r=document.querySelector('#writingGrid').getBoundingClientRect();return {x:r.left+r.width*${dx < 0 ? 0.8 : 0.2},y:r.top+r.height/2};})()`);
        await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});
        const pending=[];
        for(let i=1;i<=6;i++) {
            pending.push(command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+dx*i/6,y:p.y,id:1}]}));
            if(i===3&&resize) await evaluate("window.dispatchEvent(new Event('resize'))");
            if(i===3&&cancel) await evaluate("document.querySelector('#stage').dispatchEvent(new PointerEvent('pointercancel',{pointerType:'touch',bubbles:true}))");
            await new Promise(resolve=>setTimeout(resolve,16));
        }
        pending.push(command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}));
        await Promise.all(pending);
    }
    await swipe(-120,{resize:true});
    await wait("document.querySelector('#wordPosition').textContent==='2 / 3' && !document.querySelector('#playBtn').disabled");
    checks.push('same-width resize during a real touch gesture no longer clears character navigation');
    await swipe(-120,{cancel:true});
    await wait("document.querySelector('#wordPosition').textContent==='3 / 3' && !document.querySelector('#playBtn').disabled");
    await swipe(120);
    await wait("document.querySelector('#wordPosition').textContent==='2 / 3' && !document.querySelector('#playBtn').disabled");
    checks.push('focus layout navigates both directions through Touch Events even if touch Pointer Events cancel');
    await swipe(18);
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"),'2 / 3');
    checks.push('short touch drag never switches or double-switches');
    await click('#exitFocusBtn');
    await wait("!document.body.classList.contains('focus-mode')");
    assert.equal(await evaluate("document.querySelector('#practicePanel').hidden"),true);
    assert.deepEqual(browser.exceptions,[]);
    checks.push('exit restores demonstration without starting handwriting or autoplay');
    await fill('#query','十木水');
    await click('#searchForm [type="submit"]');
    await wait("!document.querySelector('#playBtn').disabled");
    await click('#menuBtn');await click('#practiceBtn');
    await wait("!document.querySelector('#practiceHintBtn').disabled");
    const data=JSON.parse(await fs.readFile(new URL('../public/characters/2.0.1/十.json',import.meta.url),'utf8'));
    for(let index=0;index<2;index++) {
        await browser.activate();
        await evaluate("document.querySelector('#writingGrid').scrollIntoView({block:'center'})");
        const rect=await evaluate("(() => {const r=document.querySelector('#practiceLayer > svg').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};})()");
        const points=data.medians[index].map(([x,y])=>({x:rect.x+x*rect.width/1024,y:rect.y+(900-y)*rect.width/1024,id:1}));
        await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[0]]});
        for(const point of points.slice(1)) await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point]});
        await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await wait(`document.querySelector('#practiceProgress').textContent==='${index+1} / 2 笔'`);
    }
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"),'1 / 3');
    assert.equal(await evaluate("document.querySelector('#practiceFeedback').textContent"),'这一字写完了');
    assert.deepEqual(browser.exceptions,[]);
    checks.push('native touch handwriting still completes two strokes without triggering character navigation');
    console.log(JSON.stringify({browser:browser.version,checks,scope:'Chrome touch injection; fullscreen capability and resize/pointercancel events deliberately simulated, not Safari device acceptance',exceptions:browser.exceptions},null,2));
} finally {await browser.close();}
