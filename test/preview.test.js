import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryHistory } from '../src/web/history.js';
import { defaultPreferences, loadPreferences, savePreferences } from '../src/web/preferences.js';
import { SavedQueries } from '../src/web/saved-queries.js';
import { bindCanvasSwipe } from '../src/web/canvas-swipe.js';
import { characterReadings, characterRadical } from '../src/web/character-info.js';
import radicalDictionary from 'cnchar-radical';
import { worksheetLayout, paginateCharacters } from '../src/web/print-layout.js';
import { createShareUrl, readSharedQuery } from '../src/web/share.js';
import { shareQrPixels } from '../src/web/share-qr.js';
import jsQR from 'jsqr';

test('saved queries preserve order and duplicates within a query, survive reload and stay separate from history', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const history = new QueryHistory(storage);
    const saved = new SavedQueries(storage);
    history.remember('木木水');
    assert.deepEqual(saved.save('木木水'), { status: 'saved', persisted: true });
    saved.save('𠮷');
    assert.equal(saved.save('木木水').status, 'exists');
    history.clear();
    assert.deepEqual(new SavedQueries(storage).items, ['𠮷', '木木水']);
    saved.remove('𠮷');
    assert.deepEqual(new SavedQueries(storage).items, ['木木水']);
    assert.deepEqual(saved.items, ['木木水']);
});

test('saved query capacity never silently evicts an existing item', () => {
    const saved = new SavedQueries(null);
    for (let index = 1; index <= 30; index++) saved.save(String.fromCodePoint(0x4e00 + index));
    assert.equal(saved.items.length, 30);
    const before = [...saved.items];
    assert.equal(saved.save('木水心').status, 'full');
    assert.deepEqual(saved.items, before);
    saved.remove(before[0]);
    assert.equal(saved.save('木水心').status, 'saved');
    assert.equal(saved.items[0], '木水心');
});

test('saved queries ignore invalid stored entries and report in-memory fallback', () => {
    const saved = new SavedQueries({ getItem: key => key === 'bishun-saved-queries-v1' ? '["木",null,1,"abc","木","𠮷"]' : null });
    assert.deepEqual(saved.items, ['木', '𠮷']);
    for (const value of ['', '<script>', '木'.repeat(21), null]) assert.equal(saved.save(value).status, 'invalid');
    assert.deepEqual(new SavedQueries({ getItem: () => '{' }).items, []);
    const blocked = new SavedQueries({ getItem() { throw new Error(); }, setItem() { throw new Error(); } });
    assert.deepEqual(blocked.save('心'), { status: 'saved', persisted: false });
    assert.equal(blocked.remove('心'), false);
    assert.deepEqual(blocked.items, []);
});

test('preferences persist only validated settings and reset without changing history', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const history = new QueryHistory(storage);
    history.remember('木水');
    const settings = { mode: 'follow', speed: 5, group: true, speechEnabled: true, grid: false, outline: false };
    savePreferences(storage, { ...settings, autoplay: true });
    assert.deepEqual(loadPreferences(storage), settings);
    savePreferences(storage, defaultPreferences);
    assert.deepEqual(loadPreferences(storage), defaultPreferences);
    assert.deepEqual(new QueryHistory(storage).items, ['木水']);
});

test('invalid or inaccessible preference storage falls back safely', () => {
    const broken = { getItem: () => '{' };
    assert.deepEqual(loadPreferences(broken), defaultPreferences);
    const invalid = { getItem: () => JSON.stringify({ mode: 'other', speed: '5', speechEnabled: 'yes', group: false, grid: false, outline: null }) };
    assert.deepEqual(loadPreferences(invalid), { ...defaultPreferences, grid: false });
    const blocked = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
    assert.deepEqual(loadPreferences(blocked), defaultPreferences);
    assert.doesNotThrow(() => savePreferences(blocked, defaultPreferences));
    const changed = loadPreferences(null);
    changed.speed = 5;
    assert.equal(loadPreferences(null).speed, 3);
});

test('history persists newest first, deduplicates, and limits its size', () => {
    const saved = new Map();
    const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
    const history = new QueryHistory(storage);
    for (const char of '木水心我山田人日月火土') history.remember(char);
    history.remember('木');
    assert.equal(history.items.length, 10);
    assert.deepEqual(history.items.slice(0, 3), ['木', '土', '火']);
    assert.equal(history.items.filter(item => item === '木').length, 1);
    const reloaded = new QueryHistory(storage);
    assert.deepEqual(reloaded.items, history.items);
    reloaded.clear();
    assert.deepEqual(new QueryHistory(storage).items, []);
});

