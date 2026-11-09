const buildId = () => document.querySelector('meta[name="offline-build"]')?.content;
const supported = () => isSecureContext && 'serviceWorker' in navigator && 'caches' in globalThis && /^[a-f0-9]{64}$/.test(buildId() || '');
const message = error => error.name === 'AbortError' ? '已取消，旧字单保持不变' : /[\u4e00-\u9fff]/.test(error.message) ? error.message : '离线操作未完成，请联网后重试';

async function worker(refresh = false) {
    let registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration || refresh) registration = await navigator.serviceWorker.register('/offline-sw.js',{scope:'/',updateViaCache:'none'});
    if (refresh && registration.active && !registration.installing) await registration.update();
    const pending = registration.installing || registration.waiting;
    if (pending && pending.state !== 'activated') await new Promise((resolve,reject) => {
        const timer=setTimeout(()=>{pending.removeEventListener('statechange',changed);reject(new Error('离线服务准备超时，请联网后重试'));},15000);
        function changed() {
            if (!['activated','redundant'].includes(pending.state))return;
            clearTimeout(timer);pending.removeEventListener('statechange',changed);
            if(pending.state==='activated')resolve();else reject(new Error('离线服务准备失败，请刷新后重试'));
        }
        pending.addEventListener('statechange',changed);changed();
    });
    if (!registration.active) throw new Error('离线服务尚未就绪，请重试');
    return registration.active;
}

function request(target,type,payload,{signal,progress=()=>{}}={}) {
    return new Promise((resolve,reject)=>{
        const channel=new MessageChannel(),id=crypto.randomUUID();
        let timer;
        function finish(error,result) {
            clearTimeout(timer);signal?.removeEventListener('abort',cancel);channel.port1.close();
            if(error)reject(error);else resolve(result);
        }
        const cancel=()=>target.postMessage({type:'CANCEL',id});
        if(signal?.aborted) {finish(new DOMException('已取消','AbortError'));return;}
        signal?.addEventListener('abort',cancel,{once:true});
        channel.port1.onmessage=event=>{
            if(event.data.progress) {progress(event.data.progress);return;}
            finish(event.data.error?new Error(event.data.error):null,event.data.result);
        };
        timer=setTimeout(()=>{cancel();finish(new Error('离线操作超时，请检查离线列表后重试'));},type === 'SAVE' ? 120000 : 15000);
        target.postMessage({id,type,payload},[channel.port2]);
    });
}

export function setupOffline({dom,getSelection,openQuery}) {
    let entries=[],ready=false,busy=false,task=null;
    const status=text=>{dom.offlineMessage.textContent=text;};
    function refreshSelection() {
        const selection=getSelection();
        dom.saveOfflineBtn.disabled=busy || !ready || !selection.query;
        dom.saveOfflineBtn.textContent=entries.some(item=>item.query===selection.query)?'更新这组字':'保存这组字';
        dom.cancelOfflineBtn.hidden=!busy;
    }
    function render() {
        dom.offlineCount.textContent=entries.length?`${entries.length} / 10`:'';
        dom.offlineList.replaceChildren(...entries.map(entry=>{
            const row=document.createElement('div');row.className='offline-row';
            const open=document.createElement('button');open.type='button';open.className='offline-open';
            open.textContent=entry.name ? `${entry.name} · ${entry.query}` : entry.query;open.disabled=busy || entry.broken;
            open.addEventListener('click',()=>openQuery(entry.query));
            const info=document.createElement('small');
            info.textContent=`${entry.broken?'资源不完整':entry.buildId!==buildId()?'可更新':'离线可用'} · 约 ${(entry.bytes/1024).toFixed(0)} KB${entry.unknownNames?' · 部分笔画名称暂缺':''}`;
            const actions=document.createElement('div');actions.className='offline-row-actions';
            for(const [label,action] of [['更新',()=>save(entry)],['删除',()=>remove(entry)]]) {
                const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=busy;
                button.addEventListener('click',()=>void action());actions.append(button);
            }
            row.append(open,info,actions);return row;
        }));
        refreshSelection();
    }
    async function list() {
        const result=await request(await worker(),'LIST');
        // Keep one newest committed copy per query after an interrupted cleanup.
        const seen=new Set();entries=result.packs.filter(item=>{if(seen.has(item.query))return false;seen.add(item.query);return true;});
        ready=true;render();
    }
    async function save(selection) {
        if(busy)return;
        busy=true;task=new AbortController();dom.cancelOfflineBtn.disabled=false;render();status('正在保存…');
        try {
            const target=await worker(true);
            if(task.signal.aborted)throw new DOMException('已取消','AbortError');
            await request(target,'SAVE',{query:selection.query,name:selection.name || '',expectedBuild:buildId()},{signal:task.signal,progress:progress=>status(`正在保存 · ${progress.files} 项资源`)});
            status('已保存，可离线使用');
        } catch(error) { status(message(error)); }
        finally { busy=false;task=null;try {await list();}catch {ready=false;render();} }
    }
    async function remove(entry) {
        if(busy)return;busy=true;render();
        try { await request(await worker(),'DELETE',{cacheName:entry.cacheName});status('已删除离线资源，生字本保持不变'); }
        catch(error) {status(message(error));}
        finally {busy=false;try {await list();}catch {ready=false;render();}}
    }
    dom.offlineSection.addEventListener('toggle',()=>{
        if(!dom.offlineSection.open || busy)return;
        if(!supported()) {
            status(!isSecureContext?'离线保存需通过 HTTPS 网站地址访问':!('serviceWorker' in navigator)?'此浏览器暂不支持离线保存':'请先构建并通过网站地址访问离线功能');
            ready=false;refreshSelection();return;
        }
        status('正在检查离线字单…');
        void list().then(()=>status(entries.length?'':'尚未保存离线字单')).catch(error=>{status(message(error));ready=false;render();});
    });
    dom.saveOfflineBtn.addEventListener('click',()=>void save(getSelection()));
    dom.cancelOfflineBtn.addEventListener('click',()=>{task?.abort();status('正在取消…');dom.cancelOfflineBtn.disabled=true;});
    return {refreshSelection};
}
