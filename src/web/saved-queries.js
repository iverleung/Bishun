import { isCharacterQuery } from './history.js';

const storageKey = 'bishun-saved-queries-v1';
const limit = 30;

export class SavedQueries {
    constructor(storage) {
        this.storage = storage;
        this.items = [];
        try {
            const saved = JSON.parse(storage?.getItem(storageKey) || '[]');
            if (Array.isArray(saved)) this.items = [...new Set(saved.filter(isCharacterQuery))].slice(0, limit);
        } catch { /* Keep an empty, usable list when storage is unavailable. */ }
    }

    persist() {
        try {
            if (!this.storage) return false;
            this.storage.setItem(storageKey, JSON.stringify(this.items));
            return true;
        } catch { return false; }
    }

    save(query) {
        if (!isCharacterQuery(query)) return { status: 'invalid' };
        if (this.items.includes(query)) return { status: 'exists' };
        if (this.items.length >= limit) return { status: 'full' };
        this.items = [query, ...this.items];
        return { status: 'saved', persisted: this.persist() };
    }

    remove(query) {
        this.items = this.items.filter(item => item !== query);
        return this.persist();
    }
}
