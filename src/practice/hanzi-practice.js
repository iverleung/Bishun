import HanziWriter from 'hanzi-writer';

const abortError = () => new DOMException('已取消', 'AbortError');
function cancellable(promise, signal) {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const abort = () => reject(abortError());
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

export class HanziPractice {
    constructor(layer) {
        this.layer = layer;
        this.host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.host.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        this.host.setAttribute('aria-hidden', 'true');
        this.host.style.pointerEvents = 'none';
        layer.append(this.host);
        this.writer = null;
        this.record = null;
        this.pending = Promise.resolve();
        this.version = 0;
    }

    // Reuse one writer: HanziWriter installs document-level end listeners per instance.
    enqueue(operation) {
        const result = this.pending.then(operation);
        this.pending = result.catch(() => {});
        return result;
    }

    cancel() {
        this.version++;
        this.host.style.pointerEvents = 'none';
        this.writer?.cancelQuiz();
        void this.writer?.pauseAnimation().catch(() => {});
    }

    size() {
        const width = this.layer.getBoundingClientRect().width;
        if (!width) throw new Error('练习画布不可用');
        this.host.setAttribute('viewBox', `0 0 ${width} ${width}`);
        this.width = width;
        return width;
    }

    start(record, options) {
        const version = ++this.version;
        const { signal, completed, mode, onCorrect, onMistake, onComplete } = options;
        return this.enqueue(async () => {
            if (signal.aborted || version !== this.version) throw abortError();
            this.record = record;
            const width = this.size();
            if (!this.writer) {
                this.writer = HanziWriter.create(this.host, record.character, {
                    width, height: width, padding: 0, showCharacter: false, showOutline: mode === 'trace',
                    strokeColor: '#31483d', outlineColor: '#dce3d9', drawingColor: '#24715b', highlightColor: '#b88845',
                    drawingWidth: 5, strokeFadeDuration: 100, drawingFadeDuration: 150,
                    strokeHighlightSpeed: 1.5,
                    charDataLoader: char => {
                        if (char !== this.record.character) throw new Error('练习字形已切换');
                        return this.record.data;
                    }
                });
                await cancellable(this.writer.getCharacterData(), signal);
            } else {
                this.writer.cancelQuiz();
                await cancellable(this.writer.setCharacter(record.character), signal);
                this.writer.updateDimensions({ width, height: width, padding: 0 });
            }
            if (signal.aborted || version !== this.version) throw abortError();
            if (mode === 'trace') await cancellable(this.writer.showOutline({ duration: 0 }), signal);
            else await cancellable(this.writer.hideOutline({ duration: 0 }), signal);
            if (signal.aborted || version !== this.version) throw abortError();
            this.quizOptions = {
                quizStartStrokeNum: completed, showHintAfterMisses: false,
                highlightOnComplete: false, markStrokeCorrectAfterMisses: false, acceptBackwardsStrokes: false,
                onCorrectStroke: data => onCorrect(data.strokeNum),
                onMistake: () => onMistake(), onComplete: () => onComplete()
            };
            await cancellable(this.writer.quiz(this.quizOptions), signal);
            if (signal.aborted || version !== this.version) { this.writer.cancelQuiz(); throw abortError(); }
            this.host.style.pointerEvents = 'auto';
        });
    }

    setEnabled(enabled) { this.host.style.pointerEvents = enabled ? 'auto' : 'none'; }

    hint(index, { signal }) {
        const version = this.version;
        return this.enqueue(async () => {
            if (signal.aborted || version !== this.version) throw abortError();
            this.host.style.pointerEvents = 'none';
            this.writer.cancelQuiz();
            await cancellable(this.writer.highlightStroke(index), signal);
            if (signal.aborted || version !== this.version) throw abortError();
            await cancellable(this.writer.quiz({ ...this.quizOptions, quizStartStrokeNum: index }), signal);
            if (signal.aborted || version !== this.version) { this.writer.cancelQuiz(); throw abortError(); }
            this.host.style.pointerEvents = 'auto';
        });
    }
}
