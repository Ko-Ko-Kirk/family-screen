export type Playable = {
  id: string; collection: string; sort_key: string;
  media_type?: 'video' | 'audio'; media_format?: 'mp4' | 'mp3' | 'm4a';
};

export function mediaPath(item: Playable): string {
  return `/media/${item.id}.${item.media_format || 'mp4'}`;
}

export function collectionQueue<T extends Playable>(items: T[], current: T): T[] {
  return items.filter((item) => item.collection === current.collection)
    .sort((a, b) => a.sort_key.localeCompare(b.sort_key, 'en', { numeric: true }) || a.id.localeCompare(b.id));
}

export function resumeAudio<T extends Playable & { updated_at: number | null; completed: number | null }>(items: T[]): T | undefined {
  const recent = items.filter((item) => item.media_type === 'audio' && item.updated_at)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))[0];
  if (!recent) return;
  const queue = collectionQueue(items, recent);
  return recent.completed ? queue[queue.findIndex((item) => item.id === recent.id) + 1] : recent;
}

export type Caption = { start: number; end: number; text: string };
const timestamp = (value: string): number => {
  if (!/^\d{2,}:\d{2}:\d{2}\.\d{3}$/.test(value)) return NaN;
  const [hours, minutes, seconds] = value.split(':').map(Number);
  return minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : NaN;
};

/** Plain-text cues only. Never insert subtitle text as HTML. */
export function parseCaptions(text: string): Caption[] {
  if (!text.startsWith('WEBVTT') || text.length > 1_000_000) return [];
  return text.replaceAll('\r', '').split(/\n\s*\n/).flatMap((block) => {
    const lines = block.split('\n');
    const index = lines.findIndex((line) => line.includes(' --> '));
    if (index < 0) return [];
    const [left, right] = lines[index].split(' --> ');
    const start = timestamp(left.trim());
    const end = timestamp(right.trim().split(/\s/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return [];
    const content = lines.slice(index + 1).join('\n');
    return content ? [{ start, end, text: content }] : [];
  });
}
