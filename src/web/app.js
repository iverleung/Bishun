import { CharacterStore } from '../data/character-store.js';
import { PlaybackController } from '../playback/controller.js';
import { HanziAnimation } from '../playback/hanzi-animation.js';
import { StrokeAudio } from '../playback/stroke-audio.js';
import { QueryHistory } from './history.js';
import { defaultPreferences, loadPreferences, savePreferences } from './preferences.js';
import { SavedQueries } from './saved-queries.js';
import { createSavedLibrary } from './saved-library.js';
import { setupSharing, readSharedQuery, clearSharedQuery } from './share.js';

const dom = Object.fromEntries(Array.from(document.querySelectorAll('[id]'), el => [el.id, el]));
const svgNamespace = 'http://www.w3.org/2000/svg';
let queueKey = '';
let strokeListKey = '';
let canvasKey = '';
let renderedSelection = '';
let pendingArrival = null;
let arrivalAnimation = null;
let queueAnimations = [];
let historyStorage = null;
try { historyStorage = window.localStorage; } catch { /* Private/restricted storage may throw. */ }
const history = new QueryHistory(historyStorage);
const savedQueries = new SavedQueries(historyStorage);

const store = new CharacterStore();
const audio = new StrokeAudio();
const animation = new HanziAnimation(dom.animationLayer);
const player = new PlaybackController({ store, audio, animation, onChange: render });
let focusMode = false;
let ownsFullscreen = false;
let focusSettingsOpen = false;

function applyPreferences(preferences) {
    player.pause();
    Object.assign(player, { mode: preferences.mode, speed: preferences.speed, group: preferences.group });
    player.setSpeech(preferences.speechEnabled);
    for (const el of document.querySelectorAll('[name="mode"]')) el.checked = el.value === preferences.mode;
    dom.speedSlider.value = preferences.speed;
    dom.speedValue.textContent = ['极慢', '较慢', '正常', '较快', '极快'][preferences.speed - 1];
    dom.gridToggle.checked = preferences.grid;
    dom.outlineToggle.checked = preferences.outline;
    dom.writingGrid.classList.toggle('no-grid', !preferences.grid);
    dom.writingGrid.classList.toggle('no-outline', !preferences.outline);
}

function rememberPreferences() {
    savePreferences(historyStorage, {
        mode: player.mode, speed: player.speed, group: player.group, speechEnabled: player.speechEnabled,
        grid: dom.gridToggle.checked, outline: dom.outlineToggle.checked
    });
}

function setFocusMode(enabled) {
    if (focusMode === enabled) return;
    if (enabled) { focusSettingsOpen = dom.settings.open; dom.settings.open = false; }
    else dom.settings.open = focusSettingsOpen;
    focusMode = enabled;
    document.body.classList.toggle('focus-mode', enabled);
    dom.exitFocusBtn.hidden = !enabled;
    if (enabled) dom.exitFocusBtn.focus({ preventScroll: true });
    else if (player.entries.length) dom.fullscreenBtn.focus({ preventScroll: true });
    updateQueueTabStops();
}

async function exitFocusMode() {
    setFocusMode(false);
    if (ownsFullscreen && document.fullscreenElement) {
        try { await document.exitFullscreen(); } catch { /* The browser may have already exited. */ }
    }
    ownsFullscreen = false;
}

function unlockAudio() {
    const revision = player.revision;
    void audio.unlock().then(() => {
        if (revision === player.revision && player.speechEnabled) return audio.preload(player.names, { signal: player.queryTask.signal });
    }).catch(() => {
        if (revision === player.revision && player.speechEnabled) { player.audioWarning = '声音未能启用，可静音继续'; player.notify(); }
    });
}

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

