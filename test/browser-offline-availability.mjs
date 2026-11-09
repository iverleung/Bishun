import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';

const [cdp='http://127.0.0.1:9224',lan='http://192.168.6.169:5188/',local='http://localhost:5189/']=process.argv.slice(2);
const checks=[];
for(const [url,secure] of [[lan,false],[local,true]]) {
    const browser=await openBrowser(cdp,url,{ready:"document.readyState === 'complete' && document.visibilityState === 'visible'"});
    try {
        await browser.fill('#query','木');await browser.click('#searchForm [type="submit"]');
        await browser.wait("!document.querySelector('#playBtn').disabled");
        await browser.click('#menuBtn');await browser.click('#offlineSection summary');
        if(secure) {
            await browser.wait("!document.querySelector('#saveOfflineBtn').disabled");
            assert.equal(await browser.evaluate("(async()=> (await caches.keys()).filter(key=>key.startsWith('bishun-offline-pack-v1-')).length)()"),0);
            checks.push('existing localhost preview enables explicit saving without automatically downloading a pack');
        } else {
            await browser.wait("document.querySelector('#offlineMessage').textContent.includes('HTTPS')");
            assert.equal(await browser.evaluate("document.querySelector('#saveOfflineBtn').disabled"),true);
            checks.push('ordinary LAN HTTP displays the HTTPS requirement and never reports offline readiness');
        }
        assert.deepEqual(browser.exceptions,[]);
        await browser.command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        assert.equal(await browser.evaluate("document.querySelector('#settings').scrollWidth <= document.querySelector('#settings').clientWidth"),true);
        await browser.screenshot(`/private/tmp/bishun-offline-${secure?'localhost':'http'}.png`);
    } catch(error) {console.error({url,exceptions:browser.exceptions,requests:browser.responses,state:await browser.evaluate("({title:document.title,status:document.querySelector('#status')?.textContent})")});throw error;} finally {await browser.close();}
}
console.log(JSON.stringify({checks},null,2));
