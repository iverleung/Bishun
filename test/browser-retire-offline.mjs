import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {openBrowser} from './helpers/cdp.mjs';
let legacy=true;
const root=path.resolve('dist');
const server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/offline-sw.js' && legacy){res.setHeader('Content-Type','application/javascript');res.end("self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));");return;}
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(400);res.end();return;}
    try{const bytes=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.txt':'text/plain'})[path.extname(file)]||'application/octet-stream');res.end(bytes);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
    browser=await openBrowser(process.argv[2]||'http://127.0.0.1:9224',`http://127.0.0.1:${server.address().port}/`);
    const {evaluate,command,wait}=browser;
    assert.equal(await evaluate("document.querySelector('#offlineSection')"),null);
    assert.equal(await evaluate("document.querySelector('.reading-source')"),null);
    assert.equal(await evaluate('(async()=> (await navigator.serviceWorker.getRegistrations()).length)()'),0);
    await evaluate("(async()=>{localStorage.setItem('retirement-test','keep');await(await caches.open('bishun-offline-pack-v1-fixture')).put('/sentinel',new Response('keep'));await navigator.serviceWorker.register('/offline-sw.js');})()");
    await wait('navigator.serviceWorker.controller!==null');
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent==='请输入汉字'");
    await wait('(async()=> (await navigator.serviceWorker.getRegistrations()).length===0)()');
    assert.equal(await evaluate("localStorage.getItem('retirement-test')"),'keep');
    assert.equal(await evaluate("(async()=> (await(await caches.open('bishun-offline-pack-v1-fixture')).match('/sentinel')).text())()"),'keep');
    await command('Page.reload');await wait("document.querySelector('#status')?.textContent==='请输入汉字'");
    assert.equal(await evaluate('navigator.serviceWorker.controller'),null);
    legacy=false;
    await evaluate("navigator.serviceWorker.register('/offline-sw.js')");
    await wait('(async()=> (await navigator.serviceWorker.getRegistrations()).length===0)()');
    assert.deepEqual(browser.exceptions,[]);
    console.log('PASS: no offline/source UI; no new registration; old worker retired; existing storage untouched; compatibility worker self-unregisters');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
