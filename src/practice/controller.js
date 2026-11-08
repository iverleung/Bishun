export class PracticeController {
    constructor({ adapter, onChange = () => {}, timeoutMs = 5000 }) {
        Object.assign(this, { adapter, onChange, timeoutMs });
        this.status = 'idle';
        this.record = null;
        this.mode = 'trace';
        this.completed = 0;
        this.message = '';
        this.task = new AbortController();
    }

    get visible() { return this.status !== 'idle'; }
    get total() { return this.record?.data.strokes.length || 0; }
    notify() { this.onChange(this); }
    invalidate() {
        this.task.abort();
        this.adapter.cancel();
        this.task = new AbortController();
    }
    current(signal) { return !signal.aborted && signal === this.task.signal; }

    async bounded(operation, signal) {
        let timer;
        let abort;
        try {
            return await Promise.race([
                operation,
                new Promise((resolve, reject) => {
                    abort = () => reject(new DOMException('已取消', 'AbortError'));
                    if (signal.aborted) abort();
                    else signal.addEventListener('abort', abort, { once: true });
                    timer = setTimeout(() => reject(new Error('练习准备超时，请重试')), this.timeoutMs);
                })
            ]);
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
        }
    }

    async start(record, { mode = this.mode, completed = 0 } = {}) {
        if (!record?.data?.strokes?.length || !['trace', 'independent'].includes(mode)) return false;
        this.invalidate();
        this.record = record;
        this.mode = mode;
        this.completed = Number.isInteger(completed) ? Math.max(0, Math.min(completed, this.total - 1)) : 0;
        this.status = 'preparing';
        this.message = '';
        const signal = this.task.signal;
        this.notify();
        try {
            await this.bounded(this.adapter.start(record, {
                mode, completed: this.completed, signal,
                onCorrect: index => {
                    if (!this.current(signal) || this.status !== 'active' || index !== this.completed) return;
                    this.completed++;
                    this.message = '';
                    this.notify();
                },
                onMistake: () => {
                    if (!this.current(signal) || this.status !== 'active') return;
                    this.message = '再试一次';
                    this.notify();
                },
                onComplete: () => {
                    if (!this.current(signal) || this.status !== 'active' || this.completed !== this.total) return;
                    this.adapter.setEnabled?.(false);
                    this.status = 'complete';
                    this.message = '这一字写完了';
                    this.notify();
                }
            }), signal);
            if (!this.current(signal)) return false;
            this.status = 'active';
            this.notify();
            return true;
        } catch (error) {
            if (!this.current(signal)) return false;
            this.invalidate();
            this.status = 'error';
            this.message = '练习未能准备好，请重写或返回示范';
            this.notify();
            return false;
        }
    }

    pause() {
        if (!['preparing', 'active', 'hint'].includes(this.status)) return;
        this.invalidate();
        this.status = 'paused';
        this.message = '已暂停';
        this.notify();
    }

    resume() {
        if (this.status === 'paused') return this.start(this.record, { completed: this.completed });
    }

    restart(mode = this.mode) {
        if (this.record) return this.start(this.record, { mode });
    }

    async hint() {
        if (this.status !== 'active' || this.completed >= this.total) return;
        const signal = this.task.signal;
        this.status = 'hint';
        this.message = '看这一笔';
        this.notify();
        try {
            await this.bounded(this.adapter.hint(this.completed, { signal }), signal);
            if (!this.current(signal)) return;
            this.status = 'active';
            this.message = '';
            this.notify();
        } catch {
            if (!this.current(signal)) return;
            this.pause();
            this.message = '提示未完成，可继续练习';
            this.notify();
        }
    }

    exit() {
        this.invalidate();
        this.record = null;
        this.completed = 0;
        this.status = 'idle';
        this.message = '';
        this.notify();
    }
}
