// Optional real-Chrome regression (Node 22+), using an explicitly authorized CDP endpoint.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl, pageUrl, screenshot] = process.argv.slice(2);
if (!cdpUrl || !pageUrl) throw new Error('Usage: node test/browser-geometry.mjs <CDP HTTP URL> <preview URL> [screenshot.png]');
const browser = await openBrowser(cdpUrl, pageUrl);
const { command, evaluate, click, wait } = browser;
try {
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
    console.log(JSON.stringify({ browser: browser.version, checks: results }, null, 2));
} finally { await browser.close(); }
