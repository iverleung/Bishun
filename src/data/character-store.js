import { characterBase, validateCharacterData, validateCharacterManifest } from './character-data.js';
import { v3 } from '../engine/recognition/v3.js';

export class ResourceError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

function withSignal(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new DOMException('已取消', 'AbortError'));
    return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('已取消', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

export class CharacterStore {
    constructor({ fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 3000, getNames = char => v3.getStrokeNames(char) } = {}) {
        this.fetch = fetchImpl;
        this.timeoutMs = timeoutMs;
        this.getNames = getNames;
        this.manifestPromise = null;
        this.pending = new Map();
        this.cache = new Map();
    }

    async requestJson(url, immutable = false) {
        const controller = new AbortController();
        let timer;
        try {
            return await Promise.race([
                (async () => {
                    const response = await this.fetch(url, { signal: controller.signal, cache: immutable ? 'force-cache' : 'no-cache' });
                    if (!response.ok) throw new ResourceError('HTTP', `资源请求失败（${response.status}）`);
                    if (!response.headers.get('content-type')?.includes('application/json')) {
                        throw new ResourceError('FORMAT', '资源返回了非 JSON 内容');
                    }
                    return response.json();
                })(),
                new Promise((resolve, reject) => {
                    timer = setTimeout(() => {
                        reject(new ResourceError('TIMEOUT', '资源加载超时，请重试'));
                        controller.abort();
                    }, this.timeoutMs);
                })
            ]);
        } catch (error) {
            if (error instanceof ResourceError) throw error;
            if (error instanceof SyntaxError) throw new ResourceError('FORMAT', '字形资源格式无效，请重试');
            throw new ResourceError('NETWORK', '网络连接失败，请检查网络后重试');
        } finally { clearTimeout(timer); }
    }

    manifest() {
        if (!this.manifestPromise) {
            this.manifestPromise = this.requestJson(`${characterBase}/manifest.json`).then(manifest => ({ manifest, counts: validateCharacterManifest(manifest) }))
                .catch(error => { this.manifestPromise = null; throw error; });
        }
        return this.manifestPromise;
    }

    async load(char, { signal } = {}) {
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
        if (typeof char !== 'string' || Array.from(char).length !== 1) throw new ResourceError('UNSUPPORTED', '请输入单个汉字');
        const { manifest, counts } = await withSignal(this.manifest(), signal);
        if (!counts.has(char)) throw new ResourceError('UNSUPPORTED', '本站字库暂未收录此字');
        if (this.cache.has(char)) return withSignal(Promise.resolve(this.cache.get(char)), signal);
        if (!this.pending.has(char)) {
            const request = this.requestJson(`${characterBase}/${encodeURIComponent(char)}.json`, true).then(data => {
                validateCharacterData(data, counts.get(char));
                const names = this.getNames(char);
                if (names.length && names.length !== data.strokes.length) throw new ResourceError('NAME_COUNT', '笔画名称与字形数量不一致');
                const strokeNames = names.length ? names : data.strokes.map(() => null);
                const record = { character: char, version: manifest.version, data, strokeNames, nameStatus: strokeNames.every(Boolean) ? 'dictionary' : 'partial', contentReviewed: false };
                this.cache.set(char, record);
                return record;
            }).finally(() => this.pending.delete(char));
            this.pending.set(char, request);
        }
        // Cancelling one consumer must not cancel a shared request used by another.
        return withSignal(this.pending.get(char), signal);
    }
}
