export function bindCanvasSwipe(element, { enabled, context, select }) {
    let gesture = null;
    const reset = () => { gesture = null; };
    const interactive = target => Boolean(target.closest?.('button,a,input,select,textarea'));
    function begin(id, x, y, kind) {
        gesture = { id, x, y, kind, context: context(), horizontal: false };
    }
    function move(id, x, y, kind) {
        if (!gesture || gesture.kind !== kind || gesture.id !== id) return false;
        if (!enabled() || gesture.context !== context()) { reset(); return false; }
        const dx = x - gesture.x;
        const dy = y - gesture.y;
        if (!gesture.horizontal && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { reset(); return false; }
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) gesture.horizontal = true;
        return gesture.horizontal;
    }
    function finish(id, x, y, kind) {
        const current = gesture;
        if (!current || current.kind !== kind) return;
        reset();
        if (!current.horizontal || current.id !== id || !enabled() || current.context !== context()) return;
        const dx = x - current.x;
        const dy = y - current.y;
        const threshold = Math.max(40, Math.min(72, element.getBoundingClientRect().width * 0.18));
        if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.5) select(dx < 0 ? 1 : -1);
    }

    // Touch Events keep Safari's SVG input independent of pointer capture. Ignore
    // their parallel Pointer Events stream so one gesture cannot switch twice.
    element.addEventListener('touchstart', event => {
        reset();
        if (event.touches.length !== 1 || !enabled() || interactive(event.target)) return;
        const touch = event.touches[0];
        begin(touch.identifier, touch.clientX, touch.clientY, 'touch');
    }, { passive: true });
    element.addEventListener('touchmove', event => {
        if (gesture?.kind !== 'touch') return;
        if (event.touches.length !== 1) { reset(); return; }
        const touch = event.touches[0];
        if (move(touch.identifier, touch.clientX, touch.clientY, 'touch') && event.cancelable) event.preventDefault();
    }, { passive: false });
    element.addEventListener('touchend', event => {
        if (gesture?.kind !== 'touch') return;
        if (event.touches.length) { reset(); return; }
        const touch = Array.from(event.changedTouches).find(item => item.identifier === gesture.id);
        if (!touch) { reset(); return; }
        if (gesture.horizontal && event.cancelable) event.preventDefault();
        finish(touch.identifier, touch.clientX, touch.clientY, 'touch');
    }, { passive: false });
    element.addEventListener('touchcancel', () => { if (gesture?.kind === 'touch') reset(); }, { passive: true });

    element.addEventListener('pointerdown', event => {
        if (event.pointerType === 'touch') return;
        reset();
        if (!event.isPrimary || event.button !== 0 || !enabled() || interactive(event.target)) return;
        begin(event.pointerId, event.clientX, event.clientY, 'pointer');
        try { element.setPointerCapture(event.pointerId); } catch { /* The pointer may already have ended. */ }
    });
    element.addEventListener('pointermove', event => {
        if (event.pointerType !== 'touch') move(event.pointerId, event.clientX, event.clientY, 'pointer');
    });
    element.addEventListener('pointerup', event => {
        if (event.pointerType !== 'touch') finish(event.pointerId, event.clientX, event.clientY, 'pointer');
    });
    element.addEventListener('pointercancel', () => { if (gesture?.kind === 'pointer') reset(); });
    element.addEventListener('lostpointercapture', event => {
        if (gesture?.kind === 'pointer' && event.target === element) reset();
    });
    return { reset };
}
