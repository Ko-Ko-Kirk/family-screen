---
name: google-wavenet-tts
description: Produce Google Cloud WaveNet speech from prepared UTF-8 text, select voices, estimate usage, and resume narration batches safely. Use for WaveNet samples, audiobooks, and existing WaveNet jobs; document extraction and other TTS providers are outside this skill.
---

# Google WaveNet TTS

Turn user-prepared text into speech with the user's Google Cloud account. Keep the requested language, voice, chapter order, and budget. Start from `.txt` files; do not extract books, query Calibre, or fetch source content as part of this skill.

## Establish the job

- Use the account, configuration, project, billing project, voice preference, and spending limit already authorized in the conversation. Resolve only missing decisions; a prior valid authorization does not need another confirmation.
- Before cloud calls, read applicable cloud instructions and verify any installed CLI guard. Use the approved entry point with explicit account, configuration, project, and billing project. Do not bypass a guard through an underlying executable, another account, SDK, or HTTP. The REST workflow below is usable only when allowed by the host's rules and the user's scope.
- Reuse existing authentication. Do not create keys, enable services, change IAM or organization login policies, or switch global defaults just to get narration running. If one of those changes is actually needed, prepare the batch first and resolve that specific requirement.
- Read [the batch protocol](references/batch-protocol.md) before API execution or recovery. It covers billing evidence, token expiry, receipts, uncertain outcomes, and output verification.

## Choose the voice and cost envelope

Check the current [pricing](https://cloud.google.com/text-to-speech/pricing) and [content limits](https://cloud.google.com/text-to-speech/quotas). WaveNet is a named voice family; do not substitute another family or provider to finish a job.

Use the official `voices.list` response for the requested language. Select an exact `*-Wavenet-*` name and check its `ssmlGender` when the user asked for a male or female voice. For an unfamiliar voice, create a short sample before an expensive batch; reuse an already accepted sample when its text, voice, and settings match.

Distinguish the monthly free billing allowance from requests-per-minute quota. A public free tier is not evidence of the account's remaining allowance. If the user requires free-only generation, verify current official billing usage and account for reporting delay, other jobs, and this job's existing reservations. Keep the evidence private and give it an explicit expiry. Do not promise an immediately final zero-dollar bill.

## Prepare text without changing it

The bundled helper uses Python 3.10+ and the standard library. It makes **no API calls**. Resolve its path relative to this installed skill; these examples assume a repository checkout:

```bash
python3 skills/google-wavenet-tts/scripts/prepare_batch.py prepare \
  --manifest private/narration-input.json --out private/narration-job \
  --voice cmn-TW-Wavenet-B --language cmn-TW \
  --account narrator@example.net --configuration narration \
  --project narration-project --max-characters 20000

python3 skills/google-wavenet-tts/scripts/prepare_batch.py check \
  --job private/narration-job
```

The input is an ordered JSON array of `{ "id": "chapter-001", "title": "第一章", "text_path": "texts/001.txt" }` rows. Paths resolve against the input manifest. The example cloud identity is illustrative; use the user's actual authorized target.

The helper preserves all input characters, splits on UTF-8 byte limits with punctuation preferred, and records hashes, order, voice settings, and a hard character ceiling. It refuses an existing output directory. `--price-per-million-usd` optionally records a rate just verified from Google and an estimate before free allowance; it never reads billing usage. A successful plan is not synthesis or permission to spend more.

## Generate or resume

Use an authorized provider client or a private batch controller following the protocol. The helper above prepares and checks a plan; it does not synthesize audio or provide a cloud execution adapter.

- Pin the plan and voice settings before the first request. Reserve characters durably before submission, including retry reservations, under the original hard ceiling.
- Save each response before local audio validation. Reuse completed audio only after text, settings, and audio hashes match. A short but valid phrase is not grounds to discard and synthesize it again.
- On restart, inspect receipts and the process lock first. Resume only eligible work; do not reset the ledger, repeat successful requests, or retry an unknown response on a guess. Free-only work also needs unexpired allowance evidence.
- Keep text, audio, tokens, billing evidence, and receipts in a private job directory. Do not print authorization headers or put credentials in command arguments. A synthesis request does not authorize changing organization policy, publishing content, or starting a recurring monitor.

## Finish and optionally import

Verify every requested chapter, source hash, audio duration and decode, and its place in the ordered output list. Report actual completed chapters, reserved versus successful characters, and any missing items. Automated decoding is not full human listening.

If captions are requested, use an approved local acoustic alignment workflow; TTS alone does not provide verified word timestamps. Preserve source omissions separately and never invent timing by distributing characters evenly. Do not introduce a paid transcription service without authorization.

When Family Screen import is requested, use its matching repository/CLI and `family-screen-setup` if available. Preserve existing media IDs, chapters, and account progress. Verify anonymous media/caption `401`, signed-in audio Range `206`, and caption content hashes. Generating speech alone does not authorize a deployment or import.
