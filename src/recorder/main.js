import { createZip } from './archive.js';
import { openRecordingStore } from './store.js';
import { analyzeRecording, QUALITY_FLAGS, recordingIdentity } from './quality.js';
import { exportManifestEntry, exportRecordingName, recordingTasks } from './tasks.js';

const MAX_RECORDING_MS = 10000;
const MIN_RECORDING_MS = 300;
let mode = 'pinyin';
let readings = recordingTasks[mode].items;
const stores = new Map();
for (const task of Object.values(recordingTasks)) {
  if (!task.items.length || new Set(task.items.map(item => item.reading)).size !== task.items.length) {
    throw new Error(`${task.noun}清单为空或包含重复标识`);
  }
}

const elements = Object.fromEntries([
  'progressText', 'progressBar', 'position', 'reading', 'readingExamples', 'recordHint', 'recordState', 'timer',
  'recordBtn', 'recordLabel', 'message', 'previousBtn', 'nextUnrecordedBtn', 'nextBtn',
  'readingSelect', 'exportBtn', 'playback', 'qualityText', 'qualityProgress',
  'autoPlaybackBtn', 'autoScope', 'nextReviewBtn', 'recordingFilter', 'reviewToggleBtn',
  'recordingTitle', 'recordingFilterLabel', 'readingSelectLabel', 'recordingNavigation',
].map(id => [id, document.getElementById(id)]));

let store;
let currentIndex = 0;
let currentRecording = null;
let recordedKeys = new Set();
let state = 'loading';
let operation = 0;
let session = null;
let playbackUrl = null;
let playbackGeneration = 0;
let activePlaybackGeneration = 0;
let microphoneStream = null;
let microphonePromise = null;
let microphonePromiseGeneration = 0;
let microphoneGeneration = 0;
let holdActive = false;
let activePointerId = null;
let reviews = new Map();
let autoPlayback = false;
let autoAdvanceTimer = null;
let qualityContext = null;
let qualityTimer = null;
let qualityGeneration = 0;
let qualityRunning = false;
const qualityQueue = [];
const qualityPending = new Set();

let readingOptions = [];
let renderedOptionKey = '';

function rebuildReadingOptions() {
  readingOptions = readings.map(item => {
    const option = document.createElement('option');
    option.value = String(item.position - 1);
    option.textContent = `${String(item.position).padStart(4, '0')}  ${item.label}`;
    return option;
  });
  elements.readingSelect.replaceChildren(...readingOptions);
  renderedOptionKey = '';
}

