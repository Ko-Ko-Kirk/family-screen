#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, relative, dirname, extname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const root = resolve(import.meta.dirname, '..');
const privateDir = join(root, 'private');
const manifestPath = join(privateDir, 'manifest.json');
const configPath = join(root, 'wrangler.jsonc');
const args = process.argv.slice(2);
const command = args[0] || 'help';

function flag(name, fallback = '') {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] || '');
}
function hasFlag(name) { return args.includes(`--${name}`); }
function must(value, description) { if (!value) throw new Error(`缺少 ${description}`); return value; }
function run(bin, params, options = {}) {
  const result = spawnSync(bin, params, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${bin} 執行失敗（${result.status}）`);
}
function output(bin, params) {
  const result = spawnSync(bin, params, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}
function loadManifest() {
  if (!existsSync(manifestPath)) throw new Error('找不到 private/manifest.json，先執行 scan 或 from-catalog');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.videos)) throw new Error('manifest 格式錯誤');
  return manifest;
}
function saveManifest(manifest) {
  mkdirSync(privateDir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
}
function sha256File(path) {
  return new Promise((done, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => done(hash.digest('hex')));
  });
}
function slugFromPath(path) { return createHash('sha256').update(path).digest('hex').slice(0, 16); }
function escapeSql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function sqlValue(value) { return value == null ? 'NULL' : typeof value === 'number' ? String(value) : escapeSql(value); }
function sqlValues(values) { return values.map(sqlValue).join(', '); }
function selectedVideos() {
  const approved = loadManifest().videos.filter((video) => video.approved);
  const limit = flag('limit');
  return limit ? approved.slice(0, Number(limit)) : approved;
}

function init() {
  const name = flag('name', 'my-family-screen');
  if (!/^[a-z][a-z0-9-]{2,35}$/.test(name)) throw new Error('站台名稱需為 3–36 個小寫英數字或連字號，且以字母開頭');
  mkdirSync(privateDir, { recursive: true });
  if (existsSync(configPath)) {
    console.log('沿用現有 wrangler.jsonc；不覆寫站台資源設定。');
    return;
  }
  const config = JSON.parse(readFileSync(join(root, 'wrangler.example.jsonc'), 'utf8'));
  config.name = name;
  config.d1_databases[0].database_name = `${name}-db`;
  config.r2_buckets[0].bucket_name = `${name}-media`;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  console.log(`已建立 ${name} 的私有設定。下一步：npm run cf:types、npm run db:local。`);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = join(directory, item.name);
    return item.isDirectory() ? walk(path) : item.isFile() && /\.mp4$/i.test(item.name) ? [path] : [];
  });
}
function probe(path) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type', '-of', 'json', path], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffprobe 無法讀取 ${path}`);
  const media = JSON.parse(result.stdout);
  const duration = Number(media.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`影片時長異常：${path}`);
  const video = media.streams?.find((stream) => stream.codec_type === 'video');
  const audio = media.streams?.find((stream) => stream.codec_type === 'audio');
  if (video?.codec_name !== 'h264' || (audio && audio.codec_name !== 'aac')) {
    throw new Error(`只接受有 H.264 影像、AAC 音訊的 MP4：${path}`);
  }
  return duration;
}
function scan() {
  const directory = resolve(must(flag('dir'), '--dir 影片資料夾'));
  if (!statSync(directory).isDirectory()) throw new Error('指定路徑不是資料夾');
  const previous = existsSync(manifestPath) ? loadManifest() : { videos: [] };
  const bySource = new Map(previous.videos.map((video) => [video.source_path, video]));
  const files = walk(directory).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const videos = files.map((path) => {
    const old = bySource.get(path);
    if (old) return old;
    const name = basename(path, extname(path));
    const rel = relative(directory, path);
    return {
      id: slugFromPath(rel), title: name, collection: dirname(rel) === '.' ? '家庭影片' : dirname(rel).split('/')[0],
      kind: 'video', period: null, duration_seconds: probe(path), bytes: statSync(path).size,
      topics: [], chapters: [], source_path: path, sort_key: rel, approved: false,
    };
  });
  saveManifest({ schema_version: 1, videos });
  console.log(`已掃描 ${videos.length} 支影片，已確認 ${videos.filter((video) => video.approved).length} 支。清單：private/manifest.json`);
}

