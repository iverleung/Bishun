export function worksheetLayout({ size = 20, rows = 2, grid = 'mi', availableHeight = 247 } = {}) {
    if (![16, 20, 24].includes(size) || ![1, 2, 3].includes(rows) || !['mi', 'tian'].includes(grid) || !Number.isFinite(availableHeight) || availableHeight < 100 || availableHeight > 247) throw new Error('练习纸设置无效');
    return { size, rows, grid, availableHeight, columns: Math.floor(180 / size), perPage: Math.floor((availableHeight + 8) / (size * rows + 8)) };
}

export function paginateCharacters(characters, options, extraHeights = []) {
    const layout = worksheetLayout(options);
    const pages = [];
    let page = [], height = 0;
    for (const [index, character] of characters.entries()) {
        const extra = extraHeights[index] ?? 0;
        const blockHeight = layout.size * layout.rows + extra;
        if (!Number.isFinite(extra) || extra < 0 || blockHeight > layout.availableHeight) throw new Error('练习块高度无效');
        if (page.length && height + 8 + blockHeight > layout.availableHeight) { pages.push(page); page = []; height = 0; }
        height += (page.length ? 8 : 0) + blockHeight;
        page.push(character);
    }
    if (page.length) pages.push(page);
    return { layout, pages };
}
