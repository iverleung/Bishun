export const characterVersion = '2.0.1';
export const characterBase = `/characters/${characterVersion}`;

export function validateCharacterData(data, expectedCount) {
    if (!data || !Array.isArray(data.strokes) || !data.strokes.length ||
        !Array.isArray(data.medians) || data.medians.length !== data.strokes.length ||
        (expectedCount !== undefined && data.strokes.length !== expectedCount) ||
        data.strokes.some(path => typeof path !== 'string' || !path.trim()) ||
        data.medians.some(points => !Array.isArray(points) || points.length < 2 ||
            points.some(point => !Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value))))) {
        throw new Error('字形路径、中心线或笔画数量无效');
    }
    if (data.radStrokes !== undefined && (!Array.isArray(data.radStrokes) ||
        data.radStrokes.some(index => !Number.isInteger(index) || index < 0 || index >= data.strokes.length))) {
        throw new Error('部首笔画索引无效');
    }
    return data;
}

export function validateCharacterManifest(manifest) {
    const chars = typeof manifest?.characters === 'string' ? Array.from(manifest.characters) : [];
    if (manifest?.schemaVersion !== 1 || manifest.version !== characterVersion || !chars.length ||
        manifest.count !== chars.length || new Set(chars).size !== chars.length ||
        !Array.isArray(manifest.strokeCounts) || manifest.strokeCounts.length !== chars.length ||
        manifest.strokeCounts.some(count => !Number.isInteger(count) || count < 1)) {
        throw new Error('字形清单版本或结构无效');
    }
    return new Map(chars.map((char, index) => [char, manifest.strokeCounts[index]]));
}
