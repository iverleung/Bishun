import HanziWriter from 'hanzi-writer';
import './style.css';
import { v2 } from './engine/recognition/v2.js';
import { v3 } from './engine/recognition/v3.js';
import { SpeechEngine } from './engine/speech.js';

class HanziStrokeApp {
    constructor() {
        this.writers = new Map();
        this.isPlaying = false;
        this.isRendering = false;
        this.playingIndex = -1;
        this.currentUniqueIds = [];
        this.speech = new SpeechEngine();

        // 从本地存储加载速度设置，默认为级别 3
        const savedSpeed = localStorage.getItem('bishun-speed-level');
        this.currentSpeedLevel = savedSpeed ? parseInt(savedSpeed) : 3;

        this.speedSettings = {
            1: { speed: 0.15, delay: 2000, label: '极慢' },
            2: { speed: 0.3, delay: 1500, label: '较慢' },
            3: { speed: 0.5, delay: 1000, label: '正常' },
            4: { speed: 1.5, delay: 300, label: '较快' },
            5: { speed: 4.0, delay: 50, label: '极快' }
        };

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
        this.updateBuildInfo();
        this.updateSpeedUI(true); // 初始化时更新 UI，不保存
        console.log('✅ HanziStrokeApp 初始化完成');
    }

    cacheDOM() {
        this.dom = {
            input: document.getElementById('charInput'),
            clearBtn: document.getElementById('clearBtn'),
            playBtn: document.getElementById('playBtn'),
            grid: document.getElementById('characterGrid'),
            speedSlider: document.getElementById('speedSlider'),
            speedValue: document.getElementById('speedValue')
        };
    }

