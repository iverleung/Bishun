import catalog from '../../docs/拼音音节合成列表.json';
import { createZip, recordingFileName } from './archive.js';
import { openRecordingStore } from './store.js';

const STORAGE_KEY = 'bishun-pinyin-recorder-current';
const MAX_RECORDING_MS = 10000;
const MIN_RECORDING_MS = 300;
const readings = catalog.map((entry, index) => ({
  reading: entry.reading.normalize('NFC'),
  position: index + 1,
}));
if (!readings.length || new Set(readings.map(item => item.reading)).size !== readings.length) {
  throw new Error('拼音清单为空或包含重复读音');
}

const elements = Object.fromEntries([
  'progressText', 'progressBar', 'position', 'reading', 'recordHint', 'recordState', 'timer',
  'recordBtn', 'recordLabel', 'message', 'previousBtn', 'nextUnrecordedBtn', 'nextBtn',
  'readingSelect', 'exportBtn', 'playback',
].map(id => [id, document.getElementById(id)]));

let store;
let currentIndex = 0;
let currentRecording = null;
let recordedKeys = new Set();
let state = 'loading';
let operation = 0;
let session = null;
let playbackUrl = null;
let microphoneStream = null;
let microphonePromise = null;
let microphoneGeneration = 0;
let holdActive = false;
let activePointerId = null;

