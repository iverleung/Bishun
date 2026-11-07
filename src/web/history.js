const storageKey = 'bishun-preview-query-history';
const limit = 10;
export const isCharacterQuery = value => typeof value === 'string' && Array.from(value).length >= 1 && Array.from(value).length <= 20 && /^\p{Script=Han}+$/u.test(value);

export class QueryHistory {
    constructor(storage) {
        this.storage = storage;
        this.items = [];
        try {
            const saved = JSON.parse(storage?.getItem(storageKey) || '[]');
            if (Array.isArray(saved)) this.items = [...new Set(saved.filter(isCharacterQuery))].slice(0, limit);
        } catch { /* Storage may be unavailable or contain invalid JSON. */ }
    }

    remember(query) {
        if (!isCharacterQuery(query)) return;
        this.items = [query, ...this.items.filter(item => item !== query)].slice(0, limit);
        try { this.storage?.setItem(storageKey, JSON.stringify(this.items)); }
        catch { /* Keep history in memory when persistence is unavailable. */ }
    }

    clear() {
        this.items = [];
        try { this.storage?.removeItem(storageKey); }
        catch { /* Clearing the in-memory list must still work. */ }
    }
}
