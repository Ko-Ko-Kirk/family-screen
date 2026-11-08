import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function moduleAt(name) {
  const result = await build({ entryPoints: [new URL(`../src/${name}.ts`, import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { startsInReading, openingPosition } = await moduleAt('reading');
const { readResumePreference, rememberResume, startupResume } = await moduleAt('resume-state');

test('explicit reading opens unbookmarked chapters without changing listening defaults', () => {
  const chapter = { media_type: 'audio', has_subtitles: 1, duration_seconds: 3600,
    position_seconds: 2700, completed: 0, updated_at: 1000, reading_updated_at: 1_001_000 };
  for (const reading_position_seconds of [null, undefined]) {
    const unread = { ...chapter, reading_position_seconds };
    assert.equal(startsInReading(unread, 'read'), true);
    assert.equal(startsInReading(unread, 'default'), false);
    assert.equal(startsInReading(unread, 'listen'), false);
    assert.equal(startsInReading(unread, 'listen-reading'), false);
    assert.equal(startsInReading(unread, 'read', true), false);
    assert.equal(startsInReading({ ...unread, media_type: 'video' }, 'read'), false);
    assert.equal(startsInReading({ ...unread, has_subtitles: 0 }, 'read'), false);
    assert.equal(openingPosition(unread, 'listen'), 2700);
    assert.equal(openingPosition(unread, 'listen-reading'), 2700);
  }
  const bookmarked = { ...chapter, reading_position_seconds: 0 };
  assert.equal(startsInReading(bookmarked, 'default'), true);
  assert.equal(startsInReading(bookmarked, 'read'), true);
  assert.equal(startsInReading(bookmarked, 'listen'), false);
  assert.equal(startsInReading(bookmarked, 'listen-reading'), false);
  assert.equal(openingPosition(bookmarked, 'listen-reading'), 0);
});

test('continue listening and reading-to-speech restore different positions', () => {
  const chapter = { media_type: 'audio', has_subtitles: 1, duration_seconds: 3600,
    position_seconds: 2700, completed: 0, updated_at: 1000,
    reading_position_seconds: 1200, reading_updated_at: 900_000 };
  assert.equal(startsInReading(chapter, 'default'), false);
  assert.equal(startsInReading({ ...chapter, reading_updated_at: 1_001_000 }, 'default'), true);
  assert.equal(startsInReading(chapter, 'read'), true);
  assert.equal(startsInReading(chapter, 'listen'), false);
  assert.equal(startsInReading(chapter, 'read', true), false);
  assert.equal(openingPosition(chapter, 'listen'), 2700);
  assert.equal(openingPosition(chapter, 'listen-reading'), 1200);
  assert.equal(openingPosition({ ...chapter, completed: 1 }, 'listen'), 0);
});

const chapters = [
  { id: 'chapter-one', collection: 'Book', sort_key: '0001', media_type: 'audio', completed: 1, updated_at: 1000 },
  { id: 'chapter-two', collection: 'Book', sort_key: '0002', media_type: 'audio', completed: 0, updated_at: 1100 },
  { id: 'other', collection: 'Other', sort_key: '0001', media_type: 'audio', completed: 0, updated_at: 2000 },
];

test('PWA cold launch repairs an old completed chapter URL after auto-next', () => {
  assert.deepEqual(startupResume(chapters, 'chapter-one', null, true), { id: 'chapter-two', intent: 'listen' });
  assert.deepEqual(startupResume(chapters, 'chapter-one', null, false), { id: 'chapter-one', intent: 'default' });
  assert.deepEqual(startupResume(chapters, 'chapter-one', null, true, 'read'), { id: 'chapter-one', intent: 'read' });
  assert.deepEqual(startupResume(chapters, 'chapter-one', null, true, 'default', true), { id: 'chapter-one', intent: 'default' });
  assert.deepEqual(startupResume(chapters, null, null, true), { id: null, intent: 'default' });
});

test('explicit reading mode survives relaunch without crossing to another book', () => {
  assert.deepEqual(startupResume(chapters, 'chapter-one', { id: 'chapter-one', mode: 'read', at: 1_200_000 }, true), { id: 'chapter-one', intent: 'read' });
  assert.deepEqual(startupResume(chapters, 'chapter-one', { id: 'other', mode: 'read', at: 9_000_000 }, true), { id: 'chapter-two', intent: 'listen' });
  assert.deepEqual(startupResume(chapters, 'chapter-one', { id: 'chapter-one', mode: 'read', at: 800_000 }, true), { id: 'chapter-two', intent: 'listen' });
});

test('resume intent is scoped to the signed-in account and tolerates unavailable storage', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  rememberResume(1, 'chapter-two', 'listen', storage);
  assert.equal(readResumePreference(1, storage).id, 'chapter-two');
  assert.equal(readResumePreference(2, storage), null);
  values.set('family-screen-resume-v1-1', JSON.stringify({ id: '../private', mode: 'read', at: 1 }));
  assert.equal(readResumePreference(1, storage), null);
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.doesNotThrow(() => rememberResume(1, 'chapter-two', 'listen', blocked));
  assert.equal(readResumePreference(1, blocked), null);
});
