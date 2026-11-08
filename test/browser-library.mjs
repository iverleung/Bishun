import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl = 'http://127.0.0.1:9224', pageUrl = 'http://127.0.0.1:5189/'] = process.argv.slice(2);
const browser = await openBrowser(cdpUrl, pageUrl);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'bishun-library-'));
const checks = [];
try {
    const { evaluate, command, wait, click, fill } = browser;
    await evaluate(`localStorage.setItem('bishun-saved-queries-v1', JSON.stringify(['木木水','心']))`);
    await command('Page.reload');
    await wait("document.querySelector('#savedCount')?.textContent === '2'");
    await click('#savedQueries summary');
    await click('#manageSavedBtn');
    await click('.saved-query:first-child [data-action="edit"]');
    await fill('#savedName', '今天的作业');
    await fill('#savedText', '木水木');
    await click('#cancelEditSavedBtn');
    assert.equal(await evaluate("document.querySelector('.saved-query:first-child > button').textContent"), '木木水');
    assert.equal(await evaluate("localStorage.getItem('bishun-saved-queries-v2')"), null);
    checks.push('legacy migration and edit cancellation do not write');

    await click('.saved-query:first-child [data-action="edit"]');
    await fill('#savedName', '今天的作业');
    await fill('#savedText', '木水木');
    await click('#editSavedForm [type="submit"]');
    await wait("!document.querySelector('#editSavedDialog').open");
    await wait("document.activeElement.dataset.action === 'edit'");
    await click('.saved-query:first-child [aria-label^="下移"]');
    await command('Page.reload');
    await wait("document.querySelector('#savedCount')?.textContent === '2'");
    await click('#savedQueries summary');
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.saved-query > button')).map(el=>el.textContent)"), ['心', '今天的作业木水木']);
    checks.push('names, query editing and ordering survive reload');

    await click('#manageSavedBtn');
    await click('.saved-query:first-child [data-action="edit"]');
    await fill('#savedText', '木水木');
    await click('#editSavedForm [type="submit"]');
    assert.equal(await evaluate("document.querySelector('#editSavedError').hidden"), false);
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await wait("!document.querySelector('#editSavedDialog').open");
    checks.push('duplicate edits stay in dialog; Escape cancels');

    const fixture = path.join(temp, 'import.json');
    await fs.writeFile(fixture, JSON.stringify({ type: 'bishun-wordlists', version: 1, items: [
        { query: '木水木', name: 'duplicate' }, { query: '家我线', name: '新作业' }, { query: 'abc', name: '' }
    ] }));
    const upload = async () => {
        const { root } = await command('DOM.getDocument');
        const { nodeId } = await command('DOM.querySelector', { nodeId: root.nodeId, selector: '#importSavedFile' });
        await command('DOM.setFileInputFiles', { nodeId, files: [fixture] });
        await wait("document.querySelector('#importSavedDialog').open");
    };
    await upload();
    assert.match(await evaluate("document.querySelector('#importSavedSummary').textContent"), /可导入 1 条，重复 1 条，无效 1 条/);
    await click('#cancelImportSavedBtn');
    assert.equal(await evaluate("document.querySelector('#savedCount').textContent"), '2');
    await upload();
    await click('#confirmImportSavedBtn');
    assert.equal(await evaluate("document.querySelector('#savedCount').textContent"), '3');
    checks.push('file import previews conflicts; cancel preserves data; explicit confirm adds only valid new items');

    await command('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: temp });
    await click('#exportSavedBtn');
    const download = path.join(temp, '笔顺-生字本.json');
    let exported;
    for (let attempt = 0; attempt < 50; attempt++) {
        try { exported = JSON.parse(await fs.readFile(download, 'utf8')); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.equal(exported?.items.length, 3);
    assert.deepEqual(exported.items[1], { query: '木水木', name: '今天的作业' });
    checks.push('actual JSON download includes names and current order');

    await command('Emulation.setDeviceMetricsOverride', { width: 320, height: 820, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await click('.saved-query:nth-child(2) [data-action="edit"]');
    assert.equal(await evaluate("document.querySelector('#editSavedDialog').scrollWidth <= document.querySelector('#editSavedDialog').clientWidth"), true);
    await browser.screenshot('/private/tmp/bishun-library-mobile.png');
    await click('#cancelEditSavedBtn');
    await click('#manageSavedBtn');
    await click('.saved-query:nth-child(2) > button');
    await wait("document.querySelector('#characterCanvas').getAttribute('aria-label')?.includes('木') && !document.querySelector('#playBtn').disabled");
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"), '播放');
    assert.equal(browser.exceptions.length, 0);
    checks.push('320px management and dialog fit; opening a named list queries without autoplay');
    console.log(JSON.stringify({ browser: browser.version, checks, exceptions: browser.exceptions }, null, 2));
} finally {
    await browser.close();
    await fs.rm(temp, { recursive: true, force: true });
}
