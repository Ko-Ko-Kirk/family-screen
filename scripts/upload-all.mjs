#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const root = resolve(import.meta.dirname, '..');
const privateDir = join(root, 'private');
const credentialPath = join(privateDir, 'r2-upload.json');
const manifestPath = join(privateDir, 'manifest.json');
const statusPath = join(privateDir, 'upload-status.json');
const nodeDir = dirname(process.execPath);
const checkOnly = process.argv.includes('--check');

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeStatus(data) {
  const temp = `${statusPath}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, statusPath);
}
function activePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function runCli(command, env, update) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [join(root, 'cli/family-screen.mjs'), command], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let pending = '';
    child.stdout.on('data', (chunk) => {
      const output = chunk.toString();
      process.stdout.write(output);
      pending += output;
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) {
        const match = line.match(/^\[(\d+)\/(\d+)\]/);
        if (match) update(Number(match[1]), Number(match[2]));
      }
    });
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => code === 0 ? done() : reject(new Error(`${command} 失敗：${signal || code}`)));
  });
}

let status;
try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 以上');
  if (!existsSync(credentialPath)) throw new Error('缺少 private/r2-upload.json');
  if (process.platform !== 'win32' && (statSync(credentialPath).mode & 0o077) !== 0) throw new Error('R2 金鑰檔權限必須是 0600');
  const credentials = readJson(credentialPath);
  for (const field of ['accountId', 'bucket', 'accessKeyId', 'secretAccessKey']) {
    if (typeof credentials[field] !== 'string' || !credentials[field]) throw new Error(`R2 金鑰檔缺少 ${field}`);
  }
  const config = readJson(join(root, 'wrangler.jsonc'));
  if (credentials.bucket !== config.r2_buckets?.[0]?.bucket_name) throw new Error('金鑰 bucket 與 Wrangler 設定不同');
  const videos = readJson(manifestPath).videos.filter((video) => video.approved);
  if (!videos.length) throw new Error('沒有已核准的影片');
  for (const video of videos) {
    if (!existsSync(video.source_path) || statSync(video.source_path).size !== video.bytes) {
      throw new Error(`來源影片不存在或大小變更：${video.id}`);
    }
  }
  const client = new S3Client({
    region: 'auto', endpoint: `https://${credentials.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
  });
  const head = await client.send(new HeadObjectCommand({
    Bucket: credentials.bucket, Key: `videos/${videos[0].id}.mp4`,
  }));
  client.destroy();
  if (head.ContentLength !== videos[0].bytes) throw new Error('R2 試播影片大小不符');
  console.log(`R2 金鑰與已上傳影片讀取檢查通過；核准影片 ${videos.length} 支。`);
  if (checkOnly) process.exit(0);

  if (existsSync(statusPath)) {
    const old = readJson(statusPath);
    if (old.state === 'running' && old.pid !== process.pid && activePid(old.pid)) {
      throw new Error(`另一個匯入程序仍在執行（PID ${old.pid}）`);
    }
  }
  status = { state: 'running', stage: 'prepare', pid: process.pid, completedVideos: 0,
    totalVideos: videos.length, startedAt: new Date().toISOString() };
  writeStatus(status);
  const env = {
    ...process.env,
    PATH: `${nodeDir}:${process.env.PATH || ''}`,
    R2_ACCOUNT_ID: credentials.accountId,
    R2_BUCKET: credentials.bucket,
    R2_ACCESS_KEY_ID: credentials.accessKeyId,
    R2_SECRET_ACCESS_KEY: credentials.secretAccessKey,
  };
  await runCli('prepare', env, () => {});
  status.stage = 'upload';
  writeStatus(status);
  await runCli('import', env, (current, total) => {
    status.completedVideos = Math.max(0, current - 1);
    status.currentVideo = current;
    status.totalVideos = total;
    writeStatus(status);
  });
  status.state = 'completed';
  status.stage = 'completed';
  status.completedVideos = videos.length;
  status.finishedAt = new Date().toISOString();
  delete status.currentVideo;
  writeStatus(status);
  unlinkSync(credentialPath);
  console.log(`全量匯入完成：${videos.length} 支；已移除暫存 R2 金鑰。`);
} catch (error) {
  if (status) {
    status.state = 'failed';
    status.finishedAt = new Date().toISOString();
    status.error = error instanceof Error ? error.message : String(error);
    writeStatus(status);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
