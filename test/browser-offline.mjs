import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { openBrowser } from './helpers/cdp.mjs';
import { practiceStroke } from './helpers/practice-input.mjs';

const [cdpUrl='http://127.0.0.1:9224']=process.argv.slice(2);
const root=path.resolve('dist');
const state={offline:false,fail:'',hold:'',held:0,blocked:0,requests:[],overrides:new Map()};
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.txt':'text/plain','.png':'image/png','.mp3':'audio/mpeg'};
const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');const pathname=decodeURIComponent(url.pathname);
    state.requests.push(pathname);
    if(state.offline){state.blocked++;req.socket.destroy();return;}
    if(pathname===state.fail){res.writeHead(503,{'content-type':'text/plain'});res.end('injected failure');return;}
    if(pathname===state.hold){state.held++;return;}
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(400);res.end();return;}
    try {
        const bytes=state.overrides.get(pathname) || await fs.readFile(file);
        res.writeHead(200,{'content-type':mime[path.extname(file)] || 'text/plain','cache-control':'no-store','content-length':bytes.length});res.end(bytes);
    }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
let browser;
const checks=[];
try {
    browser=await openBrowser(cdpUrl,url);
    const {command,evaluate,wait,click,fill}=browser;
    await command('Network.setCacheDisabled',{cacheDisabled:true});
    async function query(text,available=true){await fill('#query',text);await click('#searchForm [type="submit"]');if(available)await wait("!document.querySelector('#playBtn').disabled");}
    async function menu(){if(!await evaluate("document.querySelector('#settings').open"))await click('#menuBtn');}
    async function offline(){await menu();if(!await evaluate("document.querySelector('#offlineSection').open"))await click('#offlineSection summary');await wait("!document.querySelector('#offlineMessage').textContent.includes('正在检查') && (document.querySelector('#offlineList').children.length > 0 || document.querySelector('#offlineMessage').textContent === '尚未保存离线字单')");}
    const saved=()=>wait("document.querySelector('#offlineMessage').textContent === '已保存，可离线使用' && document.querySelector('#cancelOfflineBtn').hidden");
    const metadata=()=>evaluate("(async()=>{const names=(await caches.keys()).filter(name=>name.startsWith('bishun-offline-pack-v1-'));return Promise.all(names.map(async cacheName=>{const response=await(await caches.open(cacheName)).match('/__bishun_offline_pack__');return response?{...await response.json(),cacheName}:null;}));})()");
    await query('木水木');
    assert.equal(await evaluate('(async()=> (await navigator.serviceWorker.getRegistrations()).length)()'),0);
    await offline();
    assert.equal((await metadata()).length,0);
    await click('#saveOfflineBtn');await saved();
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await browser.screenshot('/private/tmp/bishun-offline-saved.png');
    await command('Emulation.clearDeviceMetricsOverride');
    let records=await metadata();assert.equal(records.length,1);assert.equal(records[0].query,'木水木');
    assert.equal(records[0].files.filter(file=>file.startsWith('/audio/readings/') && file.endsWith('.mp3')).length,2);
    assert.equal(records[0].files.filter(file=>/\/characters\/.*\.json$/.test(file) && !file.endsWith('manifest.json')).length,2);
    assert.equal(records[0].files.filter(file=>file.startsWith('/audio/strokes/') && file.endsWith('.mp3')).length,6);
    assert.ok(records[0].files.every(file=>!file.includes('/legacy/')));
    checks.push('explicit save creates one complete pack with only two unique glyphs, six stroke recordings, two syllable samples and the application shell');
    await click('[name="mode"][value="explain"]');await click('#closeMenuBtn');
    const responseStart=browser.responses.length;
    const requestStart=state.requests.length;
    state.offline=true;
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    assert.equal(await evaluate('Boolean(navigator.serviceWorker.controller)'),true);
    await offline();await click('#offlineList .offline-open');
    await wait("document.querySelector('#wordPosition').textContent === '1 / 3' && !document.querySelector('#playBtn').disabled");
    await click('[data-reading="mù"]');await wait("Boolean(document.querySelector('.reading-button.is-speaking'))");
    await wait("!document.querySelector('.reading-button.is-speaking')");
    assert.equal(await evaluate("document.querySelector('#readingFeedback').textContent"),'');
    assert.ok(browser.responses.slice(responseStart).some(item=>item.url.includes('/audio/readings/') && item.status===200));
    await click('#playBtn');await wait("document.querySelector('#playBtn').textContent === '重播'",20000);
    assert.equal(await evaluate("document.querySelector('#status').textContent"),'播放完成');
    assert.ok(browser.responses.slice(responseStart).some(item=>item.url.endsWith('.mp3') && item.status===200));
    assert.ok(state.blocked>0);
    await menu();await click('#practiceBtn');await wait("!document.querySelector('#practiceHintBtn').disabled && document.querySelector('#practiceHintBtn').textContent === '提示下一笔'");
    for(let index=0;index<4;index++){await practiceStroke(browser,'木',index);await wait(`document.querySelector('#practiceProgress').textContent === '${index+1} / 4 笔'`);}
    await wait("document.querySelector('#practiceFeedback').textContent === '这一字写完了'");
    assert.equal(state.requests.slice(requestStart).some(path=>path.endsWith('.mp3') || /\/characters\/.*\.json$/.test(path)),false);
    await query('心',false);await wait("!document.querySelector('#retryBtn').hidden");
    assert.match(await evaluate("document.querySelector('#stageMessageText').textContent"),/未离线保存/);
    checks.push('after real server disconnection and a fresh reload, saved query animates, decodes/plays stroke and syllable audio and accepts handwriting; unsaved glyph is explicitly unavailable');

    state.offline=false;
    await offline();
    const before=(await metadata())[0].cacheName;
    const catalog=JSON.parse(await fs.readFile('public/audio/strokes/v1/manifest.json','utf8'));
    state.fail=catalog.items.find(item=>item.text==='横').url;
    await click('#offlineList .offline-row-actions button:first-child');
    await wait("document.querySelector('#offlineMessage').textContent.includes('失败') && document.querySelector('#cancelOfflineBtn').hidden");
    assert.deepEqual((await metadata()).map(item=>item?.cacheName),[before]);state.fail='';
    state.hold='/characters/2.0.1/木.json';
    await click('#offlineList .offline-row-actions button:first-child');
    const deadline=Date.now()+10000;while(!state.held){if(Date.now()>deadline)throw new Error('Held glyph not requested');await new Promise(resolve=>setTimeout(resolve,25));}
    await click('#cancelOfflineBtn');
    await wait("document.querySelector('#offlineMessage').textContent.includes('已取消') && document.querySelector('#cancelOfflineBtn').hidden");
    assert.deepEqual((await metadata()).map(item=>item?.cacheName),[before]);state.hold='';
    await click('#offlineList .offline-row-actions button:first-child');await saved();
    assert.notEqual((await metadata())[0].cacheName,before);
    assert.equal((await metadata()).length,1);
    checks.push('failed and cancelled updates preserve the old pack, clean staging, and a subsequent successful update replaces it atomically');

    await click('#closeMenuBtn');await query('一地一');await offline();await click('#saveOfflineBtn');await saved();
    const expanded=(await metadata()).find(item=>item.query==='一地一');
    assert.equal(expanded.files.filter(file=>file.startsWith('/audio/readings/') && file.endsWith('.mp3')).length,2);
    state.offline=true;await command('Page.reload');await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    await offline();await click('#offlineList .offline-row:first-child .offline-open');
    await wait("document.querySelector('#currentQuery').textContent==='一地一' && !document.querySelector('#playBtn').disabled");
    for (const reading of ['yī','dì']) {
        if (reading==='dì') {await click('#nextCharBtn');await wait("!document.querySelector('#playBtn').disabled");}
        await click(`[data-reading="${reading}"]`);await wait("Boolean(document.querySelector('.reading-button.is-speaking'))");
        await wait("!document.querySelector('.reading-button.is-speaking')");
        assert.equal(await evaluate("document.querySelector('#readingFeedback').textContent"),'');
    }
    assert.equal(await evaluate("document.querySelector('[data-reading=de]')"),null);
    assert.ok(await evaluate("(async()=> (await(await fetch('/audio/readings/v1/SOURCE.html')).text()).includes('creativecommons.org/licenses/by-sa/3.0/'))()"));
    state.offline=false;await offline();await click('#offlineList .offline-row:first-child .offline-row-actions button:last-child');
    await wait("document.querySelector('#offlineList').children.length===1");
    checks.push('new batch deduplicates 一地一 to two syllables; both play after cold offline reload, neutral de stays unavailable and attribution is cached');

    await click('#closeMenuBtn');await query('胡言');await offline();await click('#saveOfflineBtn');await saved();
    const huYan=(await metadata()).find(item=>item.query==='胡言');
    const huYanCatalog=JSON.parse(await fs.readFile('resources/reading-audio-catalog.json','utf8'));
    const huYanFiles=['hú','yán'].map(r=>huYanCatalog.items.find(item=>item.reading===r).url);
    assert.ok(huYanFiles.every(file=>huYan.files.includes(file)));
    assert.ok(!huYan.files.some(file=>file.endsWith('/reading-d75d96edcb37.mp3')||file.endsWith('/reading-fb916db93db6.mp3')));
    const huYanResponses=browser.responses.length;const huYanRequests=state.requests.length;
    state.offline=true;await command('Page.reload');await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    await offline();await click('#offlineList .offline-row:first-child .offline-open');
    await wait("document.querySelector('#currentQuery').textContent==='胡言' && !document.querySelector('#playBtn').disabled");
    for(const reading of ['hú','yán']){
        if(reading==='yán'){await click('#nextCharBtn');await wait("!document.querySelector('#playBtn').disabled");}
        await click(`[data-reading="${reading}"]`);await wait("Boolean(document.querySelector('.reading-button.is-speaking'))");
        await wait("!document.querySelector('.reading-button.is-speaking')");
        assert.equal(await evaluate("document.querySelector('#readingFeedback').textContent"),'');
    }
    assert.ok(huYanFiles.every(file=>browser.responses.slice(huYanResponses).some(response=>response.url.endsWith(file)&&response.status===200)));
    assert.equal(state.requests.slice(huYanRequests).some(path=>path.endsWith('.mp3') || /\/characters\/.*\.json$/.test(path)),false);
    state.offline=false;await offline();await click('#offlineList .offline-row:first-child .offline-row-actions button:last-child');
    await wait("document.querySelector('#offlineList').children.length===1");
    checks.push('胡/言 offline packs contain and cold-play only the replacement URLs, with no rejected audio or server media request');

    await click('#closeMenuBtn');await query('青晴请');await offline();await click('#saveOfflineBtn');await saved();
    const qing=(await metadata()).find(item=>item.query==='青晴请');
    assert.equal(qing.files.filter(file=>file.startsWith('/audio/readings/')&&file.endsWith('.mp3')).length,3);
    const qingResponses=browser.responses.length;
    const qingRequests=state.requests.length;
    state.offline=true;await command('Page.reload');await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    await offline();await click('#offlineList .offline-row:first-child .offline-open');
    await wait("document.querySelector('#currentQuery').textContent==='青晴请' && !document.querySelector('#playBtn').disabled");
    for(const reading of ['qīng','qíng','qǐng']){
        if(reading!=='qīng'){await click('#nextCharBtn');await wait("!document.querySelector('#playBtn').disabled");}
        await click(`[data-reading="${reading}"]`);await wait("Boolean(document.querySelector('.reading-button.is-speaking'))");
        await wait("!document.querySelector('.reading-button.is-speaking')");
        assert.equal(await evaluate("document.querySelector('#readingFeedback').textContent"),'');
    }
    const qingCatalog=JSON.parse(await fs.readFile('resources/reading-audio-catalog.json','utf8'));
    assert.ok(['qīng','qíng','qǐng'].every(reading=>browser.responses.slice(qingResponses).some(response=>response.url.endsWith(qingCatalog.items.find(item=>item.reading===reading).url)&&response.status===200)));
    assert.equal(state.requests.slice(qingRequests).some(path=>path.endsWith('.mp3') || /\/characters\/.*\.json$/.test(path)),false);
    state.offline=false;await offline();await click('#offlineList .offline-row:first-child .offline-row-actions button:last-child');
    await wait("document.querySelector('#offlineList').children.length===1");
    checks.push('青晴请 saves three distinct tone recordings and plays all three after a cold offline reload without server media requests');

    await click('#closeMenuBtn');await query('女子了');await offline();await click('#saveOfflineBtn');await saved();
    const writing=(await metadata()).find(item=>item.query==='女子了');
    assert.equal(writing.files.filter(file=>file.startsWith('/audio/readings/')&&file.endsWith('.mp3')).length,3);
    const writingResponses=browser.responses.length;
    const writingRequests=state.requests.length;
    state.offline=true;await command('Page.reload');await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    await offline();await click('#offlineList .offline-row:first-child .offline-open');
    await wait("document.querySelector('#currentQuery').textContent==='女子了' && !document.querySelector('#playBtn').disabled");
    for(const reading of ['nǚ','zǐ','zì']){
        if(reading==='zǐ'){await click('#nextCharBtn');await wait("!document.querySelector('#playBtn').disabled");}
        await click(`[data-reading="${reading}"]`);await wait("Boolean(document.querySelector('.reading-button.is-speaking'))");
        await wait("!document.querySelector('.reading-button.is-speaking')");
        assert.equal(await evaluate("document.querySelector('#readingFeedback').textContent"),'');
    }
    await click('#nextCharBtn');await wait("!document.querySelector('#playBtn').disabled");
    assert.equal(await evaluate("document.querySelector('#characterReadings').textContent"),'le / liǎo');
    assert.equal(await evaluate("document.querySelectorAll('.reading-button').length"),0);
    const writingCatalog=JSON.parse(await fs.readFile('resources/reading-audio-catalog.json','utf8'));
    assert.ok(['nǚ','zǐ','zì'].every(reading=>browser.responses.slice(writingResponses).some(response=>response.url.endsWith(writingCatalog.items.find(item=>item.reading===reading).url)&&response.status===200)));
    assert.equal(state.requests.slice(writingRequests).some(path=>path.endsWith('.mp3') || /\/characters\/.*\.json$/.test(path)),false);
    state.offline=false;await offline();await click('#offlineList .offline-row:first-child .offline-row-actions button:last-child');
    await wait("document.querySelector('#offlineList').children.length===1");
    checks.push('女子了 saves and cold-offline plays nǚ plus distinct zǐ/zì; neutral le stays text without borrowing another tone');

    await click('#closeMenuBtn');await query('妈马妈');await offline();await click('#saveOfflineBtn');await saved();
    const family=(await metadata()).find(item=>item.query==='妈马妈');
    assert.equal(family.files.filter(file=>file.startsWith('/audio/readings/')&&file.endsWith('.mp3')).length,2);
    const familyResponses=browser.responses.length;
    const familyRequests=state.requests.length;
    state.offline=true;await command('Page.reload');await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    await offline();await click('#offlineList .offline-row:first-child .offline-open');
    await wait("document.querySelector('#currentQuery').textContent==='妈马妈' && !document.querySelector('#playBtn').disabled");
    for(const reading of ['mā','mǎ']){
        if(reading==='mǎ'){await click('#nextCharBtn');await wait("!document.querySelector('#playBtn').disabled");}
        await click(`[data-reading="${reading}"]`);await wait("Boolean(document.querySelector('.reading-button.is-speaking'))");
        await wait("!document.querySelector('.reading-button.is-speaking')");
        assert.equal(await evaluate("document.querySelector('#readingFeedback').textContent"),'');
    }
    const readings=JSON.parse(await fs.readFile('resources/reading-audio-catalog.json','utf8'));
    assert.ok(['mā','mǎ'].every(reading=>browser.responses.slice(familyResponses).some(response=>response.url.endsWith(readings.items.find(item=>item.reading===reading).url)&&response.status===200)));
    assert.equal(state.requests.slice(familyRequests).some(path=>path.endsWith('.mp3') || /\/characters\/.*\.json$/.test(path)),false);
    state.offline=false;await offline();await click('#offlineList .offline-row:first-child .offline-row-actions button:last-child');
    await wait("document.querySelector('#offlineList').children.length===1");
    checks.push('妈马妈 deduplicates new mā/mǎ recordings, preserves word order and plays both tones after a cold offline reload without server media requests');

    await click('#closeMenuBtn');await query('专朵奶阳');await offline();await click('#saveOfflineBtn');await saved();
    const grade1=(await metadata()).find(item=>item.query==='专朵奶阳');
    const added=['竖折撇','横折弯','横折折折钩','横撇弯钩'].map(name=>catalog.items.find(item=>item.text===name));
    assert.ok(added.every(item=>grade1.files.includes(item.url)));
    const grade1Responses=browser.responses.length;
    const grade1Server=state.requests.length;
    state.offline=true;await command('Page.reload');await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    await offline();await click('#offlineList .offline-row:first-child .offline-open');
    await wait("document.querySelector('#currentQuery').textContent==='专朵奶阳' && !document.querySelector('#playBtn').disabled");
    await menu();await click('#groupMode');await click('#closeMenuBtn');await click('#playBtn');
    await wait("document.querySelector('#wordPosition').textContent==='4 / 4' && document.querySelector('#playBtn').textContent==='重播'",45000);
    assert.equal(await evaluate("document.querySelector('#status').textContent"),'播放完成');
    assert.ok(added.every(item=>browser.responses.slice(grade1Responses).some(response=>response.url.endsWith(item.url)&&response.status===200)));
    assert.equal(state.requests.slice(grade1Server).some(path=>path.endsWith('.mp3') || /\/characters\/.*\.json$/.test(path)),false);
    state.offline=false;await menu();await click('#groupMode');await offline();
    await click('#offlineList .offline-row:first-child .offline-row-actions button:last-child');
    await wait("document.querySelector('#offlineList').children.length===1");
    checks.push('专朵奶阳 saves all four newly resolved stroke recordings; a cold offline reload plays the entire group without server audio or glyph requests');

    // A real second worker release, with the same application logic but a new build identity.
    const build=JSON.parse(await fs.readFile('dist/offline-build.json','utf8'));
    const newId='b'.repeat(64);
    const home=Buffer.from((await fs.readFile('dist/index.html','utf8')).replaceAll(build.id,newId));
    const hash=createHash('sha256').update(home).digest('hex');
    state.overrides.set('/',home);state.overrides.set('/index.html',home);
    state.overrides.set('/offline-build.json',Buffer.from(JSON.stringify({...build,id:newId,files:{...build.files,'/':hash,'/index.html':hash}})));
    state.overrides.set('/offline-sw.js',Buffer.from((await fs.readFile('dist/offline-sw.js','utf8')).replaceAll(build.id,newId)));
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    await offline();
    assert.match(await evaluate("document.querySelector('#offlineList').textContent"),/可更新/);
    await evaluate("window.offlineUpdateSentinel='kept'");
    await click('#offlineList .offline-row-actions button:first-child');await saved();
    assert.equal(await evaluate('window.offlineUpdateSentinel'),'kept');
    records=await metadata();assert.equal(records.length,1);assert.equal(records[0].buildId,newId);
    state.offline=true;await command('Page.reload');await wait("document.querySelector('#status')?.textContent === '请输入汉字'");
    assert.equal(await evaluate("document.querySelector('meta[name=offline-build]').content"),newId);
    checks.push('new worker/build updates without reloading the current page; the updated shell survives a subsequent offline reload');

    state.offline=false;
    await offline();await click('#offlineList .offline-open');
    await wait("!document.querySelector('#playBtn').disabled");await menu();await click('#saveQueryBtn');
    const library=await evaluate("localStorage.getItem('bishun-saved-queries-v2')");
    await offline();await click('#offlineList .offline-row-actions button:last-child');
    await wait("document.querySelector('#offlineList').children.length === 0");
    assert.equal(await evaluate("localStorage.getItem('bishun-saved-queries-v2')"),library);
    assert.equal((await metadata()).length,0);
    state.offline=true;await command('Page.reload');await wait("document.title === '离线字单暂不可用'");
    assert.match(await evaluate('document.body.textContent'),/没有完整的离线字单/);
    checks.push('deleting offline resources preserves the saved library; a cold offline page with no complete pack gives a clear message');
    assert.deepEqual(browser.exceptions,[]);
    console.log(JSON.stringify({browser:browser.version,checks,serverRequests:state.requests.length,blockedRequests:state.blocked,exceptions:browser.exceptions},null,2));
} catch(error) {
    if(browser) console.error(await browser.evaluate("({visibility:document.visibilityState,progress:document.querySelector('#practiceProgress')?.textContent,feedback:document.querySelector('#practiceFeedback')?.textContent,hint:document.querySelector('#practiceHintBtn')?.textContent,offline:document.querySelector('#offlineMessage')?.textContent})"));
    throw error;
} finally {
    if(browser)await browser.close();
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
