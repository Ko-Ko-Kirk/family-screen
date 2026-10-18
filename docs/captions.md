# Align and replace captions locally

[繁體中文](captions.zh-TW.md)

Family Screen plays UTF-8 WebVTT captions; it does not generate speech or send recordings to an AI provider. You can prepare captions locally, review them, then replace the captions on published media without uploading the media again.

## Find the timestamps in the recording

When you have the transcript and recording, forced alignment estimates where each word was spoken. A local tool such as [stable-ts](https://github.com/jianfch/stable-ts#alignment) can use a cached Whisper model on the CPU. Package and model downloads need an internet connection, but running a downloaded model does not need an OpenAI account or API key. Runtime and accuracy depend on your computer and recording.

Keep the original transcript and recording unchanged. Store transcripts, captions, model results, hashes, and review notes under `private/` or outside the repository. Install the optional alignment tools in a separate Python environment; they are not dependencies of the website.

If an alignment squeezes many words into one timestamp, inspect that section before increasing the model size. Use speech or silence boundaries that you have checked to split the problem into shorter intervals. `stable-ts` provides `align_words()` to constrain text to known start/end times. Those boundaries must come from the recording; dividing duration by character count is not acoustic alignment. Listen around the interval boundaries and check for missing words, repeated text, reversed timestamps, and captions that flash too quickly.

If the recording never speaks a phrase, alignment cannot recover it. Follow the owner's choice: subtitles may follow the actual narration while the original phrase is kept in a separate private omission log, or the audio can be reviewed for repair. Do not silently discard source text or pretend an omitted phrase has a spoken timestamp. A simple omission record can include the media ID, source and audio SHA-256, exact original phrase, reason, and approved treatment. Keep this record out of Git and outside the public demo.

## Replace captions on existing media

In the existing `private/manifest.json`, set `subtitle_path` on the approved media entries you want to update. Keep their IDs, media paths, sizes, durations, collection order, and other entries unchanged. The original media drive can be offline for this command; the selected VTT files must be readable.

```bash
npm run cli -- captions --ids YOUR-MEDIA-ID --dry-run
npx wrangler login
npm run cli -- captions --ids YOUR-MEDIA-ID
```

Use `--local` to update the local Wrangler environment instead. `--ids` is required, and `--all` and `--limit` are not accepted. The dry run validates local files and prints IDs, sizes, cue counts, and hashes without contacting Cloudflare.

The command accepts UTF-8 WebVTT without a BOM, up to 1 MB per file, using `HH:MM:SS.mmm` timestamps and plain-text cues. It rejects empty, reversed, overlapping, and out-of-duration cues. `NOTE` blocks are allowed. These structural checks do not prove that words match the recording; acoustic review remains a separate step.

Before uploading, it checks that every selected entry is already published and matches the manifest's media key, byte size, and duration. It uploads only captions, using keys derived from the media ID and caption SHA-256. One guarded D1 update changes only `subtitle_key`; if a selected media record changed after preflight, that update changes none of the selected records. The command reads the records back before saving a receipt under `private/captions/`.

The command does not modify audio, video, thumbnails, chapter cuts, or account progress. Previous caption objects remain private. An interruption or a rejected database update can leave an unused private VTT object; rerunning the same caption content uses the same key. No automatic object deletion runs.

## Verify playback

Reload an existing player page after replacing captions. Check that signed-out caption and media requests return `401`, signed-in captions match the VTT, and signed-in media Range requests return `206`. Confirm the account still resumes at the saved chapter and position. Test caption display, next playback, lock-screen controls, and headset controls on the actual phone or TV you use; desktop checks do not establish iPhone behavior.
