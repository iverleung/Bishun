import HanziWriter from 'hanzi-writer';
import './style.css';

class HanziStrokeApp {
    constructor() {
        this.writers = new Map();
        this.isPlaying = false;
        this.isRendering = false;
        this.speechSynthesis = window.speechSynthesis;
        this.currentUtterance = null;

        // 标准汉字笔画表（按书写顺序）
        // 基础笔画：
        // 1. 横 (héng) - 从左到右，水平线，y变化小
        // 2. 竖 (shù) - 从上到下，垂直线，x变化小
        // 3. 撇 (piě) - 从右上到左下，dx<0, dy>0
        // 4. 捺 (nà) - 从左上到右下，dx>0, dy>0，末端向右下
        // 5. 点 (diǎn) - 短小，长度<15px
        // 6. 提 (tí) - 从左下到右上，dx>0, dy<0
        // 7. 钩 (gōu) - 笔画末端有钩，通常是竖或横的末端
        // 8. 折 (zhé) - 笔画有明显转折，方向改变>45度

        // 复合笔画：
        // - 横折 (héng zhé) - 先横后竖
        // - 竖折 (shù zhé) - 先竖后横
        // - 横撇 (héng piě) - 先横后撇
        // - 横钩 (héng gōu) - 横后钩
        // - 竖钩 (shù gōu) - 竖后钩
        // - 横折钩 (héng zhé gōu) - 横折后钩
        // - 竖提 (shù tí) - 竖后提
        // - 撇点 (piě diǎn) - 先撇后点
        // - 卧钩 (wò gōu) - 类似横折钩但更平
        // - 斜钩 (xié gōu) - 斜着钩



        this.init();
    }

