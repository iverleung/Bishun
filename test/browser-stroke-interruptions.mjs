import assert from 'node:assert/strict';
import {openBrowser} from './helpers/cdp.mjs';
const [cdp='http://127.0.0.1:9224',url='http://127.0.0.1:5189/']=process.argv.slice(2);
const browser=await openBrowser(cdp,url);
try{
    const {command,evaluate,wait,click,fill}=browser;
    await command('Page.addScriptToEvaluateOnNewDocument',{source:`window.voiceStarts=0;const create=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(...args){const source=create.apply(this,args),start=source.start;source.start=function(...args){voiceStarts++;return start.apply(this,args);};return source;};`});
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent==='请输入汉字'");
    const query=async text=>{await fill('#query',text);await click('#searchForm [type=submit]');await wait("!document.querySelector('#playBtn').disabled");};
    await query('鼎');await click('#playBtn');await wait('voiceStarts>0');
    await query('互');const changed=await evaluate('voiceStarts');
    await new Promise(resolve=>setTimeout(resolve,200));
    assert.equal(await evaluate('voiceStarts'),changed);assert.equal(await evaluate("document.querySelector('#playBtn').textContent"),'播放');
    await click('#playBtn');await wait(`voiceStarts>${changed}`);
    const {targetInfo}=await command('Target.getTargetInfo');
    const {targetId}=await command('Target.createTarget',{url:'about:blank',browserContextId:targetInfo.browserContextId});
    try{
        await command('Target.activateTarget',{targetId});await wait("document.visibilityState==='hidden'");
        const paused=await evaluate('voiceStarts');
        await new Promise(resolve=>setTimeout(resolve,200));assert.equal(await evaluate('voiceStarts'),paused);
    }finally{await command('Target.closeTarget',{targetId});await browser.activate();}
    assert.equal(await evaluate("document.querySelector('#playBtn').textContent"),'继续');
    await click('#playBtn');await wait("document.querySelector('#playBtn').textContent==='重播'",20000);
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent==='请输入汉字'");
    await command('Network.setCacheDisabled',{cacheDisabled:true});
    await command('Network.setBlockedURLs',{urls:['*/audio/strokes/v1/stroke-791ea5d94119.mp3']});
    await query('鼎');await click('#playBtn');await wait("document.querySelector('#playBtn').textContent==='重播'",30000);
    assert.match(await evaluate("document.querySelector('#status').textContent"),/第 6 笔.*录音加载失败/);
    await command('Network.setBlockedURLs',{urls:[]});await query('鼎');
    const before=await evaluate('voiceStarts');await click('#playBtn');await wait("document.querySelector('#playBtn').textContent==='重播'",30000);
    assert.equal(await evaluate('voiceStarts'),before+12);
    assert.equal(await evaluate("document.querySelector('#status').textContent"),'播放完成');
    assert.deepEqual(browser.exceptions,[]);
    console.log('PASS: rapid query cancels old stroke/audio; real background pauses without auto-resume; new recording failure warns at stroke 6 and recovers with all 12 voices');
}finally{await browser.close();}
