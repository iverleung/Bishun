import { samples } from './samples.js';
import { PreviewPlayer } from './player.js';

const dom = Object.fromEntries(Array.from(document.querySelectorAll('[id]'), el => [el.id, el]));
const svgNamespace = 'http://www.w3.org/2000/svg';
let characterListKey = '';
let strokeListKey = '';
let canvasKey = '';
let audioNotice = false;

const player = new PreviewPlayer(samples, render);

function button(text, onClick) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    el.addEventListener('click', onClick);
    return el;
}

function path(d) {
    const el = document.createElementNS(svgNamespace, 'path');
    el.setAttribute('d', d);
    return el;
}

function render(state) {
    const data = state.data;
    const available = Boolean(data) && !['empty', 'loading', 'error'].includes(state.status);
    const count = available ? data.strokes.length : 0;
    const focused = state.active ?? state.completed - 1;
    const listKey = JSON.stringify(state.entries);
    if (listKey !== characterListKey) {
        characterListKey = listKey;
        dom.characterList.replaceChildren(...state.entries.map((char, index) => {
            const el = button(char, () => state.select(index));
            el.classList.toggle('failed', !samples[char]);
            el.setAttribute('aria-label', `${char}，第 ${index + 1} 字${samples[char] ? '' : '，无预览数据'}`);
            return el;
        }));
    }
    Array.from(dom.characterList.children).forEach((el, index) => el.setAttribute('aria-pressed', String(index === state.index)));
    const unsupported = state.entries.filter(char => !samples[char]).length;
    dom.listSummary.textContent = state.entries.length ? `${state.entries.length} 个字${unsupported ? ` · ${unsupported} 个字无预览数据` : ' · 点选切换'}` : '查询后，字会出现在这里。';
    dom.clearBtn.disabled = state.entries.length === 0;
    // Keep the heading's metadata span intact.
    dom.characterTitle.firstChild.textContent = state.entry || '字';
    dom.strokeTotal.textContent = available ? `${count} 画` : '';
    dom.wordPosition.textContent = state.entries.length ? `第 ${state.index + 1} / ${state.entries.length} 字` : '等待查询';
    dom.stepCount.textContent = available ? `共 ${count} 笔` : '暂无笔画';

    dom.writingGrid.hidden = !available;
    dom.stageMessage.hidden = available;
    dom.stageCaption.hidden = !available;
    dom.retryBtn.hidden = state.status !== 'error';
    if (!available) {
        const messages = {
            empty: ['从一个字开始', '输入汉字，或点左侧示例字单，看看每一笔怎么写。'],
            loading: ['正在准备这个字', '字形准备好后就能开始。你也可以切换到其他字。'],
            error: ['这个字暂时看不了', samples[state.entry] ? '模拟加载失败。可以重试，或先查看其他字。' : '交互预览仅收录木、水、心、我、山、田。可先查看其他示例字。']
        };
        const [title, description] = messages[state.status] || messages.empty;
        dom.stageMessageTitle.textContent = title;
        dom.stageMessageText.textContent = description;
    }

    const listStrokeKey = available ? state.entry : '';
    if (listStrokeKey !== strokeListKey) {
        strokeListKey = listStrokeKey;
        dom.strokeList.replaceChildren(...(available ? data.names.map((name, index) => {
            const el = button('', () => state.seek(index + 1));
            const number = document.createElement('span');
            number.textContent = String(index + 1).padStart(2, '0');
            el.append(number, document.createTextNode(name));
            el.setAttribute('aria-label', `第 ${index + 1} 笔，${name}`);
            return el;
        }) : []));
    }
    Array.from(dom.strokeList.children).forEach((el, index) => {
        el.setAttribute('aria-pressed', String(!state.showFull && index === focused));
    });

    const paintKey = [state.entry, available, state.showFull, state.completed, state.active].join(':');
    if (paintKey !== canvasKey) {
        canvasKey = paintKey;
        dom.outlinePaths.replaceChildren(...(available ? data.strokes.map(path) : []));
        const displayed = state.showFull ? count : state.completed + (state.active === null ? 0 : 1);
        dom.strokePaths.replaceChildren(...(available ? data.strokes.slice(0, displayed).map((d, index) => {
            const el = path(d);
            el.classList.toggle('current-stroke', !state.showFull && index === focused);
            el.classList.toggle('preview-stroke', index === state.active);
            return el;
        }) : []));
        dom.characterCanvas.style.setProperty('--stroke-duration', `${state.duration}ms`);
        dom.characterCanvas.setAttribute('aria-label', available ? `${state.entry}，${state.showFull ? '完整字形' : `展示到第 ${displayed} 笔`}` : '等待查询');
    }

    dom.strokePosition.textContent = !available ? '等待字形' : state.showFull ? '完整字形' : focused >= 0 ? `第 ${focused + 1} / ${count} 笔` : `0 / ${count} 笔`;
    dom.strokeName.textContent = !available ? '—' : state.showFull ? '准备好了吗？' : data.names[focused] || '准备落笔';
    dom.stageCaption.textContent = state.showFull ? '先看完整字形，再开始示范' : state.status === 'playing' ? '留意绿色的这一笔' : '按自己的节奏，一笔一画来';
    const labels = { ready: '开始示范', playing: '暂停', paused: '继续', complete: '重播' };
    dom.playBtn.textContent = labels[state.status] || '开始示范';
    dom.playBtn.disabled = !available;
    dom.restartBtn.disabled = !available;
    dom.replayStrokeBtn.disabled = !available || state.showFull || focused < 0;
    dom.previousStrokeBtn.disabled = !available || state.showFull || state.completed === 0;
    dom.nextStrokeBtn.disabled = !available || (!state.showFull && state.completed >= count);
    dom.previousCharBtn.disabled = state.entries.length === 0 || state.index === 0;
    dom.nextCharBtn.disabled = state.entries.length === 0 || state.index >= state.entries.length - 1;
    dom.restartGroupBtn.disabled = !state.entries.some(char => samples[char]);
    dom.groupMode.checked = state.group;

    const statuses = {
        empty: '选一个字，开始看笔顺。',
        ready: '字形已准备好。点击“开始示范”，从第一笔看起。',
        playing: state.mode === 'follow' ? '示范这一笔，接着就轮到你。' : state.group ? '正在按字单顺序示范。' : '正在示范，随时可以暂停。',
        paused: state.mode === 'follow' ? '写好了吗？点击“继续”，看下一笔。' : '已暂停。可以继续，或点选任意一笔。',
        complete: state.groupComplete ? state.skipped ? `可用字已完成，跳过 ${state.skipped} 个无预览数据的字。` : '整组示范完成。你可以重播这个字，或整组从头播放。' : '这个字示范完成。再看一遍，或试着自己写。',
        loading: '正在加载；可随时切字或清空。',
        error: '这个字暂不可用，其他示例字仍可查看。'
    };
    dom.status.textContent = audioNotice ? '声音暂不可用，示范可静音继续。此交互预览尚未接入录音。' : statuses[state.status];
}

