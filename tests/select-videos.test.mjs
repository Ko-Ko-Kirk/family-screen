import test from 'node:test';
import assert from 'node:assert/strict';
import { selectApprovedVideos } from '../cli/select-videos.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const videos = [
  { id: 'existing01', approved: true },
  { id: 'newvideo01', approved: true },
  { id: 'pending01', approved: false },
  { id: 'newvideo02', approved: true },
];

test('an incremental selection excludes existing videos without changing their approval', () => {
  const before = structuredClone(videos);
  assert.deepEqual(selectApprovedVideos(videos, { ids: 'newvideo02,newvideo01' }).map((x) => x.id),
    ['newvideo01', 'newvideo02']);
  assert.deepEqual(videos, before);
  assert.equal(selectApprovedVideos(videos).length, 3);
});

test('a requested unpublished or unknown video stops the whole selection', () => {
  for (const id of ['pending01', 'missing01']) {
    assert.throws(() => selectApprovedVideos(videos, { ids: `newvideo01,${id}` }), /不存在或尚未確認/);
  }
});

test('the limit applies after explicit selection and cannot be zero, negative, or fractional', () => {
  assert.equal(selectApprovedVideos(videos, { ids: 'newvideo02', limit: '1' })[0].id, 'newvideo02');
  for (const limit of ['0', '-1', '1.5', 'not-a-number']) {
    assert.throws(() => selectApprovedVideos(videos, { limit }), /正整數/);
  }
});

test('a missing selection argument stops before reading a manifest or importing anything', () => {
  for (const flag of ['--ids', '--limit']) {
    const result = spawnSync(process.execPath,
      [fileURLToPath(new URL('../cli/family-screen.mjs', import.meta.url)), 'import', flag],
      { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /缺少/);
    assert.doesNotMatch(result.stderr, /找不到 private\/manifest/);
    assert.doesNotMatch(result.stdout, /已上傳|已發布/);
  }
});
