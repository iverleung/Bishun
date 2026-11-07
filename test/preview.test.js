import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewPlayer } from '../public/preview/player.js';
import { samples } from '../public/preview/samples.js';
import { QueryHistory } from '../public/preview/history.js';

function setup() {
    let pending = null;
    const clock = {
        setTimeout(fn) { pending = fn; return fn; },
        clearTimeout(fn) { if (pending === fn) pending = null; }
    };
    const player = new PreviewPlayer(samples, () => {}, clock);
    player.query('木水');
    return {
        player,
        callback: () => pending,
        tick() {
            assert.ok(pending, 'expected an active playback step');
            const fn = pending;
            pending = null;
            fn();
        }
    };
}

test('query preserves duplicate order and leaves editable input separate', () => {
    const { player } = setup();
    const flags = player.query('木，木 abc水' + '心'.repeat(25));
    assert.equal(player.entries.length, 20);
    assert.deepEqual(player.entries.slice(0, 3), ['木', '木', '水']);
    assert.deepEqual(flags, { filtered: true, truncated: true });
    assert.equal(player.status, 'ready');
    assert.equal(player.showFull, true);
});

test('pause cancels stale callbacks and resumes the interrupted stroke', () => {
    const { player, callback, tick } = setup();
    player.play();
    tick();
    const stale = callback();
    assert.equal(player.active, 1);
    player.pause();
    stale();
    assert.equal(player.completed, 1);
    assert.equal(player.status, 'paused');
    player.play();
    assert.equal(player.active, 1);
    tick();
    assert.equal(player.completed, 2);
});

test('switching characters invalidates old playback, including late callbacks', () => {
    const { player, callback } = setup();
    player.play();
    const stale = callback();
    player.select(1);
    stale();
    assert.equal(player.entry, '水');
    assert.equal(player.completed, 0);
    assert.equal(player.showFull, true);
    assert.equal(player.status, 'ready');
});

test('clear and a new query cannot be overwritten by a previous task', () => {
    const { player, callback } = setup();
    player.play();
    const stale = callback();
    player.clear();
    player.query('心');
    stale();
    assert.equal(player.entry, '心');
    assert.equal(player.status, 'ready');
    assert.equal(player.completed, 0);
});

test('seeking is silent and replaying a selected stroke stops at that stroke', () => {
    const { player, callback, tick } = setup();
    player.seek(3);
    assert.equal(callback(), null);
    assert.equal(player.completed, 3);
    player.play({ oneStroke: true });
    assert.equal(player.active, 2);
    tick();
    assert.equal(player.completed, 3);
    assert.equal(player.status, 'paused');
    assert.equal(callback(), null);
});

test('follow mode waits for explicit continuation after every stroke', () => {
    const { player, callback, tick } = setup();
    player.setMode('follow');
    player.play();
    tick();
    assert.equal(player.completed, 1);
    assert.equal(player.status, 'paused');
    assert.equal(callback(), null);
    player.play();
    assert.equal(player.active, 1);
});

test('single-character mode never advances to the next character', () => {
    const { player, tick } = setup();
    player.play();
    for (let i = 0; i < 4; i++) tick();
    assert.equal(player.entry, '木');
    assert.equal(player.status, 'complete');
    player.play();
    assert.equal(player.active, 0);
});

test('follow mode in a group waits at character boundaries before continuing', () => {
    const { player, tick } = setup();
    player.group = true;
    player.setMode('follow');
    for (let i = 0; i < 4; i++) {
        player.play();
        tick();
    }
    assert.equal(player.entry, '木');
    assert.equal(player.status, 'paused');
    player.play();
    assert.equal(player.entry, '水');
    assert.equal(player.active, 0);
    for (let i = 0; i < 4; i++) {
        if (i > 0) player.play();
        tick();
    }
    player.play();
    assert.equal(player.status, 'complete');
    assert.equal(player.groupComplete, true);
});

test('group playback preserves order, skips unavailable entries, and reports them', () => {
    const { player, tick } = setup();
    player.query('未木未水未');
    player.restartGroup();
    assert.equal(player.index, 1);
    for (let i = 0; i < 4; i++) tick();
    assert.equal(player.index, 3);
    for (let i = 0; i < 4; i++) tick();
    assert.equal(player.status, 'complete');
    assert.equal(player.skipped, 3);
});

test('a mode change pauses playback and discards its pending step', () => {
    const { player, callback } = setup();
    player.play();
    const stale = callback();
    player.setMode('follow');
    stale();
    assert.equal(player.status, 'paused');
    assert.equal(player.completed, 0);
    assert.equal(player.mode, 'follow');
});

test('unsupported and simulated loading/error states cannot start playback', () => {
    const { player, callback } = setup();
    player.query('未');
    player.play();
    assert.equal(player.status, 'error');
    assert.equal(callback(), null);
    player.query('木');
    player.scenario('loading');
    player.play();
    assert.equal(player.status, 'loading');
    player.select(0);
    assert.equal(player.status, 'ready');
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
