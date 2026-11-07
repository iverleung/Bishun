// W1 interaction model only: timers simulate playback, not the production engine.
export class PreviewPlayer {
    constructor(samples, onChange, clock = globalThis) {
        this.samples = samples;
        this.onChange = onChange;
        this.clock = clock;
        this.timer = null;
        this.generation = 0;
        this.entries = [];
        this.index = 0;
        this.completed = 0;
        this.active = null;
        this.showFull = true;
        this.status = 'empty';
        this.mode = 'quick';
        this.speed = 3;
        this.group = false;
        this.skipped = 0;
        this.groupComplete = false;
    }

    get entry() { return this.entries[this.index]; }
    get data() { return this.samples[this.entry]; }
    get duration() { return [1600, 1100, 700, 450, 250][this.speed - 1]; }

    cancel() {
        this.generation++;
        this.clock.clearTimeout(this.timer);
        this.timer = null;
        this.active = null;
    }

    notify() { this.onChange(this); }

    query(value) {
        this.cancel();
        const chars = Array.from(value.replace(/[^\u4e00-\u9fa5]/g, ''));
        this.entries = chars.slice(0, 20);
        this.index = 0;
        this.skipped = 0;
        this.resetCharacter();
        this.notify();
        return { filtered: value.replace(/[\u4e00-\u9fa5\s]/g, '').length > 0, truncated: chars.length > 20 };
    }

    resetCharacter() {
        this.groupComplete = false;
        this.completed = 0;
        this.showFull = true;
        this.status = this.entries.length === 0 ? 'empty' : this.data ? 'ready' : 'error';
    }

    select(index) {
        if (index < 0 || index >= this.entries.length) return;
        this.cancel();
        this.index = index;
        this.resetCharacter();
        this.notify();
    }

    clear() { this.query(''); }

    pause() {
        if (this.status !== 'playing') return;
        this.cancel();
        this.status = 'paused';
        this.notify();
    }

    seek(count) {
        if (!this.data) return;
        this.cancel();
        this.completed = Math.max(0, Math.min(this.data.strokes.length, count));
        this.showFull = false;
        this.status = this.completed === this.data.strokes.length ? 'complete' : 'paused';
        this.notify();
    }

    setMode(mode) {
        if (!['quick', 'explain', 'follow'].includes(mode)) return;
        this.pause();
        this.mode = mode;
        this.notify();
    }

    play({ restart = false, oneStroke = false } = {}) {
        if (!this.data || ['loading', 'error', 'empty'].includes(this.status)) return;
        const selectedStroke = this.active ?? (this.completed - 1);
        this.cancel();
        this.groupComplete = false;
        if (!restart && !oneStroke && !this.showFull && this.completed === this.data.strokes.length && this.status === 'paused' && this.group) {
            let next = this.index + 1;
            while (next < this.entries.length && !this.samples[this.entries[next]]) {
                this.skipped++;
                next++;
            }
            if (next === this.entries.length) {
                this.status = 'complete';
                this.groupComplete = true;
                this.notify();
                return;
            }
            this.index = next;
            this.completed = 0;
        }
        const count = this.data.strokes.length;
        if (oneStroke) {
            if (selectedStroke < 0 || this.showFull) return;
            this.completed = selectedStroke;
        } else if (restart || this.showFull || this.completed === count) {
            this.completed = 0;
        }
        this.showFull = false;
        this.status = 'playing';
        const generation = this.generation;
        const advance = () => {
            if (generation !== this.generation) return;
            this.active = this.completed;
            this.status = 'playing';
            const duration = this.duration + (this.mode === 'explain' ? 600 : 0);
            this.notify();
            this.timer = this.clock.setTimeout(() => {
                if (generation !== this.generation) return;
                this.completed++;
                this.active = null;
                const finished = this.completed === this.data.strokes.length;
                if (oneStroke || this.mode === 'follow') {
                    this.status = finished && !(this.group && !oneStroke) ? 'complete' : 'paused';
                    this.notify();
                    return;
                }
                if (!finished) {
                    advance();
                    return;
                }
                if (this.group) {
                    let next = this.index + 1;
                    while (next < this.entries.length && !this.samples[this.entries[next]]) {
                        this.skipped++;
                        next++;
                    }
                    if (next < this.entries.length) {
                        this.index = next;
                        this.completed = 0;
                        advance();
                        return;
                    }
                }
                this.status = 'complete';
                this.groupComplete = this.group;
                this.notify();
            }, duration);
        };
        advance();
    }

    restartGroup() {
        this.cancel();
        this.group = true;
        this.skipped = 0;
        const first = this.entries.findIndex(char => this.samples[char]);
        if (first === -1) {
            this.resetCharacter();
            this.notify();
            return;
        }
        this.skipped = first;
        this.index = first;
        this.resetCharacter();
        this.play({ restart: true });
    }

    scenario(type) {
        this.cancel();
        this.status = type;
        this.showFull = true;
        this.notify();
    }
}
