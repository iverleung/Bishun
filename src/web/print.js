import { CharacterStore } from '../data/character-store.js';
import { characterBase } from '../data/character-data.js';
import { readSharedQuery, createShareUrl } from './share.js';
import { paginateCharacters } from './print-layout.js';

const dom = Object.fromEntries(Array.from(document.querySelectorAll('[id]'), el => [el.id, el]));
const store = new CharacterStore();
const svgNamespace = 'http://www.w3.org/2000/svg';
let characters = [];
let allCharacters = [];
let selectedIndex = 0;
let records = new Map();
let failures = new Map();
let license = '';
let revision = 0;
let task = null;

function svgElement(name, attributes) {
    const el = document.createElementNS(svgNamespace, name);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
    return el;
}

function createCell(record, ink) {
    const svg = svgElement('svg', { viewBox: '0 0 1024 1024', 'aria-hidden': 'true', class: `practice-cell ${ink}` });
    svg.append(svgElement('path', { d: 'M512 0V1024M0 512H1024', class: 'cell-grid' }));
    if (dom.gridStyle.value === 'mi') svg.append(svgElement('path', { d: 'M0 0L1024 1024M1024 0L0 1024', class: 'cell-grid' }));
    if (ink !== 'blank') {
        const group = svgElement('g', { transform: 'translate(0,900) scale(1,-1)' });
        for (const stroke of record.data.strokes) group.append(svgElement('path', { d: stroke }));
        svg.append(group);
    }
    return svg;
}

function createPage(number, total) {
    const page = document.createElement('section');
    page.className = 'print-page';
    const heading = document.createElement('h2');
    heading.textContent = '生字练习';
    const content = document.createElement('div');
    content.className = 'page-content';
    const footer = document.createElement('footer');
    footer.textContent = `笔顺 · 字形 © 1999 Arphic Technology · 许可见附页　${number} / ${total}`;
    page.append(heading, content, footer);
    return { page, content };
}

function render() {
    const valid = characters.filter(char => records.has(char));
    const options = { size: Number(dom.cellSize.value), rows: Number(dom.rowCount.value), grid: dom.gridStyle.value };
    const { layout, pages } = paginateCharacters(valid, options);
    const nodes = pages.map((chars, index) => {
        const { page, content } = createPage(index + 1, pages.length + 1);
        for (const char of chars) {
            const block = document.createElement('div');
            block.className = 'character-practice';
            block.setAttribute('aria-label', `${char}，范字、描红及空白练习`);
            block.style.setProperty('--cell-size', `${layout.size}mm`);
            block.style.gridTemplateColumns = `repeat(${layout.columns}, ${layout.size}mm)`;
            for (let cell = 0; cell < layout.columns * layout.rows; cell++) {
                block.append(createCell(records.get(char), cell === 0 ? 'model' : cell < 3 ? 'trace' : 'blank'));
            }
            content.append(block);
        }
        return page;
    });
    if (license && pages.length) {
        const { page, content } = createPage(pages.length + 1, pages.length + 1);
        page.classList.add('license-page');
        page.querySelector('h2').textContent = '字形来源与许可';
        const notice = document.createElement('p');
        notice.className = 'source-notice';
        notice.textContent = `来源：hanzi-writer-data@2.0.1 / Make Me a Hanzi。生成日期：${new Date().toISOString().slice(0, 10)}。字形转换为 SVG 范字与描红排版，原笔画路径未修改；许可及源数据：${new URL(characterBase + '/', location.href).href}`;
        const text = document.createElement('div');
        text.className = 'license-text';
        text.textContent = license;
        content.append(notice, text);
        nodes.push(page);
    }
    dom.printPages.replaceChildren(...nodes);
    document.body.dataset.ready = String(Boolean(license && valid.length && !failures.size && !task));
    dom.printBtn.disabled = document.body.dataset.ready !== 'true';
}

