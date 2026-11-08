export function bindCanvasSwipe(element, { enabled, context, select }) {
    let gesture = null;
    const reset = () => { gesture = null; };
    element.addEventListener('pointerdown', event => {
        reset();
        if (!event.isPrimary || event.button !== 0 || !enabled() || event.target.closest('button,a,input,select,textarea')) return;
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, context: context(), horizontal: false };
        try { element.setPointerCapture(event.pointerId); } catch { /* The pointer may already have ended. */ }
    });
    element.addEventListener('pointermove', event => {
        if (!gesture || gesture.id !== event.pointerId) return;
        if (!enabled() || gesture.context !== context()) { reset(); return; }
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        if (!gesture.horizontal && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { reset(); return; }
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            gesture.horizontal = true;
        }
    });
    element.addEventListener('pointerup', event => {
        const current = gesture;
        reset();
        if (!current || !current.horizontal || current.id !== event.pointerId || !enabled() || current.context !== context()) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        const threshold = Math.max(40, Math.min(72, element.getBoundingClientRect().width * 0.18));
        if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.5) select(dx < 0 ? 1 : -1);
    });
    element.addEventListener('pointercancel', reset);
    element.addEventListener('lostpointercapture', event => {
        // A child SVG path can lose its implicit touch capture to the stage.
        // Ignore that bubbled event while the stage still owns the drag.
        if (event.target === element) reset();
    });
    return { reset };
}
