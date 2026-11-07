import cnchar from 'cnchar';
import order from 'cnchar-order';
import { corrections } from './corrections.js';

cnchar.use(order);
const cache = new Map();

export const v3 = {
    getStrokeNames(char) {
        if (typeof char !== 'string' || Array.from(char).length !== 1) return [];
        if (cache.has(char)) return cache.get(char).slice();
        let names = [];
        try {
            const result = cnchar.stroke(char, 'order', 'name');
            if (Array.isArray(result?.[0])) {
                names = result[0].map((name, index) => {
                    if (corrections[char]?.[index]) return corrections[char][index];
                    // Unknown/ambiguous entries must not silently become teaching answers.
                    if (typeof name !== 'string' || name.includes('|')) return null;
                    return name.replace(/\d+$/, '') || null;
                });
            }
        } catch (error) {
            console.error('❌ 笔画名称查询失败', error);
        }
        cache.set(char, names);
        return names.slice();
    },

    getStrokeName(points, char, index) {
        if (!Number.isInteger(index) || index < 0) return '暂缺';
        return this.getStrokeNames(char)[index] || '暂缺';
    }
};
