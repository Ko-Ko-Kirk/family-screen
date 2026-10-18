import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { planCaptionUpdates, publishCaptionUpdates } from '../cli/captions.mjs';

const root = resolve(import.meta.dirname, '..');
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
const testConfig = join(root, 'wrangler.example.jsonc');
const testEnv = { ...process.env, WRANGLER_LOG_PATH: join(tmpdir(), 'family-screen-audio-test-logs'),
  WRANGLER_REGISTRY_PATH: join(tmpdir(), 'family-screen-audio-test-registry'), WRANGLER_SEND_METRICS: 'false' };
function run(params) {
  const result = spawnSync(process.execPath, [wrangler, ...params, '--config', testConfig], { cwd: root, env: testEnv, encoding: 'utf8', timeout: 45_000 });
  assert.equal(result.status, 0, `${params[0]} failed: ${(result.stderr || result.stdout).slice(-700)}`);
  return result.stdout;
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

test('only an authenticated viewer can browse, seek, and resume a private video', { timeout: 150_000 }, async () => {
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
  const audioId = 'sampleaudio01';
  const audio = join(directory, 'sample.mp3');
  const vtt = join(directory, 'sample.vtt');
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
    const tone = spawnSync('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i',
      'sine=frequency=220:duration=45','-c:a','libmp3lame',audio], { encoding: 'utf8' });
    assert.equal(tone.status, 0, tone.stderr);
    writeFileSync(vtt, 'WEBVTT\n\n00:00:00.000 --> 00:00:45.000\n測試字幕 <script>不執行</script>\n');
    run(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', state]);
    writeFileSync(sqlFile, `INSERT INTO users(username,password_salt,password_hash) VALUES ('${account}','${salt}','${digest}');
      INSERT INTO videos(id,title,collection,duration_seconds,bytes,topics_json,media_key,thumbnail_key,sort_key,published)
      VALUES ('${videoId}','Test movie','Family',1,1000,'[]','videos/${videoId}.mp4','thumbnails/${videoId}.jpg','001',1);
      INSERT INTO chapters(video_id,chapter_index,title,start_seconds) VALUES ('${videoId}',0,'Start',0);
      INSERT INTO users(username,password_salt,password_hash) VALUES ('another','${salt}','${digest}');
      INSERT INTO videos(id,title,collection,duration_seconds,bytes,media_key,thumbnail_key,sort_key,published,media_type,media_format,subtitle_key)
      VALUES ('${audioId}','第 305 章','有聲書',45,1000,'videos/${audioId}.mp3','thumbnails/${videoId}.jpg','0305',1,'audio','mp3','subtitles/${audioId}.vtt');\n`);
    run(['d1', 'execute', 'DB', '--local', '--persist-to', state, '--file', sqlFile]);
    run(['r2', 'object', 'put', `family-screen-example-media/videos/${videoId}.mp4`, '--file', sample, '--local', '--persist-to', state]);
    run(['r2', 'object', 'put', `family-screen-example-media/thumbnails/${videoId}.jpg`, '--file', thumbnail, '--local', '--persist-to', state]);
    run(['r2','object','put',`family-screen-example-media/videos/${audioId}.mp3`,'--file',audio,'--local','--persist-to',state]);
    run(['r2','object','put',`family-screen-example-media/subtitles/${audioId}.vtt`,'--file',vtt,'--local','--persist-to',state]);
    child = spawn(process.execPath, [wrangler, 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state, '--show-interactive-dev-session=false', '--config', testConfig],
      { cwd: root, env: testEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    await waitForServer(base, child).catch((error) => { throw new Error(`${error.message}\n${output.slice(-700)}`); });

    const shell = await fetch(base);
    assert.match(shell.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.equal(shell.headers.get('x-frame-options'), 'DENY');
    const privateCatalog = await fetch(`${base}/api/catalog`);
    assert.equal(privateCatalog.status, 401);
    assert.equal(privateCatalog.headers.get('cache-control'), 'private, no-store');
    assert.equal(privateCatalog.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(`${base}/media/${videoId}.mp4`, { headers: { Range: 'bytes=0-1' } })).status, 401);
    assert.equal((await fetch(`${base}/media/${audioId}.mp3`, { headers: { Range: 'bytes=0-1' } })).status, 401);
    assert.equal((await fetch(`${base}/subtitles/${audioId}.vtt`)).status, 401);
    const oversizedLogin = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, duplex: 'half',
      body: new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ username: account, password: 'x'.repeat(5000) })));
        controller.close();
      } }),
    });
    assert.equal(oversizedLogin.status, 413);
    const wrong = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: account, password: 'wrong' }) });
    assert.equal(wrong.status, 401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: account, password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie?.startsWith('family_screen_session='));
    const auth = { Cookie: cookie };
    const oversizedProgress = await fetch(`${base}/api/progress/${videoId}`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, duplex: 'half',
      body: new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ position_seconds: 0.5, padding: 'x'.repeat(2000) })));
        controller.close();
      } }),
    });
    assert.equal(oversizedProgress.status, 413);
    const catalog = await fetch(`${base}/api/catalog`, { headers: auth });
    assert.equal(catalog.status, 200);
    const items = (await catalog.json()).videos;
    assert.equal(items.length, 2);
    assert.equal(items.find((row) => row.id === videoId).media_format, 'mp4');
    assert.equal(items.find((row) => row.id === audioId).media_type, 'audio');
    assert.equal(items.find((row) => row.id === audioId).has_subtitles, 1);
    const audioRange = await fetch(`${base}/media/${audioId}.mp3`, { headers: { ...auth, Range: 'bytes=2-99' } });
    assert.equal(audioRange.status, 206);
    assert.equal(audioRange.headers.get('content-type'), 'audio/mpeg');
    assert.match(audioRange.headers.get('content-range'), /^bytes 2-99\//);
    assert.equal((await audioRange.arrayBuffer()).byteLength, 98);
    assert.equal((await fetch(`${base}/media/${audioId}.mp4`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/media/${videoId}.mp3`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/media/${audioId}.mp3`, { method:'HEAD',headers:auth })).headers.get('content-type'), 'audio/mpeg');
    assert.equal((await fetch(`${base}/media/${audioId}.mp3`, { headers:{...auth,Range:'bytes=999999999-'} })).status, 416);
    const captions = await fetch(`${base}/subtitles/${audioId}.vtt`, { headers: auth });
    assert.match(captions.headers.get('content-type'), /^text\/vtt/);
    assert.equal(captions.headers.get('cache-control'), 'private, no-store');
    assert.match(await captions.text(), /測試字幕/);
    assert.equal((await fetch(`${base}/subtitles/${videoId}.vtt`, { headers:auth })).status, 404);
    assert.equal((await fetch(`${base}/api/progress/${audioId}`, {method:'PUT',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({position_seconds:17.5})})).status,200);
    const another = await fetch(`${base}/api/login`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'another',password}) });
    const secondAuth = { Cookie: another.headers.get('set-cookie').split(';')[0] };
    const separate = (await (await fetch(`${base}/api/catalog`,{headers:secondAuth})).json()).videos;
    assert.equal(separate.find((row) => row.id === audioId).position_seconds,null);
    const again = await fetch(`${base}/api/login`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:account,password}) });
    const saved = (await (await fetch(`${base}/api/catalog`,{headers:{Cookie:again.headers.get('set-cookie').split(';')[0]}})).json()).videos;
    assert.equal(saved.find((row) => row.id === audioId).position_seconds,17.5);
    const originalAudio = Buffer.from(await (await fetch(`${base}/media/${audioId}.mp3`,{headers:auth})).arrayBuffer());
    const captionFile = join(directory, 'updated.vtt');
    writeFileSync(captionFile, 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n更新後的原創字幕\n');
    const plan = planCaptionUpdates([{id:audioId,approved:true,subtitle_path:captionFile,
      source_path:'/offline/recording.mp3',media_type:'audio',media_format:'mp3',bytes:1000,duration_seconds:45}],audioId);
    const uploaded=[];
    const queryRows = async (ids) => {
      const sql=`SELECT id,published,media_key,bytes,duration_seconds,subtitle_key FROM videos WHERE id IN (${ids.map((id) => `'${id}'`).join(',')});`;
      return JSON.parse(run(['d1','execute','DB','--local','--persist-to',state,'--command',sql,'--json'])).flatMap((row) => row.results);
    };
    await publishCaptionUpdates(plan, {
      readRows:queryRows,
      async put(entry) {
        const path=join(directory,'snapshot.vtt');writeFileSync(path,entry.content);
        uploaded.push(entry.key);
        run(['r2','object','put',`family-screen-example-media/${entry.key}`,'--file',path,'--local','--persist-to',state]);
      },
      async writeSql(sql) {writeFileSync(sqlFile,sql);run(['d1','execute','DB','--local','--persist-to',state,'--file',sqlFile]);},
    });
    assert.equal(uploaded.length,1);assert.ok(uploaded.every((key) => key.startsWith('subtitles/')));
    assert.match(await (await fetch(`${base}/subtitles/${audioId}.vtt`,{headers:auth})).text(),/更新後的原創字幕/);
    assert.equal((await fetch(`${base}/subtitles/${audioId}.vtt`)).status,401);
    assert.deepEqual(Buffer.from(await (await fetch(`${base}/media/${audioId}.mp3`,{headers:auth})).arrayBuffer()),originalAudio);
    const afterCaption=(await (await fetch(`${base}/api/catalog`,{headers:auth})).json()).videos;
    assert.equal(afterCaption.find((row) => row.id===audioId).position_seconds,17.5);
    for(const item of saved) {
      const after=afterCaption.find((row) => row.id===item.id);
      for(const field of ['title','collection','bytes','sort_key','duration_seconds'])assert.equal(after[field],item[field]);
    }
    const previousKey=(await queryRows([audioId]))[0].subtitle_key;
    const stalePlan=[{...plan[0],key:'subtitles/stale-candidate.vtt'}];
    await assert.rejects(publishCaptionUpdates(stalePlan,{
      readRows:queryRows,
      async put() {writeFileSync(sqlFile,`UPDATE videos SET bytes=1001 WHERE id='${audioId}';`);run(['d1','execute','DB','--local','--persist-to',state,'--file',sqlFile]);},
      async writeSql(sql) {writeFileSync(sqlFile,sql);run(['d1','execute','DB','--local','--persist-to',state,'--file',sqlFile]);},
    }),/未通過核對/);
    assert.equal((await queryRows([audioId]))[0].subtitle_key,previousKey);
    writeFileSync(sqlFile,`UPDATE videos SET bytes=1000 WHERE id='${audioId}';`);run(['d1','execute','DB','--local','--persist-to',state,'--file',sqlFile]);
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
    assert.equal((await refreshed.json()).videos.find((row) => row.id === videoId).position_seconds, 0.5);
    const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: auth });
    assert.equal(logout.status, 200);
    assert.equal((await fetch(`${base}/media/${videoId}.mp4`, { headers: auth })).status, 401);
    assert.equal((await fetch(`${base}/media/${audioId}.mp3`, { headers: auth })).status, 401);
    assert.equal((await fetch(`${base}/subtitles/${audioId}.vtt`, { headers: auth })).status, 401);
  } finally {
    child?.kill('SIGTERM');
    rmSync(directory, { recursive: true, force: true });
  }
});
