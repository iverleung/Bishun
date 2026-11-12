# -*- coding: utf-8 -*-
"""Generate Mandarin reading candidates with explicit Aliyun pinyin SSML."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import unicodedata
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('ark_reading_audio', ROOT / 'tools/generate-ark-reading-audio.py')
ark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ark)

URL = 'wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1'
TONE_MARKS = {'̄': '1', '́': '2', '̌': '3', '̀': '4'}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument('--input', type=Path, default=ark.DEFAULT_INPUT)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'tts/aliyun')
    parser.add_argument('--reading', action='append', help='reading to generate; repeat to select several')
    parser.add_argument('--start', type=ark.positive_int, default=1)
    parser.add_argument('--limit', type=ark.positive_int, default=5)
    parser.add_argument('--voice', default='xiaoyun', help='Aliyun Chinese voice code')
    parser.add_argument('--speech-rate', type=int, default=0, choices=range(-500, 501), metavar='-500..500')
    parser.add_argument('--sample-rate', type=int, default=16000, choices=[8000, 16000, 24000])
    parser.add_argument('--timeout', type=ark.positive_int, default=60)
    parser.add_argument('--overwrite', action='store_true')
    parser.add_argument('--dry-run', action='store_true', help='no credentials, SDK import, directories, or network access')
    args = parser.parse_args(argv)
    if args.reading and (args.start != 1 or args.limit != 5):
        parser.error('--reading cannot be combined with --start or --limit')
    return args


def numbered_pinyin(reading):
    decomposed = unicodedata.normalize('NFD', unicodedata.normalize('NFC', reading))
    tones = [TONE_MARKS[char] for char in decomposed if char in TONE_MARKS]
    if len(tones) > 1:
        raise ValueError(f'Multiple tone marks in reading: {reading}')
    base = unicodedata.normalize('NFC', ''.join(char for char in decomposed if char not in TONE_MARKS))
    if not base or any(char.lower() not in 'abcdefghijklmnopqrstuvwxyzüê' for char in base):
        raise ValueError(f'Unsupported pinyin reading: {reading}')
    return base + (tones[0] if tones else '5')


def select_samples(args):
    args.text = []
    args.all = False  # Shared catalog selector; range selection is handled by --start/--limit.
    samples = ark.select_samples(ark.load_catalog(args.input), args)
    selected = []
    for sample in samples:
        if len(sample['text']) != 1:
            raise ValueError(f'Expected one carrier character for {sample["reading"]}')
        phoneme = numbered_pinyin(sample['reading'])
        ssml = f'<speak><phoneme alphabet="py" ph="{phoneme}">{escape(sample["text"])}</phoneme></speak>'
        selected.append({**sample, 'ssml': ssml})
    return selected


def load_credentials():
    names = ('ALIYUN_ACCESS_TOKEN', 'ALIYUN_NLS_APP_KEY', 'NLS_APP_KEY')
    values = {name: os.environ.get(name) for name in names}
    env_file = ROOT / '.env'
    if env_file.is_file():
        # Application configuration loading only; never print or expose file contents.
        for raw_line in env_file.read_text(encoding='utf-8').splitlines():
            line = raw_line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            key = key.strip().removeprefix('export ')
            if key in names and not values[key]:
                values[key] = value.strip().strip('"').strip("'")
    if not values['ALIYUN_ACCESS_TOKEN']:
        raise ValueError('Missing ALIYUN_ACCESS_TOKEN')
    appkey = values['ALIYUN_NLS_APP_KEY'] or values['NLS_APP_KEY']
    if not appkey:
        raise ValueError('Missing ALIYUN_NLS_APP_KEY (or NLS_APP_KEY)')
    return values['ALIYUN_ACCESS_TOKEN'], appkey


def synthesize(sample, args, token, appkey):
    try:
        import nls
    except ImportError as error:
        raise RuntimeError('Install the official alibabacloud-nls-python-sdk first') from error
    nls.enableTrace(False)
    audio = bytearray()
    completed = []
    errors = []
    synthesizer = nls.NlsSpeechSynthesizer(
        url=URL, token=token, appkey=appkey,
        on_data=lambda data, *callback_args: audio.extend(data),
        on_completed=lambda message, *callback_args: completed.append(message),
        on_error=lambda message, *callback_args: errors.append(message),
    )
    try:
        synthesizer.start(
            sample['ssml'], voice=args.voice, aformat='mp3', sample_rate=args.sample_rate,
            volume=50, speech_rate=args.speech_rate, pitch_rate=0, wait_complete=True,
            start_timeout=min(args.timeout, 10), completed_timeout=args.timeout,
        )
    finally:
        synthesizer.shutdown()
    if errors:
        raise RuntimeError('Aliyun TTS error: ' + str(errors[-1]))
    if not completed or not audio:
        raise RuntimeError('Incomplete or empty Aliyun audio')
    return bytes(audio)


def main(argv=None):
    args = parse_args(argv)
    secrets = ()
    try:
        samples = select_samples(args)
        if args.dry_run:
            print(json.dumps({'url': URL, 'voice': args.voice, 'samples': [
                {'reading': sample['reading'], 'ssml': sample['ssml'], 'target': str(sample['target'])}
                for sample in samples
            ]}, ensure_ascii=False, indent=2))
            return 0
        existing = [str(sample['target']) for sample in samples if sample['target'].exists()]
        if existing and not args.overwrite:
            raise FileExistsError('Refusing to overwrite existing files: ' + ', '.join(existing))
        token, appkey = load_credentials()
        secrets = (token, appkey)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for sample in samples:
            audio = synthesize(sample, args, token, appkey)
            ark.save_audio(sample['target'], audio, args.overwrite)
            print(json.dumps({'reading': sample['reading'], 'ssml': sample['ssml'],
                              'path': str(sample['target']), 'bytes': len(audio)}, ensure_ascii=False), flush=True)
        print(f'Generated {len(samples)} candidate recordings; listening review is still required.')
        return 0
    except KeyboardInterrupt:
        print('Interrupted; no further requests will be made.', file=sys.stderr)
        return 130
    except Exception as error:
        message = str(error)
        for secret in secrets:
            if secret:
                message = message.replace(secret, '***')
        print(f'error: {message}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