    init() {
        console.log('HanziStrokeApp 初始化中...');

        this.cacheDOM();

        if (!this.dom.input) {
            console.error('❌ 未找到输入框元素！');
            alert('页面错误：未找到输入框');
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

        console.log('DOM 元素缓存完成：', {
            input: !!this.dom.input,
            clearBtn: !!this.dom.clearBtn,
            playBtn: !!this.dom.playBtn,
            grid: !!this.dom.grid
        });
    }

    bindEvents() {
        console.log('绑定事件...');

        this.dom.input.addEventListener('input', (e) => {
            console.log('input事件触发，值：', e.target.value);
            this.initSpeech();
        });

        this.dom.input.addEventListener('keydown', (e) => {
            console.log('keydown事件，按键：', e.key);
            this.initSpeech();

            if (e.key === 'Enter') {
                e.preventDefault();
                this.handleRender();
            }
        });

        this.dom.clearBtn.addEventListener('click', () => {
            console.log('清空按钮点击');
            this.initSpeech();
            this.clearAll();
        });

        this.dom.playBtn.addEventListener('click', () => {
            console.log('播放按钮点击');
            this.initSpeech();
            this.handleRender();
        });

        console.log('✅ 事件绑定完成');
    }

    async handleRender() {
        if (this.isRendering) {
            console.log('⚠️ 正在渲染中，忽略本次请求');
            return;
        }

        this.isRendering = true;

        try {
            let value = this.dom.input.value.trim();

            console.log('开始渲染，输入值：', value);

            value = value.replace(/[^\u4e00-\u9fa5]/g, '');

            console.log('过滤后的值：', value);

            if (value.length > 10) {
                value = value.slice(0, 10);
                console.log('已限制为10个字符');
            }

            this.dom.input.value = value;

            if (value.length > 0) {
                console.log('开始渲染', value.length, '个汉字，准备自动播放');
                await this.renderCharacters(value);
            } else {
                console.log('值为空，显示占位符');
                this.showPlaceholder();
            }
        } finally {
            this.isRendering = false;
            console.log('✅ 渲染完成，isRendering 已重置');
        }
    }

    async renderCharacters(chars) {
        console.log('渲染汉字：', chars);

        // 不调用 clearAll 来避免清空输入框
        this.writers.clear();
        this.currentUniqueIds = [];
        this.dom.grid.innerHTML = '';

        // 同步顺序加载：一次只加载一个汉字
        for (let index = 0; index < chars.length; index++) {
            const char = chars[index];
            console.log(`创建并加载卡片 ${index}：`, char);

            const uniqueId = Date.now() + '-' + index;
            this.currentUniqueIds.push(uniqueId);
            this.createCharacterCard(char, index, uniqueId);

            // 等待这个汉字加载完成
            await this.waitForWriter(uniqueId);
            console.log(`✅ 汉字 ${char} 加载完成`);
        }

        console.log('所有汉字加载完成，开始自动播放...');
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

        console.log(`已添加卡片 ${index}到DOM，唯一ID：${uniqueId}`);

        this.loadCharacterData(char, index, uniqueId);
    }

    async loadCharacterData(char, index, uniqueId) {
        const targetId = `target-${uniqueId}`;
        const cardId = `card-${uniqueId}`;

        console.log(`查找元素 ID：${targetId}, 汉字：${char}`);

        const target = document.getElementById(targetId);
        const card = document.getElementById(cardId);

        if (!target) {
            console.error(`❌ 未找到目标元素：${targetId}`);
            console.error('页面中的所有元素：');
            document.querySelectorAll('[id^="target-"]').forEach((el, i) => {
                console.error(`  target-${i}: id=${el.id}, class=${el.className}, tagName=${el.tagName}`);
            });
            return;
        }

        if (!card) {
            console.error(`❌ 未找到卡片元素：${cardId}`);
            return;
        }

        console.log(`✅ 找到目标元素：${targetId}, 卡片：${cardId}`);

        target.innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';

        try {
            console.log(`开始加载汉字数据：${char}`);

            await HanziWriter.loadCharacterData(char);

            // 使用 requestAnimationFrame 确保元素在 DOM 树中
            await new Promise(resolve => {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        resolve();
                    }, 0);
                });
            });

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

            console.log(`✅ 汉字 ${char} 加载完成`);

        } catch (error) {
            console.error(`❌ 汉字 ${char} 加载失败：`, error);
            target.innerHTML = '<div class="loading">加载失败</div>';
            target.style.color = '#ff4d4f';
        }
    }

    async animateSingle(uniqueId) {
        const writer = this.writers.get(uniqueId);
        if (!writer) {
            console.warn(`Writer ${uniqueId} 不存在`);
            return;
        }

        const card = document.getElementById(`card-${uniqueId}`);
        card.classList.add('active');

        console.log(`🎬 开始动画 uniqueId=${uniqueId}`);

        const char = this.dom.input.value;
        const charIndex = Array.from(this.writers.keys()).indexOf(uniqueId);
        const targetChar = char[charIndex];

        try {
            const charData = await HanziWriter.loadCharacterData(targetChar);
            const strokeCount = charData.strokes.length;
            console.log(`📊 汉字 ${targetChar} 有 ${strokeCount} 笔`);

            for (let i = 0; i < strokeCount; i++) {
                const strokeNum = i + 1;
                const strokeName = this.getStrokeName(charData.medians[i], i);
                console.log(`🎯 播放第 ${strokeNum} 笔，播报：${strokeName}`);
                this.speak(strokeName);

                await writer.animateStroke(i, {
                    duration: 800,
                    onComplete: () => {
                        console.log(`✅ 第 ${strokeNum} 笔完成`);
                    }
                });

                if (i < strokeCount - 1) {
                    await this.delay(800);
                }
            }
        } catch (error) {
            console.error(`❌ 动画出错：`, error);
        }

        console.log(`🎬 动画完成 uniqueId=${uniqueId}`);

        card.classList.remove('active');
        card.classList.add('completed');

        setTimeout(() => card.classList.remove('completed'), 2000);
    }

    resetSingle(uniqueId) {
        const writer = this.writers.get(uniqueId);
        if (!writer) return;

        writer.showCharacter({ duration: 0 });
        const card = document.getElementById(`card-${uniqueId}`);
        card.classList.remove('active', 'completed');
    }

    async playAll() {
        const chars = this.dom.input.value;
        if (!chars) {
            console.warn('输入为空，无法播放');
            return;
        }

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

            if (i < uniqueIds.length - 1) {
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
            }, 100);
        });
    }

    async animateCharInSequence(uniqueId) {
        const writer = this.writers.get(uniqueId);
        if (!writer) return;

        const card = document.getElementById(`card-${uniqueId}`);
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('active');

        console.log(`🎬 顺序动画开始 uniqueId=${uniqueId}`);

        const char = this.dom.input.value;
        const charIndex = Array.from(this.writers.keys()).indexOf(uniqueId);
        const targetChar = char[charIndex];

        try {
            const charData = await HanziWriter.loadCharacterData(targetChar);
            const strokeCount = charData.strokes.length;
            console.log(`📊 汉字 ${targetChar} 有 ${strokeCount} 笔`);

            for (let i = 0; i < strokeCount; i++) {
                if (!this.isPlaying) break;

                const strokeNum = i + 1;
                const strokeName = this.getStrokeName(charData.medians[i], i);
                console.log(`🎯 播放第 ${strokeNum} 笔，播报：${strokeName}`);
                this.speak(strokeName);

                await writer.animateStroke(i, {
                    duration: 800,
                    onComplete: () => {
                        console.log(`✅ 第 ${strokeNum} 笔完成`);
                    }
                });

                if (i < strokeCount - 1) {
                    await this.delay(800);
                }
            }
        } catch (error) {
            console.error(`❌ 动画出错：`, error);
        }

        console.log(`🎬 顺序动画完成 uniqueId=${uniqueId}`);

        card.classList.remove('active');
        card.classList.add('completed');

        setTimeout(() => card.classList.remove('completed'), 2000);
    }

    getStrokeName(points, strokeIndex) {
        if (!points || points.length < 2) return '点';

        const n = points.length;
        const start = points[0], end = points[n - 1];
        const dx = end[0] - start[0], dy = end[1] - start[1];
        const totalLength = this.calculatePathLength(points);
        const chordLength = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const curvature = totalLength / chordLength;

        // 1. 点检测 (点通常非常短)
        if (totalLength < 200 || (totalLength < 280 && n < 6)) {
            if (curvature > 1.15 && dx < 0) return '撇'; // 区分短撇与点
            if (dx > 0 && Math.abs(dx) > Math.abs(dy) * 3) return '横';
            return '点';
        }

        const hook = this.detectHook(points, totalLength);
        const turnInfo = this.findMaxDeviation(points, start, end);
        const mid = points[turnInfo.index];
        const v1 = { dx: mid[0] - start[0], dy: mid[1] - start[1] };
        const v2 = { dx: end[0] - mid[0], dy: end[1] - mid[1] };
        const a1 = Math.atan2(v1.dy, v1.dx), a2 = Math.atan2(v2.dy, v2.dx);
        let angleChange = Math.abs(a1 - a2);
        if (angleChange > Math.PI) angleChange = 2 * Math.PI - angleChange;
        const angleDeg = angleChange * 180 / Math.PI;

        // 转折判定
        const isFold = (turnInfo.distance > chordLength * 0.25 && angleDeg > 65);

        if (isFold) {
            const d1 = this.getDir(v1);
            if (d1 === '横') {
                if (v2.dx < -30) return '横撇';
                return hook ? '横折钩' : '横折';
            }
            if (d1 === '竖') {
                if (v2.dx > 40) {
                    if (hook || v2.dy > v2.dx * 0.4) return '竖弯钩';
                    return '竖折';
                }
                if (v2.dx < -30) return '弯钩';
                return hook ? '竖钩' : '竖折';
            }
            if (v1.dx > 0 && v2.dy > 10) return '卧钩';
            return '横折';
        } else {
            const absDx = Math.abs(dx), absDy = Math.abs(dy);
            if (hook) {
                if (absDy > absDx) return this.getBodyCurvature(points) < 1.08 ? '竖钩' : '弯钩';
                if (dx > 0) return absDx > absDy ? '卧钩' : '斜钩';
            }
            if (dx > 0 && dy > 40 && dy > absDx * 0.3) return '提';
            if (absDy > absDx * 1.5) {
                if (dx < -40 || curvature > 1.1) return '撇';
                return dy < 0 ? '竖' : '撇';
            }
            if (absDx > absDy * 2) return dx > 0 ? '横' : '撇';
            if (dx > 0 && dy < 0) return '捺';
            if (dx < 0 && dy < 0) return '撇';
            return absDx > absDy ? '横' : '竖';
        }
    }

    calculatePathLength(points) {
        let len = 0;
        for (let i = 1; i < points.length; i++) {
            len += Math.sqrt(Math.pow(points[i][0] - points[i - 1][0], 2) + Math.pow(points[i][1] - points[i - 1][1], 2));
        }
        return len;
    }

    findMaxDeviation(points, start, end) {
        const a = end[1] - start[1], b = start[0] - end[0], c = end[0] * start[1] - end[1] * start[0];
        const denom = Math.sqrt(a * a + b * b) || 1;
        let maxDist = 0, maxIdx = 0;
        for (let i = 1; i < points.length - 1; i++) {
            const d = Math.abs(a * points[i][0] + b * points[i][1] + c) / denom;
            if (d > maxDist) { maxDist = d; maxIdx = i; }
        }
        return { index: maxIdx, distance: maxDist };
    }

    detectHook(points, totalLength) {
        const n = points.length; if (n < 5) return null;
        let bHook = null;
        for (let i = Math.floor(n * 0.6); i < n - 1; i++) {
            const hV = { dx: points[n - 1][0] - points[i][0], dy: points[n - 1][1] - points[i][1] };
            const aDiff = Math.abs(Math.atan2(points[i][1] - points[0][1], points[i][0] - points[0][0]) - Math.atan2(hV.dy, hV.dx));
            const finalDiff = aDiff > Math.PI ? 2 * Math.PI - aDiff : aDiff;
            if (finalDiff > (100 * Math.PI / 180) && hV.dy > 10 && Math.sqrt(hV.dx * hV.dx + hV.dy * hV.dy) > 20) bHook = hV;
        }
        return bHook;
    }

    getBodyCurvature(points) {
        const subset = points.slice(0, Math.floor(points.length * 0.7));
        if (subset.length < 2) return 1;
        const chord = Math.sqrt(Math.pow(subset[subset.length - 1][0] - subset[0][0], 2) + Math.pow(subset[subset.length - 1][1] - subset[0][1], 2));
        return this.calculatePathLength(subset) / Math.max(1, chord);
    }

    getDir(v) {
        const absDx = Math.abs(v.dx), absDy = Math.abs(v.dy);
        if (absDx > absDy * 1.1) return v.dx > 0 ? "横" : "撇";
        return v.dy < 0 ? "竖" : "提";
    }

    stopAnimation() {
        this.isPlaying = false;
        this.dom.playBtn.textContent = '播放';
        this.dom.playBtn.classList.remove('btn-secondary');
        this.dom.playBtn.classList.add('btn-primary');
    }

    clearAll() {
        console.log('清空所有');
        this.writers.clear();
        this.currentUniqueIds = [];
        this.dom.grid.innerHTML = '';
        this.showPlaceholder();
        this.stopAnimation();
    }

    showPlaceholder() {
        this.dom.grid.innerHTML = '<div class="placeholder">请输入汉字后按回车键或点击播放</div>';
    }

    showError(message) {
        this.dom.grid.innerHTML = `<div class="error-message">${message}</div>`;
    }

    initSpeech() {
        if (!this.speechSynthesis) return;
        this.speechSynthesis.getVoices();
        const testUtterance = new SpeechSynthesisUtterance('');
        this.speechSynthesis.speak(testUtterance);
        this.speechSynthesis.cancel();
        console.log('✅ 语音已初始化');
    }

    speak(text) {
        if (!this.speechSynthesis) {
            console.warn('❌ 语音合成不可用');
            return;
        }

        const voices = this.speechSynthesis.getVoices();
        const chineseVoice = voices.find(v => v.lang.includes('zh'));
        if (!chineseVoice) {
            console.warn('⚠️ 未找到中文语音', voices.map(v => v.lang));
        }

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

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

window.addEventListener('DOMContentLoaded', () => {
    console.log('✅ DOMContentLoaded 事件触发');
    console.log('document.readyState：', document.readyState);

    if (!window.app) {
        console.log('初始化应用...');
        window.app = new HanziStrokeApp();
        console.log('✅ 应用初始化完成');
    }
});

window.addEventListener('load', () => {
    console.log('✅ load 事件触发');
    if (!window.app) {
        console.log('通过load事件初始化应用...');
        window.app = new HanziStrokeApp();
    }
});

if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => {
        console.log('✅ 语音列表已加载', window.speechSynthesis.getVoices().map(v => v.lang));
    };
}