async function load() {
    task?.abort();
    const controller = new AbortController();
    task = controller;
    const current = ++revision;
    failures = new Map();
    records = new Map();
    dom.printStatus.textContent = '准备练习纸…';
    dom.printErrors.replaceChildren();
    dom.retryPrintBtn.hidden = true;
    dom.removePrintErrorsBtn.hidden = true;
    render();
    try {
        const response = await fetch(`${characterBase}/ARPHICPL.TXT`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
        if (!response.ok) throw new Error();
        license = await response.text();
        if (!license.startsWith('ARPHIC PUBLIC LICENSE') || license.includes('<html')) throw new Error();
    } catch {
        if (current !== revision) return;
        license = '';
        dom.printStatus.textContent = '许可文件加载失败，请重试';
        task = null;
        dom.retryPrintBtn.hidden = false;
        render();
        return;
    }
    const pending = [...new Set(characters)];
    async function worker() {
        while (pending.length && !controller.signal.aborted) {
            const char = pending.shift();
            try {
                const record = await store.load(char, { signal: controller.signal });
                if (current === revision) records.set(char, record);
            } catch (error) {
                if (current === revision && error.name !== 'AbortError') failures.set(char, error.message);
            }
        }
    }
    await Promise.all([worker(), worker()]);
    if (current !== revision) return;
    task = null;
    dom.printErrors.replaceChildren(...Array.from(failures, ([char, reason]) => {
        const item = document.createElement('li');
        item.textContent = `${char}：${reason}`;
        return item;
    }));
    dom.printStatus.textContent = failures.size ? '请重试或移除问题字后打印' : `${characters.length} 字 · A4 纵向`;
    dom.retryPrintBtn.hidden = !failures.size;
    dom.removePrintErrorsBtn.hidden = !failures.size;
    dom.removePrintErrorsBtn.textContent = `移除问题字（${characters.filter(char => failures.has(char)).length} 字）`;
    render();
}

dom.printOptions.addEventListener('change', event => {
    if (event.target === dom.printScope) {
        characters = dom.printScope.value === 'current' ? [allCharacters[selectedIndex]] : [...allCharacters];
        void load();
    } else render();
});
dom.retryPrintBtn.addEventListener('click', () => void load());
dom.removePrintErrorsBtn.addEventListener('click', () => {
    characters = characters.filter(char => !failures.has(char));
    failures.clear();
    dom.printErrors.replaceChildren();
    dom.removePrintErrorsBtn.hidden = true;
    dom.retryPrintBtn.hidden = true;
    dom.printStatus.textContent = characters.length ? `${characters.length} 字 · A4 纵向` : '没有可打印的字，请返回查字';
    render();
});
dom.printBtn.addEventListener('click', () => { if (!dom.printBtn.disabled) window.print(); });
window.addEventListener('pagehide', () => { revision++; task?.abort(); });
function restorePrintQuery() {
    const shared = readSharedQuery(location.href);
    task?.abort();
    task = null;
    revision++;
    allCharacters = shared.status === 'valid' ? Array.from(shared.query) : [];
    const requestedIndex = Number(new URLSearchParams(location.hash.slice(1)).get('c'));
    selectedIndex = Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < allCharacters.length ? requestedIndex : 0;
    characters = [...allCharacters];
    dom.printScope.value = 'group';
    dom.printScope.disabled = characters.length < 2;
    dom.printCurrentOption.textContent = `当前字${characters.length ? `（${characters[selectedIndex]}）` : ''}`;
    records.clear();
    failures.clear();
    dom.printErrors.replaceChildren();
    dom.retryPrintBtn.hidden = true;
    dom.removePrintErrorsBtn.hidden = true;
    if (characters.length) {
        dom.backLink.href = createShareUrl(location.href, shared.query);
        void load();
    } else {
        dom.backLink.href = '/';
        dom.printStatus.textContent = '请从查字页面选择要打印的汉字';
        render();
    }
}
window.addEventListener('hashchange', restorePrintQuery);
window.addEventListener('pageshow', event => { if (event.persisted) restorePrintQuery(); });
restorePrintQuery();
