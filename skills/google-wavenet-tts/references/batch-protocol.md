# WaveNet execution and recovery

Read this before actual synthesis or resuming a private controller. The included planner is offline; choose an execution client that complies with the host's cloud rules. No local plan or receipt is a substitute for the user's authorization.

## Provider facts to refresh

- [Pricing](https://cloud.google.com/text-to-speech/pricing): on 2026-11-03, WaveNet and Standard list the same SKU and a monthly 4-million-character allowance, then US$4 per million characters. Recheck for the actual run. Spaces and newlines count; UTF-8 bytes are not the billing character count.
- [Content limits](https://cloud.google.com/text-to-speech/quotas): the synchronous input limit is currently 5,000 bytes. The planner defaults to 4,500. Split on Unicode character boundaries and keep exact text coverage. Rate quotas are separate from the free billing allowance.
- [Voices](https://cloud.google.com/text-to-speech/docs/reference/rest/v1/voices/list): authorized `GET https://texttospeech.googleapis.com/v1/voices?languageCode=cmn-TW` returns exact names, genders, languages, and natural sample rates. Use the chosen language; do not infer gender from an A/B suffix.
- [Synthesis](https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize): `POST https://texttospeech.googleapis.com/v1/text:synthesize` accepts `input.text`, an exact `voice.name` and `voice.languageCode`, and `audioConfig`. Its JSON response has base64 `audioContent`; LINEAR16 includes a WAV header.

For chapter concatenation, LINEAR16 segments at one sample rate are convenient. Confirm mono PCM format and concatenate decoded frames, not RIFF headers. Encode a chapter to MP3 once with ffmpeg and verify it with ffprobe and a full decode. Keep successful source segments for recovery. Direct MP3 output is also valid for a single clip; do not claim a lossless concatenation of compressed segments.

## Identity, credentials, and allowance

Record the authorized account, configuration, resource project, billing/quota project, exact voice, language, rate, format, input hashes, chapter order, and hard budget. Use explicit target flags for cloud commands and the matching quota project for an approved REST client. Never silently fall back to application-default credentials from another account.

An access token's issue time is not the time a CLI happens to print it. Use trustworthy expiry metadata for that exact credential or an approved credential manager; refresh before expiry without changing identity or scopes. If the CLI requires interactive reauthentication, retain the current job and ask for that login. A request to make speech does not authorize new service accounts, API keys, IAM grants, or session-policy exceptions.

For free-only work, retain official billing evidence for the relevant account/SKU and billing period, with a documented expiry and safety margin. Account for other jobs and reporting delay. When refreshing evidence, do not both count already-reported synthesis in the account usage and subtract the whole same batch again. The per-job reservation ledger remains intact across evidence refreshes. Stop if the proof expires, the billing period changes, or remaining capacity becomes uncertain.

## Durable request state

A private controller should hold a nonblocking job lock for its lifetime and atomically replace JSON files. Reserve against a ledger under that lock before each request. A per-request receipt needs the chapter/segment ID, input and request-settings hashes, character reservation, timestamp, and attempt number. Keep tokens out of receipts and logs.

| State | Meaning | Safe next action |
|---|---|---|
| `planned` | No request was submitted | Submit only within authorization, allowance evidence, and the remaining ceiling |
| `requesting` | Submission began; outcome not yet durable | Inspect evidence; do not assume an interrupted process means no charge |
| `response_received` | Response/audio is stored durably | Reuse saved bytes and finish local validation |
| `completed` | Source/settings/audio hashes and local decode passed | Reuse; do not synthesize again |
| `rejected_http` | A definite HTTP error was saved | Classify it, retain its reservation, and apply a bounded recovery policy |
| `unknown_response` | Timeout, disconnect, malformed response, or uncertain outcome | Stop automatic retries and preserve the evidence |

Store the successful response or audio bytes before checking duration. Flush the file, save its hash, then write `response_received`; perform decoding and duration checks afterward. If a process died between those steps, reconcile the saved files before making another request. Do not discard a nonempty short phrase because it is shorter than an arbitrary duration threshold.

A definite authentication rejection can justify one refresh of the same account and one resubmission, subject to the original ceiling. Preserve both receipts and reservations. Do not turn this into an unlimited 401 loop. For 429, distinguish short-term rate limits from exhausted quota; use bounded backoff only for an established retryable rejection. A 5xx or timeout is not proof that synthesis never ran. Do not retry just because no local audio file exists.

Only evidence that the request was never sent, such as an unambiguous pre-connection DNS failure, can justify recovering an otherwise uncertain attempt without treating it as potentially successful. Bind that one recovery to its original input/settings and receipt hash; retain the original reservation. If those facts cannot be established, stop instead of charging on a guess.

The budget is a submission ceiling, not a provider balance or finalized invoice. Preserve it and distinguish successful character totals, conservative reservations for rejected/unknown attempts, and actual reported billing. Do not raise the ceiling to finish a chapter.

## Local validation and publication

Before accepting a chapter, verify all planned segments once, their exact concatenated text hash, consistent voice/audio settings, decoded sample count, and chapter MP3 duration. Keep the source and assembled audio hash in the chapter receipt. Do not use the number of discovered source files as the number of published chapters.

If local acoustic captions are part of the request, preserve successful segments and use bounded attempts for hard cases. Silence and recognized word boundaries can constrain short local re-alignments. Do not manufacture timestamps, silently delete source words, or claim word accuracy from structural VTT validation alone. Report unresolved chapters separately; they need not block already verified audio when the user permits partial publication.

Publication needs its own lock and receipts. Reuse remote objects only after verifying their content/metadata. A write timeout is not permission to repeat an upload blindly; inspect the object first. Keep chapter IDs and order stable, and do not change existing playback progress. Verify the final requested set, not just a pilot, before announcing completion.

The optional Family Screen workflow is documented in its setup skill and [caption guide](https://github.com/Ko-Ko-Kirk/family-screen/blob/main/docs/captions.md). A standalone WaveNet job does not require Cloudflare or Family Screen.
