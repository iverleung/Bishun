import assert from 'node:assert/strict';
import { practiceStroke } from './helpers/practice-input.mjs';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl = 'http://127.0.0.1:9224', pageUrl = 'http://127.0.0.1:5189/'] = process.argv.slice(2);
const browser = await openBrowser(cdpUrl, pageUrl);
const checks = [];
try {
    const { command, evaluate, wait, click, fill } = browser;
    const active = "!document.querySelector('#practicePanel').hidden && !document.querySelector('#practiceHintBtn').disabled && document.querySelector('#practiceHintBtn').textContent === '提示下一笔'";
    const progress = text => `document.querySelector('#practiceProgress').textContent === '${text}'`;
    async function query(text) {
        await fill('#query', text);
        await click('#searchForm [type="submit"]');
        await wait("!document.querySelector('#playBtn').disabled");
    }
    async function enter() {
        await click('#menuBtn');
        await click('#practiceBtn');
        await wait(active);
    }
    const stroke = (...args) => practiceStroke(browser, ...args);
    async function endListenerCount() {
        const { result } = await command('Runtime.evaluate', { expression: 'document' });
        const { listeners } = await command('DOMDebugger.getEventListeners', { objectId: result.objectId });
        return listeners.filter(item => ['mouseup','touchend'].includes(item.type)).length;
    }

    await query('十木水');
    const listenersBefore = await endListenerCount();
    await enter();
    assert.equal(await evaluate("document.querySelector('#demonstrationControls').hidden"), true);
    assert.equal(await evaluate("document.querySelector('#animationLayer').children.length"), 0);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#characterInk')).visibility"), 'hidden');
    await stroke('十', 1);
    await wait("document.querySelector('#practiceFeedback').textContent.includes('再试一次')");
    assert.equal(await evaluate("document.querySelector('#practiceProgress').textContent"), '0 / 2 笔');
    await stroke('十', 0, 'mouse', true);
    assert.equal(await evaluate("document.querySelector('#practiceProgress').textContent"), '0 / 2 笔');
    await stroke('十', 0);
    await wait(progress('1 / 2 笔'));
    await stroke('十', 1);
    await wait("document.querySelector('#practiceFeedback').textContent === '这一字写完了'");
    checks.push('real mouse strokes reject wrong order and backwards input; both correct strokes complete without scoring');

    await evaluate("document.querySelector('#practiceMode').value='independent'; document.querySelector('#practiceMode').dispatchEvent(new Event('change'))");
    await wait(active);
    assert.equal(await evaluate("document.querySelector('#practiceProgress').textContent"), '0 / 2 笔');
    const outlineOpacity = await evaluate("getComputedStyle(document.querySelector('#practiceLayer svg > g > g:first-child')).opacity");
    assert.equal(outlineOpacity, '0');
    await click('#practiceHintBtn');
    await wait(active);
    assert.equal(await evaluate("document.querySelector('#practiceProgress').textContent"), '0 / 2 笔');
    await click('#practiceHintBtn');
    await click('#practiceRestartBtn');
    await wait(active);
    checks.push('independent mode hides outline; hints never count; restarting during hint recovers');

    await stroke('十', 0);
    await wait(progress('1 / 2 笔'));
    const { targetInfo } = await command('Target.getTargetInfo');
    const { targetId } = await command('Target.createTarget', { url: 'about:blank', browserContextId: targetInfo.browserContextId });
    await command('Target.activateTarget', { targetId });
    await wait("document.visibilityState === 'hidden' && document.querySelector('#practiceHintBtn').textContent === '继续练习'");
    await command('Target.closeTarget', { targetId });
    await browser.activate();
    await wait("document.visibilityState === 'visible'");
    assert.equal(await evaluate("document.querySelector('#practiceProgress').textContent"), '1 / 2 笔');
    assert.equal(await evaluate("document.querySelector('#practiceHintBtn').textContent"), '继续练习');
    await click('#practiceHintBtn');
    await wait(active);
    await stroke('十', 1, 'pen');
    await wait("document.querySelector('#practiceFeedback').textContent === '这一字写完了'");
    checks.push('actual background tab pauses; accepted prefix survives; explicit resume and pen events finish');

    await command('Emulation.setDeviceMetricsOverride', { width: 320, height: 820, deviceScaleFactor: 1, mobile: true });
    await command('Emulation.setTouchEmulationEnabled', { enabled: true });
    await click('#practiceRestartBtn');
    await wait(active);
    await evaluate("document.querySelector('#writingGrid').scrollIntoView({ block: 'center' })");
    const scroll = await evaluate('scrollY');
    await stroke('十', 0, 'touch');
    await wait(progress('1 / 2 笔'));
    await stroke('十', 1, 'touch');
    await wait("document.querySelector('#practiceFeedback').textContent === '这一字写完了'");
    assert.equal(await evaluate('scrollY'), scroll);
    assert.equal(await evaluate('getComputedStyle(document.body).touchAction'), 'auto');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await new Promise(resolve => setTimeout(resolve, 150));
    await browser.screenshot('/private/tmp/bishun-practice-mobile.png');
    checks.push('320px real touch events match both strokes without dragging page; scrolling is not globally disabled');

    await click('#practiceRestartBtn');
    await wait(active);
    await command('Emulation.setDeviceMetricsOverride', { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true });
    await wait("document.querySelector('#practiceHintBtn').textContent === '继续练习'");
    await click('#practiceHintBtn');
    await wait(active);
    await stroke('十', 0, 'touch');
    await wait(progress('1 / 2 笔'));
    checks.push('canvas resize pauses and explicit resume remeasures input coordinates correctly');

    const listenersAfter = await endListenerCount();
    assert.equal(listenersAfter, listenersBefore + 2);
    for (let i = 0; i < 10; i++) {
        await click('#practiceRestartBtn');
        await wait(active);
    }
    assert.equal(await endListenerCount(), listenersAfter);
    await click('#practiceHintBtn');
    await click('#nextCharBtn');
    await wait("document.querySelector('#practicePanel').hidden && !document.querySelector('#playBtn').disabled");
    await enter();
    await wait(active);
    assert.match(await evaluate("document.querySelector('#characterCanvas').getAttribute('aria-label')"), /练习木/);
    for (let index = 0; index < 4; index++) {
        await stroke('木', index, 'touch');
        await wait(progress(`${index + 1} / 4 笔`));
    }
    await wait("document.querySelector('#practiceFeedback').textContent === '这一字写完了'");
    await click('#practiceExitBtn');
    await wait("document.querySelector('#characterCanvas').getAttribute('aria-label') === '木，完整字形'");
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"), '播放');
    checks.push('restarts reuse one writer without accumulating listeners; switching during hint cancels; exit restores full demonstration');

    await click('#playBtn');
    await wait("document.querySelector('#animationLayer').children.length > 0");
    await enter();
    assert.equal(await evaluate("document.querySelector('#animationLayer').children.length"), 0);
    await click('#clearBtn');
    await wait("document.querySelector('#lesson').hidden");
    assert.equal(await evaluate("document.querySelector('#practiceLayer').hidden"), true);
    await query('木');
    await enter();
    await query('水');
    await wait("document.querySelector('#practicePanel').hidden && !document.querySelector('#playBtn').disabled");
    await enter();
    for (let index = 0; index < 4; index++) {
        await stroke('水', index, 'touch');
        await wait(progress(`${index + 1} / 4 笔`));
    }
    await wait("document.querySelector('#practiceFeedback').textContent === '本次写完 1 字'");
    await click('#practiceRestartBtn');
    await wait(active);
    await evaluate("document.querySelector('#writingGrid').scrollIntoView({ block: 'center' })");
    const partial = await evaluate(`(() => { const r = document.querySelector('#practiceLayer > svg').getBoundingClientRect(); return { x:r.left + r.width / 2, y:r.top + r.height / 3 }; })()`);
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...partial, button: 'left', buttons: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: partial.x + 10, y: partial.y + 10, button: 'left', buttons: 1 });
    await evaluate("document.querySelector('#practiceLayer').dispatchEvent(new Event('pointercancel', { bubbles: true }))");
    await wait("document.querySelector('#practiceHintBtn').textContent === '继续练习'");
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: partial.x + 10, y: partial.y + 10, button: 'left', buttons: 0 });
    assert.equal(await evaluate("document.querySelector('#practiceProgress').textContent"), '0 / 4 笔');
    await click('#practiceHintBtn');
    await wait(active);
    checks.push('touch paths for 木 and 水 including hooks complete; entering practice stops an active animation; cancelled pointer pauses without accepting partial stroke');
    assert.deepEqual(browser.exceptions, []);
    assert.ok(browser.requests.filter(url => /^https?:/.test(url)).every(url => new URL(url).origin === new URL(pageUrl).origin));
    checks.push('clear and new query cancel practice; all resources same-origin; no page exceptions');
    console.log(JSON.stringify({ browser: browser.version, checks, exceptions: browser.exceptions }, null, 2));
} catch (error) {
    console.error(await browser.evaluate("({ visibility:document.visibilityState, progress:document.querySelector('#practiceProgress')?.textContent, feedback:document.querySelector('#practiceFeedback')?.textContent, hint:document.querySelector('#practiceHintBtn')?.textContent, layer:document.querySelector('#practiceLayer')?.innerHTML.slice(0,150) })"), browser.exceptions);
    throw error;
} finally { await browser.close(); }
