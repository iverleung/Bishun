import cnchar from 'cnchar';

// Dictionary candidates, not contextual pronunciation or a claim of normative review.
export function characterReadings(character, dictionary = cnchar) {
    if (typeof character !== 'string' || Array.from(character).length !== 1 || !/^\p{Script=Han}$/u.test(character)) return [];
    try {
        const result = dictionary.spell(character, 'poly', 'tone', 'low', 'array');
        if (!Array.isArray(result) || result.length !== 1 || typeof result[0] !== 'string') return [];
        const value = result[0];
        const readings = value.startsWith('(') && value.endsWith(')') ? value.slice(1, -1).split('|') : [value];
        if (!readings.length || readings.some(reading => !/^[\p{Script=Latin}\p{M}]+$/u.test(reading))) return [];
        return [...new Set(readings)];
    } catch { return []; }
}
