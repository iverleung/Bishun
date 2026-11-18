import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const filters = 'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.05,areverse,loudnorm=I=-16:TP=-1.5:LRA=11';

async function audioStats(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { maxBuffer: 1024 * 1024 });
  const mean = Number(stderr.match(/mean_volume: ([^ ]+) dB/)?.[1]);
  const peak = Number(stderr.match(/max_volume: ([^ ]+) dB/)?.[1]);
  if (!Number.isFinite(mean) || !Number.isFinite(peak)) throw new Error(`无法分析音量：${file}`);
  return { meanDb: mean, peakDb: peak };
}

async function durationMs(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file]);
  const duration = Number(JSON.parse(stdout).format.duration) * 1000;
  if (!Number.isFinite(duration) || duration < 100 || duration > 10000) throw new Error(`成品时长无效：${file}`);
  return Math.round(duration);
}

async function importKind(kind) {
  const isStroke = kind === 'strokes';
  const sourceDir = path.join(root, 'pinyin-record', `bishun-${isStroke ? 'strokes' : 'pinyin'}-2026-11-18`);
  const sourceManifestBytes = await fs.readFile(path.join(sourceDir, 'manifest.json'));
  const sourceManifest = JSON.parse(sourceManifestBytes);
  const canonical = JSON.parse(await fs.readFile(path.join(root, isStroke ? 'resources/stroke-audio-catalog.json' : 'docs/拼音音节合成列表.json'), 'utf8'));
  const definitions = isStroke ? canonical.items : canonical;
  const byIdentity = new Map(definitions.map((item, index) => [isStroke ? item.id : item.reading, { ...item, position: index + 1 }]));
  const plan = isStroke ? null : JSON.parse(await fs.readFile(path.join(root, 'resources/reading-audio-plan.json'), 'utf8'));
  const planned = new Map(plan?.batches.flatMap(batch => Object.entries(batch.items).map(([reading, token]) => [reading, { token, batch: batch.id }])));
  if (sourceManifest.recordings.length !== definitions.length - (isStroke ? 0 : 9)) throw new Error(`${kind} 导出数量与预期不符`);
  const seen = new Set();
  const actualFiles = new Set((await fs.readdir(sourceDir)).map(name => name.normalize('NFC')));
  for (const record of sourceManifest.recordings) {
    const identity = isStroke ? record.id : record.reading;
    const definition = byIdentity.get(identity);
    if (!definition || seen.has(identity) || (isStroke && definition.text !== record.text) || Number.parseInt(record.file) !== definition.position || !actualFiles.has(record.file.normalize('NFC'))) {
      throw new Error(`导出身份或文件无效：${identity}`);
    }
    seen.add(identity);
  }

  const outputDir = path.join(root, 'public', 'audio', isStroke ? 'strokes' : 'readings', 'v2');
  await fs.mkdir(outputDir, { recursive: false });
  const items = [];
  const excluded = [];
  let cursor = 0;
  async function worker() {
    while (cursor < sourceManifest.recordings.length) {
      const record = sourceManifest.recordings[cursor++];
      const identity = isStroke ? record.id : record.reading;
      const definition = byIdentity.get(identity);
      const sourceFile = record.file.normalize('NFC');
      const sourcePath = path.join(sourceDir, sourceFile);
      const sourceBytes = await fs.readFile(sourcePath);
      const sourceSha256 = sha256(sourceBytes);
      const quality = await audioStats(sourcePath);
      if (quality.meanDb <= -55) {
        if (isStroke) throw new Error(`笔画录音接近静音，不能形成完整版本：${identity}`);
        excluded.push({ reading: identity, sourceFile, sourceSha256, reason: 'mean volume <= -55 dB; manual rerecording required', ...quality });
        continue;
      }
      const outputPath = path.join(outputDir, `${identity.startsWith('stroke-') ? identity : `pending-${definition.position}`}.mp3`);
      await run('ffmpeg', ['-v', 'error', '-i', sourcePath, '-af', filters, '-codec:a', 'libmp3lame', '-b:a', '48k', '-ar', '24000', '-ac', '1', outputPath]);
      const outputBytes = await fs.readFile(outputPath);
      const outputSha256 = sha256(outputBytes);
      const id = isStroke ? identity : `reading-${createHash('sha256').update(`${identity}:${outputSha256}`).digest('hex').slice(0, 12)}`;
      const finalPath = path.join(outputDir, `${id}.mp3`);
      if (outputPath !== finalPath) await fs.rename(outputPath, finalPath);
      const common = {
        id, url: `/audio/${isStroke ? 'strokes' : 'readings'}/v2/${id}.mp3`,
        durationMs: await durationMs(finalPath), bytes: outputBytes.length, sha256: outputSha256,
        reviewStatus: 'pending-listening', sourceFile, sourceSha256,
        sourceQuality: { meanDb: Math.round(quality.meanDb * 10) / 10, peakDb: Math.round(quality.peakDb * 10) / 10 },
      };
      items.push(isStroke
        ? { ...common, text: definition.text }
        : { ...common, reading: identity, ...(planned.get(identity) || {}) });
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  items.sort((left, right) => byIdentity.get(isStroke ? left.id : left.reading).position - byIdentity.get(isStroke ? right.id : right.reading).position);
  excluded.sort((left, right) => byIdentity.get(left.reading).position - byIdentity.get(right.reading).position);
  const unrecorded = definitions.filter(item => !seen.has(isStroke ? item.id : item.reading)).map(item => isStroke ? { id: item.id, text: item.text } : { reading: item.reading });
  const manifest = {
    schemaVersion: 1, version: 'v2',
    source: {
      type: 'user-recording', export: path.relative(root, sourceDir), exportManifestSha256: sha256(sourceManifestBytes),
      processing: 'ffmpeg: trim leading/trailing silence below -55 dB; EBU R128 loudnorm I=-16 TP=-1.5 LRA=11; MP3 48 kbps, 24000 Hz, mono',
      technicalReview: 'decode, duration and whole-file mean/peak levels; pronunciation and listening approval remain pending',
    },
    items,
    ...(excluded.length ? { excluded } : {}),
    ...(unrecorded.length ? { unrecorded } : {}),
  };
  const manifestPath = path.join(root, 'resources', isStroke ? 'stroke-audio-v2-catalog.json' : 'reading-audio-v2-catalog.json');
  await fs.writeFile(manifestPath, json(manifest));
  await fs.writeFile(path.join(outputDir, 'manifest.json'), json(manifest));
  const title = isStroke ? '笔画' : '拼音';
  await fs.writeFile(path.join(outputDir, 'SOURCE.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}自录音来源</title><h1>${title}自录音 v2</h1><p>来源：用户在本站录音页制作的本地录音。原始导出清单 SHA-256：${manifest.source.exportManifestSha256}</p><p>${manifest.source.processing}</p><p>${items.length} 段成品均为 pending-listening；技术检查不等于发音或试听审核。${excluded.length ? `另有 ${excluded.length} 段接近静音，未发布。` : ''}</p></html>`);
  console.log(`${kind}: ${items.length} recordings imported, ${excluded.length} excluded`);
}

await importKind('readings');
await importKind('strokes');
