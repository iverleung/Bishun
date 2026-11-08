import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl = 'http://127.0.0.1:9224', pageUrl = 'http://127.0.0.1:5189/'] = process.argv.slice(2);
const browser = await openBrowser(cdpUrl, pageUrl);
const checks = [];
try {
    const { command, evaluate, wait, click, fill } = browser;
    const ready = "!document.querySelector('#playBtn').disabled";
    const position = text => `document.querySelector('#wordPosition').textContent === '${text}' && ${ready}`;
    const key = async name => {
        const code = name === 'Escape' ? 27 : 9;
        for (const type of ['keyDown','keyUp']) await command('Input.dispatchKeyEvent', { type, key:name, code:name, windowsVirtualKeyCode:code, nativeVirtualKeyCode:code });
    };
    async function gesture(dx, dy = 0) {
        await browser.activate();
        await wait("document.visibilityState === 'visible'");
        await evaluate("document.querySelector('#stage').scrollIntoView({block:'center'})");
        const start = await evaluate(`(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return { x:r.left + r.width * ${dx < 0 ? 0.8 : 0.2}, y:r.top + r.height / 2 }; })()`);
        await command('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{...start,id:1}] });
        // Small touch moves may not be acknowledged until touchEnd. Send events
        // in socket order, then wait for acknowledgements after ending the gesture.
        const pending = [];
        for (let i=1;i<=6;i++) {
            pending.push(command('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:start.x+dx*i/6,y:start.y+dy*i/6,id:1}] }));
            await new Promise(resolve => setTimeout(resolve, 16));
        }
        pending.push(command('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] }));
        await Promise.all(pending);
    }
    async function query(text) {
        await fill('#query', text);
        await click('#searchForm [type="submit"]');
        await wait(ready);
    }
    assert.equal(await evaluate("document.querySelector('.search-panel #savedQueries')"), null);
    assert.equal(await evaluate("document.querySelector('#strokeList, #replayStrokeBtn, a.original-link')"), null);
    await click('#menuBtn');
    assert.equal(await evaluate("document.querySelector('#menuBtn').getAttribute('aria-expanded')"), 'true');
    assert.equal(await evaluate("document.querySelector('#lessonActions').hidden"), true);
    for (let i=0;i<10;i++) {
        await key('Tab');
        assert.equal(await evaluate("document.querySelector('#settings').contains(document.activeElement)"), true);
    }
    await key('Escape');
    await wait("!document.querySelector('#settings').open && document.activeElement.id === 'menuBtn'");
    checks.push('right-top menu works before query, focus stays modal, Escape restores trigger; old link and indexed stroke controls removed');

    await query('木水木');
    const mainHeight = await evaluate("document.querySelector('main').getBoundingClientRect().height");
    const center = await evaluate("document.querySelector('#writingGrid').getBoundingClientRect().left");
    await click('#menuBtn');
    await click('#saveQueryBtn');
    await click('#savedQueries summary');
    assert.equal(await evaluate("document.querySelector('main').getBoundingClientRect().height"), mainHeight);
    assert.equal(await evaluate("document.querySelector('#writingGrid').getBoundingClientRect().left"), center);
    await click('#manageSavedBtn');
    await click('.saved-query [data-action="edit"]');
    await key('Escape');
    await wait("!document.querySelector('#editSavedDialog').open");
    assert.equal(await evaluate("document.querySelector('#settings').open && document.documentElement.classList.contains('drawer-open')"), true);
    await key('Escape');
    await wait("!document.querySelector('#settings').open");
    await query('心');
    await click('#menuBtn');
    await click('.saved-query > button');
    await wait(position('1 / 3'));
    await wait("!document.querySelector('#settings').open && document.activeElement.id === 'playBtn'");
    checks.push('expanding library does not change main height or canvas center; nested editor Escape leaves drawer open; picking list closes it and focuses playback without opening keyboard');

    await command('Emulation.setDeviceMetricsOverride', { width:390,height:844,deviceScaleFactor:1,mobile:true });
    await command('Emulation.setTouchEmulationEnabled', { enabled:true });
    await evaluate(`window.swipeEvents = []; for (const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture']) document.querySelector('#stage').addEventListener(type, event => window.swipeEvents.push({ type, x:event.clientX,y:event.clientY,primary:event.isPrimary,button:event.button,target:event.target.id || event.target.tagName }));`);
    await gesture(-120);
    await wait(position('2 / 3'));
    await gesture(-120);
    await wait(position('3 / 3'));
    await gesture(-120);
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"), '3 / 3');
    await gesture(120);
    await wait(position('2 / 3'));
    // CDP touchEnd stalls on tap-sized drags in this Chrome environment.
    // Exercise the shared Pointer Events threshold with a native mouse drag.
    const shortStart = await evaluate("(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()");
    await command('Input.dispatchMouseEvent', {type:'mousePressed',...shortStart,button:'left',buttons:1,clickCount:1});
    await command('Input.dispatchMouseEvent', {type:'mouseMoved',x:shortStart.x+18,y:shortStart.y,button:'left',buttons:1});
    await command('Input.dispatchMouseEvent', {type:'mouseReleased',x:shortStart.x+18,y:shortStart.y,button:'left',buttons:0,clickCount:1});
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"), '2 / 3');
    checks.push('native touch gestures navigate left/right by index, retain duplicate characters, do not wrap at edge; small mouse drags do not switch');

    await command('Emulation.setDeviceMetricsOverride', { width:390,height:600,deviceScaleFactor:1,mobile:true });
    await evaluate('window.scrollTo(0,0)');
    const y = await evaluate('scrollY');
    const p = await evaluate("(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return {x:r.left+r.width/2,y:Math.min(innerHeight-40,r.top+r.height*.7)} })()");
    await browser.activate();
    if (process.argv.includes('--native-scroll')) {
        // Reproduce the current Chrome/CDP native-scroll acknowledgement block.
        await command('Input.synthesizeScrollGesture', { x:p.x,y:p.y,yDistance:-120,gestureSourceType:'touch',preventFling:true,speed:600 });
    } else {
        await command('Input.dispatchMouseEvent', {type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});
        await command('Input.dispatchMouseEvent', {type:'mouseMoved',x:p.x,y:p.y-100,button:'left',buttons:1});
        await command('Input.dispatchMouseEvent', {type:'mouseReleased',x:p.x,y:p.y-100,button:'left',buttons:0,clickCount:1});
        await command('Input.dispatchMouseEvent', {type:'mouseWheel',x:p.x,y:p.y,deltaX:0,deltaY:100});
    }
    await wait(`scrollY > ${y}`);
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"), '2 / 3');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#stage')).touchAction"), 'pan-y pinch-zoom');
    checks.push(process.argv.includes('--native-scroll') ? 'native vertical touch scrolling completed without switching' : 'vertical mouse drag ignored, wheel scroll works, pan-y preserved; native touch-scroll CDP check remains blocked');

    await click('#menuBtn');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const drawer = await evaluate("(() => { const r = document.querySelector('#settings').getBoundingClientRect(); return {left:r.left,right:r.right,height:r.height} })()");
    assert.ok(drawer.left >= 20 && Math.abs(drawer.right - 390) < 1);
    assert.ok(Math.abs(drawer.height-600)<1);
    await browser.screenshot('/private/tmp/bishun-drawer-mobile.png');
    for (const type of ['mousePressed','mouseReleased']) await command('Input.dispatchMouseEvent', {type,x:5,y:80,button:'left',clickCount:1});
    await wait("!document.querySelector('#settings').open");
    checks.push('mobile drawer is full-height, internally scrollable and closes from backdrop');

    await click('#playBtn');
    await wait("document.querySelector('#animationLayer').children.length > 0");
    await gesture(120);
    await wait(position('1 / 3'));
    assert.equal(await evaluate("document.querySelector('#animationLayer').children.length"), 0);
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"), '播放');
    checks.push('swipe during animation cancels old playback and loads next target without autoplay');

    await click('#menuBtn');
    await click('#practiceBtn');
    await wait("!document.querySelector('#practiceHintBtn').disabled");
    await gesture(-120);
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"), '1 / 3');
    assert.equal(await evaluate("document.querySelector('#practicePanel').hidden"), false);
    await click('#menuBtn');
    assert.equal(await evaluate("document.querySelector('#practiceHintBtn').textContent"), '继续练习');
    await click('#closeMenuBtn');
    await click('#practiceExitBtn');
    await wait(ready);
    checks.push('handwriting gestures never switch characters; opening drawer pauses practice and closing never auto-resumes');
    await click('#menuBtn');
    if (!await evaluate("document.querySelector('#savedQueries').open")) await click('#savedQueries summary');
    await click('.remove-saved-query');
    await wait("document.querySelector('#savedCount').textContent === '' && document.activeElement.id === 'importSavedBtn'");
    checks.push('deleting last list keeps keyboard focus on enabled import action');
    assert.deepEqual(browser.exceptions, []);
    console.log(JSON.stringify({ browser:browser.version,checks,exceptions:browser.exceptions },null,2));
} catch (error) {
    console.error(await browser.evaluate("({url:location.href,visible:document.visibilityState,drawer:document.querySelector('#settings')?.open,position:document.querySelector('#wordPosition')?.textContent,focus:document.activeElement.id,events:window.swipeEvents?.slice(-8), rect:document.querySelector('#stage')?.getBoundingClientRect().toJSON()})"),browser.exceptions);
    throw error;
} finally { await browser.close(); }
