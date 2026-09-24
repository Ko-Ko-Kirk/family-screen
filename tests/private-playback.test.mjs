import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
function run(params) {
  const result = spawnSync(process.execPath, [wrangler, ...params], { cwd: root, encoding: 'utf8', timeout: 45_000 });
  assert.equal(result.status, 0, `${params[0]} failed: ${(result.stderr || result.stdout).slice(-700)}`);
}
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}
async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Wrangler dev stopped before the test began');
    try { if ((await fetch(url)).status === 200) return; } catch { /* Starting. */ }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error('Wrangler dev did not start within 25 seconds');
}

test('only an authenticated viewer can browse, seek, and resume a private video', { timeout: 90_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'family-screen-test-'));
  const state = join(directory, 'state');
  const sample = join(directory, 'sample.mp4');
  const thumbnail = join(directory, 'sample.jpg');
  const sqlFile = join(directory, 'seed.sql');
  const account = 'family';
  const password = randomBytes(24).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const digest = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  const videoId = 'samplevideo01';
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child;
  try {
    const ffmpeg = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', sample,
    ], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(ffmpeg.status, 0, ffmpeg.stderr);
    const cover = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', sample, '-frames:v', '1', thumbnail], { encoding: 'utf8' });
    assert.equal(cover.status, 0, cover.stderr);
    run(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state]);
    writeFileSync(sqlFile, `INSERT INTO users(username,password_salt,password_hash) VALUES ('${account}','${salt}','${digest}');
      INSERT INTO videos(id,title,collection,duration_seconds,bytes,topics_json,media_key,thumbnail_key,sort_key,published)
      VALUES ('${videoId}','Test movie','Family',1,1000,'[]','videos/${videoId}.mp4','thumbnails/${videoId}.jpg','001',1);
      INSERT INTO chapters(video_id,chapter_index,title,start_seconds) VALUES ('${videoId}',0,'Start',0);\n`);
    run(['d1', 'execute', 'DB', '--local', '--persist-to', state, '--file', sqlFile]);
    run(['r2', 'object', 'put', `family-screen-example-media/videos/${videoId}.mp4`, '--file', sample, '--local', '--persist-to', state]);
    run(['r2', 'object', 'put', `family-screen-example-media/thumbnails/${videoId}.jpg`, '--file', thumbnail, '--local', '--persist-to', state]);
    child = spawn(process.execPath, [wrangler, 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state, '--show-interactive-dev-session=false'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    await waitForServer(base, child).catch((error) => { throw new Error(`${error.message}\n${output.slice(-700)}`); });

    assert.equal((await fetch(`${base}/api/catalog`)).status, 401);
    assert.equal((await fetch(`${base}/media/${videoId}.mp4`, { headers: { Range: 'bytes=0-1' } })).status, 401);
    const wrong = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: account, password: 'wrong' }) });
    assert.equal(wrong.status, 401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: account, password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie?.startsWith('family_screen_session='));
    const auth = { Cookie: cookie };
    const catalog = await fetch(`${base}/api/catalog`, { headers: auth });
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).videos.length, 1);
    const chapters = await fetch(`${base}/api/videos/${videoId}/chapters`, { headers: auth });
    assert.equal((await chapters.json()).chapters.length, 1);
    assert.equal((await fetch(`${base}/thumbnails/${videoId}.jpg`, { headers: auth })).status, 200);
    const range = await fetch(`${base}/media/${videoId}.mp4`, { headers: { ...auth, Range: 'bytes=0-99' } });
    assert.equal(range.status, 206);
    assert.match(range.headers.get('content-range') || '', /^bytes 0-99\//);
    assert.equal((await range.arrayBuffer()).byteLength, 100);
    const suffix = await fetch(`${base}/media/${videoId}.mp4`, { headers: { ...auth, Range: 'bytes=-40' } });
    assert.equal(suffix.status, 206);
    assert.equal((await suffix.arrayBuffer()).byteLength, 40);
    assert.equal((await fetch(`${base}/media/${videoId}.mp4`, { method: 'HEAD', headers: auth })).status, 200);
    assert.equal((await fetch(`${base}/media/${videoId}.mp4`, { headers: { ...auth, Range: 'bytes=999999999-' } })).status, 416);
    const foreignOrigin = await fetch(`${base}/api/progress/${videoId}`, { method: 'PUT', headers: { ...auth, Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ position_seconds: 0.5 }) });
    assert.equal(foreignOrigin.status, 403);
    const update = await fetch(`${base}/api/progress/${videoId}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ position_seconds: 0.5 }) });
    assert.equal(update.status, 200);
    const refreshed = await fetch(`${base}/api/catalog`, { headers: auth });
    assert.equal((await refreshed.json()).videos[0].position_seconds, 0.5);
    const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: auth });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(`${base}/media/${videoId}.mp4`, { headers: auth })).status, 401);
  } finally {
    child?.kill('SIGTERM');
    rmSync(directory, { recursive: true, force: true });
  }
});