function fromCatalog() {
  const input = resolve(must(flag('input'), '--input JSON 清單'));
  const rows = JSON.parse(readFileSync(input, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('清單必須是影片陣列');
  const previous = existsSync(manifestPath) ? loadManifest() : { videos: [] };
  const byId = new Map(previous.videos.map((video) => [video.id, video]));
  const videos = rows.map((row, index) => {
    const source = row.output || row.source_path;
    if (typeof source !== 'string' || !existsSync(source)) throw new Error(`找不到第 ${index + 1} 支影片來源`);
    const id = String(row.id || slugFromPath(source));
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(id)) throw new Error(`影片 ID 無效：${id}`);
    const bytes = statSync(source).size;
    const old = byId.get(id);
    const topics = Array.isArray(row.topics) ? row.topics.map(String) : [];
    const title = row.title || topics.slice(0, 2).join('、') || row.filename?.replace(/\.mp4$/i, '') || basename(source, extname(source));
    return {
      id, title: String(title),
      collection: String(row.collection || row.version || row.category || '家庭影片'),
      kind: String(row.kind || 'video'), period: row.period || null,
      duration_seconds: Number(row.duration_seconds), bytes,
      topics,
      chapters: Array.isArray(row.chapters) ? row.chapters.map((chapter) => ({
        title: String(chapter.title), start_seconds: Number(chapter.start_seconds),
      })) : [],
      source_path: source, sort_key: String(row.sort_key || row.period || String(index).padStart(6, '0')),
      approved: Boolean(old?.approved && old.source_path === source && old.bytes === bytes),
    };
  });
  if (videos.some((video) => !Number.isFinite(video.duration_seconds) || video.duration_seconds <= 0)) throw new Error('影片時長無效');
  saveManifest({ schema_version: 1, videos });
  console.log(`已轉換 ${videos.length} 支影片為候選清單。請檢查 private/manifest.json 後明確執行 approve。`);
}

function approve() {
  const manifest = loadManifest();
  const ids = new Set(flag('ids').split(',').filter(Boolean));
  if (!hasFlag('all') && !ids.size) throw new Error('請提供 --ids ID1,ID2 或 --all');
  let changed = 0;
  for (const video of manifest.videos) {
    if (hasFlag('all') || ids.has(video.id)) { video.approved = true; changed++; ids.delete(video.id); }
  }
  if (ids.size) throw new Error(`找不到影片 ID：${[...ids].join(', ')}`);
  saveManifest(manifest);
  console.log(`已確認 ${changed} 支影片可發布。`);
}

function prepare() {
  const videos = selectedVideos();
  if (!videos.length) throw new Error('尚未確認任何影片');
  const outputDir = join(privateDir, 'thumbnails');
  mkdirSync(outputDir, { recursive: true });
  for (const video of videos) {
    const outputPath = join(outputDir, `${video.id}.jpg`);
    if (existsSync(outputPath) && !hasFlag('force')) continue;
    const at = Math.min(30, Math.max(1, video.duration_seconds * 0.2));
    const result = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', video.source_path,
      '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', '-y', outputPath,
    ], { stdio: 'inherit' });
    if (result.status !== 0 || !existsSync(outputPath)) throw new Error(`封面產生失敗：${video.id}`);
  }
  console.log(`封面準備完成：${videos.length} 支。`);
}

function estimate() {
  const videos = selectedVideos();
  const bytes = videos.reduce((sum, video) => sum + video.bytes, 0);
  const gb = bytes / 1e9;
  const fullFree = Math.ceil(Math.max(0, gb - 10)) * 0.015;
  const noFree = Math.ceil(gb) * 0.015;
  console.log(`${videos.length} 支，${gb.toFixed(3)} GB。R2 Standard 預估儲存費：免費額度完整可用時約 US$${fullFree.toFixed(2)}／月；已用盡時約 US$${noFree.toFixed(2)}／月。`);
  console.log('只估影片容量。封面、帳戶其他用量與超額操作另計；價格以 Cloudflare 當期公告為準。');
}

function d1Sql(sql, local = false) {
  mkdirSync(privateDir, { recursive: true });
  const path = join(privateDir, `query-${randomBytes(8).toString('hex')}.sql`);
  writeFileSync(path, sql, { mode: 0o600 });
  try {
    const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'DB', local ? '--local' : '--remote', '--file', path],
      { cwd: root, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`D1 匯入失敗：${(result.stderr || result.stdout).slice(-1000)}`);
  }
  finally { unlinkSync(path); }
}

