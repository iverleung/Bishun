# -*- coding: utf-8 -*-
"""Prepare explicitly planned recordings; never invoked by a normal build."""
import argparse
import asyncio
from importlib.metadata import version
import concurrent.futures
import hashlib
import html
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAN = json.loads((ROOT / 'resources/reading-audio-plan.json').read_text(encoding='utf-8'))
CATALOG = ROOT / 'resources/reading-audio-catalog.json'
PREVIOUS = json.loads(CATALOG.read_text(encoding='utf-8'))
COMMIT = PLAN['sourceCommit']
if COMMIT != PREVIOUS['source']['commit']:
    raise ValueError('A new upstream revision requires source/license review first')
TARGET = ROOT / 'public/audio/readings/v1'
TARGET.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--batch', choices=[batch['id'] for batch in PLAN['batches']])
parser.add_argument('--reading', choices=[reading for batch in PLAN['batches'] for reading in batch['items']])
args = parser.parse_args()
previous = {item['reading']: item for item in PREVIOUS['items']}


def prepare_synthesized(batch, reading, token):
    synthesis = PLAN['synthesized'][reading]
    old = previous.get(reading, {})
    old_file = TARGET / (old.get('id', '') + '.mp3')
    temporary = TARGET / ('synthesis-' + hashlib.sha256(reading.encode()).hexdigest()[:12] + '.mp3.tmp')
    reuse = old.get('synthesis') == synthesis and old_file.is_file() and hashlib.sha256(old_file.read_bytes()).hexdigest() == old.get('sha256')
    try:
        if not reuse:
            import edge_tts
            if 'edge-tts ' + version('edge-tts') != synthesis['generator']:
                raise ValueError('Install the pinned tools/audio-requirements.txt first')
            asyncio.run(edge_tts.Communicate(synthesis['text'], synthesis['voice'], rate=synthesis['rate']).save(str(temporary)))
        candidate = old_file if reuse else temporary
        duration = round(float(json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(candidate)], check=True, capture_output=True, text=True).stdout)['format']['duration']) * 1000)
        if not 100 <= duration <= 5000:
            raise ValueError('Invalid synthesized recording duration')
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(candidate), '-f', 'null', '-'], check=True, capture_output=True)
        data = candidate.read_bytes()
        checksum = hashlib.sha256(data).hexdigest()
        # Changed audio gets a new URL: browser force-cache and old offline packs must not substitute the rejected file.
        recording_id = 'reading-' + hashlib.sha256((reading + ':' + checksum).encode()).hexdigest()[:12]
        if not reuse:
            temporary.replace(TARGET / (recording_id + '.mp3'))
        reviewed = reuse and old.get('reviewStatus') == 'reviewed'
        print(f'{reading}: synthesized {synthesis["text"]}, {duration}ms; {"review retained" if reviewed else "pending listening"}', flush=True)
        return {'reading':reading, 'token':token, 'id':recording_id, 'url':f'/audio/readings/v1/{recording_id}.mp3', 'durationMs':duration, 'bytes':len(data), 'sha256':checksum, 'synthesis':synthesis, 'originalTitle':synthesis['text'] + ' ' + reading + '（预生成）', 'reviewStatus':'reviewed' if reviewed else 'pending-listening', 'batch':batch}
    finally:
        temporary.unlink(missing_ok=True)


def prepare(selection):
    batch, reading, token = selection
    if reading in PLAN.get('synthesized', {}):
        return prepare_synthesized(batch, reading, token)
    upstream = f'https://raw.githubusercontent.com/hugolpz/audio-cmn/{COMMIT}/64k/syllabs/cmn-{token}.mp3'
    recording_id = 'reading-' + hashlib.sha256(reading.encode('utf-8')).hexdigest()[:12]
    destination = TARGET / (recording_id + '.mp3')
    temporary = destination.with_suffix('.mp3.tmp')
    old = previous.get(reading, {})
    reuse = destination.exists() and old.get('upstream') == upstream and hashlib.sha256(destination.read_bytes()).hexdigest() == old.get('sha256')
    try:
        if not reuse:
            subprocess.run(['curl', '--fail', '--silent', '--show-error', '--max-time', '30', '--retry', '1', upstream, '-o', str(temporary)], check=True)
        candidate = destination if reuse else temporary
        metadata = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:format_tags', '-of', 'json', str(candidate)], check=True, capture_output=True, text=True).stdout)['format']
        tags = metadata.get('tags', {})
        if tags.get('SWAC_TEXT') != token or tags.get('SWAC_LANG') != 'cmn' or tags.get('SWAC_COLL_LICENSE') != 'CC-BY-SA-3.0' or tags.get('SWAC_SPEAK_NAME') != 'Chen Wang 王琛':
            raise ValueError(f'Unverified reading, speaker or license: {reading}')
        duration = round(float(metadata['duration']) * 1000)
        if not 100 <= duration <= 5000:
            raise ValueError(f'Invalid duration: {reading}')
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(candidate), '-f', 'null', '-'], check=True, capture_output=True)
        data = candidate.read_bytes()
        checksum = hashlib.sha256(data).hexdigest()
        # Approval belongs to the exact previously heard file, never to a new label.
        reviewed = old.get('reviewStatus') == 'reviewed' and old.get('sha256') == checksum and old.get('token') == token and old.get('upstream') == upstream
        if not reuse:
            temporary.replace(destination)
        print(f'{reading}: {duration}ms, {len(data)} bytes, source/license tags match', flush=True)
        return {'reading': reading, 'token': token, 'id': recording_id, 'url': f'/audio/readings/v1/{recording_id}.mp3', 'durationMs': duration, 'bytes': len(data), 'sha256': checksum, 'upstream': upstream, 'originalTitle': tags.get('title', token), 'reviewStatus': 'reviewed' if reviewed else 'pending-listening', 'batch': batch}
    finally:
        temporary.unlink(missing_ok=True)


