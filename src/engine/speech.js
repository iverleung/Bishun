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

    speak(text) {
        if (!this.speechSynthesis) return;

        const voices = this.speechSynthesis.getVoices();
        const chineseVoice = voices.find(v => v.lang.includes('zh'));

        if (this.currentUtterance) {
            this.speechSynthesis.cancel();
        }

        this.currentUtterance = new SpeechSynthesisUtterance(text);
        this.currentUtterance.lang = 'zh-CN';
        this.currentUtterance.rate = 1.2;
        this.currentUtterance.pitch = 1;

        if (chineseVoice) {
            this.currentUtterance.voice = chineseVoice;
        }

        console.log(`🔊 播报：${text}`);
        this.speechSynthesis.speak(this.currentUtterance);
    }

    cancel() {
        if (this.speechSynthesis) {
            this.speechSynthesis.cancel();
        }
    }
}
