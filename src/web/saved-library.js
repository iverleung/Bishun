import { backupSizeLimit } from './saved-queries.js';

export function createSavedLibrary({ dom, savedQueries, openQuery, feedback, changed }) {
    let managing = false;
    let editing = null;
    let editOpener = null;
    let importText = null;

    function button(text, action, label = text) {
        const el = document.createElement('button');
        el.type = 'button';
        el.textContent = text;
        el.setAttribute('aria-label', label);
        el.addEventListener('click', action);
        return el;
    }

    function report(persisted, message) {
        feedback(persisted ? message : `${message}，仅本次打开有效`, !persisted);
        changed();
    }

    function restoreRowFocus(index, action = 'edit') {
        const rows = dom.savedList.children;
        const row = rows[Math.min(index, rows.length - 1)];
        (row?.querySelector(`[data-action="${action}"]`) || (dom.manageSavedBtn.disabled ? dom.importSavedBtn : dom.manageSavedBtn)).focus({ preventScroll: true });
    }

    function render() {
        dom.savedCount.textContent = savedQueries.items.length || '';
        dom.manageSavedBtn.disabled = !savedQueries.items.length;
        dom.exportSavedBtn.disabled = !savedQueries.items.length;
        dom.savedList.replaceChildren(...savedQueries.items.map((query, index) => {
            const name = savedQueries.names.get(query) || '';
            const row = document.createElement('div');
            row.className = 'saved-query';
            const open = button('', () => openQuery(query), name ? `${name}，${query}` : query);
            const title = document.createElement('span');
            title.textContent = name || query;
            open.append(title);
            if (name) {
                const subtitle = document.createElement('small');
                subtitle.textContent = query;
                open.append(subtitle);
            }
            row.append(open);
            if (managing) {
                const actions = document.createElement('div');
                actions.className = 'library-row-actions';
                const edit = button('编辑', () => {
                    editing = query;
                    editOpener = edit;
                    dom.savedName.value = name;
                    dom.savedText.value = query;
                    dom.editSavedError.hidden = true;
                    dom.editSavedDialog.showModal();
                    dom.savedName.focus();
                }, `编辑 ${name || query}`);
                edit.dataset.action = 'edit';
                actions.append(edit);
                for (const [offset, label] of [[-1, '上移'], [1, '下移']]) {
                    const move = button(offset === -1 ? '↑' : '↓', () => {
                        const result = savedQueries.move(query, offset);
                        render();
                        report(result.persisted, '已调整顺序');
                        restoreRowFocus(index + offset);
                    }, `${label} ${name || query}`);
                    move.disabled = offset === -1 ? index === 0 : index === savedQueries.items.length - 1;
                    actions.append(move);
                }
                const remove = button('删除', () => {
                    const persisted = savedQueries.remove(query);
                    render();
                    report(persisted, '已移除清单');
                    restoreRowFocus(index);
                }, `删除 ${name || query}`);
                remove.className = 'remove-saved-query';
                actions.append(remove);
                row.append(actions);
            }
            return row;
        }));
        if (!savedQueries.items.length) {
            const empty = document.createElement('p');
            empty.className = 'library-empty';
            empty.textContent = '还没有收藏';
            dom.savedList.append(empty);
        }
    }

    dom.manageSavedBtn.addEventListener('click', () => {
        managing = !managing;
        dom.manageSavedBtn.textContent = managing ? '完成' : '管理';
        dom.manageSavedBtn.setAttribute('aria-pressed', String(managing));
        render();
    });
    dom.cancelEditSavedBtn.addEventListener('click', () => dom.editSavedDialog.close());
    dom.editSavedDialog.addEventListener('close', () => {
        if (editOpener?.isConnected) editOpener.focus({ preventScroll: true });
        else dom.manageSavedBtn.focus({ preventScroll: true });
        editing = null;
    });
    dom.editSavedForm.addEventListener('submit', event => {
        event.preventDefault();
        const index = savedQueries.items.indexOf(editing);
        const result = savedQueries.update(editing, dom.savedText.value.trim(), dom.savedName.value.trim());
        if (result.status !== 'saved') {
            dom.editSavedError.textContent = result.status === 'exists' ? '这组汉字已在生字本中，请编辑已有清单' : '请输入 1—20 个汉字，名称最多 40 字';
            dom.editSavedError.hidden = false;
            return;
        }
        render();
        // Focus a surviving control after the dialog has closed.
        editOpener = dom.savedList.children[index]?.querySelector('[data-action="edit"]');
        dom.editSavedDialog.close();
        report(result.persisted, '已保存清单');
    });
    dom.exportSavedBtn.addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([savedQueries.exportBackup()], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = '笔顺-生字本.json';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    dom.importSavedBtn.addEventListener('click', () => dom.importSavedFile.click());
    dom.importSavedFile.addEventListener('change', async () => {
        const file = dom.importSavedFile.files[0];
        dom.importSavedFile.value = '';
        if (!file) return;
        dom.importSavedBtn.disabled = true;
        try {
            if (file.size > backupSizeLimit) throw new Error('文件过大，请使用 100 KB 以内的生字本备份');
            const text = await file.text();
            const preview = savedQueries.previewImport(text);
            importText = text;
            dom.importSavedSummary.textContent = `可导入 ${preview.entries.length} 条，重复 ${preview.duplicates} 条，无效 ${preview.invalid} 条，超出容量 ${preview.overflow} 条。仅导入下列清单，已有内容保留。`;
            dom.importSavedPreview.replaceChildren(...preview.entries.map(entry => {
                const item = document.createElement('li');
                item.textContent = entry.name ? `${entry.name}：${entry.query}` : entry.query;
                return item;
            }));
            dom.confirmImportSavedBtn.textContent = `导入 ${preview.entries.length} 条`;
            dom.confirmImportSavedBtn.disabled = !preview.entries.length;
            dom.importSavedDialog.showModal();
        } catch (error) { feedback(error.message, true); }
        finally { dom.importSavedBtn.disabled = false; }
    });
    dom.cancelImportSavedBtn.addEventListener('click', () => dom.importSavedDialog.close());
    dom.importSavedDialog.addEventListener('close', () => {
        importText = null;
        dom.importSavedBtn.focus({ preventScroll: true });
    });
    dom.confirmImportSavedBtn.addEventListener('click', () => {
        if (importText === null) return;
        const result = savedQueries.importBackup(importText);
        render();
        dom.importSavedDialog.close();
        report(result.persisted, `已导入 ${result.entries.length} 条清单`);
    });
    return { render };
}
