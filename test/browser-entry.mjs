import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl, homeUrl, screenshot] = process.argv.slice(2);
if (!cdpUrl || !homeUrl) throw new Error('Usage: node test/browser-entry.mjs <CDP HTTP URL> <home URL> [screenshot.png]');
const browser = await openBrowser(cdpUrl, homeUrl);
const { command, evaluate, wait, click, fill } = browser;
const root = new URL('/', homeUrl);
const ready = character => `document.querySelector('#characterCanvas').getAttribute('aria-label') === '${character}，完整字形'`;
const checks = [];
try {
    assert.equal(await evaluate('location.pathname'), '/');
    assert.equal(await evaluate("document.querySelector('a.original-link').getAttribute('href')"), '/legacy/index.html');
    checks.push({ case: 'default home uses new application', path: '/' });
    await fill('#query', '木水心');
    await click('#searchForm button[type=submit]');
    await wait(ready('木'));
    await click('#settings summary');
    await click('[name="mode"][value="explain"]');
    await click('#playBtn');
    await wait("!!document.querySelector('#animationLayer svg > g[transform]')");
    const geometryDifference = await evaluate(`(() => {
        const a = document.querySelector('#strokePaths').getScreenCTM();
        const b = document.querySelector('#animationLayer svg > g[transform]').getScreenCTM();
        return Math.max(...['a','b','c','d','e','f'].map(key => Math.abs(a[key] - b[key])));
    })()`);
    assert.ok(geometryDifference < 0.5);
    await wait("document.querySelector('#playBtn').textContent === '重播'", 20000);
    assert.equal(await evaluate("document.querySelector('#status').textContent"), '播放完成');
    checks.push({ case: 'root recording and animation playback', completedStrokes: 4, geometryDifference });
    await click('#strokeList button:nth-child(2)');
    await click('#replayStrokeBtn');
    await wait("document.querySelector('#playBtn').textContent === '继续' && document.querySelector('#strokePosition').textContent === '2 / 4 笔'");
    checks.push({ case: 'root single-stroke replay', position: '2 / 4' });
    await click('#saveCharacterBtn');
    await click('#saveQueryBtn');
    const compatibility = new URL('/preview/index.html?candidate=1#query', root);
    await command('Page.navigate', { url: compatibility.href });
    await wait("location.pathname === '/' && document.querySelector('#status')?.textContent === '请输入汉字'");
    assert.equal(await evaluate('location.search + location.hash'), '?candidate=1#query');
    assert.equal(await evaluate("document.querySelector('#savedCount').textContent"), '2');
    assert.equal(await evaluate("document.querySelector('#speechToggle').checked"), true);
    assert.equal(await evaluate("document.querySelector('#animationLayer').children.length"), 0);
    checks.push({ case: 'preview compatibility redirects, preserves URL and local state', path: '/?candidate=1#query', savedLists: 2, autoplay: false });
    await click('#savedQueries summary');
    assert.equal(await evaluate("document.querySelector('#savedList .saved-query:first-child > button').textContent"), '木水心');
    await click('#savedList .saved-query:first-child > button');
    await wait(ready('木'));
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"), '1 / 3');
    checks.push({ case: 'saved query opens after entry migration', position: '1 / 3' });
    const viewports = [];
    for (const [width, height] of [[1280, 900], [768, 1024], [320, 820]]) {
        await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const layout = await evaluate(`(() => {
            const rect = document.querySelector('#writingGrid').getBoundingClientRect();
            return { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, canvasCenter: (rect.left + rect.right) / 2 };
        })()`);
        assert.equal(layout.scrollWidth, layout.width);
        assert.ok(Math.abs(layout.canvasCenter - layout.width / 2) < 1);
        viewports.push({ viewport: [width, height], ...layout });
    }
    checks.push({ case: 'root responsive layout', viewports, scope: 'Desktop viewport changes; not a new mobile-device acceptance' });
    await command('Emulation.clearDeviceMetricsOverride');
    if (screenshot) {
        await evaluate("document.querySelector('#writingGrid').scrollIntoView({block:'center'})");
        await browser.screenshot(screenshot);
    }
    const newRequests = [...browser.requests];
    assert.ok(newRequests.filter(url => /^https?:/.test(url)).every(url => new URL(url).origin === root.origin));
    checks.push({ case: 'new application resources same origin' });

    // Keep the legacy analytics code unchanged, but don't contact it during the isolated regression.
    await command('Network.setBlockedURLs', { urls: ['https://www.googletagmanager.com/*', 'https://www.google-analytics.com/*'] });
    await click('a.original-link');
    await wait("location.pathname === '/legacy/index.html' && !!document.querySelector('#charInput') && document.querySelector('#buildInfo')?.textContent.startsWith('v')");
    assert.equal(await evaluate('document.title'), '给小朋友用的笔顺工具');
    checks.push({ case: 'legacy entry loads original UI and module', path: '/legacy/index.html', analyticsBlockedForTest: true });
    await click('footer a[href="/"]');
    await wait("location.pathname === '/' && document.querySelector('#status')?.textContent === '请输入汉字'");
    assert.equal(await evaluate("document.querySelector('#savedCount').textContent"), '2');
    checks.push({ case: 'legacy return link restores new home with saved lists' });
    assert.deepEqual(browser.exceptions, []);
    console.log(JSON.stringify({ browser: browser.version, passed: true, checks }, null, 2));
} finally { await browser.close(); }
