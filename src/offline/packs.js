import { CharacterStore, ResourceError } from '../data/character-store.js';
import { characterBase } from '../data/character-data.js';
import { characterReadings } from '../web/character-info.js';
import { readingRecording } from '../data/reading-audio.js';
import { isCharacterQuery } from '../web/history.js';

export const packPrefix = 'bishun-offline-pack-v1-';
export const maxPacks = 10;
export const maxBytes = 20 * 1024 * 1024;
const metaPath = '/__bishun_offline_pack__';
const abortError = () => new DOMException('已取消', 'AbortError');
export async function sha256(bytes) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export class OfflinePacks {
    constructor({ storage = globalThis.caches, fetchImpl = (...args) => fetch(...args), buildId, origin, timeoutMs = 5000, now = () => Date.now() }) {
        Object.assign(this, { storage, fetch: fetchImpl, buildId, origin, timeoutMs, now });
    }
    url(path) { return new URL(path, this.origin).href; }
    async list({ verify = false } = {}) {
        const result = [];
        for (const cacheName of (await this.storage.keys()).filter(name => name.startsWith(packPrefix))) {
            const cache = await this.storage.open(cacheName);
            const response = await cache.match(this.url(metaPath));
            if (!response) continue; // A crashed/cancelled staging cache is never advertised.
            try {
                const meta = await response.json();
                if (meta.schema !== 1 || !isCharacterQuery(meta.query) || !Array.isArray(meta.files) || !Number.isFinite(meta.bytes)) continue;
                if (verify && !(await Promise.all(meta.files.map(path => cache.match(this.url(path))))).every(Boolean)) {
                    result.push({ ...meta, cacheName, broken: true });
                } else result.push({ ...meta, cacheName });
            } catch { /* An incomplete metadata record is not an offline pack. */ }
        }
        return result.sort((a,b) => b.savedAt - a.savedAt);
    }
    async remove(cacheName) {
        if (!cacheName.startsWith(packPrefix)) throw new Error('离线字单无效');
        const entries = await this.list();
        const selected = entries.find(item => item.cacheName === cacheName);
        if (!selected) throw new Error('离线字单已变化，请刷新列表后重试');
        // A worker may have stopped after committing an update but before cleanup.
        for (const item of entries.filter(item => item.query === selected.query)) await this.storage.delete(item.cacheName);
    }
    async request(path, signal) {
        if (signal?.aborted) throw abortError();
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        let timer;
        try {
            return await Promise.race([
                (async () => {
                    const response = await this.fetch(this.url(path), { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
                    if (!response.ok || response.redirected || response.type === 'opaque') throw new Error('资源下载失败，请联网后重试');
                    // Read the body within the same timeout budget as the headers.
                    if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('资源大小超过离线容量限制');
                    const reader = response.body?.getReader();
                    let bytes;
                    if (reader) {
                        const chunks=[];let length=0;
                        while (true) {
                            const {done,value}=await reader.read();if(done)break;
                            length+=value.byteLength;
                            if(length>maxBytes) {controller.abort();throw new Error('资源大小超过离线容量限制');}
                            chunks.push(value);
                        }
                        const merged=new Uint8Array(length);let offset=0;
                        for(const chunk of chunks) {merged.set(chunk,offset);offset+=chunk.byteLength;}
                        bytes=merged.buffer;
                    } else bytes=await response.arrayBuffer();
                    return { bytes, headers: response.headers };
                })(),
                new Promise((resolve,reject) => { timer = setTimeout(() => { controller.abort();reject(new Error('资源下载超时，请重试')); }, this.timeoutMs); })
            ]);
        } catch (error) {
            if (signal?.aborted) throw abortError();
            if (error instanceof TypeError) throw new Error('网络连接失败，请联网后重试');
            throw error;
        } finally { clearTimeout(timer);signal?.removeEventListener('abort',abort); }
    }
    async save({ query, name = '', expectedBuild }, { signal, progress = () => {} } = {}) {
        if (!isCharacterQuery(query) || typeof name !== 'string' || Array.from(name).length > 40) throw new Error('字单格式无效');
        if (expectedBuild !== this.buildId) throw new Error('页面版本已变化，请联网刷新后再保存');
        // All mutations are serialized by the worker. Remove only uncommitted leftovers.
        const existing = await this.list();
        const complete = new Set(existing.map(item => item.cacheName));
        for (const key of (await this.storage.keys()).filter(key => key.startsWith(packPrefix) && !complete.has(key))) {
            const candidate = await this.storage.open(key);
            if (!await candidate.match(this.url(metaPath))) await this.storage.delete(key);
        }
        const others = existing.filter(item => item.query !== query);
        if (new Set(others.map(item => item.query)).size >= maxPacks) throw new Error('最多保存 10 个离线字单，请先删除一些');
        const cacheName = `${packPrefix}${crypto.randomUUID()}`;
        const cache = await this.storage.open(cacheName);
        const staged = new Map();
        let size = 0;
        try {
            const buildResponse = await this.request('/offline-build.json', signal);
            const build = JSON.parse(new TextDecoder().decode(buildResponse.bytes));
            if (build.schema !== 1 || build.id !== this.buildId || !build.files || !build.files['/']) throw new Error('页面版本已变化，请联网刷新后再保存');
            const put = async (path, expectedHash) => {
                const parsed = new URL(path, this.origin);
                if (parsed.origin !== this.origin || !path.startsWith('/') || path.startsWith('//') || parsed.search || parsed.hash) throw new Error('离线资源地址无效');
                if (staged.has(path)) return staged.get(path);
                const resource = await this.request(path, signal);
                if (expectedHash && await sha256(resource.bytes) !== expectedHash) throw new Error('资源校验失败，请重试');
                size += resource.bytes.byteLength;
                if (size + others.reduce((sum,item) => sum + item.bytes,0) > maxBytes) throw new Error('离线资源超过 20 MB，请先删除一些字单');
                const type = resource.headers.get('content-type') || '';
                if ((path === '/' || path.endsWith('.html')) && !type.includes('text/html') || path.endsWith('.js') && !/javascript|ecmascript/.test(type) || path.endsWith('.css') && !type.includes('text/css') || path.endsWith('.json') && !type.includes('application/json')) throw new Error('资源类型无效，请重试');
                const headers = new Headers(resource.headers);
                headers.delete('content-encoding');
                headers.delete('transfer-encoding');
                headers.set('content-length',String(resource.bytes.byteLength));
                const response = new Response(resource.bytes, { headers });
                await cache.put(this.url(path), response.clone());
                staged.set(path,response);
                progress({ files: staged.size, bytes: size });
                return response;
            };
            for (const [path,hash] of Object.entries(build.files)) {
                if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('资源清单无效');
                await put(path,hash);
            }
            const manifest = await (await cache.match(this.url(`${characterBase}/manifest.json`))).json();
            const checksumResponse = await this.request(`${characterBase}/checksums.json`,signal);
            if (await sha256(checksumResponse.bytes) !== manifest.resourceSetSha256) throw new Error('字形清单校验失败');
            const checksums = JSON.parse(new TextDecoder().decode(checksumResponse.bytes));
            const store = new CharacterStore({ timeoutMs: this.timeoutMs, fetchImpl: async url => {
                const cached = await cache.match(this.url(url));
                if (cached) return cached;
                const character = decodeURIComponent(url.slice(url.lastIndexOf('/')+1));
                const hash = checksums[character];
                if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('字形校验信息缺失');
                try { return (await put(url,hash)).clone(); }
                catch(error) { throw new ResourceError('OFFLINE_RESOURCE',error.message); }
            } });
            const names = new Set();
            let unknownNames = 0;
            for (const char of new Set(Array.from(query))) {
                try {
                    const record = await store.load(char,{signal});
                    for (const name of record.strokeNames) { if (name) names.add(name);else unknownNames++; }
                } catch(error) {
                    if (signal?.aborted) throw abortError();
                    throw new Error(`“${char}”${error.message || '无法保存'}`);
                }
            }
            const catalog = await (await cache.match(this.url('/audio/strokes/v1/manifest.json'))).json();
            if (catalog.schemaVersion !== 1 || catalog.version !== 'v1' || !Array.isArray(catalog.items)) throw new Error('录音清单无效');
            for (const name of names) {
                const item = catalog.items.find(item => item.text === name);
                if (!item || !/^stroke-[a-f0-9]{12}$/.test(item.id) || item.url !== `/audio/strokes/v1/${item.id}.mp3` || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error(`“${name}”录音暂缺，未保存离线字单`);
                const response = await put(item.url,item.sha256);
                if (!(response.headers.get('content-type') || '').includes('audio/') || Number(response.headers.get('content-length') || item.bytes) !== item.bytes) throw new Error('录音格式或大小无效');
            }
            const readings = new Set(Array.from(query).flatMap(char => characterReadings(char)));
            for (const reading of readings) {
                const item = readingRecording(reading);
                if (!item) continue;
                const response = await put(item.url, item.sha256);
                if (!(response.headers.get('content-type') || '').includes('audio/') || Number(response.headers.get('content-length') || item.bytes) !== item.bytes) throw new Error('读音录音格式或大小无效');
            }
            if (signal?.aborted) throw abortError();
            const meta = { schema:1,query,name:name.trim(),buildId:this.buildId,savedAt:this.now(),bytes:size,unknownNames,files:[...staged.keys()] };
            // The metadata entry is the commit point. Existing packs survive any earlier failure.
            await cache.put(this.url(metaPath),new Response(JSON.stringify(meta),{headers:{'content-type':'application/json'}}));
            if (signal?.aborted) throw abortError();
            for (const old of existing.filter(item => item.query === query)) await this.storage.delete(old.cacheName).catch(() => {});
            return { ...meta,cacheName };
        } catch(error) {
            await this.storage.delete(cacheName).catch(() => {});
            if (error instanceof SyntaxError) throw new Error('资源内容无效，请联网后重试');
            if (error.name === 'QuotaExceededError') throw new Error('浏览器存储空间不足，旧字单保持不变');
            throw error;
        }
    }
    async match(request) {
        const url = new URL(request.url);
        if (url.origin !== this.origin) return null;
        const path = url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/preview/index.html' ? '/' : url.pathname;
        for (const item of await this.list({verify:path === '/' || path === '/print/index.html'})) {
            if (item.broken) continue;
            const cache = await this.storage.open(item.cacheName);
            const cached = await cache.match(this.url(path));
            if (cached) return cached;
        }
        return null;
    }
}
