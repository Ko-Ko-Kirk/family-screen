import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseD1Rows, validateCaptions, planCaptionUpdates, publishCaptionUpdates } from '../cli/captions.mjs';

const valid = Buffer.from('WEBVTT\n\nNOTE Local alignment; source differences kept separately.\n\n1\n00:00:01.000 --> 00:00:02.500\n原創示範字幕 <script>literal text</script>\n');

test('D1 JSON parsing accepts remote import progress and rejects failed or malformed batches', () => {
  const rows=[{id:'example01',published:1}];
  const json=JSON.stringify([{success:true,results:rows}],null,2);
  assert.deepEqual(parseD1Rows(json),rows);
  assert.deepEqual(parseD1Rows('├ Checking if file needs uploading\n├ Executing\n'+json+'\n'),rows);
  assert.deepEqual(parseD1Rows('[{"success":true,"results":[]}]'),[]);
  for(const value of ['not JSON','[]','[{"success":false,"results":[]}]','[{"success":true}]']) {
    assert.throws(()=>parseD1Rows(value));
  }
});

test('caption validation rejects malformed, overlapping and out-of-range cues instead of silently dropping them', () => {
  assert.equal(validateCaptions(valid, 5).cues, 1);
  for (const content of [
    Buffer.from('not VTT'), Buffer.from('WEBVTT\n\nNOTE no captions'),
    Buffer.from('WEBVTT\n\n00:00:03.000 --> 00:00:02.000\nreverse'),
    Buffer.from('WEBVTT\n\n00:90:00.000 --> 02:00:00.000\nbad clock'),
    Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\none\n\n00:00:01.500 --> 00:00:03.000\noverlap'),
    Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n'),
    Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:09.000\noutside'),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid]),
    Buffer.concat([Buffer.from('WEBVTT\n\n'), Buffer.from([0xff])]),
    Buffer.alloc(1_000_001),
  ]) assert.throws(() => validateCaptions(content, 5));
});

test('caption planning requires explicit approved IDs and pins bytes even when the media drive is offline', () => {
  const directory = mkdtempSync(join(tmpdir(), 'family-caption-plan-'));
  try {
    const path = join(directory, 'captions.vtt');
    writeFileSync(path, valid);
    const videos = [{ id:'example01', approved:true, subtitle_path:path, source_path:'/offline/example.mp3',
      bytes:1000, duration_seconds:5, media_type:'audio', media_format:'mp3' }];
    assert.throws(() => planCaptionUpdates(videos, ''), /--ids/);
    assert.throws(() => planCaptionUpdates(videos, 'unknown01'), /不存在/);
    assert.throws(() => planCaptionUpdates([{...videos[0],approved:false}], 'example01'), /尚未確認/);
    const plan = planCaptionUpdates(videos, 'example01');
    writeFileSync(path, 'Changed after planning');
    assert.deepEqual(plan[0].content, valid);
    assert.equal(plan[0].mediaKey, 'videos/example01.mp3');
    assert.match(plan[0].key, /^subtitles\/example01-[a-f0-9]{64}\.vtt$/);
    assert.equal(videos[0].approved, true);
  } finally { rmSync(directory, {recursive:true,force:true}); }
});

test('remote mismatch stops the entire batch before any upload or metadata mutation', async () => {
  const plan = [{ id:'example01',mediaKey:'videos/example01.mp3',mediaBytes:1000,duration:5,key:'subtitles/new.vtt' }];
  for (const rows of [[], [{ id:'example01',published:0 }],
    [{id:'example01',published:1,media_key:'videos/changed.mp3',bytes:1000,duration_seconds:5}]]) {
    let mutations=0;
    await assert.rejects(publishCaptionUpdates(plan, {async readRows(){return rows;},
      async put(){mutations++;},async writeSql(){mutations++;}}), /不符/);
    assert.equal(mutations, 0);
  }
});
