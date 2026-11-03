#!/usr/bin/env python3
"""Offline WaveNet text planning and integrity checks. No cloud client or credentials."""
import argparse
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re
import sys


def digest(data):
    return hashlib.sha256(data).hexdigest()


def split_text(text, max_bytes):
    """Preserve every codepoint; prefer a sentence/line end that fits the byte limit."""
    if not 1 <= max_bytes <= 5000:
        raise ValueError('max-bytes must be between 1 and 5000')
    parts = []
    start = 0
    while start < len(text):
        end, used, boundary = start, 0, None
        while end < len(text):
            size = len(text[end].encode('utf-8'))
            if used + size > max_bytes:
                break
            used += size
            if text[end] in '。！？!?；;\n':
                boundary = end + 1
            end += 1
        if end == start:
            raise ValueError('A Unicode character exceeds max-bytes')
        cut = boundary if end < len(text) and boundary is not None else end
        parts.append(text[start:cut])
        start = cut
    return parts


def load_text(path):
    if path.suffix.lower() != '.txt':
        raise ValueError('Input must be a prepared UTF-8 .txt file')
    text = path.read_bytes().decode('utf-8')
    if not text.strip() or text.startswith('\ufeff') or '\x00' in text:
        raise ValueError('Input must be nonempty UTF-8 text without a BOM or NUL')
    return text


def save_json(path, value):
    with path.open('x', encoding='utf-8') as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def make_plan(args):
    manifest = args.manifest.resolve()
    rows = json.loads(manifest.read_text(encoding='utf-8'))
    if not isinstance(rows, list) or not rows:
        raise ValueError('Manifest must be a nonempty ordered array')
    if not re.fullmatch(r'[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)+-Wavenet-[A-Za-z0-9]+', args.voice):
        raise ValueError('An exact WaveNet voice identifier is required')
    if args.max_characters <= 0 or not 0.25 <= args.rate <= 4:
        raise ValueError('A positive character ceiling and rate between 0.25 and 4 are required')
    if any(not value.strip() for value in [args.account, args.configuration, args.project, args.language]):
        raise ValueError('Explicit account, configuration, project, and language are required')
    seen, chapters, payloads = set(), [], []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', row['id']):
            raise ValueError('Each chapter needs a safe, unique id')
        if row['id'] in seen:
            raise ValueError('Duplicate chapter id')
        seen.add(row['id'])
        if not isinstance(row.get('title'), str) or not row['title'].strip() or not isinstance(row.get('text_path'), str):
            raise ValueError('Each chapter needs a title and text_path')
        source = (manifest.parent / row['text_path']).resolve()
        text = load_text(source)
        segments = []
        for index, part in enumerate(split_text(text, args.max_bytes)):
            relative = f"chunks/{row['id']}/{index:04}.txt"
            data = part.encode('utf-8')
            segments.append({'index': index, 'path': relative, 'characters': len(part),
                             'utf8_bytes': len(data), 'sha256': digest(data)})
            payloads.append((relative, data))
        chapters.append({'id': row['id'], 'title': row['title'], 'order': len(chapters),
                         'source_path': str(source), 'characters': len(text),
                         'text_sha256': digest(text.encode('utf-8')), 'segments': segments})
    total = sum(row['characters'] for row in chapters)
    if total > args.max_characters:
        raise ValueError('Source text exceeds the original character ceiling; no job written')
    pricing = None
    if args.price_per_million_usd is not None:
        try:
            price = Decimal(args.price_per_million_usd)
        except InvalidOperation as error:
            raise ValueError('Price must be a nonnegative decimal') from error
        if not price.is_finite() or price < 0:
            raise ValueError('Price must be a nonnegative finite decimal')
        pricing = {'usd_per_million_characters': str(price),
                   'estimate_before_free_allowance_usd': str(Decimal(total) * price / Decimal(1_000_000)),
                   'account_allowance_checked': False}
    plan = {'version': 1, 'created_at': datetime.now(timezone.utc).isoformat(),
            'context': {'account': args.account, 'configuration': args.configuration,
                        'project': args.project, 'billing_project': args.billing_project or args.project},
            'voice': {'name': args.voice, 'language_code': args.language, 'speaking_rate': args.rate},
            'voice_api_verified': False, 'audio_config': {'audioEncoding': 'LINEAR16'},
            'maximum_characters': args.max_characters, 'maximum_segment_bytes': args.max_bytes,
            'total_characters': total, 'total_segments': len(payloads), 'pricing': pricing,
            'chapters': chapters, 'new_api_calls': 0}
    # Validate everything before creating the output. An existing job is never reset.
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.mkdir(mode=0o700)
    for relative, data in payloads:
        path = args.out / relative
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with path.open('xb') as stream:
            os.chmod(path, 0o600)
            stream.write(data)
    save_json(args.out / 'plan.json', plan)
    with (args.out / 'plan.sha256').open('x', encoding='ascii') as stream:
        os.chmod(args.out / 'plan.sha256', 0o600)
        stream.write(digest((args.out / 'plan.json').read_bytes()) + '\n')
    return {'status': 'prepared_offline', 'chapters': len(chapters), 'segments': len(payloads),
            'characters': total, 'maximum_characters': args.max_characters, 'new_api_calls': 0}


