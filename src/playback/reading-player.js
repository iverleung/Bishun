// Shares the stroke audio channel. Every awaited step belongs to one cancellable request.
export class ReadingPlayer {
    constructor({ audio, lookup, onChange = () => {} }) {
        Object.assign(this, { audio, lookup, onChange });
        this.status = 'idle';
        this.reading = '';
        this.message = '';
        this.task = null;
    }

    cancel() {
        if (!this.task && this.status === 'idle') return;
        if (this.task) {
            this.task.abort();
            this.audio.cancel();
        }
        this.task = null;
        this.status = 'idle';
        this.reading = this.message = '';
        this.onChange(this);
    }

    async play(reading) {
        this.cancel();
        const item = this.lookup(reading);
        if (!item) return;
        const task = new AbortController();
        this.task = task;
        this.reading = item.reading;
        this.status = 'loading';
        this.message = '';
        try {
            // Must run in the original click stack for iOS audio permission.
            const unlocking = this.audio.unlock();
            this.onChange(this);
            await unlocking;
            if (task.signal.aborted) return;
            const buffer = await this.audio.prepareRecording(item, { signal: task.signal });
            if (task.signal.aborted) return;
            this.status = 'playing';
            this.onChange(this);
            await this.audio.start(buffer, { signal: task.signal });
            if (task.signal.aborted) return;
            this.status = 'idle';
            this.reading = '';
        } catch (error) {
            if (task.signal.aborted) return;
            this.status = 'error';
            this.message = '读音暂时无法播放，请重试';
        } finally {
            if (this.task === task) {
                this.task = null;
                this.onChange(this);
            }
        }
    }
}
