// Optional real-Chrome regression (Node 22+). Supply an authorized CDP endpoint and production URL.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [cdpUrl, pageUrl, screenshot] = process.argv.slice(2);
if (!cdpUrl || !pageUrl) throw new Error('Usage: node test/browser-geometry.mjs <CDP HTTP URL> <preview URL> [screenshot.png]');
if (typeof WebSocket !== 'function') throw new Error('This optional browser test requires Node 22+');
const version = await (await fetch(new URL('/json/version', cdpUrl), { signal: AbortSignal.timeout(5000) })).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
    const response = JSON.parse(data);
    const task = pending.get(response.id);
    if (!task) return;
    pending.delete(response.id);
    clearTimeout(task.timer);
    if (response.error) task.reject(new Error(response.error.message));
    else task.resolve(response.result);
};
function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
}

let browserContextId;
try {
    ({ browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true }));
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Target.activateTarget', { targetId });
    const command = (method, params) => send(method, params, sessionId);
    async function evaluate(expression) {
        const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    }
    async function wait(expression) {
        const deadline = Date.now() + 8000;
        while (!await evaluate(expression)) {
            if (Date.now() > deadline) throw new Error(`Condition timeout: ${expression}`);
            await new Promise(resolve => setTimeout(resolve, 25));
        }
    }
    async function click(selector) {
        const point = await evaluate(`(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el || el.disabled) throw new Error('Unavailable control');
            el.scrollIntoView({ block: 'center' });
            const rect = el.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`);
        await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    }
    await command('Page.enable');
    await command('Page.navigate', { url: pageUrl });
    await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    await click('#query');
    await command('Input.insertText', { text: '木' });
    await click('#searchForm button[type=submit]');
    await wait("document.querySelector('#characterCanvas').getAttribute('aria-label') === '木，完整字形'");
    await click('#settings summary');
    await click('#speedSlider');
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home' });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home' });
    const results = [];
    for (const [width, height] of [[1024, 820], [768, 1024], [320, 820]]) {
        await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await click('#restartBtn');
        await wait("!!document.querySelector('#animationLayer svg > g[transform]')");
        const geometry = await evaluate(`(() => {
            const svg = document.querySelector('#animationLayer svg');
            const staticMatrix = document.querySelector('#strokePaths').getScreenCTM();
            const animatedGroup = svg.querySelector('g[transform]');
            const matrix = animatedGroup.getScreenCTM();
            const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
            const difference = Math.max(...keys.map(key => Math.abs(matrix[key] - staticMatrix[key])));
            const viewBox = svg.getAttribute('viewBox');
            // Negative control: the old missing-viewBox bug must be detected by the geometry check.
            svg.removeAttribute('viewBox');
            const wrong = animatedGroup.getScreenCTM();
            const missingViewBoxDifference = Math.max(...keys.map(key => Math.abs(wrong[key] - staticMatrix[key])));
            if (viewBox !== null) svg.setAttribute('viewBox', viewBox);
            return { viewBox, difference, missingViewBoxDifference, label: document.querySelector('#characterCanvas').getAttribute('aria-label') };
        })()`);
        assert.ok(geometry.difference < 0.5, `Static/animated coordinates diverged: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.missingViewBoxDifference > 1, 'Geometry check failed to detect the original bug');
        results.push({ viewport: [width, height], ...geometry });
        if (screenshot && width === 768) {
            await evaluate("document.querySelector('#writingGrid').scrollIntoView({block:'center'})");
            const image = await command('Page.captureScreenshot', { format: 'png' });
            await fs.writeFile(screenshot, Buffer.from(image.data, 'base64'));
        }
        // Positioning is an unconditional stop; toggling play could restart a just-finished stroke.
        await click('#strokeList button:nth-child(2)');
        await wait("document.querySelector('#animationLayer').children.length === 0");
    }
    console.log(JSON.stringify({ browser: version.Browser, checks: results }, null, 2));
} finally {
    try { if (browserContextId) await send('Target.disposeBrowserContext', { browserContextId }); }
    finally { socket.close(); }
}
