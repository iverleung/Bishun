import fs from 'node:fs/promises';

export async function practiceStroke(browser, char, index, type = 'mouse', reverse = false) {
    const { evaluate, command } = browser;
    await evaluate("document.querySelector('#writingGrid').scrollIntoView({ block: 'center' })");
    const data = JSON.parse(await fs.readFile(new URL(`../../public/characters/2.0.1/${char}.json`, import.meta.url), 'utf8'));
    const rect = await evaluate("(() => { const r = document.querySelector('#practiceLayer > svg').getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })()");
    const points = data.medians[index].map(([x,y]) => ({ x: rect.left + x * rect.width / 1024, y: rect.top + (900 - y) * rect.height / 1024 }));
    if (reverse) points.reverse();
    if (type === 'touch') {
        await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points[0], id: 1 }] });
        for (const point of points.slice(1)) await command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] });
        await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
        const pointerType = type === 'pen' ? 'pen' : 'mouse';
        await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...points[0], button: 'left', buttons: 1, clickCount: 1, pointerType });
        for (const point of points.slice(1)) await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'left', buttons: 1, pointerType });
        await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.at(-1), button: 'left', buttons: 0, clickCount: 1, pointerType });
    }
}
