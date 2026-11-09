import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openBrowser } from './helpers/cdp.mjs';

const [cdpUrl='http://127.0.0.1:9224',pageUrl='http://192.168.6.169:5188/']=process.argv.slice(2);
const checks=[];
const decoder=await fs.readFile(new URL(import.meta.resolve('jsqr')),'utf8');
const qrRequests=browser=>browser.requests.filter(url=>/\/share-qr-[^/]+\.js/.test(url));
async function run(scenario) {
    const browser=await openBrowser(cdpUrl,pageUrl);
    try { await scenario(browser);assert.deepEqual(browser.exceptions,[]); }
    finally { await browser.close(); }
}
async function openShare(browser,query='木水木') {
    await browser.fill('#query',query);await browser.click('#searchForm [type="submit"]');
    await browser.wait("!document.querySelector('#playBtn').disabled");
    await browser.click('#menuBtn');await browser.click('#shareBtn');
}
async function decode(browser) {
    await browser.wait("document.querySelector('#shareQrImage').complete && document.querySelector('#shareQrImage').naturalWidth > 0 && !document.querySelector('#saveShareQr').hidden");
    return browser.evaluate(`(() => {
        const image=document.querySelector('#shareQrImage'),canvas=document.createElement('canvas');
        canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const context=canvas.getContext('2d');context.drawImage(image,0,0);
        return jsQR(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height)?.data;
    })()`);
}
await run(async browser=>{
    const {click,evaluate,wait,command}=browser;
    await evaluate(decoder+';true');
    await openShare(browser);
    assert.equal(qrRequests(browser).length,0);
    assert.equal(await evaluate("document.querySelector('#shareQrPanel').hidden"),true);
    await click('#shareQrBtn');
    assert.equal(await evaluate("document.querySelector('#shareQrBtn').textContent"),'收起二维码');
    let link=await evaluate("document.querySelector('#shareLink').value");
    assert.equal(await decode(browser),link);
    await click('#shareGroup');
    link=await evaluate("document.querySelector('#shareLink').value");
    assert.equal(new URLSearchParams(new URL(link).hash.slice(1)).get('q'),'木水木');
    assert.equal(await decode(browser),link);
    assert.equal(await evaluate("document.querySelector('#saveShareQr').href === document.querySelector('#shareQrImage').src"),true);
    checks.push('optional local module loads only on request; independent decoder reads exact current/group URLs and retained duplicates');

    const directory=await fs.mkdtemp('/private/tmp/bishun-share-qr-download-');
    await command('Page.setDownloadBehavior',{behavior:'allow',downloadPath:directory});
    await click('#saveShareQr');
    let bytes;
    const deadline=Date.now()+5000;
    while(!bytes) {
        try { bytes=await fs.readFile(`${directory}/汉字笔顺-二维码.png`); }
        catch(error) { if(Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,50)); }
    }
    const source=await evaluate("document.querySelector('#shareQrImage').src");
    assert.deepEqual(bytes,Buffer.from(source.split(',')[1],'base64'));
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    checks.push('save image downloads a real PNG whose bytes match the independently decoded display image');
    await command('Emulation.setDeviceMetricsOverride',{width:320,height:820,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate("document.querySelector('#shareDialog').scrollWidth <= document.querySelector('#shareDialog').clientWidth"),true);
    await browser.screenshot('/private/tmp/bishun-share-qr-mobile.png');
    await click('#shareQrBtn');
    assert.equal(await evaluate("document.querySelector('#shareQrPanel').hidden && !document.querySelector('#saveShareQr').hasAttribute('href')"),true);
    await click('#closeShareBtn');await click('#closeMenuBtn');
    await openShare(browser,'木'+'𠮷'.repeat(19));
    await click('#shareGroup');await click('#shareQrBtn');
    link=await evaluate("document.querySelector('#shareLink').value");
    assert.equal(await decode(browser),link);
    assert.equal(Array.from(new URLSearchParams(new URL(link).hash.slice(1)).get('q')).length,20);
    assert.equal(qrRequests(browser).length,1);
    await click('#closeShareBtn');await click('#closeMenuBtn');
    await openShare(browser,'心');
    assert.equal(await evaluate("document.querySelector('#shareGroupOption').getClientRects().length"),0);
    await click('#shareQrBtn');
    assert.equal(await decode(browser),await evaluate("document.querySelector('#shareLink').value"));
    assert.ok(browser.requests.filter(url=>/^https?:/.test(url)).every(url=>new URL(url).origin===new URL(pageUrl).origin));
    checks.push('320px dialog fits, hiding clears image/save link, 20 characters including supplementary Han decode; all HTTP requests same-origin');
});