test('history ignores malformed entries and works when storage is unavailable', () => {
    const history = new QueryHistory({ getItem: () => '["木",null,1,"木","abc","水"]' });
    assert.deepEqual(history.items, ['木', '水']);
    history.remember('');
    history.remember('木'.repeat(21));
    assert.deepEqual(history.items, ['木', '水']);
    const unavailable = new QueryHistory({ getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } });
    unavailable.remember('心');
    assert.deepEqual(unavailable.items, ['心']);
    unavailable.clear();
    assert.deepEqual(unavailable.items, []);
    assert.deepEqual(new QueryHistory({ getItem: () => '{broken' }).items, []);
});

test('library migrates old collections on edit without overwriting legacy storage, preserves names and order', () => {
    const values = new Map([['bishun-saved-queries-v1', '["木木水","心"]']]);
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const saved = new SavedQueries(storage);
    assert.deepEqual(saved.items, ['木木水', '心']);
    assert.equal(values.has('bishun-saved-queries-v2'), false);
    assert.equal(saved.update('木木水', '木水木', ' 今天的作业 ').status, 'saved');
    saved.move('木水木', 1);
    const reloaded = new SavedQueries(storage);
    assert.deepEqual(reloaded.entries(), [{ query: '心', name: '' }, { query: '木水木', name: '今天的作业' }]);
    assert.equal(values.get('bishun-saved-queries-v1'), '["木木水","心"]');
    const before = reloaded.exportBackup();
    assert.equal(reloaded.update('心', '木水木', '重复').status, 'exists');
    assert.equal(reloaded.update('心', 'abc', '').status, 'invalid');
    assert.equal(reloaded.update('心', '心', '名'.repeat(41)).status, 'invalid');
    assert.equal(reloaded.update('心', '心', '坏\n名称').status, 'invalid');
    assert.equal(reloaded.move('心', -1).status, 'invalid');
    assert.equal(reloaded.exportBackup(), before);
});

test('library backup preview never mutates, import reports duplicates, invalid entries and capacity overflow', () => {
    const saved = new SavedQueries(null);
    for (let i = 0; i < 29; i++) saved.save(String.fromCodePoint(0x4e00 + i));
    const backup = JSON.stringify({ type: 'bishun-wordlists', version: 1, items: [
        { query: '木木水', name: '作业' }, { query: '木木水', name: '重复' },
        { query: '一', name: '' }, { query: '心', name: '' }, { query: 'abc', name: '' }, { query: '水', name: 12 }
    ] });
    const before = saved.exportBackup();
    const preview = saved.previewImport(backup);
    assert.deepEqual(preview, { entries: [{ query: '木木水', name: '作业' }], duplicates: 2, invalid: 2, overflow: 1 });
    assert.equal(saved.exportBackup(), before);
    const result = saved.importBackup(backup);
    assert.equal(result.persisted, false);
    assert.equal(saved.items.length, 30);
    assert.equal(saved.names.get('木木水'), '作业');
    const restored = new SavedQueries(null);
    restored.importBackup(saved.exportBackup());
    assert.deepEqual(restored.entries(), saved.entries());
    for (const text of ['{', '{}', JSON.stringify({ type: 'bishun-wordlists', version: 2, items: [] }), ' '.repeat(100001)]) {
        assert.throws(() => saved.previewImport(text));
    }
});


test('share links contain only validated query content and preserve Unicode, order and duplicates', () => {
    const url = createShareUrl('https://example.com/?private=1#old', '木𠮷木');
    assert.equal(new URL(url).search, '');
    assert.equal(new URL(url).pathname, '/');
    assert.deepEqual(readSharedQuery(url), { status: 'valid', query: '木𠮷木' });
    for (const value of ['', 'abc', '木'.repeat(21), null]) assert.throws(() => createShareUrl('https://example.com', value));
    for (const hash of ['q=', 'q=abc', 'q=木&q=水', 'q=' + '木'.repeat(21), 'q=%E0%A4%A']) {
        assert.equal(readSharedQuery('https://example.com/#' + hash).status, 'invalid');
    }
    assert.equal(readSharedQuery('https://example.com/?candidate=1#query').status, 'none');
    assert.throws(() => createShareUrl('file:///tmp/index.html', '木'));
});


