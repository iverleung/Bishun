class HanziStrokeApp {
    constructor() {
        this.writers = new Map();
        this.currentFont = localStorage.getItem('hanzi-font') || 'sans-serif';
        this.isPlaying = false;
        this.isRendering = false;  // 添加渲染标志

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
        this.loadFont();

        console.log('✅ HanziStrokeApp 初始化完成');
    }

    cacheDOM() {
        this.dom = {
            input: document.getElementById('charInput'),
            clearBtn: document.getElementById('clearBtn'),
            playBtn: document.getElementById('playBtn'),
            fontSelect: document.getElementById('fontSelect'),
            grid: document.getElementById('characterGrid')
        };

        console.log('DOM 元素缓存完成：', {
            input: !!this.dom.input,
            clearBtn: !!this.dom.clearBtn,
            playBtn: !!this.dom.playBtn,
            fontSelect: !!this.dom.fontSelect,
            grid: !!this.dom.grid
        });
    }

    bindEvents() {
        console.log('绑定事件...');

        this.dom.input.addEventListener('input', (e) => {
            console.log('input事件触发，值：', e.target.value);
        });

        this.dom.input.addEventListener('keydown', (e) => {
            console.log('keydown事件，按键：', e.key);

            if (e.key === 'Enter') {
                e.preventDefault();
                this.handleRender();
            }
        });

        this.dom.clearBtn.addEventListener('click', () => {
            console.log('清空按钮点击');
            this.clearAll();
        });

        this.dom.playBtn.addEventListener('click', () => {
            console.log('播放按钮点击');
            this.handleRender();
        });

        this.dom.fontSelect.addEventListener('change', (e) => {
            console.log('字体改变：', e.target.value);
            this.changeFont(e);
        });

        console.log('✅ 事件绑定完成');
    }

    loadFont() {
        console.log('加载字体：', this.currentFont);
        this.dom.fontSelect.value = this.currentFont;
        this.applyFont();
    }

    applyFont() {
        document.body.style.fontFamily = `-apple-system, BlinkMacSystemFont, "${this.currentFont}", sans-serif`;
        console.log('已应用字体：', this.currentFont);
    }

    changeFont(e) {
        this.currentFont = e.target.value;
        localStorage.setItem('hanzi-font', this.currentFont);
        this.applyFont();
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

        const label = document.createElement('div');
        label.className = 'character-label';
        label.textContent = char;
        card.appendChild(label);

        const controls = document.createElement('div');
        controls.className = 'card-controls';

        const playBtn = document.createElement('button');
        playBtn.className = 'card-btn';
        playBtn.textContent = '播放';
        playBtn.onclick = () => this.animateSingle(uniqueId);
        controls.appendChild(playBtn);

        const resetBtn = document.createElement('button');
        resetBtn.className = 'card-btn';
        resetBtn.textContent = '重置';
        resetBtn.onclick = () => this.resetSingle(uniqueId);
        controls.appendChild(resetBtn);

        card.appendChild(controls);

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
                width: 120,
                height: 120,
                padding: 10,
                strokeColor: '#333',
                outlineColor: '#DDD',
                delayBetweenStrokes: 800,
                strokeAnimationSpeed: 1,
                showOutline: true,
                showCharacter: true
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

        await writer.animateCharacter();

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

        await writer.animateCharacter();

        card.classList.remove('active');
        card.classList.add('completed');

        setTimeout(() => card.classList.remove('completed'), 2000);
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

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

window.addEventListener('DOMContentLoaded', () => {
    console.log('✅ DOMContentLoaded 事件触发');
    console.log('document.readyState：', document.readyState);

    setTimeout(() => {
        console.log('初始化应用...');
        window.app = new HanziStrokeApp();
        window.app = window.app;
        console.log('✅ 应用初始化完成');
    }, 100);
});

window.addEventListener('load', () => {
    console.log('✅ load 事件触发');
    if (!window.app) {
        console.log('通过load事件初始化应用...');
        window.app = new HanziStrokeApp();
    }
});