await run(async browser=>{
    const {command,click,wait,evaluate}=browser;
    await evaluate(decoder+';true');await openShare(browser);
    await command('Network.setCacheDisabled',{cacheDisabled:true});
    await command('Fetch.enable',{patterns:[{urlPattern:'*share-qr-*.js',requestStage:'Request'}]});
    await click('#shareQrBtn');
    await wait("document.querySelector('#shareFeedback').textContent === '正在生成二维码…'");
    await click('#shareGroup');
    assert.equal(await evaluate("document.querySelector('#shareQrImage').hasAttribute('src')"),false);
    await click('#closeShareBtn');
    await command('Fetch.disable');
    await wait("performance.getEntriesByType('resource').some(entry=>/\\/share-qr-[^/]+\\.js/.test(entry.name))");
    await click('#shareBtn');
    assert.equal(await evaluate("document.querySelector('#shareQrPanel').hidden"),true);
    await click('#shareQrBtn');
    assert.equal(await decode(browser),await evaluate("document.querySelector('#shareLink').value"));
    checks.push('scope change clears pending image; closing cancels late rendering; reopening starts with current character and hidden QR');
});

await run(async browser=>{
    const {command,click,wait,evaluate}=browser;
    await openShare(browser);
    await command('Network.setCacheDisabled',{cacheDisabled:true});
    await command('Network.setBlockedURLs',{urls:['*share-qr-*.js']});
    await click('#shareQrBtn');
    await wait("document.querySelector('#shareFeedback').textContent === '二维码暂不可用，可复制链接'");
    assert.equal(await evaluate("document.querySelector('#shareQrPanel').hidden && !document.querySelector('#copyShareBtn').disabled"),true);
    await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined})");
    await click('#copyShareBtn');
    await wait("document.querySelector('#shareFeedback').textContent === '请复制上方链接'");
    assert.equal(await evaluate('document.activeElement.id'),'shareLink');
    checks.push('failed optional module offers clear fallback and keeps manual link copying usable');
});

await run(async browser=>{
    const {command,click,wait,evaluate}=browser;
    await openShare(browser);
    await command('Network.setCacheDisabled',{cacheDisabled:true});
    await command('Fetch.enable',{patterns:[{urlPattern:'*share-qr-*.js',requestStage:'Request'}]});
    await click('#shareQrBtn');
    await wait("document.querySelector('#shareFeedback').textContent === '二维码暂不可用，可复制链接'");
    await command('Fetch.disable');
    await wait("performance.getEntriesByType('resource').some(entry=>/\\/share-qr-[^/]+\\.js/.test(entry.name))");
    assert.equal(await evaluate("document.querySelector('#shareQrPanel').hidden"),true);
    await click('#shareQrBtn');
    await wait("document.querySelector('#shareQrImage').naturalWidth > 0");
    checks.push('module wait is bounded; late result cannot reappear, and a new request can reuse the recovered import');
});
console.log(JSON.stringify({checks,scope:'isolated Chrome contexts, independent jsQR decoding, real PNG download and injected module faults; not a physical camera scan'},null,2));