test('worksheet pagination preserves duplicates and keeps each character block on an A4 page', () => {
    for (const size of [16, 20, 24]) for (const rows of [1, 2, 3]) {
        const chars = Array.from('木水木心家我线春风花草木水木心家我线春风');
        const { layout, pages } = paginateCharacters(chars, { size, rows, grid: 'mi' });
        assert.deepEqual(pages.flat(), chars);
        assert.ok(layout.columns * size <= 180);
        for (const page of pages) assert.ok(page.length * size * rows + (page.length - 1) * 8 <= 247);
    }
    assert.throws(() => worksheetLayout({ size: 99 }));
    assert.throws(() => worksheetLayout({ grid: 'wrong' }));
});


test('character information keeps polyphonic candidates, rejects missing dictionary echoes and never guesses', () => {
    assert.deepEqual(characterReadings('木'), ['mù']);
    assert.deepEqual(characterReadings('长'), ['cháng', 'zhǎng']);
    assert.deepEqual(characterReadings('绿'), ['lǜ', 'lù']);
    assert.deepEqual(characterReadings('𠮷'), []);
    assert.deepEqual(characterReadings('學'), []);
    assert.deepEqual(characterReadings('木水'), []);
    assert.deepEqual(characterReadings('木', { spell: () => ['<script>'] }), []);
    assert.deepEqual(characterReadings('木', { spell() { throw new Error(); } }), []);
    assert.deepEqual(characterReadings('木', { spell: () => ['(mù|)'] }), []);
});


function swipeFixture() {
    const listeners = new Map();
    const moves = [];
    let enabled = true;
    let key = 'query:0';
    const element = { closest: () => null, addEventListener: (name, fn) => listeners.set(name, fn), setPointerCapture() {}, getBoundingClientRect: () => ({ width: 300 }) };
    bindCanvasSwipe(element, { enabled: () => enabled, context: () => key, select: offset => moves.push(offset) });
    const send = (type, x, y, extra = {}) => listeners.get(type)({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, target: element, ...extra });
    return { moves, send, disable: () => { enabled = false; }, change: () => { key = 'query:1'; } };
}

test('canvas swipe distinguishes horizontal navigation from vertical scroll, short drags and cancellation', () => {
    const { moves, send } = swipeFixture();
    for (const [endX, endY, cancel] of [[80, 110, false], [220, 95, false], [140, 100, false], [190, 230, false], [50, 100, true]]) {
        send('pointerdown', 150, 100);
        send('pointermove', endX, endY);
        if (cancel) send('pointercancel', endX, endY);
        send('pointerup', endX, endY);
    }
    assert.deepEqual(moves, [1, -1]);
});

test('canvas swipe ignores changed queries, disabled handwriting mode, multitouch and interactive controls', () => {
    const cases = [
        fixture => fixture.change(), fixture => fixture.disable(),
        fixture => fixture.send('pointerdown', 100, 100, { pointerId: 2, isPrimary: false }),
        fixture => fixture.send('lostpointercapture', 100, 100)
    ];
    for (const disrupt of cases) {
        const fixture = swipeFixture();
        fixture.send('pointerdown', 200, 100);
        fixture.send('pointermove', 100, 100);
        disrupt(fixture);
        fixture.send('pointerup', 100, 100);
        assert.deepEqual(fixture.moves, []);
    }
    const fixture = swipeFixture();
    fixture.send('pointerdown', 200, 100, { target: { closest: () => ({}) } });
    fixture.send('pointermove', 100, 100);
    fixture.send('pointerup', 100, 100);
    assert.deepEqual(fixture.moves, []);
});


test('child SVG implicit capture loss does not cancel a gesture captured by the stage', () => {
    const { send, moves } = swipeFixture();
    send('pointerdown', 200, 100);
    send('pointermove', 100, 100);
    send('lostpointercapture', 100, 100, { target: { closest: () => null } });
    send('pointerup', 100, 100);
    assert.deepEqual(moves, [1]);
});

