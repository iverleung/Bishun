// Reviewed against GF 0023-2020 glyph sequences and GF 2001-2001 stroke tables.
// Keys are zero-based stroke indexes. Evidence is recorded in docs/Web资源与内容核验.md.
import grade1Review from '../../../resources/textbooks/grade1-stroke-review.json' with { type: 'json' };

export const corrections = {
    '山': { 1: '竖折' },
    '水': { 1: '横撇' },
    '了': { 0: '横撇' },
    '子': { 0: '横撇' },
    '字': { 2: '横钩', 3: '横撇' },
    '我': { 4: '斜钩' },
    '线': { 5: '斜钩' },
    '吃': { 5: '横折弯钩' },
    '心': { 1: '卧钩' },
    '家': { 2: '横钩' },
    '游': { 9: '横撇' },
    // Reviewed exact positions: docs/婆饼笔画播报修复.md.
    '婆': { 3: '横钩', 6: '横撇' },
    '饼': { 1: '横钩' },
    ...Object.fromEntries(grade1Review.characters.map(entry => [entry.character,
        Object.fromEntries(entry.strokes.map(stroke => [stroke.index, stroke.name]))]))
};
