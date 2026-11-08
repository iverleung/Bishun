import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl = 'http://127.0.0.1:9224', pageUrl = 'http://127.0.0.1:5189/'] = process.argv.slice(2);
const browser = await openBrowser(cdpUrl, pageUrl);
const checks = [];
try {
    const { evaluate, command, wait, click, fill } = browser;
    await fill('#query', '木长學');
    await click('#searchForm [type="submit"]');
    await wait("!document.querySelector('#playBtn').disabled");
    await wait("document.querySelector('#characterReadings').textContent === 'mù'");
    assert.equal(await evaluate("document.querySelector('#characterStrokeCount').textContent"), '4 笔');
    assert.equal(await evaluate("document.querySelector('#strokePosition').textContent"), '');
    const geometry = await evaluate(`(() => {
        const info = document.querySelector('#basicInfo').getBoundingClientRect();
        const grid = document.querySelector('#writingGrid').getBoundingClientRect();
        return { above: info.bottom <= grid.top, centerDifference: Math.abs((info.left + info.right - grid.left - grid.right) / 2) };
    })()`);
    assert.equal(geometry.above, true);
    assert.ok(geometry.centerDifference < 1);
    assert.equal(await evaluate("document.querySelector('#settings').open"), false);
    checks.push('pinyin and geometry stroke count appear centered above canvas without opening settings');
    await click('#nextCharBtn');
    await wait("document.querySelector('#characterReadings').textContent === 'cháng / zhǎng'");
    assert.equal(await evaluate("document.querySelector('#characterReadings').getAttribute('aria-label')"), '多音字，cháng，zhǎng');
    assert.equal(await evaluate("document.querySelector('#characterStrokeCount').textContent"), '4 笔');
    await click('#nextCharBtn');
    await wait("document.querySelector('#wordPosition').textContent === '3 / 3' && !document.querySelector('#playBtn').disabled");
    assert.equal(await evaluate("document.querySelector('#characterReadings').textContent"), '暂缺');
    assert.equal(await evaluate("document.querySelector('#characterStrokeCount').textContent"), '16 笔');
    checks.push('polyphonic candidates retained; unavailable traditional reading stays unknown while actual stroke count works');
    await command('Network.emulateNetworkConditions', { offline: false, latency: 350, downloadThroughput: -1, uploadThroughput: -1 });
    await fill('#query', '重');
    await click('#searchForm [type="submit"]');
    assert.equal(await evaluate("document.querySelector('#characterReadings').textContent"), '加载中');
    await fill('#query', '木');
    await click('#searchForm [type="submit"]');
    await wait("document.querySelector('#characterReadings').textContent === 'mù'");
    await command('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await evaluate("document.querySelector('#characterReadings').textContent"), 'mù');
    await command('Emulation.setDeviceMetricsOverride', { width: 320, height: 820, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await fill('#query', '行');
    await click('#searchForm [type="submit"]');
    await wait("document.querySelector('#characterReadings').textContent.includes('xíng')");
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const aligned = await evaluate(`(() => {
        const info = document.querySelector('#basicInfo').getBoundingClientRect();
        const grid = document.querySelector('#writingGrid').getBoundingClientRect();
        return info.bottom <= grid.top && Math.abs((info.left + info.right - grid.left - grid.right) / 2) < 1;
    })()`);
    assert.equal(aligned, true);
    await browser.screenshot('/private/tmp/bishun-info-above-mobile.png');
    assert.deepEqual(browser.exceptions, []);
    checks.push('new query clears old information during loading; stale query cannot overwrite; 320px fits');
    console.log(JSON.stringify({ browser: browser.version, checks, exceptions: browser.exceptions }, null, 2));
} finally { await browser.close(); }