function userAdd() {
  const username = must(flag('username'), '--username 名稱').toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(username)) throw new Error('帳號限 2–40 個小寫英數字、底線或連字號');
  const credentialsFile = flag('credentials-file');
  const credentialPath = credentialsFile ? resolve(credentialsFile) : null;
  if (credentialPath && !credentialPath.startsWith(`${privateDir}/`)) throw new Error('帳密檔案請放在 private/ 內');
  const password = randomBytes(24).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const digest = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  const sql = `INSERT INTO users (username, password_salt, password_hash) VALUES (${sqlValues([username, salt, digest])})
    ON CONFLICT(username) DO UPDATE SET password_salt = excluded.password_salt, password_hash = excluded.password_hash,
      failed_count = 0, locked_until = 0;
    DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ${escapeSql(username)});\n`;
  d1Sql(sql, hasFlag('local'));
  if (credentialPath) {
    mkdirSync(dirname(credentialPath), { recursive: true });
    writeFileSync(credentialPath, `帳號：${username}\n密碼：${password}\n`, { mode: 0o600 });
    console.log(`帳號已建立，登入資訊已寫入 ${relative(root, credentialPath)}（僅限本機，權限 0600）。`);
  } else {
    console.log(`帳號：${username}\n一次性顯示密碼：${password}\n請現在存入你的密碼管理器；D1 只保留加鹽雜湊。`);
  }
}

function r2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const keyId = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !keyId || !secret || !bucket) {
    throw new Error('上傳需要 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、R2_BUCKET 環境變數');
  }
  return { bucket, client: new S3Client({
    region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: keyId, secretAccessKey: secret },
  }) };
}
async function uploadFile(client, bucket, key, path, contentType) {
  const digest = await sha256File(path);
  try {
    const old = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (old.ContentLength === statSync(path).size && old.Metadata?.sha256 === digest) return '已存在';
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404) throw error;
  }
  const upload = new Upload({ client, params: {
    Bucket: bucket, Key: key, Body: createReadStream(path), ContentType: contentType,
    Metadata: { sha256: digest },
  }, queueSize: 2, partSize: 8 * 1024 * 1024, leavePartsOnError: false });
  await upload.done();
  const remote = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (remote.ContentLength !== statSync(path).size || remote.Metadata?.sha256 !== digest) {
    throw new Error(`上傳核對失敗：${key}`);
  }
  return '已上傳';
}

function uploadWranglerFile(bucket, key, path, local, contentType) {
  if (!local && statSync(path).size > 300 * 1024 * 1024) {
    throw new Error(`Wrangler 單檔上傳限約 315 MB；請為較大的影片設定 R2 S3 憑證：${key}`);
  }
  run('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', path,
    '--content-type', contentType, local ? '--local' : '--remote']);
  return local ? '已匯入本機 R2' : '已匯入遠端 R2';
}

