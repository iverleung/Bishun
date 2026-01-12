import HanziWriter from 'hanzi-writer';
import './style.css';
import { v2 } from './engine/recognition/v2.js';
import { SpeechEngine } from './engine/speech.js';

class HanziStrokeApp {
    constructor() {
        this.writers = new Map();
        this.isPlaying = false;
        this.isRendering = false;
        this.speech = new SpeechEngine();

        this.init();
    }

    init() {
        console.log('HanziStrokeApp 初始化中...');
        this.cacheDOM();
        if (!this.dom.input) {
            console.error('❌ 未找到输入框元素！');
            return;
        }
        this.bindEvents();
        console.log('✅ HanziStrokeApp 初始化完成');
    }

    cacheDOM() {
        this.dom = {
            input: document.getElementById('charInput'),
            clearBtn: document.getElementById('clearBtn'),
            playBtn: document.getElementById('playBtn'),
            grid: document.getElementById('characterGrid')
        };
    }

    bindEvents() {
        this.dom.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.handleRender();
            }
        });

        this.dom.clearBtn.addEventListener('click', () => {
            this.clearAll();
        });

        this.dom.playBtn.addEventListener('click', () => {
            this.handleRender();
        });
    }

    async handleRender() {
        if (this.isRendering) return;
        this.isRendering = true;

        try {
            let value = this.dom.input.value.trim();
            value = value.replace(/[^\u4e00-\u9fa5]/g, '');

            if (value.length > 20) {
                value = value.slice(0, 20);
            }
            this.dom.input.value = value;

            if (value.length > 0) {
                await this.renderCharacters(value);
            } else {
                this.showPlaceholder();
            }
        } finally {
            this.isRendering = false;
        }
    }

    async renderCharacters(chars) {
        this.writers.clear();
        this.currentUniqueIds = [];
        this.dom.grid.innerHTML = '';

        for (let index = 0; index < chars.length; index++) {
            const char = chars[index];
            const uniqueId = Date.now() + '-' + index;
            this.currentUniqueIds.push(uniqueId);
            this.createCharacterCard(char, index, uniqueId);
            await this.waitForWriter(uniqueId);
        }

        await this.playAll();
    }

    createCharacterCard(char, index, uniqueId) {
        const card = document.createElement('div');
        card.className = 'character-card';
        card.id = `card-${uniqueId}`;

        const tianziDiv = document.createElement('div');
        tianziDiv.className = 'tian-zi-ge';
        tianziDiv.id = `tianzi-${uniqueId}`;

        const diagonal1 = document.createElement('div');
        diagonal1.className = 'diagonal-1';
        tianziDiv.appendChild(diagonal1);

        const diagonal2 = document.createElement('div');
        diagonal2.className = 'diagonal-2';
        tianziDiv.appendChild(diagonal2);

        const charDisplay = document.createElement('div');
        charDisplay.className = 'character-display';
        charDisplay.id = `target-${uniqueId}`;
        tianziDiv.appendChild(charDisplay);

        card.appendChild(tianziDiv);
        tianziDiv.style.cursor = 'pointer';
        tianziDiv.onclick = () => this.animateSingle(uniqueId);

        this.dom.grid.appendChild(card);
        this.loadCharacterData(char, index, uniqueId);
    }

    async loadCharacterData(char, index, uniqueId) {
        const targetId = `target-${uniqueId}`;
        const target = document.getElementById(targetId);
        if (!target) return;

        target.innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';

        try {
            await HanziWriter.loadCharacterData(char);

            const writer = HanziWriter.create(targetId, char, {
                width: 110,
                height: 110,
                padding: 0,
                strokeColor: '#333',
                outlineColor: '#DDD',
                delayBetweenStrokes: 1000,
                strokeAnimationSpeed: 0.5,
                showOutline: false,
                showCharacter: false,
                strokeNumAnimationSpeed: 1000
            });

            this.writers.set(uniqueId, writer);
            target.querySelector('.loading')?.remove();
        } catch (error) {
            console.error(`❌ 汉字 ${char} 加载失败：`, error);
            target.innerHTML = '<div class="loading">加载失败</div>';
        }
    }

    async animateSingle(uniqueId) {
        const writer = this.writers.get(uniqueId);
        if (!writer) return;

        const card = document.getElementById(`card-${uniqueId}`);
        card.classList.add('active');

        const char = this.dom.input.value;
        const charIndex = Array.from(this.writers.keys()).indexOf(uniqueId);
        const targetChar = char[charIndex];

        try {
            const charData = await HanziWriter.loadCharacterData(targetChar);
            const strokeCount = charData.strokes.length;

            for (let i = 0; i < strokeCount; i++) {
                const strokeName = this.getStrokeName(charData.medians[i]);
                this.speech.speak(strokeName);

                await writer.animateStroke(i, {
                    duration: 800
                });

                if (i < strokeCount - 1) {
                    await this.delay(800);
                }
            }
        } catch (error) {
            console.error(`❌ 动画出错：`, error);
        }

        card.classList.remove('active');
        card.classList.add('completed');
        setTimeout(() => card.classList.remove('completed'), 2000);
    }

    async playAll() {
        const chars = this.dom.input.value;
        if (!chars || this.writers.size === 0) return;

        if (this.isPlaying) {
            this.stopAnimation();
            return;
        }

        this.isPlaying = true;
        this.dom.playBtn.textContent = '停止';
        this.dom.playBtn.classList.add('btn-secondary');
        this.dom.playBtn.classList.remove('btn-primary');

        const uniqueIds = Array.from(this.writers.keys());

        for (let i = 0; i < uniqueIds.length; i++) {
            if (!this.isPlaying) break;

            const uniqueId = uniqueIds[i];
            const writer = this.writers.get(uniqueId);
            if (!writer) {
                await this.waitForWriter(uniqueId);
            }

            await this.animateCharInSequence(uniqueId);

            if (i < uniqueIds.length - 1 && this.isPlaying) {
                await this.delay(1000);
            }
        }

        this.stopAnimation();
    }

    async waitForWriter(uniqueId) {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (this.writers.has(uniqueId)) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 50);
        });
    }

    async animateCharInSequence(uniqueId) {
        const writer = this.writers.get(uniqueId);
        if (!writer) return;

        const card = document.getElementById(`card-${uniqueId}`);
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('active');

        const char = this.dom.input.value;
        const charIndex = Array.from(this.writers.keys()).indexOf(uniqueId);
        const targetChar = char[charIndex];

        try {
            const charData = await HanziWriter.loadCharacterData(targetChar);
            const strokeCount = charData.strokes.length;

            for (let i = 0; i < strokeCount; i++) {
                if (!this.isPlaying) break;

                const strokeName = this.getStrokeName(charData.medians[i]);
                this.speech.speak(strokeName);

                await writer.animateStroke(i, {
                    duration: 800
                });

                if (i < strokeCount - 1 && this.isPlaying) {
                    await this.delay(800);
                }
            }
        } catch (error) {
            console.error(`❌ 动画出错：`, error);
        }

        card.classList.remove('active');
        card.classList.add('completed');
        setTimeout(() => card.classList.remove('completed'), 2000);
    }

    getStrokeName(points) {
        return v2.getStrokeName(points);
    }

    stopAnimation() {
        this.isPlaying = false;
        this.speech.cancel();
        this.dom.playBtn.textContent = '播放';
        this.dom.playBtn.classList.remove('btn-secondary');
        this.dom.playBtn.classList.add('btn-primary');
    }

    clearAll() {
        this.writers.clear();
        this.speech.cancel();
        this.currentUniqueIds = [];
        this.dom.grid.innerHTML = '';
        this.dom.input.value = '';
        this.showPlaceholder();
        this.stopAnimation();
    }

    showPlaceholder() {
        this.dom.grid.innerHTML = '<div class="placeholder">请输入汉字后按回车键或点击播放</div>';
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

window.addEventListener('DOMContentLoaded', () => {
    if (!window.app) {
        window.app = new HanziStrokeApp();
    }
});
