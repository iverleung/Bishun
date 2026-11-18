import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openBrowser } from './helpers/cdp.mjs';

const [cdp = 'http://127.0.0.1:9224', base = '/bishun/'] = process.argv.slice(2);
const dist = path.resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (!pathname.startsWith(base)) {
            response.writeHead(404).end('Only the configured base path is served');
            return;
        }
        const relative = pathname.slice(base.length) || 'index.html';
        const file = path.resolve(dist, relative);
        if (!file.startsWith(dist + path.sep)) throw new Error('Invalid path');
        const data = await fs.readFile(file);
        response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
        response.end(data);
    } catch {
        response.writeHead(404).end('Not found');
    }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await openBrowser(cdp, `${origin}${base}#q=${encodeURIComponent('木水心')}`, { ready: "document.querySelector('#characterCanvas')?.getAttribute('aria-label') === '木，完整字形'" });
await browser.command('Emulation.setFocusEmulationEnabled', { enabled: true });
try {
    const { evaluate, wait, click, responses, requests } = browser;
    assert.match(await evaluate("document.querySelector('#basicInfo').textContent"), /mù.*4 笔/);
    assert.equal(await evaluate("document.querySelectorAll('#strokePaths path').length"), 4);
    assert.equal(new URL(await evaluate('location.href')).pathname, base);
    await click('[data-reading="mù"]');
    await wait("document.querySelector('.reading-button.is-speaking')");
    await click('#playBtn');
    await click('#menuBtn');
    await click('#openTextbookBtn');
    await wait("document.querySelector('#textbookDialog').open && !document.querySelector('#openTextbookTaskBtn').disabled");
    await click('#closeTextbookBtn');
    await click('#menuBtn');
    await click('#printQueryBtn');
    await wait("document.body.dataset.ready === 'true'", 15000);
    assert.equal(new URL(await evaluate('location.href')).pathname, `${base}print/index.html`);
    assert.ok(await evaluate("document.querySelectorAll('#printPages .print-page').length > 0"));

    const ownResponses = responses.filter(item => new URL(item.url).origin === origin);
    assert.equal(ownResponses.filter(item => item.status === 404).length, 0);
    for (const fragment of [
        'characters/2.0.1/manifest.json', `characters/2.0.1/${encodeURIComponent('木')}.json`,
        'audio/readings/v2/', 'audio/strokes/v2/manifest.json', 'audio/strokes/v2/',
        'textbooks/pilot-v1/g1-first-', 'characters/2.0.1/ARPHICPL.TXT',
    ]) {
        assert.ok(ownResponses.some(item => item.url.includes(`${base}${fragment}`) && item.status === 200), `Missing based request: ${fragment}`);
    }
    const rootResources = requests.filter(value => {
        const url = new URL(value);
        return url.origin === origin && ['/characters/', '/audio/', '/textbooks/'].some(prefix => url.pathname.startsWith(prefix));
    });
    if (base !== '/') assert.deepEqual(rootResources, []);
    console.log(JSON.stringify({ base, page: '木、mù、4 笔 and four stroke paths rendered', audio: 'reading and stroke MP3 requested', textbook: 'loaded', print: 'license and worksheet loaded', rootResourceRequests: rootResources, notFoundResponses: 0 }, null, 2));
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
