import type { Caption, Playable } from './playback';

export type ReaderMode = 'listen' | 'read';
export type OpenIntent = 'default' | 'read' | 'listen' | 'listen-reading';
type ReadingResumeState = {
  media_type?: 'audio' | 'video'; has_subtitles?: number; reading_position_seconds?: number | null;
  reading_updated_at?: number | null; updated_at?: number | null;
};

/** A reading bookmark must not override an explicit request to continue listening. */
export function startsInReading(item: ReadingResumeState, intent: OpenIntent, timeLink = false): boolean {
  if (timeLink || item.media_type !== 'audio' || !item.has_subtitles) return false;
  if (intent !== 'default') return intent === 'read';
  if (item.reading_position_seconds == null) return false;
  return (item.reading_updated_at || 0) > (item.updated_at || 0) * 1000;
}

/** Reading-to-speech has its own intent; ordinary listening uses watch_progress. */
export function openingPosition(item: { duration_seconds: number; position_seconds: number | null; completed: number | null;
  reading_position_seconds?: number | null }, intent: OpenIntent): number {
  const position = intent === 'listen-reading' && item.reading_position_seconds != null
    ? item.reading_position_seconds : !item.completed ? item.position_seconds || 0 : 0;
  return Math.max(0, Math.min(position, Math.max(0, item.duration_seconds - 0.1)));
}
export type ReadingParagraph = { start: number; end: number; text: string; cues: Caption[] };

/** Preserve all cue text and its acoustic anchor while grouping sentences for reading. */
export function readingParagraphs(captions: Caption[], breaks: number[] = []): ReadingParagraph[] {
  const paragraphs: ReadingParagraph[] = [];
  const boundaries = new Set(breaks);
  let pending: ReadingParagraph | undefined;
  for (const [i, cue] of captions.entries()) {
    if (pending && boundaries.has(i)) { paragraphs.push(pending); pending = undefined; }
    if (!pending) pending = { ...cue, cues: [cue] };
    else {
      const boundary = /[\p{L}\p{N}]$/u.test(pending.text) && /^[A-Za-z0-9]/.test(cue.text) ? ' ' : '';
      pending.text += boundary + cue.text;
      pending.end = cue.end; pending.cues.push(cue);
    }
    if (pending.text.length >= 160 && /[。！？.!?][」』”"')）]*\s*$/.test(pending.text)
      || pending.text.length >= 320 || /\n\s*\n/.test(cue.text)) {
      paragraphs.push(pending); pending = undefined;
    }
  }
  if (pending) paragraphs.push(pending);
  return paragraphs;
}

/** Choose the preceding paragraph in silence, and clamp stale anchors after caption updates. */
export function readingParagraphIndex(paragraphs: ReadingParagraph[], seconds: number): number {
  if (!paragraphs.length) return -1;
  const index = paragraphs.findIndex((paragraph) => paragraph.start > seconds);
  return index === -1 ? paragraphs.length - 1 : Math.max(0, index - 1);
}

export function resumeReading<T extends Playable & {
  has_subtitles?: number; reading_position_seconds?: number | null; reading_updated_at?: number | null;
}>(items: T[]): T | undefined {
  return items.filter((item) => item.media_type === 'audio' && item.has_subtitles
    && item.reading_position_seconds != null && item.reading_updated_at)
    .sort((a, b) => (b.reading_updated_at || 0) - (a.reading_updated_at || 0))[0];
}
