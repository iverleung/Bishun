"""Generate versioned audio at content-preparation time, never in the website runtime."""
import argparse
import asyncio
import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from importlib.metadata import version as package_version

import edge_tts

root = Path(__file__).resolve().parent.parent


def inspect_audio(file):
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(file), '-f', 'null', '-'], check=True, capture_output=True, timeout=20)
    info = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(file)], check=True, capture_output=True, text=True, timeout=20).stdout)
    duration = float(info['format']['duration'])
    if not math.isfinite(duration) or not 0.1 <= duration <= 10:
        raise ValueError(f'Invalid audio duration: {file.name}')
    return round(duration * 1000)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--voice', default='zh-CN-XiaoxiaoNeural')
    parser.add_argument('--rate', default='-10%')
    args = parser.parse_args()
    if package_version('edge-tts') != '7.3.1':
        raise SystemExit('Install the pinned tools/audio-requirements.txt before generating audio')
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise SystemExit('ffmpeg and ffprobe are required for audio preparation')
    catalog = json.loads((root / 'resources/stroke-audio-catalog.json').read_text())
    if any(not re.fullmatch(r'stroke-[a-f0-9]{12}', item['id']) or
           not re.fullmatch(r'[\u4e00-\u9fa5]{1,12}', item['text']) for item in catalog['items']):
        raise ValueError('Invalid stroke ID or name in audio catalog')
    version = catalog['version']
    if version != 'v1':
        raise ValueError('Review a new output version before generating replacement audio')
    target = root / 'public/audio/strokes' / version
    target.mkdir(parents=True, exist_ok=True)
    manifest_file = target / 'manifest.json'
    previous = json.loads(manifest_file.read_text()) if manifest_file.exists() else {}
    if previous and (previous.get('voice') != args.voice or previous.get('rate') != args.rate):
        raise ValueError('Use a new version directory when changing voice or rate')
    existing = {item['id']: item for item in previous.get('items', [])}
    semaphore = asyncio.Semaphore(2)

    async def generate(item):
        async with semaphore:
            file = target / (item['id'] + '.mp3')
            old = existing.get(item['id'])
            if old and old['text'] == item['text'] and file.exists() and hashlib.sha256(file.read_bytes()).hexdigest() == old['sha256']:
                inspect_audio(file)
                return old
            with tempfile.TemporaryDirectory(prefix='bishun-audio-') as temporary:
                raw = Path(temporary) / 'raw.mp3'
                final = Path(temporary) / 'final.mp3'
                await asyncio.wait_for(edge_tts.Communicate(item['text'], args.voice, rate=args.rate).save(str(raw)), timeout=30)
                trim = 'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.05,areverse'
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-af', trim, '-codec:a', 'libmp3lame', '-b:a', '48k', '-ar', '24000', '-ac', '1', str(final)], check=True, capture_output=True, timeout=20)
                duration_ms = inspect_audio(final)
                file.write_bytes(final.read_bytes())
            result = {**item, 'url': f'/audio/strokes/{version}/{file.name}', 'durationMs': duration_ms, 'bytes': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'reviewStatus': 'pending-listening'}
            print(f"✅ {item['text']} {duration_ms}ms", flush=True)
            return result

    # Publish the manifest only when every requested recording has succeeded.
    items = await asyncio.gather(*(generate(item) for item in catalog['items']))
    manifest = {'schemaVersion': 1, 'version': version, 'generator': 'edge-tts 7.3.1 + ffmpeg', 'voice': args.voice, 'rate': args.rate, 'items': items}
    temporary_manifest = target / 'manifest.json.tmp'
    temporary_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    temporary_manifest.replace(manifest_file)
    print(f'✅ {len(items)} recordings prepared; listening review is still required', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
