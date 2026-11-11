# -*- coding: utf-8 -*-
import base64
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ark_reading_audio', ROOT / 'tools/generate-ark-reading-audio.py')
ark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ark)

READINGS = ['ā', 'à', 'a', 'āi', 'ái', 'ǎi', 'ài', 'ān', 'ǎn', 'àn', 'áng', 'áo']


def catalog_entries():
    return [{'reading': reading, 'characters': [char]} for reading, char in zip(
        READINGS, ['阿', '啊', '啊', '哀', '癌', '蔼', '爱', '安', '俺', '暗', '昂', '熬']
    )]


class FakeResponse:
    def __init__(self, events):
        self.lines = [json.dumps(event).encode('utf-8') + b'\n' for event in events]

    def __enter__(self):
        return iter(self.lines)

    def __exit__(self, *args):
        return False


class ArkReadingAudioTests(unittest.TestCase):
    def test_default_selection_is_first_ten_with_stable_names(self):
        args = ark.parse_args(['--output-dir', 'out'])
        samples = ark.select_samples(ark.parse_catalog(catalog_entries()), args)
        self.assertEqual([sample['reading'] for sample in samples], READINGS[:10])
        self.assertEqual(samples[0]['target'], Path('out/01_ā.mp3'))
        self.assertEqual(samples[-1]['target'], Path('out/10_àn.mp3'))

    def test_reading_order_and_text_override_are_explicit(self):
        args = ark.parse_args(['--reading', 'àn', '--reading', 'à', '--text', 'à=啊！'])
        samples = ark.select_samples(ark.parse_catalog(catalog_entries()), args)
        self.assertEqual([(sample['reading'], sample['text']) for sample in samples], [('àn', '暗'), ('à', '啊！')])
        self.assertEqual(samples[0]['target'].name, '10_àn.mp3')

    def test_unselected_text_override_is_rejected(self):
        args = ark.parse_args(['--reading', 'ā', '--text', 'à=啊！'])
        with self.assertRaisesRegex(ValueError, 'not selected'):
            ark.select_samples(ark.parse_catalog(catalog_entries()), args)

    def test_synthesize_decodes_chunks_and_waits_for_terminal_event(self):
        events = [
            {'code': 0, 'data': base64.b64encode(b'first').decode()},
            {'code': 0, 'data': base64.b64encode(b'second').decode()},
            {'code': 20000000},
        ]
        captured = {}

        def opener(request, timeout):
            captured['request'] = request
            captured['timeout'] = timeout
            return FakeResponse(events)

        args = ark.parse_args([])
        audio = ark.synthesize({'reading': 'ā', 'text': '阿'}, args, 'test-secret', opener)
        self.assertEqual(audio, b'firstsecond')
        self.assertEqual(captured['timeout'], 120)
        request = captured['request']
        self.assertEqual(request.full_url, ark.ENDPOINT)
        self.assertEqual(request.get_header('X-api-key'), 'test-secret')
        self.assertEqual(request.get_header('X-api-resource-id'), 'seed-tts-2.0')
        payload = json.loads(request.data)
        self.assertEqual(payload['req_params']['text'], '阿')
        self.assertEqual(payload['req_params']['audio_params']['speech_rate'], -10)

    def test_synthesize_rejects_service_error_and_incomplete_audio(self):
        args = ark.parse_args([])
        with self.assertRaisesRegex(RuntimeError, 'TTS error 400'):
            ark.synthesize({'text': '阿'}, args, 'unused', lambda *args, **kwargs: FakeResponse([
                {'code': 400, 'message': 'bad request'},
            ]))
        with self.assertRaisesRegex(RuntimeError, 'Incomplete'):
            ark.synthesize({'text': '阿'}, args, 'unused', lambda *args, **kwargs: FakeResponse([
                {'code': 0, 'data': base64.b64encode(b'audio').decode()},
            ]))

    def test_dry_run_needs_no_credentials_and_creates_nothing(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'catalog.json'
            source.write_text(json.dumps(catalog_entries(), ensure_ascii=False), encoding='utf-8')
            output = Path(temporary) / 'output'
            stdout = io.StringIO()
            with mock.patch.object(ark, 'load_api_key', side_effect=AssertionError('credential access')), \
                    mock.patch.object(ark, 'synthesize', side_effect=AssertionError('network access')), \
                    contextlib.redirect_stdout(stdout):
                result = ark.main(['--input', str(source), '--output-dir', str(output), '--dry-run'])
            self.assertEqual(result, 0)
            self.assertFalse(output.exists())
            self.assertEqual(len(json.loads(stdout.getvalue())['samples']), 10)

    def test_existing_target_stops_before_credentials_or_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'catalog.json'
            source.write_text(json.dumps(catalog_entries(), ensure_ascii=False), encoding='utf-8')
            output = Path(temporary) / 'output'
            output.mkdir()
            (output / '01_ā.mp3').write_bytes(b'keep')
            with mock.patch.object(ark, 'load_api_key', side_effect=AssertionError('credential access')), \
                    mock.patch.object(ark, 'synthesize', side_effect=AssertionError('network access')), \
                    contextlib.redirect_stderr(io.StringIO()):
                result = ark.main(['--input', str(source), '--output-dir', str(output), '--reading', 'ā'])
            self.assertEqual(result, 1)
            self.assertEqual((output / '01_ā.mp3').read_bytes(), b'keep')


if __name__ == '__main__':
    unittest.main()