rebuildReadingOptions();

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)} 秒`;
}

function showMessage(text = '', kind = 'error') {
  elements.message.textContent = text;
  elements.message.hidden = !text;
  elements.message.classList.toggle('is-success', kind === 'success');
  elements.message.setAttribute('role', kind === 'error' ? 'alert' : 'status');
}

function reviewFor(reading) {
  return reviews.get(reading);
}

function needsReview(reading) {
  const review = reviewFor(reading);
  return Boolean(review?.manual || review?.analysis?.flags?.length);
}

function matchesFilter(index, filter = elements.recordingFilter.value) {
  const { reading } = readings[index];
  if (filter === 'recorded') return recordedKeys.has(reading);
  if (filter === 'unrecorded') return !recordedKeys.has(reading);
  if (filter === 'review') return needsReview(reading);
  return true;
}

function currentQualityText() {
  const reading = readings[currentIndex].reading;
  const review = reviewFor(reading);
  const labels = [];
  if (review?.manual) labels.push('人工待重录');
  for (const flag of review?.analysis?.flags || []) labels.push(QUALITY_FLAGS[flag] || flag);
  if (!labels.length && qualityPending.has(reading)) return '正在等待技术检查';
  return labels.join(' · ');
}

function render() {
  const item = readings[currentIndex];
  const task = recordingTasks[mode];
  const isReady = state === 'ready';
  const isRecording = state === 'recording';
  elements.recordingTitle.textContent = task.title;
  document.title = task.title;
  elements.recordHint.textContent = `按住下方按钮，读完当前${task.noun}后松开`;
  elements.recordingFilterLabel.textContent = `筛选${task.noun}`;
  elements.readingSelectLabel.textContent = `跳转到${task.noun}`;
  elements.recordingNavigation.setAttribute('aria-label', `切换${task.noun}`);
  for (const button of document.querySelectorAll('[data-recording-mode]')) {
    const active = button.dataset.recordingMode === mode;
    button.disabled = !isReady;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  elements.progressText.textContent = `已录 ${recordedKeys.size} / ${readings.length}`;
  elements.progressBar.style.width = `${recordedKeys.size / readings.length * 100}%`;
  elements.position.textContent = `第 ${item.position} 项`;
  elements.reading.textContent = item.label;
  elements.readingExamples.textContent = item.characters.join('  ');
  elements.readingSelect.disabled = !isReady;
  elements.recordingFilter.disabled = !isReady;
  const visibleOptions = [];
  const visibleIndexes = [];
  for (const option of readingOptions) {
    const index = Number(option.value);
    const reading = readings[index].reading;
    const review = reviewFor(reading);
    const flags = review?.analysis?.flags?.length ? '  ⚠' : '';
    const manual = review?.manual ? '  !' : '';
    option.textContent = `${String(index + 1).padStart(4, '0')}  ${readings[index].label}${recordedKeys.has(reading) ? '  ✓' : ''}${manual}${flags}`;
    if (matchesFilter(index)) {
      visibleOptions.push(option);
      visibleIndexes.push(index);
    }
  }
  const optionKey = `${elements.recordingFilter.value}:${visibleIndexes.join(',')}`;
  if (optionKey !== renderedOptionKey) {
    elements.readingSelect.replaceChildren(...visibleOptions);
    renderedOptionKey = optionKey;
  }
  elements.readingSelect.value = String(currentIndex);

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
  elements.nextReviewBtn.disabled = !isReady || !readings.some(reading => needsReview(reading.reading));
  elements.exportBtn.disabled = !isReady || recordedKeys.size === 0;
  elements.reviewToggleBtn.disabled = !isReady || !currentRecording;
  elements.reviewToggleBtn.textContent = reviewFor(item.reading)?.manual ? '取消待重录' : '标记重录';
  elements.autoPlaybackBtn.disabled = !isReady || recordedKeys.size === 0;
  elements.autoPlaybackBtn.textContent = autoPlayback ? '停止试听' : '自动试听';
  elements.autoScope.disabled = !isReady || autoPlayback;
  elements.qualityText.textContent = currentQualityText();
  elements.qualityProgress.textContent = qualityPending.size
    ? `还需检查 ${qualityPending.size} 段；可随时重录或导出。`
    : '技术检查已完成；结果仅供复查，不代表发音审核通过。';
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
  if (microphonePromise && microphonePromiseGeneration === microphoneGeneration) return microphonePromise;
  const generation = microphoneGeneration;
  microphonePromiseGeneration = generation;
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
  playbackGeneration++;
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

function stopAutoPlayback() {
  autoPlayback = false;
  clearTimeout(autoAdvanceTimer);
  autoAdvanceTimer = null;
}

async function playCurrent() {
  if (!currentRecording || state !== 'ready') return;
  activePlaybackGeneration = playbackGeneration;
  try {
    await elements.playback.play();
  } catch (error) {
    if (activePlaybackGeneration !== playbackGeneration) return;
    stopAutoPlayback();
    render();
    showMessage(`录音无法自动播放：${error.message}。可点击原生播放按钮重试。`);
  }
}

function scheduleAutoAdvance(delay = 600) {
  clearTimeout(autoAdvanceTimer);
  const generation = playbackGeneration;
  autoAdvanceTimer = window.setTimeout(() => {
    if (!autoPlayback || generation !== playbackGeneration || state !== 'ready') return;
    const reviewOnly = elements.autoScope.value === 'review';
    let next = -1;
    for (let index = currentIndex + 1; index < readings.length; index++) {
      if (recordedKeys.has(readings[index].reading) && (!reviewOnly || needsReview(readings[index].reading))) {
        next = index;
        break;
      }
    }
    if (next < 0) {
      stopAutoPlayback();
      render();
      showMessage('自动试听已结束。', 'success');
      return;
    }
    void loadCurrent(next, { automatic: true });
  }, delay);
}

function startAutoPlayback() {
  if (state !== 'ready' || !recordedKeys.size) return;
  releaseMicrophone();
  showMessage();
  autoPlayback = true;
  render();
  const matchesScope = currentRecording && (elements.autoScope.value !== 'review' || needsReview(readings[currentIndex].reading));
  if (matchesScope) void playCurrent();
  else scheduleAutoAdvance(0);
}

function savePosition() {
  try { localStorage.setItem(recordingTasks[mode].storageKey, readings[currentIndex].reading); } catch { /* Recordings remain safe if position storage is unavailable. */ }
}

function restorePosition() {
  try {
    const saved = localStorage.getItem(recordingTasks[mode].storageKey) || '0';
    if (/^\d+$/.test(saved)) {
      const index = Number(saved);
      return Number.isInteger(index) && index >= 0 && index < readings.length ? index : 0;
    }
    const reading = saved.normalize('NFC');
    const index = readings.findIndex(item => item.reading === reading);
    return index >= 0 ? index : 0;
  } catch {
    return 0;
  }
}

function scheduleQualityChecks() {
  if (qualityTimer || qualityRunning || !qualityQueue.length || document.hidden) return;
  qualityTimer = window.setTimeout(runNextQualityCheck, 40);
}

function queueQualityCheck(reading, { priority = false } = {}) {
  if (!recordedKeys.has(reading)) return;
  const queued = qualityQueue.indexOf(reading);
  if (queued >= 0) {
    if (priority && queued > 0) {
      qualityQueue.splice(queued, 1);
      qualityQueue.unshift(reading);
    }
    return;
  }
  if (qualityPending.has(reading)) return;
  qualityPending.add(reading);
  if (priority) qualityQueue.unshift(reading);
  else qualityQueue.push(reading);
  scheduleQualityChecks();
}

function queueAllQualityChecks() {
  for (const item of readings) queueQualityCheck(item.reading);
  render();
}

async function runNextQualityCheck() {
  qualityTimer = null;
  if (!qualityQueue.length || document.hidden) {
    qualityRunning = false;
    return;
  }
  const generation = qualityGeneration;
  const reading = qualityQueue.shift();
  qualityRunning = true;
  try {
    const record = await store.get(reading);
    if (generation !== qualityGeneration) return;
    if (record) {
      const identity = recordingIdentity(record);
      const existing = await store.review(reading);
      if (existing?.identity !== identity || !existing.analysis) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error('当前浏览器不支持音频技术检查');
        qualityContext ||= new AudioContextClass();
        const analysis = await analyzeRecording(record, qualityContext);
        if (generation !== qualityGeneration) return;
        const latest = await store.get(reading);
        if (!latest || recordingIdentity(latest) !== identity) return;
        const review = {
          reading, identity, manual: Boolean(existing?.manual),
          analysis: { flags: analysis.flags, metrics: analysis.metrics },
          updatedAt: new Date().toISOString(),
        };
        await store.putReview(review);
        reviews.set(reading, review);
      }
    }
  } catch (error) {
    if (generation === qualityGeneration) showMessage(`技术检查暂时不可用：${error.message}`);
  } finally {
    if (!qualityQueue.includes(reading)) qualityPending.delete(reading);
    qualityRunning = false;
    if (generation === qualityGeneration) {
      render();
      scheduleQualityChecks();
    }
  }
}

function cancelQualityChecks() {
  qualityGeneration++;
  clearTimeout(qualityTimer);
  qualityTimer = null;
  qualityQueue.length = 0;
  qualityPending.clear();
  qualityContext?.close();
  qualityContext = null;
}

async function loadCurrent(index, { automatic = false, replay = false } = {}) {
  if (!automatic) stopAutoPlayback();
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
    if (record) queueQualityCheck(record.reading, { priority: true });
    render();
    if (automatic || replay) void playCurrent();
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
  stopAutoPlayback();
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
    if (!blob.size || durationMs < MIN_RECORDING_MS) throw new Error(`录音太短，请自然读完${recordingTasks[mode].noun}后再停止。`);
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
    qualityPending.delete(record.reading);
    const queued = qualityQueue.indexOf(record.reading);
    if (queued >= 0) qualityQueue.splice(queued, 1);
    const review = {
      reading: record.reading, identity: recordingIdentity(record), manual: false, analysis: null,
      updatedAt: new Date().toISOString(),
    };
    reviews.set(record.reading, review);
    store.putReview(review).catch(error => showMessage(`复查标记保存失败：${error.message}`));
    session = null;
    state = 'ready';
    preparePlayback();
    queueQualityCheck(record.reading, { priority: true });
    render();
    void playCurrent();
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
  stopAutoPlayback();
  cancelQualityChecks();
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

async function toggleReview() {
  if (state !== 'ready' || !currentRecording) return;
  stopAutoPlayback();
  const record = currentRecording;
  const identity = recordingIdentity(record);
  try {
    const existing = await store.review(record.reading);
    if (currentRecording !== record) return;
    const review = {
      reading: record.reading,
      identity,
      manual: !existing?.manual,
      analysis: existing?.identity === identity ? existing.analysis : null,
      updatedAt: new Date().toISOString(),
    };
    await store.putReview(review);
    reviews.set(record.reading, review);
    render();
  } catch (error) {
    showMessage(`复查标记保存失败：${error.message}`);
  }
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
    const manifest = records.map(record => exportManifestEntry(mode, byReading.get(record.reading), record));
    const archive = await createZip([
      { name: 'manifest.json', data: JSON.stringify({ schemaVersion: 1, ...(mode === 'strokes' ? { kind: 'strokes' } : {}), recordings: manifest }, null, 2) },
      ...records.map(record => ({
        name: exportRecordingName(mode, byReading.get(record.reading), record),
        data: record.blob,
      })),
    ]);
    if (id !== operation) return;
    const url = URL.createObjectURL(archive);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${recordingTasks[mode].archiveName}-${new Date().toISOString().slice(0, 10)}.zip`;
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
elements.nextReviewBtn.addEventListener('click', () => {
  for (let step = 1; step <= readings.length; step++) {
    const index = (currentIndex + step) % readings.length;
    if (needsReview(readings[index].reading)) {
      void loadCurrent(index);
      break;
    }
  }
});
elements.autoPlaybackBtn.addEventListener('click', () => {
  if (autoPlayback) {
    stopAutoPlayback();
    stopPlayback();
    render();
  } else {
    startAutoPlayback();
  }
});
elements.recordingFilter.addEventListener('change', () => {
  stopAutoPlayback();
  stopPlayback();
  render();
});
elements.reviewToggleBtn.addEventListener('click', () => void toggleReview());
document.querySelector('.recording-tools').addEventListener('toggle', event => {
  if (event.target.open) queueAllQualityChecks();
});
elements.readingSelect.addEventListener('change', event => void loadCurrent(Number(event.target.value)));
elements.playback.addEventListener('ended', () => {
  if (autoPlayback && activePlaybackGeneration === playbackGeneration) scheduleAutoAdvance();
});
elements.playback.addEventListener('error', () => {
  stopAutoPlayback();
  render();
  if (currentRecording && elements.playback.currentSrc) {
    showMessage('这段录音无法解码播放，请重新录制；原录音仍可导出。');
  }
});
elements.exportBtn.addEventListener('click', () => void exportRecordings());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelForBackground();
  else {
    void warmMicrophone();
    if (document.querySelector('.recording-tools').open) queueAllQualityChecks();
  }
});
window.addEventListener('pagehide', cancelForBackground);