function createQueuedCharacter(char, index) {
    const el = button('', async () => {
        const revision = player.revision;
        await player.select(index);
        if (revision !== player.revision || index !== player.index) return;
        if (!dom.playBtn.disabled) dom.playBtn.focus({ preventScroll: true });
        else if (!dom.nextCharBtn.disabled) dom.nextCharBtn.focus({ preventScroll: true });
        else dom.previousCharBtn.focus({ preventScroll: true });
    });
    el.dataset.index = String(index);
    const record = player.records.get(char);
    const failed = player.errors.has(char);
    el.setAttribute('aria-label', `${char}，第 ${index + 1} 字${failed ? '，加载失败' : ''}`);
    if (record) {
        const svg = document.createElementNS(svgNamespace, 'svg');
        svg.setAttribute('viewBox', '0 0 1024 1024');
        svg.setAttribute('aria-hidden', 'true');
        const group = document.createElementNS(svgNamespace, 'g');
        group.setAttribute('transform', 'translate(0, 900) scale(1,-1)');
        group.append(...record.data.strokes.map(path));
        svg.append(group);
        el.append(svg);
    } else {
        el.textContent = char;
        el.className = `fallback-character${failed ? ' failed' : ''}`;
    }
    return el;
}

function updateQueue(state) {
    const selection = `${JSON.stringify(state.entries)}:${state.index}`;
    const selected = selection !== renderedSelection;
    const key = `${selection}:${[...state.records.keys()].join('')}:${[...state.errors.keys()].join('')}:${state.status === 'loading'}`;
    if (key === queueKey) return;
    const sameQuery = queueKey.split(':')[0] === JSON.stringify(state.entries);
    const queues = [dom.previousCharacterList, dom.characterList];
    const oldButtons = queues.flatMap(queue => Array.from(queue.children));
    const previousRects = new Map(oldButtons.map(el => [el.dataset.index, el.getBoundingClientRect()]));
    const incoming = sameQuery ? oldButtons.find(el => el.dataset.index === String(state.index)) : null;
    const source = incoming?.querySelector('svg') || incoming;
    const rect = source?.getBoundingClientRect();
    const sourceRect = rect && rect.right > 0 && rect.left < document.documentElement.clientWidth ? rect : null;
    const queueHadFocus = queues.some(queue => queue.contains(document.activeElement));
    queueKey = key;
    if (selected) { pendingArrival = { sourceRect }; arrivalAnimation?.cancel(); }
    renderedSelection = selection;
    queueAnimations.forEach(animation => animation.cancel());
    queueAnimations = [];
    dom.previousCharacterList.replaceChildren(...state.entries.slice(0, state.index).map(createQueuedCharacter));
    dom.characterList.replaceChildren(...state.entries.slice(state.index + 1).map((char, offset) => createQueuedCharacter(char, state.index + offset + 1)));
    updateQueueTabStops();
    // View-only transitions never delay playback or update its state.
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
        typeof dom.characterInk.animate === 'function' && state.entries.length) {
        const target = dom.writingGrid.getBoundingClientRect();
        if (pendingArrival && target.width && state.data && state.status !== 'loading') {
            const sourceRect = pendingArrival.sourceRect;
            pendingArrival = null;
            const dx = sourceRect ? (sourceRect.x + sourceRect.width / 2 - target.x - target.width / 2) * 1024 / target.width : 70;
            const dy = sourceRect ? (sourceRect.y + sourceRect.height / 2 - target.y - target.height / 2) * 1024 / target.height : 0;
            const scale = sourceRect ? sourceRect.width / target.width : 0.96;
            arrivalAnimation = dom.characterInk.animate([
                { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.4 },
                { transform: 'translate(0, 0) scale(1)', opacity: 1 }
            ], { duration: 300, easing: 'cubic-bezier(.2,.75,.25,1)' });
        }
        for (const el of queues.flatMap(queue => Array.from(queue.children))) {
            const before = sameQuery ? previousRects.get(el.dataset.index) : null;
            const after = el.getBoundingClientRect();
            if (selected && before) {
                queueAnimations.push(el.animate([
                    { transform: `translateX(${before.x - after.x}px)` },
                    { transform: 'translateX(0)' }
                ], { duration: 300, easing: 'cubic-bezier(.2,.75,.25,1)' }));
            }
        }
    }
    if (queueHadFocus && !dom.playBtn.disabled) dom.playBtn.focus({ preventScroll: true });
}

function updateQueueTabStops() {
    for (const queue of [dom.previousCharacterList, dom.characterList]) {
        const bounds = queue.getBoundingClientRect();
        for (const el of queue.children) {
            const rect = el.getBoundingClientRect();
            // Offscreen entries remain reachable through the centered previous/next controls.
            el.tabIndex = rect.right > bounds.left && rect.left < bounds.right ? 0 : -1;
        }
    }
}

