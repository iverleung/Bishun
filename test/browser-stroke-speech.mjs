import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openBrowser} from './helpers/cdp.mjs';
import {v3} from '../src/engine/recognition/v3.js';

const [cdp='http://127.0.0.1:9224',url='http://127.0.0.1:5189/']=process.argv.slice(2);
const manifest=JSON.parse(await fs.readFile('public/audio/strokes/v1/manifest.json','utf8'));
const browser=await openBrowser(cdp,url);
try {
    // Observe real decoded buffers and starts; do not replace audio fetching or playback.
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`
        window.strokeAudioEvents=[];window.decodedStrokes=new WeakMap();
        const decode=AudioContext.prototype.decodeAudioData;
        AudioContext.prototype.decodeAudioData=async function(bytes,...args){
            const copy=bytes.slice(0);const buffer=await decode.call(this,bytes,...args);
            const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',copy)),n=>n.toString(16).padStart(2,'0')).join('');
            decodedStrokes.set(buffer,hash);return buffer;
        };
        const create=AudioContext.prototype.createBufferSource;
        AudioContext.prototype.createBufferSource=function(...args){
            const source=create.apply(this,args);const start=source.start;
            source.start=function(...args){
                strokeAudioEvents.push({name:document.querySelector('#strokeName').textContent,sha256:decodedStrokes.get(this.buffer)});
                return start.apply(this,args);
            };return source;
        };
    `});
    await browser.command('Page.reload');await browser.wait("document.querySelector('#status')?.textContent==='请输入汉字'");
    const checks=[];
    for(const character of ['口','游']) {
        await browser.fill('#query',character);await browser.click('#searchForm [type=submit]');
        await browser.wait("!document.querySelector('#playBtn').disabled");
        await browser.click('#menuBtn');await browser.click('[name=mode][value=explain]');await browser.click('#closeMenuBtn');
        await browser.evaluate('strokeAudioEvents=[]');await browser.click('#playBtn');
        await browser.wait("document.querySelector('#playBtn').textContent==='重播'",30000);
        const names=v3.getStrokeNames(character);
        const expected=names.map(name=>({name,sha256:manifest.items.find(item=>item.text===name)?.sha256}));
        assert.ok(expected.every(item=>item.sha256));
        assert.deepEqual(await browser.evaluate('strokeAudioEvents'),expected);
        checks.push(`${character}: every one of ${names.length} strokes starts its exact recording in order`);
    }
    assert.deepEqual(browser.exceptions,[]);
    console.log(JSON.stringify({browser:browser.version,checks,exceptions:browser.exceptions},null,2));
} finally {await browser.close();}
