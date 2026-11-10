import test from 'node:test';
import assert from 'node:assert/strict';
import { v3 } from '../src/engine/recognition/v3.js';

test('missing characters and out-of-range indexes do not become a dot', () => {
    for (const char of ['', null, '木水', '🙂', '𠮷']) {
        assert.equal(v3.getStrokeName([], char, 0), '暂缺');
    }
    for (const index of [-1, 1.5, 20]) assert.equal(v3.getStrokeName([], '木', index), '暂缺');
});

test('unreviewed ambiguous alternatives remain unknown', () => {
    assert.equal(v3.getStrokeNames('安')[2], null);
    assert.equal(v3.getStrokeName([], '安', 2), '暂缺');
});

test('callers cannot mutate cached names', () => {
    const names = v3.getStrokeNames('水');
    names[1] = '点';
    assert.equal(v3.getStrokeNames('水')[1], '横撇');
});

test('游 resolves the reviewed 子 first stroke while retaining all twelve stroke positions', () => {
    assert.deepEqual(v3.getStrokeNames('游'),['点','点','提','点','横','横折钩','撇','撇','横','横撇','竖钩','横']);
    assert.equal(v3.getStrokeName([], '游', 9), '横撇');
    assert.equal(v3.getStrokeName([], '安', 2), '暂缺');
});
