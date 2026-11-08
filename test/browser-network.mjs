import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl, pageUrl, screenshot] = process.argv.slice(2);
if (!cdpUrl || !pageUrl) throw new Error('Usage: node test/browser-network.mjs <CDP HTTP URL> <preview URL> [screenshot.png]');
const browser = await openBrowser(cdpUrl, pageUrl);
const { command, evaluate, wait, click, fill } = browser;
const checks = [];
const normal = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
const network = params => command('Network.emulateNetworkConditions', { ...normal, ...params });
const canvas = character => `document.querySelector('#characterCanvas').getAttribute('aria-label') === '${character}，完整字形'`;
const resourceRequests = () => browser.requests.filter(url => /\/(characters|audio)\//.test(url)).length;
const query = async text => { await fill('#query', text); await click('#searchForm button[type=submit]'); };
try {
    await command('Network.setCacheDisabled', { cacheDisabled: true });
    await network({ latency: 400, downloadThroughput: 50000, uploadThroughput: 25000 });
    const started = Date.now();
    await query('木');
    await wait(canvas('木'));
    checks.push({ case: 'cold slow network', latencyMs: 400, downloadBytesPerSecond: 50000, elapsedMs: Date.now() - started });

    await network({ offline: true });
    const cachedRequests = resourceRequests();
    await query('木');
    await wait(canvas('木'));
    assert.equal(resourceRequests(), cachedRequests);
    checks.push({ case: 'offline same-page cached character', newRequests: 0 });

    await query('花');
    await wait("!document.querySelector('#retryBtn').hidden");
    const offlineMessage = await evaluate("document.querySelector('#stageMessageText').textContent");
    checks.push({ case: 'offline uncached character', message: offlineMessage });
    assert.match(offlineMessage, /网络|连接/, 'Network failure must have an actionable Chinese message');
    await network({});
    await click('#retryBtn');
    await wait(canvas('花'));
    checks.push({ case: 'reconnect and retry', character: '花' });

    await command('Page.reload');
    await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    await network({ latency: 1000, downloadThroughput: 10000, uploadThroughput: 10000 });
    const timeoutStarted = Date.now();
    await query('心');
    await wait("!document.querySelector('#retryBtn').hidden");
    const timeoutMessage = await evaluate("document.querySelector('#stageMessageText').textContent");
    assert.match(timeoutMessage, /超时/);
    checks.push({ case: 'very slow cold manifest times out', latencyMs: 1000, downloadBytesPerSecond: 10000, elapsedMs: Date.now() - timeoutStarted, message: timeoutMessage });
    await network({});
    await click('#retryBtn');
    await wait(canvas('心'));
    checks.push({ case: 'timeout then retry', character: '心' });

    await network({ latency: 400, downloadThroughput: 50000, uploadThroughput: 25000 });
    await query('学');
    await network({});
    await query('木');
    await wait(canvas('木'));
    await new Promise(resolve => setTimeout(resolve, 750));
    assert.ok(await evaluate(canvas('木')));
    checks.push({ case: 'superseded slow query never overwrites new result', character: '木' });

    await command('Network.setBlockedURLs', { urls: ['*/audio/strokes/*'] });
    await click('#settings summary');
    await click('[name="mode"][value="explain"]');
    await click('#playBtn');
    await wait("document.querySelector('#playBtn').textContent === '重播'", 20000);
    const audioMessage = await evaluate("document.querySelector('#status').textContent");
    checks.push({ case: 'audio network failure degrades to silence', message: audioMessage });
    assert.match(audioMessage, /录音|声音/);
    assert.doesNotMatch(audioMessage, /Failed|fetch/);

    await command('Network.setBlockedURLs', { urls: [] });
    await query('木');
    await wait(canvas('木'));
    await click('#playBtn');
    await wait("document.querySelector('#playBtn').textContent === '重播'", 20000);
    assert.equal(await evaluate("document.querySelector('#status').textContent"), '播放完成');
    assert.ok(browser.responses.some(response => response.url.endsWith('.mp3') && response.status === 200));
    checks.push({ case: 'audio reconnect on next query', completedStrokes: 4 });

    await network({ offline: true });
    const before = resourceRequests();
    await query('木');
    await wait(canvas('木'));
    await click('#playBtn');
    await wait("document.querySelector('#playBtn').textContent === '重播'", 20000);
    assert.equal(await evaluate("document.querySelector('#status').textContent"), '播放完成');
    assert.equal(resourceRequests(), before);
    checks.push({ case: 'offline same-page character and decoded audio', newRequests: 0, completedStrokes: 4 });
    assert.deepEqual(browser.exceptions, []);
    assert.ok(browser.requests.filter(url => /^https?:/.test(url)).every(url => new URL(url).origin === new URL(pageUrl).origin));
    if (screenshot) {
        await click('#settings summary');
        await evaluate("document.querySelector('#writingGrid').scrollIntoView({block:'center'})");
        await browser.screenshot(screenshot);
    }
    console.log(JSON.stringify({ browser: browser.version, passed: true, cacheDisabled: true, scope: 'Already-loaded page; in-memory character and decoded-audio caches, not offline reload support', checks }, null, 2));
} catch (error) {
    if (screenshot) await browser.screenshot(screenshot).catch(() => {});
    console.log(JSON.stringify({ browser: browser.version, passed: false, checks, error: error.message }, null, 2));
    process.exitCode = 1;
} finally { await browser.close(); }