function renderHistory() {
    dom.historyRow.hidden = history.items.length === 0;
    dom.historyList.replaceChildren(...history.items.map(item => {
        const el = button(item, () => {
            dom.query.value = item;
            query(item);
            if (!dom.playBtn.disabled) dom.playBtn.focus({ preventScroll: true });
        });
        el.title = item;
        return el;
    }));
    dom.historyList.scrollLeft = 0;
}

function savedFeedback(message, visible = false, target = dom.savedFeedback) {
    target.textContent = message;
    target.className = visible ? 'notice' : 'sr-only';
}

const library = createSavedLibrary({
    dom, savedQueries,
    openQuery(value) {
        dom.query.value = value;
        query(value);
        dom.savedQueries.open = false;
        dom.query.focus({ preventScroll: true });
    },
    feedback: savedFeedback,
    changed() { savedFeedback('', false, dom.saveActionFeedback); player.notify(); }
});

function renderSavedQueries() { library.render(); }

function saveQuery(value) {
    const result = savedQueries.save(value);
    if (result.status === 'saved') {
        renderSavedQueries();
        savedFeedback(result.persisted ? '已收藏' : '已收藏，仅本次打开有效', !result.persisted, dom.saveActionFeedback);
        player.notify();
        // The save button is now disabled; retain a visible keyboard target.
        dom.settings.querySelector('summary').focus({ preventScroll: true });
    } else if (result.status === 'full') savedFeedback('生字本已满（30 条），请先删除一条', true, dom.saveActionFeedback);
}

function render(state) {
    const data = state.data;
    const available = Boolean(data) && !['empty', 'loading', 'error'].includes(state.status);
    const count = available ? data.strokes.length : 0;
    const names = state.names;
    if (state.status === 'playing') { arrivalAnimation?.cancel(); pendingArrival = null; }
    const focused = state.active ?? state.completed - 1;
    document.body.dataset.phase = state.entries.length ? 'lesson' : 'search';
    dom.lesson.hidden = state.entries.length === 0;
    dom.clearBtn.hidden = !dom.query.value && !state.entries.length;
    dom.wordPosition.textContent = state.entries.length ? `${state.index + 1} / ${state.entries.length}` : '';
    dom.writingGrid.hidden = !available;
    dom.stageMessage.hidden = available;
    dom.retryBtn.hidden = state.status !== 'error';
    if (!available) {
        const messages = {
            empty: ['', ''],
            loading: ['加载中…', ''],
            paused: ['已暂停', ''],
            error: [state.errors.get(state.entry)?.code === 'UNSUPPORTED' ? '暂未收录' : '加载失败', state.errors.get(state.entry)?.message || '请重试或切换其他字']
        };
        const [title, description] = messages[state.status] || messages.empty;
        dom.stageMessageTitle.textContent = title;
        dom.stageMessageText.textContent = description;
    }
    const listStrokeKey = available ? state.entry : '';
    if (listStrokeKey !== strokeListKey) {
        strokeListKey = listStrokeKey;
        dom.strokeList.replaceChildren(...(available ? names.map((name, index) => {
            const el = button('', () => state.seek(index + 1));
            const number = document.createElement('span');
            number.textContent = String(index + 1).padStart(2, '0');
            el.append(number, document.createTextNode(name || '暂缺'));
            el.setAttribute('aria-label', `第 ${index + 1} 笔，${name || '名称暂缺'}`);
            return el;
        }) : []));
    }
    Array.from(dom.strokeList.children).forEach((el, index) => el.setAttribute('aria-pressed', String(!state.showFull && index === focused)));
    const paintKey = [state.index, state.entry, available, state.showFull, state.completed, state.active].join(':');
    if (paintKey !== canvasKey) {
        canvasKey = paintKey;
        dom.outlinePaths.replaceChildren(...(available ? data.strokes.map(path) : []));
        const displayed = state.showFull ? count : state.completed;
        dom.strokePaths.replaceChildren(...(available ? data.strokes.slice(0, displayed).map((d, index) => {
            const el = path(d);
            el.classList.toggle('current-stroke', !state.showFull && index === focused);
            return el;
        }) : []));
        dom.characterCanvas.setAttribute('aria-label', available ? `${state.entry}，${state.showFull ? '完整字形' : state.active !== null ? `正在书写第 ${state.active + 1} 笔` : `展示到第 ${displayed} 笔`}` : '等待查询');
    }
    dom.strokePosition.textContent = !available ? '' : state.showFull ? `${count} 笔` : `${Math.max(0, focused + 1)} / ${count} 笔`;
    dom.strokeName.textContent = !available || state.showFull ? '' : names[focused] || (focused >= 0 ? '暂缺' : '');
    const labels = { ready: '播放', playing: '暂停', paused: '继续', complete: '重播' };
    dom.playBtn.textContent = state.status === 'loading' && state.isRunning ? '暂停' : labels[state.status] || '播放';
    dom.playBtn.disabled = !available && !state.isRunning && !(state.status === 'paused' && state.resumeIndex !== null);
    dom.restartBtn.disabled = !available;
    dom.replayStrokeBtn.disabled = !available || state.showFull || focused < 0;
    dom.previousStrokeBtn.disabled = !available || state.showFull || state.completed === 0;
    dom.nextStrokeBtn.disabled = !available || (!state.showFull && state.completed >= count);
    dom.previousCharBtn.disabled = state.entries.length === 0 || state.index === 0;
    dom.nextCharBtn.disabled = state.entries.length === 0 || state.index >= state.entries.length - 1;
    dom.restartGroupBtn.disabled = !state.entries.length;
    dom.groupMode.checked = state.group;
    dom.speechToggle.checked = state.speechEnabled;
    const savedCharacter = savedQueries.items.includes(state.entry);
    const savedQuery = savedQueries.items.includes(state.entries.join(''));
    dom.saveCharacterBtn.disabled = !available || savedCharacter;
    dom.saveCharacterBtn.textContent = savedCharacter ? '当前字已收藏' : '收藏当前字';
    dom.saveQueryBtn.hidden = state.entries.length < 2;
    dom.saveQueryBtn.disabled = !state.entries.length || savedQuery;
    dom.saveQueryBtn.textContent = savedQuery ? '这组字已收藏' : '收藏这组字';
    updateQueue(state);
    const statuses = {
        empty: '请输入汉字', ready: `${state.entry}，${count} 笔`,
        playing: `正在播放${state.entry}，第 ${focused + 1} 笔`,
        paused: '已暂停', complete: state.groupComplete && state.skipped ? `播放完成，跳过 ${state.skipped} 个未收录字` : '播放完成',
        loading: '加载中', error: '当前字不可用'
    };
    const showNotice = state.audioWarning || (state.groupComplete && state.skipped > 0);
    dom.status.classList.toggle('sr-only', !showNotice);
    dom.status.textContent = state.audioWarning || statuses[state.status];
}

