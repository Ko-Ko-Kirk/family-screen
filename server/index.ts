import { Hono, type MiddlewareHandler } from 'hono';
import { clearSession, createSession, equalDigest, getViewer, passwordDigest, type AppEnv } from './auth';

type VideoRow = {
  id: string; title: string; collection: string; kind: string; period: string | null;
  duration_seconds: number; bytes: number; topics_json: string; sort_key: string;
  position_seconds: number | null; completed: number | null; updated_at: number | null;
};

const app = new Hono<AppEnv>();

const authorize: MiddlewareHandler<AppEnv> = async (context, next) => {
  if (context.req.path === '/api/login') return next();
  const viewer = await getViewer(context);
  if (!viewer) return context.json({ error: '請先登入' }, 401, { 'Cache-Control': 'no-store' });
  context.set('viewer', viewer);
  return next();
};

app.use('/api/*', authorize);
app.use('/media/*', authorize);
app.use('/thumbnails/*', authorize);

app.use('*', async (context, next) => {
  const method = context.req.method;
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = context.req.header('Origin');
    if (origin && origin !== new URL(context.req.url).origin) {
      return context.json({ error: '請從本站操作' }, 403);
    }
  }
  await next();
  context.header('Cache-Control', 'private, no-store');
  context.header('X-Content-Type-Options', 'nosniff');
});

app.post('/api/login', async (context) => {
  if (Number(context.req.header('Content-Length') || 0) > 4096) return context.json({ error: '請求過大' }, 413);
  const body: unknown = await context.req.json().catch(() => null);
  const username = typeof body === 'object' && body !== null && 'username' in body && typeof body.username === 'string'
    ? body.username.trim().toLowerCase() : '';
  const password = typeof body === 'object' && body !== null && 'password' in body && typeof body.password === 'string'
    ? body.password : '';
  if (!/^[a-z0-9_-]{2,40}$/.test(username) || password.length > 256 || !password) {
    return context.json({ error: '帳號或密碼錯誤' }, 401);
  }
  const user = await context.env.DB.prepare(
    'SELECT id, username, password_salt, password_hash, failed_count, locked_until FROM users WHERE username = ?'
  ).bind(username).first<{
    id: number; username: string; password_salt: string; password_hash: string;
    failed_count: number; locked_until: number;
  }>();
  if (!user || user.locked_until > Math.floor(Date.now() / 1000)) {
    return context.json({ error: '帳號或密碼錯誤，請稍後再試' }, 401);
  }
  const receivedHash = await passwordDigest(user.password_salt, password);
  if (!equalDigest(receivedHash, user.password_hash)) {
    const failedCount = user.failed_count + 1;
    const lockedUntil = failedCount >= 5 ? Math.floor(Date.now() / 1000) + 15 * 60 : 0;
    await context.env.DB.prepare('UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?')
      .bind(failedCount >= 5 ? 0 : failedCount, lockedUntil, user.id).run();
    return context.json({ error: '帳號或密碼錯誤，請稍後再試' }, 401);
  }
  await context.env.DB.prepare('UPDATE users SET failed_count = 0, locked_until = 0 WHERE id = ?').bind(user.id).run();
  await createSession(context, user.id);
  return context.json({ id: user.id, username: user.username });
});

app.post('/api/logout', async (context) => {
  await clearSession(context);
  return context.json({ ok: true });
});

app.get('/api/me', (context) => context.json(context.get('viewer')));

app.get('/api/catalog', async (context) => {
  const viewer = context.get('viewer');
  const result = await context.env.DB.prepare(`
    SELECT v.id, v.title, v.collection, v.kind, v.period, v.duration_seconds,
      v.bytes, v.topics_json, v.sort_key,
      p.position_seconds, p.completed, p.updated_at
    FROM videos v
    LEFT JOIN watch_progress p ON p.video_id = v.id AND p.user_id = ?
    WHERE v.published = 1 ORDER BY v.collection, v.sort_key, v.id
  `).bind(viewer.id).all<VideoRow>();
  const videos = result.results.map(({ topics_json, ...video }) => ({ ...video, topics: JSON.parse(topics_json) as string[] }));
  return context.json({ videos });
});

