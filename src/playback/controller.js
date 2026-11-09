const abortError = () => new DOMException('已取消', 'AbortError');
const speeds = [0.3, 0.6, 1, 2, 4];

export function delay(milliseconds, signal) {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(abortError()); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
        signal.addEventListener('abort', abort, { once: true });
    });
}

export class PlaybackController {
    constructor({ store, animation, audio, onChange, wait = delay, onInterrupt = () => {} }) {
        Object.assign(this, { store, animation, audio, onChange, wait, onInterrupt });
        this.entries = [];
        this.records = new Map();
        this.errors = new Map();
        this.index = 0;
        this.completed = 0;
        this.active = null;
        this.showFull = true;
        this.status = 'empty';
        this.mode = 'quick';
        this.speed = 3;
        this.group = false;
        this.speechEnabled = false;
        this.muted = false;
        this.audioWarning = '';
        this.skipped = 0;
        this.groupComplete = false;
        this.isRunning = false;
        this.resumeIndex = null;
        this.revision = 0;
        this.task = new AbortController();
        this.queryTask = new AbortController();
        this.ready = Promise.resolve();
    }

    get entry() { return this.entries[this.index]; }
    get record() { return this.records.get(this.entry); }
    get data() { return this.record?.data; }
    get names() { return this.record?.strokeNames || []; }
    notify() { this.onChange(this); }

    cancel() {
        this.task.abort();
        this.onInterrupt();
        this.audioPreparation?.abort();
        this.animation.cancel();
        this.audio.cancel();
        this.task = new AbortController();
        this.active = null;
        this.isRunning = false;
    }

    query(value) {
        this.queryTask.abort();
        this.queryTask = new AbortController();
        this.cancel();
        this.revision++;
        const chars = Array.from(value).filter(char => /^\p{Script=Han}$/u.test(char));
        this.entries = chars.slice(0, 20);
        this.records.clear();
        this.errors.clear();
        this.skipped = 0;
        this.groupComplete = false;
        this.muted = false;
        this.audioWarning = '';
        this.index = 0;
        this.resumeIndex = null;
        this.completed = 0;
        this.showFull = true;
        this.status = 'empty';
        this.ready = this.entries.length ? this.select(0) : Promise.resolve(this.notify());
        const revision = this.revision;
        void this.ready.then(() => this.prefetch(revision));
        return { filtered: Array.from(value).some(char => !/^\p{Script=Han}$/u.test(char) && !/\s/u.test(char)), truncated: chars.length > 20 };
    }

    async fetchRecord(char, signal, revision = this.revision) {
        if (this.records.has(char)) return this.records.get(char);
        try {
            const record = await this.store.load(char, { signal });
            if (revision !== this.revision || signal.aborted) throw abortError();
            this.records.set(char, record);
            this.errors.delete(char);
            return record;
        } catch (error) {
            if (revision === this.revision && !signal.aborted) this.errors.set(char, error);
            throw error;
        }
    }

    async prefetch(revision) {
        const signal = this.queryTask.signal;
        const chars = [...new Set(this.entries)].filter(char => !this.records.has(char) && !this.errors.has(char));
        const worker = async () => {
            while (revision === this.revision && !signal.aborted && chars.length) {
                const char = chars.shift();
                try { await this.fetchRecord(char, signal, revision); } catch { /* Per-character errors stay visible in the queue. */ }
                if (revision === this.revision && !signal.aborted) this.notify();
            }
        };
        await Promise.all([worker(), worker()]);
    }

    async select(index) {
        if (index < 0 || index >= this.entries.length) return;
        this.cancel();
        const signal = this.task.signal;
        this.index = index;
        this.resumeIndex = null;
        this.errors.delete(this.entry);
        this.completed = 0;
        this.showFull = true;
        this.groupComplete = false;
        this.status = 'loading';
        this.notify();
        try {
            await this.fetchRecord(this.entry, signal);
            if (signal.aborted) return;
            this.status = 'ready';
        } catch (error) {
            if (signal.aborted) return;
            this.status = 'error';
        }
        this.notify();
    }

    pause() {
        if (!this.isRunning && this.status !== 'playing') return;
        this.cancel();
        this.status = 'paused';
        this.notify();
    }

    seek(count) {
        if (!this.data || this.status === 'loading') return;
        this.cancel();
        this.resumeIndex = null;
        this.showFull = false;
        this.completed = Math.max(0, Math.min(this.data.strokes.length, count));
        this.status = this.completed === this.data.strokes.length ? 'complete' : 'paused';
        this.groupComplete = false;
        this.notify();
    }

