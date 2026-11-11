# -*- coding: utf-8 -*-
"""Generate reviewable Mandarin reading candidates with Ark seed-tts-2.0."""
import argparse
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional'
RESOURCE_ID = 'seed-tts-2.0'
DEFAULT_INPUT = ROOT / 'docs/拼音音节合成列表.json'
DEFAULT_OUTPUT = ROOT / 'tts/ark'


def positive_int(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError('must be at least 1')
    return number


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument('--input', type=Path, default=DEFAULT_INPUT, help='reading catalog JSON')
    parser.add_argument('--output-dir', type=Path, default=DEFAULT_OUTPUT, help='audio output directory')
    parser.add_argument('--reading', action='append', help='reading to generate; repeat to select several')
    parser.add_argument('--start', type=positive_int, default=1, help='one-based catalog start position')
    parser.add_argument('--limit', type=positive_int, default=10, help='maximum number of catalog entries')
    parser.add_argument('--all', action='store_true', help='generate the entire catalog')
    parser.add_argument('--text', action='append', default=[], metavar='READING=TEXT',
                        help='override synthesis text for a selected reading; repeat as needed')
    parser.add_argument('--speaker', default='zh_female_vv_uranus_bigtts')
    parser.add_argument('--speech-rate', type=int, default=-10, choices=range(-50, 101), metavar='-50..100')
    parser.add_argument('--sample-rate', type=int, default=24000,
                        choices=[8000, 16000, 22050, 24000, 32000, 44100, 48000])
    parser.add_argument('--timeout', type=positive_int, default=120, help='request timeout in seconds')
    parser.add_argument('--normalize', type=float, nargs='?', const=-16.0, default=None, metavar='LUFS',
                        help='normalize with ffmpeg loudnorm (default target: -16 LUFS)')
    parser.add_argument('--overwrite', action='store_true', help='replace existing target files')
    parser.add_argument('--dry-run', action='store_true', help='print planned requests without credentials or network access')
    args = parser.parse_args(argv)
    if args.reading and (args.all or args.start != 1 or args.limit != 10):
        parser.error('--reading cannot be combined with --all, --start, or --limit')
    if args.all and (args.start != 1 or args.limit != 10):
        parser.error('--all cannot be combined with --start or --limit')
    if args.normalize is not None and not -40 <= args.normalize <= -5:
        parser.error('--normalize LUFS must be between -40 and -5')
    return args


def load_catalog(path):
    return parse_catalog(json.loads(path.read_text(encoding='utf-8')))


def parse_catalog(entries):
    if not isinstance(entries, list) or not entries:
        raise ValueError('Input must be a non-empty JSON array')
    readings = set()
    for index, entry in enumerate(entries, 1):
        reading = unicodedata.normalize('NFC', entry.get('reading', ''))
        characters = entry.get('characters')
        if not reading or reading in readings:
            raise ValueError(f'Invalid or duplicate reading at entry {index}')
        if not isinstance(characters, list) or not characters or not all(isinstance(char, str) and char for char in characters):
            raise ValueError(f'Missing example characters for {reading}')
        entry['reading'] = reading
        entry['sourceIndex'] = index
        readings.add(reading)
    return entries


def parse_text_overrides(values):
    overrides = {}
    for value in values:
        reading, separator, text = value.partition('=')
        reading = unicodedata.normalize('NFC', reading)
        if not separator or not reading or not text:
            raise ValueError(f'Invalid --text override: expected READING=TEXT')
        if reading in overrides:
            raise ValueError(f'Duplicate --text override for {reading}')
        overrides[reading] = text
    return overrides


def select_samples(entries, args):
    by_reading = {entry['reading']: entry for entry in entries}
    if args.reading:
        requested = [unicodedata.normalize('NFC', reading) for reading in args.reading]
        if len(set(requested)) != len(requested):
            raise ValueError('Duplicate --reading selection')
        missing = [reading for reading in requested if reading not in by_reading]
        if missing:
            raise ValueError('Unknown readings: ' + ', '.join(missing))
        selected = [by_reading[reading] for reading in requested]
    elif args.all:
        selected = entries
    else:
        selected = entries[args.start - 1:args.start - 1 + args.limit]
        if not selected:
            raise ValueError('The selected catalog range is empty')
    overrides = parse_text_overrides(args.text)
    selected_readings = {entry['reading'] for entry in selected}
    unused = [reading for reading in overrides if reading not in selected_readings]
    if unused:
        raise ValueError('--text overrides are not selected: ' + ', '.join(unused))
    return [
        {
            'reading': entry['reading'],
            'text': overrides.get(entry['reading'], entry['characters'][0]),
            'target': args.output_dir / f"{entry['sourceIndex']:02d}_{entry['reading']}.mp3",
        }
        for entry in selected
    ]


def load_api_key():
    if os.environ.get('ARK_API_KEY'):
        return os.environ['ARK_API_KEY']
    env_file = ROOT / '.env'
    if env_file.is_file():
        # Application configuration loading only; never print or return file contents.
        for raw_line in env_file.read_text(encoding='utf-8').splitlines():
            line = raw_line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            if key.strip().removeprefix('export ') == 'ARK_API_KEY':
                api_key = value.strip().strip('"').strip("'")
                if api_key:
                    return api_key
    raise ValueError('Set ARK_API_KEY in the environment or the project .env file')


def synthesize(sample, args, api_key, opener=urllib.request.urlopen):
    payload = json.dumps({
        'req_params': {
            'text': sample['text'],
            'speaker': args.speaker,
            'audio_params': {
                'format': 'mp3',
                'sample_rate': args.sample_rate,
                'speech_rate': args.speech_rate,
            },
        },
    }, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(ENDPOINT, data=payload, method='POST', headers={
        'X-Api-Key': api_key,
        'X-Api-Resource-Id': RESOURCE_ID,
        'Content-Type': 'application/json',
        'Connection': 'keep-alive',
        'X-Control-Require-Usage-Tokens-Return': '*',
    })
    chunks = []
    terminal = False
    with opener(request, timeout=args.timeout) as response:
        for raw_line in response:
            if not raw_line.strip():
                continue
            event = json.loads(raw_line)
            code = event.get('code')
            if code == 0 and event.get('data'):
                chunks.append(base64.b64decode(event['data'], validate=True))
            elif code == 20000000:
                terminal = True
                break
            elif isinstance(code, int) and code > 0:
                raise RuntimeError(f"TTS error {code}: {event.get('message', 'unknown error')}")
            else:
                raise RuntimeError('Unrecognized TTS response event')
    audio = b''.join(chunks)
    if not terminal or not audio:
        raise RuntimeError('Incomplete or empty audio')
    return audio


def normalize_audio(audio, target_lufs, sample_rate):
    with tempfile.TemporaryDirectory(prefix='bishun-ark-audio-') as temporary:
        source = Path(temporary) / 'source.mp3'
        normalized = Path(temporary) / 'normalized.mp3'
        source.write_bytes(audio)
        result = subprocess.run([
            'ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(source),
            '-af', f'loudnorm=I={target_lufs}:TP=-1.5:LRA=11',
            '-codec:a', 'libmp3lame', '-b:a', '64k', '-ar', str(sample_rate), '-ac', '1',
            str(normalized),
        ], capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError('ffmpeg loudnorm failed: ' + result.stderr.decode('utf-8', errors='replace').strip())
        data = normalized.read_bytes()
        if not data:
            raise RuntimeError('ffmpeg loudnorm returned empty audio')
        return data


def save_audio(target, audio, overwrite):
    if target.exists() and not overwrite:
        raise FileExistsError(f'Target already exists: {target}')
    temporary = target.with_name(f'.{target.name}.{os.getpid()}.tmp')
    try:
        temporary.write_bytes(audio)
        if target.exists() and not overwrite:
            raise FileExistsError(f'Target appeared during generation: {target}')
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def main(argv=None):
    args = parse_args(argv)
    api_key = None
    try:
        samples = select_samples(load_catalog(args.input), args)
        if args.dry_run:
            print(json.dumps({
                'endpoint': ENDPOINT,
                'resourceId': RESOURCE_ID,
                'speaker': args.speaker,
                'audioParams': {
                    'format': 'mp3',
                    'sampleRate': args.sample_rate,
                    'speechRate': args.speech_rate,
                    'normalizeLufs': args.normalize,
                },
                'samples': [
                    {'reading': sample['reading'], 'text': sample['text'], 'target': str(sample['target'])}
                    for sample in samples
                ],
            }, ensure_ascii=False, indent=2))
            return 0
        existing = [str(sample['target']) for sample in samples if sample['target'].exists()]
        if existing and not args.overwrite:
            raise FileExistsError('Refusing to overwrite existing files: ' + ', '.join(existing))
        if args.normalize is not None and not shutil.which('ffmpeg'):
            raise RuntimeError('--normalize requires ffmpeg on PATH')
        args.output_dir.mkdir(parents=True, exist_ok=True)
        api_key = load_api_key()
        for sample in samples:
            audio = synthesize(sample, args, api_key)
            if args.normalize is not None:
                audio = normalize_audio(audio, args.normalize, args.sample_rate)
            save_audio(sample['target'], audio, args.overwrite)
            print(json.dumps({
                'reading': sample['reading'],
                'text': sample['text'],
                'path': str(sample['target']),
                'bytes': len(audio),
            }, ensure_ascii=False), flush=True)
        print(f'Generated {len(samples)} candidate recordings; listening review is still required.')
        return 0
    except KeyboardInterrupt:
        print('Interrupted; no further requests will be made.', file=sys.stderr)
        return 130
    except Exception as error:
        message = str(error)
        if api_key:
            message = message.replace(api_key, '***')
        print(f'error: {message}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
