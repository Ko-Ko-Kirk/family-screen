import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { selectApprovedVideos } from './select-videos.mjs';
import { mediaSpec } from './media.mjs';

const MAX_BYTES = 1_000_000;
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

export function parseD1Rows(output) {
  // Remote --file execution can print an import progress tree before --json output.
  const start = output.search(/(?:^|\n)\s*\[\s*\{/);
  if (start < 0) throw new Error('D1 字幕預檢回應無效');
  const batches = JSON.parse(output.slice(start).trim());
  if (!Array.isArray(batches) || batches.some((batch) => batch.success !== true || !Array.isArray(batch.results))) {
    throw new Error('D1 字幕預檢回應無效');
  }
  return batches.flatMap((batch) => batch.results);
}

function seconds(value) {
  if (!/^\d{2,}:\d{2}:\d{2}\.\d{3}$/.test(value)) return NaN;
  const [hours, minutes, rest] = value.split(':').map(Number);
  return minutes < 60 && rest < 60 ? hours * 3600 + minutes * 60 + rest : NaN;
}

/** Validate the plain-text WebVTT subset rendered by this player. */
export function validateCaptions(content, duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('媒體時長無效');
  if (!content.length || content.length > MAX_BYTES) throw new Error('字幕需小於 1 MB');
  if (content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) throw new Error('字幕請存成不含 BOM 的 UTF-8');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(content).replaceAll('\r\n', '\n');
  const blocks = text.split(/\n[ \t]*\n/);
  if (!/^WEBVTT(?:[ \t].*)?$/.test(blocks.shift())) throw new Error('字幕需為 UTF-8 WebVTT');
  let previousEnd = 0;
  let cues = 0;
  for (const block of blocks) {
    if (!block.trim() || /^NOTE(?:\s|$)/.test(block)) continue;
    const lines = block.split('\n');
    const index = lines.findIndex((line) => line.includes(' --> '));
    if (index < 0 || index > 1) throw new Error('字幕區塊需包含時間與文字');
    const pair = lines[index].split(' --> ');
    const start = seconds(pair[0].trim());
    const end = seconds(pair[1]?.trim().split(/\s/)[0] || '');
    if (pair.length !== 2 || !Number.isFinite(start) || !Number.isFinite(end)
      || start < previousEnd || end <= start || end > duration + 0.1) {
      throw new Error('字幕時間需依序、不重疊，且位於媒體時長內');
    }
    if (!lines.slice(index + 1).join('\n').trim() || block.includes('\0')) throw new Error('字幕文字無效');
    previousEnd = end;
    cues++;
  }
  if (!cues) throw new Error('字幕至少需要一個有效段落');
  return { cues };
}

/** Read and validate every selected caption before any network writes. */
export function planCaptionUpdates(videos, ids) {
  if (!ids || !ids.split(',').some((value) => value.trim())) throw new Error('字幕更新必須明確提供 --ids');
  return selectApprovedVideos(videos, { ids }).map((video) => {
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(video.id)) throw new Error('媒體 ID 無效');
    if (!Number.isSafeInteger(video.bytes) || video.bytes <= 0) throw new Error('媒體容量無效');
    if (!video.subtitle_path || statSync(video.subtitle_path).size > MAX_BYTES) throw new Error(`字幕檔案不存在或過大：${video.id}`);
    const content = readFileSync(video.subtitle_path);
    const { cues } = validateCaptions(content, video.duration_seconds);
    const digest = createHash('sha256').update(content).digest('hex');
    return { id: video.id, mediaKey: mediaSpec(video).key, mediaBytes: video.bytes,
      duration: video.duration_seconds, content, cues, sha256: digest,
      key: `subtitles/${video.id}-${digest}.vtt` };
  });
}

function matches(row, entry) {
  return row?.id === entry.id && Number(row.published) === 1
    && row.media_key === entry.mediaKey && row.bytes === entry.mediaBytes
    && row.duration_seconds === entry.duration;
}

export function captionUpdateSql(plan) {
  const conditions = plan.map((entry) => `(id=${quote(entry.id)} AND published=1
    AND media_key=${quote(entry.mediaKey)} AND bytes=${entry.mediaBytes} AND duration_seconds=${entry.duration})`).join(' OR ');
  return `UPDATE videos SET subtitle_key=CASE id ${plan.map((entry) => `WHEN ${quote(entry.id)} THEN ${quote(entry.key)}`).join(' ')} END
    WHERE id IN (${plan.map((entry) => quote(entry.id)).join(',')})
    AND (SELECT count(*) FROM videos WHERE ${conditions})=${plan.length};`;
}

/** Only caption objects and subtitle_key change; no media, chapters or progress writes. */
export async function publishCaptionUpdates(plan, transport) {
  if (!plan.length || new Set(plan.map((entry) => entry.id)).size !== plan.length) throw new Error('字幕更新清單無效');
  const ids = plan.map((entry) => entry.id);
  const before = new Map((await transport.readRows(ids)).map((row) => [row.id, row]));
  if (!plan.every((entry) => matches(before.get(entry.id), entry))) throw new Error('線上媒體不存在、尚未發布或與本機清單不符');
  for (const entry of plan) await transport.put(entry);
  await transport.writeSql(captionUpdateSql(plan));
  const after = new Map((await transport.readRows(ids)).map((row) => [row.id, row]));
  if (!plan.every((entry) => matches(after.get(entry.id), entry) && after.get(entry.id).subtitle_key === entry.key)) {
    throw new Error('字幕更新未通過核對；檢查媒體變更後再執行');
  }
  return plan.map(({ id, sha256, cues, key }) => ({ id, sha256, cues, key }));
}
