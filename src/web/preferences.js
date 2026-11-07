const storageKey = 'bishun-web-preferences-v1';
export const defaultPreferences = Object.freeze({ mode: 'quick', speed: 3, speechEnabled: false, group: false, grid: true, outline: true });

function validate(value) {
    const result = { ...defaultPreferences };
    if (!value || typeof value !== 'object') return result;
    if (['quick', 'explain', 'follow'].includes(value.mode)) result.mode = value.mode;
    if (Number.isInteger(value.speed) && value.speed >= 1 && value.speed <= 5) result.speed = value.speed;
    for (const key of ['speechEnabled', 'group', 'grid', 'outline']) {
        if (typeof value[key] === 'boolean') result[key] = value[key];
    }
    return result;
}

export function loadPreferences(storage) {
    try { return validate(JSON.parse(storage?.getItem(storageKey) || 'null')); }
    catch { return { ...defaultPreferences }; }
}

export function savePreferences(storage, value) {
    try { storage?.setItem(storageKey, JSON.stringify(validate(value))); }
    catch { /* Restricted storage must not prevent changing settings. */ }
}