test('touch swipe uses one Touch Events stream and suppresses native panning only for horizontal intent', () => {
    const { send, moves } = swipeFixture();
    let prevented = 0;
    const touch = (x,y) => ({ identifier:7,clientX:x,clientY:y });
    const options = { cancelable:true, preventDefault: () => { prevented++; } };
    send('pointerdown',200,100,{pointerType:'touch'});
    send('touchstart',0,0,{...options,touches:[touch(200,100)]});
    send('pointermove',100,100,{pointerType:'touch'});
    send('touchmove',0,0,{...options,touches:[touch(100,105)]});
    send('pointercancel',0,0,{pointerType:'touch'});
    send('lostpointercapture',0,0,{pointerType:'touch'});
    send('pointerup',100,105,{pointerType:'touch'});
    send('touchend',0,0,{...options,touches:[],changedTouches:[touch(100,105)]});
    assert.deepEqual(moves,[1]);
    assert.equal(prevented,2);
});

test('vertical touch drag, short drag and cancelled touch preserve native scrolling without navigation', () => {
    for (const [x,y,cancel] of [[195,200,false],[185,100,false],[100,100,true]]) {
        const { send,moves } = swipeFixture();
        let prevented=0;
        const touch=(a,b)=>({identifier:2,clientX:a,clientY:b});
        const options={cancelable:true,preventDefault:()=>{prevented++;}};
        send('touchstart',0,0,{...options,touches:[touch(200,100)]});
        send('touchmove',0,0,{...options,touches:[touch(x,y)]});
        if(cancel) send('touchcancel',0,0);
        send('touchend',0,0,{...options,touches:[],changedTouches:[touch(x,y)]});
        assert.deepEqual(moves,[]);
        if(x===195) assert.equal(prevented,0);
    }
});

test('multitouch, handwriting mode and changed query invalidate touch navigation', () => {
    for(const disrupt of [f=>f.change(),f=>f.disable(),f=>f.send('touchstart',0,0,{touches:[{identifier:1},{identifier:2}]})]) {
        const fixture=swipeFixture();
        const touch=x=>({identifier:1,clientX:x,clientY:100});
        fixture.send('touchstart',0,0,{touches:[touch(200)]});
        fixture.send('touchmove',0,0,{touches:[touch(100)],cancelable:true,preventDefault(){}});
        disrupt(fixture);
        fixture.send('touchend',0,0,{touches:[],changedTouches:[touch(100)],cancelable:true,preventDefault(){}});
        assert.deepEqual(fixture.moves,[]);
    }
});

test('radical information uses independent dictionary fields and preserves semantic variants', () => {
    for (const [character, radical] of [['木','木'],['水','水'],['心','心'],['河','氵'],['打','扌'],['学','子'],['我','戈'],['新','斤']]) {
        assert.equal(characterRadical(character, radicalDictionary), radical);
    }
    assert.equal(characterRadical('學', radicalDictionary), null);
    assert.equal(characterRadical('𠮷', radicalDictionary), null);
    assert.equal(characterRadical('木水', () => { throw new Error('must not query invalid input'); }), null);
    assert.equal(characterRadical('木', () => [{ radical:'木', radicalCount:999, struct:'arbitrary' }]), '木');
});

test('invalid or ambiguous radical results remain unknown instead of guessing a first candidate', () => {
    for(const result of [null, [], [{radical:''}], [{radical:'木|水'}], [{radical:'<script>'}], [{radical:'木'},{radical:'水'}], [{radical:3}]]) {
        assert.equal(characterRadical('木', () => result), null);
    }
});


test('share QR pixels independently decode to exact content-only URLs, including repeats and 20 supplementary Han', () => {
    for (const query of ['和', '木水木', '𠮷'.repeat(20)]) {
        const url = createShareUrl('https://example.com/?private=excluded#old', query);
        const image = shareQrPixels(url);
        const decoded = jsQR(image.data, image.width, image.height);
        assert.equal(decoded?.data, url);
        assert.equal(readSharedQuery(decoded.data).query, query);
        assert.equal(new URL(decoded.data).search, '');
        assert.equal(image.width, image.height);
        // Four whole white modules surround the code; no dark pixels on the border.
        for (let x = 0; x < image.width; x++) assert.equal(image.data[x * 4], 255);
    }
});

test('share QR rejects non-web and oversized links instead of creating a misleading image', () => {
    for (const value of ['javascript:alert(1)', 'file:///tmp/a', 'not a URL', 'https://example.com/' + 'a'.repeat(2048)]) {
        assert.throws(() => shareQrPixels(value));
    }
});