async function importVideos() {
  const videos = selectedVideos();
  if (!videos.length) throw new Error('尚未確認任何影片');
  const local = hasFlag('local');
  const useWrangler = local || hasFlag('wrangler');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const { bucket, client } = useWrangler ? { bucket: config.r2_buckets[0].bucket_name, client: null } : r2Client();
  const thumbnailDir = join(privateDir, 'thumbnails');
  const statements = [];
  for (const [index, video] of videos.entries()) {
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(video.id)) throw new Error(`影片 ID 無效：${video.id}`);
    if (!existsSync(video.source_path)) throw new Error(`來源影片不存在：${video.id}`);
    if (statSync(video.source_path).size !== video.bytes) throw new Error(`來源容量改變：${video.id}`);
    const thumbnail = join(thumbnailDir, `${video.id}.jpg`);
    if (!existsSync(thumbnail)) throw new Error(`缺少封面：${video.id}，先執行 prepare`);
    const mediaKey = `videos/${video.id}.mp4`;
    const thumbnailKey = `thumbnails/${video.id}.jpg`;
    console.log(`[${index + 1}/${videos.length}] ${video.title}`);
    console.log(`  影片 ${useWrangler ? uploadWranglerFile(bucket, mediaKey, video.source_path, local, 'video/mp4') : await uploadFile(client, bucket, mediaKey, video.source_path, 'video/mp4')}`);
    console.log(`  封面 ${useWrangler ? uploadWranglerFile(bucket, thumbnailKey, thumbnail, local, 'image/jpeg') : await uploadFile(client, bucket, thumbnailKey, thumbnail, 'image/jpeg')}`);
    statements.push(`INSERT INTO videos (id,title,collection,kind,period,duration_seconds,bytes,topics_json,media_key,thumbnail_key,sort_key,published)
      VALUES (${sqlValues([video.id, video.title, video.collection, video.kind, video.period, video.duration_seconds, video.bytes,
        JSON.stringify(video.topics), mediaKey, thumbnailKey, video.sort_key, 1])})
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, collection=excluded.collection, kind=excluded.kind,
        period=excluded.period, duration_seconds=excluded.duration_seconds, bytes=excluded.bytes,
        topics_json=excluded.topics_json, media_key=excluded.media_key, thumbnail_key=excluded.thumbnail_key,
        sort_key=excluded.sort_key, published=1;`);
    statements.push(`DELETE FROM chapters WHERE video_id=${escapeSql(video.id)};`);
    for (const [chapterIndex, chapter] of video.chapters.entries()) {
      statements.push(`INSERT INTO chapters (video_id,chapter_index,title,start_seconds) VALUES (${sqlValues([video.id, chapterIndex, chapter.title, chapter.start_seconds])});`);
    }
  }
  d1Sql(statements.join('\n') + '\n', local);
  console.log(`已發布 ${videos.length} 支影片。`);
}

function doctor() {
  console.log(`Node：${process.version}${Number(process.versions.node.split('.')[0]) >= 22 ? ' ✓' : '（需要 22 以上）'}`);
  console.log(`ffmpeg：${output('ffmpeg', ['-version']).split('\n')[0] || '找不到'}`);
  console.log(`ffprobe：${output('ffprobe', ['-version']).split('\n')[0] || '找不到'}`);
  console.log(`Wrangler：${output('npx', ['wrangler', '--version']).split('\n').at(-1) || '找不到'}`);
  console.log(`站台設定：${existsSync(configPath) ? '已建立' : '尚未 init'}`);
  console.log('Cloudflare 登入：請執行 npx wrangler whoami 檢查。');
}

async function verify() {
  const url = must(flag('url'), '--url 站台網址').replace(/\/$/, '');
  const index = await fetch(url);
  const catalog = await fetch(`${url}/api/catalog`);
  const videoId = flag('video-id');
  const media = videoId ? await fetch(`${url}/media/${videoId}.mp4`, { headers: { Range: 'bytes=0-1' } }) : null;
  console.log(`首頁 HTTP ${index.status}；未登入片庫 HTTP ${catalog.status}${media ? `；未登入影片 Range HTTP ${media.status}` : ''}`);
  if (index.status !== 200 || catalog.status !== 401 || (media && media.status !== 401)) {
    throw new Error('匿名存取驗證未通過');
  }
  console.log('匿名存取驗證通過。登入、續看與電視操作仍需在實際裝置驗證。');
}

function help() {
  console.log(`Family Screen CLI
  init --name my-family-screen        建立私人站台設定
  doctor                                檢查本機環境
  scan --dir /path/to/videos            掃描 H.264/AAC MP4
  from-catalog --input catalog.json     轉換現有影片清單
  approve --ids ID1,ID2 | --all         確認可發布影片
  prepare [--limit 3]                   產生封面
  estimate [--limit 3]                  估算影片儲存費
  user-add --username family [--local]  產生高強度密碼並寫入 D1
  import [--limit 3] [--local]          上傳並發布；遠端預設使用 S3 multipart
  import --limit 3 --wrangler          小檔試播：沿用 Wrangler 登入上傳
  verify --url URL [--video-id ID]      驗證匿名無法讀取影片`);
}

try {
  switch (command) {
    case 'init': init(); break;
    case 'doctor': doctor(); break;
    case 'scan': scan(); break;
    case 'from-catalog': fromCatalog(); break;
    case 'approve': approve(); break;
    case 'prepare': prepare(); break;
    case 'estimate': estimate(); break;
    case 'user-add': userAdd(); break;
    case 'import': await importVideos(); break;
    case 'verify': await verify(); break;
    default: help();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
