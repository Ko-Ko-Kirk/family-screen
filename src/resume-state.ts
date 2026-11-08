import { collectionQueue, resumeAudio, type Playable } from './playback';
import type { OpenIntent, ReaderMode } from './reading';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export type ResumePreference = { id: string; mode: ReaderMode; at: number };
type Item = Playable & { completed: number | null; updated_at: number | null };
const key = (userId: number) => `family-screen-resume-v1-${userId}`;

export function readResumePreference(userId: number, storage?: StorageLike): ResumePreference | null {
  try {
    const text = (storage || localStorage).getItem(key(userId));
    if (!text || text.length > 1024) return null;
    const value = JSON.parse(text);
    return typeof value?.id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value.id)
      && ['read', 'listen'].includes(value.mode) && Number.isFinite(value.at) && value.at > 0
      ? { id: value.id, mode: value.mode, at: value.at } : null;
  } catch { return null; }
}

export function rememberResume(userId: number, id: string, mode: ReaderMode, storage?: StorageLike): void {
  try { (storage || localStorage).setItem(key(userId), JSON.stringify({ id, mode, at: Date.now() })); }
  catch { /* Account progress is still stored by the existing API. */ }
}

/** A Home Screen relaunch can retain an older chapter URL after background auto-next. */
export function startupResume<T extends Item>(items: T[], routeId: string | null, preference: ResumePreference | null,
  standalone: boolean, explicitIntent: OpenIntent = 'default', timeLink = false): { id: string | null; intent: OpenIntent } {
  const current = items.find(item => item.id === routeId);
  if (!current || explicitIntent !== 'default' || timeLink) return { id: current?.id || null, intent: explicitIntent };
  if (standalone && current.media_type === 'audio') {
    const queue = collectionQueue(items, current);
    const preferred = queue.find(item => item.id === preference?.id);
    const listening = resumeAudio(queue);
    if (preferred && preference && preference.at >= (listening?.updated_at || 0) * 1000)
      return { id: preferred.id, intent: preference.mode };
    // Upgrade old installations without a mode preference: continue an unfinished
    // next chapter rather than reopening the completed chapter's old reading view.
    if (current.completed && listening && listening.id !== current.id)
      return { id: listening.id, intent: 'listen' };
  }
  return { id: current.id, intent: preference?.id === current.id ? preference.mode : 'default' };
}
