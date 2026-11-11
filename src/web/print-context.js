// Optional worksheet label only; never changes the query or dictionary readings.
export function readWorksheetTitle(url) {
    const titles = new URLSearchParams(new URL(url).hash.slice(1)).getAll('t');
    return titles.length === 1 && titles[0].length <= 100 && titles[0].trim() && !/[\p{C}<>]/u.test(titles[0]) ? titles[0].trim() : '';
}
