import { isCharacterQuery } from './history.js';

export function createShareUrl(baseUrl, query) {
    if (!isCharacterQuery(query)) throw new Error('只能分享 1—20 个汉字');
    const url = new URL('/', baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('请通过网站地址打开后分享');
    url.hash = new URLSearchParams({ q: query }).toString();
    return url.href;
}

export function readSharedQuery(url) {
    const params = new URLSearchParams(new URL(url).hash.slice(1));
    if (!params.has('q')) return { status: 'none' };
    const queries = params.getAll('q');
    return queries.length === 1 && isCharacterQuery(queries[0]) ? { status: 'valid', query: queries[0] } : { status: 'invalid' };
}

export function clearSharedQuery() {
    const url = new URL(location.href);
    const params = new URLSearchParams(url.hash.slice(1));
    if (!params.has('q')) return;
    params.delete('q');
    url.hash = params.toString();
    window.history.replaceState(window.history.state, '', url);
}

export function setupSharing({ dom, getSelection }) {
    let selection;
    let qrRequest = 0;
    function clearQr() {
        qrRequest++;
        dom.shareQrPanel.hidden = true;
        dom.shareQrBtn.setAttribute('aria-expanded', 'false');
        dom.shareQrBtn.textContent = '二维码';
        dom.shareQrImage.removeAttribute('src');
        dom.saveShareQr.removeAttribute('href');
        dom.saveShareQr.hidden = true;
    }
    async function showQr() {
        const request = ++qrRequest;
        const value = dom.shareLink.value;
        const current = () => request === qrRequest && dom.shareDialog.open && dom.shareLink.value === value;
        dom.shareQrPanel.hidden = false;
        dom.shareQrBtn.setAttribute('aria-expanded', 'true');
        dom.shareQrBtn.textContent = '收起二维码';
        dom.shareFeedback.textContent = '正在生成二维码…';
        let timer;
        try {
            const module = await Promise.race([
                import('./share-qr.js'),
                new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('二维码加载超时')), 3000); })
            ]);
            if (!current()) return;
            const image = module.createShareQrImage(value);
            dom.shareQrImage.src = image;
            dom.saveShareQr.href = image;
            dom.saveShareQr.hidden = false;
            dom.shareFeedback.textContent = '';
        } catch {
            if (!current()) return;
            clearQr();
            dom.shareFeedback.textContent = '二维码暂不可用，可复制链接';
        } finally { clearTimeout(timer); }
    }
    function updateLink() {
        const expanded = !dom.shareQrPanel.hidden;
        clearQr();
        const value = dom.shareGroup.checked ? selection.group : selection.character;
        dom.shareLink.value = createShareUrl(location.href, value);
        dom.shareContent.textContent = `链接包含：${value}`;
        dom.shareFeedback.textContent = '';
        if (expanded) void showQr();
    }
    dom.shareBtn.addEventListener('click', () => {
        selection = getSelection();
        if (!isCharacterQuery(selection.character)) return;
        dom.shareGroupOption.hidden = Array.from(selection.group).length < 2;
        dom.shareCharacter.checked = true;
        dom.shareGroup.checked = false;
        dom.systemShareBtn.hidden = typeof navigator.share !== 'function';
        updateLink();
        dom.shareDialog.showModal();
    });
    dom.shareCharacter.addEventListener('change', updateLink);
    dom.shareGroup.addEventListener('change', updateLink);
    dom.shareQrBtn.addEventListener('click', () => {
        if (dom.shareQrPanel.hidden) void showQr();
        else { clearQr(); dom.shareFeedback.textContent = ''; }
    });
    dom.closeShareBtn.addEventListener('click', () => dom.shareDialog.close());
    dom.shareDialog.addEventListener('close', () => { clearQr(); dom.shareBtn.focus({ preventScroll: true }); });
    dom.copyShareBtn.addEventListener('click', async () => {
        const value = dom.shareLink.value;
        dom.copyShareBtn.disabled = true;
        try {
            if (!navigator.clipboard?.writeText) throw new Error();
            await navigator.clipboard.writeText(value);
            dom.shareFeedback.textContent = '链接已复制';
        } catch {
            dom.shareLink.focus();
            dom.shareLink.select();
            dom.shareFeedback.textContent = '请复制上方链接';
        } finally { dom.copyShareBtn.disabled = false; }
    });
    dom.systemShareBtn.addEventListener('click', async () => {
        dom.systemShareBtn.disabled = true;
        try {
            await navigator.share({ title: '汉字笔顺', url: dom.shareLink.value });
            dom.shareFeedback.textContent = '已交给系统分享';
        } catch (error) {
            dom.shareFeedback.textContent = error.name === 'AbortError' ? '' : '分享未完成，可复制链接';
        } finally { dom.systemShareBtn.disabled = false; }
    });
}