async function initialize() {
  const requestedMode = mode;
  render();
  void warmMicrophone();
  try {
    if (!stores.has(requestedMode)) stores.set(requestedMode, await openRecordingStore(recordingTasks[requestedMode].databaseMode));
    if (requestedMode !== mode) return;
    store = stores.get(requestedMode);
    reviews = new Map((await store.allReviews()).map(review => [review.reading, review]));
    recordedKeys = new Set((await store.keys()).filter(key => readings.some(item => item.reading === key)));
    currentIndex = restorePosition();
    await loadCurrent(currentIndex);
  } catch (error) {
    if (requestedMode !== mode) return;
    state = 'loading';
    render();
    elements.recordState.textContent = '无法使用本地录音存储';
    showMessage(`${recordingError(error)} 请确认浏览器允许网站存储，并未使用无痕模式。`);
  }
}

async function switchMode(nextMode) {
  if (nextMode === mode || state !== 'ready' || !recordingTasks[nextMode]) return;
  stopAutoPlayback();
  cancelQualityChecks();
  operation++;
  mode = nextMode;
  readings = recordingTasks[mode].items;
  currentRecording = null;
  recordedKeys = new Set();
  reviews = new Map();
  currentIndex = 0;
  state = 'loading';
  showMessage();
  preparePlayback();
  rebuildReadingOptions();
  render();
  await initialize();
}

for (const button of document.querySelectorAll('[data-recording-mode]')) {
  button.addEventListener('click', () => void switchMode(button.dataset.recordingMode));
}

void initialize();
