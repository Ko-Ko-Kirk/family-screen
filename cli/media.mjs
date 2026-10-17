import { extname } from 'node:path';

export function mediaSpec(item) {
  const extension = extname(item.source_path || '').slice(1).toLowerCase();
  const format = item.media_format || extension || 'mp4';
  const types = { mp4: 'video/mp4', mp3: 'audio/mpeg', m4a: 'audio/mp4' };
  if (!Object.hasOwn(types, format)) throw new Error('只接受 MP4、MP3 或 M4A');
  if (extension && extension !== format) throw new Error('媒體格式與副檔名不符');
  const type = format === 'mp4' ? 'video' : 'audio';
  if (item.media_type && item.media_type !== type) throw new Error('媒體類型與格式不符');
  return { format, type, contentType: types[format], key: `videos/${item.id}.${format}` };
}