selections = [(batch['id'], reading, token) for batch in PLAN['batches'] if not args.batch or batch['id'] == args.batch for reading, token in batch['items'].items() if not args.reading or reading == args.reading]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    prepared = {item['reading']: item for item in executor.map(prepare, selections)}
items = []
for batch in PLAN['batches']:
    for reading in batch['items']:
        item = prepared.get(reading, previous.get(reading))
        if item:
            items.append({**item, 'batch': batch['id']})
manifest = {'schemaVersion': 1, 'version': 'v1', 'source': PREVIOUS['source'], 'items': items}
if 'listeningReview' in PREVIOUS:
    review = dict(PREVIOUS['listeningReview'])
    # Backfill scope for the already approved initial batch; new files stay pending.
    review.setdefault('items', {item['id']: item['sha256'] for item in PREVIOUS['items'] if item['reviewStatus'] == 'reviewed'})
    manifest['listeningReview'] = review
text = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
CATALOG.write_text(text, encoding='utf-8')
(TARGET / 'manifest.json').write_text(text, encoding='utf-8')
reviewed_count = sum(item['reviewStatus'] == 'reviewed' for item in items)
def source_row(item):
    title = html.escape(item['originalTitle'])
    source = f'<a href="{html.escape(item["upstream"])}">{title}</a>' if 'upstream' in item else title + '，' + html.escape(json.dumps(item['synthesis'], ensure_ascii=False))
    return f'<li>{html.escape(item["reading"])} — {source}（{"试听通过" if item["reviewStatus"] == "reviewed" else "待试听"}）</li>'

rows = ''.join(source_row(item) for item in items)
synthesized_names = '、'.join(html.escape(item['synthesis']['text'] + ' ' + item['reading']) for item in items if item.get('synthesis'))
(TARGET / 'SOURCE.html').write_text(f'''<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>读音来源与许可</title><body><h1>读音来源与许可</h1><p>普通话音节录音共 {len(items)} 段，{reviewed_count} 段已经用户试听确认，{len(items)-reviewed_count} 段待试听；不代表全部汉字的教学审定。</p><p>例外：{synthesized_names} 由 edge-tts 7.3.1 以 zh-CN-XiaoxiaoNeural、-10% 预生成；不属于下述真人录音，不套用其作者或 CC 许可；各文件试听状态见清单。其余真人音节的发音人：Chen Wang 王琛。作者：Wang Chen 王琛、Hugo Lopez、Nicolas Vion。Copyright 2013 Wang Chen, Lopez Hugo, Vion Nicolas。</p><p>真人录音来自 <a href="https://github.com/hugolpz/audio-cmn/tree/{COMMIT}/64k/syllabs">audio-cmn（固定版本）</a>，按 <a href="https://creativecommons.org/licenses/by-sa/3.0/">Creative Commons Attribution-ShareAlike 3.0 Unported</a> 提供。署名并保留许可；改编录音须按相同许可共享。未修改上游音频字节或内嵌元数据，仅重命名本地文件。无作者为本产品背书之意。</p><ul>{rows}</ul><p>各文件的哈希、时长和原始地址见 <a href="manifest.json">资源清单</a>。这些录音的许可与项目其他代码或资源分别说明。</p></body></html>''', encoding='utf-8')
print(f'Prepared {len(prepared)} selected recordings; total {len(items)}, pending listening {len(items)-reviewed_count}.')
