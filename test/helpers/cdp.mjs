import fs from 'node:fs/promises';

// Isolated, optional browser tests: no access to existing user targets or stored browser data.
export async function openBrowser(cdpUrl, pageUrl, { ready = "document.querySelector('#status')?.textContent === '请输入汉字' && document.visibilityState === 'visible'" } = {}) {
    if (typeof WebSocket !== 'function') throw new Error('Browser tests require Node 22+');
    const response = await fetch(new URL('/json/version', cdpUrl), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`CDP connection failed: ${response.status}`);
    const version = await response.json();
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connection timeout')); }, 5000);
        socket.onopen = () => { clearTimeout(timer); resolve(); };
        socket.onerror = () => { clearTimeout(timer); reject(new Error('CDP connection failed')); };
    });
    let nextId = 0;
    const pending = new Map();
    const requests = [];
    const responses = [];
    const exceptions = [];
    socket.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
        if (message.method === 'Network.responseReceived') responses.push({ url: message.params.response.url, status: message.params.response.status });
        if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
        const task = pending.get(message.id);
        if (!task) return;
        pending.delete(message.id);
        clearTimeout(task.timer);
        if (message.error) task.reject(new Error(message.error.message));
        else task.resolve(message.result);
    };
    function send(method, params = {}, sessionId) {
        return new Promise((resolve, reject) => {
            const id = ++nextId;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
            pending.set(id, { resolve, reject, timer });
            socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    }
    let browserContextId;
    async function close() {
        try { if (browserContextId) await send('Target.disposeBrowserContext', { browserContextId }); }
        finally { socket.close(); }
    }
    try {
        ({ browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true }));
        const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        const command = (method, params = {}) => send(method, params, sessionId);
        const windowState = () => send('Browser.getWindowForTarget', { targetId });
        async function activate() {
            const { windowId, bounds } = await windowState();
            if (bounds.windowState === 'minimized') await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
            await send('Target.activateTarget', { targetId });
            await command('Page.bringToFront');
        }
        await activate();
        async function evaluate(expression) {
            const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            return result.result.value;
        }
        async function wait(expression, timeoutMs = 8000) {
            const deadline = Date.now() + timeoutMs;
            while (!await evaluate(expression)) {
                if (Date.now() > deadline) throw new Error(`Condition timeout: ${expression}`);
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        }
        async function click(selector) {
            // Follow the new visible entry points when exercising existing flows.
            if (selector === '#practiceBtn' && await evaluate("document.querySelector('#settings')?.open")) {
                await click('#closeMenuBtn');
                await wait("!document.querySelector('#settings').open && document.activeElement.id==='menuBtn'");
            }
            if (['#saveCharacterBtn','#saveQueryBtn'].includes(selector) && !await evaluate("document.querySelector('#saveScopeDialog').open")) {
                await click('#saveBtn');
                if (!await evaluate("document.querySelector('#saveScopeDialog').open")) return;
            }
            if (['#speechToggle','#speedSlider'].includes(selector) && !await evaluate("document.querySelector('#playbackSettings').open")) await click('#playbackSettings summary');
            if (selector === '#showPinyin' && !await evaluate("document.querySelector('#printSettings').open")) await click('#printSettings summary');
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
        async function fill(selector, text) {
            // Result pages expose search through the compact toolbar. Follow
            // the actual UI instead of reaching into its hidden input.
            if (selector === '#query' && !await evaluate("document.querySelector('#query').getClientRects().length > 0")) {
                await click('#openSearchBtn');
                await wait("document.querySelector('#searchDialog').open && document.querySelector('#query').getClientRects().length > 0");
            }
            await click(selector);
            await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4, commands: ['selectAll'] });
            await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 });
            await command('Input.insertText', { text });
        }
        async function screenshot(path) {
            const result = await command('Page.captureScreenshot', { format: 'png' });
            await fs.writeFile(path, Buffer.from(result.data, 'base64'));
        }
        await command('Page.enable');
        await command('Runtime.enable');
        await command('Network.enable');
        await command('Page.navigate', { url: pageUrl });
        await wait(ready);
        return { version: version.Browser, command, evaluate, wait, click, fill, screenshot, close, activate, windowState, requests, responses, exceptions };
    } catch (error) { await close(); throw error; }
}
