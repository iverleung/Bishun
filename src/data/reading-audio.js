import catalog from '../../resources/reading-audio-v2-catalog.json' with { type: 'json' };

export function indexReadings(manifest) {
    if (manifest.schemaVersion !== 1 || !['v1', 'v2'].includes(manifest.version) || !Array.isArray(manifest.items)) throw new Error('读音清单版本无效');
    const entries = new Map();
    const version = manifest.version;
    for (const item of manifest.items) {
        if (typeof item.reading !== 'string' || !item.reading || item.reading !== item.reading.normalize('NFC') || entries.has(item.reading) ||
            !/^reading-[a-f0-9]{12}$/.test(item.id) || item.url !== `/audio/readings/${version}/${item.id}.mp3` ||
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
