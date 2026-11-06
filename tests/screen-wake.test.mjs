import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: [new URL('../src/screen-wake.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
const { maintainScreenWake } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
function lock() {
  const item = new EventTarget();
  item.released = false; item.releaseCalls = 0;
  item.release = async () => { item.releaseCalls++; item.released = true; item.dispatchEvent(new Event('release')); };
  return item;
}
function setup(request, initial = 'visible') {
  const doc = new EventTarget(), page = new EventTarget(), statuses = [], calls = [];
  doc.visibilityState = initial;
  const wake = request && { request: type => { calls.push(type); return request(); } };
  const owner = maintainScreenWake(doc, page, wake, status => statuses.push(status));
  return { doc, page, owner, statuses, calls, visibility(value) { doc.visibilityState = value; doc.dispatchEvent(new Event('visibilitychange')); } };
}

test('one visible fullscreen owner requests screen only and releases on exit', async () => {
  const sentinel = lock(), state = setup(async () => sentinel);
  await tick(); assert.deepEqual(state.calls, ['screen']); assert.equal(state.statuses.at(-1), 'active');
  state.owner.retry(); state.page.dispatchEvent(new Event('pageshow')); await tick();
  assert.equal(state.calls.length, 1);
  state.owner.dispose(); assert.equal(sentinel.releaseCalls, 1);
  state.visibility('visible'); state.page.dispatchEvent(new Event('pageshow')); state.owner.retry();
  assert.equal(state.calls.length, 1);
});

test('hidden documents wait, release on background and reacquire on return', async () => {
  const sentinels = [], state = setup(async () => { const s = lock(); sentinels.push(s); return s; }, 'hidden');
  assert.equal(state.calls.length, 0);
  state.visibility('visible'); await tick(); assert.equal(state.statuses.at(-1), 'active');
  state.visibility('hidden'); assert.equal(sentinels[0].releaseCalls, 1);
  state.visibility('visible'); await tick(); assert.equal(state.calls.length, 2);
  state.owner.dispose(); assert.equal(sentinels[1].releaseCalls, 1);
});

test('a request completing after fullscreen exit is immediately released', async () => {
  let resolve; const state = setup(() => new Promise(r => { resolve = r; }));
  state.owner.retry(); assert.equal(state.calls.length, 1);
  state.owner.dispose(); const late = lock(); resolve(late); await tick();
  assert.equal(late.releaseCalls, 1); assert.ok(!state.statuses.includes('active'));
});

test('out-of-order requests cannot retain a stale lock after a visibility cycle', async () => {
  const resolutions = [], state = setup(() => new Promise(r => resolutions.push(r)));
  state.visibility('hidden'); state.visibility('visible'); assert.equal(state.calls.length, 2);
  const latest = lock(); resolutions[1](latest); await tick();
  const stale = lock(); resolutions[0](stale); await tick();
  assert.equal(stale.releaseCalls, 1); assert.equal(latest.releaseCalls, 0);
  assert.equal(state.statuses.at(-1), 'active');
  state.owner.dispose(); assert.equal(latest.releaseCalls, 1);
});

test('system rejection or release is shown honestly without an automatic retry loop', async () => {
  const sentinel = lock(); let fail = true;
  const state = setup(async () => { if (fail) throw new Error('NotAllowedError'); return sentinel; });
  await tick(); assert.equal(state.statuses.at(-1), 'failed'); assert.equal(state.calls.length, 1);
  fail = false; state.owner.retry(); await tick(); assert.equal(state.statuses.at(-1), 'active');
  await sentinel.release(); await tick(); assert.equal(state.statuses.at(-1), 'released');
  assert.equal(state.calls.length, 2); state.owner.dispose();
});

test('pagehide releases and BFCache pageshow reacquires only while visible', async () => {
  const sentinels = [], state = setup(async () => { const s = lock(); sentinels.push(s); return s; });
  await tick(); state.page.dispatchEvent(new Event('pagehide'));
  assert.equal(sentinels[0].releaseCalls, 1);
  state.visibility('visible'); await tick(); assert.equal(state.calls.length, 1);
  state.page.dispatchEvent(new Event('pageshow')); await tick(); assert.equal(state.calls.length, 2);
  state.owner.dispose();
});

test('a delayed release event cannot block foreground reacquisition or clear a newer lock', async () => {
  const sentinels = [], state = setup(async () => { const s = lock(); sentinels.push(s); return s; });
  await tick(); sentinels[0].released = true;
  state.page.dispatchEvent(new Event('pageshow')); await tick();
  assert.equal(state.calls.length, 2); assert.equal(state.statuses.at(-1), 'active');
  sentinels[0].dispatchEvent(new Event('release'));
  assert.equal(state.statuses.at(-1), 'active');
  state.owner.dispose(); assert.equal(sentinels[1].releaseCalls, 1);
});

test('unsupported environments and already released responses never report an active lock', async () => {
  const absent = setup(undefined); assert.deepEqual(absent.statuses, ['unsupported']); absent.owner.dispose();
  const expired = lock(); expired.released = true;
  const state = setup(async () => expired); await tick();
  assert.equal(state.statuses.at(-1), 'released'); assert.ok(!state.statuses.includes('active'));
  state.owner.dispose();
});
