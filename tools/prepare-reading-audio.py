# -*- coding: utf-8 -*-
"""Fetch the explicitly selected pronunciation samples; not a build-time download."""
import concurrent.futures
import hashlib
import html
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMMIT = 'f759a0f18f27690742957619e1248ed91e9b3f2c'
PAIRS = [('mù','mu4'),('shuǐ','shui3'),('xīn','xin1'),('cháng','chang2'),('zhǎng','zhang3'),('xíng','xing2'),('háng','hang2'),('hàng','hang4'),('héng','heng2'),('zhòng','zhong4'),('chóng','chong2'),('lè','le4'),('yuè','yue4')]
TARGET = ROOT / 'public/audio/readings/v1'
TARGET.mkdir(parents=True, exist_ok=True)


def prepare(pair):
    reading, token = pair
    name = 'cmn-' + token + '.mp3'
    upstream = f'https://raw.githubusercontent.com/hugolpz/audio-cmn/{COMMIT}/64k/syllabs/{name}'
    recording_id = 'reading-' + hashlib.sha256(reading.encode()).hexdigest()[:12]
    destination = TARGET / (recording_id + '.mp3')
    temporary = destination.with_suffix('.mp3.tmp')
    subprocess.run(['curl','--fail','--silent','--show-error','--max-time','30',upstream,'-o',str(temporary)],check=True)
    metadata = json.loads(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration:format_tags','-of','json',str(temporary)],check=True,capture_output=True,text=True).stdout)['format']
    tags = metadata.get('tags', {})
    if tags.get('SWAC_TEXT') != token or tags.get('SWAC_LANG') != 'cmn' or tags.get('SWAC_COLL_LICENSE') != 'CC-BY-SA-3.0':
        raise ValueError(f'Unverified reading or license: {reading}: {tags}')
    if tags.get('SWAC_SPEAK_NAME') != 'Chen Wang 王琛':
        raise ValueError(f'Unexpected speaker: {reading}')
    duration = round(float(metadata['duration']) * 1000)
    if not 100 <= duration <= 5000:
        raise ValueError(f'Invalid duration: {reading}')
    subprocess.run(['ffmpeg','-v','error','-i',str(temporary),'-f','null','-'],check=True,capture_output=True)
    data = temporary.read_bytes()
    temporary.replace(destination)
    print(f'{reading}: {duration}ms, {len(data)} bytes, source/license tags match',flush=True)
    return {'reading':reading,'token':token,'id':recording_id,'url':f'/audio/readings/v1/{recording_id}.mp3','durationMs':duration,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'upstream':upstream,'originalTitle':tags.get('title',token),'reviewStatus':'pending-listening'}


with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    items = list(executor.map(prepare, PAIRS))
manifest = {'schemaVersion':1,'version':'v1','source':{'repository':'https://github.com/hugolpz/audio-cmn','commit':COMMIT,'speaker':'Chen Wang 王琛','authors':['Wang Chen 王琛','Hugo Lopez','Nicolas Vion'],'copyright':'Copyright 2013 Wang Chen, Lopez Hugo, Vion Nicolas','license':'CC-BY-SA-3.0','licenseUrl':'https://creativecommons.org/licenses/by-sa/3.0/','modifications':'None. Upstream MP3 bytes and embedded metadata are preserved; local filenames use reading IDs.'},'items':items}
text = json.dumps(manifest,ensure_ascii=False,indent=2)+'\n'
(ROOT / 'resources/reading-audio-catalog.json').write_text(text)
(TARGET / 'manifest.json').write_text(text)
rows=''.join(f'<li>{html.escape(item["reading"])} — <a href="{html.escape(item["upstream"])}">{html.escape(item["originalTitle"])}</a></li>' for item in items)
(TARGET / 'SOURCE.html').write_text(f'''<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>读音来源与许可</title><body><h1>读音来源与许可</h1><p>首批普通话音节样本：待试听审核，不代表全部汉字的教学审定。</p><p>发音人：Chen Wang 王琛。作者：Wang Chen 王琛、Hugo Lopez、Nicolas Vion。Copyright 2013 Wang Chen, Lopez Hugo, Vion Nicolas。</p><p>录音来自 <a href="https://github.com/hugolpz/audio-cmn/tree/{COMMIT}/64k/syllabs">audio-cmn（固定版本）</a>，按 <a href="https://creativecommons.org/licenses/by-sa/3.0/">Creative Commons Attribution-ShareAlike 3.0 Unported</a> 提供。署名并保留许可；改编录音须按相同许可共享。未修改上游音频字节或内嵌元数据，仅重命名本地文件。无作者为本产品背书之意。</p><ul>{rows}</ul><p>各文件的哈希、时长和原始地址见 <a href="manifest.json">资源清单</a>。这些录音的许可与项目其他代码或资源分别说明。</p></body></html>''')
print('Prepared 13 source-checked samples; human listening review remains pending.')