    setMode(mode) {
        if (!['quick', 'explain', 'follow'].includes(mode)) return;
        this.pause();
        this.mode = mode;
        if (mode === 'quick') this.setSpeech(false);
        else if (mode === 'explain') this.setSpeech(true);
        this.notify();
    }

    setSpeech(enabled) {
        this.speechEnabled = enabled;
        this.muted = false;
        this.audioWarning = '';
        if (!enabled) { this.audioPreparation?.abort(); this.audio.cancel(); }
        this.notify();
    }

    async nextAvailable(start, signal) {
        const previous = this.data ? { index: this.index, completed: this.completed, showFull: this.showFull } : null;
        for (let index = start; index < this.entries.length; index++) {
            if (signal.aborted) return false;
            this.index = index;
            this.resumeIndex = index;
            this.completed = 0;
            this.showFull = false;
            this.status = 'loading';
            this.notify();
            try { await this.fetchRecord(this.entry, signal); }
            catch (error) { if (signal.aborted) return false; this.skipped++; continue; }
            if (signal.aborted) return false;
            this.resumeIndex = null;
            return true;
        }
        if (previous && !signal.aborted) Object.assign(this, previous);
        return false;
    }

    async play({ restart = false, oneStroke = false, fromGroupStart = false } = {}) {
        const resumeIndex = !restart && !oneStroke && this.status === 'paused' ? this.resumeIndex : null;
        if (!this.entries.length || (!fromGroupStart && resumeIndex === null && (!this.data || ['loading', 'error'].includes(this.status)))) return;
        const selected = this.active ?? this.completed - 1;
        const continueGroup = !restart && !oneStroke && this.group && this.status === 'paused' && this.completed === this.data?.strokes.length;
        if (oneStroke && (this.showFull || selected < 0)) return;
        this.cancel();
        const signal = this.task.signal;
        this.isRunning = true;
        this.groupComplete = false;
        try {
            if (fromGroupStart || continueGroup || resumeIndex !== null) {
                if (!await this.nextAvailable(fromGroupStart ? 0 : resumeIndex ?? this.index + 1, signal)) {
                    if (!signal.aborted) this.finishGroup();
                    return;
                }
            } else if (oneStroke) this.completed = selected;
            else if (restart || this.showFull || this.completed === this.data.strokes.length) this.completed = 0;
            this.showFull = false;
            this.status = 'playing';
            this.notify();
            while (!signal.aborted) {
                const index = this.completed;
                let buffer = null;
                if (this.speechEnabled && !this.muted) {
                    this.audioPreparation = new AbortController();
                    try { buffer = await this.audio.prepare(this.names[index], { signal: this.audioPreparation.signal }); }
                    catch (error) {
                        if (signal.aborted) return;
                        if (this.speechEnabled && error.name !== 'AbortError') { this.muted = true; this.audioWarning = error.message; }
                    }
                }
                if (signal.aborted) return;
                this.active = index;
                this.notify();
                const animation = this.animation.animate(this.record, index, { signal, speed: speeds[this.speed - 1] || 1 });
                const voice = buffer && this.speechEnabled && !this.muted ? this.audio.start(buffer, { signal }).catch(error => {
                    if (!signal.aborted && this.speechEnabled) { this.muted = true; this.audioWarning = error.message; this.notify(); }
                }) : Promise.resolve();
                await Promise.all([animation, voice]);
                if (signal.aborted) return;
                this.completed++;
                this.active = null;
                const finished = this.completed === this.data.strokes.length;
                if (oneStroke || this.mode === 'follow') {
                    this.status = finished && !(this.group && !oneStroke) ? 'complete' : 'paused';
                    this.notify();
                    return;
                }
                this.notify();
                if (finished) {
                    if (!this.group) { this.status = 'complete'; this.notify(); return; }
                    await this.wait(260, signal);
                    if (!await this.nextAvailable(this.index + 1, signal)) {
                        if (!signal.aborted) this.finishGroup();
                        return;
                    }
                    this.status = 'playing';
                } else await this.wait(this.mode === 'quick' ? 80 : 180, signal);
            }
        } catch (error) {
            if (signal.aborted) return;
            this.cancel();
            this.errors.set(this.entry, error);
            this.status = 'error';
            this.notify();
        } finally { if (this.task.signal === signal) this.isRunning = false; }
    }

    finishGroup() { this.resumeIndex = null; this.isRunning = false; this.groupComplete = true; this.status = this.data ? 'complete' : 'error'; this.notify(); }

    restartGroup() {
        this.group = true;
        this.skipped = 0;
        return this.play({ fromGroupStart: true });
    }
}
