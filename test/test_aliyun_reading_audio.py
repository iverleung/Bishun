# -*- coding: utf-8 -*-
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('aliyun_reading_audio', ROOT / 'tools/generate-aliyun-reading-audio.py')
aliyun = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aliyun)


class AliyunReadingAudioTests(unittest.TestCase):
    def test_tone_marks_become_numeric_pinyin(self):
        self.assertEqual([aliyun.numbered_pinyin(item) for item in ['ā', 'á', 'ǎ', 'à', 'a']],
                         ['a1', 'a2', 'a3', 'a4', 'a5'])
        self.assertEqual(aliyun.numbered_pinyin('lǜ'), 'lü4')
        self.assertEqual(aliyun.numbered_pinyin('ń'), 'n2')
        with self.assertRaisesRegex(ValueError, 'Multiple tone marks'):
            aliyun.numbered_pinyin('túnwǎ')

    def test_dry_run_uses_explicit_ssml_without_credentials_or_sdk(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'catalog.json'
            source.write_text(json.dumps([
                {'reading': reading, 'characters': [char]}
                for reading, char in zip(['ā', 'á', 'ǎ', 'à', 'a'], ['阿', '呵', '呵', '啊', '啊'])
            ], ensure_ascii=False), encoding='utf-8')
            output = Path(temporary) / 'output'
            stdout = io.StringIO()
            with mock.patch.object(aliyun, 'load_credentials', side_effect=AssertionError('credential access')), \
                    mock.patch.object(aliyun, 'synthesize', side_effect=AssertionError('network access')), \
                    contextlib.redirect_stdout(stdout):
                result = aliyun.main(['--input', str(source), '--output-dir', str(output), '--dry-run'])
            self.assertEqual(result, 0)
            self.assertFalse(output.exists())
            samples = json.loads(stdout.getvalue())['samples']
            self.assertEqual([sample['ssml'] for sample in samples], [
                f'<speak><phoneme alphabet="py" ph="a{tone}">{char}</phoneme></speak>'
                for tone, char in enumerate(['阿', '呵', '呵', '啊', '啊'], 1)
            ])

    def test_synthesize_collects_audio_and_always_shuts_down(self):
        instances = []

        class FakeSynthesizer:
            def __init__(self, **kwargs):
                self.kwargs = kwargs
                self.shutdown_called = False
                instances.append(self)

            def start(self, text, **kwargs):
                self.text = text
                self.start_kwargs = kwargs
                self.kwargs['on_data'](b'first')
                self.kwargs['on_data'](b'second')
                self.kwargs['on_completed']('{"name":"SynthesisCompleted"}')

            def shutdown(self):
                self.shutdown_called = True

        fake_nls = types.SimpleNamespace(enableTrace=lambda enabled: None, NlsSpeechSynthesizer=FakeSynthesizer)
        args = aliyun.parse_args([])
        with mock.patch.dict(sys.modules, {'nls': fake_nls}):
            audio = aliyun.synthesize({'ssml': '<speak>test</speak>'}, args, 'token', 'appkey')
        self.assertEqual(audio, b'firstsecond')
        self.assertEqual(instances[0].text, '<speak>test</speak>')
        self.assertEqual(instances[0].start_kwargs['aformat'], 'mp3')
        self.assertTrue(instances[0].shutdown_called)

    def test_synthesize_rejects_service_error_and_incomplete_audio(self):
        class FakeSynthesizer:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            def start(self, text, **kwargs):
                self.kwargs['on_error']('TaskFailed')

            def shutdown(self):
                pass

        fake_nls = types.SimpleNamespace(enableTrace=lambda enabled: None, NlsSpeechSynthesizer=FakeSynthesizer)
        with mock.patch.dict(sys.modules, {'nls': fake_nls}):
            with self.assertRaisesRegex(RuntimeError, 'TaskFailed'):
                aliyun.synthesize({'ssml': '<speak>test</speak>'}, aliyun.parse_args([]), 'token', 'appkey')


if __name__ == '__main__':
    unittest.main()
