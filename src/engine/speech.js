/**
 * 语音播报模块
 */

export class SpeechEngine {
    constructor() {
        this.speechSynthesis = window.speechSynthesis;
        this.currentUtterance = null;
        this.init();
    }

    init() {
        if (!this.speechSynthesis) {
            console.warn('❌ 语音合成不可用');
            return;
        }

        // 预热语音合成
        this.speechSynthesis.getVoices();
        const testUtterance = new SpeechSynthesisUtterance('');
        this.speechSynthesis.speak(testUtterance);
        this.speechSynthesis.cancel();

        if (this.speechSynthesis.onvoiceschanged !== undefined) {
            this.speechSynthesis.onvoiceschanged = () => {
                console.log('✅ 语音列表已更新');
            };
        }
    }

    async speak(text) {
        if (!this.speechSynthesis) return;

        // Chrome 容易卡死在 paused 状态
        if (this.speechSynthesis.paused) {
            this.speechSynthesis.resume();
        }

        // 返回一个 Promise 以便调用方可以等待播报完成（可选）
        return new Promise((resolve) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'zh-CN';
            utterance.rate = 1.0;
            utterance.pitch = 1.0;

            const voices = this.speechSynthesis.getVoices();
            const chineseVoice = voices.find(v => v.lang.includes('zh-CN') && v.localService)
                || voices.find(v => v.lang.includes('zh-CN'))
                || voices.find(v => v.lang.includes('zh'));
            if (chineseVoice) utterance.voice = chineseVoice;

            utterance.onend = () => {
                this.currentUtterance = null;
                resolve();
            };

            utterance.onerror = (e) => {
                console.warn('SpeechSynthesis Error:', e);
                // 如果是被 cancel 掉的，我们也 resolve 掉它，避免 await 死锁
                resolve();
            };

            // 重要：在 Chrome 中，如果你想播报新的，不需要频繁 cancel，
            // 浏览器会自动排队，频繁 cancel 反而会引起 'canceled' 报错
            this.currentUtterance = utterance;
            this.speechSynthesis.speak(utterance);
        });
    }

    /**
     * 在用户交互（点击）时调用，用于解锁浏览器的语音合成限制
     */
    unlock() {
        if (!this.speechSynthesis) return;
        this.speechSynthesis.resume();
        // 播报一个几乎听不见的短语来激活上下文
        const silent = new SpeechSynthesisUtterance(' ');
        silent.volume = 0;
        this.speechSynthesis.speak(silent);

        // Chrome Fix: 某些版本需要定时 resume 才能持续播报
        if (!this.resumeTimer) {
            this.resumeTimer = setInterval(() => {
                if (this.speechSynthesis.speaking && !this.speechSynthesis.paused) {
                    this.speechSynthesis.pause();
                    this.speechSynthesis.resume();
                }
            }, 10000); // 10秒一个脉冲防止挂起
        }
    }

    cancel() {
        if (this.speechSynthesis) {
            this.speechSynthesis.cancel();
            this.currentUtterance = null;
        }
    }
}
