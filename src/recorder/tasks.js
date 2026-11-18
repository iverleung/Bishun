import pinyinCatalog from '../../docs/拼音音节合成列表.json' with { type: 'json' };
import strokeCatalog from '../../resources/stroke-audio-catalog.json' with { type: 'json' };
import { recordingFileName } from './archive.js';

const pinyinItems = pinyinCatalog.map((entry, index) => ({
  reading: entry.reading.normalize('NFC'),
  label: entry.reading.normalize('NFC'),
  characters: Array.isArray(entry.characters) ? entry.characters.slice(0, 3) : [],
  position: index + 1,
}));

const strokeItems = strokeCatalog.items.map((entry, index) => ({
  reading: entry.id,
  label: entry.text,
  characters: [],
  position: index + 1,
}));

export const recordingTasks = Object.freeze({
  pinyin: {
    title: '拼音录音', noun: '拼音', databaseMode: 'pinyin',
    storageKey: 'bishun-pinyin-recorder-current', archiveName: 'bishun-pinyin', items: pinyinItems,
  },
  strokes: {
    title: '笔画录音', noun: '笔画', databaseMode: 'strokes',
    storageKey: 'bishun-stroke-recorder-current', archiveName: 'bishun-strokes', items: strokeItems,
  },
});

export function exportRecordingName(mode, item, record) {
  const identity = mode === 'strokes' ? `${item.reading}_${item.label}` : item.reading;
  return recordingFileName(identity, item.position, record.mimeType);
}

export function exportManifestEntry(mode, item, record) {
  const identity = mode === 'strokes'
    ? { id: item.reading, text: item.label }
    : { reading: item.reading };
  return {
    ...identity,
    file: exportRecordingName(mode, item, record),
    durationMs: record.durationMs,
    mimeType: record.mimeType,
    createdAt: record.createdAt,
  };
}