def check_plan(job):
    root = job.resolve()
    data = (root / 'plan.json').read_bytes()
    if digest(data) != (root / 'plan.sha256').read_text(encoding='ascii').strip():
        raise ValueError('Pinned plan changed; do not reset a running job')
    plan = json.loads(data.decode('utf-8'))
    if plan['version'] != 1 or plan['total_characters'] > plan['maximum_characters']:
        raise ValueError('Invalid plan version or character ceiling')
    ids, characters, segments = set(), 0, 0
    for order, row in enumerate(plan['chapters']):
        if row['id'] in ids or row['order'] != order:
            raise ValueError('Chapter identity or order changed')
        ids.add(row['id'])
        parts = []
        for index, part in enumerate(row['segments']):
            path = (root / part['path']).resolve()
            if Path(part['path']).is_absolute() or not path.is_relative_to(root):
                raise ValueError('Chunk path escapes the private job directory')
            data = path.read_bytes()
            text = data.decode('utf-8')
            if part['index'] != index or digest(data) != part['sha256'] or len(data) != part['utf8_bytes'] or len(text) != part['characters']:
                raise ValueError('Segment order, content, or counts changed')
            if not 0 < len(data) <= plan['maximum_segment_bytes'] <= 5000:
                raise ValueError('Invalid segment byte size')
            parts.append(text)
        text = ''.join(parts)
        if len(text) != row['characters'] or digest(text.encode('utf-8')) != row['text_sha256']:
            raise ValueError('Chapter coverage or source hash changed')
        if load_text(Path(row['source_path'])) != text:
            raise ValueError('Original prepared source text changed')
        characters += len(text)
        segments += len(parts)
    if not ids or characters != plan['total_characters'] or segments != plan['total_segments']:
        raise ValueError('Batch coverage changed')
    return {'status': 'integrity_passed', 'chapters': len(ids), 'characters': characters,
            'segments': segments, 'voice_api_verified': plan['voice_api_verified'], 'new_api_calls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare = commands.add_parser('prepare', help='Plan prepared .txt files; no cloud calls')
    prepare.add_argument('--manifest', type=Path, required=True)
    prepare.add_argument('--out', type=Path, required=True)
    prepare.add_argument('--voice', required=True)
    prepare.add_argument('--language', required=True)
    prepare.add_argument('--account', required=True)
    prepare.add_argument('--configuration', required=True)
    prepare.add_argument('--project', required=True)
    prepare.add_argument('--billing-project')
    prepare.add_argument('--max-characters', type=int, required=True)
    prepare.add_argument('--max-bytes', type=int, default=4500)
    prepare.add_argument('--rate', type=float, default=1.0)
    prepare.add_argument('--price-per-million-usd')
    check = commands.add_parser('check', help='Verify a pinned local plan and prepared sources')
    check.add_argument('--job', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = make_plan(args) if args.command == 'prepare' else check_plan(args.job)
        print(json.dumps(result, ensure_ascii=False))
    except (ValueError, OSError, KeyError, TypeError) as error:
        # Text and cloud credentials are deliberately absent from error output.
        detail = str(error) if type(error) is ValueError else type(error).__name__
        print(f'Planning/integrity check failed: {detail}', file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
