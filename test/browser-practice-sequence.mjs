import assert from 'node:assert/strict';
import { openBrowser } from './helpers/cdp.mjs';
import { practiceStroke } from './helpers/practice-input.mjs';

const [cdpUrl='http://127.0.0.1:9223',pageUrl='http://192.168.6.169:5188/']=process.argv.slice(2);
const browser=await openBrowser(cdpUrl,pageUrl);
const checks=[];
let backgroundResumes = 0;
try {
    const {command,evaluate,wait,click,fill}=browser;
    await evaluate("window.modeFocusCount=0;document.querySelector('#practiceMode').addEventListener('focus',()=>window.modeFocusCount++);");
    async function focusOnPractice() {
        await wait("document.activeElement.id === 'practicePanel'");
        assert.equal(await evaluate('window.modeFocusCount'),0);
    }
    const active="!document.querySelector('#practicePanel').hidden && !document.querySelector('#practiceHintBtn').disabled && document.querySelector('#practiceHintBtn').textContent === '提示下一笔'";
    const feedback=text=>`document.querySelector('#practiceFeedback').textContent === ${JSON.stringify(text)}`;
    async function query(text) {
        await fill('#query',text);await click('#searchForm [type="submit"]');
        await wait(`!document.querySelector('#playBtn').disabled && document.querySelector('#lessonActionsHeading').textContent === '当前字 · ${Array.from(text)[0]}'`);
    }
    async function enter() { await click('#menuBtn');await click('#practiceBtn');await wait(active);await focusOnPractice(); }
    async function finish(character) {
        const count=character==='一'?1:2;
        for(let index=0;index<count;index++) {
            await browser.activate();
            await wait("document.visibilityState === 'visible'");
            if (await evaluate("document.querySelector('#practiceHintBtn').textContent === '继续练习'")) {
                await click('#practiceHintBtn');await wait(active);backgroundResumes++;
            }
            await practiceStroke(browser,character,index);
            await wait(`document.querySelector('#practiceProgress').textContent === '${index+1} / ${count} 笔'`);
        }
        await wait("!document.querySelector('#practiceContinueActions').hidden");
    }
    async function next(position) {
        await click('#practiceNextBtn');await wait(active);
        await wait(`document.querySelector('#wordPosition').textContent === '${position}'`);
        await focusOnPractice();
        assert.equal(await evaluate("document.querySelector('#practiceProgress').textContent.startsWith('0 /')"),true);
        assert.equal(await evaluate("document.querySelector('#animationLayer').children.length"),0);
        assert.equal(await evaluate("document.querySelector('#practiceMode').value"),'independent');
    }
    await query('一十一');await enter();
    await evaluate("document.querySelector('#practiceMode').value='independent';document.querySelector('#practiceMode').dispatchEvent(new Event('change'))");
    await wait(active);
    assert.equal(await evaluate("document.querySelector('#practiceContinueActions').hidden"),true);
    assert.deepEqual(await evaluate("Array.from(document.querySelector('#practiceMode').options, option=>option.text)"),['描红','背临']);
    await finish('一');await wait(feedback('这一字写完了'));
    await click('#practiceRestartBtn');await wait(active);await focusOnPractice();await finish('一');
    await next('2 / 3');await finish('十');await next('3 / 3');await finish('一');
    await wait(feedback('本次写完 3 字'));
    assert.equal(await evaluate("document.querySelector('#practiceNextBtn').textContent"),'再练一遍');
    checks.push('explicit next preserves query order and duplicates; rewriting does not inflate completed count; group summary appears');
    await next('1 / 3');await finish('一');await next('2 / 3');
    await click('#practiceExitBtn');await wait("document.querySelector('#practicePanel').hidden");
    await enter();await finish('十');await next('3 / 3');await finish('一');
    await wait(feedback('本次写完 2 字'));
    checks.push('replay starts a fresh run; exiting discards progress; starting midway practices from current character to end');

    await query('一𠮷十');await enter();await finish('一');
    await click('#practiceNextBtn');await wait(feedback('“𠮷”暂未收录'));
    assert.equal(await evaluate("document.querySelector('#practiceSkipBtn').hidden"),false);
    assert.equal(await evaluate("document.querySelector('#wordPosition').textContent"),'1 / 3');
    await click('#practiceNextBtn');await wait(feedback('“𠮷”暂未收录'));
    await click('#practiceSkipBtn');await wait(active);
    await wait("document.querySelector('#wordPosition').textContent === '3 / 3'");
    await finish('十');await wait(feedback('本次写完 2 字，跳过 1 字'));
    checks.push('missing character stays explicit, can retry or skip; skipped entries never count as written');

    await command('Network.setBlockedURLs',{urls:['*/characters/2.0.1/%E4%B8%81.json','*/characters/2.0.1/丁.json']});
    await query('一丁');await enter();await finish('一');
    await click('#practiceNextBtn');await wait(feedback('“丁”加载失败'));
    await command('Network.setBlockedURLs',{urls:[]});
    await next('2 / 2');await finish('丁');await wait(feedback('本次写完 2 字'));
    checks.push('network failure is recoverable via retry without losing the completed character or changing practice mode');

    await query('一𠮷');await enter();await finish('一');
    await click('#practiceNextBtn');await wait(feedback('“𠮷”暂未收录'));
    await click('#practiceSkipBtn');await wait(feedback('本次写完 1 字，跳过 1 字'));
    await next('1 / 2');await finish('一');
    await click('#practiceNextBtn');await wait(feedback('“𠮷”暂未收录'));
    checks.push('skipping the final missing character ends the run; replay resets the skipped set');

    // Prevent prefetch and next-character requests from resolving until the user exits.
    await command('Network.setCacheDisabled',{cacheDisabled:true});
    await command('Fetch.enable',{patterns:[{urlPattern:'*/characters/2.0.1/二.json',requestStage:'Request'},{urlPattern:'*/characters/2.0.1/%E4%BA%8C.json',requestStage:'Request'}]});
    await query('一二');await enter();await finish('一');
    await click('#practiceNextBtn');await wait(feedback('准备下一个字…'));
    await query('十');
    await command('Fetch.disable');
    await wait("document.querySelector('#practicePanel').hidden && document.querySelector('#lessonActionsHeading').textContent === '当前字 · 十'");
    await new Promise(resolve=>setTimeout(resolve,250));
    assert.equal(await evaluate("document.querySelector('#practicePanel').hidden"),true);
    checks.push('new query during pending next-character load cancels the run; late data cannot reopen practice');
    await command('Fetch.enable',{patterns:[{urlPattern:'*/characters/2.0.1/*',requestStage:'Request'}]});
    await query('一工');await enter();await finish('一');
    await click('#practiceNextBtn');await wait(feedback('准备下一个字…'));
    await click('#practiceExitBtn');await command('Fetch.disable');
    await wait("document.querySelector('#practicePanel').hidden && document.querySelector('#lessonActionsHeading').textContent === '当前字 · 一'");
    checks.push('returning to demonstration during next-character loading cancels the pending transition');

    await command('Fetch.enable',{patterns:[{urlPattern:'*/characters/2.0.1/*',requestStage:'Request'}]});
    await query('一三');await enter();await finish('一');
    await click('#practiceNextBtn');await wait(feedback('准备下一个字…'));
    await click('#menuBtn');
    await command('Fetch.disable');
    await wait("document.querySelector('#wordPosition').textContent === '2 / 2' && document.querySelector('#practiceHintBtn').textContent === '继续练习'");
    await click('#closeMenuBtn');
    assert.equal(await evaluate("document.querySelector('#practiceHintBtn').textContent"),'继续练习');
    await click('#practiceExitBtn');
    checks.push('opening menu while next character loads leaves new practice paused; closing menu never enables input automatically');
    await query('十');await enter();await finish('十');await wait(feedback('本次写完 1 字'));
    await command('Emulation.setDeviceMetricsOverride',{width:320,height:820,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
    await browser.screenshot('/private/tmp/bishun-practice-sequence-complete.png');
    assert.equal(await evaluate('window.modeFocusCount'),0);
    checks.push('enter, next and rewrite focus the practice panel without focusing the native mode picker; modes labelled 描红 and 背临');
    assert.deepEqual(browser.exceptions,[]);
    console.log(JSON.stringify({browser:browser.version,checks,backgroundResumes,exceptions:browser.exceptions},null,2));
} catch(error) {
    console.error(await browser.evaluate("({visibility:document.visibilityState,progress:document.querySelector('#practiceProgress').textContent,feedback:document.querySelector('#practiceFeedback').textContent,position:document.querySelector('#wordPosition').textContent})"));
    throw error;
} finally { await browser.close(); }
