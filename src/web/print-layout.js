export function worksheetLayout({ size = 20, rows = 2, grid = 'mi' } = {}) {
    if (![16, 20, 24].includes(size) || ![1, 2, 3].includes(rows) || !['mi', 'tian'].includes(grid)) throw new Error('练习纸设置无效');
    return { size, rows, grid, columns: Math.floor(180 / size), perPage: Math.floor(255 / (size * rows + 8)) };
}

export function paginateCharacters(characters, options) {
    const layout = worksheetLayout(options);
    const pages = [];
    for (let index = 0; index < characters.length; index += layout.perPage) pages.push(characters.slice(index, index + layout.perPage));
    return { layout, pages };
}
