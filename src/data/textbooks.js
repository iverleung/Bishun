import catalog from '../../resources/textbooks/pilot-v1/index.json' with { type: 'json' };

export const textbookBooks = Object.freeze(catalog.books.map(book => Object.freeze({ ...book })));
const isHan = value => typeof value === 'string' && Array.from(value).length === 1 && /^\p{Script=Han}$/u.test(value);
const validReading = value => value === null || (typeof value === 'string' && /^[\p{Script=Latin}\p{M}]+$/u.test(value) && !/[A-Z]/.test(value));
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 100;

export function validateTextbook(book, expectedId) {
    if (book?.schemaVersion !== 1 || book.dataset !== 'pilot-v1' || book.id !== expectedId || !label(book.title) || !label(book.edition) || !Array.isArray(book.units) || book.units.length < 1 || book.units.length > 8) throw new Error('教材资料格式无效');
    const tasks = new Set(), records = new Set(), units = new Set();
    for (const unit of book.units) {
        if (!/^unit-[1-8]$/.test(unit.id) || units.has(unit.id) || !label(unit.title) || !Array.isArray(unit.tasks) || !unit.tasks.length) throw new Error('教材单元无效');
        units.add(unit.id);
        for (const task of unit.tasks) {
            if (!/^(literacy|reading|pinyin|garden)-[1-9][0-9]?$/.test(task.id) || tasks.has(task.id) || !['lesson','garden'].includes(task.kind) || typeof task.label !== 'string' || task.label.length > 30 || !label(task.title)) throw new Error('教材课次无效');
            tasks.add(task.id);
            for (const mode of ['read','write']) {
                if (!Array.isArray(task[mode]) || task[mode].length > 20) throw new Error('本课字单长度无效');
                for (const entry of task[mode]) {
                    if (!isHan(entry.character) || !/^row-[1-9][0-9]*$/.test(entry.id) || records.has(entry.id) || !validReading(entry.reading) || (mode === 'read' && entry.reading === null) || typeof entry.polyphonic !== 'boolean' || !Number.isInteger(entry.sourceRow) || entry.sourceRow < 2 || entry.id !== `row-${entry.sourceRow}` || !Number.isInteger(entry.pdfPage) || entry.pdfPage < 1) throw new Error('教材字项无效');
                    records.add(entry.id);
                }
            }
            if (!task.read.length && !task.write.length) throw new Error('本课没有字项');
        }
    }
    return book;
}

export function textbookSelection(book, taskId, requestedMode = 'write', index = 0) {
    const unit = book.units.find(unit => unit.tasks.some(task => task.id === taskId));
    const task = unit?.tasks.find(task => task.id === taskId);
    if (!task || !['read','write'].includes(requestedMode)) throw new Error('请选择课文');
    const mode = task[requestedMode].length ? requestedMode : requestedMode === 'write' ? 'read' : 'write';
    const entries = task[mode];
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) throw new Error('请选择本课中的字');
    return { bookId:book.id, unitId:unit.id, taskId, mode, query:entries.map(entry => entry.character).join(''), index, name:`${book.title} · ${task.title} · ${mode === 'write' ? '会写' : '会认'}` };
}

function freeze(value) {
    if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
    return value;
}

export class TextbookStore {
    constructor({ fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 5000 } = {}) {
        this.fetch = fetchImpl;
        this.timeoutMs = timeoutMs;
        this.books = new Map();
    }
    async load(id, { signal } = {}) {
        if (signal?.aborted) throw new DOMException('已取消','AbortError');
        const entry = textbookBooks.find(book => book.id === id);
        if (!entry) throw new Error('这册教材暂未开放');
        if (this.books.has(id)) return this.books.get(id);
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort',abort,{once:true});
        let timer, rejectAbort;
        const cancelled = new Promise((resolve,reject) => { rejectAbort = () => reject(signal?.aborted ? new DOMException('已取消','AbortError') : new Error('教材加载超时，请重试')); controller.signal.addEventListener('abort',rejectAbort,{once:true}); });
        timer = setTimeout(abort,this.timeoutMs);
        try {
            const work = (async () => {
                const response = await this.fetch(entry.url,{signal:controller.signal,cache:'force-cache'});
                if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('教材资料暂不可用，请重试');
                const text = await response.text();
                if (text.length > 250_000) throw new Error('教材资料大小无效');
                return validateTextbook(JSON.parse(text),id);
            })();
            const book = await Promise.race([work,cancelled]);
            if (controller.signal.aborted) throw signal?.aborted ? new DOMException('已取消','AbortError') : new Error('教材加载超时，请重试');
            this.books.set(id,freeze(book));
            return book;
        } catch (error) {
            if (signal?.aborted) throw new DOMException('已取消','AbortError');
            if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('教材加载失败，请重试');
            throw error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort',abort);
            controller.signal.removeEventListener('abort',rejectAbort);
        }
    }
}
