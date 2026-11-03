import type { Caption, Playable } from './playback';

export type ReaderMode = 'listen' | 'read';
export type ReadingParagraph = { start: number; end: number; text: string; cues: Caption[] };

/** Preserve all cue text and its acoustic anchor while grouping sentences for reading. */
export function readingParagraphs(captions: Caption[]): ReadingParagraph[] {
  const paragraphs: ReadingParagraph[] = [];
  let pending: ReadingParagraph | undefined;
  for (const cue of captions) {
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
