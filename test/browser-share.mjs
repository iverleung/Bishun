import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl = 'http://127.0.0.1:9224', pageUrl = 'http://127.0.0.1:5189/'] = process.argv.slice(2);
const browser = await openBrowser(cdpUrl, pageUrl);
const checks = [];
try {
    const { evaluate, command, wait, click, fill } = browser;
    await fill('#query', '木水木');
    await click('#searchForm [type="submit"]');
    await wait("!document.querySelector('#playBtn').disabled");
    await click('#menuBtn');
    await click('#shareBtn');
    assert.equal(await evaluate("document.querySelector('#shareContent').textContent"), '链接包含：木');
    await click('#shareGroup');
    const link = await evaluate("document.querySelector('#shareLink').value");
    assert.equal(new URL(link).search, '');
    assert.equal(new URLSearchParams(new URL(link).hash.slice(1)).get('q'), '木水木');
    checks.push('current character or immutable query snapshot, clean content-only link');

    await evaluate("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })");
    await click('#copyShareBtn');
    await wait("document.querySelector('#shareFeedback').textContent === '请复制上方链接'");
    assert.equal(await evaluate("document.activeElement.id"), 'shareLink');
    assert.equal(await evaluate("document.querySelector('#shareLink').selectionEnd - document.querySelector('#shareLink').selectionStart"), link.length);
    await click('#closeShareBtn');
    await wait("document.activeElement.id === 'shareBtn'");
    checks.push('unavailable clipboard falls back to selected link; closing restores focus');

    await command('Page.navigate', { url: link });
    await wait("document.querySelector('#query').value === '木水木' && !document.querySelector('#playBtn').disabled");
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"), '播放');
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"), '1 / 3');
    assert.equal(await evaluate("document.querySelector('#savedCount').textContent"), '');
    await command('Page.reload');
    await wait("document.querySelector('#query').value === '木水木' && !document.querySelector('#playBtn').disabled");
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"), '播放');
    checks.push('shared link and refresh restore duplicates in order without autoplay or saving');

    await fill('#query', '心');
    await click('#searchForm [type="submit"]');
    await wait("!document.querySelector('#playBtn').disabled");
    assert.equal(new URL(await evaluate('location.href')).hash, '');
    await command('Page.navigate', { url: new URL('/#q=abc', pageUrl).href });
    await wait("!document.querySelector('#queryNotice').hidden");
    assert.equal(await evaluate("document.querySelector('#lesson').hidden"), true);
    assert.match(await evaluate("document.querySelector('#queryNotice').textContent"), /分享链接无效/);
    checks.push('manual query clears stale shared URL; invalid links do not silently filter');

    await command('Page.navigate', { url: link });
    await wait("document.querySelector('#query').value === '木水木' && !document.querySelector('#playBtn').disabled");
    await evaluate("Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Cancelled', 'AbortError'); } })");
    await click('#menuBtn');
    await click('#shareBtn');
    await click('#systemShareBtn');
    await wait("!document.querySelector('#systemShareBtn').disabled");
    assert.equal(await evaluate("document.querySelector('#shareFeedback').textContent"), '');
    await command('Emulation.setDeviceMetricsOverride', { width: 320, height: 820, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate("document.querySelector('#shareDialog').scrollWidth <= document.querySelector('#shareDialog').clientWidth"), true);
    assert.deepEqual(browser.exceptions, []);
    checks.push('cancelled system sharing is quiet (stub); 320px dialog fits');
    console.log(JSON.stringify({ browser: browser.version, checks, exceptions: browser.exceptions }, null, 2));
} finally { await browser.close(); }
