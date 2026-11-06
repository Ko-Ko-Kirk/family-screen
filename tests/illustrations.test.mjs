import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('../src/illustrations.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
const {parseIllustrations,matchingIllustrations}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const sha='a'.repeat(64),image={file:sha+'.jpg',before_cue:2,width:800,height:600,alt:'原圖說 <script>',decorative:false};
const manifest={version:1,caption_sha256:sha,images:[image]};
test('illustrations require the current caption hash and valid acoustic cue boundaries',()=>{
  assert.deepEqual(matchingIllustrations(manifest,sha,3),[image]);
  assert.equal(matchingIllustrations(manifest,'b'.repeat(64),3),null);
  assert.equal(matchingIllustrations(manifest,sha,1),null);
  assert.deepEqual(matchingIllustrations({version:1,caption_sha256:null,images:[]},sha,0),[]);
});
test('private illustrations reject external, active, oversized, unordered and malformed metadata',()=>{
  for(const patch of [{file:'https://evil.example/a.jpg'},{file:'../'+sha+'.jpg'},{file:sha+'.svg'},{width:0},{height:20001},{before_cue:-1},{alt:'a'.repeat(1001)}]) {
    assert.equal(parseIllustrations({...manifest,images:[{...image,...patch}]}),null);
  }
  assert.equal(parseIllustrations({...manifest,images:[image,{...image,before_cue:1}]}),null);
  assert.equal(parseIllustrations({...manifest,images:Array(201).fill(image)}),null);
});
