export const QUALITY_FLAGS = Object.freeze({
  decode: '解码失败',
  short: '时长过短',
  silent: '疑似空录音',
  leadingSilence: '开头静音过长',
  trailingSilence: '结尾静音过长',
  quiet: '有效声偏轻',
  loud: '峰值偏高',
  clipping: '疑似削波',
});

const WINDOW_MS = 20;
const SILENCE_DB = -45;
const QUIET_DB = -35;
const LOUD_DB = -0.5;

function dbfs(value) {
  return value > 0 ? 20 * Math.log10(value) : -Infinity;
}

function finiteDb(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

export function analyzePcm(channels, sampleRate) {
  if (!Array.isArray(channels) || !channels.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TypeError('PCM 数据无效');
  }
  const length = channels[0].length;
  if (!length || channels.some(channel => channel.length !== length)) throw new TypeError('PCM 声道长度无效');

  const flags = [];
  const windowSize = Math.max(1, Math.round(sampleRate * WINDOW_MS / 1000));
  const silenceThreshold = 10 ** (SILENCE_DB / 20);
  const loudThreshold = 10 ** (LOUD_DB / 20);
  const windows = [];
  let peak = 0;
  let fullScaleRun = 0;
  let maxFullScaleRun = 0;

  for (let start = 0; start < length; start += windowSize) {
    const end = Math.min(length, start + windowSize);
    let sumSquares = 0;
    for (const channel of channels) {
      for (let index = start; index < end; index++) {
        const sample = channel[index];
        const amplitude = Math.abs(sample);
        sumSquares += sample * sample;
        if (amplitude > peak) peak = amplitude;
        if (amplitude >= 0.999) {
          fullScaleRun++;
          maxFullScaleRun = Math.max(maxFullScaleRun, fullScaleRun);
        } else {
          fullScaleRun = 0;
        }
      }
    }
    const rms = Math.sqrt(sumSquares / ((end - start) * channels.length));
    windows.push({ start, end, rms, active: rms >= silenceThreshold });
  }

  const firstActive = windows.findIndex(window => window.active);
  const lastActive = windows.findLastIndex(window => window.active);
  const durationMs = length / sampleRate * 1000;
  if (durationMs < 400) flags.push('short');

  let leadingSilenceMs = durationMs;
  let trailingSilenceMs = durationMs;
  let activeRms = 0;
  let activeDurationMs = 0;
  if (firstActive < 0) {
    flags.push('silent');
    activeRms = -Infinity;
  } else {
    const activeWindows = windows.slice(firstActive, lastActive + 1);
    const activeSamples = activeWindows.reduce((total, window) => total + window.end - window.start, 0);
    const activeSquares = activeWindows.reduce((total, window) => total + window.rms ** 2 * (window.end - window.start), 0);
    activeRms = Math.sqrt(activeSquares / activeSamples);
    activeDurationMs = activeSamples / sampleRate * 1000;
    leadingSilenceMs = windows[firstActive].start / sampleRate * 1000;
    trailingSilenceMs = (length - windows[lastActive].end) / sampleRate * 1000;
    if (activeDurationMs < 120) flags.push('short');
    if (leadingSilenceMs > 800) flags.push('leadingSilence');
    if (trailingSilenceMs > 800) flags.push('trailingSilence');
    if (dbfs(activeRms) < QUIET_DB) flags.push('quiet');
  }
  if (peak >= loudThreshold) flags.push('loud');
  if (maxFullScaleRun >= 3) flags.push('clipping');

  return {
    flags,
    metrics: {
      durationMs: Math.round(durationMs),
      activeDurationMs: Math.round(activeDurationMs),
      activeRmsDb: finiteDb(dbfs(activeRms)),
      peakDb: finiteDb(dbfs(peak)),
      leadingSilenceMs: Math.round(leadingSilenceMs),
      trailingSilenceMs: Math.round(trailingSilenceMs),
    },
  };
}

export function recordingIdentity(record) {
  return `${record.reading}:${record.createdAt}:${record.blob.size}`;
}

export async function analyzeRecording(record, context) {
  try {
    const buffer = await record.blob.arrayBuffer();
    const decoded = await context.decodeAudioData(buffer);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    return { identity: recordingIdentity(record), ...analyzePcm(channels, decoded.sampleRate) };
  } catch {
    return { identity: recordingIdentity(record), flags: ['decode'], metrics: null };
  }
}