for (const item of readings) {
  const option = document.createElement('option');
  option.value = String(item.position - 1);
  option.textContent = `${String(item.position).padStart(4, '0')}  ${item.reading}`;
  elements.readingSelect.append(option);
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)} 秒`;
}

function showMessage(text = '', kind = 'error') {
  elements.message.textContent = text;
  elements.message.hidden = !text;
  elements.message.classList.toggle('is-success', kind === 'success');
  elements.message.setAttribute('role', kind === 'error' ? 'alert' : 'status');
}

function render() {
  const item = readings[currentIndex];
  const isReady = state === 'ready';
  const isRecording = state === 'recording';
  elements.progressText.textContent = `已录 ${recordedKeys.size} / ${readings.length}`;
  elements.progressBar.style.width = `${recordedKeys.size / readings.length * 100}%`;
  elements.position.textContent = `第 ${item.position} 项`;
  elements.reading.textContent = item.reading;
  elements.readingSelect.value = String(currentIndex);
  elements.readingSelect.disabled = !isReady;
  for (const option of elements.readingSelect.options) {
    const reading = readings[Number(option.value)].reading;
    option.textContent = `${String(Number(option.value) + 1).padStart(4, '0')}  ${reading}${recordedKeys.has(reading) ? '  ✓' : ''}`;
  }

  const stateText = {
    loading: '正在准备…',
    starting: '等待麦克风，请继续按住',
    recording: '录音中，读完请松开',
    saving: '正在保存…',
    exporting: '正在打包录音…',
    ready: currentRecording ? `已保存 · ${formatDuration(currentRecording.durationMs)}` : '准备好了',
  };
  elements.recordState.textContent = stateText[state];
  elements.timer.hidden = false;
  elements.timer.style.visibility = isRecording ? 'visible' : 'hidden';
  if (!isRecording) elements.timer.textContent = '';
  elements.recordBtn.disabled = ['loading', 'saving', 'exporting'].includes(state);
  elements.recordBtn.classList.toggle('is-recording', isRecording);
  elements.recordLabel.textContent = isRecording ? '松开停止' : (currentRecording ? '按住重录' : '按住录音');
  elements.playback.hidden = !currentRecording || !isReady;
  elements.previousBtn.disabled = !isReady || currentIndex === 0;
  elements.nextBtn.disabled = !isReady || currentIndex === readings.length - 1;
  elements.nextUnrecordedBtn.disabled = !isReady || recordedKeys.size === readings.length || !recordedKeys.has(item.reading);
  elements.exportBtn.disabled = !isReady || recordedKeys.size === 0;
}

function recordingError(error) {
  if (!window.isSecureContext) return '请通过 HTTPS 打开此页面，浏览器才允许录音。';
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return '当前浏览器不支持录音，请使用最新版 Safari 或 Chrome。';
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return '未获得麦克风权限，请在浏览器设置中允许后重试。';
  if (error?.name === 'NotFoundError') return '没有找到可用的麦克风。';
  if (error?.name === 'NotReadableError') return '麦克风暂时不可用，请关闭其他录音应用后重试。';
  return error?.message || '录音失败，请重试。';
}

function stopTracks(stream) {
  stream?.getTracks().forEach(track => track.stop());
}

async function prepareMicrophone() {
  if (microphoneStream?.active) return microphoneStream;
  if (microphonePromise) return microphonePromise;
  const generation = microphoneGeneration;
  const pending = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (generation !== microphoneGeneration || document.hidden) {
      stopTracks(stream);
      throw new DOMException('麦克风准备已取消', 'AbortError');
    }
    microphoneStream = stream;
    return stream;
  })();
  microphonePromise = pending;
  try {
    return await pending;
  } finally {
    if (microphonePromise === pending) microphonePromise = null;
  }
}

function releaseMicrophone() {
  microphoneGeneration++;
  const stream = microphoneStream;
  microphoneStream = null;
  stopTracks(stream);
}

async function warmMicrophone() {
  try {
    await prepareMicrophone();
  } catch (error) {
    if (error?.name !== 'AbortError' && !document.hidden) showMessage(recordingError(error));
  }
}

function stopPlayback() {
  elements.playback.pause();
}

function preparePlayback() {
  stopPlayback();
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  playbackUrl = currentRecording ? URL.createObjectURL(currentRecording.blob) : null;
  if (playbackUrl) {
    elements.playback.src = playbackUrl;
    elements.playback.load();
  } else {
    elements.playback.removeAttribute('src');
  }
}

function savePosition() {
  try { localStorage.setItem(STORAGE_KEY, String(currentIndex)); } catch { /* Recordings remain safe if position storage is unavailable. */ }
}

function restorePosition() {
  try {
    const value = Number.parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
    return Number.isInteger(value) && value >= 0 && value < readings.length ? value : 0;
  } catch {
    return 0;
  }
}

async function loadCurrent(index) {
  const id = ++operation;
  currentIndex = Math.max(0, Math.min(readings.length - 1, index));
  savePosition();
  currentRecording = null;
  state = 'loading';
  showMessage();
  preparePlayback();
  render();
  try {
    const record = await store.get(readings[currentIndex].reading);
    if (id !== operation) return;
    currentRecording = record || null;
    state = 'ready';
    preparePlayback();
    render();
  } catch (error) {
    if (id !== operation) return;
    state = 'ready';
    render();
    showMessage(recordingError(error));
  }
}

function selectedMimeType() {
  return [
    'audio/mp4;codecs=mp4a.40.2', 'audio/mp4',
    'audio/webm;codecs=opus', 'audio/webm',
  ].find(type => MediaRecorder.isTypeSupported(type)) || '';
}

async function startRecording() {
  if (state !== 'ready' || !holdActive) return;
  const id = ++operation;
  state = 'starting';
  showMessage();
  stopPlayback();
  render();
  let stream;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error(recordingError());
    }
    stream = await prepareMicrophone();
    if (id !== operation || !holdActive) {
      if (id === operation) {
        state = 'ready';
        render();
      }
      return;
    }
    const mimeType = selectedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    session = {
      id, stream, recorder, chunks, done, stopping: false, failure: null,
      startedAt: 0, timerId: null, timeoutId: null,
    };
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = event => {
      if (session?.id !== id) return;
      session.failure = event.error || new Error('录音设备发生错误');
      void stopActiveRecording();
    };
    recorder.onstop = resolveDone;
    recorder.start(200);
    session.startedAt = performance.now();
    session.timerId = window.setInterval(() => {
      if (session?.id !== id || state !== 'recording') return;
      elements.timer.textContent = formatDuration(performance.now() - session.startedAt);
    }, 100);
    session.timeoutId = window.setTimeout(() => void stopActiveRecording(), MAX_RECORDING_MS);
    state = 'recording';
    elements.timer.textContent = '0.0 秒';
    render();
  } catch (error) {
    if (id !== operation) return;
    session = null;
    state = 'ready';
    render();
    showMessage(recordingError(error));
  }
}

async function stopActiveRecording({ discard = false } = {}) {
  const active = session;
  if (!active || active.stopping) return active?.done;
  active.stopping = true;
  clearInterval(active.timerId);
  clearTimeout(active.timeoutId);
  if (!discard) {
    state = 'saving';
    render();
  }
  try {
    if (active.recorder.state !== 'inactive') active.recorder.stop();
    await active.done;
    if (discard || active.id !== operation) return;
    if (active.failure) throw active.failure;
    const durationMs = Math.round(performance.now() - active.startedAt);
    const type = active.recorder.mimeType || selectedMimeType() || 'audio/webm';
    const blob = new Blob(active.chunks, { type });
    if (!blob.size || durationMs < MIN_RECORDING_MS) throw new Error('录音太短，请自然读完拼音后再停止。');
    const record = {
      reading: readings[currentIndex].reading,
      blob,
      mimeType: type,
      durationMs,
      createdAt: new Date().toISOString(),
    };
    await store.put(record);
    if (active.id !== operation) return;
    currentRecording = record;
    recordedKeys.add(record.reading);
    session = null;
    state = 'ready';
    preparePlayback();
    render();
  } catch (error) {
    if (active.id !== operation) return;
    session = null;
    state = 'ready';
    render();
    showMessage(recordingError(error));
  }
}

function cancelForBackground() {
  holdActive = false;
  activePointerId = null;
  releaseMicrophone();
  if (state === 'starting' || state === 'recording') {
    operation++;
    const active = session;
    if (active && !active.stopping) {
      active.stopping = true;
      clearInterval(active.timerId);
      clearTimeout(active.timeoutId);
      if (active.recorder.state !== 'inactive') active.recorder.stop();
    }
    session = null;
    state = 'ready';
    showMessage('页面进入后台，本次未完成录音未保存。');
  }
  stopPlayback();
  render();
}

async function exportRecordings() {
  if (state !== 'ready' || !recordedKeys.size) return;
  const id = ++operation;
  state = 'exporting';
  showMessage();
  render();
  try {
    const byReading = new Map(readings.map(item => [item.reading, item]));
    const records = (await store.all()).filter(record => byReading.has(record.reading));
    records.sort((left, right) => byReading.get(left.reading).position - byReading.get(right.reading).position);
    const manifest = records.map(record => ({
      reading: record.reading,
      file: recordingFileName(record.reading, byReading.get(record.reading).position, record.mimeType),
      durationMs: record.durationMs,
      mimeType: record.mimeType,
      createdAt: record.createdAt,
    }));
    const archive = await createZip([
      { name: 'manifest.json', data: JSON.stringify({ schemaVersion: 1, recordings: manifest }, null, 2) },
      ...records.map(record => ({
        name: recordingFileName(record.reading, byReading.get(record.reading).position, record.mimeType),
        data: record.blob,
      })),
    ]);
    if (id !== operation) return;
    const url = URL.createObjectURL(archive);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bishun-pinyin-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    state = 'ready';
    render();
    showMessage(`已导出 ${records.length} 段录音和清单。`, 'success');
  } catch (error) {
    if (id !== operation) return;
    state = 'ready';
    render();
    showMessage(`导出失败：${error.message}`);
  }
}

function finishHold() {
  if (!holdActive) return;
  holdActive = false;
  activePointerId = null;
  if (state === 'recording') {
    void stopActiveRecording();
  } else if (state === 'starting') {
    operation++;
    state = 'ready';
    render();
    showMessage('未开始录音，请按住按钮直到读完。');
  }
}

elements.recordBtn.addEventListener('pointerdown', event => {
  if (event.button !== 0 || state !== 'ready' || holdActive) return;
  event.preventDefault();
  holdActive = true;
  activePointerId = event.pointerId;
  elements.recordBtn.setPointerCapture(event.pointerId);
  void startRecording();
});
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  elements.recordBtn.addEventListener(eventName, event => {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();
    finishHold();
  });
}
elements.recordBtn.addEventListener('contextmenu', event => event.preventDefault());
elements.recordBtn.addEventListener('keydown', event => {
  if (![' ', 'Enter'].includes(event.key) || event.repeat || state !== 'ready' || holdActive) return;
  event.preventDefault();
  holdActive = true;
  void startRecording();
});
elements.recordBtn.addEventListener('keyup', event => {
  if (![' ', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  finishHold();
});
window.addEventListener('blur', finishHold);
elements.previousBtn.addEventListener('click', () => void loadCurrent(currentIndex - 1));
elements.nextBtn.addEventListener('click', () => void loadCurrent(currentIndex + 1));
elements.nextUnrecordedBtn.addEventListener('click', () => {
  for (let step = 1; step <= readings.length; step++) {
    const index = (currentIndex + step) % readings.length;
    if (!recordedKeys.has(readings[index].reading)) {
      void loadCurrent(index);
      break;
    }
  }
});
elements.readingSelect.addEventListener('change', event => void loadCurrent(Number(event.target.value)));
elements.playback.addEventListener('error', () => {
  if (currentRecording && elements.playback.currentSrc) {
    showMessage('这段录音无法解码播放，请重新录制；原录音仍可导出。');
  }
});
elements.exportBtn.addEventListener('click', () => void exportRecordings());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelForBackground();
  else void warmMicrophone();
});
window.addEventListener('pagehide', cancelForBackground);

async function initialize() {
  render();
  void warmMicrophone();
  try {
    store = await openRecordingStore();
    recordedKeys = new Set((await store.keys()).filter(key => readings.some(item => item.reading === key)));
    currentIndex = restorePosition();
    await loadCurrent(currentIndex);
  } catch (error) {
    state = 'loading';
    render();
    elements.recordState.textContent = '无法使用本地录音存储';
    showMessage(`${recordingError(error)} 请确认浏览器允许网站存储，并未使用无痕模式。`);
  }
}

void initialize();
