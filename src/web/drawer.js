export function createDrawer({ dialog, trigger, closeButton, onOpen = () => {}, onClose = () => {}, initialFocus = closeButton, returnFocus = trigger }) {
    let restoreFocus = true;
    let backdropStart = false;
    let locked = false;
    let previousPadding = '';
    function lockScroll() {
        const body = document.body;
        const scrollbar = innerWidth - document.documentElement.clientWidth + body.offsetWidth - body.clientWidth;
        previousPadding = body.style.paddingRight;
        if (scrollbar > 0) body.style.paddingRight = `${(parseFloat(getComputedStyle(body).paddingRight) || 0) + scrollbar}px`;
        document.documentElement.classList.add('drawer-open');
        locked = true;
    }
    function unlockScroll() {
        if (!locked) return;
        document.documentElement.classList.remove('drawer-open');
        document.body.style.paddingRight = previousPadding;
        locked = false;
    }
    function outside(event) {
        const rect = dialog.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    }
    function close({ restore = true } = {}) {
        if (!dialog.open) return;
        restoreFocus = restore;
        dialog.close();
        unlockScroll();
        trigger.setAttribute('aria-expanded', 'false');
    }
    trigger.addEventListener('click', () => {
        if (dialog.open) return;
        onOpen();
        restoreFocus = true;
        dialog.showModal();
        lockScroll();
        trigger.setAttribute('aria-expanded', 'true');
        initialFocus.focus({ preventScroll: true });
    });
    closeButton.addEventListener('click', () => close());
    dialog.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex="0"]'))
            .filter(el => el.getClientRects().length && (el.type !== 'radio' || el.checked || !dialog.querySelector(`input[type="radio"][name="${el.name}"]:checked`)));
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });

    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => {
        if (dialog.open) return;
        unlockScroll();
        trigger.setAttribute('aria-expanded', 'false');
        onClose();
        if (restoreFocus) returnFocus.focus({ preventScroll: true });
    });
    dialog.addEventListener('pointerdown', event => { backdropStart = event.target === dialog && outside(event); });
    dialog.addEventListener('click', event => {
        if (backdropStart && event.target === dialog && outside(event)) close();
        backdropStart = false;
    });
    return { close };
}
