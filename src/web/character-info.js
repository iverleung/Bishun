import cnchar from 'cnchar';

const isSingleHan = value => typeof value === 'string' && Array.from(value).length === 1 && /^\p{Script=Han}$/u.test(value);

// Dictionary candidates, not contextual pronunciation or a claim of normative review.
export function characterReadings(character, dictionary = cnchar) {
    if (!isSingleHan(character)) return [];
    try {
        const result = dictionary.spell(character, 'poly', 'tone', 'low', 'array');
        if (!Array.isArray(result) || result.length !== 1 || typeof result[0] !== 'string') return [];
        const value = result[0];
        const readings = value.startsWith('(') && value.endsWith(')') ? value.slice(1, -1).split('|') : [value];
        if (!readings.length || readings.some(reading => !/^[\p{Script=Latin}\p{M}]+$/u.test(reading))) return [];
        return [...new Set(readings)];
    } catch { return []; }
}

let radicalDictionary;

export function characterRadical(character, dictionary) {
    if (!isSingleHan(character)) return null;
    const result = dictionary([character]);
    const value = Array.isArray(result) && result.length === 1 ? result[0]?.radical : null;
    return isSingleHan(value) ? value : null;
}

export async function loadCharacterRadical(character, { timeoutMs = 3000 } = {}) {
    if (!isSingleHan(character)) return null;
    // Load this optional dictionary chunk after a character is available. A late
    // import may still be reused next time, but must not leave the UI waiting.
    radicalDictionary ||= import('cnchar-radical').then(module => module.default);
    let timer;
    try {
        const dictionary = await Promise.race([
            radicalDictionary,
            new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('部首数据加载超时')), timeoutMs); })
        ]);
        return characterRadical(character, dictionary);
    } finally { clearTimeout(timer); }
}
