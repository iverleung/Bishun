import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';

const [cdp = 'http://127.0.0.1:9224', url = 'http://127.0.0.1:5173/record/index.html'] = process.argv.slice(2);
const browser = await openBrowser(cdp, url, { ready: "document.querySelector('#recordState')?.textContent === '准备好了'" });
try {
    const { command, evaluate, wait, click, screenshot, exceptions } = browser;
    await command('Page.addScriptToEvaluateOnNewDocument', { source: `
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        window.__microphoneRequests = 0;
        window.__microphoneStreams = [];
        navigator.mediaDevices.getUserMedia = async (...args) => {
            window.__microphoneRequests++;
            const stream = await getUserMedia(...args);
            window.__microphoneStreams.push(stream);
            return stream;
        };
    ` });
    await command('Page.reload');
    await wait("document.querySelector('#recordState')?.textContent === '准备好了' && window.__microphoneRequests === 1 && window.__microphoneStreams[0]?.active");
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const positions = "() => ({record:document.querySelector('#recordBtn').getBoundingClientRect().top,nav:document.querySelector('.recording-navigation').getBoundingClientRect().top})";
    const before = await evaluate(`(${positions})()`);
    const point = await evaluate("(()=>{const r=document.querySelector('#recordBtn').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await wait("document.querySelector('#recordState').textContent.includes('录音中')");
    await new Promise(resolve => setTimeout(resolve, 800));
    const during = await evaluate(`(${positions})()`);
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await wait("document.querySelector('#recordState').textContent.startsWith('已保存')", 15000);
    assert.equal(await evaluate('window.__microphoneRequests'), 1);
    const after = await evaluate(`(${positions})()`);
    // The intentional :active scale may move the button border by less than one pixel.
    assert.ok(Math.abs(during.record - before.record) < 1);
    assert.equal(during.nav, before.nav);
    assert.deepEqual(after, before);
    await wait("document.querySelector('#playback').readyState >= 2 && !document.querySelector('#playback').hidden", 15000);
    await evaluate("document.querySelector('#playback').play().then(()=>true)");
    await wait("!document.querySelector('#playback').paused && document.querySelector('#playback').currentTime > 0");
    await evaluate("document.querySelector('#playback').pause()");
    await command('Page.reload');
    await wait("document.querySelector('#reading').textContent === 'ā' && document.querySelector('#recordState')?.textContent.startsWith('已保存') && !document.querySelector('#playback').hidden");
    assert.equal(await evaluate("document.querySelector('#reading').textContent"), 'ā');
    assert.equal(await evaluate("document.querySelector('#readingExamples').textContent"), '阿  啊  呵');
    assert.equal(await evaluate("document.querySelector('#readingExamples').getBoundingClientRect().height"), 32);
    await click('#nextBtn');
    await wait("document.querySelector('#reading').textContent === 'á'");
    assert.equal(await evaluate("document.querySelector('#readingExamples').textContent.split('  ').length <= 3"), true);
    assert.equal(await evaluate("document.querySelector('#readingExamples').getBoundingClientRect().height"), 32);
    assert.equal(await evaluate("document.querySelector('#playback').hidden"), true);
    const nextPoint = await evaluate("(()=>{const r=document.querySelector('#recordBtn').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...nextPoint, button: 'left', clickCount: 1 });
    await wait("document.querySelector('#recordState').textContent.includes('录音中')");
    await new Promise(resolve => setTimeout(resolve, 500));
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...nextPoint, button: 'left', clickCount: 1 });
    await wait("document.querySelector('#recordState').textContent.startsWith('已保存')", 15000);
    assert.equal(await evaluate('window.__microphoneRequests'), 1);
    assert.equal(await evaluate('window.__microphoneStreams[0].active'), true);
    await evaluate(`(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
    })()`);
    await wait('window.__microphoneStreams[0].getTracks().every(track => track.readyState === "ended")');
    await evaluate(`(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
    })()`);
    await wait('window.__microphoneRequests === 2 && window.__microphoneStreams[1]?.active');

    await click('#previousBtn');
    await wait("document.querySelector('#reading').textContent === 'ā'");
    await click('#autoPlaybackBtn');
    await wait("document.querySelector('#autoPlaybackBtn').textContent === '停止试听' && !document.querySelector('#playback').paused");
    assert.equal(await evaluate('window.__microphoneStreams[1].getTracks().every(track => track.readyState === "ended")'), true);
    await wait("document.querySelector('#playback').readyState >= 2 && Number.isFinite(document.querySelector('#playback').duration)");
    await evaluate('document.querySelector("#playback").currentTime = Math.max(0, document.querySelector("#playback").duration - 0.05)');
    await wait("document.querySelector('#reading').textContent === 'á' && !document.querySelector('#playback').paused", 15000);
    await click('#autoPlaybackBtn');
    assert.equal(await evaluate("document.querySelector('#reading').textContent"), 'á');

    await click('.recording-tools summary');
    await wait("document.querySelector('.recording-tools').open");
    await click('#reviewToggleBtn');
    await wait("document.querySelector('#reviewToggleBtn').textContent === '取消待重录'");
    assert.equal(await evaluate("document.querySelector('#qualityText').textContent.includes('人工待重录')"), true);
    await evaluate("document.querySelector('#recordingFilter').value='unrecorded';document.querySelector('#recordingFilter').dispatchEvent(new Event('change'))");
    assert.equal(await evaluate("document.querySelector('#readingSelect').options.length"), 1492);
    assert.equal(await evaluate("Array.from(document.querySelector('#readingSelect').options).every(option => !option.textContent.includes('✓'))"), true);
    await evaluate("document.querySelector('#recordingFilter').value='all';document.querySelector('#recordingFilter').dispatchEvent(new Event('change'))");
    await click('.recording-tools summary');

    await click('#autoPlaybackBtn');
    await wait("!document.querySelector('#playback').paused");
    const reviewPoint = await evaluate("(()=>{const r=document.querySelector('#recordBtn').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...reviewPoint, button: 'left', clickCount: 1 });
    await wait("document.querySelector('#recordState').textContent.includes('录音中')");
    assert.equal(await evaluate("document.querySelector('#reading').textContent"), 'á');
    assert.equal(await evaluate("document.querySelector('#autoPlaybackBtn').textContent"), '自动试听');
    await new Promise(resolve => setTimeout(resolve, 500));
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...reviewPoint, button: 'left', clickCount: 1 });
    await wait("document.querySelector('#recordState').textContent.startsWith('已保存')", 15000);
    assert.equal(await evaluate("document.querySelector('#reading').textContent"), 'á');
    assert.equal(await evaluate("document.querySelector('#reviewToggleBtn').textContent"), '标记重录');
    await wait('document.querySelector("#playback").paused', 15000);
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.equal(await evaluate("document.querySelector('#reading').textContent"), 'á');
    assert.equal(await evaluate("localStorage.getItem('bishun-pinyin-recorder-current')"), 'á');

    await command('Page.reload');
    await wait("document.querySelector('#reading').textContent === 'á' && document.querySelector('#recordState').textContent.startsWith('已保存')");
    await evaluate("localStorage.setItem('bishun-pinyin-recorder-current', '0')");
    await command('Page.reload');
    await wait("document.querySelector('#reading').textContent === 'ā' && document.querySelector('#recordState').textContent.startsWith('已保存')");
    await evaluate("window.__nativePlay=document.querySelector('#playback').play.bind(document.querySelector('#playback'));document.querySelector('#playback').play=()=>Promise.reject(new DOMException('模拟播放失败','NotAllowedError'))");
    await click('#autoPlaybackBtn');
    await wait("document.querySelector('#message').textContent.includes('录音无法自动播放')");
    assert.equal(await evaluate("document.querySelector('#reading').textContent"), 'ā');
    assert.equal(await evaluate("document.querySelector('#autoPlaybackBtn').textContent"), '自动试听');
    await evaluate("document.querySelector('#playback').play=window.__nativePlay");

    await click('[data-recording-mode="strokes"]');
    await wait("document.querySelector('#recordingTitle').textContent === '笔画录音' && document.querySelector('#reading').textContent === '卧钩' && document.querySelector('#recordState').textContent === '准备好了'");
    assert.equal(await evaluate("document.querySelector('#readingExamples').textContent"), '');
    assert.equal(await evaluate("document.querySelector('#readingExamples').getBoundingClientRect().height"), 32);
    const strokePoint = await evaluate("(()=>{const r=document.querySelector('#recordBtn').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...strokePoint, button: 'left', clickCount: 1 });
    await wait("document.querySelector('#recordState').textContent.includes('录音中')");
    await new Promise(resolve => setTimeout(resolve, 500));
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...strokePoint, button: 'left', clickCount: 1 });
    await wait("document.querySelector('#recordState').textContent.startsWith('已保存')", 15000);
    assert.equal(await evaluate("localStorage.getItem('bishun-stroke-recorder-current')"), 'stroke-68d536dce75d');
    await click('[data-recording-mode="pinyin"]');
    await wait("document.querySelector('#reading').textContent === 'ā' && document.querySelector('#recordState').textContent.startsWith('已保存')");
    await click('[data-recording-mode="strokes"]');
    await wait("document.querySelector('#reading').textContent === '卧钩' && document.querySelector('#recordState').textContent.startsWith('已保存')");
    const databaseCounts = await evaluate(`Promise.all(['bishun-pinyin-recorder','bishun-stroke-recorder'].map(name => new Promise((resolve,reject) => {
        const request=indexedDB.open(name);
        request.onsuccess=()=>{const db=request.result;const keys=db.transaction('recordings').objectStore('recordings').getAllKeys();keys.onsuccess=()=>{resolve(keys.result.length);db.close()};keys.onerror=()=>reject(keys.error)};
        request.onerror=()=>reject(request.error);
    })))`);
    assert.deepEqual(databaseCounts, [2, 1]);
    await click('[data-recording-mode="pinyin"]');
    await wait("document.querySelector('#reading').textContent === 'ā' && document.querySelector('#recordState').textContent.startsWith('已保存')");
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.deepEqual(exceptions, []);
    await screenshot('/tmp/bishun-recorder-mobile.png');
    console.log('PASS: pinyin and stroke recording stay isolated; mode switching restores saved audio; background, auto playback, interruption, review, legacy position and mobile width');
} finally {
    await browser.close();
}
