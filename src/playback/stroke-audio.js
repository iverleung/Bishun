import { resourceUrl } from '../data/resource-url.js';

function cancellable(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new DOMException('已取消', 'AbortError'));
    return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('已取消', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

function resourceFailure(error) {
    if (error instanceof TypeError) return new Error('录音加载失败，请检查网络，可静音继续');
    if (error instanceof SyntaxError) return new Error('录音清单格式无效，可静音继续');
    return error;
}

// One audio context, versioned local recordings, no browser speech synthesis.
export class StrokeAudio {
    constructor({ fetchImpl = (...args) => globalThis.fetch(...args), createContext = () => new (window.AudioContext || window.webkitAudioContext)(), getAudioSession = () => globalThis.navigator?.audioSession, version = 'v2', basePath } = {}) {
        this.fetch = fetchImpl;
        this.version = version;
        this.basePath = basePath;
        this.createContext = createContext;
        this.getAudioSession = getAudioSession;
        this.context = null;
        this.catalog = null;
        this.buffers = new Map();
        this.stop = null;
    }

    async unlock() {
        // Spoken instruction is user-requested media, rather than ambient sound effects.
        try {
            const session = this.getAudioSession();
            if (session) session.type = 'playback';
        } catch { /* Optional API: unsupported session settings must not block playback. */ }
        this.context ||= this.createContext();
        if (this.context.state === 'running') return;
        this.unlocking ||= this.bounded(this.context.resume());
        const pending = this.unlocking;
        try { await pending; }
        finally { if (this.unlocking === pending) this.unlocking = null; }
    }

    async bounded(work, milliseconds = 3000) {
        let timer;
        try {
            return await Promise.race([work, new Promise((resolve, reject) => {
                timer = setTimeout(() => reject(new Error('录音加载超时，可静音继续')), milliseconds);
            })]);
        } finally { clearTimeout(timer); }
    }

    manifest() {
        if (!this.catalog) {
            this.catalog = this.bounded(this.fetch(resourceUrl(`/audio/strokes/${this.version}/manifest.json`, this.basePath)).then(async response => {
                if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('录音清单不可用');
                const manifest = await response.json();
                if (manifest.schemaVersion !== 1 || manifest.version !== this.version || !Array.isArray(manifest.items)) throw new Error('录音清单版本不匹配');
                const entries = new Map();
                for (const item of manifest.items) {
                    if (!/^stroke-[a-f0-9]{12}$/.test(item.id) || item.url !== `/audio/strokes/${this.version}/${item.id}.mp3` ||
                        typeof item.text !== 'string' || !Number.isFinite(item.durationMs) || item.durationMs <= 0) throw new Error('录音清单无效');
                    entries.set(item.text, item);
                }
                return entries;
            })).catch(error => { this.catalog = null; throw resourceFailure(error); });
        }
        return this.catalog;
    }

    async prepare(name, { signal } = {}) {
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
        if (!name) throw Object.assign(new Error('当前笔画名称待核验，暂时无法播报'), { code: 'STROKE_NAME_MISSING' });
        if (this.unlocking) await cancellable(this.unlocking, signal);
        if (!this.context || this.context.state !== 'running') throw new Error('声音未启用，请点击语音开关后重试');
        const entries = await cancellable(this.manifest(), signal);
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
        const item = entries.get(name);
        if (!item) throw Object.assign(new Error(`笔画“${name}”的录音暂缺`), { code: 'STROKE_RECORDING_MISSING' });
        return this.prepareRecording(item, { signal });
    }

    async prepareRecording(item, { signal } = {}) {
        if (this.unlocking) await cancellable(this.unlocking, signal);
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
        if (!this.context || this.context.state !== 'running') throw new Error('声音未启用，请点击后重试');
        const key = resourceUrl(item.url, this.basePath);
        if (!this.buffers.has(key)) {
            const context = this.context;
            this.buffers.set(key, this.bounded(this.fetch(key, { cache: 'force-cache' }).then(async response => {
                if (!response.ok) throw new Error('录音加载失败，可静音继续');
                const bytes = await response.arrayBuffer();
                try { return await context.decodeAudioData(bytes); }
                catch { throw new Error('录音无法播放，已静音继续'); }
            })).catch(error => { this.buffers.delete(key); throw resourceFailure(error); }));
        }
        const buffer = await cancellable(this.buffers.get(key), signal);
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
        return buffer;
    }

    async preload(names, { signal } = {}) {
        const queue = [...new Set(names.filter(Boolean))];
        const worker = async () => {
            while (queue.length && !signal?.aborted) {
                try { await this.prepare(queue.shift(), { signal }); } catch { /* Playback reports actionable failures. */ }
            }
        };
        await Promise.all([worker(), worker()]);
    }

    start(buffer, { signal }) {
        this.cancel();
        if (!buffer || signal.aborted) return Promise.resolve();
        if (this.context.state !== 'running') return Promise.reject(new Error('声音已暂停，可静音继续'));
        return new Promise((resolve, reject) => {
            const source = this.context.createBufferSource();
            source.buffer = buffer;
            source.connect(this.context.destination);
            let settled = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signal.removeEventListener('abort', stop);
                source.onended = null;
                try { source.stop(); } catch { /* Already ended. */ }
                source.disconnect();
                if (this.stop === stop) this.stop = null;
                if (error) reject(error); else resolve();
            };
            const stop = () => finish();
            const timer = setTimeout(() => finish(new Error('录音播放超时，可静音继续')), buffer.duration * 1000 + 1500);
            this.stop = stop;
            signal.addEventListener('abort', stop, { once: true });
            source.onended = () => finish();
            try { source.start(); } catch { finish(new Error('录音无法播放，已静音继续')); }
        });
    }

    cancel() { this.stop?.(); }
}