    bindEvents() {
        this.dom.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.speech.unlock();
                this.handleRender();
            }
        });

        this.dom.clearBtn.addEventListener('click', this.debounce(() => {
            this.clearAll();
        }, 200));

        this.dom.playBtn.addEventListener('click', this.debounce(() => {
            this.speech.unlock(); // 关键：立即激活语音上下文
            if (this.isPlaying) {
                this.stopAnimation();
            } else if (this.currentUniqueIds.length > 0 && !this.isRendering) {
                const resumeIndex = this.playingIndex === -1 ? 0 : this.playingIndex;
                this.playAll(resumeIndex);
            } else {
                this.handleRender();
            }
        }, 300));

        this.dom.speedSlider.addEventListener('input', (e) => {
            this.currentSpeedLevel = parseInt(e.target.value);
            this.updateSpeedUI();
            // 保存至本地存储
            localStorage.setItem('bishun-speed-level', this.currentSpeedLevel);
        });
    }

    updateSpeedUI(isInit = false) {
        const setting = this.speedSettings[this.currentSpeedLevel];
        this.dom.speedValue.textContent = setting.label;
        if (isInit) {
            this.dom.speedSlider.value = this.currentSpeedLevel;
        }
    }

    async handleRender() {
        if (this.isRendering) return;

        let value = this.dom.input.value.trim();
        value = value.replace(/[^\u4e00-\u9fa5]/g, '');

        if (value.length > 20) {
            value = value.slice(0, 20);
        }
        this.dom.input.value = value;

        if (value.length > 0) {
            this.isRendering = true;
            try {
                await this.renderCharacters(value);
            } finally {
                this.isRendering = false;
            }
            // 渲染完成后自动开始播放，此时 isRendering 已为 false，允许后续点击停止
            await this.playAll();
        } else {
            this.showPlaceholder();
        }
    }

    async renderCharacters(chars) {
        this.writers.clear();
        this.currentUniqueIds = [];
        this.dom.grid.innerHTML = '';

        const promises = [];
        for (let index = 0; index < chars.length; index++) {
            const char = chars[index];
            const uniqueId = Date.now() + '-' + index;
            this.currentUniqueIds.push(uniqueId);
            this.createCharacterCard(char, index, uniqueId);
            // 改为直接收集 loadCharacterData 返回的 Promise
            promises.push(this.loadCharacterData(char, index, uniqueId));
        }
        await Promise.all(promises);
    }

    createCharacterCard(char, index, uniqueId) {
        const card = document.createElement('div');
        card.className = 'character-card';
        card.id = `card-${uniqueId}`;

        const nameDisplay = document.createElement('div');
        nameDisplay.className = 'stroke-name-display';
        nameDisplay.id = `name-${uniqueId}`;
        card.appendChild(nameDisplay);

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
    }

    updateBuildInfo() {
        const infoEl = document.getElementById('buildInfo');
        if (infoEl && typeof __BUILD_INFO__ !== 'undefined') {
            infoEl.textContent = `v${__BUILD_INFO__}`;
        }
    }

    async loadCharacterData(char, index, uniqueId) {
        const targetId = `target-${uniqueId}`;
        const target = document.getElementById(targetId);
        if (!target) return;

        target.innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';

        let writerInstance;
        const loadPromise = new Promise((resolve, reject) => {
            const charCode = encodeURIComponent(char);
            const cdns = [
                `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/${charCode}.json`,
                `https://jsd.onmicrosoft.cn/npm/hanzi-writer-data@2.0/${charCode}.json`,
                `https://npm.elemecdn.com/hanzi-writer-data@2/${charCode}.json`,
                `https://cdn.jsdelivr.net/gh/skishore/hanzi-writer-data@master/${charCode}.json`,
                `https://unpkg.com/hanzi-writer-data@2.0.1/${charCode}.json`
            ];

            const loadFromCDNs = async (onComplete) => {
                for (const url of cdns) {
                    try {
                        const response = await fetch(url, { mode: 'cors' });
                        if (response.ok) {
                            const charData = await response.json();
                            onComplete(charData);
                            return true;
                        }
                    } catch (e) { /* ignore */ }
                }
                return false;
            };

            writerInstance = HanziWriter.create(targetId, char, {
                charDataLoader: async (c, onComplete) => {
                    const success = await loadFromCDNs(onComplete);
                    if (success) {
                        target.querySelector('.loading')?.remove();
                        resolve();
                    } else {
                        target.innerHTML = '<div class="loading">加载失败</div>';
                        reject(new Error(`All CDNs failed for ${c}`));
                    }
                },
                width: 150,
                height: 150,
                padding: 0,
                strokeColor: '#333',
                outlineColor: '#DDD',
                delayBetweenStrokes: this.speedSettings[this.currentSpeedLevel].delay,
                strokeAnimationSpeed: this.speedSettings[this.currentSpeedLevel].speed,
                showOutline: false,
                showCharacter: false,
                strokeNumAnimationSpeed: 1000
            });
        });

        // 立即存入实例，防止后续逻辑拿到 null
        this.writers.set(uniqueId, writerInstance);
        return loadPromise;
    }

    async animateSingle(uniqueId) {
        const wasPlaying = this.isPlaying;
        const interruptedIndex = this.playingIndex;

        // 如果正在播放，停止它
        if (wasPlaying) {
            this.stopAnimation();
            await this.delay(50);
        }

        await this.runSingleAnimation(uniqueId);

        // 如果之前是在全局播放模式，则从刚才中断的位置恢复
        if (wasPlaying && interruptedIndex !== -1) {
            this.playAll(interruptedIndex);
        }
    }

    async runSingleAnimation(uniqueId) {
        const writer = this.writers.get(uniqueId);
        if (!writer) return;

        // 播前清空
        if (writer && typeof writer.cancelAnimation === 'function') {
            writer.cancelAnimation();
        }
        if (writer && typeof writer.hideCharacter === 'function') {
            writer.hideCharacter();
        }

        const card = document.getElementById(`card-${uniqueId}`);
        card.classList.add('active');

        const char = this.dom.input.value;
        const charIndex = this.currentUniqueIds.indexOf(uniqueId);
        const targetChar = char[charIndex];

        try {
            const charData = await HanziWriter.loadCharacterData(targetChar);
            const strokeCount = charData.strokes.length;

            for (let i = 0; i < strokeCount; i++) {
                const strokeName = this.getStrokeName(charData.medians[i], targetChar, i);

                // 显示名称
                const nameEl = document.getElementById(`name-${uniqueId}`);
                if (nameEl) {
                    nameEl.textContent = strokeName;
                    nameEl.classList.add('show');
                }

                await this.speech.speak(strokeName);

                const currentSetting = this.speedSettings[this.currentSpeedLevel];
                await writer.animateStroke(i, {
                    duration: 400 / currentSetting.speed // 根据速度动态计算时长
                });

                // 每一笔播报/动画完立即消失
                if (nameEl) nameEl.classList.remove('show');

                if (i < strokeCount - 1) {
                    await this.delay(currentSetting.delay);
                }
            }
        } catch (error) {
            console.error(`❌ 动画出错：`, error);
        }

        card.classList.remove('active');
        const nameEl = document.getElementById(`name-${uniqueId}`);
        if (nameEl) nameEl.classList.remove('show');
        card.classList.add('completed');
        setTimeout(() => card.classList.remove('completed'), 2000);
    }

    async playAll(startIndex = 0) {
        const chars = this.dom.input.value;
        if (!chars || this.writers.size === 0) return;

        this.isPlaying = true;
        this.dom.playBtn.textContent = '停止';
        this.dom.playBtn.classList.add('btn-secondary');
        this.dom.playBtn.classList.remove('btn-primary');

        const uniqueIds = this.currentUniqueIds;

        for (let i = startIndex; i < uniqueIds.length; i++) {
            if (!this.isPlaying) break;

            this.playingIndex = i;
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

        // 如果是正常播放结束（且没有被手动中途停止），则清空索引并重置按钮
        if (this.isPlaying) {
            this.stopAnimation();
            this.playingIndex = 0; // 全部播放完，重置回 0
        }
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

        // 播前清空
        if (writer && typeof writer.cancelAnimation === 'function') {
            writer.cancelAnimation();
        }
        if (writer && typeof writer.hideCharacter === 'function') {
            writer.hideCharacter();
        }

        const card = document.getElementById(`card-${uniqueId}`);
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('active');

        const char = this.dom.input.value;
        const charIndex = this.currentUniqueIds.indexOf(uniqueId);
        const targetChar = char[charIndex];

        try {
            const charData = await HanziWriter.loadCharacterData(targetChar);
            const strokeCount = charData.strokes.length;

            for (let i = 0; i < strokeCount; i++) {
                if (!this.isPlaying) break;

                const strokeName = this.getStrokeName(charData.medians[i], targetChar, i);

                // 显示名称
                const nameEl = document.getElementById(`name-${uniqueId}`);
                if (nameEl) {
                    nameEl.textContent = strokeName;
                    nameEl.classList.add('show');
                }

                await this.speech.speak(strokeName);

                const currentSetting = this.speedSettings[this.currentSpeedLevel];
                await writer.animateStroke(i, {
                    duration: 400 / currentSetting.speed
                });

                // 每一笔播报/动画完立即消失
                if (nameEl) nameEl.classList.remove('show');

                if (i < strokeCount - 1 && this.isPlaying) {
                    await this.delay(currentSetting.delay);
                }
            }
        } catch (error) {
            console.error(`❌ 动画出错：`, error);
        }

        card.classList.remove('active');
        const nameEl = document.getElementById(`name-${uniqueId}`);
        if (nameEl) nameEl.classList.remove('show');
        card.classList.add('completed');
        setTimeout(() => card.classList.remove('completed'), 2000);
    }

    getStrokeName(points, char, index) {
        return v3.getStrokeName(points, char, index);
    }

    stopAnimation() {
        this.isPlaying = false;
        // 注意：这里不再重置 playingIndex，以便下次续播
        this.speech.cancel();
        // 瞬间停止所有正在进行的动画
        this.writers.forEach(writer => {
            if (writer && typeof writer.cancelAnimation === 'function') {
                writer.cancelAnimation();
            }
        });

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

    debounce(fn, delay) {
        let timer = null;
        return function (...args) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                fn.apply(this, args);
            }, delay);
        };
    }
}

window.addEventListener('DOMContentLoaded', () => {
    if (!window.app) {
        window.app = new HanziStrokeApp();
    }
});
