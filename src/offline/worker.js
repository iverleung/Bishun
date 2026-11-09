import { OfflinePacks } from './packs.js';

const packs = new OfflinePacks({ buildId: __OFFLINE_VERSION__, origin: self.location.origin });
const jobs = new Map();
let mutations = Promise.resolve();
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
// Never reload a client or delete a previous pack on worker activation.
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
    const { type,id,payload } = event.data || {};
    if (type === 'CANCEL') { jobs.get(id)?.abort();return; }
    const port = event.ports[0];
    if (!port || typeof id !== 'string') return;
    const reply = data => port.postMessage(data);
    const controller = new AbortController();
    jobs.set(id,controller);
    const operation = async () => {
        try {
            if (controller.signal.aborted) throw new DOMException('已取消','AbortError');
            let result;
            if (type === 'LIST') result = { buildId:__OFFLINE_VERSION__,packs:await packs.list({verify:true}) };
            else if (type === 'SAVE') result = await packs.save(payload,{signal:controller.signal,progress:progress=>reply({progress})});
            else if (type === 'DELETE') result = await packs.remove(payload.cacheName);
            else throw new Error('离线操作无效');
            reply({result:result ?? null});
        } catch(error) { reply({error:error.name === 'AbortError' ? '已取消，旧字单保持不变' : /[\u4e00-\u9fff]/.test(error.message)?error.message:'离线操作未完成，请检查浏览器存储空间后重试'}); }
        finally { jobs.delete(id);port.close(); }
    };
    if (type === 'SAVE' || type === 'DELETE') {
        mutations = mutations.then(operation,operation);
        event.waitUntil(mutations);
    } else event.waitUntil(operation());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/legacy/') || url.pathname.startsWith('/offline-')) return;
    event.respondWith((async () => {
        const readSaved = () => packs.match(request).catch(() => null);
        const controller = new AbortController();
        const timer = setTimeout(()=>controller.abort(),2000);
        try {
            // Versioned glyph/audio and hashed assets are immutable snapshots.
            // Serve saved resources immediately, even on a stalled connection.
            if (request.mode !== 'navigate') {
                const cached = await readSaved();
                if (cached) return cached;
            }
            const response = await fetch(request,{signal:controller.signal});
            if (response.ok) return response;
            const cached = await readSaved();
            return cached || response;
        } catch {
            const cached = await readSaved();
            if (cached) return cached;
            if (request.mode === 'navigate') return new Response('<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>离线字单暂不可用</title><p>还没有完整的离线字单，请联网后重新打开。</p></html>',{status:503,headers:{'content-type':'text/html; charset=utf-8'}});
            return new Response('此资源未离线保存',{status:503,headers:{'content-type':'text/plain; charset=utf-8','X-Bishun-Offline':'missing'}});
        } finally { clearTimeout(timer); }
    })());
});
