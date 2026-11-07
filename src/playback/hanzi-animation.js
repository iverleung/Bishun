import HanziWriter from 'hanzi-writer';

export class HanziAnimation {
    constructor(layer) { this.layer = layer; this.stop = null; }

    cancel() { this.stop?.(); }

    animate(record, index, { signal, speed }) {
        this.cancel();
        if (signal.aborted) return Promise.reject(new DOMException('已取消', 'AbortError'));
        // Keep the writer's 1024-unit coordinates in the same responsive viewport as the static ink.
        const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        host.setAttribute('viewBox', '0 0 1024 1024');
        host.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        this.layer.append(host);
        const writer = HanziWriter.create(host, record.character, {
            width: 1024, height: 1024, padding: 0, showCharacter: false, showOutline: false,
            strokeColor: '#24715b', strokeAnimationSpeed: speed,
            charDataLoader: () => record.data
        });
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
                // Pause through the public API; detach immediately so stale frames are invisible.
                writer.pauseAnimation().catch(() => {});
                host.remove();
                if (this.stop === abort) this.stop = null;
                if (error) reject(error); else resolve();
            };
            const abort = () => finish(new DOMException('已取消', 'AbortError'));
            const timer = setTimeout(() => finish(new Error('笔画动画超时，请重试')), 10000);
            this.stop = abort;
            signal.addEventListener('abort', abort, { once: true });
            writer.getCharacterData().then(() => {
                if (settled || signal.aborted) return;
                return writer.animateStroke(index).then(result => {
                    if (result?.canceled) abort(); else finish();
                });
            }).catch(finish);
        });
    }
}
