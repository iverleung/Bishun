"""Prepare a lossless listening reel from committed recordings; never mark them reviewed."""
import argparse
import hashlib
import json
import subprocess
import wave
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('output_directory', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
source = root / 'public/audio/strokes/v1'
manifest = json.loads((source / 'manifest.json').read_text())
args.output_directory.mkdir(parents=True, exist_ok=True)
sample_rate = 24000
gap = b'\0' * (int(sample_rate * 0.75) * 2)
position = 0
timeline = []
with wave.open(str(args.output_directory / 'stroke-audio-review.wav'), 'wb') as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(sample_rate)
    for index, item in enumerate(manifest['items'], 1):
        file = source / (item['id'] + '.mp3')
        if file.parent != source or hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('Recording path or checksum mismatch')
        pcm = subprocess.run([
            'ffmpeg', '-v', 'error', '-i', str(file), '-f', 's16le',
            '-ar', str(sample_rate), '-ac', '1', 'pipe:1'
        ], check=True, capture_output=True, timeout=20).stdout
        if not pcm:
            raise ValueError('Empty decoded recording')
        duration = len(pcm) // 2
        timeline.append({
            'index': index, 'text': item['text'], 'id': item['id'],
            'startMs': round(position / sample_rate * 1000),
            'endMs': round((position + duration) / sample_rate * 1000),
            'sourceSha256': item['sha256'], 'reviewStatus': item['reviewStatus']
        })
        output.writeframes(pcm)
        output.writeframes(gap)
        position += duration + len(gap) // 2

(args.output_directory / 'timeline.json').write_text(json.dumps(timeline, ensure_ascii=False, indent=2) + '\n')
lines = ['# 笔画录音试听顺序', '', '原录音解码后顺次拼接，中间留 0.75 秒。未重新合成，未改变原资源审核状态。', '', '| 序号 | 起点（秒） | 笔画名称 |', '|---|---|---|']
lines.extend(f"| {item['index']} | {item['startMs'] / 1000:.2f} | {item['text']} |" for item in timeline)
(args.output_directory / '试听顺序.md').write_text('\n'.join(lines) + '\n')
print(f'{len(timeline)} recordings; {position / sample_rate:.2f}s; review status unchanged')
