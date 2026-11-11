const storageKey = 'bishun-web-preferences-v1';
export const defaultPreferences = Object.freeze({ speed: 3, speechEnabled: true, group: true });

function validate(value) {
    const result = { ...defaultPreferences };
    if (!value || typeof value !== 'object') return result;
    if (Number.isInteger(value.speed) && value.speed >= 1 && value.speed <= 5) result.speed = Math.max(2,Math.min(4,value.speed));
    for (const key of ['speechEnabled', 'group']) {
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