function query(value, fromLink = false) {
    if (!fromLink) clearSharedQuery();
    savedFeedback('');
    savedFeedback('', false, dom.saveActionFeedback);
    const result = player.query(value);
    const notes = [];
    if (result.filtered) notes.push('已忽略非汉字内容。');
    if (result.truncated) notes.push('仅查询前 20 个汉字。');
    dom.queryNotice.textContent = notes.join(' ');
    dom.queryNotice.hidden = notes.length === 0;
    if (!player.entries.length) dom.settings.open = false;
    if (player.entries.length) history.remember(player.entries.join(''));
    renderHistory();
}

let composing = false;
dom.query.addEventListener('input', () => { dom.clearBtn.hidden = !dom.query.value && !player.entries.length; });
dom.query.addEventListener('compositionstart', () => { composing = true; });
dom.query.addEventListener('compositionend', () => { composing = false; });
dom.query.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || composing || event.keyCode === 229)) event.preventDefault();
});
dom.searchForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!composing) {
        query(dom.query.value);
        if (!dom.playBtn.disabled && player.entries.length) dom.playBtn.focus({ preventScroll: true });
    }
});
document.querySelectorAll('[data-query]').forEach(el => el.addEventListener('click', () => {
    dom.query.value = el.dataset.query;
    query(el.dataset.query);
}));
dom.clearBtn.addEventListener('click', () => {
    if (focusMode) void exitFocusMode();
    dom.query.value = '';
    query('');
    dom.query.focus();
});
dom.clearHistoryBtn.addEventListener('click', () => {
    history.clear();
    renderHistory();
    dom.query.focus();
});
dom.playBtn.addEventListener('click', () => {
    if (player.speechEnabled) unlockAudio();
    if (player.isRunning) player.pause();
    else player.play();
});
dom.restartBtn.addEventListener('click', () => { if (player.speechEnabled) unlockAudio(); void player.play({ restart: true }); });
dom.replayStrokeBtn.addEventListener('click', () => { if (player.speechEnabled) unlockAudio(); void player.play({ oneStroke: true }); });
dom.previousStrokeBtn.addEventListener('click', () => player.seek(player.completed - 1));
dom.nextStrokeBtn.addEventListener('click', () => player.seek(player.showFull ? 1 : player.completed + 1));
dom.previousCharBtn.addEventListener('click', () => player.select(player.index - 1));
dom.nextCharBtn.addEventListener('click', () => player.select(player.index + 1));
dom.restartGroupBtn.addEventListener('click', () => { if (player.speechEnabled) unlockAudio(); void player.restartGroup(); });
dom.groupMode.addEventListener('change', () => { player.group = dom.groupMode.checked; });
document.querySelectorAll('[name="mode"]').forEach(el => el.addEventListener('change', () => {
    player.setMode(el.value);
    if (player.speechEnabled) unlockAudio();
}));
dom.speedSlider.addEventListener('input', () => {
    player.speed = Number(dom.speedSlider.value);
    dom.speedValue.textContent = ['极慢', '较慢', '正常', '较快', '极快'][player.speed - 1];
});
dom.speechToggle.addEventListener('change', () => { player.setSpeech(dom.speechToggle.checked); if (player.speechEnabled) unlockAudio(); });
dom.gridToggle.addEventListener('change', () => dom.writingGrid.classList.toggle('no-grid', !dom.gridToggle.checked));
dom.outlineToggle.addEventListener('change', () => dom.writingGrid.classList.toggle('no-outline', !dom.outlineToggle.checked));
dom.retryBtn.addEventListener('click', () => player.select(player.index));
dom.saveCharacterBtn.addEventListener('click', () => saveQuery(player.entry));
dom.saveQueryBtn.addEventListener('click', () => saveQuery(player.entries.join('')));
dom.printQueryBtn.addEventListener('click', () => {
    if (!player.entries.length) return;
    player.pause();
    const url = new URL('/print/index.html', location.href);
    url.hash = new URLSearchParams({ q: player.entries.join(''), c: String(player.index) }).toString();
    location.assign(url.href);
});
dom.settings.addEventListener('change', rememberPreferences);
dom.resetSettingsBtn.addEventListener('click', () => {
    applyPreferences(defaultPreferences);
    rememberPreferences();
});
dom.fullscreenBtn.addEventListener('click', async () => {
    setFocusMode(true);
    if (!document.fullscreenElement && document.fullscreenEnabled && document.documentElement.requestFullscreen) {
        try {
            await document.documentElement.requestFullscreen();
            ownsFullscreen = true;
            // Exit may have been requested while the browser was entering fullscreen.
            if (!focusMode) await exitFocusMode();
        } catch { /* Keep the same usable focus layout when native fullscreen is unavailable. */ }
    }
});
dom.exitFocusBtn.addEventListener('click', () => void exitFocusMode());
document.addEventListener('fullscreenchange', () => {
    if (ownsFullscreen && !document.fullscreenElement) { ownsFullscreen = false; setFocusMode(false); }
    updateQueueTabStops();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && focusMode) { event.preventDefault(); void exitFocusMode(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) player.pause(); });
window.addEventListener('pagehide', () => player.pause());
window.addEventListener('resize', updateQueueTabStops);
applyPreferences(loadPreferences(historyStorage));
renderSavedQueries();
setupSharing({ dom, getSelection: () => ({ character: player.entry, group: player.entries.join('') }) });
function restoreSharedQuery() {
    const shared = readSharedQuery(location.href);
    dom.query.value = shared.status === 'valid' ? shared.query : '';
    query(dom.query.value, true);
    if (shared.status === 'invalid') {
        dom.queryNotice.textContent = '分享链接无效，请输入 1—20 个汉字';
        dom.queryNotice.hidden = false;
    }
}
window.addEventListener('hashchange', restoreSharedQuery);
restoreSharedQuery();
