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
