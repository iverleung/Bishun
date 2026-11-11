import { TextbookStore,textbookBooks,textbookSelection } from '../data/textbooks.js';
import { createDrawer } from './drawer.js';

const preferenceKey = 'bishun-textbook-last-v1';
export function createTextbookPicker({dom,storage,onOpen,onChoose,store = new TextbookStore()}) {
    let book = null, unit = null, task = null, mode = 'write', request = null, current = null, last = null;
    try { last = JSON.parse(storage?.getItem(preferenceKey) || 'null'); } catch { /* Optional browsing preference. */ }
    dom.textbookBook.replaceChildren(...textbookBooks.map(entry => {
        const option = document.createElement('option');option.value = entry.id;option.textContent = entry.title;return option;
    }));
    const panel = createDrawer({ dialog:dom.textbookDialog,trigger:dom.openTextbookBtn,closeButton:dom.closeTextbookBtn,returnFocus:dom.menuBtn,
        onOpen() { onOpen(); void load(current?.bookId || last?.bookId || textbookBooks[0].id); }, onClose() { request?.abort(); request = null; } });

    function setCurrent(selection) {
        current = selection;
        dom.textbookCurrent.textContent = selection?.name || '';
        dom.textbookCurrent.hidden = !selection;
    }
    function selectTask(id, requestedMode = 'write') {
        task = unit.tasks.find(item => item.id === id) || unit.tasks[0];
        mode = task[requestedMode].length ? requestedMode : requestedMode === 'write' ? 'read' : 'write';
        render();
    }
    function render() {
        dom.textbookBody.hidden = !book;
        dom.openTextbookTaskBtn.disabled = !book || !task;
        if (!book) return;
        dom.textbookEdition.textContent = book.edition;
        if (dom.textbookUnit.dataset.book !== book.id) {
            dom.textbookUnit.replaceChildren(...book.units.map(item => {
                const option = document.createElement('option');option.value = item.id;option.textContent = item.title;return option;
            }));
            dom.textbookUnit.dataset.book = book.id;
        }
        if (dom.textbookUnit.value !== unit.id) dom.textbookUnit.value = unit.id;
        const focusedTask = dom.textbookLessons.contains(document.activeElement);
        dom.textbookLessons.replaceChildren(...unit.tasks.map(item => {
            const button = document.createElement('button');button.type = 'button';button.dataset.task = item.id;
            button.textContent = `${item.label ? item.label+' · ' : ''}${item.title}`;
            button.setAttribute('aria-pressed',String(item === task));
            button.addEventListener('click',()=>selectTask(item.id));return button;
        }));
        const selectedButton = Array.from(dom.textbookLessons.children).find(button => button.dataset.task === task.id);
        if (focusedTask) selectedButton?.focus({preventScroll:true});
        selectedButton?.scrollIntoView({block:'nearest',inline:'nearest'});
        dom.textbookTaskTitle.textContent = task.title;
        for (const [button,kind] of [[dom.textbookWriteBtn,'write'],[dom.textbookReadBtn,'read']]) {
            button.disabled = !task[kind].length;
            button.setAttribute('aria-pressed',String(mode === kind));
        }
        dom.textbookCharacters.replaceChildren(...task[mode].map((entry,index) => {
            const button = document.createElement('button');button.type = 'button';button.dataset.entry = entry.id;
            button.className = 'textbook-character';button.classList.toggle('is-polyphonic',entry.polyphonic);
            const character = document.createElement('strong');character.textContent = entry.character;
            button.append(character);
            if (entry.reading) {
                const reading = document.createElement('span');reading.textContent = entry.reading;reading.title = '教材注音';
                button.append(reading);
            }
            button.setAttribute('aria-label',`${entry.character}${entry.reading ? '，教材注音 '+entry.reading : ''}，打开第 ${index+1} 个字`);
            button.addEventListener('click',()=>choose(index));return button;
        }));
        dom.openTextbookTaskBtn.textContent = `打开本课 · ${task[mode].length} 字`;
    }
    async function load(id = dom.textbookBook.value) {
        const requested = textbookBooks.find(entry => entry.id === id) || textbookBooks[0];
        if (dom.textbookBook.value !== requested.id) dom.textbookBook.value = requested.id;
        request?.abort();const pending = new AbortController();request = pending;
        book = unit = task = null;render();
        dom.textbookEdition.textContent = requested.edition;
        dom.textbookMessage.textContent = '正在加载教材…';dom.retryTextbookBtn.hidden = true;
        try {
            const loaded = await store.load(requested.id,{signal:pending.signal});
            if (request !== pending || pending.signal.aborted || !dom.textbookDialog.open) return;
            book = loaded;
            const preference = current?.bookId === loaded.id ? current : last?.bookId === loaded.id ? last : null;
            unit = book.units.find(item => item.id === preference?.unitId) || book.units[0];
            dom.textbookMessage.textContent = '';
            selectTask(preference?.taskId,preference?.mode === 'read' ? 'read' : 'write');
        } catch (error) {
            if (request !== pending || pending.signal.aborted || !dom.textbookDialog.open) return;
            dom.textbookMessage.textContent = error.message;
            dom.retryTextbookBtn.hidden = false;
        }
    }
    function choose(index = 0) {
        if (!book || !task) return;
        const selection = textbookSelection(book,task.id,mode,index);
        last = {bookId:selection.bookId,unitId:selection.unitId,taskId:selection.taskId,mode:selection.mode};
        try { storage?.setItem(preferenceKey,JSON.stringify(last)); } catch { /* Does not prevent learning. */ }
        panel.close({restore:false});
        onChoose(selection);
    }
    dom.textbookBook.addEventListener('change',()=>void load(dom.textbookBook.value));
    dom.textbookUnit.addEventListener('change',()=>{
        unit = book.units.find(item => item.id === dom.textbookUnit.value);selectTask(unit.tasks[0].id);
    });
    dom.textbookWriteBtn.addEventListener('click',()=>{mode='write';render();});
    dom.textbookReadBtn.addEventListener('click',()=>{mode='read';render();});
    dom.openTextbookTaskBtn.addEventListener('click',()=>choose());
    dom.retryTextbookBtn.addEventListener('click',()=>void load());
    return { setCurrent, getCurrent:()=>current };
}
