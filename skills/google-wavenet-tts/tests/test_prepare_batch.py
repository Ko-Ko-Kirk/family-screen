"""Offline behavioral tests with original text; no cloud clients or source books."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/prepare_batch.py'
spec = importlib.util.spec_from_file_location('wavenet_prepare', SCRIPT)
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)


class PlanTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / 'source.txt'
        self.text = '這是原創示範。\r\n保留所有文字與空白 😀。'
        self.source.write_bytes(self.text.encode())
        self.rows = [dict(id='chapter-002', title='第一集', text_path='source.txt'),
                     dict(id='chapter-001', title='第二集', text_path='source.txt')]
        self.manifest = self.root / 'input.json'
        self.write_rows()
        self.args = argparse.Namespace(manifest=self.manifest, out=self.root / 'job',
            voice='cmn-TW-Wavenet-B', language='cmn-TW', max_characters=500,
            max_bytes=24, rate=1.0, account='narrator@example.net', configuration='narration',
            project='narration-project', billing_project=None, price_per_million_usd='4')

    def write_rows(self):
        self.manifest.write_text(json.dumps(self.rows), encoding='utf-8')

    def plan(self):
        return planner.make_plan(self.args)

    def read_plan(self):
        return json.loads((self.args.out / 'plan.json').read_text())

    def test_utf8_exact_coverage_and_byte_limits(self):
        text = ('正體中文。English e\u0301 😀\r\n' * 400) + '尾句'
        parts = planner.split_text(text, 4500)
        self.assertEqual(''.join(parts), text)
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(0 < len(part.encode()) <= 4500 for part in parts))
        for text, limit in [('😀', 3), ('text', 0), ('text', 5001)]:
            with self.assertRaises(ValueError): planner.split_text(text, limit)

    def test_plan_order_counts_modes_and_integrity(self):
        result = self.plan()
        plan = self.read_plan()
        self.assertEqual([c['id'] for c in plan['chapters']], ['chapter-002', 'chapter-001'])
        self.assertEqual(plan['total_characters'], len(self.text) * 2)
        self.assertEqual(result['new_api_calls'], 0)
        self.assertFalse(plan['voice_api_verified'])
        self.assertFalse(plan['pricing']['account_allowance_checked'])
        self.assertEqual(planner.check_plan(self.args.out)['status'], 'integrity_passed')
        if os.name == 'posix':
            self.assertEqual(self.args.out.stat().st_mode & 0o777, 0o700)
            self.assertEqual((self.args.out / 'plan.json').stat().st_mode & 0o777, 0o600)

    def test_ceiling_and_existing_ledger_are_preserved(self):
        self.args.max_characters = 1
        with self.assertRaises(ValueError): self.plan()
        self.assertFalse(self.args.out.exists())
        self.args.max_characters = 500
        self.plan()
        ledger = self.args.out / 'request-ledger.json'
        ledger.write_text('{"reserved_characters":123}')
        old = (self.args.out / 'plan.json').read_bytes()
        with self.assertRaises(FileExistsError): self.plan()
        self.assertEqual((self.args.out / 'plan.json').read_bytes(), old)
        self.assertEqual(ledger.read_text(), '{"reserved_characters":123}')

    def test_duplicate_and_path_like_ids_stop_before_writes(self):
        for bad in ['chapter-002', '../escape']:
            self.rows[1]['id'] = bad
            self.write_rows()
            with self.assertRaises(ValueError): self.plan()
            self.assertFalse(self.args.out.exists())

    def test_no_document_extraction_or_invalid_text(self):
        self.rows[0]['text_path'] = 'book.epub'
        self.write_rows()
        with self.assertRaises(ValueError): self.plan()
        self.rows[0]['text_path'] = 'source.txt'
        self.write_rows()
        for data in [b'  \n', b'\x00', b'\xff', '\ufeff正文'.encode()]:
            self.source.write_bytes(data)
            with self.assertRaises((ValueError, UnicodeError)): self.plan()
            self.assertFalse(self.args.out.exists())

    def test_voice_family_and_nonfinite_prices_rejected(self):
        self.args.voice = 'cmn-TW-Standard-B'
        with self.assertRaises(ValueError): self.plan()
        self.args.voice = 'cmn-TW-Wavenet-B'
        for price in ['NaN', 'Infinity', '-1']:
            self.args.price_per_million_usd = price
            with self.assertRaises(ValueError): self.plan()
            self.assertFalse(self.args.out.exists())

    def test_source_chunk_and_budget_mutations_detected(self):
        self.plan()
        self.source.write_text('changed')
        with self.assertRaises(ValueError): planner.check_plan(self.args.out)
        self.source.write_bytes(self.text.encode())
        part = self.args.out / self.read_plan()['chapters'][0]['segments'][0]['path']
        part.write_text('changed')
        with self.assertRaises(ValueError): planner.check_plan(self.args.out)
        plan = self.read_plan()
        plan['maximum_characters'] *= 10
        (self.args.out / 'plan.json').write_text(json.dumps(plan))
        with self.assertRaisesRegex(ValueError, 'Pinned plan'): planner.check_plan(self.args.out)

    def test_rehashed_path_escape_is_still_rejected(self):
        self.plan()
        plan = self.read_plan()
        plan['chapters'][0]['segments'][0]['path'] = '../source.txt'
        path = self.args.out / 'plan.json'
        path.write_text(json.dumps(plan))
        (self.args.out / 'plan.sha256').write_text(planner.digest(path.read_bytes()))
        with self.assertRaisesRegex(ValueError, 'escapes'): planner.check_plan(self.args.out)

    def test_cli_round_trip_without_text_or_network_output(self):
        command = [sys.executable, str(SCRIPT), 'prepare', '--manifest', str(self.manifest),
            '--out', str(self.args.out), '--voice', self.args.voice, '--language', self.args.language,
            '--account', self.args.account, '--configuration', self.args.configuration,
            '--project', self.args.project, '--max-characters', '500']
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['new_api_calls'], 0)
        self.assertNotIn('原創示範', result.stdout)
        check = subprocess.run([sys.executable, str(SCRIPT), 'check', '--job', str(self.args.out)], capture_output=True, text=True)
        self.assertEqual(check.returncode, 0, check.stderr)
        self.assertEqual(json.loads(check.stdout)['status'], 'integrity_passed')


if __name__ == '__main__':
    unittest.main()
