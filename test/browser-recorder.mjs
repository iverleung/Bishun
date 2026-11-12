import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';

const [cdp = 'http://127.0.0.1:9224', url = 'http://127.0.0.1:5173/record/index.html'] = process.argv.slice(2);
const browser = await openBrowser(cdp, url, { ready: "document.querySelector('#recordState')?.textContent === '准备好了'" });
try {
    const { command, evaluate, wait, click, screenshot, exceptions } = browser;
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const positions = "() => ({record:document.querySelector('#recordBtn').getBoundingClientRect().top,nav:document.querySelector('.recording-navigation').getBoundingClientRect().top})";
    const before = await evaluate(`(${positions})()`);
    const point = await evaluate("(()=>{const r=document.querySelector('#recordBtn').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await wait("document.querySelector('#recordState').textContent.includes('录音中')");
    await new Promise(resolve => setTimeout(resolve, 800));
    const during = await evaluate(`(${positions})()`);
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await wait("document.querySelector('#recordState').textContent.startsWith('已保存')", 15000);
    const after = await evaluate(`(${positions})()`);
    // The intentional :active scale may move the button border by less than one pixel.
    assert.ok(Math.abs(during.record - before.record) < 1);
    assert.equal(during.nav, before.nav);
    assert.deepEqual(after, before);
    await wait("document.querySelector('#playback').readyState >= 2 && !document.querySelector('#playback').hidden", 15000);
    await evaluate("document.querySelector('#playback').play().then(()=>true)");
    await wait("!document.querySelector('#playback').paused && document.querySelector('#playback').currentTime > 0");
    await evaluate("document.querySelector('#playback').pause()");
    await command('Page.reload');
    await wait("document.querySelector('#recordState')?.textContent.startsWith('已保存') && !document.querySelector('#playback').hidden");
    assert.equal(await evaluate("document.querySelector('#reading').textContent"), 'ā');
    await click('#nextBtn');
    await wait("document.querySelector('#reading').textContent === 'á'");
    assert.equal(await evaluate("document.querySelector('#playback').hidden"), true);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.deepEqual(exceptions, []);
    await screenshot('/tmp/bishun-recorder-mobile.png');
    console.log('PASS: hold/release saves; native audio plays; fixed layout; reload restores; next item; mobile width');
} finally {
    await browser.close();
}
