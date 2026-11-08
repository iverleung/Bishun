import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl, pageUrl] = process.argv.slice(2);
if (!cdpUrl || !pageUrl) throw new Error('Usage: node test/browser-performance.mjs <CDP HTTP URL> <preview URL>');
const browser = await openBrowser(cdpUrl, pageUrl);
const { command, evaluate, wait, click, fill } = browser;
const samples = { cachedQuery: [], cachedSwitch: [], startAnimation: [], pauseAnimation: [] };
const label = character => `document.querySelector('#characterCanvas').getAttribute('aria-label') === '${character}，完整字形' && !document.querySelector('#playBtn').disabled`;

async function measure(selector, condition) {
    await browser.activate();
    await wait("document.visibilityState === 'visible'");
    await evaluate(`(() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        const timing = { result: null };
        window.__bishunTiming = timing;
        target.addEventListener('click', () => {
            const started = performance.now();
            let scheduled = false;
            let settled = false;
            const timer = setTimeout(() => finish({ error: 'UI condition timeout' }), 3000);
            const observer = new MutationObserver(check);
            function finish(result) {
                if (settled) return;
                settled = true;
                observer.disconnect();
                clearTimeout(timer);
                timing.result = result;
            }
            function check() {
                if (scheduled || !(${condition})) return;
                scheduled = true;
                requestAnimationFrame(() => {
                    if (${condition}) finish({ milliseconds: performance.now() - started });
                    else { scheduled = false; check(); }
                });
            }
            observer.observe(document.querySelector('main'), { subtree: true, childList: true, characterData: true, attributes: true });
            check();
        }, { capture: true, once: true });
    })()`);
    await click(selector);
    await wait('window.__bishunTiming.result !== null', 4000);
    const result = await evaluate('window.__bishunTiming.result');
    assert.equal(result.error, undefined);
    return Number(result.milliseconds.toFixed(2));
}

function statistics(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = p => sorted[Math.ceil(sorted.length * p) - 1];
    return { count: values.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1), samplesMs: values };
}

try {
    await command('Network.setCacheDisabled', { cacheDisabled: true });
    await fill('#query', '木水心');
    await click('#searchForm button[type=submit]');
    await wait("document.querySelectorAll('#characterList button svg').length === 2 && !document.querySelector('#playBtn').disabled");
    const resourceCount = browser.requests.filter(url => url.includes('/characters/')).length;
    for (let index = 0; index < 30; index++) {
        const text = index % 2 ? '木水心' : '水木心';
        await fill('#query', text);
        samples.cachedQuery.push(await measure('#searchForm button[type=submit]', label(Array.from(text)[0])));
    }
    for (let index = 0; index < 30; index++) {
        const next = index % 2 === 0;
        samples.cachedSwitch.push(await measure(next ? '#nextCharBtn' : '#previousCharBtn', label(next ? '水' : '木')));
    }
    await click('#settings summary');
    await click('#speedSlider');
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home' });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home' });
    await click('#settings summary');
    for (let index = 0; index < 30; index++) {
        samples.startAnimation.push(await measure('#playBtn', "document.querySelector('#playBtn').textContent === '暂停' && !!document.querySelector('#animationLayer svg > g[transform]')"));
        samples.pauseAnimation.push(await measure('#playBtn', "document.querySelector('#playBtn').textContent === '继续' && document.querySelector('#animationLayer').children.length === 0"));
    }
    assert.equal(browser.requests.filter(url => url.includes('/characters/')).length, resourceCount);
    assert.deepEqual(browser.exceptions, []);
    const results = Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, statistics(values)]));
    const budgetsMs = { cachedQuery: 500, cachedSwitch: 300, startAnimation: 100, pauseAnimation: 200 };
    const exceeded = Object.keys(results).filter(key => results[key].p95Ms > budgetsMs[key]);
    console.log(JSON.stringify({
        browser: browser.version,
        viewport: await evaluate('({ width: document.documentElement.clientWidth, height: innerHeight, devicePixelRatio })'),
        definition: 'Trusted click capture timestamp to matching DOM state and subsequent requestAnimationFrame; not physical paint, audio stop, or audible onset.',
        network: 'Normal LAN; HTTP cache disabled; application character cache warmed; zero new character requests during measurements.',
        audio: 'Disabled', sampleCountPerMetric: 30, results, budgetsMs, exceeded,
        passed: exceeded.length === 0
    }, null, 2));
    if (exceeded.length) process.exitCode = 1;
} catch (error) {
    console.log(JSON.stringify({ browser: browser.version, passed: false, error: error.message, visibility: await evaluate('document.visibilityState'), window: await browser.windowState(), completedSamples: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, values.length])) }, null, 2));
    throw error;
} finally { await browser.close(); }
