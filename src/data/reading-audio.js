import catalog from '../../resources/reading-audio-catalog.json' with { type: 'json' };

export function indexReadings(manifest) {
    if (manifest.schemaVersion !== 1 || manifest.version !== 'v1' || !Array.isArray(manifest.items)) throw new Error('读音清单版本无效');
    const entries = new Map();
    for (const item of manifest.items) {
        if (typeof item.reading !== 'string' || !item.reading || item.reading !== item.reading.normalize('NFC') || entries.has(item.reading) ||
            !/^reading-[a-f0-9]{12}$/.test(item.id) || item.url !== `/audio/readings/v1/${item.id}.mp3` ||
            !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isInteger(item.bytes) || item.bytes <= 0 ||
            !Number.isFinite(item.durationMs) || item.durationMs <= 0) throw new Error('读音清单内容无效');
        entries.set(item.reading, Object.freeze({ ...item }));
    }
    return entries;
}
const entries = indexReadings(catalog);
export function readingRecording(reading) {
    return typeof reading === 'string' ? entries.get(reading.normalize('NFC')) || null : null;
}
