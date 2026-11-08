import { isCharacterQuery } from './history.js';

const legacyKey = 'bishun-saved-queries-v1';
const storageKey = 'bishun-saved-queries-v2';
const limit = 30;
export const backupSizeLimit = 100_000;
const validName = name => typeof name === 'string' && Array.from(name).length <= 40 && !/[\u0000-\u001f\u007f]/u.test(name);
const validEntry = entry => entry && isCharacterQuery(entry.query) && validName(entry.name);

export class SavedQueries {
    constructor(storage) {
        this.storage = storage;
        this.items = [];
        this.names = new Map();
        try {
            const current = storage?.getItem(storageKey);
            if (current !== null && current !== undefined) {
                const saved = JSON.parse(current);
                if (saved?.version === 2 && Array.isArray(saved.items)) {
                    for (const entry of saved.items) {
                        if (validEntry(entry) && !this.items.includes(entry.query) && this.items.length < limit) {
                            this.items.push(entry.query);
                            this.names.set(entry.query, entry.name.trim());
                        }
                    }
                }
            } else {
                const saved = JSON.parse(storage?.getItem(legacyKey) || '[]');
                if (Array.isArray(saved)) this.items = [...new Set(saved.filter(isCharacterQuery))].slice(0, limit);
            }
        } catch { /* Keep a usable list when storage is unavailable; never overwrite data on read. */ }
    }

    entries() {
        return this.items.map(query => ({ query, name: this.names.get(query) || '' }));
    }

    persist() {
        try {
            if (!this.storage) return false;
            this.storage.setItem(storageKey, JSON.stringify({ version: 2, items: this.entries() }));
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

    update(original, query, name) {
        if (!this.items.includes(original)) return { status: 'missing' };
        if (!isCharacterQuery(query) || !validName(name)) return { status: 'invalid' };
        if (query !== original && this.items.includes(query)) return { status: 'exists' };
        this.items[this.items.indexOf(original)] = query;
        this.names.delete(original);
        this.names.set(query, name.trim());
        return { status: 'saved', persisted: this.persist() };
    }

    move(query, offset) {
        const index = this.items.indexOf(query);
        const target = index + offset;
        if (![-1, 1].includes(offset) || index < 0 || target < 0 || target >= this.items.length) return { status: 'invalid' };
        [this.items[index], this.items[target]] = [this.items[target], this.items[index]];
        return { status: 'saved', persisted: this.persist() };
    }

    remove(query) {
        this.items = this.items.filter(item => item !== query);
        this.names.delete(query);
        return this.persist();
    }

    exportBackup() {
        return JSON.stringify({ type: 'bishun-wordlists', version: 1, items: this.entries() }, null, 2);
    }

    previewImport(text) {
        if (typeof text !== 'string' || new TextEncoder().encode(text).length > backupSizeLimit) throw new Error('文件过大，请使用 100 KB 以内的生字本备份');
        let data;
        try { data = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON 备份'); }
        if (data?.type !== 'bishun-wordlists' || data.version !== 1 || !Array.isArray(data.items) || data.items.length > 500) throw new Error('备份格式或版本不支持');
        const seen = new Set(this.items);
        const result = { entries: [], duplicates: 0, invalid: 0, overflow: 0 };
        for (const entry of data.items) {
            if (!validEntry(entry)) { result.invalid++; continue; }
            if (seen.has(entry.query)) { result.duplicates++; continue; }
            seen.add(entry.query);
            if (this.items.length + result.entries.length >= limit) { result.overflow++; continue; }
            result.entries.push({ query: entry.query, name: entry.name.trim() });
        }
        return result;
    }

    importBackup(text) {
        const preview = this.previewImport(text);
        if (!preview.entries.length) return { ...preview, persisted: true };
        for (const entry of preview.entries) {
            this.items.push(entry.query);
            this.names.set(entry.query, entry.name);
        }
        return { ...preview, persisted: this.persist() };
    }
}