function query(value) {
    audioNotice = false;
    const result = player.query(value);
    const notes = [];
    if (result.filtered) notes.push('已忽略非汉字内容，原始输入仍保留。');
    if (result.truncated) notes.push('仅查询前 20 个汉字，其余内容仍保留在输入框。');
    dom.queryNotice.textContent = notes.join(' ');
    dom.queryNotice.hidden = notes.length === 0;
}

let composing = false;
dom.query.addEventListener('compositionstart', () => { composing = true; });
dom.query.addEventListener('compositionend', () => { composing = false; });
dom.query.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || composing || event.keyCode === 229)) event.preventDefault();
});
dom.searchForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!composing) query(dom.query.value);
});
document.querySelectorAll('[data-query]').forEach(el => el.addEventListener('click', () => {
    dom.query.value = el.dataset.query;
    query(el.dataset.query);
}));
dom.clearBtn.addEventListener('click', () => {
    dom.query.value = '';
    query('');
    dom.query.focus();
});
dom.playBtn.addEventListener('click', () => {
    audioNotice = false;
    if (player.status === 'playing') player.pause();
    else player.play();
});
dom.restartBtn.addEventListener('click', () => player.play({ restart: true }));
dom.replayStrokeBtn.addEventListener('click', () => player.play({ oneStroke: true }));
dom.previousStrokeBtn.addEventListener('click', () => player.seek(player.completed - 1));
dom.nextStrokeBtn.addEventListener('click', () => player.seek(player.showFull ? 1 : player.completed + 1));
dom.previousCharBtn.addEventListener('click', () => player.select(player.index - 1));
dom.nextCharBtn.addEventListener('click', () => player.select(player.index + 1));
dom.restartGroupBtn.addEventListener('click', () => player.restartGroup());
dom.groupMode.addEventListener('change', () => { player.group = dom.groupMode.checked; });
document.querySelectorAll('[name="mode"]').forEach(el => el.addEventListener('change', () => {
    audioNotice = false;
    player.setMode(el.value);
}));
dom.speedSlider.addEventListener('input', () => {
    player.speed = Number(dom.speedSlider.value);
    dom.speedValue.textContent = ['极慢', '较慢', '正常', '较快', '极快'][player.speed - 1];
});
dom.speechToggle.addEventListener('change', () => {
    audioNotice = dom.speechToggle.checked;
    render(player);
});
dom.gridToggle.addEventListener('change', () => dom.writingGrid.classList.toggle('no-grid', !dom.gridToggle.checked));
dom.outlineToggle.addEventListener('change', () => dom.writingGrid.classList.toggle('no-outline', !dom.outlineToggle.checked));
dom.emptyScenario.addEventListener('click', () => { dom.query.value = ''; query(''); });
dom.loadingScenario.addEventListener('click', () => {
    if (!player.entries.length) query('木');
    player.scenario('loading');
});
dom.errorScenario.addEventListener('click', () => {
    if (!player.entries.length) query('木');
    player.scenario('error');
});
dom.audioScenario.addEventListener('click', () => { audioNotice = true; render(player); });
dom.retryBtn.addEventListener('click', () => player.select(player.index));
document.addEventListener('visibilitychange', () => { if (document.hidden) player.pause(); });
window.addEventListener('pagehide', () => player.pause());

query(dom.query.value);
