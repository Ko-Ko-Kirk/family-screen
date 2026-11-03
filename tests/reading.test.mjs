import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { outputFiles } = await build({entryPoints:[new URL('../src/reading.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const { readingParagraphs, readingParagraphIndex, resumeReading } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

test('continuous reading preserves repeated and mixed-language cue text with acoustic anchors',()=>{
  const captions=[{start:0,end:2,text:'同一句話。'},{start:3,end:4,text:'同一句話。'},
    {start:8,end:9,text:'Hello'},{start:9,end:11,text:'world. <script>純文字</script>'}];
  const paragraphs=readingParagraphs(captions);
  assert.equal(paragraphs.map(p=>p.text).join(''),'同一句話。同一句話。Hello world. <script>純文字</script>');
  assert.equal(paragraphs[0].start,0);assert.equal(paragraphs.at(-1).end,11);
});

test('resume selects the preceding paragraph in gaps and clamps stale or initial positions',()=>{
  const p=[{start:1,end:3,text:'first'},{start:8,end:11,text:'second'},{start:14,end:20,text:'third'}];
  assert.deepEqual([0,1,3,7,8,13,14,100].map(t=>readingParagraphIndex(p,t)),[0,0,0,0,1,1,2,2]);
  assert.equal(readingParagraphIndex([],0),-1);
});

test('account reading resumes include position zero and never use playback recency',()=>{
  const rows=[{id:'a',collection:'Book',sort_key:'1',media_type:'audio',has_subtitles:1,reading_position_seconds:0,reading_updated_at:5,updated_at:1},
    {id:'b',collection:'Book',sort_key:'2',media_type:'audio',has_subtitles:1,reading_position_seconds:90,reading_updated_at:2,updated_at:9},
    {id:'video',collection:'Book',sort_key:'3',media_type:'video',has_subtitles:1,reading_position_seconds:5,reading_updated_at:10}];
  assert.equal(resumeReading(rows).id,'a');assert.equal(resumeReading([]),undefined);
});
