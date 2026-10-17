import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mediaSpec } from '../cli/media.mjs';

const { outputFiles } = await build({ entryPoints:[new URL('../src/playback.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm' });
const { collectionQueue, mediaPath, parseCaptions, resumeAudio } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

test('audiobook chapters sort numerically and never enter another collection', () => {
  const rows = ['100','2','10'].map((key) => ({id:`chapter-${key}`,collection:'Book',sort_key:key,media_type:'audio',media_format:'mp3'}));
  rows.push({id:'another',collection:'Other',sort_key:'1'});
  assert.deepEqual(collectionQueue(rows,rows[0]).map((item) => item.sort_key),['2','10','100']);
  assert.equal(mediaPath(rows[0]),'/media/chapter-100.mp3');
  assert.equal(mediaPath(rows.at(-1)),'/media/another.mp4');
  assert.equal(rows[0].sort_key,'100');
});

test('caption parser retains literal text and rejects invalid timestamps and oversized payloads', () => {
  const cues = parseCaptions('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\n<script>正體中文</script>\n\n00:00:04.000 --> 00:00:03.000\n逆序\n\n00:90:00.000 --> 01:00:00.000\n無效');
  assert.deepEqual(cues,[{start:1,end:2.5,text:'<script>正體中文</script>'}]);
  assert.deepEqual(parseCaptions('WEBVTT\n'+'x'.repeat(1_000_000)),[]);
});

test('audio MIME and extension must agree, including for incremental imports', () => {
  assert.deepEqual(mediaSpec({id:'audio-01',source_path:'/tmp/a.MP3'}),{type:'audio',format:'mp3',contentType:'audio/mpeg',key:'videos/audio-01.mp3'});
  assert.equal(mediaSpec({id:'audio-02',media_type:'audio',media_format:'m4a'}).contentType,'audio/mp4');
  assert.throws(() => mediaSpec({media_type:'video',media_format:'mp3'}),/不符/);
  assert.throws(() => mediaSpec({media_format:'html'}),/只接受/);
  assert.throws(() => mediaSpec({media_format:'mp3',source_path:'/tmp/a.m4a'}),/不符/);
});

test('continue listening keeps the chapter and advances when the latest chapter has ended', () => {
  const rows=[{id:'a',collection:'Book',sort_key:'0305',media_type:'audio',updated_at:2,completed:0},
    {id:'b',collection:'Book',sort_key:'0306',media_type:'audio',updated_at:null,completed:null}];
  assert.equal(resumeAudio(rows).id,'a');
  rows[0].completed=1;
  assert.equal(resumeAudio(rows).id,'b');
  rows[1].updated_at=3;rows[1].completed=1;
  assert.equal(resumeAudio(rows),undefined);
});