app.get('/api/videos/:id/chapters', async (context) => {
  const id = context.req.param('id');
  const video = await context.env.DB.prepare('SELECT id FROM videos WHERE id = ? AND published = 1').bind(id).first();
  if (!video) return context.json({ error: '找不到影片' }, 404);
  const result = await context.env.DB.prepare(
    'SELECT title, start_seconds FROM chapters WHERE video_id = ? ORDER BY chapter_index'
  ).bind(id).all<{ title: string; start_seconds: number }>();
  return context.json({ chapters: result.results });
});

app.put('/api/progress/:id', async (context) => {
  if (Number(context.req.header('Content-Length') || 0) > 1024) return context.json({ error: '請求過大' }, 413);
  const id = context.req.param('id');
  const video = await context.env.DB.prepare('SELECT duration_seconds FROM videos WHERE id = ? AND published = 1')
    .bind(id).first<{ duration_seconds: number }>();
  if (!video) return context.json({ error: '找不到影片' }, 404);
  const body: unknown = await context.req.json().catch(() => null);
  const position = typeof body === 'object' && body !== null && 'position_seconds' in body
    ? body.position_seconds : null;
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > video.duration_seconds + 2) {
    return context.json({ error: '播放位置無效' }, 400);
  }
  const completed = position >= video.duration_seconds - 5 ? 1 : 0;
  await context.env.DB.prepare(`
    INSERT INTO watch_progress (user_id, video_id, position_seconds, completed, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(user_id, video_id) DO UPDATE SET
      position_seconds = excluded.position_seconds,
      completed = excluded.completed,
      updated_at = excluded.updated_at
  `).bind(context.get('viewer').id, id, Math.min(position, video.duration_seconds), completed).run();
  return context.json({ ok: true, completed: Boolean(completed) });
});

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'invalid';
  const [, first, last] = match;
  if (!first) {
    const count = Number(last);
    if (!Number.isSafeInteger(count) || count <= 0) return 'invalid';
    return { start: Math.max(0, size - count), end: size - 1 };
  }
  const start = Number(first);
  const end = last ? Number(last) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

export { parseRange };

const media = async (context: Parameters<MiddlewareHandler<AppEnv>>[0]) => {
  const filename = context.req.param('filename');
  if (!filename || !/^[a-zA-Z0-9_-]{6,64}\.mp4$/.test(filename)) return context.json({ error: '找不到影片' }, 404);
  const id = filename.slice(0, -4);
  const video = await context.env.DB.prepare('SELECT media_key FROM videos WHERE id = ? AND published = 1')
    .bind(id).first<{ media_key: string }>();
  if (!video) return context.json({ error: '找不到影片' }, 404);
  const object = await context.env.MEDIA.head(video.media_key);
  if (!object) return context.json({ error: '影片尚未上傳完成' }, 404);
  const range = parseRange(context.req.header('Range'), object.size);
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${object.size}`, 'Accept-Ranges': 'bytes' } });
  }
  const headers = new Headers({
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${object.size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
  } else {
    headers.set('Content-Length', String(object.size));
  }
  if (context.req.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
  const value = await context.env.MEDIA.get(video.media_key,
    range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!value) return context.json({ error: '影片尚未上傳完成' }, 404);
  return new Response(value.body, { status: range ? 206 : 200, headers });
};

app.get('/media/:filename', media);
app.on('HEAD', '/media/:filename', media);

app.get('/thumbnails/:filename', async (context) => {
  const filename = context.req.param('filename');
  if (!filename || !/^[a-zA-Z0-9_-]{6,64}\.jpg$/.test(filename)) return context.json({ error: '找不到封面' }, 404);
  const id = filename.slice(0, -4);
  const video = await context.env.DB.prepare('SELECT thumbnail_key FROM videos WHERE id = ? AND published = 1')
    .bind(id).first<{ thumbnail_key: string }>();
  if (!video) return context.json({ error: '找不到封面' }, 404);
  const object = await context.env.MEDIA.get(video.thumbnail_key);
  if (!object) return context.json({ error: '封面尚未上傳' }, 404);
  return new Response(object.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' } });
});

app.notFound((context) => context.json({ error: '找不到頁面' }, 404));
app.onError((error, context) => {
  console.error(JSON.stringify({ event: 'request_error', path: context.req.path, message: error.message }));
  return context.json({ error: '服務暫時無法處理請求' }, 500);
});

export default app;
